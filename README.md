# kb-abac — a single-site ABAC demo site

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

- `POST /api/authorize` — `{project, user, res, action, stage}` → `PERMIT`/`DENY`,
  decided in-process by `shared/abac.decide_with` against this site's resource
  table (`data/resources.json`) and identity table (`data/accounts.json`).
- Unknown accounts and unreadable tables fail **closed** (DENY).
- `GET /api/resources` — shows the effective registry (JSON vs code fallback).

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

Try a decision:

```sh
curl -X POST http://127.0.0.1:8097/api/authorize \
  -H 'content-type: application/json' \
  -d '{"project":"demo","user":"alice","res":"data","action":"read","stage":""}'
# → {"project":"demo","user":"alice","decision":"PERMIT", ...}
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
