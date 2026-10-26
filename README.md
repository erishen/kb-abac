# knowledge-demo — centralized auth + shared ABAC engine, integrated

A self-contained demo that wires together the two building blocks of a small
"centralized authentication + per-site authorization" setup:

| Directory | Role |
|---|---|
| `admin/` | The **kb-auth** service — the single source of truth for *who can log in* and *what role they hold*. Exposes a cross-project `/api/authorize` endpoint. |
| `shared/` | The **ABAC engine** (three `.lume` files, no process, no image). `admin/` does `import "../shared/abac.lume"` and runs it. |
| `demo/` | Two runnable demos that show the integration end-to-end. |

The whole point of this repo is to show **`admin` and `shared` working as one unit**:
the service is thin (auth + audit + a decision endpoint); all the actual
allow/deny logic lives in `shared/` and is reused by every consumer.

## Two-layer model: identity is central, stage grants stay local

- **Central (kb-auth owns it):** the login hash (`htpasswd`) and the `role`
  (student / teacher / admin).
- **Local (each consumer owns it):** the `stages` a given account may see in *that*
  project, plus the resource table.

`shared/abac.lume` merges the two layers at decision time. Untracked accounts and
unreadable central tables fail **closed** (DENY). This demo ships a single generic
`demo` project so you can experiment without any real product names.

## Quick start

### 1. Engine + service checks (no Docker)

```sh
make test          # shared engine unit tests (local/central/corrupt/grants) + admin type-check
make demo-decide   # a 3rd-party consumer uses the shared engine to decide PERMIT/DENY
```

### 2. Run the service

```sh
make dev           # host run → http://127.0.0.1:8097  (auth disabled locally for convenience)
# or, containerized (prod-like):
make docker        # build + background → http://127.0.0.1:10097
make demo          # once it's up: curl the /api/authorize endpoint with sample cases
make docker-stop   # stop container (volume kb-auth-shared is preserved)
```

### 3. Try a decision

```sh
curl -X POST http://127.0.0.1:10097/api/authorize \
  -H 'content-type: application/json' \
  -d '{"project":"demo","user":"alice","res":"data","action":"read","stage":""}'
# → {"project":"demo","user":"alice","decision":"PERMIT", ...}
```

## Configuration

| env | Default | Effect |
|---|---|---|
| `LUME_AUTH_USER` | `admin` | Admin username for the management UI |
| `LUME_AUTH_PASSWORD` | empty → random on first boot | If empty, the entrypoint generates one and prints it to the container log |
| `STATE_DIR` | `state` | Local writable layer (grants, audit) |
| `HTPASSWD_FILE` | `auth/htpasswd` | Where the login auth file is (re)built |

Secrets are never committed: `.env`, `logs/`, and runtime state are gitignored.
The repo ships only `.env.example` and a demo seed `data/accounts.json` (no passwords).

## Layout

```
knowledge-demo/
├── Makefile              # test / demo-decide / dev / docker / demo / docker-stop
├── docker-compose.yml    # build context = repo root (shared/ + admin/ both present)
├── admin/                # kb-auth service (server.lume + docker/ + data/ seed)
├── shared/               # ABAC engine (abac.lume, admin.lume, json.lume) + tools/
└── demo/                 # demo-decide.lume + demo-authorize.sh
```

## License

MIT — see [`LICENSE`](LICENSE). The bundled `admin/` and `shared/` carry their own
`LICENSE` files; the canonical upstream sources are the separate
`kb-auth` and `kb-auth-shared` repositories. This repo is a demo snapshot.
