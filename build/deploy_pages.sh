#!/usr/bin/env bash
# 本地构建 + 直传 Cloudflare Pages。
#
# 为什么不能用 Pages 的 Git 自动部署：public/（6.4G 素材）整棵不入库，
# 仓库里拉下来构建出来是个空站。所以只能在本地 build 后把 dist/ 整个传上去，
# 首次约 6.4G（十几到几十分钟），之后 wrangler 按文件 hash 增量。
#
# 用法：
#   bash build/deploy_pages.sh
# 前置（只需一次）：
#   npm install -g wrangler
#   wrangler login          # 浏览器授权 Cloudflare 账号
# 项目名默认 nikke-db-wiki，可用环境变量覆盖：NIKKE_PAGES_PROJECT=xxx bash build/deploy_pages.sh
# 首次部署会自动创建同名 Pages 项目；部署结束打印的 URL 就是正式站点地址，
# 记得把它写进 build/prerender_seo.mjs 的 SITE_URL 常量再重新构建上传一次。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
PROJECT="${NIKKE_PAGES_PROJECT:-nikke-db-wiki}"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "缺 wrangler。先装并授权一次："
  echo "  npm install -g wrangler"
  echo "  wrangler login"
  exit 1
fi

echo "== 构建 =="
(cd "$ROOT/web" && npm run build)

echo "== dist 清理（dev-only 后台素材 / 裁剪指纹 / 未引用的中档图）=="
python "$ROOT/build/prune_dist.py"

echo "== dist 体检（Pages 免费版：单文件 25 MiB / 单次 20000 文件）=="
OVER="$(find "$DIST" -type f -size +26214399c | head -5)"
if [ -n "$OVER" ]; then
  echo "以下文件超过 25 MiB 单文件上限，先处理再传："
  echo "$OVER"
  exit 1
fi
COUNT="$(find "$DIST" -type f | wc -l)"
if [ "$COUNT" -gt 20000 ]; then
  echo "dist 共 $COUNT 个文件，超过单次部署 20000 上限。"
  exit 1
fi
echo "体检通过：$COUNT 个文件，无超标单文件。"

echo "== 上传 $DIST -> Pages 项目 $PROJECT =="
# 项目不存在就创建（幂等：已存在时创建会失败，忽略即可）
wrangler pages project create "$PROJECT" --production-branch=main >/dev/null 2>&1 || true
# --commit-dirty：素材不入库导致工作区常年 dirty，跳过 wrangler 的这个提醒
wrangler pages deploy "$DIST" --project-name="$PROJECT" --commit-dirty=true
