# syntax=docker/dockerfile:1
# kb-abac —— 单站点 demo（多阶段构建，不依赖私有基础镜像）
#
# 一个 lume 容器：server.lume（站点服务，引用 shared 引擎做本地授权决策）
# + 共享引擎（shared/*）。
#
# lume 运行时直接从 GitHub Release 取官方预编译的**静态**二进制：
#   https://github.com/erishen/lume/releases/download/<LUME_VERSION>/lume-linux-<ARCH>-static.tar.gz
# 静态版零动态依赖，所以最终镜像可以是 FROM scratch，也不需要再自建
# lume 基础镜像（旧写法 FROM lume:v0.8.1 依赖一个从未公开分发的本地镜像，
# 外部用户 clone 下来 make docker 必然失败）。
#
# 升级运行时只需改构建参数，不必改本文件：
#   docker build --build-arg LUME_VERSION=v0.11.0 ...
#   LUME_VERSION=v0.12.0 docker compose build
# 可用版本见 https://github.com/erishen/lume/releases
#
# build context = 仓库根（docker-compose.yml 里 context 设这里），故
# server.lume / data / www / shared 都在 context 内。
#
# 容器内布局（WORKDIR /app，uid 10001）：
#   /app/bin/lume       lume 运行时（静态二进制）
#   /app/server.lume    DSL 入口（端口 8097 写在 server{} 里）
#   /app/data/          resources.json + 账号种子
#   /app/www/           落地页
#   /app/shared/        共享 ABAC 引擎（abac.lume / json.lume）
#   import "./shared/abac.lume" 从 /app/ 解析 → /app/shared/（与 host 一致）
#
# 端口：容器内 8097；宿主映射 10097（>10000，见 docker-compose.yml）。
# ============================================================================

# ---- 阶段 1：取 lume 运行时 ----------------------------------------------
# 用 buildx 的 TARGETARCH 自动匹配 x64 / arm64，无需为两种架构各写一遍。
FROM debian:bookworm-slim AS lume-fetch

ARG LUME_VERSION=v0.11.0
ARG TARGETARCH

# 只装下载 + 解包 + 校验所需的最小工具；--no-install-recommends 控制体积。
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# 下载静态版 tarball 并校验 sha256；校验失败直接让构建失败，
# 避免把一个损坏/被篡改的二进制打进镜像。
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64|"") ARCH=x64 ;; \
      arm64)    ARCH=arm64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    BASE="https://github.com/erishen/lume/releases/download/${LUME_VERSION}"; \
    ASSET="lume-linux-${ARCH}-static"; \
    mkdir -p /out; \
    curl -fsSL --retry 3 -o "/out/${ASSET}.tar.gz" "${BASE}/${ASSET}.tar.gz"; \
    curl -fsSL --retry 3 -o "/out/${ASSET}.sha256" "${BASE}/${ASSET}.sha256"; \
    cd /out; \
    sha256sum -c "${ASSET}.sha256"; \
    tar -xzf "${ASSET}.tar.gz"; \
    install -m 0755 "${ASSET}/bin/lume" /out/lume; \
    /out/lume --version

# ---- 阶段 2：最终镜像 ----------------------------------------------------
# 静态二进制 + 极简 rootfs：只需要 CA 证书（出站 TLS）和时区数据。
FROM scratch

# 从 debian 镜像搬来最小运行时依赖（scratch 里没有包管理器）。
COPY --from=lume-fetch /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=lume-fetch /usr/share/zoneinfo /usr/share/zoneinfo

# 静态 lume 运行时。二进制放 /app/bin/，与 WORKDIR /app 配合：
# server.lume 相对 CWD 解析 → /app/server.lume；import "./shared/..." 同样从 /app 解析。
COPY --from=lume-fetch /out/lume /app/bin/lume

WORKDIR /app

# 布局：server.lume → /app/，shared → /app/shared/
COPY --chown=10001:10001 server.lume /app/server.lume
COPY --chown=10001:10001 data/       /app/data/
COPY --chown=10001:10001 www/        /app/www/
COPY --chown=10001:10001 shared/     /app/shared/

# 原本由 docker/entrypoint.sh 做的事：导出一个环境变量后 exec。
# scratch 里没有 /bin/sh，跑不了 shell 脚本；ENV 直接等价实现，
# 少一个脚本、少一层 exec，也避免镜像里塞 busybox。
# ⚠️ 这是本服务唯一放开的公开路径，别顺手加。
ENV AUTH_PUBLIC_PATHS="/api/health"

# 以非 root 运行。
USER 10001:10001

EXPOSE 8097

# scratch 里没有 busybox/nc，健康检查用 lume 自身的 --version（进程活着即可）。
# 真正的端点探活交给编排层（例如 compose 的 healthcheck 改成外部探测）。
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/app/bin/lume", "--version"]

# WORKDIR 是 /app，故 server.lume 相对 CWD 解析 → /app/server.lume。
CMD ["/app/bin/lume", "server.lume"]
