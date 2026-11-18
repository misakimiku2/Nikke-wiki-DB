import { useEffect, useState, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { Link, NavLink, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import Home from './pages/Home'
import Characters from './pages/Characters'
import CharacterDetail from './pages/CharacterDetail'
import Story from './pages/Story'
import StoryReader from './pages/StoryReader'
import Search from './pages/Search'
import Notice, { NoticeDetail } from './pages/Notice'
import CgGallery from './pages/CgGallery'
import CgView from './pages/CgView'
import { applyTheme, getInitialTheme, type Theme } from './theme'

/**
 * 点进新页面回到顶部。之前没有这一步，从列表页深处点进角色页会保留列表的
 * 滚动位置，直接落在页面中段（马士丁这类短页面正好是巴拉短信区）。
 * 浏览器前进/后退（POP）不抢，保留原位置。
 */
function ScrollToTop() {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  useEffect(() => {
    if (navType === 'POP') return
    window.scrollTo(0, 0)
  }, [pathname, navType])
  return null
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  /**
   * 切换主题。支持 View Transitions 的浏览器从点击处做圆形遮罩向四周扩散；
   * 不支持的浏览器回退为原有的整体渐变。
   */
  const toggleTheme = (e: MouseEvent<HTMLButtonElement>) => {
    const next = theme === 'dark' ? 'light' : 'dark'
    // 圆心取点击处；键盘触发（clientX/Y 为 0）时取按钮中心
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX || rect.left + rect.width / 2
    const y = e.clientY || rect.top + rect.height / 2

    // 清掉 URL 上的 theme 参数，否则刷新会被它覆盖
    const url = new URL(window.location.href)
    if (url.searchParams.has('theme')) {
      url.searchParams.delete('theme')
      window.history.replaceState(null, '', url.toString())
    }

    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void> }
    }
    if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTheme(next)
      return
    }

    // 切换期间关掉页面自己的颜色渐变，圆形遮罩里呈现的才是干净的新主题
    const root = document.documentElement
    root.classList.add('theme-switching')
    const vt = doc.startViewTransition(() => {
      flushSync(() => setTheme(next))
    })
    vt.ready
      .then(() => {
        const maxR = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
        try {
          root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxR}px at ${x}px ${y}px)`] },
            { duration: 520, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' },
          )
        } catch {
          /* WAAPI 不支持 pseudoElement 时退回默认交叉淡入 */
        }
      })
      .catch(() => {})
    vt.finished.finally(() => root.classList.remove('theme-switching'))
  }

  return (
    <>
      <ScrollToTop />
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand">
            <img className="brand-logo" src="/site-logo.webp" alt="NIKKE 资料库" />
          </Link>
          <nav className="nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'on' : '')}>
              首页
            </NavLink>
            <NavLink to="/characters" className={({ isActive }) => (isActive ? 'on' : '')}>
              角色
            </NavLink>
            <NavLink to="/story" className={({ isActive }) => (isActive ? 'on' : '')}>
              剧情
            </NavLink>
            <NavLink to="/search" className={({ isActive }) => (isActive ? 'on' : '')}>
              搜索
            </NavLink>
            <NavLink to="/cg" className={({ isActive }) => (isActive ? 'on' : '')}>
              CG
            </NavLink>
          </nav>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
            aria-label="切换主题"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/characters" element={<Characters />} />
        <Route path="/characters/:id" element={<CharacterDetail />} />
        <Route path="/story" element={<Story />} />
        <Route path="/story/:id" element={<StoryReader />} />
        <Route path="/search" element={<Search />} />
        <Route path="/notice" element={<Notice />} />
        <Route path="/notice/:slug" element={<NoticeDetail />} />
        <Route path="/cg" element={<CgGallery />} />
        <Route path="/cg/:name" element={<CgView />} />
        <Route path="*" element={<Stub code="404" title="页面不存在" note="回到首页" />} />
      </Routes>
    </>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
    </svg>
  )
}

function Stub({ code, title, note }: { code: string; title: string; note: string }) {
  return (
    <div className="wrap">
      <div className="sec-head">
        <div>
          <div className="idx">{code}</div>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="empty">
        {note}
        <div style={{ marginTop: 26 }}>
          <Link to="/" className="btn">
            返回首页
          </Link>
        </div>
      </div>
    </div>
  )
}
