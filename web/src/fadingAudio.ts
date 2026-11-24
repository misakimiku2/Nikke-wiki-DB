/** FADING AFFECTION 小游戏音频：一条循环 BGM + 环境音床 + 一次性 SFX / UI / 打字音。
 *  文件由 build/export_fading_audio.py 导出，清单在 /data/fading_audio.json。 */

export type FadingAudioItem = { f: string; dur: number; kind: string }
export type FadingAudioMap = Record<string, FadingAudioItem>

/** 用户音量（0~1），乘在下面的基准音量上：bgm = 音乐层 + 环境音床 + 主菜单曲，sfx = 音效 / UI / 打字音。 */
export type FadingAudioGains = { bgm: number; sfx: number }
export const DEFAULT_GAINS: FadingAudioGains = { bgm: 1, sfx: 1 }

let mapCache: FadingAudioMap | null = null

export async function loadFadingAudio(): Promise<FadingAudioMap> {
  if (mapCache) return mapCache
  const r = await fetch('/data/fading_audio.json', { cache: 'no-cache' })
  if (!r.ok) throw new Error(`fading_audio.json ${r.status}`)
  const loaded: FadingAudioMap = await r.json()
  mapCache = loaded
  return loaded
}

/** 各层音量：BGM 最亮，环境音压在下面当底，打字咔哒最轻（它会高频重复）。
 *  环境音六条床已在导出时用 loudnorm 拉到同一档，所以这里固定音量就够。 */
const VOL = { bgm: 0.75, ambient: 0.5, sfx: 0.85, ui: 0.8, typing: 0.45, write: 0.5 }
const FADE_OUT_MS = 380
const FADE_IN_MS = 900
/** 拖音量条时的跟随渐变：太长会追不上手指，太短会有咔哒声 */
const GAIN_RAMP_MS = 120
const TYPE_MIN_GAP_MS = 70
const WRITE_MIN_GAP_MS = 1200
const WRITE_CHANCE = 0.45

/** 浏览器在非用户手势后可能拒绝播放。一次性音（打字/按钮）就让它过去，
 *  下一次点击自然带上；循环层要挂到下一次手势上补播，
 *  否则刷新进主菜单时主菜单曲会一直不出声。 */
const waiting = new Set<HTMLAudioElement>()
let unlockBound = false

function tryPlay(el: HTMLAudioElement, hold = false) {
  el.play().catch(() => {
    if (!hold) return
    waiting.add(el)
    if (unlockBound) return
    unlockBound = true
    const go = () => {
      [...waiting].forEach((m) => { waiting.delete(m); tryPlay(m, true) })
    }
    document.addEventListener('pointerdown', go, { passive: true })
    document.addEventListener('keydown', go)
  })
}

/** 音量渐变。带 token：中途被重新启用（同一条循环曲又被要回来）时，
 *  旧的淡出循环必须停住，不然会把已经恢复播放的音床又拉回零。 */
function ramp(el: HTMLAudioElement, from: number, to: number, ms: number, done?: () => void) {
  const token = ((el as HTMLAudioElement & { __ramp?: number }).__ramp ?? 0) + 1
  ;(el as HTMLAudioElement & { __ramp?: number }).__ramp = token
  const t0 = performance.now()
  el.volume = from
  const step = (now: number) => {
    if ((el as HTMLAudioElement & { __ramp?: number }).__ramp !== token) return
    const k = Math.min(1, (now - t0) / ms)
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k))
    if (k < 1) requestAnimationFrame(step)
    else done?.()
  }
  requestAnimationFrame(step)
}

export class FadingAudio {
  private map: FadingAudioMap
  private bgmKey: string | null = null
  private bgm: HTMLAudioElement | null = null
  private ambKey: string | null = null
  private amb: HTMLAudioElement | null = null
  /** 主菜单曲，独立于剧情 BGM 层（见 setShell） */
  private menu: HTMLAudioElement | null = null
  /** 循环元素按 key 复用，见 loopLayer */
  private pool = new Map<string, HTMLAudioElement>()
  private lastType = 0
  private lastWrite = 0
  muted = false
  private gains: FadingAudioGains
  /** 主菜单曲当前该不该出声：音量条改动时要按这个状态重算，不能一律拉满 */
  private shellOn = false

  /** 静音与音量必须在构造时就能带进来：这个实例是在音频清单异步到货之后才 new 出来的，
   *  而静音 / 音量的 effect 在首屏就已经跑过一次（那时实例还不存在）。
   *  只靠 effect 同步的话，刷新后实例会以 muted=false、满音量出场——
   *  按钮显示静音、声音却是响的。 */
  constructor(map: FadingAudioMap, init?: { muted?: boolean; gains?: Partial<FadingAudioGains> }) {
    this.map = map
    this.muted = init?.muted ?? false
    this.gains = { ...DEFAULT_GAINS, ...init?.gains }
  }

  setMuted(v: boolean) {
    this.muted = v
    if (this.bgm) this.bgm.muted = v
    if (this.amb) this.amb.muted = v
    if (this.menu) this.menu.muted = v
    /* 池里的元素此刻是停的，但会带着 muted 状态被重新捞出来——
       统一刷一遍，免得半路停掉的曲子下次复用时是「没静音」的旧状态 */
    this.pool.forEach((el) => { el.muted = v })
  }

  /** 音量条：立刻作用到正在响的各层（只改音量，不动播放位置）。 */
  setGains(g: Partial<FadingAudioGains>) {
    this.gains = { ...this.gains, ...g }
    const bgmVol = VOL.bgm * this.gains.bgm
    if (this.bgm) ramp(this.bgm, this.bgm.volume, bgmVol, GAIN_RAMP_MS)
    if (this.amb) ramp(this.amb, this.amb.volume, VOL.ambient * this.gains.bgm, GAIN_RAMP_MS)
    if (this.menu) ramp(this.menu, this.menu.volume, this.shellOn ? bgmVol : 0, GAIN_RAMP_MS)
  }

  /** 循环层通用：换曲时旧的淡出、新的淡入；key 为空就停。
   *  每个 key 只保留一个元素（`pool`）：反复进主菜单/剧情、或开发模式下 React 严格模式
   *  会二次挂载同一个视图，不池化就会为同一首曲子建出好几个实例叠着播（音量翻倍）。 */
  private loopLayer(
    get: () => HTMLAudioElement | null,
    set: (el: HTMLAudioElement | null) => void,
    cur: string | null,
    key: string | null,
    vol: number,
  ) {
    const el = get()
    if (!key) {
      if (el) {
        const old = el
        set(null)
        ramp(old, old.volume, 0, FADE_OUT_MS, () => old.pause())
      }
      return
    }
    if (key === cur && el && !el.paused) return
    if (el && el !== this.pool.get(key)) {
      const old = el
      set(null)
      ramp(old, old.volume, 0, FADE_OUT_MS, () => old.pause())
    }
    let next = this.pool.get(key)
    if (!next) {
      next = new Audio(this.map[key].f)
      next.loop = true
      next.preload = 'auto'
      this.pool.set(key, next)
    }
    next.muted = this.muted
    set(next)
    tryPlay(next)
    ramp(next, 0, vol, el && el !== next ? FADE_IN_MS : 300)
  }

  /** BGM 层。key 为空就是停掉——「页面没写 bgm 时沿用上一首」这种继承关系由调用方
   *  按走过的路径算好再传进来，不能在这里靠“保持上一次播放”实现：往回走的时候
   *  上一次播放的可能是结局曲。 */
  playBgm(key: string | null) {
    const k = key && this.map[key] ? key : null
    this.loopLayer(() => this.bgm, (e) => { this.bgm = e }, this.bgmKey, k, VOL.bgm * this.gains.bgm)
    this.bgmKey = k
  }

  /** 环境音床：跟着地点走，换地点交叉淡入淡出（音量归在「音乐」一档，它本来就是背景底噪） */
  playAmbient(key: string | null) {
    if (key && !this.map[key]) key = null
    this.loopLayer(() => this.amb, (e) => { this.amb = e }, this.ambKey, key, VOL.ambient * this.gains.bgm)
    this.ambKey = key
  }

  /** 主菜单曲：只在主菜单有声。离开主菜单时只把音量拉到 0，绝不 pause——
   *  原作里这首的进度是一直在走的，所以回到主菜单是从当前位置接上（用户说的「中间段」），
   *  而不是每次从头重放。
   *  它不进 pool 独立持有：`event_bgm_maria-n_smile` 同时被 7 个正文页引用，
   *  和剧情层共用一个元素会被剧情那边的淡入淡出踩掉。 */
  setShell(key: string, on: boolean) {
    if (!this.map[key]) return
    this.shellOn = on
    if (!this.menu) {
      const el = new Audio(this.map[key].f)
      el.loop = true
      el.preload = 'auto'
      el.volume = 0
      el.muted = this.muted
      this.menu = el
      tryPlay(el, true)
    }
    ramp(this.menu, this.menu.volume, on ? VOL.bgm * this.gains.bgm : 0, on ? 700 : FADE_OUT_MS)
  }

  stopBgm() {
    this.loopLayer(() => this.bgm, (e) => { this.bgm = e }, this.bgmKey, null, VOL.bgm * this.gains.bgm)
    this.bgmKey = null
    this.loopLayer(() => this.amb, (e) => { this.amb = e }, this.ambKey, null, VOL.ambient * this.gains.bgm)
    this.ambKey = null
    if (this.menu) { this.menu.pause(); this.menu = null }
    this.shellOn = false
  }

  playSfx(key: string | null) { this.oneShot(key, VOL.sfx) }
  playUi(key: string | null) { this.oneShot(key, VOL.ui) }

  /** 逐字出现：主体是打字机咔哒（52ms 的极短单音，按 70ms 限频）；
   *  书写笔刷 uis_mini_fad_scenario_up 是另一回事——它 1.1s，只在文字出现时偶尔插一下。 */
  playTyping() {
    const now = performance.now()
    if (now - this.lastType >= TYPE_MIN_GAP_MS) {
      this.lastType = now
      this.oneShot('nv_textwriter', VOL.typing)
    }
    if (now - this.lastWrite >= WRITE_MIN_GAP_MS && Math.random() < WRITE_CHANCE) {
      this.lastWrite = now
      this.oneShot('uis_mini_fad_scenario_up', VOL.write)
    }
  }

  private oneShot(key: string | null, vol: number) {
    if (this.muted || !key) return
    const item = this.map[key]
    if (!item) return
    const el = new Audio(item.f)
    el.volume = Math.max(0, Math.min(1, vol * this.gains.sfx))
    tryPlay(el)
  }
}
