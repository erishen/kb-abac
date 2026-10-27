# kb-abac — 单站点 ABAC 演示站点

> **这是一套三仓库组合**
>
> | 仓库 | 职责 |
> |---|---|
> | [`kb-auth-shared`](https://github.com/erishen/kb-auth-shared) | ABAC **决策引擎**（纯库：无进程、无网络）。被其余两者 import。 |
> | [`kb-auth`](https://github.com/erishen/kb-auth) | **中央身份权威** —— 账号 CRUD、密码哈希、`htpasswd`。唯一的写入方。 |
> | [`kb-abac`](https://github.com/erishen/kb-abac) | **消费方站点** —— 在进程内运行引擎，并展示它如何决策。想先看效果从这里开始。 |
>
> 三者关系：站点用共享引擎在**本地**完成授权决策（每次请求零网络），只有*身份*是集中的。
> 站点从 `kb-auth-shared` 取引擎，可选地以只读方式挂载 `kb-auth` 的卷来获取账号。

一个自包含的演示**站点**，在进程内直接运行共享 ABAC 授权引擎：

```
server.lume        # 站点服务：import "./shared/abac.lume"
data/              # 本站点自己的资源表 + 身份种子
www/               # 落地页（API 说明 + 实时决策试玩）
shared/            # 共享 ABAC 引擎（git submodule → kb-auth-shared）
examples/          # 第三方消费方样例 + curl 脚本
```

`shared/` 是一个 **git submodule**，指向
[`kb-auth-shared`](https://github.com/erishen/kb-auth-shared) 并锁定到具体提交。
克隆时带 `--recursive`（或执行 `git submodule update --init`）才会拿到引擎；
缺失时 `make test` 会给出明确报错。
决策逻辑是同一份引擎源码。

> **注意**：集中认证服务（**kb-auth**）是*另一个独立服务*，有自己独立的仓库。
> 它**刻意不打包在本仓库里**——站点在本地跑授权决策（零网络），只在「账号
> CRUD」时才委托给 kb-auth。

## 站点做什么

- `POST /api/authorize` — `{project, user, res, action, stage}` → `PERMIT`/`DENY`，
  由 `shared/abac.decide_with` 在站点进程内决策，查本站点的资源表
  （`data/resources.json`）与身份表（`data/accounts.json`）。
- 未登记账号、读不到表 → 一律 **fail-closed（拒绝）**。
- `GET /api/resources` — 查看实际生效的资源注册表（JSON 优先 / 代码兜底）。

## 前置：lume 运行时

站点和引擎都用 **lume** 编写 —— 一个嵌入式脚本运行时（C11 实现，单个静态
二进制，无 GC）。整个授权决策在一个进程内完成：没有独立策略服务，也没有
每次决策的网络往返。

装官方预编译二进制（不需要编译器）：

```sh
# Linux x64；其它平台见 releases（linux-arm64 / darwin-arm64 / darwin-x64）
VER=v0.11.0
curl -fsSL -o /tmp/lume.tar.gz \
  "https://github.com/erishen/lume/releases/download/$VER/lume-linux-x64.tar.gz"
tar -xzf /tmp/lume.tar.gz && sudo install -m755 lume-linux-x64/bin/lume /usr/local/bin/lume
lume --version    # → lume 0.11.0
```

或者让仓库替你下到 `.tools/`（无需 root、不改 PATH）：

```sh
make bootstrap    # 按当前平台下载对应 release 二进制
```

容器路径不需要手工安装 —— `docker/Dockerfile` 会自动拉同一份 release 二进制。
要固定或升级运行时版本，设置 `LUME_VERSION`（默认 `v0.11.0`）：

```sh
LUME_VERSION=v0.11.0 docker compose up -d --build
```

## 快速开始

```sh
git submodule update --init   # 首次拉取共享引擎（或克隆时加 --recursive）
make bootstrap     # 可选：lume 不在 PATH 时，下到 .tools/
make test          # 共享引擎四套单测（local/central/corrupt/grants）+ 站点类型检查
make example-decide # 一个「第三方消费方」用同一份引擎做 PERMIT/DENY 决策

make dev           # 宿主运行 → http://127.0.0.1:8097
# 或容器化：
make docker        # 构建并后台启动 → http://127.0.0.1:10097
make example-curl  # 起好后：用样例 curl 调 /api/authorize
make docker-stop
```

试一次决策：

```sh
curl -X POST http://127.0.0.1:8097/api/authorize \
  -H 'content-type: application/json' \
  -d '{"project":"demo","user":"alice","res":"data","action":"read","stage":""}'
# → {"project":"demo","user":"alice","decision":"PERMIT", ...}
```

## 配置

| 环境变量 | 默认值 | 作用 |
|---|---|---|
| `STATE_DIR` | `state` | 本地可写层（运行时身份覆盖、审计） |
| `HTPASSWD_FILE` | 未设（认证关闭） | 设置后站点启用 Basic Auth |
| `DOCKER_PORT` | `10097` | 容器化运行的宿主端口 |

密钥绝不上库：`.env`、`logs/`、运行时 `state/` 均在 .gitignore 中。仓库仅含
`.env.example` 与一份不含口令的演示种子 `data/accounts.json`。

## 许可证

MIT —— 见 [`LICENSE`](LICENSE)。`shared/` 是 git submodule，自带上游
[`kb-auth-shared`](https://github.com/erishen/kb-auth-shared) 的 `LICENSE`；该仓库是规范上游。
本仓库是演示快照。
