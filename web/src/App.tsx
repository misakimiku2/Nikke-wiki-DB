import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import Home from './pages/Home'
import Characters from './pages/Characters'
import CharacterDetail from './pages/CharacterDetail'
import Story from './pages/Story'
import StoryReader from './pages/StoryReader'
import Search from './pages/Search'
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

  return (
    <>
      <ScrollToTop />
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand">
            <span className="brand-mark" />
            NIKKE.DB
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
            onClick={() => {
              const next = theme === 'dark' ? 'light' : 'dark'
              setTheme(next)
              // 清掉 URL 上的 theme 参数，否则刷新会被它覆盖
              const url = new URL(window.location.href)
              if (url.searchParams.has('theme')) {
                url.searchParams.delete('theme')
                window.history.replaceState(null, '', url.toString())
              }
            }}
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
