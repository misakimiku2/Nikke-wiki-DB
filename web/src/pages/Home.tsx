import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadStats, nf, type Stats } from '../data'

const WALL = [
  {
    to: '/characters',
    idx: '01 / CHARACTER',
    title: '角色图鉴',
    key: 'characters',
    unit: '个角色',
    img: '/img/m/8a3eaae83314f8cc.webp?v=2',
  },
  {
    to: '/story',
    idx: '02 / STORY',
    title: '剧情全文',
    key: 'units',
    unit: '个单元',
    img: '/img/m/8c72a9614374acb9.webp?v=2',
  },
  {
    to: '/cg',
    idx: '03 / GALLERY',
    title: 'CG 图鉴',
    key: 'cg',
    unit: '张插画',
    img: '/img/m/5289bcb216c275ac.webp?v=2',
  },
]

export default function Home() {
  const [s, setS] = useState<Stats | null>(null)

  useEffect(() => {
    loadStats().then(setS).catch(() => {})
  }, [])

  const val = (k: string) => (s ? nf((s as unknown as Record<string, number>)[k]) : '—')

  return (
    <>
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-in">
          <div className="eyebrow">LOCAL DATABASE · CN</div>
          <h1>
            NIKKE
            <em>资料库</em>
          </h1>
          <p className="hero-desc">
            从客户端本地解包的角色、剧情与影像资料库。
            没有搬运、没有二手数据，游戏更新即同步。
          </p>
          <div className="hero-actions">
            <Link to="/characters" className="btn primary">
              开始浏览 <span>→</span>
            </Link>
            <Link to="/search" className="btn">
              搜台词
            </Link>
          </div>

          <div className="hero-metrics">
            <div>
              <b>{val('characters')}</b>
              <span>CHARACTERS</span>
            </div>
            <div>
              <b>{val('lines')}</b>
              <span>LINES</span>
            </div>
            <div>
              <b>{val('cg')}</b>
              <span>CG</span>
            </div>
            <div>
              <b>{val('units')}</b>
              <span>EPISODES</span>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="idx">EXPLORE</div>
            <h2>分类浏览</h2>
          </div>
          <div className="meta">PICK A SECTION</div>
        </div>

        <div className="wall">
          {WALL.map((w) => (
            <Link key={w.to} to={w.to} className="wall-card">
              <div className="wall-bg" style={{ backgroundImage: `url(${w.img})` }} />
              <div className="wall-in">
                <div className="wall-idx">{w.idx}</div>
                <div className="wall-title">{w.title}</div>
                <div className="wall-meta">
                  {val(w.key)} {w.unit}
                </div>
              </div>
              <span className="wall-arrow">→</span>
            </Link>
          ))}

          <Link to="/search" className="wall-card wall-plain">
            <div className="wall-grid" />
            <div className="wall-in">
              <div className="wall-idx">04 / SEARCH</div>
              <div className="wall-title">台词搜索</div>
              <div className="wall-meta">{val('lines')} 条台词可全文检索</div>
            </div>
            <span className="wall-arrow">→</span>
          </Link>
        </div>

        <div className="sec-head">
          <div>
            <div className="idx">DATA</div>
            <h2>数据概览</h2>
          </div>
        </div>

        <div className="spec">
          <div>
            <span>角色条目</span>
            <b>{val('characters')}</b>
          </div>
          <div>
            <span>有完整档案</span>
            <b>{val('charactersWithDesc')}</b>
          </div>
          <div>
            <span>剧情台词</span>
            <b>{val('lines')}</b>
          </div>
          <div>
            <span>剧情段落</span>
            <b>{val('segments')}</b>
          </div>
          <div>
            <span>CG 有剧情关联</span>
            <b>{val('cgLinked')}</b>
          </div>
          <div>
            <span>动态 CG</span>
            <b>{val('animated')}</b>
          </div>
        </div>

        <p className="pager-note">
          LAST BUILD · {s?.builtAt || '—'} · 数据来自客户端本地解包，仅供学习交流
        </p>
      </div>
    </>
  )
}
