import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadStats, nf, type Stats } from '../data'

/**
 * Hero 台词轮播：全部是本站收录的游戏原文（见 /data/story/），出处随台词标注。
 * 台词选自主线第 50 章「决战」与活动剧情「Marian」。
 */
const HERO_QUOTES = [
  { text: '……这里，就是地面。', src: '玛丽亚-2 · 活动剧情「Marian」' },
  { text: '方舟平安无事地升上地面，女王被击败了。', src: '尤尔夏 · 主线第50章「决战」' },
  { text: '因为记忆会成为推动你向前迈进的力量。', src: '玛丽亚博士 · 活动剧情「Marian」' },
  { text: '……终于看见了地平线的另一侧，那巨大女神像的小小身影。', src: '旁白 · 主线第50章「决战」' },
  { text: '您明明不用分享自己的名字，却还是执意将自己的名字分给了我……', src: '玛丽亚-102 · 活动剧情「Marian」' },
  { text: '莱彻和莱彻一起，妮姬和妮姬一起。人类和人类一起。', src: '匹诺曹 · 主线第50章「决战」' },
]

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
  const [qi, setQi] = useState(0)

  useEffect(() => {
    loadStats().then(setS).catch(() => {})
    // 台词轮播：7 秒换一条
    const timer = window.setInterval(() => setQi((v) => (v + 1) % HERO_QUOTES.length), 7000)
    return () => window.clearInterval(timer)
  }, [])

  const val = (k: string) => (s ? nf((s as unknown as Record<string, number>)[k]) : '—')

  return (
    <>
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-in">
          <div className="eyebrow">ONLINE DATABASE · CN</div>
          <h1>
            NIKKE
            <em>资料库</em>
          </h1>
          <p className="hero-desc">
            <span className="hero-quote" key={qi}>
              「{HERO_QUOTES[qi].text}」
            </span>
            <span className="hero-quote-src" key={`s${qi}`}>
              ── {HERO_QUOTES[qi].src} · 游戏原文
            </span>
          </p>
          <div className="hero-actions">
            <Link to="/characters" className="btn primary">
              开始浏览 <span>→</span>
            </Link>
            <Link to="/notice" className="btn">
              网站公告
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
              <div className="wall-title">全站搜索</div>
              <div className="wall-meta">角色 / CG / 剧情 / 台词，全站可检索</div>
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
