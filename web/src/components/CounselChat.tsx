import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadCounselFlow, loadStoryUnit,
  type CharStoryRec, type CounselFlow, type StoryDetail,
} from '../data'

type LineKind = 'char' | 'player' | 'narr'

/**
 * 咨询查看器：对话流 + 选项分支。
 *
 * 行数据来自 /data/story 分片；分支结构来自 counsel_flow.json（引擎脚本表
 * AttractiveCounselDialogTable 的 next 指针）。渲染时从第 1 行沿指针游走：
 * 走到选项组就弹选项 UI——没选就不继续（和游戏一样必须做选择才能往下），
 * 选了哪支就只显示哪支的后续，汇合点两条路共用。
 * 没有分支数据的会话按顺序平铺全部行。
 */
export default function CounselChat({
  units,
  accent,
  avatar,
  charName,
}: {
  units: CharStoryRec[]
  accent: string
  avatar: string | null
  charName: string
}) {
  const [ui, setUi] = useState(0)
  const [si, setSi] = useState(0)
  const [detail, setDetail] = useState<StoryDetail | null>(null)
  const [flowMap, setFlowMap] = useState<Record<string, CounselFlow>>({})
  const [picks, setPicks] = useState<Record<string, number>>({})
  const feedRef = useRef<HTMLDivElement>(null)
  const firstMount = useRef(true)

  const unit = units[Math.min(ui, units.length - 1)]

  useEffect(() => { setSi(0) }, [unit.id])

  useEffect(() => {
    let alive = true
    setDetail(null)
    loadStoryUnit(unit.id)
      .then((d) => { if (alive) setDetail(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [unit.id])

  useEffect(() => {
    loadCounselFlow().then(setFlowMap).catch(() => {})
  }, [])

  /** 会话 = 有标题的段；sort≥9000 的杂段（皮肤误挂）不显示 */
  const sessions = useMemo(
    () => (detail ? detail.segments.filter((s) => s.t && s.l.length) : []),
    [detail],
  )
  const seg = sessions[Math.min(si, Math.max(0, sessions.length - 1))]
  const K = seg?.l.length ?? 0
  const flow = seg ? flowMap[seg.g] : undefined

  /** 当前会话内逐行的呈现类型 */
  const kinds = useMemo<LineKind[]>(() => {
    if (!seg) return []
    const hasMarks = seg.l.some((x) => x[1] === 'Choice' || x[1] === 'Self')
    return seg.l.map((ln, i) => {
      const [sp, spid] = ln
      if (i === K - 1 && !sp) return 'narr'
      if (spid === 'Self' || spid === 'Choice') return 'player'
      if (sp) return 'char'
      if (hasMarks) return 'char'
      return 'player'
    })
  }, [seg, K])

  const pickKeyOf = (startLine: number) => `${unit.id}:${si}:${startLine}`

  /** 沿分支流游走，得到要渲染的行/选项序列 */
  const rendered = useMemo(() => {
    if (!seg) return [] as Array<{ t: 'line'; n: number } | { t: 'choice'; grp: number[] }>
    const nextMap = flow?.next || {}
    const startMap = new Map((flow?.choices || []).map((c) => [c[0], c]))
    const step = (x: number): number | null => nextMap[x] ?? (x < K ? x + 1 : null)
    const out: Array<{ t: 'line'; n: number } | { t: 'choice'; grp: number[] }> = []
    let cur: number | null = 1
    let guard = 0
    while (cur && cur <= K && guard++ < 800) {
      const grp = startMap.get(cur)
      if (grp) {
        out.push({ t: 'choice', grp })
        const pk = picks[`${unit.id}:${si}:${cur}`]
        if (pk == null) break
        cur = step(grp[pk])
        continue
      }
      out.push({ t: 'line', n: cur })
      cur = step(cur)
    }
    return out
  }, [seg, flow, picks, unit.id, si, K])

  useEffect(() => {
    // 切会话/切咨询卷后回到对话开头。对话没有内部滚动，所以直接滚页面；
    // 首次挂载不跳，避免刚打开角色页就被拽到剧情区。
    if (firstMount.current) { firstMount.current = false; return }
    const el = feedRef.current
    if (!el) return
    const y = el.getBoundingClientRect().top + window.scrollY - 150
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
  }, [si, unit.id])

  const pickCount = units.length > 1
  const multi = sessions.length > 1

  return (
    <div className="counsel">
      {pickCount && (
        <div className="cc-units">
          {units.map((u, i) => (
            <button key={u.id} className={i === ui ? 'on' : ''} onClick={() => setUi(i)}>
              {u.t}
            </button>
          ))}
        </div>
      )}

      {multi && (
        <div className="cc-pills">
          {sessions.map((s, i) => (
            <button key={s.g} className={i === si ? 'on' : ''} onClick={() => setSi(i)}
              title={s.t}>
              {String(i + 1).padStart(2, '0')}
            </button>
          ))}
        </div>
      )}

      <div className="cc-feed" ref={feedRef}>
        {!detail && <div className="cc-loading">载入对话中…</div>}
        {detail && seg && rendered.map((it) => {
          if (it.t === 'choice') {
            const key = pickKeyOf(it.grp[0])
            const sel = picks[key]
            return (
              <div className="cc-choice" key={`c${it.grp[0]}`}>
                <span className="cc-choice-label">你的回答</span>
                {it.grp.map((ln, oi) => (
                  <button
                    key={ln}
                    className={sel === oi ? 'on' : ''}
                    style={sel === oi ? { borderColor: accent, color: accent } : undefined}
                    onClick={() => setPicks((p) => ({ ...p, [key]: oi }))}
                  >
                    <i />
                    <span>{seg.l[ln - 1][2]}</span>
                  </button>
                ))}
              </div>
            )
          }
          const n = it.n
          const [sp, , txt] = seg.l[n - 1]
          const kind = kinds[n - 1]
          if (kind === 'narr') return <div className="cc-narr" key={`n${n}`}>{txt}</div>
          if (kind === 'player') {
            return (
              <div className="cc-msg me" key={`p${n}`}>
                <div className="cc-bubble">
                  <span className="cc-name">指挥官</span>
                  <p>{txt}</p>
                </div>
              </div>
            )
          }
          // 头像只在角色连续发言的第一句显示
          const idx = rendered.findIndex((x) => x.t === 'line' && x.n === n)
          const prev = idx > 0 ? rendered[idx - 1] : null
          const prevIsChar = !!prev && prev.t === 'line' && kinds[prev.n - 1] === 'char'
          return (
            <div className="cc-msg" key={`m${n}`}>
              {!prevIsChar && (
                avatar
                  ? <span className="cc-ava"><img src={avatar} alt="" loading="lazy" /></span>
                  : <span className="cc-ava cc-ava-ph" aria-hidden>{(sp || charName).slice(0, 1)}</span>
              )}
              <div className="cc-bubble">
                <span className="cc-name" style={{ color: accent }}>{sp || charName}</span>
                <p>{txt}</p>
              </div>
            </div>
          )
        })}
        {detail && seg && rendered.length === 0 && (
          <div className="cc-loading">这个会话没有可显示的文本。</div>
        )}
      </div>

      {multi && (
        <div className="cc-foot">
          <button className="cc-nav" disabled={si <= 0} onClick={() => setSi((v) => Math.max(0, v - 1))}>
            ← 上一次
          </button>
          <span className="cc-pos">{si + 1} / {sessions.length}</span>
          <button
            className="cc-nav"
            disabled={si >= sessions.length - 1}
            onClick={() => setSi((v) => Math.min(sessions.length - 1, v + 1))}
          >
            下一次 →
          </button>
        </div>
      )}
    </div>
  )
}
