import { I18nManager, type LanguageCode } from "./i18n";

export type FriendlyCopyKey =
  | "title"
  | "create_room_btn"
  | "join_room_btn"
  | "host_waiting"
  | "guest_connecting"
  | "handshake_signaling"
  | "connected"
  | "cancelled_by_host"
  | "cancelled_by_user"
  | "invalid_code"
  | "room_timeout"
  | "room_not_found"
  | "peer_error"
  | "copy_code"
  | "copied"
  | "enter_code_placeholder"
  | "friend_challenge_title"
  | "guest_code_title"
  | "room_code_label";

export const FRIENDLY_LOCALES: Record<LanguageCode, Record<FriendlyCopyKey, string>> = {
  ko: {
    title: "친선전 (방 코드 / 친구 초대)",
    create_room_btn: "새 방 만들기",
    join_room_btn: "방 참가하기",
    host_waiting: "상대방이 참가하기를 기다리는 중입니다…",
    guest_connecting: "방에 연결하는 중입니다…",
    handshake_signaling: "P2P 신호를 교환하는 중입니다…",
    connected: "연결되었습니다! 대전을 시작합니다.",
    cancelled_by_host: "방장이 대기실을 취소했습니다.",
    cancelled_by_user: "연결이 취소되었습니다.",
    invalid_code: "유효하지 않은 12자리 초대 코드입니다.",
    room_timeout: "연결 시간이 초과되었습니다. 코드를 확인 후 다시 시도해주세요.",
    room_not_found: "방을 찾을 수 없거나 이미 닫힌 방입니다.",
    peer_error: "P2P 네트워크 연결에 실패했습니다.",
    copy_code: "코드 복사",
    copied: "복사됨!",
    enter_code_placeholder: "12자리 초대 코드 입력",
    friend_challenge_title: "친구와 직접 대전",
    guest_code_title: "초대 코드로 빠른 대전",
    room_code_label: "방 초대 코드",
  },
  en: {
    title: "Friendly Match (Room Code / Friend Invite)",
    create_room_btn: "Create Room",
    join_room_btn: "Join Room",
    host_waiting: "Waiting for opponent to join…",
    guest_connecting: "Connecting to room…",
    handshake_signaling: "Exchanging P2P signals…",
    connected: "Connected! Starting the match.",
    cancelled_by_host: "The host cancelled the room.",
    cancelled_by_user: "Connection cancelled.",
    invalid_code: "Invalid 12-character invite code.",
    room_timeout: "Connection timed out. Please check the code and try again.",
    room_not_found: "Room not found or already closed.",
    peer_error: "Failed to establish P2P connection.",
    copy_code: "Copy Code",
    copied: "Copied!",
    enter_code_placeholder: "Enter 12-character invite code",
    friend_challenge_title: "Play with Friends",
    guest_code_title: "Quick Match via Invite Code",
    room_code_label: "Room Invite Code",
  },
  ja: {
    title: "フレンド対戦 (ルームコード / フレンド招待)",
    create_room_btn: "部屋を作成",
    join_room_btn: "部屋に参加",
    host_waiting: "対戦相手の参加を待っています…",
    guest_connecting: "ルームに接続中…",
    handshake_signaling: "P2Pシグナルを交換中…",
    connected: "接続完了！ 対戦を開始します。",
    cancelled_by_host: "ホストが部屋をキャンセルしました。",
    cancelled_by_user: "接続がキャンセルされました。",
    invalid_code: "無効な12桁の招待コードです。",
    room_timeout: "接続がタイムアウトしました。コードを確認して再試行してください。",
    room_not_found: "部屋が見つからないか、既に終了しています。",
    peer_error: "P2P接続の確立に失敗しました。",
    copy_code: "コードをコピー",
    copied: "コピー完了！",
    enter_code_placeholder: "12桁の招待コードを入力",
    friend_challenge_title: "フレンドと直接対戦",
    guest_code_title: "招待コードでクイック対戦",
    room_code_label: "ルーム招待コード",
  },
  "zh-CN": {
    title: "好友对战 (房间代码 / 好友邀请)",
    create_room_btn: "创建房间",
    join_room_btn: "加入房间",
    host_waiting: "正在等待对手加入…",
    guest_connecting: "正在连接房间…",
    handshake_signaling: "正在交换P2P信令…",
    connected: "已连接！ 对局即将开始。",
    cancelled_by_host: "房主已取消该房间。",
    cancelled_by_user: "连接已取消。",
    invalid_code: "无效的12位邀请代码。",
    room_timeout: "连接超时。请核对代码后重试。",
    room_not_found: "房间不存在或已关闭。",
    peer_error: "P2P网络连接失败。",
    copy_code: "复制代码",
    copied: "已复制！",
    enter_code_placeholder: "输入12位邀请码",
    friend_challenge_title: "与好友直接对战",
    guest_code_title: "通过邀请码快速对战",
    room_code_label: "房间邀请码",
  },
  de: {
    title: "Freundschaftsspiel (Raumcode / Freundeseinladung)",
    create_room_btn: "Raum erstellen",
    join_room_btn: "Raum beitreten",
    host_waiting: "Warte auf Beitritt des Gegners…",
    guest_connecting: "Verbinde mit Raum…",
    handshake_signaling: "Tausche P2P-Signale aus…",
    connected: "Verbunden! Das Spiel beginnt.",
    cancelled_by_host: "Der Host hat den Raum abgebrochen.",
    cancelled_by_user: "Verbindung abgebrochen.",
    invalid_code: "Ungültiger 12-stelliger Einladungscode.",
    room_timeout: "Zeitüberschreitung der Verbindung. Bitte Code prüfen und erneut versuchen.",
    room_not_found: "Raum nicht gefunden oder bereits geschlossen.",
    peer_error: "P2P-Verbindung fehlgeschlagen.",
    copy_code: "Code kopieren",
    copied: "Kopiert!",
    enter_code_placeholder: "12-stelligen Einladungscode eingeben",
    friend_challenge_title: "Direkt mit Freunden spielen",
    guest_code_title: "Schnellspiel per Einladungscode",
    room_code_label: "Raum-Einladungscode",
  },
  fr: {
    title: "Match amical (Code de salle / Invitation d'ami)",
    create_room_btn: "Créer une salle",
    join_room_btn: "Rejoindre la salle",
    host_waiting: "En attente de l'adversaire…",
    guest_connecting: "Connexion à la salle…",
    handshake_signaling: "Échange des signaux P2P…",
    connected: "Connecté ! Début de la partie.",
    cancelled_by_host: "L'hôte a annulé la salle.",
    cancelled_by_user: "Connexion annulée.",
    invalid_code: "Code d'invitation à 12 caractères non valide.",
    room_timeout: "Délai de connexion dépassé. Veuillez vérifier le code et réessayer.",
    room_not_found: "Salle introuvable ou déjà fermée.",
    peer_error: "Échec de la connexion P2P.",
    copy_code: "Copier le code",
    copied: "Copié !",
    enter_code_placeholder: "Entrez le code d'invitation à 12 caractères",
    friend_challenge_title: "Jouer directement avec un ami",
    guest_code_title: "Partie rapide via code d'invitation",
    room_code_label: "Code d'invitation de la salle",
  },
  es: {
    title: "Partida amistosa (Código de sala / Invitar amigo)",
    create_room_btn: "Crear sala",
    join_room_btn: "Unirse a la sala",
    host_waiting: "Esperando a que se una el rival…",
    guest_connecting: "Conectando a la sala…",
    handshake_signaling: "Intercambiando señales P2P…",
    connected: "¡Conectado! Comenzando la partida.",
    cancelled_by_host: "El anfitrión canceló la sala.",
    cancelled_by_user: "Conexión cancelada.",
    invalid_code: "Código de invitación de 12 caracteres no válido.",
    room_timeout: "Tiempo de espera agotado. Verifica el código e inténtalo de nuevo.",
    room_not_found: "Sala no encontrada o ya cerrada.",
    peer_error: "Error al establecer la conexión P2P.",
    copy_code: "Copiar código",
    copied: "¡Copiado!",
    enter_code_placeholder: "Ingresa el código de 12 caracteres",
    friend_challenge_title: "Jugar directamente con amigos",
    guest_code_title: "Partida rápida con código",
    room_code_label: "Código de invitación de la sala",
  },
  ru: {
    title: "Товарищеский матч (Код комнаты / Приглашение друга)",
    create_room_btn: "Создать комнату",
    join_room_btn: "Войти в комнату",
    host_waiting: "Ожидание подключения соперника…",
    guest_connecting: "Подключение к комнате…",
    handshake_signaling: "Обмен сигналами P2P…",
    connected: "Подключено! Игра начинается.",
    cancelled_by_host: "Хост отменил комнату.",
    cancelled_by_user: "Соединение отменено.",
    invalid_code: "Недействительный 12-значный код приглашения.",
    room_timeout: "Время ожидания истекло. Проверьте код и попробуйте снова.",
    room_not_found: "Комната не найдена или уже закрыта.",
    peer_error: "Не удалось установить P2P-соединение.",
    copy_code: "Копировать код",
    copied: "Скопировано!",
    enter_code_placeholder: "Введите 12-значный код приглашения",
    friend_challenge_title: "Сыграть с другом",
    guest_code_title: "Быстрая игра по коду приглашения",
    room_code_label: "Код приглашения комнаты",
  },
  "pt-BR": {
    title: "Partida Amistosa (Código de Sala / Convite de Amigo)",
    create_room_btn: "Criar Sala",
    join_room_btn: "Entrar na Sala",
    host_waiting: "Aguardando o oponente entrar…",
    guest_connecting: "Conectando à sala…",
    handshake_signaling: "Trocando sinais P2P…",
    connected: "Conectado! Iniciando a partida.",
    cancelled_by_host: "O anfitrião cancelou a sala.",
    cancelled_by_user: "Conexão cancelada.",
    invalid_code: "Código de convite de 12 caracteres inválido.",
    room_timeout: "Tempo limite esgotado. Verifique o código e tente novamente.",
    room_not_found: "Sala não encontrada ou já encerrada.",
    peer_error: "Falha ao estabelecer conexão P2P.",
    copy_code: "Copiar Código",
    copied: "Copiado!",
    enter_code_placeholder: "Digite o código de 12 caracteres",
    friend_challenge_title: "Jogar diretamente com amigos",
    guest_code_title: "Partida rápida por código",
    room_code_label: "Código de convite da sala",
  },
};

export function getFriendlyCopy(
  key: FriendlyCopyKey,
  language?: LanguageCode,
  params?: Record<string, string | number>,
): string {
  const lang = language ?? I18nManager.getLanguage();
  const table = FRIENDLY_LOCALES[lang] ?? FRIENDLY_LOCALES.en;
  let text = table[key] ?? FRIENDLY_LOCALES.en[key] ?? key;

  if (params) {
    for (const [paramKey, paramVal] of Object.entries(params)) {
      text = text.replaceAll(`{${paramKey}}`, String(paramVal));
    }
  }

  return text;
}
