#!/usr/bin/env node
// 快速构建：只重建前端产物（dist/index.html + dist/assets），
// 不复制 ../public（7.5G 素材），也不跑 SEO 预渲染。
//
// 为什么需要它：vite.config.ts 的 publicDir 指向 ../public，`npm run build`
// 每次都要把这 7.5G 整份重新拷进 dist（dist 里其实已经有上一份），
// 纯写盘几十 GB 级、要好几分钟，日常只是验证代码完全没必要。
//
// 用法：npm run build:quick      （几秒完成）
// 注意：产物不能直接拿去部署——缺素材更新与预渲染页，发布仍用 npm run build。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.resolve(HERE, '../web')

const r = spawnSync('npx', ['vite', 'build'], {
  cwd: WEB,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_NO_PUBLIC: '1' },
})
process.exit(r.status ?? 1)
