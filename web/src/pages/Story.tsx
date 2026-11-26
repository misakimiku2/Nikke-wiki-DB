import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { loadStoryIndex, nf, type StoryUnit } from '../data'
import { pickLang, useLang } from '../lang'
import { useUI, type UIKey } from '../ui'

export default function Story() {
  const [units, setUnits] = useState<StoryUnit[] | null>(null)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { lang } = useLang()
  const t = useUI()

  useEffect(() => {
    loadStoryIndex().then(setUnits).catch(() => setUnits([]))
  }, [])

  const cats = useMemo(() => {
    if (!units) return []
    const seen: { cat: string; label: string; n: number; lines: number }[] = []
    for (const u of units) {
      const hit = seen.find((s) => s.cat === u.cat)
      if (hit) {
        hit.n += 1
        hit.lines += u.lines
      } else {
        seen.push({ cat: u.cat, label: u.label, n: 1, lines: u.lines })
      }
    }
    return seen
  }, [units])

  // 当前分类写进 URL：从阅读器返回时才能回到原来的分类，而不是重置到主线
  const wanted = params.get('cat') || 'main'
  const cat = cats.length && !cats.some((c) => c.cat === wanted) ? cats[0].cat : wanted

  const pickCat = (next: string) => {
    const p = new URLSearchParams(params)
    if (next === 'main') p.delete('cat')
    else p.set('cat', next)
    setParams(p, { replace: true })
  }

  const shown = useMemo(() => {
    if (!units) return []
    return units.filter((u) => u.cat === cat)
  }, [units, cat])

  if (!units) return <div className="loading">LOADING…</div>

  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">02 / STORY</div>
          <h2>{t('story_title')}</h2>
        </div>
        <div className="meta">
          {import.meta.env.DEV && (
            <button className="chip" style={{ marginRight: 12 }}
              onClick={() => navigate('/story/covers')} title="剧情卡封面编辑后台（dev）">
              封面编辑
            </button>
          )}
          {nf(units.length)} EPISODES · {nf(units.reduce((a, b) => a + b.lines, 0))} LINES
        </div>
      </div>

      <div className="cat-row">
        {cats.map((c) => (
          <button
            key={c.cat}
            className={`chip ${cat === c.cat ? 'on' : ''}`}
            onClick={() => pickCat(c.cat)}
          >
            {t(`cat_${c.cat}` as UIKey)} · {c.n}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty">{t('story_none')}</div>
      ) : (
        <div className="story-grid">
          {shown.map((u) => {
            const title = pickLang(lang, u.title, u.titles?.en, u.titles?.ko, u.titles?.ja)
            const hasBranchGame = u.id === 663
            return (
              <article key={u.id} className={`story-card${hasBranchGame ? ' has-branch-game' : ''}`}>
                <Link to={`/story/${u.id}`} className="story-card-main">
                  <div className="story-cover">
                    {u.cover
                      ? <img src={`/cover/${u.cover}.webp`} alt="" loading="lazy" />
                      : (
                        /* 没有可用 CG 的剧情用排印式封面兜底：首字描边水印。
                           标题、句数已在卡片正文里，这里不再重复。 */
                        <span className="story-cover-fallback" aria-hidden>
                          <span className="scf-mark">{title.slice(0, 1)}</span>
                        </span>
                      )}
                    <span className="story-no">
                      {u.chapter !== null && u.chapter !== undefined
                        ? String(u.chapter).padStart(2, '0')
                        : u.label.slice(0, 2)}
                    </span>
                  </div>
                  <div className="story-body">
                    <h3>{title}</h3>
                    <div className="story-meta">
                      <span>{nf(u.lines)} {t('unit_lines')}</span>
                      <span>{u.segments} {t('unit_segs')}</span>
                      {u.source === 'locale_fill' && <span className="tag">{t('story_fill')}</span>}
                    </div>
                  </div>
                </Link>
                {hasBranchGame && (
                  <Link to="/game/fadingaffection" className="story-branch-game">
                    <span className="story-branch-title">FADING AFFECTION</span>
                    <span className="story-branch-enter">{t('story_branch_enter')}</span>
                  </Link>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
