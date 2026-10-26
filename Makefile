# knowledge-demo —— admin(kb-auth) + shared(ABAC 引擎) 集成演示
#
# 这是个自包含演示包：admin/ 是集中认证服务，shared/ 是被它 import 的共享决策引擎。
# 两者放在同一份源码树里，docker 直接把 shared/ 一起 COPY 进镜像即可（无需 submodule）。
#
# 常用：
#   make test         跑共享引擎单测 + admin/server.lume 类型检查（无需 docker）
#   make demo-decide  宿主直接跑一个「第三方消费方」用 shared 引擎做决策的样例（无需 docker）
#   make dev          宿主起服务（认证关闭，便于本地试）→ http://127.0.0.1:8097
#   make docker       构建并后台启动 kb-auth → http://127.0.0.1:10097
#   make demo         (docker 起好后) 跑 curl 演示 /api/authorize 跨项目决策
#   make docker-stop  停容器（卷 kb-auth-shared 保留）

# lume 工具链位置（构建 / 运行 / 单测都需要）。解析优先级：
#   ① 环境变量或命令行 LUME_DIR（如 `make test LUME_DIR=/abs/path/to/lume`）；
#   ② 默认相对路径 ../../lume/lume（与 lume 源码树同级的本地布局）；
#   ③ 若默认路径不存在，自动回退到 PATH 上的 `lume`（公开克隆装好 lume 即可零配置）。
LUME_DIR ?= ../../lume/lume
ifeq ($(wildcard $(LUME_DIR)/bin/lume),)
  LUME := $(if $(shell command -v lume 2>/dev/null),lume,$(LUME_DIR)/bin/lume)
else
  LUME := $(LUME_DIR)/bin/lume
endif

SHARED := shared
ADMIN  := admin
DEMO   := demo

.PHONY: test check engine-test dev docker docker-stop demo demo-decide

# 共享引擎四套单测（local/central/corrupt/grants）+ admin 类型检查
test: engine-test
	@$(MAKE) --no-print-directory -C $(ADMIN) check

engine-test:
	@$(MAKE) --no-print-directory -C $(SHARED) test

# 宿主起服务（认证关闭，便于本地试）
dev:
	@echo "==> kb-auth (demo) 启动于 http://127.0.0.1:8097"
	@cd $(ADMIN) && $(LUME) server.lume

docker:
	@docker compose -f docker-compose.yml up -d --build
	@echo "==> http://127.0.0.1:$${DOCKER_PORT:-10097}/"

docker-stop:
	@docker compose -f docker-compose.yml down

# 第三方消费方样例：直接用 shared 引擎做决策（演示「admin 与 shared 同源」）
demo-decide:
	@mkdir -p $(DEMO)/state
	@printf '{"accounts":{"alice":{"role":"admin","stages":[],"grade":0,"title":"Admin"},"bob":{"role":"student","stages":[],"grade":6,"title":"Student"}}}\n' > $(DEMO)/state/accounts.json
	@STATE_DIR=$(DEMO)/state $(LUME) $(DEMO)/demo-decide.lume

# 跨项目决策样例（需先 make docker）
demo: docker
	@sh $(DEMO)/demo-authorize.sh
