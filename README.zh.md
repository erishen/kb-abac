# knowledge-demo — 集中认证 + 共享 ABAC 引擎 集成演示

一个自包含的演示工程，把「集中认证 + 各站点本地授权」这套小架构的两个核心零件
集成在一起：

| 目录 | 角色 |
|---|---|
| `admin/` | **kb-auth** 服务 —— 全族「谁可以登录」「是什么角色」的唯一真相源，对外暴露跨项目决策端点 `/api/authorize`。 |
| `shared/` | **ABAC 引擎**（三份 `.lume` 源码，无独立进程、无镜像）。`admin/` 通过 `import "../shared/abac.lume"` 直接运行它。 |
| `demo/` | 两个端到端演示脚本，展示两者如何协同工作。 |

本仓库的目的就是展示 **`admin` 与 `shared` 作为一个整体运转**：服务本身很薄
（认证 + 审计 + 一个决策端点），真正的允许/拒绝逻辑都集中在 `shared/`，并被每个
消费方复用。

## 两层模型：身份集中、学段授权留本地

- **集中（由 kb-auth 持有）**：登录哈希（`htpasswd`）与 `role`（student / teacher / admin）。
- **本地（由各消费方持有）**：某个账号在「该项目」里能看哪些 `stages`，以及资源表。

`shared/abac.lume` 在决策时把两层合并。未登记账号、读不到中央表，一律
**fail-closed（拒绝）**。本演示只内置一个通用的 `demo` 项目，方便试验，不含任何
真实产品名。

## 快速开始

### 1. 引擎与服务自检（无需 Docker）

```sh
make test          # 共享引擎四套单测（local/central/corrupt/grants）+ admin 类型检查
make demo-decide   # 一个「第三方消费方」用共享引擎做 PERMIT/DENY 决策
```

### 2. 运行服务

```sh
make dev           # 宿主运行 → http://127.0.0.1:8097（本地关闭认证，便于试用）
# 或容器化（类生产）：
make docker        # 构建并后台启动 → http://127.0.0.1:10097
make demo          # 起好后：用样例 curl 调 /api/authorize 跨项目决策
make docker-stop   # 停容器（卷 kb-auth-shared 保留）
```

### 3. 试一次决策

```sh
curl -X POST http://127.0.0.1:10097/api/authorize \
  -H 'content-type: application/json' \
  -d '{"project":"demo","user":"alice","res":"data","action":"read","stage":""}'
# → {"project":"demo","user":"alice","decision":"PERMIT", ...}
```

## 配置

| 环境变量 | 默认值 | 作用 |
|---|---|---|
| `LUME_AUTH_USER` | `admin` | 管理端用户名 |
| `LUME_AUTH_PASSWORD` | 空 → 首启随机生成 | 留空时 entrypoint 生成随机口令并打印到容器日志 |
| `STATE_DIR` | `state` | 本地可写层（授权、审计） |
| `HTPASSWD_FILE` | `auth/htpasswd` | 登录认证文件（重）建位置 |

密钥绝不上库：`.env`、`logs/`、运行时状态均在 .gitignore 中。仓库仅含
`.env.example` 与一份不含口令的演示种子 `data/accounts.json`。

## 目录结构

```
knowledge-demo/
├── Makefile              # test / demo-decide / dev / docker / demo / docker-stop
├── docker-compose.yml    # 构建上下文 = 仓库根（shared/ 与 admin/ 都在）
├── admin/                # kb-auth 服务（server.lume + docker/ + data/ 种子）
├── shared/               # ABAC 引擎（abac.lume、admin.lume、json.lume）+ tools/
└── demo/                 # demo-decide.lume + demo-authorize.sh
```

## 许可证

MIT —— 见 [`LICENSE`](LICENSE)。内置的 `admin/`、`shared/` 各自带 `LICENSE` 文件；
其规范上游为独立的 `kb-auth` 与 `kb-auth-shared` 仓库。本仓库是演示快照。
