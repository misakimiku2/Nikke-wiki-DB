import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  accentFor, charImg, charThumb, EXPR_LABEL, loadCharHd, loadCharImages, loadCharMi,
  loadCharSpine, loadCharacters, mainBase, nf, tintFor, variantsOf,
  type CharImages, type Character,
} from '../data'
import ImageViewer from '../components/ImageViewer'
import SpinePlayer, { type SpineController, type SpineStatus } from '../components/SpinePlayer'

const EMPTY: SpineStatus = {
  ready: false, playing: true, time: 0, duration: 0, speed: 1, zoom: 1, anim: '', anims: [],
}
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

/**
 * 表情按钮只放这几个「主表情」，其余（surprise / pain / rage / *_02 …）收进下拉，
 * 否则 420px 的侧栏会被十几个按钮挤爆。每套模型不一定都齐，缺的自动跳过。
 */
const CHIP_DEFS: Array<{ re: RegExp; label: string }> = [
  { re: /^idle/, label: '待机' },
  { re: /^delight/, label: '开心' },
  { re: /^angry/, label: '生气' },
  { re: /^sad/, label: '悲伤' },
  { re: /^surp|^surpreise/, label: '惊讶' },
  { re: /^shy/, label: '害羞' },
  { re: /^think/, label: '思考' },
  { re: /^action|^battle/, label: '动作' },
]

function animLabel(a: string): string {
  if (EXPR_LABEL[a]) return EXPR_LABEL[a]
  const base = a.replace(/(?:_0?\d+|_alt|_blue)+$/, '')
  const tail = a.slice(base.length).replace(/^_/, '')
  const zh = EXPR_LABEL[base]
  if (zh) return tail ? `${zh} ${tail}` : zh
  if (a.startsWith('talk')) return '口型 ' + a.slice(5).toUpperCase()
  return a
}

function pickChips(anims: string[]): { label: string; anim: string }[] {
  const out: { label: string; anim: string }[] = []
  for (const d of CHIP_DEFS) {
    const hit = anims.find((a) => d.re.test(a))
    if (hit) out.push({ label: d.label, anim: hit })
  }
  return out
}

export default function CharacterDetail() {
  const { id } = useParams()
  const [list, setList] = useState<Character[] | null>(null)
  const [imgs, setImgs] = useState<CharImages>({})
  const [hd, setHd] = useState<Set<string>>(new Set())
  const [mi, setMi] = useState<Set<string>>(new Set())
  const [spine, setSpine] = useState<Set<string>>(new Set())
  const [pick, setPick] = useState<string | null>(null)
  const [status, setStatus] = useState<SpineStatus>(EMPTY)
  const [modelReady, setModelReady] = useState(false)
  /** 站姿模型解析失败（源数据缺图集区域的皮肤）时退回静态立绘，不留一个红字报错框 */
  const [modelError, setModelError] = useState(false)
  const spineRef = useRef<SpineController | null>(null)

  useEffect(() => {
    loadCharacters().then(setList).catch(() => setList([]))
    loadCharImages().then(setImgs).catch(() => {})
    loadCharHd().then(setHd).catch(() => {})
    loadCharMi().then(setMi).catch(() => {})
    loadCharSpine().then(setSpine).catch(() => {})
  }, [])

  useEffect(() => {
    setPick(null)
    setStatus(EMPTY)
    setModelReady(false)
    setModelError(false)
  }, [id])

  // 换皮肤时也要把状态归零，否则控制条会短暂显示上一套模型的表情与时长
  useEffect(() => {
    setStatus(EMPTY)
    setModelReady(false)
    setModelError(false)
  }, [pick])

  const c = list?.find((x) => String(x.id) === id) || null
  const vars = c ? variantsOf(imgs, c.id) : []
  const current = pick || (c ? mainBase(imgs, c.id) : null) || ''
  const staticSrc = current ? charImg(current, hd, 'full') : ''
  const hasModel = !!current && spine.has(current) && !modelError
  // 口型（talk_*）是配合台词的 0 时长姿态；bg_* 只驱动背景（有的模型里这两类
  // 动画根本没有可见部件，选中会只剩空舞台），都不列出来
  const anims = useMemo(
    () => status.anims.filter((a) => !a.startsWith('talk') && !a.startsWith('bg_')),
    [status.anims],
  )
  const chips = useMemo(() => pickChips(anims), [anims])
  const extras = useMemo(() => {
    const used = new Set(chips.map((c) => c.anim))
    return anims.filter((a) => !used.has(a))
  }, [anims, chips])
  const onChip = chips.some((c) => c.anim === status.anim)

  const toggle = useCallback(() => spineRef.current?.toggle(), [])
  const resetView = useCallback(() => spineRef.current?.resetView(), [])
  const saveFrame = useCallback(() => {
    spineRef.current?.saveFrame(`${current}_${status.anim}_${status.time.toFixed(2)}.png`)
  }, [current, status.anim, status.time])

  // 键盘：空格播放/暂停，R 复位取景（输入框/下拉聚焦时不抢键）
  useEffect(() => {
    if (!hasModel) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      const typing = t?.isContentEditable || tag === 'SELECT'
        || tag === 'TEXTAREA' || tag === 'INPUT'
      if (typing) return
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      else if (e.key === 'r' || e.key === 'R') resetView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasModel, toggle, resetView])

  if (!list) return <div className="loading">LOADING…</div>
  if (!c) return <div className="empty">CHARACTER NOT FOUND</div>

  const desc = (c.desc || '').split('\n').filter(Boolean)
  const palette = tintFor(c.id)

  return (
    <div className="detail-page">
      <div className="detail">
        <div className="detail-visual" style={{ ['--tint' as string]: palette }}>
          <div className={`stage char-stage ${hasModel ? 'is-live' : ''}`}>
            {/* 模型加载期间先铺静态立绘，避免大片空白；就绪后淡出 */}
            {hasModel && staticSrc && (
              <img
                className={`char-still ${modelReady ? 'gone' : ''}`}
                src={staticSrc}
                alt=""
                draggable={false}
              />
            )}
            {hasModel ? (
              <SpinePlayer
                name={current}
                dir="spine_char"
                controls={false}
                controllerRef={spineRef}
                onTick={setStatus}
                onReady={() => setModelReady(true)}
                onError={() => setModelError(true)}
              />
            ) : current ? (
              <ImageViewer
                key={current}
                src={staticSrc}
                alt={c.name}
                max={4}
                extra={(
                  <a
                    className="iv-btn"
                    href={staticSrc}
                    target="_blank"
                    rel="noreferrer"
                    title="在新标签页查看原图"
                  >↗</a>
                )}
              />
            ) : (
              <div className="char-empty-mark">{c.name.slice(0, 1)}</div>
            )}
            {hasModel && (
              <div className={`char-live ${modelReady ? 'on' : ''}`}>
                <i />{modelReady ? '实时模型' : '模型加载中'}
              </div>
            )}
          </div>

          {/* 实时模型控制条：表情 / 速度 / 取景 / 保存当前帧 */}
          {hasModel && (
            <div className="char-bar">
              <div className="char-anims">
                {chips.map((c2) => (
                  <button
                    key={c2.anim}
                    className={c2.anim === status.anim ? 'on' : ''}
                    onClick={() => spineRef.current?.setAnim(c2.anim)}
                    title={c2.anim}
                  >
                    {c2.label}
                  </button>
                ))}
                {extras.length > 0 && (
                  <select
                    className={`char-more ${onChip ? '' : 'on'}`}
                    value={onChip ? '' : status.anim}
                    onChange={(e) => e.target.value && spineRef.current?.setAnim(e.target.value)}
                    title="更多表情"
                  >
                    <option value="">更多表情</option>
                    {extras.map((a) => <option key={a} value={a}>{animLabel(a)}</option>)}
                  </select>
                )}
              </div>
              <div className="char-bar-row">
                <button className="cb-play" onClick={toggle} title="播放 / 暂停（空格）">
                  {status.playing ? '⏸' : '▶'}
                </button>
                <label className="cb-speed">
                  <select
                    value={status.speed}
                    onChange={(e) => spineRef.current?.setSpeed(Number(e.target.value))}
                  >
                    {SPEEDS.map((v) => <option key={v} value={v}>{v}×</option>)}
                  </select>
                </label>
                <span className="cb-spacer" />
                <button className="cb-btn" onClick={resetView} title="复位取景（双击画面也可以）">
                  ⟲ {status.zoom.toFixed(1)}×
                </button>
                <button className="cb-btn" onClick={saveFrame} title="保存当前帧为 PNG">⤓</button>
                <a className="cb-btn" href={staticSrc} target="_blank" rel="noreferrer" title="打开静态立绘原图">↗</a>
              </div>
            </div>
          )}

          {vars.length > 1 && (
            <div className="variants">
              {vars.map((v) => (
                <button
                  key={v}
                  className={v === current ? 'on' : ''}
                  onClick={() => setPick(v)}
                  title={spine.has(v) ? `${v} · 可动` : v}
                >
                  <img src={charThumb(v, mi, hd)} alt={v} loading="lazy" />
                  {spine.has(v) && <i className="vt-live" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="detail-info">
          <Link to="/characters" className="reader-back">← 角色列表</Link>

          <div className="detail-code" style={{ marginTop: 22 }}>{c.code}</div>
          <h1 className="detail-title">{c.name}</h1>
          <div className="detail-latin">{c.names.en || '—'}</div>

          {c.intro && <div className="detail-quote">「{c.intro}」</div>}

          <div className="detail-desc">
            {desc.length > 0 ? (
              desc.map((p, i) => <p key={i}>{p}</p>)
            ) : (
              <p style={{ color: 'var(--dim-2)' }}>暂未收录这个角色的介绍文本。</p>
            )}
            {c.descEn && <div className="en">{c.descEn}</div>}
          </div>

          <div className="spec">
            <div>
              <span>剧情台词</span>
              <b style={{ color: accentFor(c.id) }}>{c.lines > 0 ? nf(c.lines) : '—'}</b>
            </div>
            <div>
              <span>立绘</span>
              <b>{vars.length || '—'}</b>
            </div>
            <div>
              <span>声优</span>
              <b style={{ fontSize: 15 }}>{c.cv || '未收录'}</b>
            </div>
            <div>
              <span>GAME ID</span>
              <b className="mono" style={{ fontSize: 15 }}>{c.id}</b>
            </div>
            <div>
              <span>日文名</span>
              <b style={{ fontSize: 15 }}>{c.names.ja || '—'}</b>
            </div>
            <div>
              <span>韩文名</span>
              <b style={{ fontSize: 15 }}>{c.names.ko || '—'}</b>
            </div>
          </div>

          <div className="detail-slots">
            <div className={`slot ${hasModel ? 'on' : ''}`}>
              <span>动态立绘</span>
              <em>
                {hasModel
                  ? `${anims.length} 段表情动画`
                  : modelError ? '模型数据不完整，已退回静态立绘' : '这个皮肤没有站姿模型'}
              </em>
            </div>
            <div className="slot">
              <span>技能说明</span>
              <em>待接入</em>
            </div>
            <div className="slot">
              <span>好感剧情</span>
              <em>待接入</em>
            </div>
          </div>

          <Link to="/characters" className="backlink">← 返回角色列表</Link>
        </div>
      </div>
    </div>
  )
}
