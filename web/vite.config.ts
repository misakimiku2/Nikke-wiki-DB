import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLAGS = path.resolve(HERE, '../build/cg_flags.json')
const NOTE =
  '人工标注：哪些 CG 其实不是剧情画面（活动封面 / 主视觉 / 标题图）。' +
  '只影响 CG 图鉴的展示标签，不影响剧情阅读器的 CG 关联。' +
  '名字直接照 CG 图鉴灯箱里显示的写，例如 EventScene_XXX_01。'

/**
 * 开发期专用：CG 图鉴的「标注模式」直接读写 build/cg_flags.json。
 * GET  /api/cg-flags  -> { cover: [...] }
 * POST /api/cg-flags  <- { cover: [...] }
 * 生产构建时不存在（configureServer 只在 dev 跑），图鉴会退回 cg_index.json 里的 k 字段。
 */
function cgFlagsPlugin(): Plugin {
  return {
    name: 'cg-flags',
    configureServer(server) {
      server.middlewares.use('/api/cg-flags', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method === 'GET') {
          let data: { cover?: string[] } = { cover: [] }
          try {
            data = JSON.parse(fs.readFileSync(FLAGS, 'utf-8'))
          } catch {
            /* 文件还没建过，按空名单处理 */
          }
          res.end(JSON.stringify({ cover: Array.isArray(data.cover) ? data.cover : [] }))
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', () => {
            try {
              const d = JSON.parse(body || '{}')
              const names = Array.from(new Set(
                (Array.isArray(d.cover) ? d.cover : [])
                  .filter((x: unknown): x is string => typeof x === 'string' && x.length > 0),
              )).sort()
              fs.writeFileSync(FLAGS, JSON.stringify({ _note: NOTE, cover: names }, null, 2) + '\n', 'utf-8')
              res.end(JSON.stringify({ ok: true, count: names.length }))
            } catch (e) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: String(e) }))
            }
          })
          return
        }
        res.statusCode = 405
        res.end(JSON.stringify({ ok: false }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), cgFlagsPlugin()],
  // 数据和图片都在上一级 public/，直接拿来做静态目录。
  // 只改前端代码、不想重新拷 2.1G 素材时，用 VITE_NO_PUBLIC=1 只构建 assets。
  publicDir: process.env.VITE_NO_PUBLIC ? false : '../public',
  server: { port: 5273, host: true },
  build: { outDir: '../dist', emptyOutDir: true },
})
