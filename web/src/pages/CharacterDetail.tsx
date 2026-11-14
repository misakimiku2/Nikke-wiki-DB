import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  accentFor, charImg, loadCharHd, loadCharImages, loadCharacters, mainBase, nf, tintFor, variantsOf,
  type CharImages, type Character,
} from '../data'
import ImageViewer from '../components/ImageViewer'

export default function CharacterDetail() {
  const { id } = useParams()
  const [list, setList] = useState<Character[] | null>(null)
  const [imgs, setImgs] = useState<CharImages>({})
  const [hd, setHd] = useState<Set<string>>(new Set())
  const [pick, setPick] = useState<string | null>(null)

  useEffect(() => {
    loadCharacters().then(setList).catch(() => setList([]))
    loadCharImages().then(setImgs).catch(() => {})
    loadCharHd().then(setHd).catch(() => {})
  }, [])

  useEffect(() => {
    setPick(null)
  }, [id])

  if (!list) return <div className="loading">LOADING…</div>

  const c = list.find((x) => String(x.id) === id)
  if (!c) return <div className="empty">CHARACTER NOT FOUND</div>

  const vars = variantsOf(imgs, c.id)
  const current = pick || mainBase(imgs, c.id) || ''
  const src = current ? charImg(current, hd, 'full') : ''
  const desc = (c.desc || '').split('\n').filter(Boolean)

  return (
    <div className="detail-page">
      <div className="detail">
        <div className="detail-visual" style={{ ['--tint' as string]: tintFor(c.id) }}>
          <div className="stage">
            {current ? (
              <ImageViewer
                key={current}
                src={src}
                alt={c.name}
                max={4}
                extra={
                  <a
                    className="iv-btn"
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    title="在新标签页查看原图"
                  >↗</a>
                }
              />
            ) : (
              <div style={{ padding: '60px 0', fontSize: 96, fontWeight: 900, color: 'var(--dim-2)' }}>
                {c.name.slice(0, 1)}
              </div>
            )}
          </div>
          {vars.length > 1 && (
            <div className="variants">
              {vars.map((v) => (
                <button
                  key={v}
                  className={v === current ? 'on' : ''}
                  onClick={() => setPick(v)}
                  title={v}
                >
                  <img src={charImg(v, hd, 'full')} alt={v} loading="lazy" />
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
            <div className="slot">
              <span>技能说明</span>
              <em>待接入</em>
            </div>
            <div className="slot">
              <span>好感剧情</span>
              <em>待接入</em>
            </div>
            <div className="slot">
              <span>动态立绘</span>
              <em>待接入</em>
            </div>
          </div>

          <Link to="/characters" className="backlink">← 返回角色列表</Link>
        </div>
      </div>
    </div>
  )
}
