# kb-abac —— 单站点 demo
#
# 这是个自包含演示：kb-abac 是一个站点，shared/ 是被它 import 的共享
# ABAC 引擎。站点进程本地跑授权决策（零网络）；
# kb-auth 是独立服务，不在本仓库内。
#
# 常用：
#   make test         跑共享引擎单测 + server.lume 类型检查（无需 docker）
#   make example-decide 宿主直接跑一个「第三方消费方」用 shared 引擎做决策的样例
#   make dev          宿主起服务 → http://127.0.0.1:8097
#   make docker       构建并后台启动 → http://127.0.0.1:10097
#   make example-curl (docker 起好后) 跑 curl 演示 /api/authorize
#   make docker-stop  停容器
#
# 旧名 make demo-decide / make demo 保留为别名，行为与新名一致。

# lume 工具链位置（构建 / 运行 / 单测都需要）。解析优先级：
#   ① 命令行/环境变量 LUME=/abs/path/to/lume（最高优先，覆盖一切）；
#   ② PATH 上的 `lume`（装好 lume 即可零配置，独立克隆也能跑）；
#   ③ 本机 monorepo 布局：<仓库根>/../../lume/lume/bin/lume（仅本机源码树命中）。
#   ④ `make bootstrap` 下载到 .tools/ 的官方 release 二进制（独立克隆的首选）。
# 都不成立时 LUME 为空，由守卫给出可操作报错，而不是让下游报一个看不懂的
# "No such file or directory"。
ROOT := $(CURDIR)
LUME ?= $(shell command -v lume 2>/dev/null)
ifeq ($(LUME),)
  _MONO := $(wildcard $(abspath $(ROOT)/../../lume/lume)/bin/lume)
  ifneq ($(_MONO),)
    LUME := $(_MONO)
  endif
endif
ifeq ($(LUME),)
  _BOOT := $(wildcard $(ROOT)/.tools/bin/lume)
  ifneq ($(_BOOT),)
    LUME := $(_BOOT)
  endif
endif

# 运行时版本（bootstrap 下载与 Dockerfile 的默认值保持一致）
LUME_VERSION ?= v0.11.0
TOOLS_DIR    := $(ROOT)/.tools
# 语法检查/运行前的统一守卫：LUME 未解析到可执行文件就报清晰错误。
define require_lume
	@if [ -z "$(LUME)" ] || [ ! -x "$(LUME)" ]; then \
	  echo "==> 找不到 lume 工具链（$(or $(LUME),未解析)）"; \
	  echo "    请任选其一："; \
	  echo "      make bootstrap                 （下载官方 release 二进制到 .tools/）"; \
	  echo "      make <target> LUME=/abs/path/to/lume"; \
	  echo "      或把 lume 装好并放进 PATH"; \
	  exit 1; \
	fi
endef

# 下载官方 release 的 lume 静态二进制到 .tools/（无需 root、不改 PATH）。
# 版本可用 LUME_VERSION 覆盖；已存在则跳过（FORCE=1 强制重下）。
bootstrap:
	@set -eu; \
	  if [ -x "$(TOOLS_DIR)/bin/lume" ] && [ "$(FORCE)" != "1" ]; then \
	    echo "==> lume 已存在: $(TOOLS_DIR)/bin/lume ($$($(TOOLS_DIR)/bin/lume --version 2>/dev/null || echo '?'))"; \
	    echo "    如需重下: make bootstrap FORCE=1"; \
	    exit 0; \
	  fi; \
	  OS=$$(uname -s); M=$$(uname -m); \
	  case "$$OS" in \
	    Linux)  case "$$M" in x86_64|amd64) A=x64 ;; aarch64|arm64) A=arm64 ;; *) echo "不支持的架构: $$M" >&2; exit 1 ;; esac; \
	            ASSET="lume-linux-$$A"; EXT="tar.gz" ;; \
	    Darwin) case "$$M" in arm64) A=arm64 ;; x86_64) A=x64 ;; *) echo "不支持的架构: $$M" >&2; exit 1 ;; esac; \
	            ASSET="lume-darwin-$$A"; EXT="tar.gz" ;; \
	    *) echo "不支持的系统: $$OS（Windows 请手动下载 release 资产）" >&2; exit 1 ;; \
	  esac; \
	  BASE="https://github.com/erishen/lume/releases/download/$(LUME_VERSION)"; \
	  echo "==> 下载 $(LUME_VERSION) / $$ASSET"; \
	  mkdir -p "$(TOOLS_DIR)"; \
	  tmp=$$(mktemp -d); \
	  curl -fsSL --retry 3 -o "$$tmp/a.tar.gz" "$$BASE/$$ASSET.tar.gz"; \
	  curl -fsSL --retry 3 -o "$$tmp/a.sha256" "$$BASE/$$ASSET.sha256"; \
	  ( cd "$$tmp" && sed "s/[a-z0-9-]*\.tar\.gz/a.tar.gz/" a.sha256 | shasum -a 256 -c - >/dev/null 2>&1 || sha256sum -c a.sha256 >/dev/null ); \
	  tar -xzf "$$tmp/a.tar.gz" -C "$$tmp"; \
	  mkdir -p "$(TOOLS_DIR)/bin"; \
	  install -m 0755 "$$tmp/$$ASSET/bin/lume" "$(TOOLS_DIR)/bin/lume"; \
	  rm -rf "$$tmp"; \
	  echo "==> 完成: $(TOOLS_DIR)/bin/lume ($$($(TOOLS_DIR)/bin/lume --version))"

SHARED := shared
EXAMPLES := examples

.PHONY: bootstrap test check engine-test dev docker docker-stop example-decide example-curl \
        demo demo-decide

# 共享引擎三套单测（local/central/corrupt）+ 站点 server.lume 类型检查
# 引擎在 shared/ submodule 里，变量名按上游约定是 LUME_DIR（不是 LUME）：
# 必须显式传下去，否则 -C shared 之后上游的默认相对路径会以 shared/ 为基准而落空。
test: engine-test
	$(call require_lume)
	@$(LUME) --check server.lume

check: test

engine-test:
	$(call require_lume)
	@if [ ! -f $(SHARED)/Makefile ]; then \
	  echo "==> 缺少 shared/ 引擎：它是 git submodule，请先执行"; \
	  echo "    git submodule update --init"; \
	  echo "    （或克隆时用 git clone --recursive）"; \
	  exit 1; \
	fi
	@out=$$($(MAKE) --no-print-directory -C $(SHARED) test \
	  LUME_DIR="$(dir $(LUME)).." 2>&1); rc=$$?; \
	echo "$$out" | grep -v "^==> 共享 ABAC 引擎单测全部通过$$"; \
	if [ $$rc -ne 0 ]; then exit $$rc; fi; \
	if echo "$$out" | grep -q FAIL; then echo "==> 引擎单测存在 FAIL"; exit 1; fi; \
	if ! echo "$$out" | grep -q "^PASS "; then \
	  echo "==> 引擎单测没有产出任何 PASS（lume 没跑起来？检查上面是否有 lume 路径报错）"; \
	  exit 1; \
	fi

# 宿主起服务（认证关闭，便于本地试）
dev:
	$(call require_lume)
	@echo "==> kb-abac 启动于 http://127.0.0.1:8097"
	@$(LUME) server.lume

docker:
	@docker compose -f docker-compose.yml up -d --build
	@echo "==> http://127.0.0.1:$${DOCKER_PORT:-10097}/"

docker-stop:
	@docker compose -f docker-compose.yml down

# 第三方消费方样例：直接用 shared 引擎做决策（演示「站点与 shared 同源」）
# 样例放在 examples/（不在 demo/，避免与仓库名 demo 形成 demo/demo 的嵌套重名）。
example-decide:
	$(call require_lume)
	@mkdir -p $(EXAMPLES)/state
	@printf '{"accounts":{"alice":{"role":"admin","stages":[],"grade":0,"title":"Admin"},"bob":{"role":"student","stages":[],"grade":6,"title":"Student"}}}\n' > $(EXAMPLES)/state/accounts.json
	@STATE_DIR=$(EXAMPLES)/state $(LUME) $(EXAMPLES)/consumer-decide.lume

# 决策样例（需先 make docker 或 make dev；目标地址可用 EXAMPLE_BASE 覆盖）
example-curl: docker
	@sh $(EXAMPLES)/authorize-curl.sh

# ---- 兼容别名：保留旧 target 名，转发到新 target ----
demo-decide: example-decide
demo: example-curl
