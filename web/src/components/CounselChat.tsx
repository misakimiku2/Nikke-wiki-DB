import { useEffect, useMemo, useRef, useState } from 'react'
import { loadStoryUnit, type CharStoryRec, type StoryDetail } from '../data'

type Line = [string, string, string]

type ChatItem =
  | { k: 'char'; who: string; text: string }
  | { k: 'player'; text: string }
  | { k: 'choice'; opts: string[]; key: string }
  | { k: 'narr'; text: string }

/**
 * 咨询台词分类。源数据有两种格式：
 *  A（大多数角色）：角色行带 speaker；指挥官的行是空 speaker——
 *     连续 ≥2 行 = 选项组，单独 1 行 = 指挥官的动作/台词，末行 = 旁白总结。
 *  B（女仆系）：角色行也是空 speaker；指挥官所有行都带 Choice / Self 标记，
 *     空行除末行外全是角色台词。
 */
function classify(lines: Line[]): ChatItem[] {
  const n = lines.length
  const hasMarks = lines.some((x) => x[1] === 'Choice' || x[1] === 'Self')
  const out: ChatItem[] = []
  let i = 0
  let ck = 0
  while (i < n) {
    const [sp, spid, txt] = lines[i]
    if (spid === 'Choice') {
      const opts: string[] = []
      const key = `c${ck++}`
      while (i < n && lines[i][1] === 'Choice') {
        opts.push(lines[i][2] || '')
        i++
      }
      out.push({ k: 'choice', opts, key })
      continue
    }
    if (spid === 'Self') {
      out.push({ k: 'player', text: txt || '' })
      i++
      continue
    }
    if (!sp) {
      if (i === n - 1) {
        out.push({ k: 'narr', text: txt || '' })
        i++
        continue
      }
      if (hasMarks) {
        out.push({ k: 'char', who: '', text: txt || '' })
        i++
        continue
      }
      // 格式 A：量一下空行游程（末行旁白不计入）
      let j = i
      while (j < n && !lines[j][0] && lines[j][1] !== 'Choice' && lines[j][1] !== 'Self') j++
      const runEnd = j >= n - 1 ? n - 1 : j
      if (runEnd - i >= 2) {
        out.push({ k: 'choice', opts: lines.slice(i, runEnd).map((x) => x[2] || ''), key: `c${ck++}` })
        i = runEnd
        continue
      }
      out.push({ k: 'player', text: txt || '' })
      i++
      continue
    }
    out.push({ k: 'char', who: sp, text: txt || '' })
    i++
  }
  return out
}

/**
 * 咨询查看器：会话选择 + 对话流。选项可点击标记（转写并存展示所有分支的后续文本，
 * 不做真分支裁剪——源数据里两个分支的后续是顺序连排的）。
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
  const [picks, setPicks] = useState<Record<string, number>>({})
  const feedRef = useRef<HTMLDivElement>(null)

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

  /** 会话 = 有标题的段；sort≥9000 的杂段（皮肤误挂）不显示 */
  const sessions = useMemo(
    () => (detail ? detail.segments.filter((s) => s.t && s.l.length) : []),
    [detail],
  )
  const seg = sessions[Math.min(si, Math.max(0, sessions.length - 1))]

  const items = useMemo(() => (seg ? classify(seg.l) : []), [seg])

  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0 })
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
        {detail && seg && (
          <>
            <div className="cc-seg-title">{seg.t}</div>
            {items.map((it, i) => {
              if (it.k === 'char') {
                // 连续角色发言只在最后一条带头像（聊天软件惯例），其余留空位对齐
                const nextIsChar = items[i + 1]?.k === 'char'
                return (
                  <div className="cc-msg" key={i}>
                    {avatar && !nextIsChar && <img className="cc-ava" src={avatar} alt="" loading="lazy" />}
                    <div className="cc-bubble">
                      <span className="cc-name" style={{ color: accent }}>
                        {it.who || charName}
                      </span>
                      <p>{it.text}</p>
                    </div>
                  </div>
                )
              }
              if (it.k === 'player') {
                return (
                  <div className="cc-msg me" key={i}>
                    <div className="cc-bubble">
                      <span className="cc-name">指挥官</span>
                      <p>{it.text}</p>
                    </div>
                  </div>
                )
              }
              if (it.k === 'choice') {
                const pickKey = `${unit.id}:${si}:${it.key}`
                const sel = picks[pickKey]
                return (
                  <div className="cc-choice" key={i}>
                    <span className="cc-choice-label">你的回答</span>
                    {it.opts.map((o, oi) => (
                      <button
                        key={oi}
                        className={sel === oi ? 'on' : ''}
                        style={sel === oi ? { borderColor: accent, color: accent } : undefined}
                        onClick={() => setPicks((p) => ({ ...p, [pickKey]: oi }))}
                      >
                        <i />
                        <span>{o}</span>
                      </button>
                    ))}
                  </div>
                )
              }
              return <div className="cc-narr" key={i}>{it.text}</div>
            })}
          </>
        )}
        {detail && (!seg || sessions.length === 0) && (
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
