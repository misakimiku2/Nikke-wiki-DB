import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PlayPauseIcon from './PlayPauseIcon'
import type { CharVoice, CharVoiceCat, CharVoiceData } from '../data'
import { useLang } from '../lang'
import { fmt, useUI, type UIKey } from '../ui'

/**
 * 角色语音区（国服中配 + 日配 + 国际服英配 / 韩配）。
 *
 * 每种语言是一条 OGG 雪碧图。播放不走 <audio> + currentTime：媒体元素的
 * currentTime 有更新粒度，seek 到片段起点时也可能落到后一个 Ogg 包，导致
 * 开头缺失或尾音被掐。这里用 Web Audio 解码整条雪碧图，再按
 * AudioBufferSourceNode.start(when, offset, duration) 片段播放，起止是
 * 采样级精确的。
 *
 * 中配来自国服池（版本较旧，可能缺条）；英/韩配来自国际服语言包，
 * 某条缺失时该语言模式下直接跳过，不回退到别的语言。
 */

type VoiceLang = 'zh' | 'ja' | 'en' | 'ko'
type Clip = { url: string; s: number; e: number; lang: VoiceLang }

const SHARED: {
  ctx: AudioContext | null
  cache: Map<string, AudioBuffer>
} = { ctx: null, cache: new Map() }

function getCtx(): AudioContext {
  if (!SHARED.ctx) {
    const Ctor = window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) throw new Error('当前浏览器不支持 Web Audio')
    SHARED.ctx = new Ctor()
  }
  return SHARED.ctx
}

function cacheBuffer(key: string, buf: AudioBuffer) {
  SHARED.cache.set(key, buf)
  // 一条雪碧图解码后可能有几十 MB，最多保留最近四张（中/日/英/韩）
  while (SHARED.cache.size > 4) {
    const first = SHARED.cache.keys().next().value
    if (first === undefined) break
    SHARED.cache.delete(first)
  }
}

const hasZhClip = (v: CharVoice) => v.zs != null && v.ze != null
const hasEnClip = (v: CharVoice) => v.es != null && v.ee != null && v.ee > v.es
const hasKoClip = (v: CharVoice) => v.ks != null && v.ke != null && v.ke > v.ks
// 登录语音（titlecall）部分角色只有中文音频（国服先配、国际服池无对应日语），
// 这类条目 s == e == 0，日配模式下不可播放，列表与计数都要跳过。
const hasJaClip = (v: CharVoice) => v.e > v.s

/** 配音页签固定短标签：与顶栏语言切换按钮同款字形（中 / JA / EN / KO），
 *  不随界面语言变化——点击只挪高亮，按钮文本永远不变 */
const VOICE_SHORT: Record<VoiceLang, string> = { zh: '中', ja: 'JA', en: 'EN', ko: 'KO' }

/** 语音类别名（cat.k）→ UI 词典 key；不在表里的类别回退数据自带的中文 */
const CAT_KEY: Record<string, UIKey> = {
  lobby: 'voice_cat_lobby', outpost: 'voice_cat_outpost', upgrade: 'voice_cat_upgrade',
  field: 'voice_cat_field', battle: 'voice_cat_battle', title: 'voice_cat_title',
}

export default function VoiceList({
  data,
  accent,
}: {
  data: CharVoiceData
  accent: string
}) {
  const { lang: contentLang } = useLang()
  const t = useUI()
  /** 类别 chip 显示名：按 cat.k 查 UI 词典，未知类别回退数据自带的中文 */
  const catLabel = (k: string, zh: string): string => {
    const key = CAT_KEY[k]
    return key ? t(key) : zh
  }
  // 国服先行角色（婴宁/画皮）：只有国服中文配音，主雪碧图 f 本身就是中文轨
  const zhOnly = !!data.zhOnly
  const hasZh = (!!data.fz && (data.zc ?? 0) > 0) || zhOnly
  const hasEn = !!data.fe && (data.ec ?? 0) > 0
  const hasKo = !!data.fk && (data.kc ?? 0) > 0
  const flatVoices = data.cats.flatMap((c) => c.v)
  const jaTotal = flatVoices.filter(hasJaClip).length
  const enTotal = data.ec ?? 0
  const koTotal = data.kc ?? 0
  const zhTotal = zhOnly ? flatVoices.filter(hasJaClip).length : (data.zc ?? 0)
  const [cat, setCat] = useState('all')
  const [lang, setLang] = useState<VoiceLang>(() => {
    if (contentLang === 'en' && hasEn) return 'en'
    if (contentLang === 'ko' && hasKo) return 'ko'
    if (contentLang === 'ja' && !zhOnly && jaTotal > 0) return 'ja'
    if (contentLang === 'zh' && hasZh) return 'zh'
    return zhOnly || !jaTotal ? 'zh' : 'ja'
  })
  const [active, setActive] = useState<CharVoice | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const buffers = useRef(new Map<string, AudioBuffer>())
  const promises = useRef(new Map<string, Promise<AudioBuffer | null>>())
  const startedAt = useRef(0)
  const startOffset = useRef(0)
  const pausedOffset = useRef<number | null>(null)
  const clipRef = useRef<Clip | null>(null)
  const playToken = useRef(0)
  const loadCount = useRef(0)

  const hasClip = (v: CharVoice, l: VoiceLang) =>
    l === 'zh' ? (zhOnly ? v.e > v.s : hasZhClip(v))
      : l === 'en' ? hasEnClip(v)
        : l === 'ko' ? hasKoClip(v)
          : hasJaClip(v)
  const missingVoices = flatVoices.filter((v) => !hasClip(v, 'zh'))
  const missingLove = missingVoices.filter((v) => /_Lobby_(?:Touch|Stay)_Love_/.test(v.id)).length
  const currentCv = zhOnly
    ? (data.cvz ?? data.cvj)
    : lang === 'zh' ? data.cvz
      : lang === 'en' ? data.cve
        : lang === 'ko' ? data.cvk
          : data.cvj

  // 皮肤筛选：g 有值的条目来自独立皮肤的语音套组。与类别同一行内单选：
  // 选皮肤时清空类别，选类别时清空皮肤。
  const skinOptions = useMemo(() => {
    const seen: string[] = []
    for (const c of data.cats) for (const v of c.v) if (v.g && !seen.includes(v.g)) seen.push(v.g)
    return seen
  }, [data])
  const [skin, setSkin] = useState<string | null>(null)

  const voices = useMemo(() => {
    const vis = (v: CharVoice) => hasClip(v, lang)
    if (skin) return flatVoices.filter((v) => vis(v) && v.g === skin)
    if (cat !== 'all') return (data.cats.find((c) => c.k === cat)?.v ?? []).filter(vis)
    return flatVoices.filter(vis)
  }, [data, cat, skin, lang, zhOnly])

  // 每个 chip 的计数 = 点击它之后会看到的条数
  const chipCount = (list: CharVoice[]) => list.filter((v) => hasClip(v, lang)).length
  const allCount = chipCount(flatVoices)
  const catChips = data.cats
    .map((c) => ({ k: c.k, n: c.n, count: chipCount(c.v) }))
    .filter((c) => c.count > 0)
  const skinChips = skinOptions
    .map((g) => ({ g, count: chipCount(flatVoices.filter((v) => v.g === g)) }))
    .filter((c) => c.count > 0)

  const clipOf = (v: CharVoice, l: VoiceLang): Clip => {
    if (l === 'zh') {
      if (data.fz && v.zs != null && v.ze != null) {
        return { url: data.fz, s: v.zs, e: v.ze, lang: 'zh' }
      }
      // 国服先行角色：主雪碧图 f 就是中文轨
      if (zhOnly) return { url: data.f, s: v.s, e: v.e, lang: 'zh' }
    }
    if (l === 'en' && data.fe && v.es != null && v.ee != null) {
      return { url: data.fe, s: v.es, e: v.ee, lang: 'en' }
    }
    if (l === 'ko' && data.fk && v.ks != null && v.ke != null) {
      return { url: data.fk, s: v.ks, e: v.ke, lang: 'ko' }
    }
    return { url: data.f, s: v.s, e: v.e, lang: l }
  }

  const stopSource = useCallback(() => {
    const s = sourceRef.current
    if (!s) return
    sourceRef.current = null
    s.onended = null
    try { s.stop() } catch { /* 已经停止 */ }
    try { s.disconnect() } catch { /* 已经断开 */ }
  }, [])

  const stop = useCallback(() => {
    playToken.current += 1
    stopSource()
    pausedOffset.current = null
    clipRef.current = null
    setPlaying(false)
    setActive(null)
    setPos(0)
  }, [stopSource])

  const loadBuffer = useCallback((url: string): Promise<AudioBuffer | null> => {
    const local = buffers.current.get(url)
    if (local) return Promise.resolve(local)
    const shared = SHARED.cache.get(url)
    if (shared) {
      buffers.current.set(url, shared)
      return Promise.resolve(shared)
    }
    const pending = promises.current.get(url)
    if (pending) return pending

    loadCount.current += 1
    setLoading(true)
    setError(false)
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.arrayBuffer()
      })
      .then((arr) => getCtx().decodeAudioData(arr))
      .then((buf) => {
        buffers.current.set(url, buf)
        cacheBuffer(url, buf)
        return buf
      })
      .catch(() => {
        promises.current.delete(url)
        setError(true)
        return null
      })
      .finally(() => {
        loadCount.current -= 1
        if (loadCount.current <= 0) setLoading(false)
      })
    promises.current.set(url, p)
    return p
  }, [])

  const playFrom = async (v: CharVoice, offset: number, clip: Clip) => {
    const token = ++playToken.current
    stopSource()
    clipRef.current = clip
    pausedOffset.current = null
    setActive(v)
    setPlaying(false)
    const span = Math.max(0.001, clip.e - clip.s)
    setPos(Math.max(0, Math.min(1, (offset - clip.s) / span)))

    const buffer = await loadBuffer(clip.url)
    if (token !== playToken.current) return
    if (!buffer) return

    const ctx = getCtx()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const from = Math.max(clip.s, Math.min(offset, clip.e - 0.001))
    const dur = Math.max(0.001, clip.e - from)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.onended = () => {
      if (sourceRef.current !== src) return
      sourceRef.current = null
      pausedOffset.current = clip.e
      setPlaying(false)
      setPos(1)
    }
    sourceRef.current = src
    startedAt.current = ctx.currentTime
    startOffset.current = from
    setPlaying(true)
    try {
      src.start(0, from, dur)
    } catch {
      sourceRef.current = null
      setPlaying(false)
    }
  }

  const toggle = (v: CharVoice) => {
    const ctx = getCtx()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const clip = clipRef.current && active?.id === v.id ? clipRef.current : clipOf(v, lang)
    if (active?.id === v.id) {
      if (playing) {
        const t = Math.min(clip.e, startOffset.current + (ctx.currentTime - startedAt.current))
        pausedOffset.current = t
        stopSource()
        setPlaying(false)
        setPos((t - clip.s) / Math.max(0.001, clip.e - clip.s))
      } else {
        const from = pausedOffset.current != null && pausedOffset.current < clip.e
          ? pausedOffset.current
          : clip.s
        playFrom(v, from, clip)
      }
      return
    }
    playFrom(v, clip.s, clip)
  }

  const changeLang = (l: VoiceLang) => {
    if (l === lang) return
    if (l === 'zh' && !hasZh) return
    if (l === 'ja' && (zhOnly || jaTotal <= 0)) return
    if (l === 'en' && !hasEn) return
    if (l === 'ko' && !hasKo) return
    stop()
    setCat('all')
    setLang(l)
  }

  // 顶部内容语言切换后，语音页签默认跟着切到同语言（不存在时留在原语言）
  useEffect(() => {
    const pref: VoiceLang | null = contentLang === 'en' && hasEn ? 'en'
      : contentLang === 'ko' && hasKo ? 'ko'
        : contentLang === 'ja' && !zhOnly && jaTotal > 0 ? 'ja'
          : contentLang === 'zh' && hasZh ? 'zh'
            : null
    if (!pref || pref === lang) return
    stop()
    setCat('all')
    setLang(pref)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentLang])

  useEffect(() => {
    const url = lang === 'zh'
      ? (data.fz || (zhOnly ? data.f : null))
      : lang === 'en' ? data.fe
        : lang === 'ko' ? data.fk
          : data.f
    if (url) loadBuffer(url)
    return () => {
      stopSource()
    }
  }, [lang, data.f, data.fz, data.fe, data.fk, zhOnly, loadBuffer, stopSource])

  useEffect(() => {
    if (!playing || !active || !clipRef.current) return
    const id = window.setInterval(() => {
      const clip = clipRef.current
      if (!clip) return
      const t = Math.min(clip.e, startOffset.current + (getCtx().currentTime - startedAt.current))
      const d = clip.e - clip.s
      setPos(d > 0 ? Math.max(0, Math.min(1, (t - clip.s) / d)) : 0)
    }, 100)
    return () => window.clearInterval(id)
  }, [playing, active])

  return (
    <div className="voice">
      <div className="voice-bar">
        <div className="voice-cats">
          <button
            className={cat === 'all' && !skin ? 'on' : ''}
            onClick={() => { setCat('all'); setSkin(null); stop() }}
          >
            {t('voice_all')} <b>{allCount}</b>
          </button>
          {catChips.map((c) => (
            <button
              key={c.k}
              className={!skin && cat === c.k ? 'on' : ''}
              onClick={() => { setCat(c.k); setSkin(null); stop() }}
            >
              {catLabel(c.k, c.n)} <b>{c.count}</b>
            </button>
          ))}
          {skinChips.map((s) => (
            <button
              key={s.g}
              className={skin === s.g ? 'on' : ''}
              onClick={() => { setSkin(s.g); setCat('all'); stop() }}
            >
              {s.g} <b>{s.count}</b>
            </button>
          ))}
        </div>
        <div className="voice-opts">
          <div className="voice-langs">
            <button
              className={lang === 'zh' ? 'on' : ''}
              disabled={!hasZh}
              onClick={() => changeLang('zh')}
              title={zhOnly ? t('voice_hint_zhonly')
                : hasZh ? fmt(t('voice_title_zh_count'), { n: zhTotal, t: data.n })
                  : t('voice_title_no_zh')}
            >
              {VOICE_SHORT.zh} <b>{zhTotal}</b>
            </button>
            {!zhOnly && jaTotal > 0 && (
              <button
                className={lang === 'ja' ? 'on' : ''}
                onClick={() => changeLang('ja')}
                title={t('voice_title_ja')}
              >
                {VOICE_SHORT.ja} <b>{jaTotal}</b>
              </button>
            )}
            {hasEn && (
              <button
                className={lang === 'en' ? 'on' : ''}
                onClick={() => changeLang('en')}
                title={t('voice_title_en')}
              >
                {VOICE_SHORT.en} <b>{enTotal}</b>
              </button>
            )}
            {hasKo && (
              <button
                className={lang === 'ko' ? 'on' : ''}
                onClick={() => changeLang('ko')}
                title={t('voice_title_ko')}
              >
                {VOICE_SHORT.ko} <b>{koTotal}</b>
              </button>
            )}
          </div>
        </div>
      </div>
      {currentCv && (
        <div className="voice-cv">
          {zhOnly ? '' : lang === 'zh' ? t('voice_zh')
            : lang === 'ja' ? t('voice_ja') : lang === 'en' ? t('voice_en') : t('voice_ko')} CV <b>{currentCv}</b>
        </div>
      )}
      {zhOnly && <div className="voice-hint">{t('voice_hint_zhonly')}</div>}
      {!hasZh && !zhOnly && <div className="voice-hint">{t('voice_hint_no_zh')}</div>}
      {lang === 'zh' && missingVoices.length > 0 && (
        <div className="voice-hint">
          {fmt(t('voice_hint_missing_zh'), {
            n: missingVoices.length,
            l: missingLove ? fmt(t('voice_hint_missing_love'), { n: missingLove }) : '',
          })}
        </div>
      )}
      {lang === 'en' && hasEn && enTotal < data.n && (
        <div className="voice-hint">{fmt(t('voice_hint_en_count'), { n: enTotal, t: data.n })}</div>
      )}
      {lang === 'ko' && hasKo && koTotal < data.n && (
        <div className="voice-hint">{fmt(t('voice_hint_ko_count'), { n: koTotal, t: data.n })}</div>
      )}
      {(loading || error) && (
        <div className={`voice-hint ${error ? 'err' : ''}`}>
          {error ? t('voice_err') : t('voice_decoding')}
        </div>
      )}

      <div className="voice-list">
        {voices.map((v) => {
          const on = active?.id === v.id
          const clip = clipOf(v, lang)
          const dur = clip.e - clip.s
          const txt = lang === 'zh' ? (v.xz || v.x)
            : lang === 'en' ? (v.xe || v.x)
              : lang === 'ko' ? (v.xk || v.x)
                : lang === 'ja' ? (v.j || v.x)
                  : v.x
          return (
            <div
              key={v.id}
              className={`voice-row ${on ? 'on' : ''}`}
              onClick={() => toggle(v)}
            >
              <button
                className="voice-play"
                style={on ? { color: accent, borderColor: accent } : undefined}
                aria-label={on && playing ? t('voice_pause') : t('voice_play')}
              >
                <PlayPauseIcon playing={on && playing} size="12" />
              </button>
              <div className="voice-main">
                <div className="voice-title">
                  {v.t}
                  {v.g && <span className="voice-skin">{v.g}</span>}
                </div>
                <div className="voice-text">
                  {txt || v.j || t('voice_no_text')}
                </div>
              </div>
              <span className="voice-time">{dur.toFixed(1)}s</span>
              {on && <i className="voice-progress" style={{ width: `${pos * 100}%` }} />}
            </div>
          )
        })}
        {voices.length === 0 && <div className="voice-empty">这个分类暂无语音。</div>}
      </div>
    </div>
  )
}
