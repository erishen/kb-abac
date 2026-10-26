# knowledge/admin —— 集中 ABAC 管理服务（kb-auth，演示版）
#
# 依赖：
#   共享引擎 ../shared/*.lume（与消费方同一事实源；本演示两目录同级）
#   lume 工具链（bin/lume）—— 见下方 LUME_DIR 解析逻辑
#
# 常用：
#   make dev       宿主起服务 → http://127.0.0.1:8097（需 lume 工具链）
#   make check     type-check server.lume + 共享引擎单测
#   make test      共享引擎单测 + server.lume 类型检查
#
# 容器化构建由仓库根 Makefile / docker-compose.yml 统一负责（context=仓库根，
# shared/ 与 admin/ 都在），故这里不重复 docker 目标。
#
# lume 工具链位置（构建 / 运行 / 单测都需要）。解析优先级：
#   ① 命令行/环境变量 LUME=/abs/path/to/lume（最高优先，覆盖一切）；
#   ② PATH 上的 `lume`（装好 lume 即可零配置）；
#   ③ 本地 monorepo 布局：<仓库根>/../../lume/lume/bin/lume（仅本机源码树）。
# 本文件位于仓库根下的 admin/，所以 ROOT 取 CWD 的上一级再算 lume 路径，
# 统一解析为绝对路径，避免被 `make -C admin` 调用时相对基准错一层。
# make 不读 .env；覆盖请用环境变量或命令行。
ROOT := $(CURDIR)/..
LUME  ?= $(shell command -v lume 2>/dev/null)
ifeq ($(LUME),)
  LUME  := $(abspath $(ROOT)/../../lume/lume)/bin/lume
endif
SCRIPT    := server.lume
SHARED_DIR ?= ../shared

.PHONY: dev check test engine-test

dev:
	@echo "==> 集中 ABAC 管理服务启动于 http://127.0.0.1:8097"
	@$(LUME) $(SCRIPT)

# 引擎是被本项目和消费方共用的一份实现，改这里必须过它的单测：
# local / central / corrupt / grants 四套环境各跑一遍（见 ../shared/Makefile 头注释）。
engine-test:
	@$(MAKE) --no-print-directory -C $(SHARED_DIR) test

check: engine-test
	@echo "==> type-check server.lume + 共享引擎"
	@$(LUME) --check $(SCRIPT)
	@$(LUME) --check $(SHARED_DIR)/abac.lume
	@$(LUME) --check $(SHARED_DIR)/admin.lume

# 不需要 docker 的全部跑一遍
test: check
