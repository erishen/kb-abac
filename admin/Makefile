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
#   ① 环境变量或命令行 LUME_DIR（如 `make dev LUME_DIR=/abs/path/to/lume`）；
#   ② 默认的相对路径 ../../lume/lume 指向「与 lume 源码树同级」的本地布局；
#   ③ 若默认路径不存在，自动回退到 PATH 上的 `lume`（装好 lume 即可零配置）。
# make 不读 .env；覆盖请用环境变量或命令行。
LUME_DIR  ?= ../../lume/lume
ifeq ($(wildcard $(LUME_DIR)/bin/lume),)
  LUME      := $(if $(shell command -v lume 2>/dev/null),lume,$(LUME_DIR)/bin/lume)
else
  LUME      := $(LUME_DIR)/bin/lume
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
