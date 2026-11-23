/**
 * FADING AFFECTION — 冷寂 COLD SILENCE 双主题 UI
 * 纯展示组件：全部装饰由 CSS + 内联 SVG 绘制，唯一图片是原版黑白 CG。
 * 主题跟随站点 <html data-theme>（light = 灰白纸张，dark = 冷钢灰）。
 */
import type {
  FadingData, FadingRoute, FadingPage, FadingStatus, FadingCost, FadingChoice, FadingFirst, FadingMemory,
} from '../fadingData'
import { fadingCgSrc } from '../fadingData'
import './fading-cold.css'

/* ---------------- 内联 SVG 图标（stroke 用 currentColor，自动跟随主题） ---------------- */
type IconName = 'file' | 'target' | 'chip' | 'warn' | 'hp' | 'food' | 'erosion' | 'mem'
  | 'arrow' | 'lock' | 'star' | 'play' | 'refresh' | 'book' | 'close' | 'eye' | 'mappin' | 'back' | 'exit'

const PATHS: Record<IconName, React.ReactNode> = {
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M1 12h4M19 12h4" /></>,
  chip: <><rect x="5" y="5" width="14" height="14" rx="1" /><rect x="9" y="9" width="6" height="6" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  warn: <><path d="M12 3L2 20h20z" /><path d="M12 9v5M12 17h.01" /></>,
  hp: <path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10z" />,
  food: <><path d="M4 11h16l-1.5 9h-13z" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  erosion: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>,
  mem: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h5" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  lock: <><rect x="5" y="10" width="14" height="11" rx="1" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  star: <path d="M12 2l2.6 6.6L21 9.3l-5 4.4 1.5 6.6L12 17l-5.5 3.3L8 13.7l-5-4.4 6.4-.7z" />,
  play: <path d="M7 4l13 8-13 8z" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" />,
  book: <><path d="M4 5h7v15H4zM13 5h7v15h-7z" /><path d="M4 9h7M13 9h7" /></>,
  close: <><circle cx="12" cy="12" r="9" /><path d="M8 8l8 8M16 8l-8 8" /></>,
  eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></>,
  mappin: <><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z" fill="currentColor" stroke="none" /><circle cx="12" cy="9" r="2.6" fill="var(--fpanel,#fff)" stroke="none" /></>,
  back: <><path d="M11 6L5 12l6 6M18 6l-6 6 6 6" /></>,
  exit: <><path d="M14 4H5v16h9M11 12h9M17 8l4 4-4 4" /></>,
}
function I({ n, fill }: { n: IconName; fill?: boolean }) {
  return <svg className={fill ? 'ico ico-fill' : 'ico'} viewBox="0 0 24 24" aria-hidden="true">{PATHS[n]}</svg>
}
/** 原版 UI 纹理图标：CSS mask 染色，跟随 currentColor 自动适配深浅主题 */
function PNGIcon({ kind }: { kind: 'hp' | 'food' | 'erosion' | 'lock' | 'mem' | 'arrow' | 'hex' }) {
  return <span className={`icn-png ${kind}`} aria-hidden="true" />
}
const ROMAN = ['I', 'II', 'III', 'IV', 'V']

/** 地区标记在地图上的百分比坐标（按原版游戏截图标定） */
const REGION_POS: Record<string, { x: number; y: number }> = {
  '旧市区': { x: 19, y: 62 },
  '湖': { x: 41, y: 39 },
  '新市区': { x: 74, y: 30 },
}
const MAP_SRC = '/fading_icons/map_mono.png'

/** 开场地区选择：原版地图 + 可点标记 */
function RegionMap({ choices }: { choices: ColdChoice[] }) {
  return (
    <div className="cf-map">
      <div className="cf-map-frame">
        <img src={MAP_SRC} alt="地区地图" />
        <span className="cf-map-label">FIELD MAP / 旧市地区域</span>
        {choices.map((c) => {
          const pos = REGION_POS[c.text] ?? { x: 50, y: 50 }
          return (
            <button
              key={c.key}
              className={`cf-marker ${c.locked ? 'locked' : ''}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              disabled={c.locked}
              onClick={() => c.onClick()}
              title={c.text}
            >
              <span className="pin">{c.locked ? <I n="lock" /> : <I n="mappin" />}</span>
              <span className="tag">{c.locked ? '???' : c.text}</span>
              {c.locked && c.lockText && <span className="req">{c.lockText}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------- 组件 props ---------------- */
export type ColdView = 'home' | 'game' | 'endings' | 'memories'
export type ColdChoice = {
  key: string | number
  index: string
  text: string
  cost?: string
  hint?: string
  locked?: boolean
  lockText?: string
  checked?: boolean
  disabled?: boolean
  onClick: () => void
}
export type FadingColdProps = {
  data: FadingData
  view: ColdView
  route: FadingRoute | null
  pageText: string
  cgSrc: string | null
  cgAlt?: string
  isRegionSelect?: boolean
  status: FadingStatus
  statusMax: FadingStatus
  choices: ColdChoice[]
  ending: { title: string; hint: string } | null
  endingId: number | null
  memoryUnlocked: FadingMemory | null
  found: number[]
  endings: FadingPage[]
  memories: FadingMemory[]
  unlockedMemories: Set<string>
  onStart: (r: FadingRoute) => void
  onNavigate: (v: ColdView) => void
  onRestart: () => void
  onBack: () => void
  canBack: boolean
  onChoice: (c: ColdChoice) => void
  onClearSave: () => void
  onMemClick: () => void
  routeUnlocked: (r: FadingRoute) => boolean
}

/** 状态栏：体力/粮食上排，侵蚀长条下排，内存右下（原版布局） */
function StatusBar({ status, max, memCount, onMem }: { status: FadingStatus; max: FadingStatus; memCount: number; onMem: () => void }) {
  const eros = Math.round((status.erosion / max.erosion) * 100)
  return (
    <div className="sb sb-f">
      <div className="sb-row1">
        <div className="sb-stat"><span className="sb-lb"><I n="hp" /> 体力</span><b>{status.hp}/{max.hp}</b></div>
        <div className="sb-stat"><span className="sb-lb"><I n="food" /> 粮食</span><b>{status.food}/{max.food}</b></div>
      </div>
      <div className="sb-row2">
        <span className="sb-lb"><I n="erosion" /> 侵蚀</span>
        <div className="sb-track"><i style={{ width: `${eros}%` }} /></div>
        <span className="sb-pct">{eros}%</span>
      </div>
      <button className="sb-mem" onClick={onMem}>
        <span className="sb-mem-top"><I n="mem" /> 内存 <b>{memCount}</b></span>
        <small>MEMORY</small>
      </button>
    </div>
  )
}

/** 游戏内右上角导航：回退上一节点 / 返回主菜单（对应原版两枚图标按钮） */
function GameNav({ canBack, onBack, onHome }: { canBack: boolean; onBack: () => void; onHome: () => void }) {
  return (
    <div className="cf-gamenav">
      <button className="cf-navbtn" disabled={!canBack} onClick={onBack} title="返回上一节点"><I n="back" /></button>
      <button className="cf-navbtn" onClick={onHome} title="返回主菜单"><I n="exit" /></button>
    </div>
  )
}

export default function FadingCold(p: FadingColdProps) {
  const { data, view, route, pageText, cgSrc, cgAlt, status, statusMax, choices, ending,
    endingId, memoryUnlocked, found, endings, memories, unlockedMemories } = p

  const cg = (name?: string, key?: string) => {
    const src = fadingCgSrc(data, name)
    return src ? <figure className="cf-fig"><img key={key} src={src} alt={name || ''} /><figcaption><PNGIcon kind="hex" /> <I n="file" /> PLATE</figcaption></figure> : null
  }
  const endCg = (name?: string, key?: string) => {
    const src = fadingCgSrc(data, name)
    return src ? <figure className="cf-end-fig"><img key={key} src={src} alt={name || ''} /><figcaption><I n="file" /> PLATE FINAL</figcaption></figure> : null
  }

  /* ---------- 首页 / 路线 ---------- */
  if (view === 'home') {
    return (
      <div className="fad-cold-root">
        <div id="cf"><div className="stage"><div className="cf cf-fill">
          <div className="cf-frame"><div className="cf-inner cf-inner-fill">
            <div className="cf-home-head">
            <div className="cf-top">
              <span><I n="file" /> SILVERGUN PROJECT — ARCHIVE VOL. I</span>
              <span className="cf-top-right">
                <span className="cf-mark"><I n="target" /> MMXXVI</span>
                <button className="cf-clear" onClick={p.onClearSave} title="清除存档"><I n="refresh" /><span>清除存档</span></button>
              </span>
            </div>
            <div className="cf-hero">
              <div className="k"><I n="star" fill /> A RECORD OF FADING AFFECTION</div>
              <h1>FADING<em>Affection</em></h1>
              <div className="cf-rule"><i /></div>
              <div className="id"><I n="target" /> SUBJECT MARIA — {found.length ? 'RESTORED' : 'INITIALIZE'}</div>
            </div>
            </div>{/* /cf-home-head */}
            <div className="cf-home-body">
            <div className="cf-home-art" aria-hidden="true">{/* 预留：主视觉 CG 位（暂空） */}</div>
            <div className="cf-home-block">
            <p className="cf-lead">
              三段记录，三种人生。选择会消耗体力与粮食，死亡并非终点——
              留下的记忆是解锁新路线与新地点的钥匙。
            </p>
            <div className="cf-acts">
              <button className="cf-btn on"><I n="play" /> 开始记录</button>
              <button className="cf-btn" onClick={() => p.onNavigate('memories')}><I n="mem" /> 记忆 {unlockedMemories.size}/{data.memories.length}</button>
              <button className="cf-btn" onClick={() => p.onNavigate('endings')}><I n="book" /> 回想 {found.length}/{endings.length}</button>
            </div>
            <div className="cf-routes">
              {data.routes.map((r) => {
                const ok = p.routeUnlocked(r)
                const req = r.unlockRequirement
                return (
                  <div key={r.no} className={`cf-rc ${ok ? '' : 'lock'}`} onClick={() => ok && p.onStart(r)}
                    style={{ cursor: ok ? 'pointer' : 'not-allowed' }}>
                    {ok && r.no === 1 && <span className="icn-png new" style={{ position: 'absolute', top: -7, right: -7 }} aria-hidden="true" />}
                    <div className="ix">{ROMAN[r.no - 1] ?? r.no}</div>
                    <h4>{ok ? r.name : 'NO SIGNAL'}</h4>
                    <p>{ok ? r.desc : `观看【${req?.name ?? '前一条记录的结局'}】后解锁`}</p>
                    <div className="go">{ok ? <>OPEN <PNGIcon kind="arrow" /></> : <><PNGIcon kind="lock" /> LOCKED</>}</div>
                  </div>
                )
              })}
            </div>
            </div>{/* /cf-home-block */}
            </div>{/* /cf-home-body */}
          </div></div>
        </div></div></div>
      </div>
    )
  }

  /* ---------- 回想 / 记忆 ---------- */
  if (view === 'endings' || view === 'memories') {
    return (
      <div className="fad-cold-root">
        <div id="cf"><div className="stage"><div className="cf cf-fill">
          <div className="cf-frame"><div className="cf-inner cf-inner-fill">
            <div className="cf-doc-head">
              <button className="cf-back" onClick={() => p.onNavigate('home')}><I n="arrow" /> 返回路线选择</button>
              <div className="cf-list-head">
                <h2>{view === 'endings' ? '回想' : '记忆'}</h2>
                <small>{view === 'endings' ? `${found.length} / ${endings.length} ENDINGS` : `${unlockedMemories.size} / ${data.memories.length} MEMORIES`}</small>
              </div>
            </div>
            <div className="cf-list">
              {view === 'endings' ? (
                <div className="cf-grid">
                  {endings.map((ep) => {
                    const got = found.includes(ep.id)
                    const src = fadingCgSrc(data, ep.cg)
                    return (
                      <div key={ep.id} className={`cf-tile ${got ? '' : 'locked'}`}>
                        <div className="cf-tile-img">{got && src ? <img src={src} alt="" loading="lazy" /> : '?'}</div>
                        <div className="cf-tile-meta">
                          <div className="cf-tile-id">#{String(ep.id).slice(-4)}</div>
                          <div className="cf-tile-name">{got ? ep.ending?.title : '尚未收录的结局'}</div>
                          <div className="cf-tile-hint">{got ? ep.ending?.hint : '继续探索以解锁'}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <>
                  <p className="cf-lead" style={{ textAlign: 'left', margin: '0 0 16px' }}>
                    记录在 NIMPH 里的记忆，是开启新路线的钥匙。
                  </p>
                  <div className="cf-mgrid">
                    {memories.map((m) => {
                      const got = unlockedMemories.has(`${m.route}-${m.index}`)
                      return (
                        <div key={`${m.route}-${m.index}`} className={`cf-memo ${got ? '' : 'locked'}`}>
                          <div className="cf-memo-id">R{m.route} · {String(m.index).padStart(2, '0')}</div>
                          <div className="cf-memo-name">{got ? m.name : '未储存的记忆'}</div>
                          <div className="cf-memo-short">{got ? m.short : '???'}</div>
                          <div className="cf-memo-desc">{got ? m.desc : '在对应结局中死亡后解锁。'}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div></div>
        </div></div></div>
      </div>
    )
  }

  /* ---------- 剧情页 ---------- */
  const routeNo = route?.no ?? 1
  return (
    <div className="fad-cold-root">
      <div id="cf"><div className="stage"><div className="cf cf-fill">
        <div className="cf-frame"><div className="cf-inner cf-inner-fill">
          <div className="cf-bar">
            <span><I n="arrow" /> CHAPTER {ROMAN[routeNo - 1] ?? routeNo} · {routeNo === 3 ? 'NO.7' : 'MARIA'}</span>
            <span><I n="file" /> {route?.name || '记录'}</span>
            <span className="cf-bar-right">
              <b><I n="chip" /> MEM {unlockedMemories.size} / ARC {found.length}</b>
              <GameNav canBack={p.canBack} onBack={p.onBack} onHome={() => p.onNavigate('home')} />
            </span>
          </div>
          <div className="cf-game cf-game-fixed">
            <div className="cf-head">
              <div className="ix">{ROMAN[routeNo - 1] ?? routeNo}</div>
              <h3>{route?.name || '记录'}</h3>
              <div className="sub"><I n="target" /> SUBJECT {routeNo === 3 ? 'NO.7' : 'MARIA'} / {String(routeNo).padStart(3, '0')}</div>
            </div>
            <div className="cf-scroll">
            {p.isRegionSelect ? (
              <>
                <RegionMap choices={choices} />
                <p className="cf-map-hint">在地图上选择要前往的地区</p>
                <div className="cf-script">{pageText}</div>
              </>
            ) : (
              <>
                {cg(cgAlt || undefined, cgSrc || undefined)}
                <div className="cf-script">{pageText}</div>
              </>
            )}
            <div className="cf-opts" style={p.isRegionSelect ? { display: 'none' } : undefined}>
              {choices.map((c) => (
                <button key={c.key} className="cf-opt" disabled={c.disabled} onClick={() => p.onChoice(c)}>
                  <span className="ix">{c.index}</span>
                  <span className="tx">
                    {c.locked ? '???' : c.text}
                    {c.hint && !c.locked && <span className="cf-hint"><I n="eye" /> {c.hint}</span>}
                    {c.locked && c.lockText && <span className="cf-hint cf-hint-locked"><I n="lock" /> {c.lockText}</span>}
                  </span>
                  {c.cost && <span className="cost"><I n="warn" /> {c.cost}</span>}
                  <span className="arrow"><I n="arrow" /></span>
                </button>
              ))}
              {ending && (
                <div style={{ textAlign: 'center', marginTop: 18 }}>
                  <div className="k" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, font: '500 9px/1 ui-monospace,monospace', letterSpacing: '.3em', color: 'var(--fred)' }}>
                    <I n="close" /> RECORD CLOSED · #{endingId}
                  </div>
                  <h3 style={{ margin: '18px 0 14px', font: '800 34px/1 "Arial Black",Helvetica,sans-serif', color: 'var(--fink)' }}>{ending.title}</h3>
                  <p style={{ margin: '0 auto', maxWidth: 470, fontSize: 12, lineHeight: 2.1, color: 'var(--fmut)' }}>{ending.hint}</p>
                  {memoryUnlocked && (
                    <div className="unlock" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '20px 0', padding: '9px 16px', border: '1px solid var(--fline)', color: 'var(--fsteel)', fontSize: 12 }}>
                      <I n="mem" /> 解锁记忆：{memoryUnlocked.name}
                    </div>
                  )}
                  <div className="acts" style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                    <button className="cf-btn on" onClick={p.onRestart}><I n="refresh" /> 重新记录</button>
                    <button className="cf-btn" onClick={() => p.onNavigate('endings')}><I n="book" /> 回想</button>
                  </div>
                </div>
              )}
            </div>
            </div>{/* /cf-scroll */}
            <StatusBar status={status} max={statusMax} memCount={unlockedMemories.size} onMem={p.onMemClick} />
          </div>
        </div></div>
      </div></div></div>
    </div>
  )
}
