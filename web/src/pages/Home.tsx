import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadStats, nf, type Stats } from '../data'
import { pickLang, useLang } from '../lang'
import { fmt, useUI, type UIKey } from '../ui'

/**
 * Hero 台词轮播：全部是本站收录的游戏原文（见 /data/story/），出处随台词标注。
 * 台词选自主线第 50 章「决战」与活动剧情「Marian」。
 * text / src 各带四列译文：简中是游戏原文，其余语言是站内翻译。
 */
type QRow = [string, string, string, string]
const HERO_QUOTES: { text: QRow; src: QRow }[] = [
  {
    text: ['……这里，就是地面。', '……This is the surface.', '……여기가, 바로 지상.', '……ここが、地上。'],
    src: ['玛丽亚-2 · 活动剧情「Marian」', 'Maria-2 · Event Story "Marian"', '마리아-2 · 이벤트 스토리 「Marian」', 'マリア-2 · イベントストーリー「Marian」'],
  },
  {
    text: ['方舟平安无事地升上地面，女王被击败了。', 'The Ark made it safely to the surface, and the Queen was defeated.', '아크는 무사히 지상으로 올라갔고, 여왕은 쓰러졌다.', 'アークは無事に地表へ上がり、女王は倒された。'],
    src: ['尤尔夏 · 主线第50章「决战」', 'Yulha · Main Story Ch. 50 "Showdown"', '율하 · 메인 스토리 50장 「결전」', 'ユルハ · メインストーリー第50章「決戦」'],
  },
  {
    text: ['因为记忆会成为推动你向前迈进的力量。', 'Memories will become the strength that carries you forward.', '기억이 당신을 앞으로 나아가게 하는 힘이 되어줄 테니까요.', '記憶は、あなたを前へ進める力になるから。'],
    src: ['玛丽亚博士 · 活动剧情「Marian」', 'Dr. Maria · Event Story "Marian"', '마리아 박사 · 이벤트 스토리 「Marian」', 'マリア博士 · イベントストーリー「Marian」'],
  },
  {
    text: ['……终于看见了地平线的另一侧，那巨大女神像的小小身影。', '……At last, beyond the horizon — the tiny figure atop that giant goddess statue.', '……드디어 수평선 너머, 그 거대한 여신상 위의 작은 모습을 보았다.', '……ついに地平線の向こう、あの巨大な女神像の小さな姿を見た。'],
    src: ['旁白 · 主线第50章「决战」', 'Narration · Main Story Ch. 50 "Showdown"', '나레이션 · 메인 스토리 50장 「결전」', 'ナレーション · メインストーリー第50章「決戦」'],
  },
  {
    text: ['您明明不用分享自己的名字，却还是执意将自己的名字分给了我……', 'You never had to share your name, yet you insisted on giving half of it to me……', '이름을 나눠줄 필요도 없었는데, 굳이 자신의 이름을 저에게 나눠주셨군요……', '名前を分ける必要はなかったのに、それでも自分の名前を私に分けてくれた……'],
    src: ['玛丽亚-102 · 活动剧情「Marian」', 'Maria-102 · Event Story "Marian"', '마리아-102 · 이벤트 스토리 「Marian」', 'マリア-102 · イベントストーリー「Marian」'],
  },
  {
    text: ['莱彻和莱彻一起，妮姬和妮姬一起。人类和人类一起。', 'Raptures with Raptures, Nikkes with Nikkes. Humans with humans.', '랩처는 랩처끼리, 니케는 니케끼리. 인간은 인간끼리.', 'ラプチャーはラプチャーと、ニケはニケと。人間は人間と。'],
    src: ['匹诺曹 · 主线第50章「决战」', 'Pinocchio · Main Story Ch. 50 "Showdown"', '피노키오 · 메인 스토리 50장 「결전」', 'ピノキオ · メインストーリー第50章「決戦」'],
  },
]

const WALL: { to: string; idx: string; titleKey: UIKey; key: string; unit: UIKey; img: string }[] = [
  {
    to: '/characters',
    idx: '01 / CHARACTER',
    titleKey: 'char_title',
    key: 'characters',
    unit: 'home_wall_chars',
    img: '/img/m/524f083c9774e606.webp?v=2',
  },
  {
    to: '/story',
    idx: '02 / STORY',
    titleKey: 'story_title',
    key: 'units',
    unit: 'home_wall_units',
    img: '/img/m/8c72a9614374acb9.webp?v=2',
  },
  {
    to: '/cg',
    idx: '03 / GALLERY',
    titleKey: 'cg_title',
    key: 'cg',
    unit: 'home_wall_cg',
    img: '/img/m/caa05595e634340f.webp?v=2',
  },
]

export default function Home() {
  const t = useUI()
  const { lang } = useLang()
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
              「{pickLang(lang, HERO_QUOTES[qi].text[0], HERO_QUOTES[qi].text[1], HERO_QUOTES[qi].text[2], HERO_QUOTES[qi].text[3])}」
            </span>
            <span className="hero-quote-src" key={`s${qi}`}>
              ── {pickLang(lang, HERO_QUOTES[qi].src[0], HERO_QUOTES[qi].src[1], HERO_QUOTES[qi].src[2], HERO_QUOTES[qi].src[3])} · {t('hero_quote_tag')}
            </span>
          </p>
          <div className="hero-actions">
            <Link to="/characters" className="btn primary">
              {t('home_start')} <span>→</span>
            </Link>
            <Link to="/notice" className="btn">
              {t('notice_title')}
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
            <h2>{t('home_browse')}</h2>
          </div>
          <div className="meta">PICK A SECTION</div>
        </div>

        <div className="wall">
          {WALL.map((w) => (
            <Link key={w.to} to={w.to} className="wall-card">
              <div className="wall-bg" style={{ backgroundImage: `url(${w.img})` }} />
              <div className="wall-in">
                <div className="wall-idx">{w.idx}</div>
                <div className="wall-title">{t(w.titleKey)}</div>
                <div className="wall-meta">
                  {fmt(t(w.unit), { n: val(w.key) })}
                </div>
              </div>
              <span className="wall-arrow">→</span>
            </Link>
          ))}

          <Link to="/search" className="wall-card wall-plain">
            <div className="wall-grid" />
            <div className="wall-in">
              <div className="wall-idx">04 / SEARCH</div>
              <div className="wall-title">{t('home_search_all')}</div>
              <div className="wall-meta">{t('home_search_ph')}</div>
            </div>
            <span className="wall-arrow">→</span>
          </Link>
        </div>

        <div className="sec-head">
          <div>
            <div className="idx">DATA</div>
            <h2>{t('home_stats_title')}</h2>
          </div>
        </div>

        <div className="spec">
          <div>
            <span>{t('home_stat_chars')}</span>
            <b>{val('characters')}</b>
          </div>
          <div>
            <span>{t('home_stat_full')}</span>
            <b>{val('charactersWithDesc')}</b>
          </div>
          <div>
            <span>{t('home_stat_lines')}</span>
            <b>{val('lines')}</b>
          </div>
          <div>
            <span>{t('home_stat_segs')}</span>
            <b>{val('segments')}</b>
          </div>
          <div>
            <span>{t('home_stat_cglinked')}</span>
            <b>{val('cgLinked')}</b>
          </div>
          <div>
            <span>{t('home_stat_anim')}</span>
            <b>{val('animated')}</b>
          </div>
        </div>

        <p className="pager-note">
          LAST BUILD · {s?.builtAt || '—'} · {t('home_note')}
        </p>
      </div>
    </>
  )
}
