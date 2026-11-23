import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLAGS = path.resolve(HERE, '../build/cg_flags.json')
const OVERRIDES_SRC = path.resolve(HERE, '../build/spine_overrides.json')
const OVERRIDES_DST = path.resolve(HERE, '../public/data/spine_overrides.json')
/** CG 合并收录表（build/gen_cg_merges.mjs 生成，人工条目也在其中），同样从 build/ 同步 */
const MERGES_SRC = path.resolve(HERE, '../build/cg_merges.json')
const MERGES_DST = path.resolve(HERE, '../public/data/cg_merges.json')
/** 剧情卡封面的人工指定（选 CG + 裁剪参数），封面编辑器直接读写 */
const COVER_OVERRIDES_SRC = path.resolve(HERE, '../build/cg_cover_overrides.json')
const COVER_DIR = path.resolve(HERE, '../public/cover')
/** 外部上传的原图（网络 URL / 本地文件）与尺寸清单，按 ext_* 命名，不进 manifest */
const COVER_SRC_DIR = path.resolve(HERE, '../public/cover_src')
const COVER_SOURCES_MANIFEST = path.resolve(HERE, '../public/data/cover_sources.json')
const PROJECT_ROOT = path.resolve(HERE, '..')
const COVER_NOTE =
  '剧情卡封面手动指定：{"剧情单元id": "封面图hash"}，或 ' +
  '{"剧情单元id": {"h": "hash", "crop": {"cx": 0~1, "cy": 0~1, "zoom": ≥1}}}。' +
  'crop 只存参数，封面图由 build/build_story_covers.py 从 manifest 已有的原图按 3:4 现裁，不新增 CG 图。' +
  '外部上传图以 ext_ 开头，原图在 public/cover_src/，尺寸在 public/data/cover_sources.json。' +
  '由 /story/covers 编辑后台（dev）写入。'
const SITE_SRC = path.resolve(HERE, '../build/site')
const SITE_DST = path.resolve(HERE, '../public')
const NOTE =
  '人工标注：哪些 CG 其实不是剧情画面（活动封面 / 主视觉 / 标题图）。' +
  '只影响 CG 图鉴的展示标签，不影响剧情阅读器的 CG 关联。' +
  '名字直接照 CG 图鉴灯箱里显示的写，例如 EventScene_XXX_01。'

/** 与 gen_cg_merges.mjs 的 NOTE 保持一致（两边都写同一份文件） */
const MERGES_NOTE =
  '主 CG（封面）→ 随它收录的条目（图集贴图页 / 动态背景帧 / 连图集的其它帧）。这些条目不再作为独立作品出现在图鉴、目录、搜索与上一张/下一张里，直接 URL 仍可访问；剧情阅读器按原始条目名取图，不受影响。由 build/gen_cg_merges.mjs 生成并合并保留人工条目（人工分类表直接写进本文件即可，重跑不会丢）。'

/**
 * gen_cg_merges.mjs 里写死的人工规则（保持同步）：这些组重跑生成器会被还原，
 * 图集编辑器（/cg/albums）把它们当作只读展示。
 */
const GEN_MANUAL_MERGES: string[] = ['EventScene_Chap_04_01']

/** 扫 public/spine 的 CG 模型图集贴图页，返回自动合并组的主 CG 名（gen_cg_merges.mjs 的自动规则同款） */
function autoMergeCovers(): string[] {
  let cgNames: Set<string>
  try {
    const idx = JSON.parse(fs.readFileSync(path.resolve(HERE, '../public/data/cg_index.json'), 'utf-8'))
    cgNames = new Set(idx.items.map((x: { n: string }) => x.n))
  } catch {
    return []
  }
  const spineDir = path.resolve(HERE, '../public/spine')
  const out: string[] = []
  try {
    for (const dir of fs.readdirSync(spineDir)) {
      const atlasPath = path.join(spineDir, dir, `${dir}.atlas`)
      if (!fs.existsSync(atlasPath)) continue
      const pages = [...fs.readFileSync(atlasPath, 'utf-8').matchAll(/^(\S+)\.(?:webp|png)$/gm)]
        .map((m) => m[1])
        .filter((n) => n !== dir && cgNames.has(n))
      if (pages.length) out.push(dir)
    }
  } catch {
    /* spine 目录不存在等情况：按没有自动组处理 */
  }
  return out
}

function readMerges(): Record<string, string[]> {
  try {
    const d = JSON.parse(fs.readFileSync(MERGES_SRC, 'utf-8'))
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('_') || !Array.isArray(v)) continue
      const list = [...new Set(v.filter((x) => typeof x === 'string' && x))]
      if (list.length) out[k] = list
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 开发期专用：图集整理页（/cg/albums）直接读写 build/cg_merges.json。
 * GET  /api/cg-merges  -> { groups: {封面: [成员]}, auto: [自动组封面] }
 * POST /api/cg-merges  <- { groups }（全量；清洗后按封面名排序写回，
 *                         返回 { ok, groups } 让页面以落盘内容为准）
 * 写入后 spineOverridesPlugin 的 watcher 会同步到 public/data 并触发整页刷新，
 * 图鉴 / 查看器随即按新分组展示。生产构建不存在该接口。
 */
function cgMergesPlugin(): Plugin {
  return {
    name: 'cg-merges',
    configureServer(server) {
      server.middlewares.use('/api/cg-merges', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method === 'GET') {
          // auto = 生成器自动规则（图集贴图页）+ 生成器写死的人工规则；
          // 这些组重跑 gen_cg_merges.mjs 会被还原，编辑器里只读
          res.end(JSON.stringify({
            groups: readMerges(),
            auto: [...autoMergeCovers(), ...GEN_MANUAL_MERGES],
          }))
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', () => {
            try {
              const raw = JSON.parse(body || '{}').groups
              const covers = new Set<string>()
              for (const [k, v] of Object.entries(raw || {})) {
                if (typeof k === 'string' && k && !k.startsWith('_') && Array.isArray(v)) covers.add(k)
              }
              // 清洗：封面永远保留；成员不能是任何组的封面、不能与封面同名、全局去重
              const clean: Record<string, string[]> = {}
              const seen = new Set<string>()
              for (const cover of [...covers].sort()) {
                const v = raw[cover]
                const list = [...new Set(v.filter(
                  (x: unknown): x is string => typeof x === 'string' && x && x !== cover && !covers.has(x),
                ))].filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
                if (list.length) clean[cover] = list
              }
              const sorted = Object.fromEntries(Object.keys(clean).sort().map((k) => [k, clean[k]]))
              fs.writeFileSync(MERGES_SRC, JSON.stringify({ _note: MERGES_NOTE, ...sorted }, null, 2) + '\n', 'utf-8')
              res.end(JSON.stringify({ ok: true, groups: sorted }))
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

/**
 * 开发期专用：剧情卡封面编辑后台（/story/covers）读写 build/cg_cover_overrides.json。
 * GET  /api/cover-edits -> { edits: { [单元id]: hash | {h, crop} } }
 * POST /api/cover-edits <- { id, h, crop } | { id, remove: true }
 *  写入后调用 build_story_covers.py --only <id> --force 重新生成该单元的 3:4 封面
 *  （从已有原图现裁，不复制/新增 CG 图），并刷新页面。生产构建不存在该接口。
 */
function storyCoverEditsPlugin(): Plugin {
  const readEdits = (): Record<string, unknown> => {
    try {
      const d = JSON.parse(fs.readFileSync(COVER_OVERRIDES_SRC, 'utf-8'))
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(d)) {
        if (!k.startsWith('_') && k.trim()) out[k] = v
      }
      return out
    } catch {
      return {}
    }
  }
  const writeEdits = (edits: Record<string, unknown>) => {
    const sorted = Object.fromEntries(Object.keys(edits).sort((a, b) => Number(a) - Number(b))
      .map((k) => [k, edits[k]]))
    fs.writeFileSync(COVER_OVERRIDES_SRC,
      JSON.stringify({ _note: COVER_NOTE, ...sorted }, null, 2) + '\n', 'utf-8')
    return sorted
  }
  const regenerate = (id: number, done: (ok: boolean, out: string) => void) => {
    const args = ['build/build_story_covers.py', '--only', String(id), '--force']
    const run = (py: string) => execFile(py, args, { cwd: PROJECT_ROOT, timeout: 120000 },
      (err, stdout, stderr) => {
        if (err && py === 'python') {
          run('python3')                       // 有些机器只有 python3
          return
        }
        done(!err, (stdout || '') + (stderr || ''))
      })
    run('python')
  }
  return {
    name: 'story-cover-edits',
    configureServer(server) {
      server.middlewares.use('/api/cover-edits', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method === 'GET') {
          res.end(JSON.stringify({ edits: readEdits() }))
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', () => {
            try {
              const raw = JSON.parse(body || '{}')
              const id = Number(raw.id)
              console.log('[cover-edits] POST', id,
                raw.frame ? `frame=${raw.frame.name} t=${raw.frame.time}` : `h=${raw.h}`)
              if (!Number.isInteger(id) || id <= 0) throw new Error('invalid unit id')
              const edits = readEdits()

              // 动态 CG 抓帧：把 PNG dataURL 转成 3:4 封面（复用 build_story_covers.py
              // 的裁剪逻辑），写入 public/cover/，并把该封面文件名作为人工指定值。
              if (raw.frame) {
                const { dataUrl, name, time } = raw.frame
                if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
                  throw new Error('invalid frame data')
                }
                const safe = String(name || 'spine').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)
                const ms = Math.max(0, Math.round(Number(time) || 0))
                const key = `frame_${safe}_${ms}`
                const tmp = path.join(COVER_DIR, `_incoming_${id}.png`)
                const dst = path.join(COVER_DIR, `${key}.webp`)
                fs.mkdirSync(COVER_DIR, { recursive: true })
                fs.writeFileSync(tmp, Buffer.from(dataUrl.split(',')[1], 'base64'))
                const convert = (py: string) => execFile(
                  py, ['build/build_story_covers.py', '--frame', tmp, dst],
                  { cwd: PROJECT_ROOT, timeout: 60000 },
                  (err, stdout, stderr) => {
                    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
                    if (err && py === 'python') { convert('python3'); return }
                    if (err) {
                      res.statusCode = 500
                      res.end(JSON.stringify({ ok: false, error: (stderr || String(err)).slice(-800) }))
                      return
                    }
                    edits[String(id)] = key
                    const saved = writeEdits(edits)
                    // 让 build_story_covers.py 把该单元的 cover 字段指向新封面
                    regenerate(id, (ok2, out2) => {
                      if (!ok2) {
                        res.statusCode = 500
                        res.end(JSON.stringify({ ok: false, edits: saved, error: out2.slice(-800) }))
                        return
                      }
                      // 不在这里发 Vite full-reload：客户端保存成功后会自己 reload，
                      // 且会暂时放行 beforeunload，避免在「刷新站点?」弹窗里卡住。
                      res.end(JSON.stringify({ ok: true, edits: saved, cover: key }))
                    })
                  },
                )
                convert('python')
                return
              }

              if (raw.remove) {
                delete edits[String(id)]
              } else {
                const h = String(raw.h || '')
                if (!/^[0-9a-f]{16}$/i.test(h) && !/^[\w.-]+$/.test(h)) {
                  throw new Error('invalid cover hash')
                }
                const c = raw.crop
                const crop = c && typeof c === 'object'
                  ? {
                      cx: Math.min(1, Math.max(0, Number(c.cx ?? 0.5))),
                      cy: Math.min(1, Math.max(0, Number(c.cy ?? 0.5))),
                      zoom: Math.min(4, Math.max(1, Number(c.zoom ?? 1))),
                    }
                  : null
                edits[String(id)] = crop ? { h, crop } : h
              }
              const saved = writeEdits(edits)
              regenerate(id, (ok, out) => {
                if (!ok) {
                  res.statusCode = 500
                  res.end(JSON.stringify({ ok: false, edits: saved, error: out.slice(-800) }))
                  return
                }
                res.end(JSON.stringify({ ok: true, edits: saved }))
              })
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
 * 开发期专用：给剧情卡封面编辑后台导入「外部图片」（网络 URL / 本地文件）。
 * POST /api/cover-upload <- { url } 或 { dataUrl }，可带 { name }
 *   -> { ok, h, w, h2, name, src }
 * 原图存 public/cover_src/<h>.webp，尺寸写 public/data/cover_sources.json；
 * 之后和普通 CG 一样：在编辑器里裁剪，保存 {h, crop} 到 cg_cover_overrides.json。
 * 网络图由后端抓取，绕开浏览器跨域限制。生产构建不存在该接口。
 */
function coverUploadPlugin(): Plugin {
  const ensure = () => {
    fs.mkdirSync(COVER_SRC_DIR, { recursive: true })
    fs.mkdirSync(path.dirname(COVER_SOURCES_MANIFEST), { recursive: true })
    if (!fs.existsSync(COVER_SOURCES_MANIFEST)) {
      fs.writeFileSync(COVER_SOURCES_MANIFEST, '{}\n', 'utf-8')
    }
  }
  const readManifest = (): Record<string, { w: number; h: number; name: string }> => {
    try {
      return JSON.parse(fs.readFileSync(COVER_SOURCES_MANIFEST, 'utf-8'))
    } catch {
      return {}
    }
  }
  return {
    name: 'cover-upload',
    configResolved() {
      ensure()
    },
    configureServer(server) {
      server.middlewares.use('/api/cover-upload', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ ok: false, error: 'method not allowed' }))
          return
        }
        let body = ''
        let tooBig = false
        req.on('data', (c: Buffer) => {
          if (tooBig) return
          body += c.toString('utf-8')
          if (body.length > 32 * 1024 * 1024) {
            tooBig = true
            res.statusCode = 413
            res.end(JSON.stringify({ ok: false, error: '图片数据过大（上限 32MB）' }))
            req.destroy()
          }
        })
        req.on('end', () => {
          if (tooBig) return
          void (async () => {
            const raw = JSON.parse(body || '{}')
            let buf: Buffer
            const label = String(raw.name || '').trim() || '外部图片'
            if (typeof raw.url === 'string' && raw.url.trim()) {
              let u: URL
              try {
                u = new URL(raw.url.trim())
              } catch {
                throw new Error('URL 格式无效')
              }
              if (u.protocol !== 'http:' && u.protocol !== 'https:') {
                throw new Error('只支持 http/https 图片地址')
              }
              const r = await fetch(u, {
                headers: { 'User-Agent': 'Mozilla/5.0 (nikke-web cover studio)' },
                signal: AbortSignal.timeout(20000),
              })
              if (!r.ok) throw new Error(`下载失败：HTTP ${r.status}`)
              const ct = String(r.headers.get('content-type') || '')
              if (!/^image\/(png|jpe?g|webp|gif|bmp|x-ms-bmp)/i.test(ct)) {
                throw new Error(`地址返回的不是图片（Content-Type: ${ct || '未知'}）`)
              }
              buf = Buffer.from(await r.arrayBuffer())
            } else if (typeof raw.dataUrl === 'string' && raw.dataUrl.trim()) {
              const m = /^data:image\/(png|jpe?g|webp|gif|bmp|x-ms-bmp);base64,([\s\S]+)$/i
                .exec(raw.dataUrl.trim())
              if (!m) throw new Error('只支持 PNG / JPEG / WebP / GIF / BMP 图片')
              buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64')
            } else {
              throw new Error('请选择本地图片或填写网络图片地址')
            }
            if (!buf.length) throw new Error('图片内容为空')
            if (buf.length > 20 * 1024 * 1024) throw new Error('图片超过 20MB')

            const slug = label.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
              .replace(/^_+|_+$/g, '').slice(0, 24) || 'external'
            const key = `ext_${slug}_${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10)}`
            const tmp = path.join(COVER_SRC_DIR, `_upload_${process.pid}_${Date.now()}.img`)
            const dst = path.join(COVER_SRC_DIR, `${key}.webp`)
            fs.mkdirSync(COVER_SRC_DIR, { recursive: true })
            fs.writeFileSync(tmp, buf)
            const run = (py: string) => execFile(
              py, ['build/build_story_covers.py', '--save-src', tmp, dst],
              { cwd: PROJECT_ROOT, timeout: 60000 },
              (err, stdout, stderr) => {
                try { fs.unlinkSync(tmp) } catch { /* ignore */ }
                if (err && py === 'python') { run('python3'); return }
                if (err) {
                  res.statusCode = 500
                  res.end(JSON.stringify({ ok: false, error: (stderr || String(err)).slice(-800) }))
                  return
                }
                console.log('[cover-edits] frame converted ->', key, (stdout || '').trim())
                const dims = /(?:^|\s)(\d+)\s+(\d+)(?:\s|$)/.exec(stdout || '')
                if (!dims) {
                  res.statusCode = 500
                  res.end(JSON.stringify({ ok: false, error: `无法读取图片尺寸：${(stdout || '').slice(-300)}` }))
                  return
                }
                const w = Number(dims[1])
                const h = Number(dims[2])
                const manifest = readManifest()
                manifest[key] = { w, h, name: label }
                fs.writeFileSync(COVER_SOURCES_MANIFEST,
                  JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
                res.end(JSON.stringify({
                  ok: true, h: key, w, h2: h, name: label, src: `/cover_src/${key}.webp`,
                }))
              },
            )
            run('python')
          })().catch((e) => {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: String(e) }))
          })
        })
      })
    },
  }
}

/** FADING AFFECTION UI 编辑器：扫 public/fading_ui 的 PNG 生成素材清单，
    编辑器据此列出全部原版 UI 纹理（含原始像素尺寸，拖入画布时按原尺寸摆放）。 */
const FADING_UI_DIR = path.resolve(HERE, '../public/fading_ui')
const FADING_UI_MANIFEST = path.resolve(HERE, '../public/data/fading_ui_manifest.json')
/** 上游 export_fading_ui.py 导出的 Sprite 九宫格信息（border / rect / pivot） */
const FADING_SPRITES = path.resolve(HERE, '../build/fading_ui_sprites.json')
/** 只有「零 border 的无缝纹理」才按平铺处理。
 *  重要：marian_bg_paper / marian_bg_book / marian_deco_line_* 等都有非零 border，
 *  它们是九宫格（.9 图）素材，绝不能整张按网格平铺——四角和边缘必须保持原样。 */
const FADING_TILED = /^(marian_ptn_|marian_texture_|marian_grd_2px$|marian_divider_0[23]$|marian_mask_map$|marian_shadow_line$)/i
/** 编辑器「保存到项目」写这里，方便把拼好的布局入库；前端读取走 /api/fading-layout */
const FADING_LAYOUT = path.resolve(HERE, '../build/fading_ui_layout.json')
/** 上游 export_fading_ui_layout.py 导出的各界面 prefab 布局树（紧凑版，已剔除 inactive 变体）。
 *  build/ 入库，dev / build 前同步进 public/data/fading_prefabs/，前端按 /data/fading_prefabs/<screen>.json 取。 */
const FADING_PREFABS_SRC = path.resolve(HERE, '../build/fading_ui_layout')
const FADING_PREFABS_DST = path.resolve(HERE, '../public/data/fading_prefabs')

/** 只读 PNG 头 24 字节拿 IHDR 里的宽高，不引入图片解码依赖 */
function pngSize(file: string): { w: number; h: number } {
  try {
    const buf = Buffer.alloc(24)
    const fd = fs.openSync(file, 'r')
    try { fs.readSync(fd, buf, 0, 24, 0) } finally { fs.closeSync(fd) }
    if (buf.toString('ascii', 1, 4) !== 'PNG') return { w: 0, h: 0 }
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  } catch {
    return { w: 0, h: 0 }
  }
}

function writeFadingUiManifest() {
  let sprites: Record<string, { border?: number[]; rect?: number[]; pivot?: number[] }> = {}
  try {
    const raw = JSON.parse(fs.readFileSync(FADING_SPRITES, 'utf-8'))
    sprites = raw.items || {}
  } catch {
    console.warn('[fading-ui] 没有 Sprite 元数据，九宫格功能不可用（运行 export_fading_ui.py 生成）')
  }
  let items: Array<{ n: string; w: number; h: number; border?: number[]; tiled?: boolean }> = []
  try {
    items = fs.readdirSync(FADING_UI_DIR)
      .filter((f) => /\.png$/i.test(f) && !f.startsWith('.'))
      .sort((a, b) => a.localeCompare(b))
      .map((n) => {
        const key = n.replace(/\.png$/i, '')
        const sp = sprites[key]
        const border = sp?.border?.map(Number) || [0, 0, 0, 0]
        return {
          n, ...pngSize(path.join(FADING_UI_DIR, n)),
          border,
          // 双保险：有 border 的素材一律不标记平铺
          tiled: FADING_TILED.test(key) && border.every((v) => v === 0),
        }
      })
  } catch (e) {
    console.warn('[fading-ui] 扫描素材失败：', e)
  }
  fs.mkdirSync(path.dirname(FADING_UI_MANIFEST), { recursive: true })
  fs.writeFileSync(FADING_UI_MANIFEST,
    JSON.stringify({ count: items.length, items }, null, 2) + '\n', 'utf-8')
}

function fadingUiManifestPlugin(): Plugin {
  return {
    name: 'fading-ui-manifest',
    configResolved() { writeFadingUiManifest() },
    configureServer(server) {
      server.watcher.add(FADING_UI_DIR)
      server.watcher.add(FADING_SPRITES)
      const onAssetChange = (file: string) => {
        const abs = path.resolve(file)
        if (abs.startsWith(FADING_UI_DIR + path.sep) || abs === FADING_SPRITES) {
          writeFadingUiManifest()
          server.ws.send({ type: 'full-reload' })
        }
      }
      server.watcher.on('add', onAssetChange)
      server.watcher.on('unlink', onAssetChange)
      server.watcher.on('change', onAssetChange)
    },
  }
}

/** 把 build/fading_ui_layout/*.json（不含 .full.json）同步到 public/data/fading_prefabs/。
 *  与 site-files / spine-overrides 同款：build/ 入库、public/ 被 gitignore，
 *  dev 启动时与 build 前各同步一次，改了源文件即时刷新。 */
function fadingPrefabsPlugin(): Plugin {
  const sync = () => {
    try {
      if (!fs.existsSync(FADING_PREFABS_SRC)) return
      fs.mkdirSync(FADING_PREFABS_DST, { recursive: true })
      for (const f of fs.readdirSync(FADING_PREFABS_SRC)) {
        if (!f.endsWith('.json') || f.endsWith('.full.json')) continue
        fs.copyFileSync(path.join(FADING_PREFABS_SRC, f), path.join(FADING_PREFABS_DST, f))
      }
    } catch (e) {
      console.warn('[fading-prefabs] 同步失败：', e)
    }
  }
  return {
    name: 'fading-prefabs',
    configResolved() { sync() },
    configureServer(server) {
      if (!fs.existsSync(FADING_PREFABS_SRC)) return
      server.watcher.add(FADING_PREFABS_SRC)
      const onChange = (file: string) => {
        if (path.resolve(file).startsWith(FADING_PREFABS_SRC + path.sep)) {
          sync()
          server.ws.send({ type: 'full-reload' })
        }
      }
      server.watcher.on('change', onChange)
      server.watcher.on('add', onChange)
    },
  }
}

/** dev 接口：GET 读 build/fading_ui_layout.json，POST 全量写回。
    与 /cg/albums 等编辑后台同款，仅 dev 存在；布局本身入 build/ 库。 */
function fadingLayoutPlugin(): Plugin {
  return {
    name: 'fading-layout',
    configureServer(server) {
      server.middlewares.use('/api/fading-layout', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method === 'GET') {
          try {
            res.end(fs.readFileSync(FADING_LAYOUT, 'utf-8'))
          } catch {
            res.end(JSON.stringify({ ok: false, layout: null }))
          }
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', () => {
            try {
              const d = JSON.parse(body || '{}')
              if (!d.layout || typeof d.layout !== 'object') throw new Error('缺少 layout')
              fs.mkdirSync(path.dirname(FADING_LAYOUT), { recursive: true })
              fs.writeFileSync(FADING_LAYOUT,
                JSON.stringify(d.layout, null, 2) + '\n', 'utf-8')
              res.end(JSON.stringify({ ok: true, path: 'build/fading_ui_layout.json' }))
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
  plugins: [react(), cgFlagsPlugin(), cgMergesPlugin(), storyCoverEditsPlugin(), coverUploadPlugin(), spineOverridesPlugin(), siteFilesPlugin(), cleanDistAssets(), fadingUiManifestPlugin(), fadingPrefabsPlugin(), fadingLayoutPlugin()],
  // 数据和图片都在上一级 public/，直接拿来做静态目录。
  // 只改前端代码、不想重新拷 2.1G 素材时，用 VITE_NO_PUBLIC=1 只构建 assets。
  publicDir: process.env.VITE_NO_PUBLIC ? false : '../public',
  server: { port: 5273, host: true },
  // emptyOutDir 关掉，理由见上方 cleanDistAssets 注释
  build: { outDir: '../dist', emptyOutDir: false },
})
