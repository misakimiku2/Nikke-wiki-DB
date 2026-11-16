import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CharVoice, CharVoiceData } from '../data'

/**
 * 角色语音区。
 *
 * 每个角色一条 OGG 雪碧图，但播放不走 <audio> + currentTime：媒体元素的
 * currentTime 有更新粒度，seek 到片段起点时也可能落到后一个 Ogg 包，导致
 * 开头缺失或尾音被掐。这里用 Web Audio 解码整条雪碧图，再按
 * AudioBufferSourceNode.start(when, offset, duration) 片段播放，起止是
 * 采样级精确的。
 */

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
  // 一条雪碧图解码后可能有几十 MB，只保留最近一个角色
  while (SHARED.cache.size > 1) {
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
  const [cat, setCat] = useState('all')
  const [showJa, setShowJa] = useState(false)
  const [active, setActive] = useState<CharVoice | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [decoding, setDecoding] = useState(true)
  const [decodeError, setDecodeError] = useState(false)

  const bufferRef = useRef<AudioBuffer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const startedAt = useRef(0)
  const startOffset = useRef(0)
  const pausedOffset = useRef<number | null>(null)
  const pendingVoice = useRef<CharVoice | null>(null)
  const decodePromise = useRef<Promise<AudioBuffer | null> | null>(null)

  const voices = useMemo(() => {
    if (cat === 'all') return data.cats.flatMap((c) => c.v)
    return data.cats.find((c) => c.k === cat)?.v ?? []
  }, [data, cat])

  const stopSource = useCallback(() => {
    const s = sourceRef.current
    if (!s) return
    sourceRef.current = null
    s.onended = null
    try { s.stop() } catch { /* 已经停止 */ }
    try { s.disconnect() } catch { /* 已经断开 */ }
  }, [])

  const stop = useCallback(() => {
    stopSource()
    pausedOffset.current = null
    pendingVoice.current = null
    setPlaying(false)
    setActive(null)
    setPos(0)
  }, [stopSource])

  const loadBuffer = useCallback(() => {
    if (bufferRef.current) {
      setDecoding(false)
      return Promise.resolve(bufferRef.current)
    }
    if (decodePromise.current) return decodePromise.current
    const cached = SHARED.cache.get(data.f)
    if (cached) {
      bufferRef.current = cached
      setDecoding(false)
      return Promise.resolve(cached)
    }
    setDecoding(true)
    setDecodeError(false)
    const p = fetch(data.f)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.arrayBuffer()
      })
      .then((arr) => getCtx().decodeAudioData(arr))
      .then((buf) => {
        bufferRef.current = buf
        cacheBuffer(data.f, buf)
        setDecoding(false)
        return buf
      })
      .catch(() => {
        decodePromise.current = null
        setDecoding(false)
        setDecodeError(true)
        return null
      })
    decodePromise.current = p
    return p
  }, [data.f])

  const playFrom = (v: CharVoice, offset: number) => {
    const buffer = bufferRef.current
    if (!buffer) {
      pendingVoice.current = v
      setActive(v)
      loadBuffer()
      return
    }
    const ctx = getCtx()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    stopSource()
    const from = Math.max(v.s, Math.min(offset, v.e - 0.001))
    const dur = Math.max(0.001, v.e - from)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.onended = () => {
      if (sourceRef.current !== src) return
      sourceRef.current = null
      pausedOffset.current = v.e
      setPlaying(false)
      setPos(1)
    }
    sourceRef.current = src
    startedAt.current = ctx.currentTime
    startOffset.current = from
    pausedOffset.current = null
    setActive(v)
    setPlaying(true)
    setPos((from - v.s) / Math.max(0.001, v.e - v.s))
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
    if (active?.id === v.id) {
      if (playing) {
        const t = Math.min(v.e, startOffset.current + (ctx.currentTime - startedAt.current))
        pausedOffset.current = t
        stopSource()
        setPlaying(false)
        setPos((t - v.s) / Math.max(0.001, v.e - v.s))
      } else {
        const from = pausedOffset.current != null && pausedOffset.current < v.e
          ? pausedOffset.current
          : v.s
        playFrom(v, from)
      }
      return
    }
    pausedOffset.current = null
    playFrom(v, v.s)
  }

  useEffect(() => {
    loadBuffer()
    return () => {
      stopSource()
      bufferRef.current = null
    }
  }, [loadBuffer, stopSource])

  useEffect(() => {
    if (decoding || decodeError) return
    const v = pendingVoice.current
    if (v && bufferRef.current) {
      pendingVoice.current = null
      playFrom(v, v.s)
    }
  }, [decoding, decodeError])

  useEffect(() => {
    if (!playing || !active) return
    const id = window.setInterval(() => {
      const t = Math.min(active.e, startOffset.current + (getCtx().currentTime - startedAt.current))
      const d = active.e - active.s
      setPos(d > 0 ? Math.max(0, Math.min(1, (t - active.s) / d)) : 0)
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
        <button
          className={`voice-ja ${showJa ? 'on' : ''}`}
          onClick={() => setShowJa((v) => !v)}
          title="显示日文原文"
        >
          日文
        </button>
      </div>
      {(decoding || decodeError) && (
        <div className={`voice-hint ${decodeError ? 'err' : ''}`}>
          {decodeError ? '语音加载失败，请刷新重试' : '音频解码中…'}
        </div>
      )}

      <div className="voice-list">
        {voices.map((v) => {
          const on = active?.id === v.id
          return (
            <div
              key={v.id}
              className={`voice-row ${on ? 'on' : ''}`}
              onClick={() => toggle(v)}
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
                </div>
                <div className="voice-text">{v.x || v.j || '（无台词文本）'}</div>
                {showJa && v.j && v.j !== v.x && <div className="voice-ja-text">{v.j}</div>}
              </div>
              <span className="voice-time">{(v.e - v.s).toFixed(1)}s</span>
              {on && <i className="voice-progress" style={{ width: `${pos * 100}%` }} />}
            </div>
          )
        })}
        {voices.length === 0 && <div className="voice-empty">这个分类暂无语音。</div>}
      </div>
    </div>
  )
}
