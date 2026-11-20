import { useEffect, useMemo, useRef, useState } from 'react'
import { nf, type CharMessagesData, type CharMsgLine, type CharMsgRoom, type Character } from '../data'
import { commanderName, pickLang, useLang, type ContentLang } from '../lang'
import { fmt, useUI, type UIKey } from '../ui'

/** 短信正文按内容语言取值；缺失时回退简中。 */
const textOf = (ln: CharMsgLine, lang: ContentLang): string =>
  lang === 'en' ? (ln[5] || ln[2])
    : lang === 'ko' ? (ln[6] || ln[2])
      : lang === 'ja' ? (ln[7] || ln[2])
        : ln[2]

/** 房间类别 → UI 词典 key */
const CAT_KEY: Record<string, UIKey | null> = {
  blabla: 'msg_cat_blabla',
  main: 'msg_cat_main',
}
/** CAT_KEY 没有词典 key 时的中文回退（zh 渲染与现行一致） */
const CAT_LABEL: Record<string, string> = {
  blabla: '巴拉聊天',
  main: '主线短信',
}

/** 成员表只挂了房主、实际有多人发言的房间也算群聊 */
function isGroup(room: CharMsgRoom): boolean {
  return room.m.length > 1 || Object.keys(room.sn).length > 1
}

type FlowItem =
  | { t: 'line'; i: number; pick?: boolean }
  | { t: 'choice'; group: number[]; start: number }

/** 会话头像：私聊用角色头像，群聊加一个成员数角标；没有头像时用首字兜底 */
function RoomAvatar({ room, avatarOf, name, small = false }: {
  room: CharMsgRoom
  avatarOf: (id: number) => string | null
  /** 显示名（本地化后的房间标题），仅在没有头像时取首字兜底 */
  name?: string
  small?: boolean
}) {
  const first = room.m[0]
  const url = first ? avatarOf(first[0]) : null
  return (
    <span className={`mc-avatar ${small ? 'sm' : ''}`}>
      {url ? <img src={url} alt="" loading="lazy" /> : <b>{(name || room.t).slice(0, 1)}</b>}
      {isGroup(room) && <i>{room.m.length > 1 ? room.m.length : Object.keys(room.sn).length}</i>}
    </span>
  )
}

/** 会话列表里的最后一句预览，跳过选项和系统提示 */
function previewOf(room: CharMsgRoom, lang: ContentLang): string {
  for (let i = room.l.length - 1; i >= 0; i--) {
    const [kind, , , , choice] = room.l[i]
    if (choice || kind === 2) continue
    return textOf(room.l[i], lang).replace(/\s*\n\s*/g, ' ')
  }
  const last = room.l[room.l.length - 1]
  return last ? textOf(last, lang).replace(/\s*\n\s*/g, ' ') : ''
}

/**
 * 角色短信查看器：会话列表 + 聊天气泡 + 玩家回复分支。
 *
 * 数据来自 public/data/char_messages.json。房间里的 `next` 是脚本表的 ref
 * 跳转（-1 表示顺序往下），`choice=1` 的连续行是一组玩家回复选项。
 * 选了哪一项就跳它自己的 ref，分支跑完再在 ref 指向的合流点汇合——
 * 和游戏里的巴拉聊天一致。
 */
export default function MessageChat({
  data,
  rooms,
  accent,
  charName,
  avatarOf,
  chars = [],
}: {
  data: CharMessagesData
  rooms: string[]
  accent: string
  charName: string
  avatarOf: (id: number) => string | null
  chars?: Character[]
}) {
  const { lang } = useLang()
  const t = useUI()
  const charById = useMemo(() => new Map(chars.map((c) => [c.id, c])), [chars])

  /** 房间标题显示名：私聊标题就是角色中文名时换成本地化角色名；
   *  群聊名与对不上档案的成员保留数据原文（无官方翻译）。 */
  const titleOf = (room: CharMsgRoom): string => {
    if (isGroup(room)) return room.t
    const first = room.m[0]
    if (!first || !first[1] || room.t !== first[1]) return room.t
    const ch = first[0] != null ? charById.get(first[0]) : undefined
    return ch ? pickLang(lang, ch.name, ch.names.en, ch.names.ko, ch.names.ja) : room.t
  }
  const [ri, setRi] = useState(0)
  const [cat, setCat] = useState<'all' | 'chat' | 'group'>('all')
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [picks, setPicks] = useState<Record<string, number>>({})
  const feedRef = useRef<HTMLDivElement>(null)
  const prevId = useRef<string | undefined>(undefined)
  const prevOpen = useRef(false)

  const counts = useMemo(() => {
    let chat = 0, group = 0
    for (const id of rooms) {
      const r = data.rooms[id]
      if (!r) continue
      if (isGroup(r)) group++
      else chat++
    }
    return { all: rooms.length, chat, group }
  }, [rooms, data])

  const visible = useMemo(
    () => rooms.filter((id) => {
      const r = data.rooms[id]
      if (!r) return false
      if (cat === 'all') return true
      return cat === 'group' ? isGroup(r) : !isGroup(r)
    }),
    [rooms, data, cat],
  )

  useEffect(() => { setRi(0) }, [cat])
  useEffect(() => { setPicks({}) }, [ri, cat])

  const currentId = visible[Math.min(ri, Math.max(0, visible.length - 1))]
  const room: CharMsgRoom | null = currentId ? data.rooms[currentId] : null

  // 切房间 / 从会话列表返回时把聊天区滚进视野；首次挂载不跳，避免刚打开角色页就被拽走。
  // 用前后值比较而不是 firstMount 标记：StrictMode 会重复执行一次 effect，标记会被提前消耗。
  useEffect(() => {
    const first = prevId.current === undefined
    const idChanged = prevId.current !== currentId
    const closed = prevOpen.current && !open
    prevId.current = currentId
    prevOpen.current = open
    if (first || open || (!idChanged && !closed)) return
    const el = feedRef.current
    if (!el) return
    const y = el.getBoundingClientRect().top + window.scrollY - 150
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
  }, [currentId, open])

  /** 会话列表：分类过滤后再按搜索词过滤 */
  const listRooms = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return visible
    return visible.filter((id) => {
      const r = data.rooms[id]
      if (!r) return false
      return r.t.toLowerCase().includes(needle)
        || r.m.some((x) => x[1].toLowerCase().includes(needle))
    })
  }, [visible, q, data])

  const groups = useMemo(() => {
    if (cat === 'chat') return [{ key: 'chat', label: 'msg_group_chat' as UIKey, rooms: listRooms }]
    if (cat === 'group') return [{ key: 'group', label: 'msg_group_group' as UIKey, rooms: listRooms }]
    return [
      { key: 'chat', label: 'msg_group_chat' as UIKey, rooms: listRooms.filter((id) => data.rooms[id] && !isGroup(data.rooms[id])) },
      { key: 'group', label: 'msg_group_group' as UIKey, rooms: listRooms.filter((id) => data.rooms[id] && isGroup(data.rooms[id])) },
    ].filter((g) => g.rooms.length > 0)
  }, [cat, listRooms, data])

  /** 沿 next / 选项 ref 游走，得到要渲染的行与选项组 */
  const flow = useMemo<FlowItem[]>(() => {
    if (!room || !currentId) return []
    const out: FlowItem[] = []
    let cur = 0
    let guard = 0
    while (cur >= 0 && cur < room.l.length && guard++ < 3000) {
      const line = room.l[cur]
      if (line[4] === 1) {
        const group: number[] = []
        let j = cur
        while (j < room.l.length && room.l[j][4] === 1) { group.push(j); j++ }
        out.push({ t: 'choice', group, start: cur })
        const pick = picks[`${currentId}:${cur}`]
        if (pick == null) break
        const opt = group[pick]
        out.push({ t: 'line', i: opt, pick: true })
        const nxt = room.l[opt][3]
        cur = nxt >= 0 ? nxt : opt + 1
        continue
      }
      out.push({ t: 'line', i: cur })
      cur = line[3] >= 0 ? line[3] : cur + 1
    }
    return out
  }, [room, currentId, picks])

  if (!room) return null

  const hasChoice = Object.keys(picks).some((k) => k.startsWith(currentId + ':'))
  const pickKey = (start: number) => `${currentId}:${start}`
  const switchable = rooms.length > 1
  /** 房间类别显示名：优先走 UI 词典（CAT_KEY），无 key 的类别回退中文现行文案 */
  const catKey = CAT_KEY[room.c]
  const catName = (catKey ? t(catKey) : '') || CAT_LABEL[room.c] || '巴拉聊天'

  return (
    <div className="mc">
      {open ? (
        <div className="mc-picker mc-picker-full">
          <div className="mc-picker-head">
            <button className="mc-back" onClick={() => { setOpen(false); setQ('') }}>
              {t('msg_back')}
            </button>
            <span className="mc-picker-title">{t('msg_pick_title')}</span>
            <span className="mc-picker-total">{fmt(t('msg_count_total'), { n: rooms.length })}</span>
          </div>
          <div className="mc-picker-bar">
            <input
              className="mc-search"
              placeholder={t('msg_search_ph')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="mc-cats">
            <button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>
              {t('voice_all')} <b>{counts.all}</b>
            </button>
            {counts.chat > 0 && (
              <button className={cat === 'chat' ? 'on' : ''} onClick={() => setCat('chat')}>
                {t('msg_group_chat')} <b>{counts.chat}</b>
              </button>
            )}
            {counts.group > 0 && (
              <button className={cat === 'group' ? 'on' : ''} onClick={() => setCat('group')}>
                {t('msg_group_group')} <b>{counts.group}</b>
              </button>
            )}
          </div>
          <div className="mc-list">
            {groups.map((g) => (
              <div className="mc-group" key={g.key}>
                {cat === 'all' && (
                  <div className="mc-group-label">{t(g.label)} <b>{g.rooms.length}</b></div>
                )}
                {g.rooms.map((id) => {
                  const r = data.rooms[id]
                  if (!r) return null
                  const on = id === currentId
                  const no = id.match(/_(\d+)$/)?.[1] || ''
                  return (
                    <button
                      key={id}
                      className={`mc-item ${on ? 'on' : ''}`}
                      onClick={() => {
                        const idx = visible.indexOf(id)
                        if (idx >= 0) setRi(idx)
                        setOpen(false)
                        setQ('')
                      }}
                    >
                      <RoomAvatar room={r} avatarOf={avatarOf} name={titleOf(r)} small />
                      <span className="mc-item-main">
                        <b>{titleOf(r)}</b>
                        <span>{previewOf(r, lang)}</span>
                      </span>
                      <span className="mc-item-side">
                        <em>{no ? `${no} · ` : ''}{nf(r.l.length)} {t('unit_msgs')}</em>
                        {r.c === 'main' && <i>{t('msg_main_tag')}</i>}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
            {listRooms.length === 0 && <div className="mc-empty">{t('msg_none_matched')}</div>}
          </div>
        </div>
      ) : (
        <>
          <div className="mc-top">
            <div className="mc-current">
              <RoomAvatar room={room} avatarOf={avatarOf} name={titleOf(room)} />
              <div className="mc-current-main">
                <b>{titleOf(room)}</b>
                <em>
                  {catName}
                  {' · '}{isGroup(room)
                    ? fmt(t('msg_group_n'), { n: room.m.length > 1 ? room.m.length : Object.keys(room.sn).length })
                    : t('msg_private')}
                  {' · '}{nf(room.l.length)} {t('unit_msgs')}
                </em>
              </div>
            </div>
            <div className="mc-top-actions">
              {hasChoice && (
                <button className="mc-reset" onClick={() => setPicks({})} title={t('msg_reset_title')}>
                  {t('msg_reset_pick')}
                </button>
              )}
              {switchable && (
                <button className="mc-switch" onClick={() => setOpen(true)}>
                  {t('msg_switch')} <i>▾</i>
                </button>
              )}
            </div>
          </div>

          <div className="cc-feed mc-feed" ref={feedRef}>
            {flow.map((it, idx) => {
              if (it.t === 'choice') {
                const sel = picks[pickKey(it.start)]
                return (
                  <div className="cc-choice" key={`c${it.start}`}>
                    <span className="cc-choice-label">{t('cc_choice_reply')}</span>
                    {it.group.map((ln, oi) => (
                      <button
                        key={ln}
                        className={sel === oi ? 'on' : ''}
                        style={sel === oi ? { borderColor: accent, color: accent } : undefined}
                        onClick={() => setPicks((p) => ({ ...p, [pickKey(it.start)]: oi }))}
                      >
                        <i />
                        <span>{textOf(room.l[ln], lang)}</span>
                      </button>
                    ))}
                  </div>
                )
              }

              const [kind, slug] = room.l[it.i]
              const text = textOf(room.l[it.i], lang)
              const prev = idx > 0 ? flow[idx - 1] : null
              const prevLine = prev?.t === 'line' ? room.l[prev.i] : null
              const sameSpeaker = kind === 0 && prevLine?.[0] === 0 && prevLine?.[1] === slug

              if (kind === 2) {
                return (
                  <div className="mc-sys" key={`s${it.i}`}>
                    <span>{text}</span>
                  </div>
                )
              }
              if (kind === 1) {
                return (
                  <div className="cc-msg me" key={`p${it.i}`}>
                    <div className="cc-bubble">
                      <span className="cc-name">{commanderName(lang)}</span>
                      <p>{text}</p>
                    </div>
                  </div>
                )
              }

              const meta = slug ? room.sn[slug] : undefined
              const memChar = meta?.[0] != null ? charById.get(meta[0]) : undefined
              const name = memChar
                ? pickLang(lang, memChar.name, memChar.names.en, memChar.names.ko, memChar.names.ja)
                : (meta?.[1] || charName)
              const avatar = meta?.[0] != null ? avatarOf(meta[0]) : null
              return (
                <div className="cc-msg" key={`m${it.i}`}>
                  {!sameSpeaker && (
                    avatar
                      ? <span className="cc-ava"><img src={avatar} alt="" loading="lazy" /></span>
                      : <span className="cc-ava cc-ava-ph" aria-hidden>{name.slice(0, 1)}</span>
                  )}
                  <div className="cc-bubble">
                    {!sameSpeaker && <span className="cc-name" style={{ color: accent }}>{name}</span>}
                    <p>{text}</p>
                  </div>
                </div>
              )
            })}
            {flow.length === 0 && <div className="cc-loading">{t('cc_empty')}</div>}
          </div>

          {visible.length > 1 && (
            <div className="cc-foot mc-foot">
              <button className="cc-nav" disabled={ri <= 0} onClick={() => setRi((v) => Math.max(0, v - 1))}>
                {t('cc_prev')}
              </button>
              <span className="cc-pos">{Math.min(ri, visible.length - 1) + 1} / {visible.length}</span>
              <button
                className="cc-nav"
                disabled={ri >= visible.length - 1}
                onClick={() => setRi((v) => Math.min(visible.length - 1, v + 1))}
              >
                {t('cc_next')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
