export type Theme = 'dark' | 'light'

const KEY = 'nikke-theme'

export function getInitialTheme(): Theme {
  // URL 参数优先，方便分享指定主题的链接
  const q = new URLSearchParams(window.location.search).get('theme')
  if (q === 'dark' || q === 'light') return q
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* ignore */
  }
}
