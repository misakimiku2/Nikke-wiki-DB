import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * 站内内容语言（只切换游戏内容文本，不翻译界面导航）。
 *
 * 文本来源：Locale_* 本地化库中的 zh-CN / en / ko / ja 四列；
 * 角色语音另有对应语言的音频雪碧图（日配即站内主音轨）。语言记在 localStorage，
 * 也支持 ?lang=ja 直达，方便分享。
 */
export type ContentLang = 'zh' | 'en' | 'ko' | 'ja'

const KEY = 'nikke-content-lang'

export const LANGS: { key: ContentLang; label: string; short: string }[] = [
  { key: 'zh', label: '简体中文', short: '中' },
  { key: 'en', label: 'English', short: 'EN' },
  { key: 'ko', label: '한국어', short: 'KO' },
  { key: 'ja', label: '日本語', short: 'JA' },
]

function valid(v: string | null | undefined): v is ContentLang {
  return v === 'zh' || v === 'en' || v === 'ko' || v === 'ja'
}

export function getInitialLang(): ContentLang {
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (valid(q)) return q
    const saved = window.localStorage.getItem(KEY)
    if (valid(saved)) return saved
  } catch {
    /* SSR / 隐私模式 */
  }
  // 首次访问（无 ?lang 也无手动选择记录）跟随浏览器语言：中/韩/日各归其位，
  // 其余语言一律英文（站内只有这四套文本）。用户手动切换后写入 localStorage，
  // 之后永远以手动选择为准。
  const langs: string[] = []
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages)) langs.push(...navigator.languages)
    if (navigator.language) langs.push(navigator.language)
  }
  for (const tag of langs) {
    const p = (tag || '').toLowerCase()
    if (p.startsWith('zh')) return 'zh'
    if (p.startsWith('ko')) return 'ko'
    if (p.startsWith('ja')) return 'ja'
    if (p.startsWith('en')) return 'en'
  }
  return 'en'
}

type LangState = {
  lang: ContentLang
  setLang: (l: ContentLang) => void
}

const LangCtx = createContext<LangState>({ lang: 'zh', setLang: () => {} })

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<ContentLang>(getInitialLang)

  const setLang = (l: ContentLang) => {
    setLangState(l)
    try {
      window.localStorage.setItem(KEY, l)
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
  }, [lang])

  const value = useMemo(() => ({ lang, setLang }), [lang])
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>
}

export function useLang(): LangState {
  return useContext(LangCtx)
}

/** 按当前内容语言取值，缺失时回退中文。 */
export function pickLang<T>(lang: ContentLang, zh: T, en?: T | null, ko?: T | null, ja?: T | null): T {
  if (lang === 'en' && en != null && en !== '') return en
  if (lang === 'ko' && ko != null && ko !== '') return ko
  if (lang === 'ja' && ja != null && ja !== '') return ja
  return zh
}

/** 剧情里的「指挥官」是特殊说话人（Self / Choice），没有角色档案。 */
export function commanderName(lang: ContentLang): string {
  return lang === 'en' ? 'Commander'
    : lang === 'ko' ? '지휘관'
      : lang === 'ja' ? '指揮官'
        : '指挥官'
}
