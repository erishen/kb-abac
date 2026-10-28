# kb-abac — a single-site ABAC demo site

> **Part of a three-repo setup**
>
> | Repo | Role |
> |---|---|
> | [`kb-auth-shared`](https://github.com/erishen/kb-auth-shared) | The ABAC **decision engine** (a library — no process, no network). Imported by everyone else. |
> | [`kb-auth`](https://github.com/erishen/kb-auth) | The **central identity authority** — account CRUD, password hashing, `htpasswd`. The only writer. |
> | [`kb-abac`](https://github.com/erishen/kb-abac) | A **consumer site** — runs the engine in-process and shows how it decides. Start here if you just want to see it work. |
>
> How they fit together: sites make authorization decisions **locally** (zero network per
> request) using the shared engine; only *identity* is centralized. A site reads the engine
> from `kb-auth-shared`, and optionally read-mounts the `kb-auth` volume to pick up accounts.
>
> Curious why this is a library rather than a gateway + PDP? See
> [`docs/DESIGN-TRADEOFF.md`](docs/DESIGN-TRADEOFF.md).

A self-contained demo **site** that runs the shared ABAC authorization engine
in-process:

```
server.lume        # the site service: import "./shared/abac.lume"
data/              # this site's own resource table + identity seed
www/               # landing page (API docs + live authorize tester)
shared/            # the shared ABAC engine (git submodule → kb-auth-shared)
examples/          # a 3rd-party consumer example + curl script
```

`shared/` is a **git submodule** pointing at
[`kb-auth-shared`](https://github.com/erishen/kb-auth-shared), pinned to a
specific commit. Clone with `--recursive` (or run `git submodule update --init`)
to get the engine; `make test` reports a clear error if the submodule is missing.
The decision logic comes from that single shared engine source, not from a copy.

> **Note:** the centralized auth service (**kb-auth**) is a *separate* service
> with its own repository. It is intentionally **not** bundled here — sites run
> authorization decisions locally (zero network) and only delegate *account
> CRUD* to kb-auth.

## What the site does

- `POST /api/authorize` — `{project, user, res, action, stage, hour?}` → `PERMIT`/`DENY`,
  decided in-process by `shared/abac.decide_with` against this site's resource
  table (`data/resources.json`) and identity table (`data/accounts.json`).
  The response includes the full decision trace and the environment facts used.
- Unknown accounts and unreadable tables fail **closed** (DENY).
- `GET /api/resources` — shows the effective registry (JSON vs code fallback).
- `GET /api/audit` — the DENY log, newest last.

> **`hour` / `weekday` are a demo-only override.** Environment facts must come from
> a trusted source: if a client can claim `hour=14`, it can walk around a
> "no admin actions outside business hours" rule. So the override is **off by
> default**; the endpoint only honours it when `ALLOW_ENV_OVERRIDE=1` is set.
> This repo's `docker-compose.yml` sets it so the landing-page scenarios can replay
> a night-time denial — **do not carry that line into a production deployment.**

### The decision chain (8 steps, short-circuits on first DENY)

```
1 auth        authentication enabled?          (off → PERMIT, stops here)
2 resource    resource type known?             (registry)
3 action      action allowed on that resource? (registry `actions`)
4 subject     account readable + registered?   (fail-closed)
5 role        role ≥ resource `min_role`?      (registry)
6 stage       stage in the granted whitelist?  (accounts `stages`)
7 require     subject attribute vs resource?   (registry `require`)
8 env         environment rules satisfied?     (registry `env.deny_when`)
```

Step 7 compares **two attributes** — something a one-way role threshold cannot
express. Example: a report with classification `level: 8` is readable only by
accounts whose `grade` reaches it:

```json
"report": {
  "actions": ["read"], "min_role": "student", "level": 8,
  "require": [ { "subject": "grade", "gte": "resource.level",
                 "reason": "account-grade-below-report-level" } ]
}
```

Operands are `subject.<attr>` / `resource.<attr>` / `literal:<value>` (a bare name
resolves as a subject attribute, then as a resource attribute). Operators:
`gte` `gt` `lte` `lt` `eq` `ne`. A denial shows both sides:
`[require grade gte resource.level failed (got 6 vs 8) 'account-grade-below-report-level']`

Step 8 adds the environment dimension: rules live in the resource table and are
evaluated against runtime facts. Example — no admin actions outside business hours:

```json
"admin": {
  "actions": ["manage"], "min_role": "admin",
  "env": { "deny_when": [ { "fact": "hour", "not_in": [9, 18],
                            "reason": "no-admin-actions-outside-business-hours" } ] }
}
```

Denials name the fact that fired:
`[env.hour=22 violates 'no-admin-actions-outside-business-hours']`.

> **Scope, stated honestly.** This is a deliberately small engine: role thresholds,
> a stage whitelist, a constrained attribute comparison (`require`), and a handful of
> environment primitives (`hour`, `weekday`, `not_in` / `eq` / `ne`). It has **no**
> general expression language, **no** REVIEW state, and **no** row-level filtering. See
> [`docs/DESIGN-TRADEOFF.md`](docs/DESIGN-TRADEOFF.md) for what it can and cannot
> do, and when you should reach for a gateway + standalone PDP instead.

## Requirements: the lume runtime

The site and the engine are written in **lume**, an embedded scripting runtime
(C11, single static binary, no GC). Everything runs in one process — there is no
separate policy service and no network hop per decision.

Install the official prebuilt binary (no compiler needed):

```sh
# Linux x64 — see releases for linux-arm64 / darwin-arm64 / darwin-x64
VER=v0.11.0
curl -fsSL -o /tmp/lume.tar.gz \
  "https://github.com/erishen/lume/releases/download/$VER/lume-linux-x64.tar.gz"
tar -xzf /tmp/lume.tar.gz && sudo install -m755 lume-linux-x64/bin/lume /usr/local/bin/lume
lume --version    # → lume 0.11.0
```

Or let the repo fetch it for you into `.tools/` (no root, no PATH changes):

```sh
make bootstrap    # downloads the release binary matching this platform
```

The Docker image needs no manual install — `docker/Dockerfile` pulls the same
release binary automatically. To pin or upgrade the runtime, set
`LUME_VERSION` (default `v0.11.0`):

```sh
LUME_VERSION=v0.11.0 docker compose up -d --build
```

## Quick start

```sh
git submodule update --init   # fetch the shared engine (once, or clone --recursive)
make bootstrap     # optional: fetch lume into .tools/ if not already on PATH
make test          # shared engine unit tests (local/central/corrupt/grants) + site type-check
make example-decide # a 3rd-party consumer uses the same engine to decide PERMIT/DENY

make dev           # host run → http://127.0.0.1:8097
# or, containerized:
make docker        # build + background → http://127.0.0.1:10097
make example-curl  # once it's up: curl the /api/authorize endpoint with sample cases
make docker-stop
```

> `make test` fails loudly if lume isn't resolvable — it will *not* report success on an
> empty run. If you ever add a `grep FAIL`-style check here, pair it with an
> "at least one PASS" assertion; the reasoning and the three times it has bitten us are in
> [`kb-auth-shared`'s Known pitfalls](https://github.com/erishen/kb-auth-shared#known-pitfalls).

Try a decision:

```sh
curl -X POST http://127.0.0.1:8097/api/authorize \
  -H 'content-type: application/json' \
  -d '{"project":"project-a","user":"alice","res":"data","action":"read","stage":""}'
# → {"project":"project-a","user":"alice","decision":"PERMIT", ...}
```

## Configuration

| env | Default | Effect |
|---|---|---|
| `STATE_DIR` | `state` | Local writable layer (runtime identity overrides, audit) |
| `HTPASSWD_FILE` | unset (auth off) | Set to enable Basic Auth on the site |
| `DOCKER_PORT` | `10097` | Host port for the containerized run |

Secrets are never committed: `.env`, `logs/`, and runtime `state/` are gitignored.
The repo ships only `.env.example` and a demo seed `data/accounts.json` (no passwords).

## License

MIT — see [`LICENSE`](LICENSE). `shared/` is a git submodule and carries its own
`LICENSE` from [`kb-auth-shared`](https://github.com/erishen/kb-auth-shared), which
is the canonical upstream. This repo is a demo snapshot.
