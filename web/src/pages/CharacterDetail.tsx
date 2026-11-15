import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  accentFor, artLabel, charArt, charThumb, EXPR_LABEL, loadCharArt, loadCharImages, loadCharMi,
  loadCharSkills, loadCharStories, loadCharSpine, loadCharacters, mainBase, nf, tintFor, variantsOf,
  type CharArtMap, type CharImages, type Character, type CharSkill, type CharSkillsData, type CharStoriesData,
} from '../data'
import CounselChat from '../components/CounselChat'
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

/** 与 CG 查看器一致的时间显示：0:05.3 */
function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00.0'
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}

/** 技能描述：把 {description_value_NN} 按当前等级的数值表填充，数值用主题色标出 */
/** 描述分词：{description_value_NN} 按等级填充；<word_group=NN>词条</word_group> 渲染成可点击名词 */
function SkillRow({ skill, lv, accent, onWord }: {
  skill: CharSkill; lv: number; accent: string
  onWord: (gid: number, term: string) => void
}) {
  const idx = Math.min(Math.max(lv, 1), Math.max(1, skill.levels)) - 1
  const vals = skill.values[idx] || []
  const nodes: ReactNode[] = []
  const re = /\{description_value_(\d+)\}|<word_group=(\d+)>([\s\S]*?)<\/word_group>/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(skill.desc))) {
    if (m.index > last) nodes.push(<span key={key++}>{skill.desc.slice(last, m.index)}</span>)
    if (m[1]) {
      nodes.push(
        <b key={key++} className="skill-val" style={{ color: accent }}>
          {vals[Number(m[1]) - 1] ?? '—'}
        </b>,
      )
    } else {
      const gid = Number(m[2])
      const term = m[3] || ''
      nodes.push(
        <button key={key++} className="word-ref" style={{ color: accent }}
          onClick={() => onWord(gid, term)} title="查看技能资讯">
          {term}
        </button>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < skill.desc.length) nodes.push(<span key={key++}>{skill.desc.slice(last)}</span>)
  return (
    <div className="skill">
      {skill.icon ? (
        <img
          className="skill-icon"
          src={`/skillicon/${skill.icon}.webp`}
          alt=""
          loading="lazy"
          draggable={false}
        />
      ) : (
        <span className="skill-icon skill-icon-ph" aria-hidden />
      )}
      <div className="skill-main">
        <div className="skill-name">
          <em className="skill-kind">{skill.kind || '技能'}</em>
          <b>{skill.name}</b>
          <span className="skill-lv">Lv.{Math.min(Math.max(lv, 1), Math.max(1, skill.levels))}</span>
        </div>
        {skill.desc && <div className="skill-desc">{nodes}</div>}
      </div>
    </div>
  )
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
  const [mi, setMi] = useState<Set<string>>(new Set())
  const [spine, setSpine] = useState<Set<string>>(new Set())
  const [pick, setPick] = useState<string | null>(null)
  const [status, setStatus] = useState<SpineStatus>(EMPTY)
  const [modelReady, setModelReady] = useState(false)
  /** 站姿模型解析失败（源数据缺图集区域的皮肤）时退回静态立绘，不留一个红字报错框 */
  const [modelError, setModelError] = useState(false)
  const [skillData, setSkillData] = useState<CharSkillsData>({ items: {}, terms: {} })
  const [skillLv, setSkillLv] = useState(10)
  const [storiesMap, setStoriesMap] = useState<CharStoriesData>({})
  const [art, setArt] = useState<CharArtMap>({})
  const [relTab, setRelTab] = useState<'stories' | 'counsel'>('stories')
  const [termPopup, setTermPopup] = useState<{ gid: number; term: string } | null>(null)
  const spineRef = useRef<SpineController | null>(null)
  /** 拖时间轴时先暂停，松手后按拖前的状态继续（与 CG 查看器同一套交互） */
  const wasPlaying = useRef(false)
  const seeking = useRef(false)

  useEffect(() => {
    loadCharacters().then(setList).catch(() => setList([]))
    loadCharImages().then(setImgs).catch(() => {})
    loadCharMi().then(setMi).catch(() => {})
    loadCharSpine().then(setSpine).catch(() => {})
    loadCharSkills().then(setSkillData).catch(() => {})
    loadCharStories().then(setStoriesMap).catch(() => {})
    loadCharArt().then(setArt).catch(() => {})
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
  // 旧版立绘（例如 c010_01 Rapi_old）不是当前皮肤，混在切换条里会让人以为是错图
  const vars = (c ? variantsOf(imgs, c.id) : []).filter((v) => !art[v]?.old)
  const current = pick || (c ? mainBase(imgs, c.id) : null) || ''
  const artName = current ? artLabel(art, current) : ''
  const currentLabel = !artName ? '' : (c && !artName.startsWith(c.name) ? `${c.name} · ${artName}` : artName)
  const staticSrc = current ? charArt(current) : ''
  const hasModel = !!current && spine.has(current) && !modelError
  const skills = id ? skillData.items[String(id)] : null
  const rel = id ? storiesMap[String(id)] : null
  const relStories = rel?.stories ?? []
  const relCounsel = rel?.counsel ?? []
  /** 切角色时把 tab 复位到有内容的那一边 */
  useEffect(() => {
    setRelTab((t) => (t === 'counsel' && !relCounsel.length ? 'stories' : t))
  }, [id])
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
  /** 时间轴已播放段的填充比例，写入 --cv-pct 给滑块画进度 */
  const pct = status.duration > 0
    ? Math.max(0, Math.min(100, status.time / status.duration * 100)) : 0

  const toggle = useCallback(() => spineRef.current?.toggle(), [])
  const resetView = useCallback(() => spineRef.current?.resetView(), [])
  const saveFrame = useCallback(() => {
    spineRef.current?.saveFrame(`${current}_${status.anim}_${status.time.toFixed(2)}.png`)
  }, [current, status.anim, status.time])

  // ---- 时间轴（与 CG 查看器同一套交互：拖动时暂停、松手续播、交还焦点）----
  const canSeek = hasModel && modelReady && status.duration > 0
  const onSeekStart = () => {
    if (!canSeek) return
    wasPlaying.current = status.playing
    seeking.current = true
    spineRef.current?.pause()
  }
  const onSeekEnd = () => {
    if (!seeking.current) return
    seeking.current = false
    if (wasPlaying.current) spineRef.current?.play()
    // 焦点留在滑块上会让空格被浏览器吃掉，还会画出 focus 外框，拖完就 blur
    if (document.activeElement instanceof HTMLInputElement
      && document.activeElement.type === 'range') document.activeElement.blur()
  }
  const onSeek = (v: number) => {
    setStatus((s) => ({ ...s, time: v }))
    spineRef.current?.seek(v)
  }

  // 键盘：空格播放/暂停，R 复位取景。只排除文本类输入；type=range 必须放行，
  // 否则拖过时间轴后焦点留在滑块上，空格播放/暂停会失效
  useEffect(() => {
    if (!hasModel) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      const typing = t?.isContentEditable || tag === 'SELECT'
        || tag === 'TEXTAREA'
        || (tag === 'INPUT' && (t as HTMLInputElement).type !== 'range')
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
      {termPopup && (
        <div className="word-modal" onClick={() => setTermPopup(null)}>
          <div className="word-card" onClick={(e) => e.stopPropagation()}>
            <button className="word-close" onClick={() => setTermPopup(null)} aria-label="关闭">×</button>
            <div className="word-title">关于【{termPopup.term}】</div>
            {(skillData.terms[termPopup.gid] || []).map((line, i) => (
              <div className="word-line" key={i}><i>◇</i><span>{line}</span></div>
            ))}
            {(skillData.terms[termPopup.gid] || []).length === 0 && (
              <div className="word-line"><i>◇</i><span>暂无这个词组的解释文本。</span></div>
            )}
          </div>
        </div>
      )}
      <div className="detail">
        <div className="detail-visual" style={{ ['--tint' as string]: palette }}>
          {/* 模型就绪前不铺旧静态图：那帧的姿势/取景和实时模型对不上，看着像渲染错误 */}
          <div className={`stage char-stage ${hasModel ? 'is-live' : ''} ${modelReady ? 'is-ready' : ''}`}>
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
            {hasModel && !modelReady && (
              <div className="char-loading"><span className="cv-spin" />加载实时模型…</div>
            )}
            {hasModel && (
              <div className={`char-live ${modelReady ? 'on' : ''}`}>
                <i />{modelReady ? '实时模型' : '模型加载中'}
              </div>
            )}
          </div>

          {/* 皮肤切换条：骑在舞台下缘，皮肤名并入条内落渐变实色区，
              下沿直接衔接按钮区、中间不留独立行 */}
          {vars.length > 1 && (
            <div className="variants">
              {vars.map((v) => {
                const label = artLabel(art, v)
                return (
                  <button
                    key={v}
                    className={v === current ? 'on' : ''}
                    onClick={() => setPick(v)}
                    title={spine.has(v) ? `${label} · 可动` : label}
                  >
                    <img src={charThumb(v, mi)} alt={label} loading="lazy" />
                    {spine.has(v) && <i className="vt-live" />}
                  </button>
                )
              })}
              <div className="variant-caption">{currentLabel}</div>
            </div>
          )}

          {/* 实时模型控制条：表情 / 时间轴 / 速度 / 取景 / 保存当前帧 */}
          {hasModel && (
            <div className="char-bar">
              <div className="char-anims">
                {chips.length === 0 && <span className="char-anims-hint">表情动画载入中…</span>}
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
              <div className="char-timeline">
                <span className="cv-time">{fmtTime(status.time)}</span>
                <input
                  className="cv-seek"
                  type="range"
                  min={0}
                  max={status.duration || 1}
                  step={0.01}
                  value={Math.min(status.time, status.duration || 1)}
                  disabled={!canSeek}
                  style={{ '--cv-pct': `${pct}%` } as CSSProperties}
                  onPointerDown={onSeekStart}
                  onPointerUp={onSeekEnd}
                  onPointerCancel={onSeekEnd}
                  onBlur={onSeekEnd}
                  onChange={(e) => onSeek(Number(e.target.value))}
                  aria-label="动画时间轴"
                />
                <span className="cv-time dim">{fmtTime(status.duration)}</span>
              </div>
              <div className="char-bar-row">
                <button className="cb-play" onClick={toggle} disabled={!modelReady} title="播放 / 暂停（空格）">
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

          {skills && skills.length > 0 && (
            <section className="skillbox" style={{ ['--acc' as string]: accentFor(c.id) }}>
              <div className="skillbox-head">
                <span className="skillbox-title">技能说明 <i>SKILLS</i></span>
                <label className="skill-lv">
                  等级
                  <select value={skillLv} onChange={(e) => setSkillLv(Number(e.target.value))}>
                    {Array.from({ length: Math.max(...skills.map((s) => s.levels), 1) },
                      (_, k) => k + 1).map((lv) => (
                        <option key={lv} value={lv}>Lv.{lv}</option>
                      ))}
                  </select>
                </label>
              </div>
              {skills.map((sk) => (
                <SkillRow key={sk.sid} skill={sk} lv={skillLv} accent={accentFor(c.id)}
                  onWord={(gid, term) => setTermPopup({ gid, term })} />
              ))}
            </section>
          )}

          <div className="detail-slots">
            <div className={`slot ${hasModel ? 'on' : ''}`}>
              <span>动态立绘</span>
              <em>
                {hasModel
                  ? (modelReady ? `${anims.length} 段表情动画` : '读取模型中…')
                  : modelError ? '模型数据不完整，已退回静态立绘' : '这个皮肤没有站姿模型'}
              </em>
            </div>
            {(relStories.length > 0 || relCounsel.length > 0) && (
              <button
                className="slot slot-btn"
                onClick={() => {
                  document.getElementById('storybox')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                title="跳到好感剧情"
              >
                <span>好感剧情</span>
                <em>
                  {[
                    relStories.length ? `${relStories.length} 卷剧情` : '',
                    relCounsel.length ? `${relCounsel.reduce((a, x) => a + (x.sessions || 0), 0)} 次咨询` : '',
                  ].filter(Boolean).join(' · ') || '暂无收录'}
                </em>
              </button>
            )}
          </div>

          {(relStories.length > 0 || relCounsel.length > 0) && (
            <section className="storybox" id="storybox" style={{ ['--acc' as string]: accentFor(c.id) }}>
              <div className="storybox-head">
                <span className="storybox-title">好感剧情 <i>STORIES</i></span>
                <div className="story-tabs">
                  {relStories.length > 0 && (
                    <button className={relTab === 'stories' ? 'on' : ''} onClick={() => setRelTab('stories')}>
                      个人剧情 <b>{relStories.length}</b>
                    </button>
                  )}
                  {relCounsel.length > 0 && (
                    <button className={relTab === 'counsel' ? 'on' : ''} onClick={() => setRelTab('counsel')}>
                      咨询 <b>{relCounsel.reduce((a, x) => a + (x.sessions || 0), 0)}</b>
                    </button>
                  )}
                </div>
              </div>

              {relTab === 'stories' ? (
                <div className="story-blocks">
                  {relStories.map((r) => (
                    <div key={r.id} className="story-block">
                      {/* 只有多卷时才需要卷名分隔；单卷直接平铺章节 */}
                      {relStories.length > 1 && (
                        <div className="story-block-label"><b>{r.t}</b></div>
                      )}
                      <div className="story-eps">
                        {(r.chapters ?? []).map((ch, ci) => (
                          <Link key={ci} to={`/story/${r.id}?ch=${ci}`} className="story-ep">
                            <span className="story-ep-no">{String(ci + 1).padStart(2, '0')}</span>
                            <span className="story-ep-name">{ch.t}</span>
                            <span className="story-ep-meta">{nf(ch.n)} 句</span>
                            <span className="story-ep-go">→</span>
                          </Link>
                        ))}
                        {!r.chapters?.length && (
                          <Link to={`/story/${r.id}`} className="story-ep">
                            <span className="story-ep-no">01</span>
                            <span className="story-ep-name">阅读全文</span>
                            <span className="story-ep-meta">{nf(r.lines)} 句</span>
                            <span className="story-ep-go">→</span>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <CounselChat
                  units={relCounsel}
                  accent={accentFor(c.id)}
                  avatar={(() => {
                    const base = mainBase(imgs, c.id)
                    return base && mi.has(base) ? `/charmi/${base}.webp` : null
                  })()}
                  charName={c.name}
                />
              )}
            </section>
          )}

          <Link to="/characters" className="backlink">← 返回角色列表</Link>
        </div>
      </div>
    </div>
  )
}
