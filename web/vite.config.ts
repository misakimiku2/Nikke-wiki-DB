import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLAGS = path.resolve(HERE, '../build/cg_flags.json')
const OVERRIDES_SRC = path.resolve(HERE, '../build/spine_overrides.json')
const OVERRIDES_DST = path.resolve(HERE, '../public/data/spine_overrides.json')
/** CG 合并收录表（build/gen_cg_merges.mjs 生成，人工条目也在其中），同样从 build/ 同步 */
const MERGES_SRC = path.resolve(HERE, '../build/cg_merges.json')
const MERGES_DST = path.resolve(HERE, '../public/data/cg_merges.json')
const SITE_SRC = path.resolve(HERE, '../build/site')
const SITE_DST = path.resolve(HERE, '../public')
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

/**
 * 构建前只清 dist/assets，不动 dist 里的素材副本。
 *
 * 为什么不用 emptyOutDir：dist 会整份拷贝 ../public（约 6.4G），而本机的删除操作
 * 会被沙箱重定向到回收站，emptyOutDir 等于每次构建都往回收站塞 6 个多 G，
 * 很容易把磁盘撑满。这里只删几百 KB 的 hash 产物，素材原地覆盖。
 */
function cleanDistAssets(): Plugin {
  return {
    name: 'clean-dist-assets',
    apply: 'build',
    buildStart() {
      const dir = path.resolve(HERE, '../dist/assets')
      try {
        if (!fs.existsSync(dir)) return
        for (const f of fs.readdirSync(dir)) {
          try {
            fs.rmSync(path.join(dir, f), { recursive: true, force: true })
          } catch {
            /* 删不掉就留着，不影响构建 */
          }
        }
      } catch {
        /* 目录还不存在 */
      }
    },
  }
}

/**
 * 按模型覆盖的 Spine 渲染配置（spine_overrides.json）与 CG 合并收录表（cg_merges.json）
 * 都是人工维护的，放在 build/ 里入库；public/ 整个被 .gitignore（6.4G 素材），
 * 所以每次 dev / build 前把这两份文件同步进去，前端仍按 /data/*.json 取，
 * nikke_extract 的静态渲染脚本也不用改路径。改 build/ 下的源文件会即时同步并刷新页面。
 */
function spineOverridesPlugin(): Plugin {
  const pairs: Array<[string, string]> = [[OVERRIDES_SRC, OVERRIDES_DST], [MERGES_SRC, MERGES_DST]]
  const syncOne = (src: string, dst: string) => {
    try {
      if (!fs.existsSync(src)) return
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
    } catch (e) {
      console.warn('[spine-overrides] 同步失败：', src, e)
    }
  }
  const sync = () => { for (const [src, dst] of pairs) syncOne(src, dst) }
  return {
    name: 'spine-overrides',
    // dev 与 build 都会走到，且早于 publicDir 被读取
    configResolved() {
      sync()
    },
    configureServer(server) {
      for (const [src] of pairs) server.watcher.add(src)
      server.watcher.on('change', (file) => {
        const hit = pairs.find(([src]) => path.resolve(file) === src)
        if (!hit) return
        syncOne(hit[0], hit[1])
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}

/**
 * 站点根文件（_redirects / robots.txt / _headers）同样是人工维护的，所以也放在 build/site/ 入库。
 * public/ 整个被 .gitignore，文件放在里面等于永远不进版本库——这次另一个 Agent 写 _redirects
 * 时正好踩到了，`git status` 里完全看不到它们。dev / build 前把这些文件同步进 public/，
 * 部署时认的就是 public/ 里（再由 vite 拷到 dist/）的那一份。
 */
function siteFilesPlugin(): Plugin {
  /** 编辑器原子保存会先写 xxx.tmp.<pid>.<rand> 再改名，这类中间态文件要跳过 */
  const isTemp = (f: string) => f.startsWith('.') || f.includes('.tmp.') || f.endsWith('~')

  const sync = () => {
    try {
      if (!fs.existsSync(SITE_SRC)) return
      // 用 withFileTypes 而不是逐个 statSync：临时文件在 readdir 与 stat 之间被改名/删除时，
      // statSync 会抛 ENOENT，把整轮同步打断（上一次 dev server 就是被这个坑掉的）
      for (const ent of fs.readdirSync(SITE_SRC, { withFileTypes: true })) {
        if (!ent.isFile() || isTemp(ent.name)) continue
        try {
          fs.copyFileSync(path.join(SITE_SRC, ent.name), path.join(SITE_DST, ent.name))
        } catch (e) {
          console.warn(`[site-files] 跳过 ${ent.name}：`, e)
        }
      }
    } catch (e) {
      console.warn('[site-files] 同步失败：', e)
    }
  }
  let timer: NodeJS.Timeout | undefined
  const schedule = (server: { ws: { send: (m: unknown) => void } }) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      sync()
      server.ws.send({ type: 'full-reload' })
    }, 80)
  }
  return {
    name: 'site-files',
    // dev 与 build 都会走到，且早于 publicDir 被读取
    configResolved() {
      sync()
    },
    configureServer(server) {
      if (!fs.existsSync(SITE_SRC)) return
      server.watcher.add(SITE_SRC)
      server.watcher.on('change', (file) => {
        if (path.resolve(file).startsWith(SITE_SRC + path.sep)) schedule(server)
      })
      server.watcher.on('unlink', (file) => {
        if (path.resolve(file).startsWith(SITE_SRC + path.sep)) schedule(server)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), cgFlagsPlugin(), spineOverridesPlugin(), siteFilesPlugin(), cleanDistAssets()],
  // 数据和图片都在上一级 public/，直接拿来做静态目录。
  // 只改前端代码、不想重新拷 2.1G 素材时，用 VITE_NO_PUBLIC=1 只构建 assets。
  publicDir: process.env.VITE_NO_PUBLIC ? false : '../public',
  server: { port: 5273, host: true },
  // emptyOutDir 关掉，理由见上方 cleanDistAssets 注释
  build: { outDir: '../dist', emptyOutDir: false },
})
