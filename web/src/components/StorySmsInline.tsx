import type { Character, StorySmsGroup } from '../data'
import { commanderName, pickLang, useLang } from '../lang'
import { useUI } from '../ui'

/**
 * 剧情正文里内嵌的巴拉短信面板。
 *
 * 由 StoryReader 在对应剧情段落之后（少数在之前）插入，用手机气泡展示
 * 这段剧情里发生的群聊/私信，保留上下文，不再单独列一个短信目录。
 *
 * 短信正文与群聊名是数据原文（zh）；发言人名 / 指挥官 / 徽标按内容语言显示。
 */
export default function StorySmsInline({ group, chars = [] }: {
  group: StorySmsGroup
  chars?: Character[]
}) {
  const { lang } = useLang()
  const t = useUI()
  const lines = group.l.filter((x) => x[3])

  /** 发言人显示名：part 挂了角色 id 或中文名能对上档案时用本地化角色名 */
  const byId = new Map(chars.map((c) => [c.id, c]))
  const byName = new Map(chars.filter((c) => c.names.zh).map((c) => [c.names.zh, c]))
  const displayName = (slug: string | null, name: string | null): string => {
    const part = slug ? group.parts[slug] : undefined
    const c = (part?.[0] != null ? byId.get(part[0]) : undefined) || (name ? byName.get(name) : undefined)
    return c ? pickLang(lang, name || part?.[1] || c.name, c.names.en, c.names.ko, c.names.ja)
      : (name || part?.[1] || '')
  }

  return (
    <section className="story-sms-inline">
      <div className="ssi-head">
        <span className="ssi-badge">{t('ssi_badge')}</span>
        <span className="ssi-title">{group.t}</span>
        <span className="ssi-meta">{group.label} · {lines.length} {t('unit_msgs')}</span>
      </div>
      <div className="cc-feed ssi-feed">
        {lines.map((ln, i) => {
          const [kind, slug, name, text] = ln
          const prev = i > 0 ? lines[i - 1] : null
          const sameSpeaker = kind === 0 && prev?.[0] === 0 && prev?.[1] === slug

          if (kind === 2) {
            return (
              <div className="mc-sys" key={i}>
                <span>{text}</span>
              </div>
            )
          }
          if (kind === 1) {
            return (
              <div className="cc-msg me" key={i}>
                <div className="cc-bubble">
                  <span className="cc-name">{commanderName(lang)}</span>
                  <p>{text}</p>
                </div>
              </div>
            )
          }

          const part = slug ? group.parts[slug] : undefined
          const avatar = part?.[2] || null
          const display = displayName(slug, name) || t('common_unknown')
          return (
            <div className="cc-msg" key={i}>
              {!sameSpeaker && (
                avatar
                  ? <span className="cc-ava"><img src={avatar} alt="" loading="lazy" /></span>
                  : <span className="cc-ava cc-ava-ph" aria-hidden>{display.slice(0, 1)}</span>
              )}
              <div className="cc-bubble">
                {!sameSpeaker && <span className="cc-name">{display}</span>}
                <p>{text}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
