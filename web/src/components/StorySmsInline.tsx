import type { StorySmsGroup } from '../data'

/**
 * 剧情正文里内嵌的巴拉短信面板。
 *
 * 由 StoryReader 在对应剧情段落之后（少数在之前）插入，用手机气泡展示
 * 这段剧情里发生的群聊/私信，保留上下文，不再单独列一个短信目录。
 */
export default function StorySmsInline({ group }: { group: StorySmsGroup }) {
  const lines = group.l.filter((x) => x[3])
  return (
    <section className="story-sms-inline">
      <div className="ssi-head">
        <span className="ssi-badge">巴拉短信</span>
        <span className="ssi-title">{group.t}</span>
        <span className="ssi-meta">{group.label} · {lines.length} 条</span>
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
                  <span className="cc-name">指挥官</span>
                  <p>{text}</p>
                </div>
              </div>
            )
          }

          const part = slug ? group.parts[slug] : undefined
          const avatar = part?.[2] || null
          const display = name || part?.[1] || '未知'
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
