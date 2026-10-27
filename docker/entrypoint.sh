#!/bin/sh
# kb-abac 站点 entrypoint
#
# ⚠️ 当前 docker/Dockerfile 已不再使用本脚本：镜像改为 FROM scratch，
#    里面没有 /bin/sh，跑不了 shell 脚本。本脚本唯一的职责（导出
#    AUTH_PUBLIC_PATHS 后 exec）已经由 Dockerfile 的 ENV 指令等价实现。
#
# 保留原因：如果你在本地用「自带 shell 的 lume 基础镜像」构建（老做法），
# 仍可以把本脚本设为 ENTRYPOINT。新构建请直接用 docker/Dockerfile。
#
# 职责：
#   1. 把 /api/health 设为公开路径（健康探活不需要鉴权）。
#      ⚠️ 这是本服务唯一放开的公开路径，别顺手加。
#   2. 本 demo 站点不做集中账号 CRUD，无 htpasswd 生成逻辑；如需 Basic Auth，
#      自行挂载/注入 HTPASSWD_FILE 即可（server.lume 已读 env("HTPASSWD_FILE")）。
set -eu

export AUTH_PUBLIC_PATHS="/api/health"

exec "$@"
