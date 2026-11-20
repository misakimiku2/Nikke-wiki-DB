/**
 * 网站公告 / 发布说明。
 * 人工维护：发新公告时在数组头部加一条，重新构建部署即可（页面按数组顺序展示，最新在前）。
 * slug 用于详情页 URL（/notice/<slug>），发布后不要再改，免得外链失效。
 * tag 建议用：上线 / 功能 / 数据 / 修复 / 维护（展示时经 ui.ts 词典本地化）。
 *
 * 四语：zh 是站方原文必填；en / ko / ja 可选，缺失回退 zh。公告本体的换行、
 * 配图与译文数组一一对应，图片条目在译文里原样保留（cap 可给对应语言图注）。
 */
/** 一行文字的四语版本：zh 必填，en/ko/ja 缺失回退 zh。简写字符串 = 仅中文。 */
export type NoticeText = { zh: string; en?: string; ko?: string; ja?: string }
/** 正文条目：文字（四语）或配图（img + 可选四语图注） */
export type NoticeBodyItem = NoticeText | { img: string; cap?: NoticeText }

export type Notice = {
  /** 详情页 URL 标识，如 'site-search' → /notice/site-search */
  slug: string
  /** 发布日期，YYYY-MM-DD */
  date: string
  tag: string
  title: NoticeText
  /** 列表卡片右侧的封面图（可选）。给头像/头肩裁切图时卡片会按 contain 显示，
   *  避免全身立绘被 object-fit: cover 裁成半截。不给则退回正文第一张配图。 */
  thumb?: string
  /** 正文（文字行与配图按顺序混排），每个元素渲染为一行 / 一张图 */
  body: NoticeBodyItem[]
}

export const NOTICES: Notice[] = [
  {
    slug: 'site-i18n-full',
    date: '2026-11-21',
    tag: '功能',
    title: {
      zh: '全站界面四语化完成 + 手机顶栏重排 + 公告四语上线',
      en: 'Site-wide four-language UI, mobile top-bar redesign and localized notices',
      ko: '전체 UI 4개 언어화, 모바일 상단 바 재배치, 공지 4개 언어화',
      ja: 'サイト全体のUI4言語化、モバイルトップバー再配置、お知らせの4言語化',
    },
    body: [
      {
        zh: '顶栏与全站界面文案四语化完成：角色详情的属性卡（等级 / 装备 / 魔方 / 珍藏品）、模型查看器按钮与悬停提示、CG 图鉴与查看器、剧情阅读器、首页、搜索、公告页等全部支持中 / 英 / 韩 / 日。此前仍是中文的装备部位与词条、魔方与珍藏品名称、配装码弹窗等已一并补齐（HP / ATK / DEF 等通用缩写保持原样）。',
        en: 'The interface is now fully localized in four languages: the character stat panel (level / equip / cube / favorite item), model-viewer buttons & tooltips, the CG gallery & viewer, the story reader, the home page, search and notices all support 中文 / English / 한국어 / 日本語. The remaining Chinese-only bits — equip parts & option names, cube and favorite-item names, the build-code dialog — are included too (universal abbreviations like HP / ATK / DEF stay as-is).',
        ko: '인터페이스가 완전히 4개 언어를 지원합니다: 캐릭터 스탯 패널(레벨 / 장비 / 큐브 / 즐겨찾기 아이템), 모델 뷰어 버튼과 툴팁, CG 갤러리와 뷰어, 스토리 리더, 홈, 검색, 공지 페이지까지 中文 / English / 한국어 / 日本語 대응. 중국어로만 남아 있던 장비 부위·옵션명, 큐브와 즐겨찾기 아이템 이름, 빌드 코드 창도 함께 추가했습니다(HP / ATK / DEF 등 공용 약어는 그대로).',
        ja: 'UIの四言語化が完了しました：キャラのステータスパネル（レベル / 装備 / キューブ / お気に入りアイテム）、モデルビューアのボタンとツールチップ、CGギャラリーとビューア、ストーリーリーダー、ホーム、検索、お知らせまで 中文 / English / 한국어 / 日本語 対応。中国語のみだった装備部位・オプション名、キューブとお気に入りアイテム名、構成コード画面も追加しました（HP / ATK / DEF 等の共通略語はそのまま）。',
      },
      {
        zh: '手机竖屏顶栏重排：导航收进抽屉（新增「网站公告」入口），内容语言切换与主题按钮常驻不被挤走；抽屉结构也为后续新增功能预留了空间。',
        en: 'The mobile portrait top bar is rearranged: navigation moves into a slide-down drawer (with a new Notices entry), while the content-language switch and theme button always stay visible; the drawer leaves room for future additions.',
        ko: '모바일 세로 화면 상단 바를 재배치했습니다: 내비게이션은 드로어로 들어가고(공지 항목 신설) 콘텐츠 언어 전환과 테마 버튼은 항상 보입니다. 드로어 구조는 앞으로의 기능 추가를 위한 여유도 남깁니다.',
        ja: 'モバイル縦画面のトップバーを再配置しました：ナビゲーションはドロワーに収まり（お知らせ項目を新設）、コンテンツ言語切替とテーマボタンは常に表示されます。今後の機能追加のための余裕も残す構造です。',
      },
      {
        zh: '首次访问自动跟随浏览器语言（中文 / English / 한국어 / 日本語，其余语言默认英文）；手动切换过语言的浏览器不受影响，?lang= 分享链接依旧优先。',
        en: 'First visits now follow the browser language (中文 / English / 한국어 / 日本語, others default to English). Browsers that have manually picked a language are unaffected, and ?lang= share links keep priority.',
        ko: '첫 방문 시 브라우저 언어를 따릅니다(中文 / English / 한국어 / 日本語, 그 외는 영어). 언어를 직접 선택한 브라우저는 영향이 없으며, ?lang= 공유 링크가 여전히 우선합니다.',
        ja: '初回アクセスはブラウザの言語に従います（中文 / English / 한국어 / 日本語、それ以外は英語）。言語を手動選択したブラウザは影響を受けず、?lang= の共有リンクが優先されます。',
      },
      {
        zh: '角色页个人剧情章节名接入游戏官方四语（Locale_NikkeEpisode）：974 个章节中 964 个有官方译名，其余回退中文。',
        en: 'Personal-story chapter names now use the game\'s official four-language text (Locale_NikkeEpisode): 964 of 974 chapters carry official names, the rest fall back to Chinese.',
        ko: '개인 스토리 챕터 이름에 게임 공식 4개 언어 텍스트(Locale_NikkeEpisode)를 적용했습니다: 974개 챕터 중 964개가 공식 명칭을 가지며, 나머지는 중국어로 표시됩니다.',
        ja: '個人ストーリーのチャプター名にゲーム公式の四言語テキスト（Locale_NikkeEpisode）を適用しました：974章のうち964章が公式名を持ち、残りは中国語で表示されます。',
      },
      {
        zh: 'CG 剧情链接卡片四语化：段落首句台词、说话人名与段落标题按当前语言显示（1,381 条链接全部覆盖台词；旁白与无角色档案的 NPC 说话人、部分活动段名回退中文）。',
        en: 'CG story-link cards are localized: the scene\'s first line, the speaker\'s name and the section title follow the current language (all 1,381 links carry line translations; narrators, NPCs without a character profile and some event section names fall back to Chinese).',
        ko: 'CG 스토리 링크 카드가 현지화되었습니다: 장면 첫 대사, 화자 이름, 절 제목이 현재 언어를 따릅니다(1,381개 링크 전체에 대사 번역 포함. 나레이터·캐릭터档案이 없는 NPC·일부 이벤트 절명은 중국어 대체).',
        ja: 'CGストーリーリンクカードをローカライズしました：シーンの最初の台詞・話者名・節タイトルが現在の言語に追従します（1,381リンクすべてに台詞訳を収録。ナレーター・プロファイルのないNPC・一部イベント節名は中国語で表示）。',
      },
      {
        zh: '首页台词轮播四语化：非中文语言显示站内翻译，并如实标注「Translated from the game / 게임 원문 번역 / ゲーム原文（翻訳）」。',
        en: 'The home-page quote carousel is localized: non-Chinese languages show our own translation, honestly labeled “Translated from the game / 게임 원문 번역 / ゲーム原文（翻訳）”.',
        ko: '홈 대사 롤링이 4개 언어화되었습니다: 중국어 외 언어는 사이트 번역을 사용하며 「Translated from the game / 게임 원문 번역 / ゲーム原文（翻訳）」로 솔직하게 표기합니다.',
        ja: 'ホームの台詞ローテーションも四言語化：中国語以外はサイト側の翻訳を「Translated from the game / 게임 원문 번역 / ゲーム原文（翻訳）」と明記して表示します。',
      },
      {
        zh: '公告 / 更新日志自本条起提供四语版本，切换内容语言时自动切换对应公告；历史公告也已补齐译文。',
        en: 'Notices / release logs are available in four languages from this post on and follow the content-language switch; past notices have been translated as well.',
        ko: '이 공지부터 공지 / 업데이트 로그도 4개 언어를 제공하며 콘텐츠 언어 전환을 따라갑니다. 과거 공지도 번역을 보완했습니다.',
        ja: '本公告からお知らせ / 更新ログも四言語を提供し、コンテンツ言語の切替に追従します。過去のお知らせも翻訳を補いました。',
      },
    ],
  },
  {
    slug: 'multi-lang-en-ko',
    date: '2026-11-20',
    tag: '功能',
    title: {
      zh: '英 / 韩 / 日三语内容与配音上线：全局语言切换 + 四档角色配音',
      en: 'English / Korean / Japanese content & voices: global language switch + four voice tracks',
      ko: '영어 / 한국어 / 일본어 콘텐츠와 보이스 추가: 전역 언어 전환 + 4종 캐릭터 보이스',
      ja: '英・韓・日コンテンツとボイスを追加：グローバル言語切替 + 4種のキャラボイス',
    },
    body: [
      {
        zh: '顶栏新增「中 / EN / KO / JA」内容语言切换。切换后，角色名、角色介绍与签名、技能名称与说明、剧情对白、咨询对话、巴拉短信都会换成对应的游戏官方文本；界面导航与功能按钮仍保持中文。',
        en: 'The top bar gains a 中 / EN / KO / JA content-language switch. Character names, profiles & quotes, skill names & descriptions, story dialogue, counseling and message chats all switch to the game\'s official text; navigation and UI buttons remain in Chinese at this stage.',
        ko: '상단에 中 / EN / KO / JA 콘텐츠 언어 전환이 추가되었습니다. 전환하면 캐릭터 이름, 프로필과 대사, 스킬 이름과 설명, 스토리 대사, 상담, 블라 채팅이 게임 공식 텍스트로 바뀝니다(이 시점에는 내비게이션과 버튼이 중국어 유지).',
        ja: 'トップバーに「中 / EN / KO / JA」のコンテンツ言語切替を追加しました。切り替えると、キャラ名、プロフィールと署名、スキル名と説明、ストーリー対話、カウンセリング、ブラブラチャットがゲーム公式テキストに切り替わります（この時点ではナビゲーションとボタンは中国語のまま）。',
      },
      {
        zh: '全站 482,126 条剧情台词已补齐英文、韩文与日文（覆盖率约 100%），数据直接取自客户端 Locale_* 本地化库的 en / ko / ja 三列，不是机翻。角色档案、技能说明、术语弹窗（武器 / 兵种 / 属性 / 企业）也同步支持四语。',
        en: 'All 482,126 story lines now have English, Korean and Japanese (≈100% coverage), taken directly from the client\'s Locale_* localization tables — not machine translation. Character profiles, skill descriptions and the glossary popups (weapons / classes / elements / manufacturers) support the four languages as well.',
        ko: '전체 482,126줄의 스토리 대사에 영어·한국어·일본어가 보완되었습니다(약 100%). 데이터는 클라이언트 Locale_* 로컬라이제이션 DB의 en / ko / ja 컬럼에서 직접 가져온 것으로 기계번역이 아닙니다. 캐릭터 프로필, 스킬 설명, 용어 팝업(무기 / 클래스 / 속성 / 제작사)도 4개 언어를 지원합니다.',
        ja: '全482,126件のストーリー台詞に英語・韓国語・日本語を追加しました（約100%）。データはクライアントのLocale_*ローカライズDBのen / ko / ja列から直接取得したもので、機械翻訳ではありません。キャラプロフィール、スキル説明、用語ポップアップ（武器 / クラス / 属性 / 企業）も四言語対応です。',
      },
      {
        zh: '角色语音区为四档：中配、日配、英配、韩配。英/韩语音从国际服游戏内下载的语言包（en / ko 资源池）提取，日配即站内原有主音轨；每种语言每个角色一条 OGG 雪碧图、按采样级时间轴逐条播放，某条语音在对应语言缺失时会跳过，不会串到别的语言。国服先行角色、部分联动角色可能缺档。',
        en: 'The voice section now has four tracks: CN / JP / EN / KR. English and Korean audio are extracted from the language packs downloaded in the global client (the en / ko pools); the JP track is the site\'s original main track. Each language keeps one OGG sprite per character, played clip by clip on a sample-accurate timeline; missing clips are skipped in that language, never substituted with another. CN-first and some collab characters may have gaps.',
        ko: '보이스 영역이 4트랙입니다: 중국어 / 일본어 / 영어 / 한국어. 영어·한국어 음성은 글로벌 클라이언트에서 내려받은 언어 팩(en / ko 풀)에서 추출했고, 일본어는 사이트의 기존 메인 트랙입니다. 언어별로 캐릭터마다 OGG 스프라이트 하나를 샘플 단위 타임라인으로 재생하며, 해당 언어에서 누락된 항목은 다른 언어로 대체하지 않고 건너뜁니다. 중국서버 선행 캐릭터와 일부 콜라보 캐릭터는 누락이 있을 수 있습니다.',
        ja: 'ボイス欄は4トラックです：中国語 / 日本語 / 英語 / 韓国語。英語・韓国語ボイスはグローバル版クライアントでダウンロードした言語パック（en / ko プール）から抽出し、日本語はサイトの既存メイントラックです。言語ごとにキャラ1本のOGGスプライトをサンプル精度のタイムラインで再生し、該当言語で欠落している項目は別言語に置き換えずスキップします。中国サーバー先行キャラや一部コラボキャラは欠落がある場合があります。',
      },
      {
        zh: '剧情目录与章节名、部队名、全站搜索（按当前语言搜对应语言文本）也已四语化；主线 / 支线故事单元标题覆盖率 100%，个人剧情 89%，活动 51%——游戏里没有官方译名的条目（部分活动名、宝物剧情、日常/补充文本）回退中文显示。装备 / 魔方配装面板与公告正文仍为中文。',
        en: 'Story chapter lists, squad names and the site-wide search (which searches the text of the current language) are localized too: main / sub story unit titles 100%, personal stories 89%, events 51% — entries without official translations (some event names, treasure stories, daily / supplementary text) fall back to Chinese. The equip / cube loadout panel and notice bodies were still Chinese-only at this stage.',
        ko: '스토리 목록과 챕터명, 부대명, 전체 검색(현재 언어의 텍스트를 검색)도 현지화했습니다: 메인 / 서브 유닛 제목 100%, 개인 스토리 89%, 이벤트 51% — 공식 번역이 없는 항목(일부 이벤트명, 보물 스토리, 일상 / 보충 텍스트)은 중국어로 표시됩니다(이 시점에는 장비 / 큐브 패널과 공지 본문이 중국어 전용).',
        ja: 'ストーリー目次とチャプター名、部隊名、サイト内検索（現在の言語のテキストを検索）も対応しました：メイン / サブのユニット題名 100%、個人ストーリー 89%、イベント 51% — 公式訳がない項目（一部イベント名、宝物ストーリー、日常 / 補足テキスト）は中国語で表示されます（この時点では装備 / キューブ パネルとお知らせ本文は中国語のみ）。',
      },
    ],
  },
  {
    slug: 'story-reader-overhaul',
    date: '2026-11-20',
    tag: '功能',
    title: {
      zh: '剧情阅读器大更新：章节重切、真实节名、选项分支与剧情卡片',
      en: 'Story reader overhaul: real chapters, official section names, choices and character cards',
      ko: '스토리 리더 대개편: 실제 챕터, 공식 절 이름, 선택지와 캐릭터 카드',
      ja: 'ストーリーリーダー大更新：実際のチャプター、公式節名、選択肢とキャラカード',
    },
    thumb: '/cover/5341c5961e8f2ba0.webp',
    body: [
      {
        zh: '主线剧情按游戏真实章节边界重新切分（共 51 章），每章的小节名不再用「第X节」占位，而是直接使用游戏内官方节名——例如第 4 章「献花」依次为「变形的齿轮 → 特种部队：A/B → 判决 → 模仿人类 → 告别 → 献花 → 指挥官的命令 → 小小的报复 → 一路朝北 → 娱——乐！」。节名来自解包出的权威映射表，覆盖后记段与 A/B 分支。',
        en: 'The main story is re-cut along the game\'s real chapter boundaries (51 chapters in total). Section names are no longer “Section X” placeholders — they are the official in-game section names; e.g. chapter 4 「献花 (Offering)」 runs ten named sections ending at 「娱——乐！」 (Enter—tainment!). The mapping comes from unpacked game data and covers epilogue and A/B-branch segments.',
        ko: '메인 스토리를 게임의 실제 챕터 경계에 맞춰 재편집했습니다(총 51챕터). 절 이름은 더 이상 「제X절」 자리표시가 아니라 게임 내 공식 절 이름입니다. 예를 들어 4챕터 「헌화(献花)」는 열 개의 이름 있는 절로 이어집니다. 매핑은 언팩한 게임 데이터 기준이며 에필로그와 A/B 분기도 포함합니다.',
        ja: 'メインストーリーをゲームの実際のチャプター境界に沿って再編成しました（全51チャプター）。節名は「第X節」のプレースホルダーではなくゲーム内公式の節名です。例えば4章「献花」は十の命名された節で構成されます。マッピングは解包したゲームデータに基づき、エピローグとA/B分岐もカバーします。',
      },
      {
        zh: '剧情选项现在可以交互了：一处出现多个选项时，点击后会按你选的分支裁剪后续内容（沿用咨询对话的分支机制），共 1000 多段剧情支持；只有一个选项的段落仍保持原样直接阅读。',
        en: 'Story choices are now interactive: where multiple options appear, picking one trims the following text to that branch (the same mechanism as counseling), covering 1,000+ story segments; single-option segments read as before.',
        ko: '스토리 선택지가 인터랙티브하게 바뀌었습니다: 여러 선택지가 나오는 곳에서 하나를 고르면 이후 내용이 해당 분기로 정리됩니다(상담과 같은 분기 방식, 1,000개 이상의 스토리 구간 지원). 선택지가 하나뿐인 구간은 기존처럼 바로 읽힙니다.',
        ja: 'ストーリーの選択肢がインタラクティブになりました：複数の選択肢がある場面では、選ぶと以降の本文がその分岐に沿って表示されます（カウンセリングと同じ分岐方式、1,000以上のセグメントに対応）。選択肢が1つだけの場面は従来どおりそのまま読めます。',
      },
      {
        zh: '主线与活动剧情的章节目录页顶部新增「剧情主视觉卡片」：带封面图、章节 / 句数、首段摘要，以及「开始阅读」按钮。SKY ON THE ROCK 保留专属开屏主视觉，其余单元自动使用各自的剧情封面。',
        en: 'Main and event chapter pages gained a story key-visual card: cover art, chapter / line counts, a first-section excerpt and a Start Reading button. SKY ON THE ROCK keeps its dedicated key visual; other units use their story covers.',
        ko: '메인·이벤트 챕터 페이지 상단에 「스토리 키 비주얼 카드」가 추가되었습니다: 커버 아트, 챕터 / 줄 수, 첫 장면 발췌와 읽기 시작 버튼. SKY ON THE ROCK은 전용 키 비주얼을 유지하고 나머지는 각자의 스토리 커버를 사용합니다.',
        ja: 'メイン・イベントのチャプターページ上部に「ストーリーキービジュアルカード」が付きました：カバー絵、チャプター / 台詞数、最初の場面の抜粋、「読み始める」ボタン。SKY ON THE ROCK は専用キービジュアルを維持し、他のユニットは各ストーリーのカバーを使用します。',
      },
      {
        zh: '登场角色卡按剧情阶段显示正确身份：玛丽安在「坠落 / 侵蚀」是玛丽安、中段变为神罚、「开战」之后是玛丽安：女王；「继承」章拉毗与拉毗：小红帽同时登场、此后均为小红帽版，艾玛 / 贝斯蒂 / 银华换上战术升级；「对话」起拉普拉斯 / 德雷克 / 麦斯威尔变为究极英雄 / 终极反派 / 平凡技师；「独一」起阿妮斯为超级巨星、「钥匙」起尼恩为透视之眼；「行动」起白雪公主 / 红莲 / 长发公主换上重型武装 / 弑神 / 圣域；「开战」之后桃乐丝为异端、诺雅为新生。',
        en: 'Featured-character cards track each character\'s identity per story phase — Marian is Marian through 坠落 / 侵蚀, becomes Modernia after 开战; Rapi is joined by Rapi: Red Hood from the 继承 chapter onward (with Emma / Bay / 银华 in their Tactical Upgrade variants); Laplace / Drake / Maxwell become the Ultimate trio from 对话; Anis turns Superstar from 独一 and Neon gains X-ray Eyes from 钥匙; Snow White / Scarlet / Rapunzel swap into their armed variants from 行动; and from 开战 Dorothy is Heretic while Noah is Reborn.',
        ko: '등장 캐릭터 카드가 스토리 단계별로 올바른 신분을 표시합니다 — 마리안은 「추락 / 침식」에서는 마리안, 「개전」 이후 모데니아; 「계승」 챕터부터 라피와 라피: 붉은 후드가 함께 등장하고(이후는 모두 붉은 후드), 엠마 / 베스티 / 은화는 전술업그레이드 버전으로 교체; 「대화」부터 라플라스 / 드레이크 / 맥스웰이 얼티메이트 트리오로; 「독특」부터 아니스는 슈퍼스타, 「열쇠」부터 넨은 엑스레이 아이즈; 「행동」부터 백설공주 / 스칼렛 / 라푼젤이 무장 변형으로; 「개전」 이후 도로시는 이단자, 노아는 리본입니다.',
        ja: '登場キャラカードがストーリー段階ごとの正しい正体を表示します — マリアンは「墜落 / 侵食」ではマリアン、「開戦」の後はモデニア; 「継承」章からラピとラピ：レッドフードが同時登場し（以降はレッドフード版）、エマ / ベスティ / 銀華は戦術アップグレード版に; 「対話」からラプラス / ドレイク / マクスウェルがアルティメット組に; 「唯一」からアニスはスーパースター、「鍵」からネオンは透視の目; 「行動」から白雪姫 / スカーレット / ラプンツェルは武装版に; 「開戦」の後はドロシーが異端者、ノアが新生です。',
      },
      {
        zh: 'CG 与剧情的关联做了全链路核查：接回人工校对表、补齐漏链、排除一张模型切片裸贴图；剧情封面去重并修复裂图，驱逐专属 CG 等手工指定封面已生效。',
        en: 'The CG ↔ story mapping was audited end to end: the hand-curated table is re-attached, missing links restored, one raw model-slice texture excluded; story covers were de-duplicated and broken images fixed, and manual cover overrides now take effect.',
        ko: 'CG ↔ 스토리 매핑을 전 구간 점검했습니다: 수동 대조표를 다시 연결하고 누락 링크를 복구했으며 모델 슬라이스 원본 텍스처 한 장을 제외했습니다. 스토리 커버의 중복 제거와 깨진 이미지 수정도 이루어졌고, 수동 커버 지정이 정상 적용됩니다.',
        ja: 'CG↔ストーリー対応を全域チェックしました：手動対照表を再接続し、欠落リンクを復旧、モデルスライスの生テクスチャ1枚を除外。ストーリーカバーの重複排除と壊れた画像の修正も行い、手動カバー指定が反映されるようになりました。',
      },
      {
        zh: '最后，剧情列表页的标题搜索框已移除——顶部全站搜索已覆盖剧情标题与台词，输入即搜，不必在两处分别查找。',
        en: 'Finally, the title search box on the story list page is gone — the site-wide search already covers story titles and lines, so search once at the top instead of twice.',
        ko: '마지막으로 스토리 목록 페이지의 제목 검색창을 제거했습니다 — 상단 전체 검색이 이미 스토리 제목과 대사를 모두 커버하므로, 위에서 한 번만 검색하면 됩니다.',
        ja: '最後に、ストーリー一覧ページの題名検索ボックスを廃止しました — 上部のサイト内検索がストーリー題名と台詞を両方カバーするので、探すのは上で一度だけです。',
      },
    ],
  },
  {
    slug: 'sky-cn-first-chars',
    date: '2026-11-20',
    tag: '数据',
    title: {
      zh: '新 SSR「思凯」资料上线 & 国服特供角色（婴宁/画皮）补全',
      en: 'New SSR “Sky” added & CN-exclusive characters (Yingning / Huapi) completed',
      ko: '신규 SSR 「스카이(Sky)」 자료 추가 & 중국서버 전용 캐릭터(응닉 / 화피) 완비',
      ja: '新SSR「スカイ」データ公開 & 中国サーバー限定キャラ（嬰寧 / 画皮）を完備',
    },
    thumb: '/charmi/c530_00.webp',
    body: [
      {
        zh: '昨日实装的新 SSR「思凯」（Sky）资料已全量上线：档案（超地平线部队 / 极乐净土 / 辅助型 / 狙击步枪 / 爆裂Ⅰ）、技能数值、站姿与战斗姿态立绘、43 条语音（日配，CV 根本优奈；国服暂未配中文，游戏内亦是日语原声）。',
        en: 'Full data for yesterday\'s new SSR “Sky” is live: profile (超地平线 squad / 极乐净土, supporter class, sniper rifle, Burst Ⅰ), skill values, standing & combat poses, and 43 voice lines (JP, CV Nemoto Yuna; no CN dub yet — the game itself uses the JP voice).',
        ko: '어제 실장한 신규 SSR 「스카이(Sky)」 데이터가 전부 반영되었습니다: 프로필(초지평선 부대 / 극락정토, 서포터 / 저격 소총 / 버스트Ⅰ), 스킬 수치, 대기·전투 포즈 일러스트, 43줄 보이스(일본어, CV 네모토 유나. 중국서버 미수록 — 게임 내에서도 일본어 음성).',
        ja: '昨日実装の新SSR「スカイ（Sky）」のデータを全量公開しました：プロフィール（超地平線部隊 / 極楽浄土 / サポーター / スナイプライフル / バーストⅠ）、スキル数値、立ち・戦闘ポーズ、43本のボイス（日本語、CV 根本優奈。中国サーバー未収録で、ゲーム内も日本語音声）。',
      },
      { img: '/char/c530_00.webp', cap: { zh: '本次实装的新 SSR「思凯」（Sky）', en: 'The new SSR “Sky” from this update', ko: '이번에 실장된 신규 SSR 「스카이(Sky)」', ja: '今回実装の新SSR「スカイ（Sky）」' } },
      {
        zh: '她的大招 cut-in 也已收录——这是站内首个三镜头运镜的大招（城市段推进 → 冲刺动感模糊 → 角色骨骼特写），播放器为它做了分段运镜与跳变检测的专门适配，欢迎到思凯的角色页点开大招动画体验。',
        en: 'Her burst cut-in is included too — the site\'s first three-shot camera cut-in (city push-in → sprint motion blur → close-up on the character rig). The player got dedicated segment-camera and cut-detection handling for it; try the burst animation on Sky\'s character page.',
        ko: '그녀의 버스트 컷인도 수록되었습니다 — 사이트 최초의 3컷 카메라 연출 컷인(도시 프리젠트 → 스프린트 모션 블러 → 캐릭터 리그 클로즈업). 플레이어에 구간 카메라와 컷 전환 감지를 전용 적용했으니 스카이 캐릭터 페이지에서 버스트 애니메이션을 재생해 보세요.',
        ja: '彼女のバーストカットインも収録しました — サイト初の3ショットカメラ演出カットイン（都市部のプッシュイン → スプリントのモーションブラー → キャラリグのクローズアップ）。プレーヤーに区間カメラとカット検出の専用対応を実装済みです。スカイのキャラページでぜひ再生してみてください。',
      },
      {
        zh: '国服特供角色「婴宁」「画皮」的资料页补全：所属部队（聊斋志异部队）、制造企业（米西利斯）、兵种（辅助 / 火力）、武器（发射器「狐仙梅」/ 步枪「诡画箱」）、爆裂阶段与水冷属性，以及完整的技能展示——技能名与描述来自国服客户端文本，画皮描述中的「模仿状态」专有名词支持点击查看解释。',
        en: 'Profiles of the CN-exclusive characters 「婴宁 (Yingning)」 and 「画皮 (Huapi)」 are completed: squad (聊斋志异), manufacturer (Missilis), classes (supporter / firepower), weapons (launcher 「狐仙梅」 / rifle 「诡画箱」), burst stage and water element, plus full skill showcases — skill names and descriptions come from the CN client text, and the “imitation state” term in Huapi\'s description is clickable for its gloss.',
        ko: '중국서버 전용 캐릭터 「응닉(嬰寧)」과 「화피(畫皮)」의 프로필을 완비했습니다: 소속 부대(료자이지이 부대), 제작사(미시리스), 클래스(서포터 / 화력), 무기(런처 「호선매(狐仙梅)」 / 라이플 「괴화상(詭畫箱)」), 버스트 단계와 수냉 속성, 전체 스킬 쇼케이스까지 — 스킬명과 설명은 중국 클라이언트 텍스트 기반이며 화피 설명의 「모방 상태」 용어는 클릭하면 해설이 나옵니다.',
        ja: '中国サーバー限定キャラ「嬰寧（インニン）」「画皮（ガヒ）」のプロフィールを完備しました：所属部隊（聊斎志異部隊）、製作企業（ミシリス）、クラス（サポーター / 火力）、武器（ランチャー「狐仙梅」 / ライフル「詭画箱」）、バースト段階と水冷属性、スキルの一覧まで — スキル名と説明は中国クライアントのテキストで、画皮の説明にある「摸倣状態」の用語はクリックで解説を表示できます。',
      },
      {
        zh: '两位角色的语音升级为中日双轨：默认播放国服中文配音（婴宁 CV 阎么么、画皮 CV 楚越），可一键切换日配（金元寿子 / 大原沙耶香），各 43 条。',
        en: 'Both characters now carry CN + JP voice tracks: the default is the CN-server Chinese dub (婴宁 CV Yan Meme / 画皮 CV Chu Yue), one tap switches to JP (Kanemoto Hisako / Ohara Sayaka), 43 lines each.',
        ko: '두 캐릭터의 보이스가 중·일 이중 트랙으로: 기본은 중국서버 중국어 더빙(응닉 CV 옌머머 / 화피 CV 추위에), 한 번의 클릭으로 일본어(카네모토 히사코 / 오하라 사야카)로 전환, 각 43줄입니다.',
        ja: '両キャラのボイスが中・日デュアルトラックに：既定は中国サーバーの中国語ボイス（嬰寧 CV 閻么么 / 画皮 CV 楚越）、ワンタップで日本語（金元寿子 / 大原沙耶香）へ切替、各43本です。',
      },
      {
        zh: '语音与筛选一并更新：新增「登录」分类（172 名角色共 234 条，其中 190 条有中文）；三套国服限定皮肤语音上线（神罚「蝶恋花语」、桃乐丝「宴桃源」、丽塔「黄发垂髫」，各 42 条）；预览区支持按皮肤 / 类别点击筛选。本次共新增约 820 条中文语音，全站中配率由 68.4% 提升至 73.1%。',
        en: 'Voices and filters updated together: a new “Login” category (234 lines across 172 characters, 190 with Chinese); three CN-limited skin voice sets go live (Modernia 「蝶恋花语」, Dorothy 「宴桃源」, Rita 「黄发垂髫」, 42 lines each); the preview area filters by skin / category on click. About 820 new Chinese voice lines in total, lifting the site\'s CN-dub coverage from 68.4% to 73.1%.',
        ko: '보이스와 필터를 함께 업데이트했습니다: 새 「로그인」 카테고리(캐릭터 172명 234줄, 190줄은 중국어), 중국서버 한정 스킨 보이스 3세트 공개(모더니아 「접련화어」, 도로시 「연도원」, 리타 「황발수기」, 각 42줄), 미리보기에서 스킨 / 카테고리 클릭 필터 지원. 이번에 약 820줄의 중국어 보이스가 추가되어 사이트 중국어 더빙 비율이 68.4% → 73.1%로 올라갔습니다.',
        ja: 'ボイスとフィルタを同時更新しました：「タイトル」カテゴリを新設（172キャラ234本、190本が中国語）、中国サーバー限定スキンボイス3セットを公開（モデニア「蝶恋花語」、ドロシー「宴桃源」、リタ「黄発垂髫」、各42本）、プレビューはスキン / カテゴリのクリック絞り込みに対応。合計約820本の中国語ボイスを追加し、サイトの中国語ボイス率が68.4%→73.1%に上昇しました。',
      },
      {
        zh: '另外两项体验优化：剧情列表卡片改用自动挑选的封面图（可用配置人工指定）；阅读器 CG 背景随滚动渐显、移动端背景铺满阅读区，角色详情页的姿态标签在移动端默认收起。',
        en: 'Two more UX tweaks: story list cards use auto-picked cover art (manual override supported); reader CG backgrounds fade in with scrolling and fill the reading area on mobile, and pose tabs default to collapsed on the character page for mobile.',
        ko: '체험 개선 두 가지: 스토리 목록 카드가 자동 선정 커버로 바뀌었고(수동 지정 가능), 리더의 CG 배경이 스크롤에 맞춰 나타나며 모바일에서 읽기 영역을 채우고, 캐릭터 페이지의 포즈 탭은 모바일에서 기본 접힘입니다.',
        ja: ' UX改善2点：ストーリーリストのカードが自動選定のカバーに変わり（手動指定も可）、リーダーのCG背景がスクロールに合わせてフェードインし、モバイルでは閲覧領域を満たします。キャラページのポーズタブはモバイルで初期折りたたみです。',
      },
      {
        zh: '一点说明：技能的逐级数值（Lv1-10）存于国服加密数据包中，暂时缺失，页面上以「—」占位；等数据包解密流程打通后会自动补齐，届时公告会再说明。',
        en: 'A note: per-level skill values (Lv1–10) live in the CN server\'s encrypted data packs and are missing for now — the page shows “—” placeholders. They will fill in automatically once the decryption pipeline opens, with a follow-up notice.',
        ko: '참고: 스킬의 레벨별 수치(Lv1–10)는 중국서버 암호화 데이터 팩에 들어 있어 당장은 누락 상태이며, 페이지에는 「—」 자리표시가 나타납니다. 복호화 파이프라인이 열리면 자동으로 채워지고 공지로 다시 알려드립니다.',
        ja: '補足：スキルのレベル別数値（Lv1–10）は中国サーバーの暗号化データパックにあり現時点で未収録です — ページでは「—」を表示します。復号パイプラインが開通すれば自動補完し、改めてお知らせします。',
      },
    ],
  },
  {
    slug: 'site-search',
    date: '2026-11-19',
    tag: '功能',
    title: {
      zh: '全站搜索上线，公告页开放',
      en: 'Site-wide search launched, Notices page open',
      ko: '전체 검색 공개, 공지 페이지 오픈',
      ja: 'サイト内検索を公開、お知らせページ オープン',
    },
    body: [
      {
        zh: '顶部「搜索」升级为全站搜索：一次输入，同时检索角色、CG、剧情段落与台词，结果以卡片分组展示。',
        en: 'The top “Search” is now a site-wide search: one query searches characters, CGs, story segments and lines at once, with results grouped into cards.',
        ko: '상단 「검색」이 전체 검색으로 업그레이드되었습니다: 한 번의 입력으로 캐릭터, CG, 스토리 장면과 대사를 동시에 검색하고 결과를 카드별로 묶어 보여줍니다.',
        ja: '上部の「検索」がサイト全体検索になりました：1回の入力でキャラ・CG・ストーリー場面・台詞を同時検索し、結果をカードごとに表示します。',
      },
      {
        zh: '角色支持按部队名、企业名以及兵种 / 武器 / 属性等档案维度检索（例：搜「反击部队」「伊甸园」直达对应角色）；CG 支持通过关联剧情的中文名检索；台词全量统计后按页浏览。',
        en: 'Characters can be found by squad name, manufacturer, or profile facets like class / weapon / element (e.g. search 「反击部队 Counters」 or 「伊甸园 Eden」 to jump straight to those squads); CGs are searchable via their linked story\'s Chinese title; all lines can be browsed page by page.',
        ko: '캐릭터는 부대명, 제작사, 클래스 / 무기 / 속성 등 프로필 조건으로 검색할 수 있습니다(예: 「카운터스部队」「에덴園」 검색 시 해당 캐릭터로 바로 이동). CG는 연결된 스토리의 중국어 제목으로 검색할 수 있고, 대사는 전량 집계해 페이지별로 열람할 수 있습니다.',
        ja: 'キャラは部隊名・製作企業・クラス / 武器 / 属性などのプロフィール条件で検索できます（例：「カウンターズ部隊」「エデン園」で該当キャラに直接ジャンプ）。CGは関連ストーリーの中国語題名で検索でき、台詞は全量を集計してページごとに閲覧できます。',
      },
      {
        zh: '新增「网站公告」页（即本页）：以后的数据更新、功能调整与问题修复都会在这里发布说明，支持图文混排。',
        en: 'New “Notices” page (this one): data updates, feature changes and fixes will be announced here, with mixed text and images.',
        ko: '「사이트 공지」 페이지가 추가되었습니다(이 페이지): 앞으로 데이터 업데이트, 기능 조정, 수정 사항을 여기에 발표하며 글과 그림을 섞어 쓸 수 있습니다.',
        ja: '「お知らせ」ページを追加しました（このページです）：今後のデータ更新・機能調整・修正はここで発表し、文章と画像を混在させられます。',
      },
      {
        zh: '首页改为游戏原文台词轮播（选自主线第 50 章「决战」与活动剧情「Marian」）；顶栏换上 NIKKE 官方字标，浏览器标签图标同步更新。',
        en: 'The home page now rotates in-game quotes (from main story chapter 50 「决战 Showdown」 and the 「Marian」 event); the top bar wears the official NIKKE wordmark and the favicon is updated to match.',
        ko: '홈이 게임 원문 대사 롤링으로 바뀌었습니다(메인 50챕터 「결전(決戦)」과 이벤트 「Marian」에서 발췌). 상단 바에는 NIKKE 공식 워드마크를 적용하고 브라우저 탭 아이콘도 함께 새로 담았습니다.',
        ja: 'ホームがゲーム原文台詞のローテーション表示になりました（メイン50章「決戦」とイベント「Marian」より抜粋）。トップバーはNIKKE公式ワードマークに、ブラウザタブのアイコンも更新しました。',
      },
      {
        zh: '深浅主题切换改为从按钮处圆形扩散的过渡效果；修复 CG 图鉴翻页浏览后返回回到顶部的问题。',
        en: 'Theme switching now spreads from the button as a circular reveal; fixed the CG gallery resetting to the top when returning from the viewer.',
        ko: '테마 전환이 버튼 위치에서 원형으로 퍼지는 전환 효과로 바뀌었고, CG 갤러리에서 뷰어로 다녀온 뒤 맨 위로 초기화되던 문제를 고쳤습니다.',
        ja: 'テーマ切替はボタン位置から円形に広がる演出に変わり、CGギャラリーから戻った際に最上部へ巻き戻る問題を修正しました。',
      },
    ],
  },
  {
    slug: 'launch',
    date: '2026-11-19',
    tag: '上线',
    title: {
      zh: 'NIKKE 资料库正式上线',
      en: 'NIKKE Database is live',
      ko: 'NIKKE 데이터베이스 정식 오픈',
      ja: 'NIKKEデータベース 正式オープン',
    },
    body: [
      {
        zh: '站点部署于 Cloudflare Pages（nikke-db-wiki.pages.dev），纯静态托管，国内可直接访问。',
        en: 'The site is hosted on Cloudflare Pages (nikke-db-wiki.pages.dev) as a pure static build — directly accessible from mainland China.',
        ko: '사이트는 Cloudflare Pages(nikke-db-wiki.pages.dev)에 순수 정적으로 호스팅되어 중국 본토에서도 바로 접속할 수 있습니다.',
        ja: 'サイトは Cloudflare Pages（nikke-db-wiki.pages.dev）の純静的ホスティングで、中国本土からも直接アクセスできます。',
      },
      {
        zh: '首版收录 312 名角色、528,256 条剧情台词、1,768 张 CG、668 个剧情单元，全部来自客户端本地解包，游戏更新即同步。',
        en: 'The first release covers 312 characters, 528,256 story lines, 1,768 CGs and 668 story units — all unpacked from the game client and synced with game updates.',
        ko: '첫 버전은 캐릭터 312명, 스토리 대사 528,256줄, CG 1,768장, 스토리 유닛 668개를 수록했으며 모두 게임 클라이언트 로컬 언팩 기반으로 게임 업데이트에 맞춰 갱신됩니다.',
        ja: '初版はキャラ312体、ストーリー台詞528,256件、CG 1,768枚、ストーリーユニット668件を収録。すべてゲームクライアントのローカル解包によるもので、ゲーム更新に合わせて同期します。',
      },
      {
        zh: '后续的数据更新、功能调整与问题修复都会在公告页发布。',
        en: 'Data updates, feature changes and fixes will be announced on the Notices page.',
        ko: '이후 데이터 업데이트, 기능 조정, 문제 수정은 공지 페이지에 발표됩니다.',
        ja: '今後のデータ更新・機能調整・修正はお知らせページで発表します。',
      },
    ],
  },
]
