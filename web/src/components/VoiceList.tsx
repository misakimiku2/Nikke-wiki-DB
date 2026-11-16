import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CharVoice, CharVoiceData } from '../data'

/**
 * 角色语音区（日配 + 国服中配）。
 *
 * 每种语言是一条 OGG 雪碧图。播放不走 <audio> + currentTime：媒体元素的
 * currentTime 有更新粒度，seek 到片段起点时也可能落到后一个 Ogg 包，导致
 * 开头缺失或尾音被掐。这里用 Web Audio 解码整条雪碧图，再按
 * AudioBufferSourceNode.start(when, offset, duration) 片段播放，起止是
 * 采样级精确的。
 *
 * 国服版本落后，中文语音是可选的：某条没有中文时回退日语，并标出「中配缺失」；
 * 整个角色没有中文时只显示日配，并给出提示。
 */

type Clip = { url: string; s: number; e: number; zh: boolean }

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
  // 一条雪碧图解码后可能有几十 MB，只保留最近两个（通常就是中日两张）
  while (SHARED.cache.size > 2) {
    const first = SHARED.cache.keys().next().value
    if (first === undefined) break
    SHARED.cache.delete(first)
  }
}

export default function VoiceList({
  data,
  accent,
}: {
  data: CharVoiceData
  accent: string
}) {
  const hasZh = !!data.fz && (data.zc ?? 0) > 0
  const [cat, setCat] = useState('all')
  const [showJa, setShowJa] = useState(false)
  const [lang, setLang] = useState<'zh' | 'ja'>(hasZh ? 'zh' : 'ja')
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

  const voices = useMemo(() => {
    if (cat === 'all') return data.cats.flatMap((c) => c.v)
    return data.cats.find((c) => c.k === cat)?.v ?? []
  }, [data, cat])

  const clipOf = (v: CharVoice, l: 'zh' | 'ja'): Clip => {
    if (l === 'zh' && data.fz && v.zs != null && v.ze != null) {
      return { url: data.fz, s: v.zs, e: v.ze, zh: true }
    }
    return { url: data.f, s: v.s, e: v.e, zh: false }
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

  const changeLang = (l: 'zh' | 'ja') => {
    if (l === lang) return
    if (l === 'zh' && !hasZh) return
    stop()
    setLang(l)
  }

  useEffect(() => {
    loadBuffer(lang === 'zh' && data.fz ? data.fz : data.f)
    return () => {
      stopSource()
    }
  }, [lang, data.f, data.fz, loadBuffer, stopSource])

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
          <button className={cat === 'all' ? 'on' : ''} onClick={() => { setCat('all'); stop() }}>
            全部 <b>{data.n}</b>
          </button>
          {data.cats.map((c) => (
            <button
              key={c.k}
              className={cat === c.k ? 'on' : ''}
              onClick={() => { setCat(c.k); stop() }}
            >
              {c.n} <b>{c.v.length}</b>
            </button>
          ))}
        </div>
        <div className="voice-opts">
          <div className="voice-langs">
            <button
              className={lang === 'zh' ? 'on' : ''}
              disabled={!hasZh}
              onClick={() => changeLang('zh')}
              title={hasZh ? `中文配音（${data.zc ?? 0}/${data.n} 条）` : '国服暂无该角色中文语音'}
            >
              中配
            </button>
            <button
              className={lang === 'ja' ? 'on' : ''}
              onClick={() => changeLang('ja')}
              title="日语配音"
            >
              日配
            </button>
          </div>
          <button
            className={`voice-ja ${showJa ? 'on' : ''}`}
            onClick={() => setShowJa((v) => !v)}
            title="显示日文原文"
          >
            日文
          </button>
        </div>
      </div>
      {!hasZh && <div className="voice-hint">国服暂无该角色中文语音，仅提供日语。</div>}
      {(loading || error) && (
        <div className={`voice-hint ${error ? 'err' : ''}`}>
          {error ? '语音加载失败，请刷新重试' : '音频解码中…'}
        </div>
      )}

      <div className="voice-list">
        {voices.map((v) => {
          const on = active?.id === v.id
          const missingZh = lang === 'zh' && hasZh && (v.zs == null || v.ze == null)
          const dur = lang === 'zh' && v.zs != null && v.ze != null ? v.ze - v.zs : v.e - v.s
          return (
            <div
              key={v.id}
              className={`voice-row ${on ? 'on' : ''}`}
              onClick={() => toggle(v)}
              title={missingZh ? '国服暂无此条中文语音，播放日语' : undefined}
            >
              <button
                className="voice-play"
                style={on ? { color: accent, borderColor: accent } : undefined}
                aria-label={on && playing ? '暂停' : '播放'}
              >
                {on && playing ? '⏸' : '▶'}
              </button>
              <div className="voice-main">
                <div className="voice-title">
                  {v.t}
                  {v.g && <span className="voice-skin">{v.g}</span>}
                  {missingZh && <span className="voice-nozh">中配缺失</span>}
                </div>
                <div className="voice-text">{v.x || v.j || '（无台词文本）'}</div>
                {showJa && v.j && v.j !== v.x && <div className="voice-ja-text">{v.j}</div>}
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
