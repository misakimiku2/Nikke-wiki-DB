import { useLang, type ContentLang } from './lang'
import { fmt } from './ui'

type Row = readonly [string, string, string, string]

const DICT = {
  game_subtitle: ['渐逝的爱意', 'Fading Affection', '사라지는 애정', '消えゆく愛情'],
  region_map: ['地区地图', 'Region map', '지역 지도', '地域マップ'],
  field_map: ['FIELD MAP / 旧市地区域', 'FIELD MAP / SURFACE REGION', '필드 맵 / 지상 지역', 'フィールドマップ / 地表地域'],
  hp: ['体力', 'HP', '체력', '体力'],
  food: ['粮食', 'Food', '식량', '食料'],
  erosion: ['侵蚀', 'Erosion', '침식', '侵蝕'],
  kind_save: ['已储存', 'Saved', '저장됨', '保存済み'],
  kind_deleted: ['已删除', 'Deleted', '삭제됨', '削除済み'],
  kind_fragment: ['仅剩一部分', 'Fragment', '일부만 남음', '断片のみ'],
  music: ['音乐', 'Music', '음악', '音楽'],
  music_hint: ['BGM / 环境音', 'BGM / Ambience', 'BGM / 환경음', 'BGM / 環境音'],
  sfx: ['音效', 'Sound effects', '효과음', '効果音'],
  sfx_hint: ['按钮 / 打字', 'Buttons / Typing', '버튼 / 타이핑', 'ボタン / タイピング'],
  audio_settings: ['音频设置', 'Audio settings', '오디오 설정', 'オーディオ設定'],
  close_audio: ['关闭音频设置', 'Close audio settings', '오디오 설정 닫기', 'オーディオ設定を閉じる'],
  close: ['关闭', 'Close', '닫기', '閉じる'],
  muted: ['已静音', 'Muted', '음소거됨', 'ミュート中'],
  mute_all: ['全部静音', 'Mute all', '전체 음소거', 'すべてミュート'],
  unmute: ['取消静音', 'Unmute', '음소거 해제', 'ミュート解除'],
  mute: ['静音', 'Mute', '음소거', 'ミュート'],
  reset_default: ['恢复默认', 'Reset', '기본값 복원', '初期値に戻す'],
  done: ['完成', 'Done', '완료', '完了'],
  memory_detail: ['记忆详情', 'Memory details', '기억 상세', '記憶の詳細'],
  ending_detail: ['结局详情', 'Ending details', '결말 상세', '結末の詳細'],
  memory_card_title: ['内存 / MEMORY', 'MEMORY', '메모리', 'メモリ'],
  memory: ['内存', 'Memory', '메모리', 'メモリ'],
  back_node: ['返回上一节点', 'Previous node', '이전 노드로', '前のノードへ'],
  back_home: ['返回主菜单', 'Main menu', '메인 메뉴', 'メインメニュー'],
  dev_ui_editor: ['UI 拼图编辑器（仅开发模式）', 'UI editor (dev only)', 'UI 편집기 (개발 모드)', 'UI エディター（開発モード）'],
  dev_unlock_all: ['强制解锁全部进度（仅开发模式）', 'Unlock all progress (dev only)', '모든 진행도 해제 (개발 모드)', 'すべての進捗を解放（開発モード）'],
  exit_fullscreen: ['退出全屏', 'Exit fullscreen', '전체화면 종료', '全画面を終了'],
  game_fullscreen: ['小游戏全屏', 'Fullscreen', '전체화면', '全画面表示'],
  clear_save: ['清除存档', 'Clear save', '저장 데이터 삭제', 'セーブを消去'],
  start_record: ['开始记录', 'Start record', '기록 시작', '記録を開始'],
  enter_story: ['进入 Marian 活动剧情', 'Open the Marian event story', 'Marian 이벤트 스토리 열기', 'Marian イベントストーリーを開く'],
  story: ['活动剧情', 'Event story', '이벤트', 'イベント'],
  memories: ['记忆', 'Memory', '기억', '記憶'],
  endings: ['回想', 'Endings', '결말', '結末'],
  home_lead: [
    '三段记录，三种人生。每一次死亡都会留下记忆，每一个结局都可能改写前路。记忆是钥匙，开启新的路线、地点与真相。',
    'Three records, three lives. Every death leaves a memory, and every ending may rewrite the path ahead. Memories are keys, opening new routes, places, and truths.',
    '세 개의 기록, 세 개의 인생. 모든 죽음은 기억을 남기고, 모든 결말은 앞길을 바꿀 수 있습니다. 기억은 열쇠이며, 새로운 경로와 장소, 진실을 열어갑니다.',
    '三つの記録、三つの人生。すべての死は記憶を残し、すべての結末が先路を変える可能性があります。記憶は鍵であり、新しいルート、場所、真実を開きます。',
  ],
  route_select: ['记录选择', 'Select record', '기록 선택', '記録を選択'],
  previous_ending: ['前一条记录的结局', 'the previous record’s ending', '이전 기록의 결말', '前の記録の結末'],
  unlock_after_ending: ['观看【{name}】结局后解锁', 'Finish “{name}” to unlock', '「{name}」 결말을 보면 해제됩니다', '「{name}」の結末を見ると解放されます'],
  back_story: ['返回剧情', 'Back to story', '스토리로 돌아가기', 'ストーリーに戻る'],
  back_routes: ['返回路线选择', 'Back to records', '기록 선택으로', '記録選択に戻る'],
  ending_locked: ['尚未收录的结局', 'Ending not recorded', '미수록 결말', '未収録の結末'],
  explore_unlock: ['继续探索以解锁', 'Keep exploring to unlock', '계속 탐색하여 해제', '探索を続けて解放'],
  memories_lead: ['记录在 NIMPH 里的记忆，是开启新路线的钥匙。', 'Memories kept in NIMPH are keys to new routes.', 'NIMPH에 저장된 기억은 새로운 경로를 여는 열쇠입니다.', 'NIMPHに記録された記憶は、新しいルートを開く鍵です。'],
  memory_locked: ['未储存的记忆', 'Memory not stored', '저장되지 않은 기억', '保存されていない記憶'],
  choose_region: ['在地图上选择要前往的地区', 'Choose a region on the map', '지도에서 이동할 지역을 선택하세요', 'マップで向かう地域を選択してください'],
  click_continue: ['点击画面继续', 'Click to continue', '클릭하여 계속', 'クリックして続ける'],
  memory_saved_prefix: ['已储存的记忆：', 'Saved memory: ', '저장된 기억: ', '保存済みの記憶：'],
  memory_pending_prefix: ['待储存的记忆：', 'Memory pending save: ', '저장 대기 중인 기억: ', '保存待ちの記憶：'],
  no_new_record: ['无新纪录', 'No new record', '새 기록 없음', '新しい記録なし'],
  recorded: ['已记录：{name}', 'Recorded: {name}', '기록 완료: {name}', '記録済み：{name}'],
  restart: ['重新记录', 'Record again', '다시 기록', 'もう一度記録'],
  ending_recorded_note: ['该结局已记录在档案中', 'This ending is already in the archive', '이 결말은 이미 기록되었습니다', 'この結末はすでに記録されています'],
  ending_unrecorded_note: ['仅「重新记录」会保存，返回上一节点视为放弃', 'Only “Record again” saves it; going back discards this ending', '「다시 기록」을 눌러야 저장되며, 이전 노드로 돌아가면 포기됩니다', '「もう一度記録」でのみ保存され、前のノードへ戻ると破棄されます'],
  record: ['记录', 'Record', '기록', '記録'],
  erosion_threshold: ['达到 {n} 进入侵蚀状态', 'Erosion begins at {n}', '{n}에 도달하면 침식 상태가 됩니다', '{n}に達すると侵蝕状態になります'],
  req_memory: ['需要【{name}】', 'Requires “{name}”', '「{name}」이(가) 필요합니다', '「{name}」が必要です'],
  req_ending: ['观看【{name}】结局后解锁', 'Finish “{name}” to unlock', '「{name}」 결말을 보면 해제됩니다', '「{name}」の結末を見ると解放されます'],
  req_state: ['需要{name}', 'Requires {name}', '{name}이(가) 필요합니다', '{name}が必要です'],
  req_state_value: ['需要{name} ≥ {n}', 'Requires {name} ≥ {n}', '{name}이(가) {n} 이상 필요합니다', '{name}が{n}以上必要です'],
  clear_confirm: ['清除全部本地进度？\n（结局、记忆、访问过的页面、已选选项全部重置）', 'Clear all local progress?\n(Endings, memories, visited pages, and selected choices will be reset.)', '모든 로컬 진행도를 삭제할까요?\n(결말, 기억, 방문한 페이지, 선택한 항목이 모두 초기화됩니다.)', 'すべてのローカル進捗を消去しますか？\n（結末、記憶、訪問ページ、選択済み項目がすべてリセットされます）'],
  load_error: ['数据加载失败：', 'Failed to load data: ', '데이터 로드 실패: ', 'データの読み込みに失敗しました：'],
  loading: ['正在读取活动数据…', 'Loading event data…', '이벤트 데이터를 읽는 중…', 'イベントデータを読み込み中…'],
} as const

export type FadingUIKey = keyof typeof DICT

export function fadingUIText(lang: ContentLang, key: FadingUIKey, vars?: Record<string, string | number>): string {
  const row: Row = DICT[key]
  const index = lang === 'en' ? 1 : lang === 'ko' ? 2 : lang === 'ja' ? 3 : 0
  const text = row[index] || row[0]
  return vars ? fmt(text, vars) : text
}

export function useFadingUI() {
  const { lang } = useLang()
  return (key: FadingUIKey, vars?: Record<string, string | number>) => fadingUIText(lang, key, vars)
}
