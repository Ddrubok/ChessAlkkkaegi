import { I18nManager, type LanguageCode } from "./i18n";

export type { LanguageCode };

/**
 * 활성 언어 코드 조회 (I18nManager 및 브라우저/SSR 환경 안전 조회)
 */
export function getCurrentLanguage(): LanguageCode {
  return I18nManager.getLanguage();
}

export type RuntimeTextKey =
  // Progress
  | "progress.guest_device_stored"
  | "progress.local_cache_failed"
  | "progress.mastery_pending_cached"
  | "progress.saving"
  | "progress.account_changed_reloading"
  | "progress.loading"
  | "progress.corrupted_cache"
  | "progress.backup_failed_no_replace"
  | "progress.conflict_backed_up"
  | "progress.loaded_mastery_pending"
  | "progress.loaded"
  | "progress.mastery_version_conflict"
  | "progress.mastery_unsafe"
  | "progress.load_failed"
  | "progress.saved_mastery_pending"
  | "progress.saved_conflict_resolved"
  | "progress.saved"
  | "progress.save_delayed_retrying"
  | "progress.save_delayed_check_conn"
  | "progress.backup_failed"
  | "progress.cache_create_failed"
  | "progress.use_server_mastery_pending"
  | "progress.use_server_merging"
  | "progress.use_server"
  // Startup
  | "startup.loading_assets"
  | "startup.loading_models_percent"
  | "startup.loading_models_bytes"
  | "startup.preparing_physics"
  | "startup.stabilizing_pieces"
  | "startup.init_failed"
  // Online Settlement & Rematch
  | "online.settle_retry_btn"
  | "online.settle_checking_opponent"
  | "online.settle_waiting_opponent"
  | "online.settle_opponent_info"
  | "online.settle_failed"
  | "online.reconnect_overlay_title"
  | "online.reconnect_overlay_disconnected"
  | "online.reconnect_overlay_prompt"
  | "online.reconnect_overlay_create_code"
  | "online.reconnect_overlay_abandon"
  | "online.reconnect_exchanging_codes"
  | "online.reconnect_syncing_state"
  | "online.rematch_btn"
  | "online.rematch_cancel_btn"
  | "online.rematch_accept_btn"
  | "online.rematch_decline_btn"
  | "online.rematch_waiting_response"
  | "online.rematch_preparing"
  | "online.rematch_failed_start"
  | "online.rematch_failed_hash_mismatch"
  | "online.rematch_requested"
  | "online.rematch_declined"
  // Manual P2P Online Lobby
  | "manual_online.resuming_match"
  | "manual_online.connected_preparing"
  | "manual_online.generating_invite_code"
  | "manual_online.send_invite_prompt"
  | "manual_online.paste_invite_prompt"
  | "manual_online.generating_answer_code"
  | "manual_online.send_answer_prompt"
  | "manual_online.send_reconnect_answer_prompt"
  | "manual_online.applying_answer_code"
  | "manual_online.code_copied"
  | "manual_online.label_invite_code"
  | "manual_online.label_answer_code"
  // Matchmaking
  | "matchmaking.joining_queue"
  | "matchmaking.searching_standard"
  | "matchmaking.searching_range"
  | "matchmaking.match_found_info"
  | "matchmaking.match_found_name"
  | "matchmaking.turn_delayed_researching"
  | "matchmaking.default_opponent_name"
  | "matchmaking.signaling_sending_answer"
  | "matchmaking.signaling_confirming"
  | "matchmaking.signaling_creating_offer"
  | "matchmaking.signaling_responding"
  | "matchmaking.connected_starting_game"
  | "matchmaking.connecting_friend"
  | "matchmaking.signaling_exchanging_signals"
  | "matchmaking.cancelled"
  // Net Development Tool
  | "net.title"
  | "net.btn_create_room"
  | "net.btn_copy_invite"
  | "net.label_paste_invite"
  | "net.btn_join"
  | "net.btn_copy_answer"
  | "net.label_paste_answer"
  | "net.btn_connect"
  | "net.msg_placeholder"
  | "net.btn_send_msg"
  | "net.received_messages"
  | "net.no_received_messages"
  | "net.connection_status_prefix"
  | "net.state_idle"
  | "net.state_waiting_answer"
  | "net.state_connecting"
  | "net.state_connected"
  | "net.state_disconnected"
  | "net.state_failed"
  | "net.log_invite_created"
  | "net.log_answer_created"
  | "net.log_answer_applied"
  | "net.log_sent_prefix";

export const RUNTIME_LOCALES: Record<LanguageCode, Record<RuntimeTextKey, string>> = {
  ko: {
    // Progress
    "progress.guest_device_stored": "게스트 진행도는 이 기기에 저장됩니다.",
    "progress.local_cache_failed": "기기 임시 저장에 실패했습니다. 서버 저장 완료 전에는 창을 닫지 마세요.",
    "progress.mastery_pending_cached": "새 숙련 기록은 서버 업데이트 전까지 이 계정의 기기 캐시에 보관됩니다.",
    "progress.saving": "진행도를 저장하는 중입니다…",
    "progress.account_changed_reloading": "계정이 변경되어 진행도를 다시 불러옵니다…",
    "progress.loading": "계정 진행도를 불러오는 중입니다…",
    "progress.corrupted_cache": "기기 캐시가 손상되어 원본을 보존하고 계정 저장을 멈췄습니다. 복구 후 서버 기록 사용을 선택해 주세요.",
    "progress.backup_failed_no_replace": "충돌한 기기 기록을 백업하지 못해 서버 기록으로 교체하지 않았습니다.",
    "progress.conflict_backed_up": "다른 기기와 충돌한 기록({keys})을 백업했습니다. 어느 기록을 사용할지 선택해 주세요.",
    "progress.loaded_mastery_pending": "계정 진행도를 불러왔습니다. 새 숙련 기록은 서버 업데이트 전까지 이 기기에 보관됩니다.",
    "progress.loaded": "계정 진행도를 불러왔습니다.",
    "progress.mastery_version_conflict": "서로 다른 과거 숙련 조건 기록을 자동 병합하지 않고 원본을 보존했습니다. 복구할 기록을 선택해 주세요.",
    "progress.mastery_unsafe": "숙련 기록 형식이 안전하지 않아 원본을 보존하고 계정 저장을 멈췄습니다. 복구 후 다시 시도해 주세요.",
    "progress.load_failed": "계정 진행도를 불러오지 못했습니다. 연결과 서버 설정을 확인한 뒤 다시 시도해 주세요.",
    "progress.saved_mastery_pending": "기존 진행도는 서버에 저장되었습니다. 새 숙련 기록은 서버 업데이트 전까지 이 기기에 보관됩니다.",
    "progress.saved_conflict_resolved": "충돌한 기존 기록은 백업했고 숙련 기록은 서버와 병합했습니다. 서버 기록을 사용해 계속해 주세요.",
    "progress.saved": "서버에 저장되었습니다.",
    "progress.save_delayed_retrying": "연결 문제로 저장이 지연되고 있습니다. 자동으로 다시 시도합니다.",
    "progress.save_delayed_check_conn": "서버 저장이 지연되고 있습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
    "progress.backup_failed": "기기 기록을 백업하지 못했습니다. 서버 기록으로 교체하지 않았습니다.",
    "progress.cache_create_failed": "서버 기록으로 전환할 안전한 기기 캐시를 만들지 못했습니다.",
    "progress.use_server_mastery_pending": "서버의 기존 진행도를 사용합니다. 숙련 기록은 서버 업데이트 전까지 이 계정의 기기 캐시에 보관됩니다.",
    "progress.use_server_merging": "서버의 기존 진행도를 사용하고 숙련 기록을 병합하는 중입니다…",
    "progress.use_server": "서버 기록을 사용합니다.",

    // Startup
    "startup.loading_assets": "ChessAlkkagi 에셋을 불러오는 중입니다",
    "startup.loading_models_percent": "말 모델을 불러오는 중입니다 {percent}%",
    "startup.loading_models_bytes": "말 모델을 불러오는 중입니다 {size}MB",
    "startup.preparing_physics": "물리 월드를 준비하는 중입니다",
    "startup.stabilizing_pieces": "말의 시작 자세를 안정시키는 중입니다",
    "startup.init_failed": "게임을 시작하지 못했습니다.",

    // Online Settlement & Rematch
    "online.settle_retry_btn": "정산 다시 확인",
    "online.settle_checking_opponent": "상대방의 대전 결과를 확인하고 있습니다.",
    "online.settle_waiting_opponent": "상대방 확인 대기 중입니다. 확인 완료 전에는 전적이 변경되지 않습니다.",
    "online.settle_opponent_info": "상대: {name} · {tier} · {delta}점 · {progress}",
    "online.settle_failed": "정산을 완료하지 못했습니다. 다시 확인해주세요.",
    "online.reconnect_overlay_title": "온라인 대전",
    "online.reconnect_overlay_disconnected": "상대와 연결이 끊겼습니다",
    "online.reconnect_overlay_prompt": "재연결하거나 대국을 종료하세요.",
    "online.reconnect_overlay_create_code": "재연결 코드 만들기",
    "online.reconnect_overlay_abandon": "대국 종료",
    "online.reconnect_exchanging_codes": "새 P2P 연결 코드를 교환하는 중입니다.",
    "online.reconnect_syncing_state": "방장 상태와 대국 기록을 맞추는 중입니다.",
    "online.rematch_btn": "재대결",
    "online.rematch_cancel_btn": "요청 취소",
    "online.rematch_accept_btn": "수락",
    "online.rematch_decline_btn": "거절",
    "online.rematch_waiting_response": "상대 응답을 기다리는 중",
    "online.rematch_preparing": "새 대국을 준비하는 중입니다",
    "online.rematch_failed_start": "재대결 시작 실패: {reason}",
    "online.rematch_failed_hash_mismatch": "재대결 시작 실패: 턴 0 상태가 서로 다릅니다.",
    "online.rematch_requested": "상대가 재대결을 요청했습니다",
    "online.rematch_declined": "상대가 재대결을 거절했습니다",

    // Manual P2P Online Lobby
    "manual_online.resuming_match": "대국을 이어받는 중입니다.",
    "manual_online.connected_preparing": "연결됐습니다. 표준 대국을 준비합니다.",
    "manual_online.generating_invite_code": "ICE 후보를 모아 초대 코드를 만드는 중입니다.",
    "manual_online.send_invite_prompt": "초대 코드 {length}자를 상대에게 보내세요.",
    "manual_online.paste_invite_prompt": "받은 초대 코드를 붙여넣으세요.",
    "manual_online.generating_answer_code": "ICE 후보를 모아 응답 코드를 만드는 중입니다.",
    "manual_online.send_answer_prompt": "응답 코드 {length}자를 방장에게 보내세요.",
    "manual_online.send_reconnect_answer_prompt": "재접속 응답 코드 {length}자를 방장에게 보내세요.",
    "manual_online.applying_answer_code": "응답 코드를 적용해 연결하는 중입니다.",
    "manual_online.code_copied": "{label} {length}자를 복사했습니다.",
    "manual_online.label_invite_code": "초대 코드",
    "manual_online.label_answer_code": "응답 코드",

    // Matchmaking
    "matchmaking.joining_queue": "매치메이킹 대기열에 접속 중...",
    "matchmaking.searching_standard": "적합한 MMR의 상대를 탐색 중...",
    "matchmaking.searching_range": "상대 탐색 중... (MMR ±{diff})",
    "matchmaking.match_found_info": "대전 상대 발견: {nickname} ({mmr})",
    "matchmaking.match_found_name": "대전 상대 발견: {nickname}",
    "matchmaking.turn_delayed_researching": "상대방과의 P2P/TURN 연결이 지연되어 대기열을 다시 탐색합니다...",
    "matchmaking.default_opponent_name": "상대 플레이어",
    "matchmaking.signaling_sending_answer": "P2P 연결 수립 중 (Answer 전송)...",
    "matchmaking.signaling_confirming": "P2P 연결 확정 중...",
    "matchmaking.signaling_creating_offer": "P2P 연결 준비 중 (Offer 생성)...",
    "matchmaking.signaling_responding": "P2P 연결 응답 중...",
    "matchmaking.connected_starting_game": "P2P 연결 성공! 게임을 시작합니다.",
    "matchmaking.connecting_friend": "친구와 1:1 대전을 연결 중입니다...",
    "matchmaking.signaling_exchanging_signals": "P2P 신호를 교환하는 중입니다...",
    "matchmaking.cancelled": "매칭이 취소되었습니다.",

    // Net Development Tool
    "net.title": "P2P 연결 시험",
    "net.btn_create_room": "방 만들기",
    "net.btn_copy_invite": "초대 코드 복사",
    "net.label_paste_invite": "초대 코드 붙여넣기",
    "net.btn_join": "참가",
    "net.btn_copy_answer": "응답 코드 복사",
    "net.label_paste_answer": "응답 코드 붙여넣기",
    "net.btn_connect": "연결",
    "net.msg_placeholder": "보낼 메시지",
    "net.btn_send_msg": "메시지 보내기",
    "net.received_messages": "받은 메시지",
    "net.no_received_messages": "아직 받은 메시지가 없습니다.",
    "net.connection_status_prefix": "연결 상태: {status}",
    "net.state_idle": "대기",
    "net.state_waiting_answer": "응답 코드 대기",
    "net.state_connecting": "연결 중",
    "net.state_connected": "연결됨",
    "net.state_disconnected": "연결 끊김",
    "net.state_failed": "연결 실패",
    "net.log_invite_created": "초대 코드 {length}자를 생성했습니다.",
    "net.log_answer_created": "응답 코드 {length}자를 생성했습니다.",
    "net.log_answer_applied": "응답 코드를 적용했습니다.",
    "net.log_sent_prefix": "보냄: {payload}",
  },

  en: {
    // Progress
    "progress.guest_device_stored": "Guest progress is saved on this device.",
    "progress.local_cache_failed": "Failed to save temporary local data. Do not close this window before server save completes.",
    "progress.mastery_pending_cached": "New mastery records will be kept in device cache until server update.",
    "progress.saving": "Saving progress…",
    "progress.account_changed_reloading": "Account changed. Reloading progress…",
    "progress.loading": "Loading account progress…",
    "progress.corrupted_cache": "Device cache corrupted. Original data preserved and saving halted. Please select Use Server Progress after recovery.",
    "progress.backup_failed_no_replace": "Failed to back up conflicting device records. Server records were not applied.",
    "progress.conflict_backed_up": "Conflicting records with another device ({keys}) have been backed up. Please choose which record to use.",
    "progress.loaded_mastery_pending": "Account progress loaded. New mastery records will be kept on this device until server update.",
    "progress.loaded": "Account progress loaded.",
    "progress.mastery_version_conflict": "Different legacy mastery requirement records were preserved without auto-merge. Please select which record to recover.",
    "progress.mastery_unsafe": "Unsafe mastery record format detected. Original data preserved and saving halted. Please try again after recovery.",
    "progress.load_failed": "Failed to load account progress. Check connection and server settings, then try again.",
    "progress.saved_mastery_pending": "Existing progress saved to server. New mastery records will be kept on this device until server update.",
    "progress.saved_conflict_resolved": "Conflicting legacy records backed up and mastery merged with server. Please continue using server records.",
    "progress.saved": "Saved to server.",
    "progress.save_delayed_retrying": "Saving delayed due to connection issues. Retrying automatically…",
    "progress.save_delayed_check_conn": "Server save is delayed. Please check your connection and try again.",
    "progress.backup_failed": "Failed to back up device records. Server records were not applied.",
    "progress.cache_create_failed": "Failed to create a safe device cache for switching to server records.",
    "progress.use_server_mastery_pending": "Using existing server progress. Mastery records will be kept in device cache until server update.",
    "progress.use_server_merging": "Using existing server progress and merging mastery records…",
    "progress.use_server": "Using server records.",

    // Startup
    "startup.loading_assets": "Loading ChessAlkkagi assets…",
    "startup.loading_models_percent": "Loading piece models {percent}%",
    "startup.loading_models_bytes": "Loading piece models {size}MB",
    "startup.preparing_physics": "Preparing physics world…",
    "startup.stabilizing_pieces": "Stabilizing initial piece positions…",
    "startup.init_failed": "Failed to initialize game.",

    // Online Settlement & Rematch
    "online.settle_retry_btn": "Recheck Settlement",
    "online.settle_checking_opponent": "Checking opponent match result…",
    "online.settle_waiting_opponent": "Waiting for opponent confirmation. Stats will update once verified.",
    "online.settle_opponent_info": "Opponent: {name} · {tier} · {delta} pts · {progress}",
    "online.settle_failed": "Settlement could not be completed. Please check again.",
    "online.reconnect_overlay_title": "Online Match",
    "online.reconnect_overlay_disconnected": "Disconnected from opponent",
    "online.reconnect_overlay_prompt": "Reconnect or exit the match.",
    "online.reconnect_overlay_create_code": "Create Reconnect Code",
    "online.reconnect_overlay_abandon": "Exit Match",
    "online.reconnect_exchanging_codes": "Exchanging new P2P connection codes…",
    "online.reconnect_syncing_state": "Synchronizing host state and match history…",
    "online.rematch_btn": "Rematch",
    "online.rematch_cancel_btn": "Cancel Request",
    "online.rematch_accept_btn": "Accept",
    "online.rematch_decline_btn": "Decline",
    "online.rematch_waiting_response": "Waiting for opponent's response…",
    "online.rematch_preparing": "Preparing new match…",
    "online.rematch_failed_start": "Failed to start rematch: {reason}",
    "online.rematch_failed_hash_mismatch": "Failed to start rematch: Turn 0 initial states mismatch.",
    "online.rematch_requested": "Opponent requested a rematch",
    "online.rematch_declined": "Opponent declined the rematch",

    // Manual P2P Online Lobby
    "manual_online.resuming_match": "Resuming match…",
    "manual_online.connected_preparing": "Connected. Preparing match…",
    "manual_online.generating_invite_code": "Gathering ICE candidates and creating invite code…",
    "manual_online.send_invite_prompt": "Send the {length}-character invite code to your opponent.",
    "manual_online.paste_invite_prompt": "Paste the received invite code.",
    "manual_online.generating_answer_code": "Gathering ICE candidates and creating answer code…",
    "manual_online.send_answer_prompt": "Send the {length}-character answer code to the host.",
    "manual_online.send_reconnect_answer_prompt": "Send the {length}-character reconnect answer code to the host.",
    "manual_online.applying_answer_code": "Applying answer code and connecting…",
    "manual_online.code_copied": "Copied {length} characters of {label}.",
    "manual_online.label_invite_code": "Invite Code",
    "manual_online.label_answer_code": "Answer Code",

    // Matchmaking
    "matchmaking.joining_queue": "Joining matchmaking queue…",
    "matchmaking.searching_standard": "Searching for opponent with similar MMR…",
    "matchmaking.searching_range": "Searching for opponent… (MMR ±{diff})",
    "matchmaking.match_found_info": "Opponent found: {nickname} ({mmr})",
    "matchmaking.match_found_name": "Opponent found: {nickname}",
    "matchmaking.turn_delayed_researching": "P2P/TURN connection to opponent delayed. Searching queue again…",
    "matchmaking.default_opponent_name": "Opponent Player",
    "matchmaking.signaling_sending_answer": "Establishing P2P connection (Sending Answer)…",
    "matchmaking.signaling_confirming": "Confirming P2P connection…",
    "matchmaking.signaling_creating_offer": "Preparing P2P connection (Creating Offer)…",
    "matchmaking.signaling_responding": "Responding to P2P connection…",
    "matchmaking.connected_starting_game": "P2P connected! Starting game…",
    "matchmaking.connecting_friend": "Connecting 1v1 match with friend…",
    "matchmaking.signaling_exchanging_signals": "Exchanging P2P signaling…",
    "matchmaking.cancelled": "Matchmaking cancelled.",

    // Net Development Tool
    "net.title": "P2P Connection Test",
    "net.btn_create_room": "Create Room",
    "net.btn_copy_invite": "Copy Invite Code",
    "net.label_paste_invite": "Paste Invite Code",
    "net.btn_join": "Join",
    "net.btn_copy_answer": "Copy Answer Code",
    "net.label_paste_answer": "Paste Answer Code",
    "net.btn_connect": "Connect",
    "net.msg_placeholder": "Message to send",
    "net.btn_send_msg": "Send Message",
    "net.received_messages": "Received Messages",
    "net.no_received_messages": "No messages received yet.",
    "net.connection_status_prefix": "Connection status: {status}",
    "net.state_idle": "Idle",
    "net.state_waiting_answer": "Waiting for Answer Code",
    "net.state_connecting": "Connecting",
    "net.state_connected": "Connected",
    "net.state_disconnected": "Disconnected",
    "net.state_failed": "Connection Failed",
    "net.log_invite_created": "Generated {length}-character invite code.",
    "net.log_answer_created": "Generated {length}-character answer code.",
    "net.log_answer_applied": "Applied answer code.",
    "net.log_sent_prefix": "Sent: {payload}",
  },

  ja: {
    // Progress
    "progress.guest_device_stored": "ゲストの進行状況はこの端末に保存されます。",
    "progress.local_cache_failed": "端末への一時保存に失敗しました。サーバーへの保存が完了するまでウィンドウを閉じないでください。",
    "progress.mastery_pending_cached": "新しい熟練度記録はサーバー更新まで端末キャッシュに保持されます。",
    "progress.saving": "進行状況を保存しています…",
    "progress.account_changed_reloading": "アカウントが変更されたため進行状況を再読み込みしています…",
    "progress.loading": "アカウントの進行状況を読み込んでいます…",
    "progress.corrupted_cache": "端末キャッシュが破損したため原本を保護し保存を停止しました。復旧後にサーバー記録の使用を選択してください。",
    "progress.backup_failed_no_replace": "競合した端末記録のバックアップに失敗したため、サーバー記録に置換しませんでした。",
    "progress.conflict_backed_up": "他の端末と競合した記録（{keys}）をバックアップしました。使用する記録を選択してください。",
    "progress.loaded_mastery_pending": "アカウントの進行状況を読み込みました。新しい熟練度記録はサーバー更新までこの端末に保持されます。",
    "progress.loaded": "アカウントの進行状況を読み込みました。",
    "progress.mastery_version_conflict": "異なる過去の熟練度条件の記録を自動マージせず原本を保持しました。復元する記録を選択してください。",
    "progress.mastery_unsafe": "熟練度記録の形式が安全でないため原本を保持し保存を停止しました。復旧後に再試行してください。",
    "progress.load_failed": "アカウントの進行状況を読み込めませんでした。接続とサーバー設定を確認の上、再試行してください。",
    "progress.saved_mastery_pending": "従来の進行状況はサーバーに保存されました。新しい熟練度記録はサーバー更新までこの端末に保持されます。",
    "progress.saved_conflict_resolved": "競合した従来の記録をバックアップし、熟練度記録をサーバーとマージしました。サーバー記録で続行してください。",
    "progress.saved": "サーバーに保存されました。",
    "progress.save_delayed_retrying": "接続の問題で保存が遅延しています。自動的に再試行します。",
    "progress.save_delayed_check_conn": "サーバーへの保存が遅延しています。接続を確認して再試行してください。",
    "progress.backup_failed": "端末記録のバックアップに失敗しました。サーバー記録への置換は行っていません。",
    "progress.cache_create_failed": "サーバー記録へ移行するための安全な端末キャッシュを作成できませんでした。",
    "progress.use_server_mastery_pending": "サーバーの既存進行状況を使用します。熟練度記録はサーバー更新まで端末キャッシュに保持されます。",
    "progress.use_server_merging": "サーバーの既存進行状況を使用し、熟練度記録をマージしています…",
    "progress.use_server": "サーバー記録を使用します。",

    // Startup
    "startup.loading_assets": "ChessAlkkagiアセットを読み込んでいます…",
    "startup.loading_models_percent": "駒モデルを読み込んでいます {percent}%",
    "startup.loading_models_bytes": "駒モデルを読み込んでいます {size}MB",
    "startup.preparing_physics": "物理ワールドを準備しています…",
    "startup.stabilizing_pieces": "駒の初期配置を安定させています…",
    "startup.init_failed": "ゲームを開始できませんでした。",

    // Online Settlement & Rematch
    "online.settle_retry_btn": "精算を再確認",
    "online.settle_checking_opponent": "対戦相手の対局結果を確認しています。",
    "online.settle_waiting_opponent": "相手の確認待ちです。確認完了まで戦績は更新されません。",
    "online.settle_opponent_info": "相手: {name} · {tier} · {delta}点 · {progress}",
    "online.settle_failed": "精算を完了できませんでした。再度ご確認ください。",
    "online.reconnect_overlay_title": "オンライン対戦",
    "online.reconnect_overlay_disconnected": "相手との接続が切断されました",
    "online.reconnect_overlay_prompt": "再接続するか対局を終了してください。",
    "online.reconnect_overlay_create_code": "再接続コード作成",
    "online.reconnect_overlay_abandon": "対局終了",
    "online.reconnect_exchanging_codes": "新しいP2P接続コードを交換しています…",
    "online.reconnect_syncing_state": "ホストの状態と対局記録を同期しています…",
    "online.rematch_btn": "再戦",
    "online.rematch_cancel_btn": "リクエスト取消",
    "online.rematch_accept_btn": "受諾",
    "online.rematch_decline_btn": "辞退",
    "online.rematch_waiting_response": "相手の応答を待っています…",
    "online.rematch_preparing": "新しい対局を準備しています…",
    "online.rematch_failed_start": "再戦の開始に失敗しました: {reason}",
    "online.rematch_failed_hash_mismatch": "再戦の開始に失敗しました: ターン0の初期状態が一致しません。",
    "online.rematch_requested": "相手が再戦を希望しています",
    "online.rematch_declined": "相手が再戦を辞退しました",

    // Manual P2P Online Lobby
    "manual_online.resuming_match": "対局を引き継いでいます…",
    "manual_online.connected_preparing": "接続されました。対局を準備します。",
    "manual_online.generating_invite_code": "ICE候補を収集して招待コードを生成しています…",
    "manual_online.send_invite_prompt": "招待コード（{length}文字）を相手に送信してください。",
    "manual_online.paste_invite_prompt": "受け取った招待コードを貼り付けてください。",
    "manual_online.generating_answer_code": "ICE候補を収集して応答コードを生成しています…",
    "manual_online.send_answer_prompt": "応答コード（{length}文字）をホストに送信してください。",
    "manual_online.send_reconnect_answer_prompt": "再接続応答コード（{length}文字）をホストに送信してください。",
    "manual_online.applying_answer_code": "応答コードを適用して接続しています…",
    "manual_online.code_copied": "{label}（{length}文字）をコピーしました。",
    "manual_online.label_invite_code": "招待コード",
    "manual_online.label_answer_code": "応答コード",

    // Matchmaking
    "matchmaking.joining_queue": "マッチメイキング待機列に接続中…",
    "matchmaking.searching_standard": "適切なMMRの対戦相手を検索中…",
    "matchmaking.searching_range": "対戦相手を検索中… (MMR ±{diff})",
    "matchmaking.match_found_info": "対戦相手が見つかりました: {nickname} ({mmr})",
    "matchmaking.match_found_name": "対戦相手が見つかりました: {nickname}",
    "matchmaking.turn_delayed_researching": "相手とのP2P/TURN接続が遅延したため、待機列を再検索します…",
    "matchmaking.default_opponent_name": "対戦相手",
    "matchmaking.signaling_sending_answer": "P2P接続を確立中 (Answer送信)…",
    "matchmaking.signaling_confirming": "P2P接続を確認中…",
    "matchmaking.signaling_creating_offer": "P2P接続を準備中 (Offer生成)…",
    "matchmaking.signaling_responding": "P2P接続に応答中…",
    "matchmaking.connected_starting_game": "P2P接続成功！ゲームを開始します。",
    "matchmaking.connecting_friend": "フレンドとの1対1対戦に接続中…",
    "matchmaking.signaling_exchanging_signals": "P2P信号を交換中…",
    "matchmaking.cancelled": "マッチメイキングがキャンセルされました。",

    // Net Development Tool
    "net.title": "P2P接続テスト",
    "net.btn_create_room": "部屋作成",
    "net.btn_copy_invite": "招待コードをコピー",
    "net.label_paste_invite": "招待コード貼り付け",
    "net.btn_join": "参加",
    "net.btn_copy_answer": "応答コードをコピー",
    "net.label_paste_answer": "応答コード貼り付け",
    "net.btn_connect": "接続",
    "net.msg_placeholder": "送信メッセージ",
    "net.btn_send_msg": "メッセージ送信",
    "net.received_messages": "受信メッセージ",
    "net.no_received_messages": "まだメッセージを受信していません。",
    "net.connection_status_prefix": "接続状態: {status}",
    "net.state_idle": "待機",
    "net.state_waiting_answer": "応答コード待機中",
    "net.state_connecting": "接続中",
    "net.state_connected": "接続完了",
    "net.state_disconnected": "切断",
    "net.state_failed": "接続失敗",
    "net.log_invite_created": "招待コード（{length}文字）を生成しました。",
    "net.log_answer_created": "応答コード（{length}文字）を生成しました。",
    "net.log_answer_applied": "応答コードを適用しました。",
    "net.log_sent_prefix": "送信: {payload}",
  },

  "zh-CN": {
    // Progress
    "progress.guest_device_stored": "游客进度将保存在此设备上。",
    "progress.local_cache_failed": "设备临时保存失败。在服务器保存完成前请勿关闭窗口。",
    "progress.mastery_pending_cached": "新的熟练度记录将在服务器更新前保存在设备缓存中。",
    "progress.saving": "正在保存进度…",
    "progress.account_changed_reloading": "账号已更改，正在重新加载进度…",
    "progress.loading": "正在加载账号进度…",
    "progress.corrupted_cache": "设备缓存损坏，已保留原始数据并停止保存。恢复后请选择使用服务器数据。",
    "progress.backup_failed_no_replace": "未能备份冲突的设备记录，未替换为服务器数据。",
    "progress.conflict_backed_up": "已备份与其他设备冲突的记录（{keys}）。请选择要使用的记录。",
    "progress.loaded_mastery_pending": "已加载账号进度。新的熟练度记录将在服务器更新前保存在此设备上。",
    "progress.loaded": "已加载账号进度。",
    "progress.mastery_version_conflict": "未自动合并不同历史熟练度条件记录，已保留原始数据。请选择要恢复的记录。",
    "progress.mastery_unsafe": "熟练度记录格式不安全，已保留原始数据并停止保存。请在恢复后重试。",
    "progress.load_failed": "未能加载账号进度。请检查网络与服务器设置后重试。",
    "progress.saved_mastery_pending": "现有进度已保存至服务器。新的熟练度记录将在服务器更新前保存在此设备上。",
    "progress.saved_conflict_resolved": "已备份冲突的历史记录，并将熟练度记录与服务器合并。请使用服务器记录继续。",
    "progress.saved": "已保存至服务器。",
    "progress.save_delayed_retrying": "因网络问题保存延迟。正在自动重试…",
    "progress.save_delayed_check_conn": "服务器保存延迟。请检查网络后重试。",
    "progress.backup_failed": "未能备份设备记录，未替换为服务器数据。",
    "progress.cache_create_failed": "未能创建用于切换至服务器记录的安全设备缓存。",
    "progress.use_server_mastery_pending": "使用服务器现有进度。熟练度记录将在服务器更新前保存在设备缓存中。",
    "progress.use_server_merging": "正在使用服务器现有进度并合并熟练度记录…",
    "progress.use_server": "正在使用服务器记录。",

    // Startup
    "startup.loading_assets": "正在加载 ChessAlkkagi 资源…",
    "startup.loading_models_percent": "正在加载棋子模型 {percent}%",
    "startup.loading_models_bytes": "正在加载棋子模型 {size}MB",
    "startup.preparing_physics": "正在准备物理世界…",
    "startup.stabilizing_pieces": "正在稳定棋子初始姿态…",
    "startup.init_failed": "无法启动游戏。",

    // Online Settlement & Rematch
    "online.settle_retry_btn": "重新核对结算",
    "online.settle_checking_opponent": "正在核对对手的对战结果…",
    "online.settle_waiting_opponent": "等待对手确认。确认完成前战绩不会变更。",
    "online.settle_opponent_info": "对手: {name} · {tier} · {delta}分 · {progress}",
    "online.settle_failed": "结算未能完成。请重新检查。",
    "online.reconnect_overlay_title": "在线对战",
    "online.reconnect_overlay_disconnected": "与对手断开连接",
    "online.reconnect_overlay_prompt": "请重新连接或退出对局。",
    "online.reconnect_overlay_create_code": "生成重连代码",
    "online.reconnect_overlay_abandon": "结束对局",
    "online.reconnect_exchanging_codes": "正在交换新的 P2P 连接代码…",
    "online.reconnect_syncing_state": "正在同步房主状态与对局历史…",
    "online.rematch_btn": "再战",
    "online.rematch_cancel_btn": "取消请求",
    "online.rematch_accept_btn": "接受",
    "online.rematch_decline_btn": "拒绝",
    "online.rematch_waiting_response": "等待对手回应…",
    "online.rematch_preparing": "正在准备新对局…",
    "online.rematch_failed_start": "再战启动失败: {reason}",
    "online.rematch_failed_hash_mismatch": "再战启动失败: 回合 0 初始状态不一致。",
    "online.rematch_requested": "对手请求了再战",
    "online.rematch_declined": "对手拒绝了再战",

    // Manual P2P Online Lobby
    "manual_online.resuming_match": "正在恢复对局…",
    "manual_online.connected_preparing": "已连接。正在准备对局…",
    "manual_online.generating_invite_code": "正在收集 ICE 候选以生成邀请代码…",
    "manual_online.send_invite_prompt": "请将 {length} 字符的邀请代码发送给对手。",
    "manual_online.paste_invite_prompt": "请粘贴收到的邀请代码。",
    "manual_online.generating_answer_code": "正在收集 ICE 候选以生成应答代码…",
    "manual_online.send_answer_prompt": "请将 {length} 字符的应答代码发送给房主。",
    "manual_online.send_reconnect_answer_prompt": "请将 {length} 字符的重连应答代码发送给房主。",
    "manual_online.applying_answer_code": "正在应用应答代码并连接…",
    "manual_online.code_copied": "已复制 {length} 字符的{label}。",
    "manual_online.label_invite_code": "邀请代码",
    "manual_online.label_answer_code": "应答代码",

    // Matchmaking
    "matchmaking.joining_queue": "正在加入匹配队列…",
    "matchmaking.searching_standard": "正在寻找 MMR 相近的对手…",
    "matchmaking.searching_range": "正在寻找对手… (MMR ±{diff})",
    "matchmaking.match_found_info": "已找到对手: {nickname} ({mmr})",
    "matchmaking.match_found_name": "已找到对手: {nickname}",
    "matchmaking.turn_delayed_researching": "与对手的 P2P/TURN 连接超时，重新在队列中搜索…",
    "matchmaking.default_opponent_name": "对手玩家",
    "matchmaking.signaling_sending_answer": "正在建立 P2P 连接（发送 Answer）…",
    "matchmaking.signaling_confirming": "正在确认 P2P 连接…",
    "matchmaking.signaling_creating_offer": "正在准备 P2P 连接（生成 Offer）…",
    "matchmaking.signaling_responding": "正在响应 P2P 连接…",
    "matchmaking.connected_starting_game": "P2P 连接成功！正在开始游戏。",
    "matchmaking.connecting_friend": "正在连接与好友的 1v1 对战…",
    "matchmaking.signaling_exchanging_signals": "正在交换 P2P 信号…",
    "matchmaking.cancelled": "已取消匹配。",

    // Net Development Tool
    "net.title": "P2P 连接测试",
    "net.btn_create_room": "创建房间",
    "net.btn_copy_invite": "复制邀请代码",
    "net.label_paste_invite": "粘贴邀请代码",
    "net.btn_join": "加入",
    "net.btn_copy_answer": "复制应答代码",
    "net.label_paste_answer": "粘贴应答代码",
    "net.btn_connect": "连接",
    "net.msg_placeholder": "发送消息",
    "net.btn_send_msg": "发送消息",
    "net.received_messages": "已接收消息",
    "net.no_received_messages": "暂未收到消息。",
    "net.connection_status_prefix": "连接状态: {status}",
    "net.state_idle": "空闲",
    "net.state_waiting_answer": "等待应答代码",
    "net.state_connecting": "连接中",
    "net.state_connected": "已连接",
    "net.state_disconnected": "已断开",
    "net.state_failed": "连接失败",
    "net.log_invite_created": "已生成 {length} 字符的邀请代码。",
    "net.log_answer_created": "已生成 {length} 字符的应答代码。",
    "net.log_answer_applied": "已应用应答代码。",
    "net.log_sent_prefix": "发送: {payload}",
  },

  de: {
    // Progress
    "progress.guest_device_stored": "Gast-Spielfortschritt wird auf diesem Gerät gespeichert.",
    "progress.local_cache_failed": "Lokale Zwischenspeicherung fehlgeschlagen. Bitte schließen Sie das Fenster nicht vor Abschluss der Serverspeicherung.",
    "progress.mastery_pending_cached": "Neue Meisterschaftsdaten werden bis zum Server-Update im lokalen Cache aufbewahrt.",
    "progress.saving": "Fortschritt wird gespeichert …",
    "progress.account_changed_reloading": "Konto geändert. Spielfortschritt wird neu geladen …",
    "progress.loading": "Konto-Fortschritt wird geladen …",
    "progress.corrupted_cache": "Lokaler Cache beschädigt. Originaldaten gesichert und Speichern gestoppt. Bitte wählen Sie Serverdaten verwenden nach der Wiederherstellung.",
    "progress.backup_failed_no_replace": "Sicherung der widersprüchlichen Gerätedaten fehlgeschlagen. Serverdaten wurden nicht übernommen.",
    "progress.conflict_backed_up": "Konfliktbehaftete Daten ({keys}) mit anderem Gerät wurden gesichert. Bitte wählen Sie den gewünschten Datensatz.",
    "progress.loaded_mastery_pending": "Konto-Fortschritt geladen. Neue Meisterschaftsdaten verbleiben bis zum Server-Update auf diesem Gerät.",
    "progress.loaded": "Konto-Fortschritt geladen.",
    "progress.mastery_version_conflict": "Unterschiedliche historische Meisterschaftsdaten wurden ohne automatisches Zusammenführen gesichert. Bitte wählen Sie die Wiederherstellung.",
    "progress.mastery_unsafe": "Unsicheres Meisterschaftsdaten-Format erkannt. Originaldaten gesichert und Speichern gestoppt. Nach Wiederherstellung erneut versuchen.",
    "progress.load_failed": "Konto-Fortschritt konnte nicht geladen werden. Bitte Verbindung und Servereinstellungen prüfen und erneut versuchen.",
    "progress.saved_mastery_pending": "Bestehender Fortschritt auf Server gespeichert. Neue Meisterschaftsdaten verbleiben bis zum Server-Update auf diesem Gerät.",
    "progress.saved_conflict_resolved": "Konfliktbehaftete Altdaten gesichert und Meisterschaftsdaten mit dem Server zusammengeführt. Bitte mit Serverdaten fortfahren.",
    "progress.saved": "Auf Server gespeichert.",
    "progress.save_delayed_retrying": "Speichern aufgrund von Verbindungsproblemen verzögert. Automatischer Wiederholungsversuch …",
    "progress.save_delayed_check_conn": "Serverspeicherung verzögert. Bitte Verbindung prüfen und erneut versuchen.",
    "progress.backup_failed": "Sicherung der Gerätedaten fehlgeschlagen. Serverdaten wurden nicht angewendet.",
    "progress.cache_create_failed": "Erstellung eines sicheren Caches für den Wechsel zu Serverdaten fehlgeschlagen.",
    "progress.use_server_mastery_pending": "Bestehende Serverdaten werden verwendet. Meisterschaftsdaten bleiben bis zum Server-Update im lokalen Cache.",
    "progress.use_server_merging": "Serverdaten werden übernommen und Meisterschaftsdaten zusammengeführt …",
    "progress.use_server": "Serverdaten werden verwendet.",

    // Startup
    "startup.loading_assets": "ChessAlkkagi-Ressourcen werden geladen …",
    "startup.loading_models_percent": "Spielfiguren-Modelle werden geladen: {percent}%",
    "startup.loading_models_bytes": "Spielfiguren-Modelle werden geladen: {size}MB",
    "startup.preparing_physics": "Physik-Welt wird vorbereitet …",
    "startup.stabilizing_pieces": "Ausgangsposition der Figuren wird stabilisiert …",
    "startup.init_failed": "Das Spiel konnte nicht gestartet werden.",

    // Online Settlement & Rematch
    "online.settle_retry_btn": "Wertung erneut prüfen",
    "online.settle_checking_opponent": "Prüfe Match-Ergebnis des Gegners …",
    "online.settle_waiting_opponent": "Warte auf Bestätigung des Gegners. Die Statistik wird nach Verifizierung aktualisiert.",
    "online.settle_opponent_info": "Gegner: {name} · {tier} · {delta} Pkt. · {progress}",
    "online.settle_failed": "Wertung konnte nicht abgeschlossen werden. Bitte erneut prüfen.",
    "online.reconnect_overlay_title": "Online-Match",
    "online.reconnect_overlay_disconnected": "Verbindung zum Gegner getrennt",
    "online.reconnect_overlay_prompt": "Erneut verbinden oder Partie beenden.",
    "online.reconnect_overlay_create_code": "Wiederverbindungs-Code erstellen",
    "online.reconnect_overlay_abandon": "Partie beenden",
    "online.reconnect_exchanging_codes": "Neue P2P-Verbindungscodes werden ausgetauscht …",
    "online.reconnect_syncing_state": "Host-Status und Match-Verlauf werden synchronisiert …",
    "online.rematch_btn": "Revanche",
    "online.rematch_cancel_btn": "Anfrage abbrechen",
    "online.rematch_accept_btn": "Annehmen",
    "online.rematch_decline_btn": "Ablehnen",
    "online.rematch_waiting_response": "Warte auf Antwort des Gegners …",
    "online.rematch_preparing": "Neues Match wird vorbereitet …",
    "online.rematch_failed_start": "Revanche-Start fehlgeschlagen: {reason}",
    "online.rematch_failed_hash_mismatch": "Revanche-Start fehlgeschlagen: Startzustand von Runde 0 stimmt nicht überein.",
    "online.rematch_requested": "Gegner hat eine Revanche angefragt",
    "online.rematch_declined": "Gegner hat die Revanche abgelehnt",

    // Manual P2P Online Lobby
    "manual_online.resuming_match": "Partie wird fortgesetzt …",
    "manual_online.connected_preparing": "Verbunden. Bereite Standard-Match vor …",
    "manual_online.generating_invite_code": "Sammle ICE-Kandidaten und erstelle Einladungscode …",
    "manual_online.send_invite_prompt": "Senden Sie den Einladungscode ({length} Zeichen) an Ihren Gegner.",
    "manual_online.paste_invite_prompt": "Fügen Sie den erhaltenen Einladungscode ein.",
    "manual_online.generating_answer_code": "Sammle ICE-Kandidaten und erstelle Antwortcode …",
    "manual_online.send_answer_prompt": "Senden Sie den Antwortcode ({length} Zeichen) an den Host.",
    "manual_online.send_reconnect_answer_prompt": "Senden Sie den Reconnect-Antwortcode ({length} Zeichen) an den Host.",
    "manual_online.applying_answer_code": "Wende Antwortcode an und verbinde …",
    "manual_online.code_copied": "{label} ({length} Zeichen) kopiert.",
    "manual_online.label_invite_code": "Einladungscode",
    "manual_online.label_answer_code": "Antwortcode",

    // Matchmaking
    "matchmaking.joining_queue": "Trete Matchmaking-Warteschlange bei …",
    "matchmaking.searching_standard": "Suche Gegner mit passender MMR …",
    "matchmaking.searching_range": "Suche Gegner … (MMR ±{diff})",
    "matchmaking.match_found_info": "Gegner gefunden: {nickname} ({mmr})",
    "matchmaking.match_found_name": "Gegner gefunden: {nickname}",
    "matchmaking.turn_delayed_researching": "P2P/TURN-Verbindung zum Gegner verzögert. Suche in Warteschlange erneut …",
    "matchmaking.default_opponent_name": "Gegnerischer Spieler",
    "matchmaking.signaling_sending_answer": "Stelle P2P-Verbindung her (Answer wird gesendet) …",
    "matchmaking.signaling_confirming": "Bestätige P2P-Verbindung …",
    "matchmaking.signaling_creating_offer": "Bereite P2P-Verbindung vor (Offer wird erstellt) …",
    "matchmaking.signaling_responding": "Antworte auf P2P-Verbindung …",
    "matchmaking.connected_starting_game": "P2P-Verbindung hergestellt! Spiel wird gestartet.",
    "matchmaking.connecting_friend": "Verbinde 1v1-Match mit Freund …",
    "matchmaking.signaling_exchanging_signals": "P2P-Signale werden ausgetauscht …",
    "matchmaking.cancelled": "Matchmaking abgebrochen.",

    // Net Development Tool
    "net.title": "P2P-Verbindungstest",
    "net.btn_create_room": "Raum erstellen",
    "net.btn_copy_invite": "Einladungscode kopieren",
    "net.label_paste_invite": "Einladungscode einfügen",
    "net.btn_join": "Beitreten",
    "net.btn_copy_answer": "Antwortcode kopieren",
    "net.label_paste_answer": "Antwortcode einfügen",
    "net.btn_connect": "Verbinden",
    "net.msg_placeholder": "Nachricht senden",
    "net.btn_send_msg": "Nachricht senden",
    "net.received_messages": "Empfangene Nachrichten",
    "net.no_received_messages": "Noch keine Nachrichten empfangen.",
    "net.connection_status_prefix": "Verbindungsstatus: {status}",
    "net.state_idle": "Bereit",
    "net.state_waiting_answer": "Warte auf Antwortcode",
    "net.state_connecting": "Verbinde",
    "net.state_connected": "Verbunden",
    "net.state_disconnected": "Getrennt",
    "net.state_failed": "Verbindung fehlgeschlagen",
    "net.log_invite_created": "Einladungscode ({length} Zeichen) erstellt.",
    "net.log_answer_created": "Antwortcode ({length} Zeichen) erstellt.",
    "net.log_answer_applied": "Antwortcode angewendet.",
    "net.log_sent_prefix": "Gesendet: {payload}",
  },

  fr: {
    // Progress
    "progress.guest_device_stored": "La progression invité est enregistrée sur cet appareil.",
    "progress.local_cache_failed": "Échec de la sauvegarde locale temporaire. Ne fermez pas la fenêtre avant la fin de l'enregistrement sur le serveur.",
    "progress.mastery_pending_cached": "Les nouveaux enregistrements de maîtrise seront conservés dans le cache de l'appareil jusqu'à la mise à jour du serveur.",
    "progress.saving": "Enregistrement de la progression en cours…",
    "progress.account_changed_reloading": "Compte modifié. Rechargement de la progression…",
    "progress.loading": "Chargement de la progression du compte…",
    "progress.corrupted_cache": "Cache de l'appareil corrompu. Données d'origine conservées et sauvegarde suspendue. Veuillez sélectionner Utiliser la sauvegarde serveur après récupération.",
    "progress.backup_failed_no_replace": "Échec de la sauvegarde des données locales en conflit. Les données du serveur n'ont pas été appliquées.",
    "progress.conflict_backed_up": "Les données en conflit avec un autre appareil ({keys}) ont été sauvegardées. Veuillez choisir les données à utiliser.",
    "progress.loaded_mastery_pending": "Progression du compte chargée. Les nouveaux enregistrements de maîtrise restent sur cet appareil jusqu'à la mise à jour.",
    "progress.loaded": "Progression du compte chargée.",
    "progress.mastery_version_conflict": "Les historiques de conditions de maîtrise différentes ont été conservés sans fusion automatique. Veuillez choisir les données à restaurer.",
    "progress.mastery_unsafe": "Format des données de maîtrise non sécurisé. Données conservées et sauvegarde arrêtée. Réessayez après récupération.",
    "progress.load_failed": "Échec du chargement de la progression. Vérifiez votre connexion et les paramètres du serveur, puis réessayez.",
    "progress.saved_mastery_pending": "Progression existante enregistrée sur le serveur. Les nouveaux enregistrements de maîtrise restent sur cet appareil jusqu'à la mise à jour.",
    "progress.saved_conflict_resolved": "Anciennes données en conflit sauvegardées et maîtrise fusionnée avec le serveur. Continuez avec les données serveur.",
    "progress.saved": "Enregistré sur le serveur.",
    "progress.save_delayed_retrying": "Enregistrement retardé en raison de problèmes de connexion. Nouvel essai automatique…",
    "progress.save_delayed_check_conn": "Enregistrement sur le serveur retardé. Vérifiez votre connexion et réessayez.",
    "progress.backup_failed": "Échec de la sauvegarde des données locales. Les données du serveur n'ont pas été appliquées.",
    "progress.cache_create_failed": "Impossible de créer un cache local sécurisé pour passer aux données du serveur.",
    "progress.use_server_mastery_pending": "Utilisation de la progression existante sur le serveur. Les données de maîtrise restent dans le cache jusqu'à la mise à jour.",
    "progress.use_server_merging": "Utilisation de la progression du serveur et fusion des données de maîtrise en cours…",
    "progress.use_server": "Utilisation des enregistrements du serveur.",

    // Startup
    "startup.loading_assets": "Chargement des ressources ChessAlkkagi…",
    "startup.loading_models_percent": "Chargement des modèles de pièces {percent}%",
    "startup.loading_models_bytes": "Chargement des modèles de pièces {size}MB",
    "startup.preparing_physics": "Préparation du monde physique…",
    "startup.stabilizing_pieces": "Stabilisation des positions initiales des pièces…",
    "startup.init_failed": "Impossible de démarrer le jeu.",

    // Online Settlement & Rematch
    "online.settle_retry_btn": "Revérifier le décompte",
    "online.settle_checking_opponent": "Vérification du résultat de l'adversaire en cours…",
    "online.settle_waiting_opponent": "En attente de confirmation de l'adversaire. Les stats seront mises à jour après validation.",
    "online.settle_opponent_info": "Adversaire: {name} · {tier} · {delta} pts · {progress}",
    "online.settle_failed": "Impossible de terminer le décompte. Veuillez vérifier à nouveau.",
    "online.reconnect_overlay_title": "Partie en ligne",
    "online.reconnect_overlay_disconnected": "Connexion perdue avec l'adversaire",
    "online.reconnect_overlay_prompt": "Reconnectez-vous ou quittez la partie.",
    "online.reconnect_overlay_create_code": "Créer un code de reconnexion",
    "online.reconnect_overlay_abandon": "Quitter la partie",
    "online.reconnect_exchanging_codes": "Échange des nouveaux codes de connexion P2P…",
    "online.reconnect_syncing_state": "Synchronisation de l'état de l'hôte et de l'historique…",
    "online.rematch_btn": "Revanche",
    "online.rematch_cancel_btn": "Annuler la demande",
    "online.rematch_accept_btn": "Accepter",
    "online.rematch_decline_btn": "Refuser",
    "online.rematch_waiting_response": "En attente de la réponse de l'adversaire…",
    "online.rematch_preparing": "Préparation de la nouvelle partie…",
    "online.rematch_failed_start": "Échec du démarrage de la revanche: {reason}",
    "online.rematch_failed_hash_mismatch": "Échec de la revanche: les états initiaux du tour 0 ne correspondent pas.",
    "online.rematch_requested": "L'adversaire propose une revanche",
    "online.rematch_declined": "L'adversaire a refusé la revanche",

    // Manual P2P Online Lobby
    "manual_online.resuming_match": "Reprise de la partie…",
    "manual_online.connected_preparing": "Connecté. Préparation de la partie…",
    "manual_online.generating_invite_code": "Collecte des candidats ICE et création du code d'invitation…",
    "manual_online.send_invite_prompt": "Envoyez le code d'invitation de {length} caractères à votre adversaire.",
    "manual_online.paste_invite_prompt": "Collez le code d'invitation reçu.",
    "manual_online.generating_answer_code": "Collecte des candidats ICE et création du code de réponse…",
    "manual_online.send_answer_prompt": "Envoyez le code de réponse de {length} caractères à l'hôte.",
    "manual_online.send_reconnect_answer_prompt": "Envoyez le code de reconnexion de {length} caractères à l'hôte.",
    "manual_online.applying_answer_code": "Application du code de réponse et connexion en cours…",
    "manual_online.code_copied": "{length} caractères de {label} copiés.",
    "manual_online.label_invite_code": "Code d'invitation",
    "manual_online.label_answer_code": "Code de réponse",

    // Matchmaking
    "matchmaking.joining_queue": "Connexion à la file de matchmaking…",
    "matchmaking.searching_standard": "Recherche d'un adversaire au MMR similaire…",
    "matchmaking.searching_range": "Recherche d'un adversaire… (MMR ±{diff})",
    "matchmaking.match_found_info": "Adversaire trouvé: {nickname} ({mmr})",
    "matchmaking.match_found_name": "Adversaire trouvé: {nickname}",
    "matchmaking.turn_delayed_researching": "Connexion P2P/TURN retardée. Nouvelle recherche dans la file…",
    "matchmaking.default_opponent_name": "Joueur adverse",
    "matchmaking.signaling_sending_answer": "Établissement de la connexion P2P (Envoi de Answer)…",
    "matchmaking.signaling_confirming": "Confirmation de la connexion P2P…",
    "matchmaking.signaling_creating_offer": "Préparation de la connexion P2P (Création de Offer)…",
    "matchmaking.signaling_responding": "Réponse à la connexion P2P en cours…",
    "matchmaking.connected_starting_game": "Connexion P2P établie ! Démarrage de la partie.",
    "matchmaking.connecting_friend": "Connexion au match 1v1 avec un ami…",
    "matchmaking.signaling_exchanging_signals": "Échange des signaux P2P en cours…",
    "matchmaking.cancelled": "Matchmaking annulé.",

    // Net Development Tool
    "net.title": "Test de connexion P2P",
    "net.btn_create_room": "Créer un salon",
    "net.btn_copy_invite": "Copier le code d'invitation",
    "net.label_paste_invite": "Coller le code d'invitation",
    "net.btn_join": "Rejoindre",
    "net.btn_copy_answer": "Copier le code de réponse",
    "net.label_paste_answer": "Coller le code de réponse",
    "net.btn_connect": "Connecter",
    "net.msg_placeholder": "Message à envoyer",
    "net.btn_send_msg": "Envoyer le message",
    "net.received_messages": "Messages reçus",
    "net.no_received_messages": "Aucun message reçu pour le moment.",
    "net.connection_status_prefix": "État de la connexion : {status}",
    "net.state_idle": "En attente",
    "net.state_waiting_answer": "En attente du code de réponse",
    "net.state_connecting": "Connexion",
    "net.state_connected": "Connecté",
    "net.state_disconnected": "Déconnecté",
    "net.state_failed": "Échec de la connexion",
    "net.log_invite_created": "Code d'invitation de {length} caractères créé.",
    "net.log_answer_created": "Code de réponse de {length} caractères créé.",
    "net.log_answer_applied": "Code de réponse appliqué.",
    "net.log_sent_prefix": "Envoyé : {payload}",
  },

  es: {
    // Progress
    "progress.guest_device_stored": "El progreso de invitado se guarda en este dispositivo.",
    "progress.local_cache_failed": "Error al guardar localmente de forma temporal. No cierre la ventana antes de que se complete el guardado en el servidor.",
    "progress.mastery_pending_cached": "Los nuevos registros de maestría se guardarán en la caché del dispositivo hasta la actualización del servidor.",
    "progress.saving": "Guardando progreso…",
    "progress.account_changed_reloading": "La cuenta ha cambiado. Recargando el progreso…",
    "progress.loading": "Cargando progreso de la cuenta…",
    "progress.corrupted_cache": "Caché del dispositivo dañada. Se han conservado los datos originales y se ha detenido el guardado. Seleccione Usar datos del servidor tras la recuperación.",
    "progress.backup_failed_no_replace": "Error al respaldar los registros en conflicto del dispositivo. No se reemplazaron por los del servidor.",
    "progress.conflict_backed_up": "Se han respaldado los registros en conflicto con otro dispositivo ({keys}). Seleccione qué datos desea usar.",
    "progress.loaded_mastery_pending": "Progreso de la cuenta cargado. Los nuevos registros de maestría se mantendrán en este dispositivo hasta la actualización.",
    "progress.loaded": "Progreso de la cuenta cargado.",
    "progress.mastery_version_conflict": "Se conservaron los registros de condiciones de maestría anteriores sin fusionar. Seleccione el registro a recuperar.",
    "progress.mastery_unsafe": "Formato no seguro de registros de maestría. Se preservaron los datos originales y se detuvo el guardado. Reintente tras recuperar.",
    "progress.load_failed": "No se pudo cargar el progreso de la cuenta. Verifique la conexión y ajustes del servidor e intente de nuevo.",
    "progress.saved_mastery_pending": "El progreso existente se guardó en el servidor. Los nuevos registros de maestría se mantendrán en este dispositivo hasta la actualización.",
    "progress.saved_conflict_resolved": "Se respaldaron los registros antiguos en conflicto y se fusionó la maestría con el servidor. Continúe usando los datos del servidor.",
    "progress.saved": "Guardado en el servidor.",
    "progress.save_delayed_retrying": "Guardado retrasado por problemas de conexión. Reintentando automáticamente…",
    "progress.save_delayed_check_conn": "El guardado en el servidor se ha retrasado. Verifique su conexión y vuelva a intentarlo.",
    "progress.backup_failed": "No se pudieron respaldar los registros del dispositivo. No se aplicaron los del servidor.",
    "progress.cache_create_failed": "No se pudo crear una caché de dispositivo segura para cambiar a los datos del servidor.",
    "progress.use_server_mastery_pending": "Usando el progreso existente del servidor. Los registros de maestría se mantendrán en la caché hasta la actualización.",
    "progress.use_server_merging": "Usando el progreso del servidor y fusionando registros de maestría…",
    "progress.use_server": "Usando registros del servidor.",

    // Startup
    "startup.loading_assets": "Cargando recursos de ChessAlkkagi…",
    "startup.loading_models_percent": "Cargando modelos de piezas {percent}%",
    "startup.loading_models_bytes": "Cargando modelos de piezas {size}MB",
    "startup.preparing_physics": "Preparando el mundo físico…",
    "startup.stabilizing_pieces": "Estabilizando posiciones iniciales de las piezas…",
    "startup.init_failed": "No se pudo iniciar el juego.",

    // Online Settlement & Rematch
    "online.settle_retry_btn": "Volver a verificar liquidación",
    "online.settle_checking_opponent": "Verificando el resultado del rival…",
    "online.settle_waiting_opponent": "Esperando confirmación del rival. Las estadísticas no cambiarán hasta completar la verificación.",
    "online.settle_opponent_info": "Rival: {name} · {tier} · {delta} pts · {progress}",
    "online.settle_failed": "No se pudo completar la liquidación. Vuelva a comprobarlo.",
    "online.reconnect_overlay_title": "Partida online",
    "online.reconnect_overlay_disconnected": "Se ha perdido la conexión con el rival",
    "online.reconnect_overlay_prompt": "Reconéctese o finalice la partida.",
    "online.reconnect_overlay_create_code": "Crear código de reconexión",
    "online.reconnect_overlay_abandon": "Terminar partida",
    "online.reconnect_exchanging_codes": "Intercambiando nuevos códigos de conexión P2P…",
    "online.reconnect_syncing_state": "Sincronizando estado del anfitrión e historial de la partida…",
    "online.rematch_btn": "Revancha",
    "online.rematch_cancel_btn": "Cancelar solicitud",
    "online.rematch_accept_btn": "Aceptar",
    "online.rematch_decline_btn": "Rechazar",
    "online.rematch_waiting_response": "Esperando respuesta del rival…",
    "online.rematch_preparing": "Preparando nueva partida…",
    "online.rematch_failed_start": "Error al iniciar la revancha: {reason}",
    "online.rematch_failed_hash_mismatch": "Error al iniciar revancha: los estados iniciales del turno 0 no coinciden.",
    "online.rematch_requested": "El rival ha solicitado una revancha",
    "online.rematch_declined": "El rival ha rechazado la revancha",

    // Manual P2P Online Lobby
    "manual_online.resuming_match": "Reanudando partida…",
    "manual_online.connected_preparing": "Conectado. Preparando partida…",
    "manual_online.generating_invite_code": "Recopilando candidatos ICE y generando código de invitación…",
    "manual_online.send_invite_prompt": "Envíe el código de invitación de {length} caracteres a su rival.",
    "manual_online.paste_invite_prompt": "Pegue el código de invitación recibido.",
    "manual_online.generating_answer_code": "Recopilando candidatos ICE y creando código de respuesta…",
    "manual_online.send_answer_prompt": "Envíe el código de respuesta de {length} caracteres al anfitrión.",
    "manual_online.send_reconnect_answer_prompt": "Envíe el código de respuesta de reconexión de {length} caracteres al anfitrión.",
    "manual_online.applying_answer_code": "Aplicando código de respuesta y conectando…",
    "manual_online.code_copied": "Se copiaron {length} caracteres de {label}.",
    "manual_online.label_invite_code": "Código de invitación",
    "manual_online.label_answer_code": "Código de respuesta",

    // Matchmaking
    "matchmaking.joining_queue": "Entrando en la cola de emparejamiento…",
    "matchmaking.searching_standard": "Buscando rival con MMR similar…",
    "matchmaking.searching_range": "Buscando rival… (MMR ±{diff})",
    "matchmaking.match_found_info": "Rival encontrado: {nickname} ({mmr})",
    "matchmaking.match_found_name": "Rival encontrado: {nickname}",
    "matchmaking.turn_delayed_researching": "Conexión P2P/TURN retrasada. Buscando de nuevo en la cola…",
    "matchmaking.default_opponent_name": "Jugador rival",
    "matchmaking.signaling_sending_answer": "Estableciendo conexión P2P (Enviando Answer)…",
    "matchmaking.signaling_confirming": "Confirmando conexión P2P…",
    "matchmaking.signaling_creating_offer": "Preparando conexión P2P (Creando Offer)…",
    "matchmaking.signaling_responding": "Respondiendo a la conexión P2P…",
    "matchmaking.connected_starting_game": "¡P2P conectado con éxito! Iniciando la partida.",
    "matchmaking.connecting_friend": "Conectando partida 1v1 con amigo…",
    "matchmaking.signaling_exchanging_signals": "Intercambiando señales P2P…",
    "matchmaking.cancelled": "Emparejamiento cancelado.",

    // Net Development Tool
    "net.title": "Prueba de conexión P2P",
    "net.btn_create_room": "Crear sala",
    "net.btn_copy_invite": "Copiar código de invitación",
    "net.label_paste_invite": "Pegar código de invitación",
    "net.btn_join": "Unirse",
    "net.btn_copy_answer": "Copiar código de respuesta",
    "net.label_paste_answer": "Pegar código de respuesta",
    "net.btn_connect": "Conectar",
    "net.msg_placeholder": "Mensaje a enviar",
    "net.btn_send_msg": "Enviar mensaje",
    "net.received_messages": "Mensajes recibidos",
    "net.no_received_messages": "Aún no se han recibido mensajes.",
    "net.connection_status_prefix": "Estado de la conexión: {status}",
    "net.state_idle": "En espera",
    "net.state_waiting_answer": "Esperando código de respuesta",
    "net.state_connecting": "Conectando",
    "net.state_connected": "Conectado",
    "net.state_disconnected": "Desconectado",
    "net.state_failed": "Error de conexión",
    "net.log_invite_created": "Se generó código de invitación de {length} caracteres.",
    "net.log_answer_created": "Se generó código de respuesta de {length} caracteres.",
    "net.log_answer_applied": "Se aplicó código de respuesta.",
    "net.log_sent_prefix": "Enviado: {payload}",
  },

  ru: {
    // Progress
    "progress.guest_device_stored": "Гостевой прогресс сохраняется на этом устройстве.",
    "progress.local_cache_failed": "Сбой локального сохранения. Не закрывайте окно до завершения сохранения на сервере.",
    "progress.mastery_pending_cached": "Новые записи мастерства сохраняются в кэше устройства до обновления сервера.",
    "progress.saving": "Сохранение прогресса…",
    "progress.account_changed_reloading": "Аккаунт изменен. Перезагрузка прогресса…",
    "progress.loading": "Загрузка прогресса аккаунта…",
    "progress.corrupted_cache": "Локальный кэш поврежден. Исходные данные сохранены, сохранение приостановлено. Выберите «Использовать данные сервера» после восстановления.",
    "progress.backup_failed_no_replace": "Не удалось создать резервную копию конфликтующих данных. Замена на данные сервера отменена.",
    "progress.conflict_backed_up": "Конфликтующие записи ({keys}) сохранены в резервной копии. Выберите, какие данные использовать.",
    "progress.loaded_mastery_pending": "Прогресс аккаунта загружен. Новые данные мастерства останутся на устройстве до обновления сервера.",
    "progress.loaded": "Прогресс аккаунта загружен.",
    "progress.mastery_version_conflict": "Различные устаревшие требования мастерства сохранены без автослияния. Выберите данные для восстановления.",
    "progress.mastery_unsafe": "Небезопасный формат данных мастерства. Исходные данные сохранены, сохранение остановлено. Повторите попытку после восстановления.",
    "progress.load_failed": "Не удалось загрузить прогресс аккаунта. Проверьте соединение и настройки сервера, затем повторите попытку.",
    "progress.saved_mastery_pending": "Текущий прогресс сохранен на сервере. Новые записи мастерства сохранятся на устройстве до обновления сервера.",
    "progress.saved_conflict_resolved": "Конфликтующие устаревшие данные сохранены, данные мастерства объединены с сервером. Продолжайте с данными сервера.",
    "progress.saved": "Сохранено на сервере.",
    "progress.save_delayed_retrying": "Сохранение задерживается из-за проблем с сетью. Автоматический повтор…",
    "progress.save_delayed_check_conn": "Сохранение на сервере задерживается. Проверьте соединение и повторите попытку.",
    "progress.backup_failed": "Сбой резервного копирования данных устройства. Замена данными сервера отменена.",
    "progress.cache_create_failed": "Не удалось создать безопасный кэш устройства для переключения на серверные данные.",
    "progress.use_server_mastery_pending": "Используется существующий прогресс с сервера. Данные мастерства сохранятся в кэше устройства до обновления.",
    "progress.use_server_merging": "Применение данных сервера и слияние записей мастерства…",
    "progress.use_server": "Используются данные сервера.",

    // Startup
    "startup.loading_assets": "Загрузка ресурсов ChessAlkkagi…",
    "startup.loading_models_percent": "Загрузка 3D-моделей фигур {percent}%",
    "startup.loading_models_bytes": "Загрузка моделей фигур {size}MB",
    "startup.preparing_physics": "Подготовка физического мира…",
    "startup.stabilizing_pieces": "Стабилизация начальной расстановки фигур…",
    "startup.init_failed": "Не удалось запустить игру.",

    // Online Settlement & Rematch
    "online.settle_retry_btn": "Перепроверить расчет",
    "online.settle_checking_opponent": "Проверка результатов соперника…",
    "online.settle_waiting_opponent": "Ожидание подтверждения соперника. Статистика обновится после подтверждения.",
    "online.settle_opponent_info": "Соперник: {name} · {tier} · {delta} очков · {progress}",
    "online.settle_failed": "Не удалось завершить расчет. Пожалуйста, проверьте еще раз.",
    "online.reconnect_overlay_title": "Онлайн-матч",
    "online.reconnect_overlay_disconnected": "Соединение с соперником разорвано",
    "online.reconnect_overlay_prompt": "Переподключитесь или завершите матч.",
    "online.reconnect_overlay_create_code": "Создать код переподключения",
    "online.reconnect_overlay_abandon": "Завершить матч",
    "online.reconnect_exchanging_codes": "Обмен новыми P2P-кодами подключения…",
    "online.reconnect_syncing_state": "Синхронизация состояния хоста и истории матча…",
    "online.rematch_btn": "Реванш",
    "online.rematch_cancel_btn": "Отменить запрос",
    "online.rematch_accept_btn": "Принять",
    "online.rematch_decline_btn": "Отклонить",
    "online.rematch_waiting_response": "Ожидание ответа соперника…",
    "online.rematch_preparing": "Подготовка нового матча…",
    "online.rematch_failed_start": "Не удалось начать реванш: {reason}",
    "online.rematch_failed_hash_mismatch": "Не удалось начать реванш: несовпадение начального состояния хода 0.",
    "online.rematch_requested": "Соперник запросил реванш",
    "online.rematch_declined": "Соперник отклонил реванш",

    // Manual P2P Online Lobby
    "manual_online.resuming_match": "Возобновление матча…",
    "manual_online.connected_preparing": "Подключено. Подготовка стандартного матча…",
    "manual_online.generating_invite_code": "Сбор ICE-кандидатов и создание кода приглашения…",
    "manual_online.send_invite_prompt": "Отправьте {length}-значный код приглашения сопернику.",
    "manual_online.paste_invite_prompt": "Вставьте полученный код приглашения.",
    "manual_online.generating_answer_code": "Сбор ICE-кандидатов и создание кода ответа…",
    "manual_online.send_answer_prompt": "Отправьте {length}-значный код ответа хосту.",
    "manual_online.send_reconnect_answer_prompt": "Отправьте {length}-значный код ответа переподключения хосту.",
    "manual_online.applying_answer_code": "Применение кода ответа и подключение…",
    "manual_online.code_copied": "Скопировано {length} симв. ({label}).",
    "manual_online.label_invite_code": "Код приглашения",
    "manual_online.label_answer_code": "Код ответа",

    // Matchmaking
    "matchmaking.joining_queue": "Подключение к очереди поиска…",
    "matchmaking.searching_standard": "Поиск соперника с подходящим MMR…",
    "matchmaking.searching_range": "Поиск соперника… (MMR ±{diff})",
    "matchmaking.match_found_info": "Соперник найден: {nickname} ({mmr})",
    "matchmaking.match_found_name": "Соперник найден: {nickname}",
    "matchmaking.turn_delayed_researching": "Задержка P2P/TURN соединения. Повторный поиск в очереди…",
    "matchmaking.default_opponent_name": "Соперник",
    "matchmaking.signaling_sending_answer": "Установление P2P соединения (Отправка Answer)…",
    "matchmaking.signaling_confirming": "Подтверждение P2P соединения…",
    "matchmaking.signaling_creating_offer": "Подготовка P2P соединения (Создание Offer)…",
    "matchmaking.signaling_responding": "Ответ на P2P подключение…",
    "matchmaking.connected_starting_game": "P2P соединение установлено! Запуск игры.",
    "matchmaking.connecting_friend": "Подключение к матчу 1 на 1 с другом…",
    "matchmaking.signaling_exchanging_signals": "Обмен P2P-сигналами…",
    "matchmaking.cancelled": "Поиск матча отменен.",

    // Net Development Tool
    "net.title": "Тест P2P-соединения",
    "net.btn_create_room": "Создать комнату",
    "net.btn_copy_invite": "Копировать код приглашения",
    "net.label_paste_invite": "Вставить код приглашения",
    "net.btn_join": "Присоединиться",
    "net.btn_copy_answer": "Копировать код ответа",
    "net.label_paste_answer": "Вставить код ответа",
    "net.btn_connect": "Подключить",
    "net.msg_placeholder": "Сообщение для отправки",
    "net.btn_send_msg": "Отправить сообщение",
    "net.received_messages": "Полученные сообщения",
    "net.no_received_messages": "Сообщений пока нет.",
    "net.connection_status_prefix": "Статус подключения: {status}",
    "net.state_idle": "Ожидание",
    "net.state_waiting_answer": "Ожидание кода ответа",
    "net.state_connecting": "Подключение",
    "net.state_connected": "Подключено",
    "net.state_disconnected": "Отключено",
    "net.state_failed": "Сбой подключения",
    "net.log_invite_created": "Создан {length}-значный код приглашения.",
    "net.log_answer_created": "Создан {length}-значный код ответа.",
    "net.log_answer_applied": "Код ответа применен.",
    "net.log_sent_prefix": "Отправлено: {payload}",
  },

  "pt-BR": {
    // Progress
    "progress.guest_device_stored": "O progresso de convidado é salvo neste dispositivo.",
    "progress.local_cache_failed": "Falha ao salvar cache local. Não feche a janela antes da conclusão do salvamento no servidor.",
    "progress.mastery_pending_cached": "Novos registros de maestria serão mantidos no cache do dispositivo até a atualização do servidor.",
    "progress.saving": "Salvando progresso…",
    "progress.account_changed_reloading": "Conta alterada. Recarregando progresso…",
    "progress.loading": "Carregando progresso da conta…",
    "progress.corrupted_cache": "Cache do dispositivo corrompido. Dados originais preservados e salvamento pausado. Selecione Usar dados do servidor após a recuperação.",
    "progress.backup_failed_no_replace": "Falha ao fazer backup dos registros locais em conflito. Os registros do servidor não foram aplicados.",
    "progress.conflict_backed_up": "Os registros em conflito com outro dispositivo ({keys}) foram armazenados em backup. Escolha qual registro usar.",
    "progress.loaded_mastery_pending": "Progresso da conta carregado. Novos registros de maestria permanecerão neste dispositivo até a atualização do servidor.",
    "progress.loaded": "Progresso da conta carregado.",
    "progress.mastery_version_conflict": "Registros anteriores de condições de maestria foram preservados sem mesclagem automática. Escolha qual registro recuperar.",
    "progress.mastery_unsafe": "Formato de registro de maestria inseguro. Dados originais preservados e salvamento interrompido. Tente novamente após recuperar.",
    "progress.load_failed": "Falha ao carregar progresso da conta. Verifique a conexão e configurações do servidor e tente novamente.",
    "progress.saved_mastery_pending": "Progresso existente salvo no servidor. Novos registros de maestria permanecerão neste dispositivo até a atualização do servidor.",
    "progress.saved_conflict_resolved": "Registros anteriores em conflito salvos em backup e maestria mesclada com o servidor. Continue usando os dados do servidor.",
    "progress.saved": "Salvo no servidor.",
    "progress.save_delayed_retrying": "Salvamento atrasado devido a problemas de conexão. Tentando novamente automaticamente…",
    "progress.save_delayed_check_conn": "O salvamento no servidor está atrasado. Verifique a conexão e tente novamente.",
    "progress.backup_failed": "Falha ao fazer backup dos registros do dispositivo. Os registros do servidor não foram aplicados.",
    "progress.cache_create_failed": "Falha ao criar um cache seguro no dispositivo para alternar para os dados do servidor.",
    "progress.use_server_mastery_pending": "Usando progresso existente do servidor. Registros de maestria serão mantidos no cache do dispositivo até a atualização.",
    "progress.use_server_merging": "Usando progresso do servidor e mesclando registros de maestria…",
    "progress.use_server": "Usando registros do servidor.",

    // Startup
    "startup.loading_assets": "Carregando recursos do ChessAlkkagi…",
    "startup.loading_models_percent": "Carregando modelos de peças {percent}%",
    "startup.loading_models_bytes": "Carregando modelos de peças {size}MB",
    "startup.preparing_physics": "Preparando mundo de física…",
    "startup.stabilizing_pieces": "Estabilizando posições iniciais das peças…",
    "startup.init_failed": "Não foi possível iniciar o jogo.",

    // Online Settlement & Rematch
    "online.settle_retry_btn": "Reverificar cálculo",
    "online.settle_checking_opponent": "Verificando resultado do oponente…",
    "online.settle_waiting_opponent": "Aguardando confirmação do oponente. As estatísticas serão atualizadas após a verificação.",
    "online.settle_opponent_info": "Oponente: {name} · {tier} · {delta} pts · {progress}",
    "online.settle_failed": "Não foi possível concluir o cálculo. Verifique novamente.",
    "online.reconnect_overlay_title": "Partida Online",
    "online.reconnect_overlay_disconnected": "Desconectado do oponente",
    "online.reconnect_overlay_prompt": "Reconecte-se ou encerre a partida.",
    "online.reconnect_overlay_create_code": "Criar código de reconexão",
    "online.reconnect_overlay_abandon": "Encerrar partida",
    "online.reconnect_exchanging_codes": "Trocando novos códigos de conexão P2P…",
    "online.reconnect_syncing_state": "Sincronizando estado do anfitrião e histórico da partida…",
    "online.rematch_btn": "Revanche",
    "online.rematch_cancel_btn": "Cancelar solicitação",
    "online.rematch_accept_btn": "Aceitar",
    "online.rematch_decline_btn": "Recusar",
    "online.rematch_waiting_response": "Aguardando resposta do oponente…",
    "online.rematch_preparing": "Preparando nova partida…",
    "online.rematch_failed_start": "Falha ao iniciar revanche: {reason}",
    "online.rematch_failed_hash_mismatch": "Falha ao iniciar revanche: os estados iniciais do turno 0 não coincidem.",
    "online.rematch_requested": "O oponente solicitou uma revanche",
    "online.rematch_declined": "O oponente recusou a revanche",

    // Manual P2P Online Lobby
    "manual_online.resuming_match": "Retomando partida…",
    "manual_online.connected_preparing": "Conectado. Preparando partida…",
    "manual_online.generating_invite_code": "Coletando candidatos ICE e criando código de convite…",
    "manual_online.send_invite_prompt": "Envie o código de convite de {length} caracteres para o seu oponente.",
    "manual_online.paste_invite_prompt": "Cole o código de convite recebido.",
    "manual_online.generating_answer_code": "Coletando candidatos ICE e criando código de resposta…",
    "manual_online.send_answer_prompt": "Envie o código de resposta de {length} caracteres para o anfitrião.",
    "manual_online.send_reconnect_answer_prompt": "Envie o código de reconexão de {length} caracteres para o anfitrião.",
    "manual_online.applying_answer_code": "Aplicando código de resposta e conectando…",
    "manual_online.code_copied": "Copiados {length} caracteres de {label}.",
    "manual_online.label_invite_code": "Código de convite",
    "manual_online.label_answer_code": "Código de resposta",

    // Matchmaking
    "matchmaking.joining_queue": "Entrando na fila de matchmaking…",
    "matchmaking.searching_standard": "Buscando oponente com MMR similar…",
    "matchmaking.searching_range": "Buscando oponente… (MMR ±{diff})",
    "matchmaking.match_found_info": "Oponente encontrado: {nickname} ({mmr})",
    "matchmaking.match_found_name": "Oponente encontrado: {nickname}",
    "matchmaking.turn_delayed_researching": "Conexão P2P/TURN com o oponente atrasada. Buscando na fila novamente…",
    "matchmaking.default_opponent_name": "Jogador Oponente",
    "matchmaking.signaling_sending_answer": "Estabelecendo conexão P2P (Enviando Answer)…",
    "matchmaking.signaling_confirming": "Confirmando conexão P2P…",
    "matchmaking.signaling_creating_offer": "Preparando conexão P2P (Criando Offer)…",
    "matchmaking.signaling_responding": "Respondendo à conexão P2P…",
    "matchmaking.connected_starting_game": "P2P conectado com sucesso! Iniciando jogo.",
    "matchmaking.connecting_friend": "Conectando partida 1x1 com amigo…",
    "matchmaking.signaling_exchanging_signals": "Trocando sinais P2P…",
    "matchmaking.cancelled": "Matchmaking cancelado.",

    // Net Development Tool
    "net.title": "Teste de Conexão P2P",
    "net.btn_create_room": "Criar sala",
    "net.btn_copy_invite": "Copiar código de convite",
    "net.label_paste_invite": "Colar código de convite",
    "net.btn_join": "Entrar",
    "net.btn_copy_answer": "Copiar código de resposta",
    "net.label_paste_answer": "Colar código de resposta",
    "net.btn_connect": "Conectar",
    "net.msg_placeholder": "Mensagem para enviar",
    "net.btn_send_msg": "Enviar mensagem",
    "net.received_messages": "Mensagens recebidas",
    "net.no_received_messages": "Nenhuma mensagem recebida ainda.",
    "net.connection_status_prefix": "Status da conexão: {status}",
    "net.state_idle": "Ocioso",
    "net.state_waiting_answer": "Aguardando código de resposta",
    "net.state_connecting": "Conectando",
    "net.state_connected": "Conectado",
    "net.state_disconnected": "Desconectado",
    "net.state_failed": "Falha na conexão",
    "net.log_invite_created": "Código de convite de {length} caracteres gerado.",
    "net.log_answer_created": "Código de resposta de {length} caracteres gerado.",
    "net.log_answer_applied": "Código de resposta aplicado.",
    "net.log_sent_prefix": "Enviado: {payload}",
  },
};

/**
 * 런타임 다국어 텍스트 조회 헬퍼 함수
 */
export function getRuntimeText(
  key: RuntimeTextKey,
  params?: Record<string, string | number>,
  lang?: LanguageCode
): string {
  const currentLang = lang ?? getCurrentLanguage();
  const dict = RUNTIME_LOCALES[currentLang] ?? RUNTIME_LOCALES["en"] ?? RUNTIME_LOCALES["ko"];
  let text = dict[key] ?? RUNTIME_LOCALES["en"]?.[key] ?? RUNTIME_LOCALES["ko"]?.[key] ?? key;
  if (params && typeof text === "string") {
    for (const [pKey, pVal] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${pKey}\\}`, "g"), String(pVal));
    }
  }
  return text;
}
