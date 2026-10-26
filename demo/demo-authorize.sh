#!/bin/sh
# demo-authorize.sh —— 演示 kb-auth 的跨项目决策端点 /api/authorize
#
# 前置：先 `make docker`（或 `make dev` 起在 8097）。
# 用 KB_AUTH_BASE 可改目标地址，例如 KB_AUTH_BASE=http://127.0.0.1:8097 sh demo/demo-authorize.sh
set -e

BASE="${KB_AUTH_BASE:-http://127.0.0.1:10097}"

echo "==> 探测 $BASE/api/health"
curl -fsS --noproxy '*' "$BASE/api/health" \
  || { echo "kb-auth 未运行，请先 make docker（或 make dev）"; exit 1; }
echo

echo "==> POST $BASE/api/authorize  (project=demo)"
call() {
  user="$1"; res="$2"; action="$3"; stage="$4"
  echo "--- decide(user=$user, res=$res, action=$action, stage=$stage)"
  curl -fsS --noproxy '*' -X POST "$BASE/api/authorize" \
    -H 'content-type: application/json' \
    -d "{\"project\":\"demo\",\"user\":\"$user\",\"res\":\"$res\",\"action\":\"$action\",\"stage\":\"$stage\"}"
  echo
}

# admin 总管：manage admin 资源 → PERMIT
call admin  admin  manage  ""
# 学生 alice 读 data 资源 → PERMIT（student >= student）
call alice  data   read    ""
# alice 读 stage 资源、带已授权学段 → PERMIT
call alice  stage  read    "stage-1"
# alice 读 stage 资源、带未授权学段 → DENY（学段白名单拦截）
call alice  stage  read    "stage-9"
# 未知账号 ghost → DENY（fail-closed）
call ghost  data   read    ""
