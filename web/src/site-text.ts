export type LanguageCode = "ko" | "en" | "ja" | "zh-CN" | "de" | "fr" | "es" | "ru" | "pt-BR";

export interface LanguageOption {
  code: LanguageCode;
  label: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "ko", label: "한국어" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "zh-CN", label: "简体中文" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "ru", label: "Русский" },
  { code: "pt-BR", label: "Português (Brasil)" },
];

export interface SiteNavText {
  skipLink: string;
  brand: string;
  navPlay: string;
  navAbout: string;
  navGuide: string;
  navTiers: string;
  navUpdates: string;
  footerPrivacy: string;
  footerDeleteAccount: string;
  footerContact: string;
  adLabel: string;
  langSelectLabel: string;
}

export interface AboutPageText {
  title: string;
  description: string;
  h1: string;
  lead: string;
  sec1Title: string;
  sec1P1: string;
  sec1P2: string;
  sec2Title: string;
  sec2Items: string[];
  sec3Title: string;
  sec3P: string;
  sec4Title: string;
  sec4P: string;
}

export interface GuidePageText {
  title: string;
  description: string;
  h1: string;
  lead: string;
  sec1Title: string;
  sec1Steps: string[];
  sec1P: string;
  sec2Title: string;
  sec2P1: string;
  sec2P2: string;
  sec3Title: string;
  sec3P1: string;
  sec3P2: string;
  sec4Title: string;
  sec4P: string;
  sec5Title: string;
  sec5Items: string[];
}

export interface TierRow {
  tier: string;
  range: string;
}

export interface TiersPageText {
  title: string;
  description: string;
  h1: string;
  lead: string;
  sec1Title: string;
  sec1P1: string;
  tableCaption: string;
  thTier: string;
  thRange: string;
  tiers: TierRow[];
  sec1P2: string;
  sec2Title: string;
  sec2P1: string;
  sec2P2: string;
  sec3Title: string;
  sec3P1: string;
  sec3P2: string;
}

export interface UpdateEntry {
  dateTitle: string;
  items?: string[];
  paragraphs?: string[];
}

export interface UpdatesPageText {
  title: string;
  description: string;
  h1: string;
  lead: string;
  entries: UpdateEntry[];
  helpTitle: string;
  helpP: string;
}

export const SITE_NAV_TRANSLATIONS: Record<LanguageCode, SiteNavText> = {
  ko: {
    skipLink: "본문으로 이동",
    brand: "체스알까기",
    navPlay: "게임 시작",
    navAbout: "소개·문의",
    navGuide: "조작법·규칙",
    navTiers: "티어",
    navUpdates: "업데이트",
    footerPrivacy: "개인정보처리방침",
    footerDeleteAccount: "계정 삭제",
    footerContact: "문의",
    adLabel: "광고",
    langSelectLabel: "언어 선택",
  },
  en: {
    skipLink: "Skip to content",
    brand: "ChessAlkkagi",
    navPlay: "Play Game",
    navAbout: "About · Contact",
    navGuide: "Controls & Rules",
    navTiers: "Tiers",
    navUpdates: "Updates",
    footerPrivacy: "Privacy Policy",
    footerDeleteAccount: "Delete Account",
    footerContact: "Contact",
    adLabel: "Advertisement",
    langSelectLabel: "Select Language",
  },
  ja: {
    skipLink: "本文へ移動",
    brand: "チェスおはじき",
    navPlay: "ゲーム開始",
    navAbout: "紹介・お問い合わせ",
    navGuide: "操作法・ルール",
    navTiers: "ティア",
    navUpdates: "アップデート",
    footerPrivacy: "プライバシーポリシー",
    footerDeleteAccount: "アカウント削除",
    footerContact: "お問い合わせ",
    adLabel: "広告",
    langSelectLabel: "言語選択",
  },
  "zh-CN": {
    skipLink: "跳转到正文",
    brand: "国际象棋弹珠",
    navPlay: "开始游戏",
    navAbout: "介绍与咨询",
    navGuide: "操作与规则",
    navTiers: "段位",
    navUpdates: "更新日志",
    footerPrivacy: "隐私政策",
    footerDeleteAccount: "删除账号",
    footerContact: "联系我们",
    adLabel: "广告",
    langSelectLabel: "选择语言",
  },
  de: {
    skipLink: "Zum Inhalt springen",
    brand: "ChessAlkkagi",
    navPlay: "Spiel starten",
    navAbout: "Über · Kontakt",
    navGuide: "Steuerung & Regeln",
    navTiers: "Ränge",
    navUpdates: "Updates",
    footerPrivacy: "Datenschutzerklärung",
    footerDeleteAccount: "Konto löschen",
    footerContact: "Kontakt",
    adLabel: "Werbung",
    langSelectLabel: "Sprache wählen",
  },
  fr: {
    skipLink: "Passer au contenu",
    brand: "ChessAlkkagi",
    navPlay: "Jouer",
    navAbout: "À propos · Contact",
    navGuide: "Commandes & Règles",
    navTiers: "Rangs",
    navUpdates: "Mises à jour",
    footerPrivacy: "Politique de confidentialité",
    footerDeleteAccount: "Supprimer le compte",
    footerContact: "Contact",
    adLabel: "Publicité",
    langSelectLabel: "Choisir la langue",
  },
  es: {
    skipLink: "Saltar al contenido",
    brand: "ChessAlkkagi",
    navPlay: "Jugar",
    navAbout: "Acerca de · Contacto",
    navGuide: "Controles y Reglas",
    navTiers: "Rangos",
    navUpdates: "Actualizaciones",
    footerPrivacy: "Política de privacidad",
    footerDeleteAccount: "Eliminar cuenta",
    footerContact: "Contacto",
    adLabel: "Publicidad",
    langSelectLabel: "Seleccionar idioma",
  },
  ru: {
    skipLink: "Перейти к содержанию",
    brand: "ChessAlkkagi",
    navPlay: "Играть",
    navAbout: "О нас · Контакты",
    navGuide: "Управление и правила",
    navTiers: "Ранги",
    navUpdates: "Обновления",
    footerPrivacy: "Политика конфиденциальности",
    footerDeleteAccount: "Удаление аккаунта",
    footerContact: "Контакты",
    adLabel: "Реклама",
    langSelectLabel: "Выбор языка",
  },
  "pt-BR": {
    skipLink: "Ir para o conteúdo",
    brand: "ChessAlkkagi",
    navPlay: "Jogar",
    navAbout: "Sobre · Contato",
    navGuide: "Controles e Regras",
    navTiers: "Ranques",
    navUpdates: "Atualizações",
    footerPrivacy: "Política de Privacidade",
    footerDeleteAccount: "Excluir conta",
    footerContact: "Contato",
    adLabel: "Publicidade",
    langSelectLabel: "Selecionar idioma",
  },
};

export const ABOUT_TRANSLATIONS: Record<LanguageCode, AboutPageText> = {
  ko: {
    title: "게임 소개와 문의 | 체스알까기",
    description: "체스알까기의 게임 소개와 문의. 실제 게임의 플레이 방식과 이용 안내를 확인하세요.",
    h1: "게임 소개와 문의",
    lead: "체스 말의 모양과 알까기의 충돌을 결합한 물리 대전 게임입니다. 말을 뒤로 당겨 발사하고, 상대 말을 밀어내면서 내 킹을 지키세요.",
    sec1Title: "체스알까기는 어떤 게임인가요?",
    sec1P1: "말을 칸에서 칸으로 옮기는 일반 체스와 달리, 발사 방향과 힘, 충돌 뒤의 위치가 중요합니다. 상대를 맞히는 것만으로 끝나지 않습니다. 공격한 내 말이 어디에 멈출지도 생각해야 다음 턴에 유리한 위치를 만들 수 있습니다.",
    sec1P2: "처음에는 기본 튜토리얼에서 조준과 힘 조절을 익혀 보세요. 이어서 스테이지와 퍼즐을 연습하거나, 한 기기에서 두 사람이 번갈아 플레이할 수 있습니다.",
    sec2Title: "플레이 방식",
    sec2Items: [
      "<strong>튜토리얼:</strong> 드래그 발사, 대각선 조준, 충돌과 장외 판정을 연습합니다.",
      "<strong>스테이지·퍼즐:</strong> 준비된 상황에서 목표를 달성하고 다른 접근 방법을 시험합니다. 퍼즐별 목표와 제한은 시작 화면에서 확인하세요.",
      "<strong>로컬 2인:</strong> 같은 기기에서 번갈아 조작합니다.",
      "<strong>온라인:</strong> 클래식·전략 대전을 선택합니다. 모드별 전적과 티어를 따로 확인할 수 있습니다.",
    ],
    sec3Title: "계정과 기록",
    sec3P: "게스트로 시작하거나 이메일 계정을 사용할 수 있습니다. 브라우저에 저장되는 진행 정보와 서버에 저장되는 계정·대전 정보는 다릅니다. 브라우저 데이터 삭제만으로 서버 계정이 삭제되지는 않습니다. 자세한 내용은 <a href=\"./privacy.html\">개인정보처리방침</a>과 <a href=\"./delete-account.html\">계정 삭제 안내</a>에서 확인하세요.",
    sec4Title: "문의와 오류 제보",
    sec4P: "<a href=\"mailto:dubokup@gmail.com\">dubokup@gmail.com</a>으로 문의할 수 있습니다. 오류 제보에는 웹 또는 Android 앱 여부, 사용한 기기·브라우저, 게임 모드와 문제가 발생하기 직전 행동을 적어 주세요. 비밀번호는 보내지 마세요.",
  },
  en: {
    title: "About & Contact | ChessAlkkagi",
    description: "About and contact information for ChessAlkkagi. Learn about the gameplay mechanics and user guides.",
    h1: "About & Contact",
    lead: "A physics battle game combining chess piece mechanics with traditional flicking collision. Pull back your pieces to launch them, knock opponent pieces off the board, and protect your King.",
    sec1Title: "What is ChessAlkkagi?",
    sec1P1: "Unlike traditional chess where pieces move tile by tile, launch direction, power, and post-collision positioning are crucial. Hitting an opponent is not enough; you must also consider where your attacking piece will come to rest to secure an advantageous position for the next turn.",
    sec1P2: "Start with the Basic Tutorial to master aiming and power control. Then proceed to Stages and Puzzle challenges, or play with a friend locally on the same device.",
    sec2Title: "Game Modes",
    sec2Items: [
      "<strong>Tutorial:</strong> Practice drag launching, diagonal aiming, collisions, and out-of-bounds rules.",
      "<strong>Stages & Puzzles:</strong> Clear specific board scenarios and experiment with tactical approaches. Check each puzzle's objectives and move limits on the start screen.",
      "<strong>Local 2-Player:</strong> Take turns playing on a single device.",
      "<strong>Online:</strong> Choose between Classic and Strategy ranked matches. Track match records and tiers separately for each mode.",
    ],
    sec3Title: "Accounts & Data",
    sec3P: "You can play as a guest or sign in with an email account. Local browser progress and server-synced account data are managed separately. Clearing browser data does not delete your server account. For details, see our <a href=\"./privacy.html\">Privacy Policy</a> and <a href=\"./delete-account.html\">Account Deletion Guide</a>.",
    sec4Title: "Contact & Bug Reports",
    sec4P: "You can reach us at <a href=\"mailto:dubokup@gmail.com\">dubokup@gmail.com</a>. When reporting bugs, please include whether you are using the Web or Android app, your device/browser model, the game mode, and the steps leading up to the issue. Never send passwords.",
  },
  ja: {
    title: "ゲーム紹介・お問い合わせ | チェスおはじき",
    description: "チェスおはじきの紹介とお問い合わせ。ゲームの遊び方とご利用案内をご確認ください。",
    h1: "ゲーム紹介とお問い合わせ",
    lead: "チェスの駒の形状とおはじきの衝突を融合させた物理対戦ゲームです。駒を後ろに引いて発射し、相手の駒を弾き飛ばしながら自分のキングを守りましょう。",
    sec1Title: "チェスおはじきとは？",
    sec1P1: "マス目を移動する通常のチェスとは異なり、発射の方向と強さ、衝突後の位置関係が勝敗を分けます。相手に当てるだけでなく、攻撃した自分の駒がどこで止まるかを計算することで次のターンを有利に進められます。",
    sec1P2: "まずは基本チュートリアルでエイムと力加減に慣れてみましょう。続いてステージやパズルを攻略したり、1台の端末で2人対戦を楽しめます。",
    sec2Title: "プレイ方法",
    sec2Items: [
      "<strong>チュートリアル:</strong> ドラッグ発射、斜め照準、衝突、場外判定の基本を練習します。",
      "<strong>ステージ・パズル:</strong> 用意された局面で目標を達成し、様々な解法を試します。目標や制限は各パズルの開始画面で確認できます。",
      "<strong>ローカル2人対戦:</strong> 同じ端末を使って交互に操作します。",
      "<strong>オンライン対戦:</strong> クラシックまたは戦略対戦を選択できます。モードごとの戦績とティアは個別に記録されます。",
    ],
    sec3Title: "アカウントと記録",
    sec3P: "ゲストプレイまたはメールアカウントを利用できます。ブラウザ内に保存されるローカル進行度とサーバーに保存されるアカウント・対戦情報は異なります。ブラウザデータの消去だけではサーバーアカウントは削除されません。詳細は<a href=\"./privacy.html\">プライバシーポリシー</a>および<a href=\"./delete-account.html\">アカウント削除案内</a>をご覧ください。",
    sec4Title: "お問い合わせ・不具合報告",
    sec4P: "<a href=\"mailto:dubokup@gmail.com\">dubokup@gmail.com</a>までお問い合わせください。不具合報告の際は、WebまたはAndroidアプリの別、使用端末・ブラウザ、ゲームモード、問題発生直前の操作内容を記載してください。パスワードは絶対に送信しないでください。",
  },
  "zh-CN": {
    title: "游戏介绍与咨询 | 国际象棋弹珠",
    description: "国际象棋弹珠游戏介绍与咨询。了解游戏玩法及用户使用指南。",
    h1: "游戏介绍与咨询",
    lead: "结合国际象棋棋子造型与弹珠碰撞玩法的物理对战游戏。向后拉动棋子弹射，击落对手棋子，守护己方国王！",
    sec1Title: "什么是国际象棋弹珠？",
    sec1P1: "与传统格子走棋的国际象棋不同，弹射方向、力度以及碰撞后的停留位置至关重要。击中对手只是第一步，必须同时规划攻击后己方棋子的停靠点，为下一回合创造优势。",
    sec1P2: "建议先在基础教程中熟悉瞄准与力度控制。随后可挑战关卡与残局谜题，或在同一设备上进行双人轮流对战。",
    sec2Title: "玩法模式",
    sec2Items: [
      "<strong>新手教程：</strong> 练习拖拽发射、对角瞄准、碰撞反弹与出界判定。",
      "<strong>关卡与谜题：</strong> 在特定局面下达成目标并探索不同解法。各谜题目标与步数限制可在开始界面查看。",
      "<strong>本地双人：</strong> 在同一台设备上轮流操作对战。",
      "<strong>在线排位：</strong> 提供经典与战略两种模式。各模式的战绩与段位独立记录与结算。",
    ],
    sec3Title: "账号与存档",
    sec3P: "支持游客试玩或邮箱注册登录。浏览器本地保存的进度与服务器存储的账号对战记录分别管理。清除浏览器数据不会自动删除服务器账号。详情请参阅<a href=\"./privacy.html\">隐私政策</a>与<a href=\"./delete-account.html\">账号注销说明</a>。",
    sec4Title: "咨询与问题反馈",
    sec4P: "可通过 <a href=\"mailto:dubokup@gmail.com\">dubokup@gmail.com</a> 联系我们。反馈问题时，请注明网页端或安卓端、设备及浏览器型号、游戏模式及故障发生前的操作步骤。请勿发送您的密码。",
  },
  de: {
    title: "Über das Spiel & Kontakt | ChessAlkkagi",
    description: "Über ChessAlkkagi und Kontaktinformationen. Erfahren Sie alles über Spielmechaniken und Anleitungen.",
    h1: "Über das Spiel & Kontakt",
    lead: "Ein physikalisches Duellspiel, das Schachfiguren mit dem traditionellen Schnipsen verbindet. Ziehe deine Figuren zurück, um sie abzuschießen, stoße gegnerische Figuren vom Brett und schütze deinen König.",
    sec1Title: "Was ist ChessAlkkagi?",
    sec1P1: "Im Gegensatz zum klassischen Schach, bei dem Figuren von Feld zu Feld ziehen, kommt es hier auf Schussrichtung, Kraft und die Position nach dem Zusammenstoß an. Den Gegner zu treffen reicht nicht aus – plane, wo deine Figur stoppt, um dir im nächsten Zug einen Vorteil zu verschaffen.",
    sec1P2: "Beginne mit dem Grundtutorial, um das Zielen und die Kraftdosierung zu meistern. Spiele anschließend Level und Rätsel oder trete lokal auf einem Gerät gegen einen Freund an.",
    sec2Title: "Spielmodi",
    sec2Items: [
      "<strong>Tutorial:</strong> Übe das Ziehen & Schießen, diagonales Zielen, Kollisionen und Aus-Regeln.",
      "<strong>Level & Rätsel:</strong> Löse vorgegebene Szenarien und probiere taktische Ansätze aus. Missionsziele findest du im Startbildschirm.",
      "<strong>Lokales 2-Spieler-Spiel:</strong> Spielt abwechselnd an einem gemeinsamen Gerät.",
      "<strong>Online:</strong> Wähle zwischen Klassik- und Strategiemodus. Spielstatistiken und Ränge werden getrennt geführt.",
    ],
    sec3Title: "Konto und Speicherstände",
    sec3P: "Du kannst als Gast spielen oder dich mit einer E-Mail anmelden. Im Browser gespeicherte Fortschritte und serverseitige Daten sind getrennt. Das Löschen von Browserdaten löscht nicht dein Serverkonto. Weitere Infos in der <a href=\"./privacy.html\">Datenschutzerklärung</a> und der <a href=\"./delete-account.html\">Konto-Löschungsanleitung</a>.",
    sec4Title: "Kontakt und Fehlerberichte",
    sec4P: "Schreibe uns an <a href=\"mailto:dubokup@gmail.com\">dubokup@gmail.com</a>. Bitte nenne bei Fehlern die Plattform (Web/Android), Gerät/Browser, Spielmodus und die letzten Schritte vor dem Fehler. Sende niemals Passwörter.",
  },
  fr: {
    title: "À propos & Contact | ChessAlkkagi",
    description: "Présentation du jeu et contact pour ChessAlkkagi. Découvrez les mécanismes de jeu et les guides d'utilisation.",
    h1: "À propos & Contact",
    lead: "Un jeu de combat physique combinant les pièces d'échecs et les règles de pichenette. Tirez vos pièces vers l'arrière pour les projeter, expulsez les pièces adverses du plateau et protégez votre Roi.",
    sec1Title: "Qu'est-ce que ChessAlkkagi ?",
    sec1P1: "Contrairement aux échecs classiques où les pièces se déplacent case par case, la direction du tir, la puissance et la position après collision sont essentielles. Frapper l'adversaire ne suffit pas : vous devez anticiper l'arrêt de votre pièce pour conserver l'avantage au tour suivant.",
    sec1P2: "Commencez par le didacticiel de base pour maîtriser la visée et la puissance, puis progressez à travers les étapes et casse-têtes, ou jouez à deux sur le même appareil.",
    sec2Title: "Modes de jeu",
    sec2Items: [
      "<strong>Didacticiel :</strong> Entraînez-vous au tir par glisser-déposer, à la visée diagonale, aux collisions et aux sorties de plateau.",
      "<strong>Étapes & Casse-têtes :</strong> Atteignez des objectifs définis et explorez diverses approches stratégiques. Les limites sont indiquées au début.",
      "<strong>2 Joueurs Local :</strong> Jouez à tour de rôle sur le même écran.",
      "<strong>En ligne :</strong> Choisissez entre les duels Classiques et Stratégiques. Les scores et rangs sont calculés séparément.",
    ],
    sec3Title: "Comptes et Données",
    sec3P: "Jouez en tant qu'invité ou connectez-vous avec un e-mail. Les données du navigateur local et les comptes sauvegardés sur le serveur sont gérés séparément. Supprimer les données de navigation ne supprime pas votre compte serveur. Consultez notre <a href=\"./privacy.html\">Politique de confidentialité</a> et notre <a href=\"./delete-account.html\">Guide de suppression de compte</a>.",
    sec4Title: "Contact et Signalement de bugs",
    sec4P: "Contactez-nous à <a href=\"mailto:dubokup@gmail.com\">dubokup@gmail.com</a>. Veuillez préciser la version (Web ou Android), votre appareil/navigateur, le mode de jeu et les actions précédant le problème. N'envoyez jamais de mot de passe.",
  },
  es: {
    title: "Acerca de y Contacto | ChessAlkkagi",
    description: "Información sobre ChessAlkkagi y contacto. Conoce la mecánica del juego y las guías de uso.",
    h1: "Acerca de y Contacto",
    lead: "Un juego de batalla física que combina las piezas de ajedrez con la mecánica de disparos y colisiones. Arrastra las piezas hacia atrás para lanzarlas, expulsa a las del oponente fuera del tablero y protege a tu Rey.",
    sec1Title: "¿Qué es ChessAlkkagi?",
    sec1P1: "A diferencia del ajedrez tradicional de casillas, la dirección de lanzamiento, la fuerza y la posición final tras chocar son determinantes. No basta con golpear al rival; debes calcular dónde frenará tu pieza para mantener ventaja en el siguiente turno.",
    sec1P2: "Comienza con el tutorial básico para dominar el apuntado y la potencia. Luego practica en los niveles y rompecabezas, o juega con dos personas en un mismo dispositivo.",
    sec2Title: "Modos de Juego",
    sec2Items: [
      "<strong>Tutorial:</strong> Practica el lanzamiento por arrastre, apuntado en diagonal, rebotes y caídas del tablero.",
      "<strong>Fases y Rompecabezas:</strong> Cumple los objetivos en escenarios preparados y prueba distintas soluciones tácticas.",
      "<strong>2 Jugadores Local:</strong> Juega por turnos en el mismo dispositivo.",
      "<strong>En línea:</strong> Elige entre Clásico y Estrategia. Las estadísticas y rangos se calculan de manera independiente.",
    ],
    sec3Title: "Cuentas y Guardado",
    sec3P: "Puedes jugar como invitado o con una cuenta de correo. El progreso en el navegador y los datos del servidor funcionan por separado. Borrar los datos del navegador no elimina tu cuenta en el servidor. Consulta la <a href=\"./privacy.html\">Política de privacidad</a> y la <a href=\"./delete-account.html\">Guía de eliminación de cuenta</a>.",
    sec4Title: "Contacto y Reporte de Errores",
    sec4P: "Escríbenos a <a href=\"mailto:dubokup@gmail.com\">dubokup@gmail.com</a>. Incluye si juegas en Web o Android, modelo de dispositivo/navegador, modo de juego y las acciones previas al fallo. No envíes contraseñas.",
  },
  ru: {
    title: "Об игре и контакты | ChessAlkkagi",
    description: "Информация об игре ChessAlkkagi и контакты. Узнайте о механике игры и руководствах пользователя.",
    h1: "Об игре и контакты",
    lead: "Физическая дуэльная игра, сочетающая шахматные фигуры с механикой выбивания щелчком. Оттягивайте фигуры назад для запуска, сбивайте фигуры противника с доски и защищайте своего Короля.",
    sec1Title: "Что такое ChessAlkkagi?",
    sec1P1: "В отличие от классических шахмат с перемещением по клеткам, здесь решающее значение имеют направление запуска, сила и положение после столкновения. Мало просто попасть по врагу — важно рассчитать, где остановится ваша фигура.",
    sec1P2: "Начните с базового обучения, чтобы освоить прицеливание и силу запуска. Затем переходите к этапам и головоломкам или играйте вдвоем на одном устройстве.",
    sec2Title: "Режимы игры",
    sec2Items: [
      "<strong>Обучение:</strong> Практика запуска перетягиванием, диагонального прицеливания, столкновений и вылета за пределы доски.",
      "<strong>Этапы и головоломки:</strong> Выполняйте задачи в заданных расстановках. Цели и ограничения указаны на стартовом экране.",
      "<strong>Локально на 2 игрока:</strong> Делайте ходы по очереди на одном экране.",
      "<strong>Онлайн:</strong> Выбирайте классический или стратегический режим. Рейтинг и ранги рассчитываются раздельно.",
    ],
    sec3Title: "Аккаунты и сохранение",
    sec3P: "Вы можете играть гостем или войти через почту. Данные браузера и синхронизированные данные сервера хранятся раздельно. Очистка кэша браузера не удаляет серверный аккаунт. Подробнее — в <a href=\"./privacy.html\">Политике конфиденциальности</a> и <a href=\"./delete-account.html\">Инструкции по удалению аккаунта</a>.",
    sec4Title: "Контакты и сообщения об ошибках",
    sec4P: "Свяжитесь с нами по адресу <a href=\"mailto:dubokup@gmail.com\">dubokup@gmail.com</a>. При описании ошибки укажите платформу (Web/Android), устройство/браузер, режим игры и последовательность действий. Не отправляйте пароли.",
  },
  "pt-BR": {
    title: "Sobre o Jogo e Contato | ChessAlkkagi",
    description: "Informações sobre o ChessAlkkagi e contato. Conheça as mecânicas de jogo e guias de uso.",
    h1: "Sobre o Jogo e Contato",
    lead: "Um jogo de batalha física que combina peças de xadrez com a dinâmica de colisão do peteleco. Puxe as peças para trás para disparar, empurre as peças adversárias para fora do tabuleiro e proteja seu Rei.",
    sec1Title: "O que é o ChessAlkkagi?",
    sec1P1: "Ao contrário do xadrez tradicional onde as peças andam casa a casa, aqui a direção do disparo, a força e o posicionamento após a colisão são essenciais. Acertar o adversário não é tudo: é preciso planejar onde sua peça vai parar para manter vantagem no próximo turno.",
    sec1P2: "Comece pelo tutorial básico para dominar a mira e o controle de força. Em seguida, avance pelas fases e desafios de quebra-cabeça, ou dispute partidas locais com dois jogadores no mesmo aparelho.",
    sec2Title: "Modos de Jogo",
    sec2Items: [
      "<strong>Tutorial:</strong> Pratique disparos por arraste, mira diagonal, colisões e regras de saída do tabuleiro.",
      "<strong>Fases e Quebra-cabeças:</strong> Cumpra objetivos em cenários preparados e teste abordagens táticas.",
      "<strong>2 Jogadores Local:</strong> Joguem em turnos alternados no mesmo dispositivo.",
      "<strong>Online:</strong> Escolha entre os modos Clássico e Estratégia. Histórico e ranques são calculados separadamente.",
    ],
    sec3Title: "Contas e Dados",
    sec3P: "Você pode jogar como convidado ou com uma conta de e-mail. Os dados locais do navegador e as informações salvas no servidor são gerenciados de forma independente. Limpar o navegador não remove sua conta do servidor. Consulte a <a href=\"./privacy.html\">Política de Privacidade</a> e o <a href=\"./delete-account.html\">Guia de Exclusão de Conta</a>.",
    sec4Title: "Contato e Relato de Erros",
    sec4P: "Fale conosco pelo e-mail <a href=\"mailto:dubokup@gmail.com\">dubokup@gmail.com</a>. Ao relatar problemas, informe se usa Web ou Android, dispositivo/navegador, modo de jogo e os passos que antecederam o erro. Nunca envie sua senha.",
  },
};

export const GUIDE_TRANSLATIONS: Record<LanguageCode, GuidePageText> = {
  ko: {
    title: "조작법과 게임 규칙 | 체스알까기",
    description: "체스알까기의 조작법과 게임 규칙. 실제 게임의 플레이 방식과 이용 안내를 확인하세요.",
    h1: "조작법과 게임 규칙",
    lead: "처음에는 약한 힘으로 정면 타격부터 연습하세요. 조준 방향과 충돌 이후의 위치를 익히면 대각선 공격도 안정적으로 시도할 수 있습니다.",
    sec1Title: "한 번의 발사",
    sec1Steps: [
      "내 차례에 조작할 말을 누릅니다.",
      "보내려는 방향의 반대로 드래그합니다. 표시되는 조준선과 힘 게이지를 확인합니다.",
      "방향과 힘을 정한 뒤 손을 떼어 발사합니다.",
      "말들의 움직임과 결과를 확인한 뒤 다음 차례를 진행합니다.",
    ],
    sec1P: "마우스와 터치 모두 같은 원리입니다. 조준을 길게 당기면 더 강한 발사가 됩니다. 가장 강한 발사가 항상 유리하지는 않습니다. 내 말도 가장자리로 이동하거나 상대의 다음 공격에 노출될 수 있습니다.",
    sec2Title: "승리와 장외",
    sec2P1: "기본 대전에서는 상대 킹을 보드 밖으로 떨어뜨리는 것이 목표입니다. 내 킹을 지키면서 상대의 방어를 무너뜨리세요. 퍼즐이나 스테이지에서는 별도의 배치와 목표가 주어지므로 해당 화면의 안내를 먼저 확인합니다.",
    sec2P2: "보드 가장자리에 있는 상대는 비교적 짧은 이동으로도 장외에 도달합니다. 반대로 내 말이 가장자리에 있다면, 공격 후 반동과 빈 공간까지 고려해야 합니다.",
    sec3Title: "말을 선택할 때 볼 것",
    sec3P1: "폰·나이트·비숍·룩·퀸·킹은 서로 다른 형태와 물리 특성을 가집니다. 말의 이름만으로 충돌 결과를 단정하지 말고, 실제 배치와 조준 결과를 함께 보세요. 전략 모드에서는 준비 화면의 능력치 설명을 확인하고 구성을 선택할 수 있습니다.",
    sec3P2: "폰의 승급과 킹의 특수 행동 등은 고급 튜토리얼에서 연습할 수 있습니다. 현재 온라인 대전에서는 동기화가 준비되지 않은 승급과 킹 특수 행동이 제한되어 있습니다. 온라인에서 보이지 않는 행동을 튜토리얼과 같다고 가정하지 마세요.",
    sec4Title: "클래식과 전략",
    sec4P: "온라인 준비 화면에서 클래식 또는 전략을 선택합니다. 클래식에서 기본적인 대전 감각을 익힌 뒤, 전략에서는 말의 구성을 조정하며 자신에게 맞는 운용을 찾아보세요. 두 모드의 전적과 레이팅은 별도로 관리됩니다.",
    sec5Title: "연습 순서",
    sec5Items: [
      "같은 방향에서 힘만 바꿔 이동 거리를 비교합니다.",
      "정면 타격과 비스듬한 타격 뒤 두 말의 위치를 비교합니다.",
      "한 번에 여러 말을 노리기 전에 내 킹의 안전부터 확인합니다.",
      "퍼즐 실패 후에는 방향과 힘 중 하나만 바꿔 결과를 비교합니다.",
    ],
  },
  en: {
    title: "Controls & Game Rules | ChessAlkkagi",
    description: "Controls and game rules for ChessAlkkagi. Master shooting mechanics, collisions, and strategies.",
    h1: "Controls & Game Rules",
    lead: "Start by practicing gentle frontal hits. Once you master aiming lines and post-impact positioning, you can comfortably attempt diagonal attacks.",
    sec1Title: "Executing a Shot",
    sec1Steps: [
      "Tap or click on the piece you want to control during your turn.",
      "Drag in the opposite direction of your intended shot. Check the trajectory guide and power meter.",
      "Release your finger or mouse button to fire once direction and power are set.",
      "Observe piece collisions and board state before proceeding to the next turn.",
    ],
    sec1P: "The controls work identically on both mouse and touchscreens. Dragging further back produces a stronger shot. Maximum power is not always optimal, as your own piece may overshoot toward the edge or leave itself vulnerable to opponent counter-attacks.",
    sec2Title: "Victory & Out-of-Bounds",
    sec2P1: "In standard matches, your primary goal is to knock the enemy King off the board. Break through opponent defenses while safeguarding your own King. In Puzzles and Stages, specific objectives and layouts apply, so check the in-game briefing first.",
    sec2P2: "Opponents positioned near the edge can be knocked out with minimal force. Conversely, if your own piece is near the border, consider rebound physics and empty spaces before firing.",
    sec3Title: "Understanding Piece Characteristics",
    sec3P1: "Pawns, Knights, Bishops, Rooks, Queens, and Kings possess distinct shapes, weights, and physical properties. Do not rely solely on piece names—observe actual collisions and trajectories. In Strategy mode, inspect stat cards before finalizing your loadout.",
    sec3P2: "Pawn promotion and special King maneuvers can be practiced in the Advanced Tutorial. Currently, unsynchronized promotions and special King actions are restricted in online multiplayer. Do not assume all tutorial abilities are active online.",
    sec4Title: "Classic vs. Strategy",
    sec4P: "Select Classic or Strategy mode in the online match screen. Hone your core fundamentals in Classic, then customize piece compositions in Strategy to discover your optimal playstyle. Match records and ratings are tracked separately.",
    sec5Title: "Recommended Practice Routine",
    sec5Items: [
      "Vary power along the same trajectory to compare travel distances.",
      "Compare piece rebound positions between direct frontal and angled collisions.",
      "Ensure your King's safety before attempting multi-piece combos.",
      "After failing a puzzle, adjust either direction or power individually to analyze results.",
    ],
  },
  ja: {
    title: "操作法とゲームルール | チェスおはじき",
    description: "チェスおはじきの操作法とルール。発射方法、衝突判定、戦略のコツを解説します。",
    h1: "操作法とゲームルール",
    lead: "まずは弱い力での正面衝突から練習しましょう。照準方向と衝突後の停止位置を把握することで、斜め攻撃も安定して狙えるようになります。",
    sec1Title: "ショットの手順",
    sec1Steps: [
      "自分のターンに操作したい駒をタップまたはクリックします。",
      "飛ばしたい方向とは逆方向にドラッグします。表示される照準線とパワーゲージを確認してください。",
      "方向と強さを定めたら指を離して発射します。",
      "駒の動きと結果を確認し、次のターンへ進みます。",
    ],
    sec1P: "マウスとタッチ操作は全く同じ原理です。長く引くほど強力なショットになります。ただし最大パワーが常に有利とは限りません。自軍の駒が盤外へ飛び出したり、相手の反撃に晒されるリスクがあります。",
    sec2Title: "勝利と場外判定",
    sec2P1: "基本対戦では相手のキングをボード外へ落とすことが勝利条件です。自軍のキングを守りつつ相手の陣形を崩しましょう。パズルやステージでは個別の初期配置とクリア条件が設定されています。",
    sec2P2: "盤の縁近くにいる相手は短い移動でも場外へ落としやすいです。逆に自軍の駒が端にいる場合は、攻撃後の反動と停止位置まで計算に入れる必要があります。",
    sec3Title: "駒選びのポイント",
    sec3P1: "ポーン、ナイト、ビショップ、ルーク、クイーン、キングはそれぞれ異なる形状と物理特性（質量・摩擦）を持ちます。戦略モードでは準備画面で能力値を確認し、自分に合った構成を選びましょう。",
    sec3P2: "ポーンのプロモーションやキングの特殊アクションは上級チュートリアルで練習できます。現在オンライン対戦では同期未対応の特殊アクションが一部制限されています。",
    sec4Title: "クラシックと戦略モード",
    sec4P: "オンラインマッチ画面でクラシックまたは戦略を選択します。クラシックで基本感覚を掴んだ後、戦略モードで駒の編成をカスタマイズして戦術を広げましょう。戦績とレーティングは個別に集計されます。",
    sec5Title: "おすすめの練習順序",
    sec5Items: [
      "同じ方向で力加減だけを変えて移動距離の違いを確認する。",
      "正面当てと斜め当てでの2つの駒の停止位置を比較する。",
      "複数の駒を狙う前に、まず自軍キングの安全を確保する。",
      "パズル失敗時は方向または強さのどちらか一方だけを変えて試行錯誤する。",
    ],
  },
  "zh-CN": {
    title: "操作与游戏规则 | 国际象棋弹珠",
    description: "国际象棋弹珠的操作方法与规则说明。掌握发射技巧、碰撞原理与对战策略。",
    h1: "操作与游戏规则",
    lead: "初学者建议先从低力度的正向撞击练起。掌握瞄准线与碰撞后的位置分布后，再尝试高难度的对角弹射。",
    sec1Title: "单次发射流程",
    sec1Steps: [
      "在己方回合点击或长按要操控的棋子。",
      "向目标相反方向拖拽，注意观察出现的瞄准辅助线与蓄力槽。",
      "确定方向与力度后松开手指或鼠标完成发射。",
      "等待所有棋子静止并确认局势后进入下一回合。",
    ],
    sec1P: "鼠标与触控屏幕操作逻辑一致。拖拽越长发射力度越大。但最大力度并非总是最佳选择，可能导致自身棋子滑向边缘甚至出界，给对手留下反击机会。",
    sec2Title: "胜利条件与出界",
    sec2P1: "标准对局的目标是将敌方国王击落棋盘。在守护己方国王的同时瓦解敌方防线。残局解谜与闯关模式有专门的目标设定，请以开局提示为准。",
    sec2P2: "位于棋盘边缘的敌方棋子极易被击落；反之若己方棋子贴边，必须在出手前充分考虑撞击反弹与滑行路径。",
    sec3Title: "棋子特性分析",
    sec3P1: "兵、马、象、车、后、王具有各异的几何外形与物理属性（重量与惯性）。战略模式下可在布阵界面详细查看各项数值并自由搭配阵容。",
    sec3P2: "兵的升变与国王特殊技能可在进阶教程中体验。目前在线对战中暂未开放尚未完全同步的特殊技能。",
    sec4Title: "经典模式与战略模式",
    sec4P: "在线匹配前可选择经典模式或战略模式。在经典模式中打牢对战手感，在战略模式中打造个性化棋组。两种模式的战绩与积分独立核算。",
    sec5Title: "进阶练习建议",
    sec5Items: [
      "保持相同发射角度，仅调节力度观察棋子滑行距离。",
      "对比正面撞击与切角擦边后两枚棋子的分散走势。",
      "在贪刀连击前，优先确保己方国王处于安全掩体之后。",
      "解谜失败时，每次仅微调方向或力度中的一项以便对比复盘。",
    ],
  },
  de: {
    title: "Steuerung & Spielregeln | ChessAlkkagi",
    description: "Steuerung und Spielregeln von ChessAlkkagi. Lerne Schusstechniken, Kollisionsphysik und Strategien.",
    h1: "Steuerung & Spielregeln",
    lead: "Übe zunächst mit sanften frontalen Schüssen. Sobald du Ziellinie und Auslaufpositionen verinnerlicht hast, kannst du diagonale Angriffe sicher ansetzen.",
    sec1Title: "Einen Schuss ausführen",
    sec1Steps: [
      "Klicke oder tippe im eigenen Zug auf die gewünschte Figur.",
      "Ziehe in die entgegengesetzte Richtung des Schusses. Achte auf Ziellinie und Kraftanzeige.",
      "Lass los, sobald Richtung und Stärke stimmen, um zu schießen.",
      "Beobachte die Bewegungen und den Endzustand vor dem nächsten Zug.",
    ],
    sec1P: "Maus und Touchscreen funktionieren nach demselben Prinzip. Weiteres Zurückziehen erhöht die Kraft. Maximale Kraft ist nicht immer die beste Wahl, da die eigene Figur an den Rand geraten oder verwundbar werden kann.",
    sec2Title: "Sieg und Spielfeldrand",
    sec2P1: "Im Standardspiel gewinnst du, indem du den gegnerischen König vom Brett stößt. Schütze deinen eigenen König und durchbrich die feindliche Verteidigung. In Rätseln gelten spezielle Vorgaben.",
    sec2P2: "Gegner am Brettrand lassen sich mit wenig Kraft ins Aus befördern. Steht deine eigene Figur am Rand, musst du Rückstoß und Freiraum genau kalkulieren.",
    sec3Title: "Figurenauswahl und Physik",
    sec3P1: "Bauer, Springer, Läufer, Turm, Dame und König besitzen unterschiedliche Formen und Masseeigenschaften. Im Strategiemodus kannst du Figurenwerte vorab prüfen und dein Team zusammenstellen.",
    sec3P2: "Bauernumwandlung und Königs-Sonderzüge können im fortgeschrittenen Tutorial geübt werden. Im Online-Modus sind noch nicht synchronisierte Spezialzüge vorübergehend deaktiviert.",
    sec4Title: "Klassik und Strategie",
    sec4P: "Wähle im Online-Menü zwischen Klassik und Strategie. Klassik schult das Grundgefühl, während Strategie tiefere taktische Aufstellungen ermöglicht. Statistiken werden getrennt gezählt.",
    sec5Title: "Empfohlene Übungsschritte",
    sec5Items: [
      "Gleiche Richtung beibehalten und nur die Schussstärke variieren.",
      "Frontal- und Streifschüsse vergleichen.",
      "Vor riskanten Angriffen immer die Deckung des eigenen Königs prüfen.",
      "Bei Rätseln jeweils nur einen Parameter (Winkel oder Kraft) nachjustieren.",
    ],
  },
  fr: {
    title: "Commandes & Règles du jeu | ChessAlkkagi",
    description: "Commandes et règles du jeu ChessAlkkagi. Maîtrisez la trajectoire, les collisions et la stratégie.",
    h1: "Commandes & Règles du jeu",
    lead: "Commencez par vous entraîner avec des tirs frontaux modérés. Une fois la trajectoire et le placement d'arrêt maîtrisés, tentez des frappes diagonales.",
    sec1Title: "Déroulement d'un tir",
    sec1Steps: [
      "Touchez ou cliquez sur la pièce à jouer pendant votre tour.",
      "Faites glisser dans la direction opposée au tir voulu en observant la ligne de visée et la jauge.",
      "Relâchez pour déclencher le tir dès que la puissance et l'angle conviennent.",
      "Observez l'arrêt des pièces avant d'engager le tour suivant.",
    ],
    sec1P: "La souris et l'écran tactile répondent au même principe. Plus le recul est grand, plus le tir est puissant. La puissance maximale n'est pas toujours optimale car votre pièce peut glisser vers le bord et devenir vulnérable.",
    sec2Title: "Victoire et Sortie de plateau",
    sec2P1: "Le but principal est d'éjecter le Roi adverse hors de l'échiquier tout en protégeant le vôtre. Les casse-têtes et étapes imposent des configurations et objectifs particuliers.",
    sec2P2: "Un adversaire près du bord peut être expulsé avec un léger impact. En revanche, si votre pièce est en bordure, anticipez le recul après impact.",
    sec3Title: "Comprendre les pièces",
    sec3P1: "Pions, Cavaliers, Fous, Tours, Dames et Rois présentent des formes et des poids différents. En mode Stratégie, consultez les fiches de statistiques pour composer votre formation.",
    sec3P2: "La promotion de pion et les actions spéciales du Roi s'exercent dans le tutoriel avancé. Certaines actions non synchronisées sont restreintes en multijoueur en ligne.",
    sec4Title: "Classique vs Stratégie",
    sec4P: "Sélectionnez Classique ou Stratégie dans le salon en ligne. Le mode Classique forge vos réflexes fondamentaux, tandis que le mode Stratégie permet de personnaliser vos pièces. Les classements sont distincts.",
    sec5Title: "Conseils d'entraînement",
    sec5Items: [
      "Garder le même angle et faire varier uniquement la force pour jauger la distance.",
      "Comparer les positions après un tir direct contre une frappe en biais.",
      "Toujours vérifier la sécurité de son Roi avant d'attaquer.",
      "En cas d'échec d'un puzzle, n'ajuster qu'un paramètre à la fois.",
    ],
  },
  es: {
    title: "Controles y Reglas del Juego | ChessAlkkagi",
    description: "Controles y reglas de ChessAlkkagi. Aprende física de lanzamiento, colisiones y estrategias.",
    h1: "Controles y Reglas del Juego",
    lead: "Comienza practicando impactos frontales suaves. Una vez comprendida la línea de tiro y la posición de reposo, podrás intentar ataques diagonales con total precisión.",
    sec1Title: "Cómo Realizar un Disparo",
    sec1Steps: [
      "Toca o haz clic sobre la pieza que deseas mover en tu turno.",
      "Arrastra en sentido contrario a la dirección de tiro deseada, vigilando la trayectoria y la fuerza.",
      "Suelta el dedo o ratón para disparar una vez fijados el ángulo y la potencia.",
      "Observa el desenlace del movimiento antes de iniciar el próximo turno.",
    ],
    sec1P: "El funcionamiento es idéntico en ratón y pantalla táctil. Cuanto más atrás arrastres, más potente será el lanzamiento. La fuerza máxima no siempre conviene, pues tu pieza puede quedar desprotegida o caer al vacío.",
    sec2Title: "Victoria y Caída del Tablero",
    sec2P1: "En los duelos estándar, el objetivo es arrojar al Rey rival fuera del tablero mientras resguardas al tuyo. Los rompecabezas y fases cuentan con objetivos específicos.",
    sec2P2: "Un enemigo cerca del borde requiere poco empuje para salir. Si tu propia pieza está al borde, calcula el rebote y el espacio libre tras el choque.",
    sec3Title: "Características de las Piezas",
    sec3P1: "Peones, Caballos, Alfiles, Torres, Damas y Reyes tienen formas y pesos singulares. En el modo Estrategia, revisa los atributos antes de definir tu alineación.",
    sec3P2: "La coronación de peones y maniobras de Rey se practican en el tutorial avanzado. Ciertas habilidades no sincronizadas están deshabilitadas temporalmente en el juego en línea.",
    sec4Title: "Clásico y Estrategia",
    sec4P: "Selecciona Clásico o Estrategia en la sala online. Clásico afianza la base técnica, mientras que Estrategia permite adaptar la composición a tu estilo. Los registros se guardan por separado.",
    sec5Title: "Plan de Práctica Recomendado",
    sec5Items: [
      "Mantén la misma dirección y varía solo la potencia para medir distancias.",
      "Compara el rebote en choques frontales frente a impactos oblicuos.",
      "Verifica la defensa de tu Rey antes de lanzarte al ataque.",
      "Si fallas un rompecabezas, ajusta solo la fuerza o el ángulo para aislar el error.",
    ],
  },
  ru: {
    title: "Управление и правила игры | ChessAlkkagi",
    description: "Руководство по управлению и правилам игры ChessAlkkagi. Освойте физику ударов, столкновений и тактику.",
    h1: "Управление и правила игры",
    lead: "Начните с мягких прямых ударов. Когда вы освоите траекторию прицеливания и остановочные позиции, вы сможете уверенно наносить диагональные удары.",
    sec1Title: "Выполнение удара",
    sec1Steps: [
      "В свой ход нажмите на фигуру, которой хотите совершить выстрел.",
      "Оттяните назад в направлении, противоположном желаемому удару, ориентируясь на прицел и шкалу силы.",
      "Отпустите палец или кнопку мыши для выстрела.",
      "Дождитесь полной остановки фигур перед следующим ходом.",
    ],
    sec1P: "Управление одинаково на мыши и сенсорных экранах. Чем сильнее оттяжка, тем мощнее запуск. Максимальная сила не всегда выгодна, так как фигура может вылететь за край или стать легкой добычей.",
    sec2Title: "Победа и вылет с доски",
    sec2P1: "Главная цель — сбить вражеского Короля за пределы доски и защитить своего. В головоломках и этапах действуют индивидуальные цели.",
    sec2P2: "Фигуру противника у края можно выбить даже слабым толчком. Если у края ваша фигура — обязательно учитывайте отдачу после столкновения.",
    sec3Title: "Особенности шахматных фигур",
    sec3P1: "Пешка, Конь, Слон, Ладья, Ферзь и Король отличаются формой, массой и физикой. В стратегическом режиме проверяйте карточки параметров перед боем.",
    sec3P2: "Превращение пешки и особые действия Короля можно опробовать в расширенном обучении. В онлайн-матчах временно действуют ограничения на несинхронизированные навыки.",
    sec4Title: "Классика и Стратегия",
    sec4P: "Выбирайте классический или стратегический режим в лобби. Классика тренирует базовые навыки, а стратегия позволяет настраивать набор фигур. Рейтинги считаются раздельно.",
    sec5Title: "Советы для тренировки",
    sec5Items: [
      "Запускайте в одном направлении, меняя только силу, чтобы оценить дистанцию.",
      "Сравнивайте результаты прямых и касательных ударов.",
      "Перед сложной атакой убедитесь в безопасности своего Короля.",
      "В головоломках меняйте по очереди либо угол, либо силу.",
    ],
  },
  "pt-BR": {
    title: "Controles e Regras do Jogo | ChessAlkkagi",
    description: "Controles e regras do jogo ChessAlkkagi. Aprenda mira, física de colisão e táticas de partida.",
    h1: "Controles e Regras do Jogo",
    lead: "Comece praticando toques frontais suaves. Assim que dominar a linha de mira e a posição de parada, poderá arriscar jogadas diagonais com segurança.",
    sec1Title: "Como Executar um Disparo",
    sec1Steps: [
      "Toque ou clique na peça que deseja controlar na sua vez.",
      "Arraste na direção oposta ao disparo desejado, conferindo a mira e o medidor de força.",
      "Solte para disparar assim que definir o ângulo e a potência.",
      "Acompanhe o movimento das peças antes de prosseguir para o próximo turno.",
    ],
    sec1P: "O controle funciona igualmente com mouse e toque na tela. Puxar mais para trás resulta em maior força. Força máxima nem sempre é a melhor escolha, pois sua peça pode escorregar para fora ou ficar desprotegida.",
    sec2Title: "Vitória e Queda do Tabuleiro",
    sec2P1: "Em partidas normais, seu objetivo é derrubar o Rei adversário para fora do tabuleiro. Proteja o seu Rei enquanto quebra as defesas inimigas. Nos quebra-cabeças, siga as metas indicadas na tela.",
    sec2P2: "Peças adversárias perto da borda caem com pouco impacto. Se for a sua peça na borda, calcule bem o recuo e o espaço livre após a colisão.",
    sec3Title: "Características das Peças",
    sec3P1: "Peão, Cavalo, Bispo, Torre, Dama e Rei possuem formatos e massas distintas. No modo Estratégia, confira os atributos antes de montar seu time.",
    sec3P2: "Promoção de peão e ações especiais do Rei estão disponíveis no tutorial avançado. No modo online, recursos ainda não sincronizados ficam temporariamente restritos.",
    sec4Title: "Clássico e Estratégia",
    sec4P: "Escolha Clássico ou Estratégia na tela online. O modo Clássico aprimora os fundamentos e o modo Estratégia permite personalizar a formação. Os ranques são separados.",
    sec5Title: "Sequência de Treino Recomendada",
    sec5Items: [
      "Mantenha a direção e altere apenas a força para comparar o deslocamento.",
      "Compare a posição final em impactos frontais e colisões raspadas.",
      "Confira a segurança do seu Rei antes de arriscar ataques múltiplos.",
      "Ao errar um quebra-cabeça, ajuste apenas a força ou o ângulo para isolar a correção.",
    ],
  },
};

export const TIERS_TRANSLATIONS: Record<LanguageCode, TiersPageText> = {
  ko: {
    title: "티어와 랭킹 안내 | 체스알까기",
    description: "체스알까기의 티어와 랭킹 안내. 실제 게임의 플레이 방식과 이용 안내를 확인하세요.",
    h1: "티어와 랭킹 안내",
    lead: "온라인 실력은 폰부터 킹까지의 티어로 표시됩니다. 클래식과 전략 모드의 티어는 각각의 서버 레이팅을 기준으로 정해집니다.",
    sec1Title: "승급 순서",
    sec1P1: "폰 5부터 1, 나이트 5부터 1, 비숍 5부터 1, 룩 5부터 1을 거쳐 퀸과 킹으로 올라갑니다. 각 말 안에서는 숫자가 작을수록 높은 단계입니다.",
    tableCaption: "현재 레이팅 기준",
    thTier: "티어",
    thRange: "레이팅 구간",
    tiers: [
      { tier: "폰 5~1", range: "1,200~1,449 (1,200 미만도 폰 5)" },
      { tier: "나이트 5~1", range: "1,450~1,699" },
      { tier: "비숍 5~1", range: "1,700~1,949" },
      { tier: "룩 5~1", range: "1,950~2,199" },
      { tier: "퀸", range: "2,200~2,299" },
      { tier: "킹", range: "2,300 이상" },
    ],
    sec1P2: "폰부터 룩까지는 50점마다 한 단계씩 바뀝니다. 예를 들어 1,200점은 폰 5, 1,250점은 폰 4입니다. 퀸은 별도의 5~1 단계가 없습니다.",
    sec2Title: "승급과 강등",
    sec2P1: "대전 결과가 서버에서 정산된 뒤 현재 점수에 맞춰 티어가 바뀝니다. 경계 점수보다 낮아지면 이전 단계로 내려갈 수 있습니다. 모든 승리의 점수 변동이 같다고 가정하지 말고, 대전 정산 결과를 확인하세요.",
    sec2P2: "로컬 연습이나 튜토리얼의 결과를 온라인 티어 점수와 혼동하지 마세요. 온라인 정산에 실패했다는 안내가 나오면 임의의 점수 변화를 확정해서 표시하지 않습니다.",
    sec3Title: "킹 점수와 랭킹",
    sec3P1: "킹 점수는 현재 레이팅에서 2,300을 뺀 값입니다. 2,300점은 킹 0점, 2,450점은 킹 150점으로 표시됩니다. 랭킹에서 모드를 선택하고 전체 또는 킹 목록을 확인할 수 있습니다. 같은 점수에는 같은 순위를 표시합니다.",
    sec3P2: "랭킹을 불러오지 못한 경우에는 오류와 다시 시도하기가 표시됩니다. 이 상태는 순위가 1위라는 뜻도, 등록된 플레이어가 없다는 뜻도 아닙니다.",
  },
  en: {
    title: "Tiers & Ranking Guide | ChessAlkkagi",
    description: "Tiers and ranking breakdown for ChessAlkkagi. Understand MMR rating thresholds, promotions, and King leaderboards.",
    h1: "Tiers & Ranking Guide",
    lead: "Online skill is represented through tiers from Pawn to King. Tiers in Classic and Strategy modes are calculated independently based on server MMR.",
    sec1Title: "Promotion Order",
    sec1P1: "Progress ascends from Pawn 5-1, Knight 5-1, Bishop 5-1, Rook 5-1, up to Queen and King. Within each piece rank, lower numbers represent higher tiers.",
    tableCaption: "Current MMR Thresholds",
    thTier: "Tier",
    thRange: "MMR Range",
    tiers: [
      { tier: "Pawn 5–1", range: "1,200–1,449 (Below 1,200 is also Pawn 5)" },
      { tier: "Knight 5–1", range: "1,450–1,699" },
      { tier: "Bishop 5–1", range: "1,700–1,949" },
      { tier: "Rook 5–1", range: "1,950–2,199" },
      { tier: "Queen", range: "2,200–2,299" },
      { tier: "King", range: "2,300+" },
    ],
    sec1P2: "From Pawn to Rook, tiers change every 50 points. For instance, 1,200 is Pawn 5 and 1,250 is Pawn 4. Queen has no sub-divisions.",
    sec2Title: "Promotions & Demotions",
    sec2P1: "After each online match is settled on the server, your tier updates based on your new MMR. Falling below a threshold leads to demotion. Score deltas vary depending on opponent ratings.",
    sec2P2: "Local games and tutorials do not affect online MMR. If online match settlement fails, no unverified score changes are committed.",
    sec3Title: "King Points & Leaderboard",
    sec3P1: "King Points equal current MMR minus 2,300. For example, 2,300 MMR is King 0 pts, and 2,450 MMR is King 150 pts. Players with identical points share the same rank.",
    sec3P2: "If leaderboard retrieval fails, an error and retry prompt will appear. This does not indicate you are #1 or that the leaderboard is empty.",
  },
  ja: {
    title: "ティアとランキング案内 | チェスおはじき",
    description: "チェスおはじきのティアとランキング基準。レーティング昇格基準とキングランキングの仕組みを解説します。",
    h1: "ティアとランキング案内",
    lead: "オンライン対戦の実力はポーンからキングまでのティアで示されます。クラシックと戦略モードのティアは各サーバーレートに基づき個別に判定されます。",
    sec1Title: "昇格の順序",
    sec1P1: "ポーン5〜1、ナイト5〜1、ビショップ5〜1、ルーク5〜1を経てクイーン、キングへと昇格します。各駒内では数字が小さいほど上位となります。",
    tableCaption: "現在のレーティング基準",
    thTier: "ティア",
    thRange: "レーティング範囲",
    tiers: [
      { tier: "ポーン 5〜1", range: "1,200〜1,449（1,200未満もポーン5）" },
      { tier: "ナイト 5〜1", range: "1,450〜1,699" },
      { tier: "ビショップ 5〜1", range: "1,700〜1,949" },
      { tier: "ルーク 5〜1", range: "1,950〜2,199" },
      { tier: "クイーン", range: "2,200〜2,299" },
      { tier: "キング", range: "2,300以上" },
    ],
    sec1P2: "ポーンからルークまでは50ポイントごとに1段階変動します（例: 1,200点はポーン5、1,250点はポーン4）。クイーンにはサブ段階はありません。",
    sec2Title: "昇格と降格",
    sec2P1: "サーバーでの対戦精算後、最新レートに応じてティアが更新されます。境界を下回ると降格となります。対戦相手のレートによって増減値は異なります。",
    sec2P2: "ローカル対戦やチュートリアルはオンラインレートに影響しません。オンライン精算失敗時は不確定な数値の更新は行われません。",
    sec3Title: "キングスコアとランキング",
    sec3P1: "キングスコアは現在レートから2,300を引いた値です（2,300点＝キング0点、2,450点＝キング150点）。同点の場合は同順位として表示されます。",
    sec3P2: "ランキングの取得に失敗した場合はエラーと再試行ボタンが表示されます。これは1位であることや登録者がいないことを意味するものではありません。",
  },
  "zh-CN": {
    title: "段位与排行榜说明 | 国际象棋弹珠",
    description: "国际象棋弹珠的段位体系与排行榜说明。查看各段位MMR积分要求及国王榜规则。",
    h1: "段位与排行榜说明",
    lead: "玩家的在线对战实力通过从兵到国王的段位展现。经典模式与战略模式的段位根据各自的服务器MMR积分独立评定。",
    sec1Title: "晋级阶梯",
    sec1P1: "段位晋升顺序为：兵5~1、马5~1、象5~1、车5~1、后、国王。各阶内数字越小代表段位越高。",
    tableCaption: "当前MMR分段标准",
    thTier: "段位",
    thRange: "积分区间",
    tiers: [
      { tier: "兵 5~1", range: "1,200~1,449（低于1,200亦为兵5）" },
      { tier: "马 5~1", range: "1,450~1,699" },
      { tier: "象 5~1", range: "1,700~1,949" },
      { tier: "车 5~1", range: "1,950~2,199" },
      { tier: "后", range: "2,200~2,299" },
      { tier: "国王", range: "2,300 及以上" },
    ],
    sec1P2: "从兵到车每50分晋升一个小段位（例如1,200分为兵5，1,250分为兵4）。后段位无细分子段位。",
    sec2Title: "晋级与降级",
    sec2P1: "每局在线对战由服务器结算后实时刷新段位。积分低于临界值时会触发降级。胜负得分根据双方分差动态调整。",
    sec2P2: "单机模式与教程不会改变在线天梯分。若在线结算遇到网络异常，系统不会写入未经确认的本地数据。",
    sec3Title: "国王分与排行榜",
    sec3P1: "国王分即当前积分超出2,300的部分（2,300分即国王0分，2,450分即国王150分）。同分玩家将并列相同名次。",
    sec3P2: "排行榜加载失败时将显示重试提示，并非代表您位居第一或暂无注册玩家。",
  },
  de: {
    title: "Ränge & Ranglisten | ChessAlkkagi",
    description: "Ränge und Ranglisten von ChessAlkkagi. Erfahre alles über MMR-Stufen, Aufstiege und die Königs-Rangliste.",
    h1: "Ränge & Ranglisten",
    lead: "Dein Online-Können wird in Rängen von Bauer bis König dargestellt. Die Ränge in Klassik und Strategie basieren unabhängig auf dem jeweiligen Server-MMR.",
    sec1Title: "Aufstiegsreihenfolge",
    sec1P1: "Der Aufstieg verläuft von Bauer 5–1 über Springer 5–1, Läufer 5–1, Turm 5–1 bis zu Dame und König. Eine kleinere Zahl bedeutet einen höheren Rang.",
    tableCaption: "Aktuelle MMR-Stufen",
    thTier: "Rang",
    thRange: "MMR-Bereich",
    tiers: [
      { tier: "Bauer 5–1", range: "1.200–1.449 (unter 1.200 ebenfalls Bauer 5)" },
      { tier: "Springer 5–1", range: "1.450–1.699" },
      { tier: "Läufer 5–1", range: "1.700–1.949" },
      { tier: "Turm 5–1", range: "1.950–2.199" },
      { tier: "Dame", range: "2.200–2.299" },
      { tier: "König", range: "ab 2.300" },
    ],
    sec1P2: "Von Bauer bis Turm ändert sich der Rang alle 50 Punkte (z. B. 1.200 = Bauer 5, 1.250 = Bauer 4). Die Dame besitzt keine Unterstufen.",
    sec2Title: "Auf- und Abstieg",
    sec2P1: "Nach jedem Online-Match wird dein Rang anhand des neuen Server-MMR aktualisiert. Fällt dein Wert unter die Grenze, steigst du ab.",
    sec2P2: "Lokale Partien und Tutorials beeinflussen das Online-Rating nicht. Bei Abrechnungsfehlern werden keine unbestätigten Daten gespeichert.",
    sec3Title: "Königspunkte & Rangliste",
    sec3P1: "Königspunkte entsprechen dem aktuellen MMR minus 2.300 (z. B. 2.300 = König 0 Pkt., 2.450 = König 150 Pkt.). Bei gleicher Punktzahl teilen sich Spieler den Rang.",
    sec3P2: "Falls die Rangliste nicht geladen werden kann, erscheint ein Fehler mit Wiederholen-Button.",
  },
  fr: {
    title: "Rangs & Classement | ChessAlkkagi",
    description: "Guide des rangs et du classement dans ChessAlkkagi. Découvrez les paliers de points MMR, les promotions et le classement Roi.",
    h1: "Rangs & Classement",
    lead: "Votre niveau en ligne est représenté par des rangs allant du Pion au Roi. Les rangs des modes Classique et Stratégie sont calculés indépendamment sur le serveur.",
    sec1Title: "Ordre de progression",
    sec1P1: "La progression monte de Pion 5–1, Cavalier 5–1, Fou 5–1, Tour 5–1, jusqu'à Dame et Roi. Plus le chiffre est petit, plus le rang est élevé.",
    tableCaption: "Paliers de MMR actuels",
    thTier: "Rang",
    thRange: "Plage de MMR",
    tiers: [
      { tier: "Pion 5–1", range: "1 200–1 449 (en dessous de 1 200 = Pion 5)" },
      { tier: "Cavalier 5–1", range: "1 450–1 699" },
      { tier: "Fou 5–1", range: "1 700–1 949" },
      { tier: "Tour 5–1", range: "1 950–2 199" },
      { tier: "Dame", range: "2 200–2 299" },
      { tier: "Roi", range: "2 300 et plus" },
    ],
    sec1P2: "Du Pion à la Tour, chaque sous-rang évolue par tranche de 50 points (ex: 1 200 = Pion 5, 1 250 = Pion 4). La Dame ne possède pas de sous-paliers.",
    sec2Title: "Promotions et Relégations",
    sec2P1: "Votre rang s'actualise après chaque validation de match sur le serveur. Passer sous le seuil entraîne une relégation.",
    sec2P2: "Les parties locales et didacticiels n'affectent pas votre cote en ligne. En cas d'échec de synchronisation, aucun changement non validé n'est appliqué.",
    sec3Title: "Points de Roi et Classement",
    sec3P1: "Les points de Roi équivalent au MMR moins 2 300 (ex: 2 300 = Roi 0 pt, 2 450 = Roi 150 pts). Les joueurs à égalité partagent la même place.",
    sec3P2: "Si le classement ne se charge pas, une option Réessayer apparaît. Cela ne signifie pas que vous êtes 1er ou qu'il n'y a aucun joueur.",
  },
  es: {
    title: "Rangos y Clasificación | ChessAlkkagi",
    description: "Guía de rangos y clasificación de ChessAlkkagi. Conoce los intervalos de MMR, ascensos y la tabla de Reyes.",
    h1: "Rangos y Clasificación",
    lead: "Tu nivel online se muestra mediante rangos desde Peón hasta Rey. Los rangos de Clásico y Estrategia se calculan de manera independiente en el servidor.",
    sec1Title: "Escalafón de Ascenso",
    sec1P1: "El progreso va de Peón 5–1, Caballo 5–1, Alfil 5–1, Torre 5–1, hasta Dama y Rey. Cuanto menor sea el número, mayor es el nivel.",
    tableCaption: "Intervalos de MMR Actuales",
    thTier: "Rango",
    thRange: "Intervalo de Puntos",
    tiers: [
      { tier: "Peón 5–1", range: "1.200–1.449 (menos de 1.200 también es Peón 5)" },
      { tier: "Caballo 5–1", range: "1.450–1.699" },
      { tier: "Alfil 5–1", range: "1.700–1.949" },
      { tier: "Torre 5–1", range: "1.950–2.199" },
      { tier: "Dama", range: "2.200–2.299" },
      { tier: "Rey", range: "2.300 o más" },
    ],
    sec1P2: "De Peón a Torre, el rango avanza cada 50 puntos (ej. 1.200 es Peón 5, 1.250 es Peón 4). Dama no tiene subdivisiones.",
    sec2Title: "Ascensos y Descensos",
    sec2P1: "El rango se actualiza tras la liquidación del resultado en el servidor. Si caes por debajo del umbral, descenderás de categoría.",
    sec2P2: "Las partidas locales o tutoriales no alteran el MMR online. Si falla la liquidación, no se aplican variaciones no confirmadas.",
    sec3Title: "Puntos de Rey y Clasificación",
    sec3P1: "Los puntos de Rey equivalen al MMR menos 2.300 (2.300 = Rey 0 pts, 2.450 = Rey 150 pts). Empates en puntos comparten la misma posición.",
    sec3P2: "Si no se carga la clasificación, se mostrará un aviso de error y reintentar.",
  },
  ru: {
    title: "Ранги и таблица лидеров | ChessAlkkagi",
    description: "Руководство по рангам и рейтингу в ChessAlkkagi. Узнайте границы MMR, условия повышения и систему очков Короля.",
    h1: "Ранги и таблица лидеров",
    lead: "Уровень мастерства в онлайн-играх отображается рангами от Пешки до Короля. В классическом и стратегическом режимах ранги рассчитываются независимо.",
    sec1Title: "Порядок повышения",
    sec1P1: "Путь идет от Пешки 5–1, Коня 5–1, Слона 5–1, Ладьи 5–1 к Ферзю и Королю. Чем меньше цифра внутри ранга, тем он выше.",
    tableCaption: "Текущие пороги MMR",
    thTier: "Ранг",
    thRange: "Диапазон рейтинга",
    tiers: [
      { tier: "Пешка 5–1", range: "1200–1449 (ниже 1200 — также Пешка 5)" },
      { tier: "Конь 5–1", range: "1450–1699" },
      { tier: "Слон 5–1", range: "1700–1949" },
      { tier: "Ладья 5–1", range: "1950–2199" },
      { tier: "Ферзь", range: "2200–2299" },
      { tier: "Король", range: "2300 и выше" },
    ],
    sec1P2: "От Пешки до Ладьи ранг меняется каждые 50 очков (например, 1200 — Пешка 5, 1250 — Пешка 4). У Ферзя нет подрангов.",
    sec2Title: "Повышение и понижение",
    sec2P1: "Ранг обновляется сервером по итогам каждого матча. При падении ниже границы вы переходите на ранг ниже.",
    sec2P2: "Локальные игры и обучение не меняют сетевой MMR. При сбое сетевого расчета непроверенные изменения не фиксируются.",
    sec3Title: "Очки Короля и таблица лидеров",
    sec3P1: "Очки Короля равны текущему MMR минус 2300 (2300 = Король 0 очков, 2450 = Король 150 очков). При равенстве очков присваивается одинаковое место.",
    sec3P2: "Если рейтинг не удалось загрузить, появится сообщение об ошибке с кнопкой повтора.",
  },
  "pt-BR": {
    title: "Ranques e Classificação | ChessAlkkagi",
    description: "Guia de ranques e classificação do ChessAlkkagi. Conheça as faixas de MMR, promoções e o ranking de Reis.",
    h1: "Ranques e Classificação",
    lead: "Seu nível online é representado por ranques de Peão a Rei. Os ranques nos modos Clássico e Estratégia são calculados separadamente com base no MMR do servidor.",
    sec1Title: "Ordem de Promoção",
    sec1P1: "A progressão vai de Peão 5–1, Cavalo 5–1, Bispo 5–1, Torre 5–1 até Dama e Rei. Dentro de cada peça, números menores indicam escalões mais altos.",
    tableCaption: "Faixas de MMR Atuais",
    thTier: "Ranque",
    thRange: "Faixa de MMR",
    tiers: [
      { tier: "Peão 5–1", range: "1.200–1.449 (abaixo de 1.200 também é Peão 5)" },
      { tier: "Cavalo 5–1", range: "1.450–1.699" },
      { tier: "Bispo 5–1", range: "1.700–1.949" },
      { tier: "Torre 5–1", range: "1.950–2.199" },
      { tier: "Dama", range: "2.200–2.299" },
      { tier: "Rei", range: "2.300 ou mais" },
    ],
    sec1P2: "De Peão a Torre, o ranque sobe a cada 50 pontos (ex.: 1.200 é Peão 5, 1.250 é Peão 4). A Dama não possui subdivisões.",
    sec2Title: "Promoções e Rebaixamentos",
    sec2P1: "Após o término da partida ser liquidado no servidor, seu ranque é ajustado ao novo MMR. Ficar abaixo do limite causa rebaixamento.",
    sec2P2: "Partidas locais e tutoriais não alteram o MMR online. Se houver falha de liquidação, alterações não confirmadas não são aplicadas.",
    sec3Title: "Pontos de Rei e Tabela de Líderes",
    sec3P1: "Pontos de Rei equivalem ao MMR menos 2.300 (2.300 = Rei 0 pts, 2.450 = Rei 150 pts). Pontuações iguais compartilham a mesma colocação.",
    sec3P2: "Caso a tabela não possa ser carregada, será exibida uma mensagem de erro com opção de tentar novamente.",
  },
};

export const UPDATES_TRANSLATIONS: Record<LanguageCode, UpdatesPageText> = {
  ko: {
    title: "업데이트 기록 | 체스알까기",
    description: "체스알까기의 업데이트 기록. 실제 게임의 플레이 방식과 이용 안내를 확인하세요.",
    h1: "업데이트 기록",
    lead: "현재 공개 버전에 반영된 주요 변경을 기록합니다. 규칙과 화면이 바뀌면 해당 안내도 함께 갱신합니다.",
    entries: [
      {
        dateTitle: "2026년 9월 15일 — 계정 진행도와 자유 매칭",
        items: [
          "로그인 계정별로 스테이지, 연구 포인트·기물 연구, 튜토리얼과 퍼즐 기록을 저장합니다.",
          "로그인 시 계정 기록을 자동으로 불러오고 플레이 중 변경사항을 자동 저장합니다.",
          "온라인 매칭의 코인 소모와 충전소, 코인 보상 광고를 제거했습니다.",
        ],
      },
      {
        dateTitle: "2026년 9월 15일 — 광고 구조와 웹 안내",
        items: [
          "Android의 AdMob과 웹의 AdSense 요청 경로를 분리했습니다.",
          "일반 배너에 타이머를 붙여 보상을 지급하던 웹 동작을 제거했습니다.",
          "웹 광고를 기본 비활성화하고, 공식 보상형 광고가 완료된 경우에만 보상을 지급하도록 준비했습니다.",
          "게임 소개·규칙·티어 안내와 문의 경로를 추가했습니다.",
        ],
        paragraphs: ["현재 온라인 매칭은 코인을 사용하지 않습니다."],
      },
      {
        dateTitle: "2026년 9월 15일 — 티어·랭킹과 퍼즐",
        items: [
          "숫자 레이팅을 폰·나이트·비숍·룩·퀸·킹 티어로 표시합니다.",
          "클래식·전략별 랭킹과 킹 목록을 구분하고, 조회 실패 시 다시 시도할 수 있도록 했습니다.",
          "메뉴의 중복된 장식과 작은 화면의 가로 넘침을 줄였습니다.",
          "메뉴에 퍼즐 도전과 퍼즐 선택·재시도 흐름을 통합했습니다.",
        ],
      },
      {
        dateTitle: "2026년 9월 14일 — 온라인 정산과 계정 처리",
        items: [
          "온라인 경기 결과를 서버에서 검증하고 중복 정산을 막는 흐름을 적용했습니다.",
          "계정 전환 시 이전 사용자의 정보가 섞이지 않도록 보완했습니다.",
          "닉네임을 화면에 표시할 때 HTML로 해석되지 않도록 처리했습니다.",
          "온라인 동기화가 준비되지 않은 승급과 킹 특수 행동을 제한했습니다.",
        ],
      },
    ],
    helpTitle: "문제를 발견했나요?",
    helpP: "<a href=\"./about.html#contact\">문의 안내</a>를 참고해 발생 조건을 알려 주세요. 조작이 익숙하지 않다면 <a href=\"./guide.html\">조작법과 규칙</a>을 먼저 확인할 수 있습니다.",
  },
  en: {
    title: "Update History | ChessAlkkagi",
    description: "Changelog and update history for ChessAlkkagi. Track new features, system updates, and balance improvements.",
    h1: "Update History",
    lead: "Chronological records of major updates applied to the live build. Documentation is kept up-to-date with any changes to mechanics or interface.",
    entries: [
      {
        dateTitle: "September 15, 2026 — Account Progress & Open Matchmaking",
        items: [
          "Saved Stages, Research Points & Piece Upgrades, Tutorial completions, and Puzzle records per logged-in account.",
          "Auto-loading of account progress upon login and automatic syncing during gameplay.",
          "Removed coin costs, coin shop, and coin-reward ads from online multiplayer matchmaking.",
        ],
      },
      {
        dateTitle: "September 15, 2026 — Ad Architecture & Web Site Guides",
        items: [
          "Separated ad request paths between Android (AdMob) and Web (AdSense).",
          "Removed web timer-based reward grants on standard banners.",
          "Defaulted web ads to inactive, preparing official rewarded ads verification.",
          "Added game overview, rules guide, tier documentation, and support contacts.",
        ],
        paragraphs: ["Online multiplayer no longer requires coins."],
      },
      {
        dateTitle: "September 15, 2026 — Tiers, Leaderboards & Puzzles",
        items: [
          "Replaced numeric ratings with Pawn, Knight, Bishop, Rook, Queen, and King tiers.",
          "Separated Classic and Strategy rankings with King lists and added retry handling for failed queries.",
          "Refined menu styling to eliminate horizontal overflow on small screens.",
          "Integrated puzzle challenges, selection, and retry flows into the main menu.",
        ],
      },
      {
        dateTitle: "September 14, 2026 — Online Settlement & Account Security",
        items: [
          "Added server-side match result validation and duplicate settlement prevention.",
          "Secured account switching to prevent residual session data overlap.",
          "Escaped player nicknames in UI to prevent HTML injection.",
          "Restricted un-synchronized promotions and special King actions in online play.",
        ],
      },
    ],
    helpTitle: "Found an issue?",
    helpP: "Please see our <a href=\"./about.html#contact\">Contact Guide</a> to report reproduction steps. If you are new to the game, review the <a href=\"./guide.html\">Controls & Rules</a>.",
  },
  ja: {
    title: "アップデート履歴 | チェスおはじき",
    description: "チェスおはじきの更新履歴。新機能、システム改善、バランス調整の記録をご確認ください。",
    h1: "アップデート履歴",
    lead: "公開バージョンに適用された主な変更履歴です。ルールや画面仕様の変更に合わせて随時更新されます。",
    entries: [
      {
        dateTitle: "2026年9月15日 — アカウント進行度と無料マッチング",
        items: [
          "ログインアカウントごとにステージ、研究ポイント・駒研究、チュートリアル・パズル記録を保存。",
          "ログイン時の自動読み込みとプレイ中の自動保存に対応。",
          "オンラインマッチングにおけるコイン消費、コイン補充所、コイン報酬広告を撤廃。",
        ],
      },
      {
        dateTitle: "2026年9月15日 — 広告構造とWeb案内ページ",
        items: [
          "Android（AdMob）とWeb（AdSense）の広告リクエスト経路を分離。",
          "一般バナーへのタイマー報酬付与ロジックを削除。",
          "Web広告を初期状態で無効化し、正規リワード完了時のみ報酬が付与されるよう整備。",
          "ゲーム紹介・ルール・ティア案内とお問い合わせページを開設。",
        ],
        paragraphs: ["現在のオンライン対戦はコインを使用しません。"],
      },
      {
        dateTitle: "2026年9月15日 — ティア・ランキングとパズル",
        items: [
          "数値レートをポーン・ナイト・ビショップ・ルーク・クイーン・キングのティア表示に変更。",
          "クラシック／戦略別のランキングおよびキングリストを分離し、取得失敗時の再試行に対応。",
          "メニュー装飾の整理と小型画面での横スクロール崩れを解消。",
          "メニュー画面にパズル挑戦・選択・再試行フローを統合。",
        ],
      },
      {
        dateTitle: "2026年9月14日 — オンライン精算とアカウント処理",
        items: [
          "サーバー側での対戦結果検証と重複精算防止フローを適用。",
          "アカウント切り替え時の前ユーザーデータ混入を防止。",
          "プレイヤー名のHTMLエスケープ処理を適用。",
          "オンライン同期未対応のプロモーションおよびキング特殊行動を制限。",
        ],
      },
    ],
    helpTitle: "問題が見つかりましたか？",
    helpP: "<a href=\"./about.html#contact\">お問い合わせ案内</a>を参考に発生状況をお知らせください。操作方法が分からない場合は<a href=\"./guide.html\">操作法とルール</a>をご覧ください。",
  },
  "zh-CN": {
    title: "更新日志 | 国际象棋弹珠",
    description: "国际象棋弹珠的版本更新历史。查看新功能、系统优化及平衡性调整。",
    h1: "更新日志",
    lead: "记录当前正式公开版本的各项主要变更。规则与界面调整时将同步更新相关说明。",
    entries: [
      {
        dateTitle: "2026年9月15日 — 账号进度与自由匹配",
        items: [
          "支持按登录账号云端保存关卡进度、研究点数、棋子强化、教程与谜题通关记录。",
          "登录时自动加载云端存档，游戏过程中自动同步进度。",
          "全面移除在线对战的金币消耗、金币商店及金币奖励广告。",
        ],
      },
      {
        dateTitle: "2026年9月15日 — 广告架构重构与网页指南",
        items: [
          "分离安卓端（AdMob）与网页端（AdSense）广告请求链路。",
          "移除原网页端普通横幅广告的倒计时奖励机制。",
          "网页端广告默认禁用，仅在官方激励视频正常播放完毕后发放奖励。",
          "新增游戏介绍、玩法规则、段位说明与客服反馈通道。",
        ],
        paragraphs: ["当前在线对战完全免费，无需消耗金币。"],
      },
      {
        dateTitle: "2026年9月15日 — 段位排行榜与解谜集成",
        items: [
          "将纯数字MMR改为兵、马、象、车、后、国王段位勋章展示。",
          "独立区分经典与战略排行榜及国王专属榜单，增加加载失败重试机制。",
          "精简主菜单视觉层级，修复小屏设备上的横向溢出问题。",
          "在主界面深度集成残局挑战、选关与快速重试流程。",
        ],
      },
      {
        dateTitle: "2026年9月14日 — 在线结算与账号安全",
        items: [
          "引入服务器端在线对战结果验签机制，防止重复结算。",
          "优化账号登出切换逻辑，杜绝上一用户缓存残留冲突。",
          "对玩家昵称渲染进行HTML转义，防范注入风险。",
          "在线对战中限制未完成网络同步的兵升变与国王特技。",
        ],
      },
    ],
    helpTitle: "遇到问题了？",
    helpP: "请参考<a href=\"./about.html#contact\">联系咨询</a>向我们提供问题重现步骤。如需熟悉操作，请查看<a href=\"./guide.html\">操作与规则</a>。",
  },
  de: {
    title: "Update-Verlauf | ChessAlkkagi",
    description: "Änderungsprotokoll und Update-Verlauf von ChessAlkkagi. Alle Neuerungen, Anpassungen und Fehlerbehebungen im Überblick.",
    h1: "Update-Verlauf",
    lead: "Chronologische Übersicht über wesentliche Änderungen in der aktuellen Version. Die Anleitungen werden bei Regeländerungen stets aktualisiert.",
    entries: [
      {
        dateTitle: "15. September 2026 — Kontofortschritt & Freies Matchmaking",
        items: [
          "Fortschritt für Level, Forschungspunkte, Figuren-Upgrades, Tutorials und Rätsel wird pro Konto gespeichert.",
          "Automatisches Laden bei der Anmeldung und kontinuierliche Synchronisation während des Spielens.",
          "Münzkosten, Aufladestationen und Werbe-Münzbelohnungen für Online-Spiele wurden entfernt.",
        ],
      },
      {
        dateTitle: "15. September 2026 — Werbearchitektur & Web-Seiten",
        items: [
          "Trennung der Werbepfade zwischen Android (AdMob) und Web (AdSense).",
          "Timer-basierte Belohnungen auf Standard-Bannern im Web wurden entfernt.",
          "Web-Werbung ist standardmäßig deaktiviert; Belohnungen nur nach vollem Video-Abschluss.",
          "Informationsseiten zu Spiel, Regeln, Rängen und Support hinzugefügt.",
        ],
        paragraphs: ["Online-Partien erfordern ab sofort keine Münzen mehr."],
      },
      {
        dateTitle: "15. September 2026 — Ränge, Ranglisten & Rätsel",
        items: [
          "Ersetzung numerischer Ratings durch Ränge von Bauer bis König.",
          "Trennung der Ranglisten nach Klassik und Strategie inklusive Königsliste und Wiederholungsfunktion.",
          "Menübereinigung zur Vermeidung von horizontalem Überlauf auf Mobilgeräten.",
          "Integration von Rätselauswahl und Neustart ins Hauptmenü.",
        ],
      },
      {
        dateTitle: "14. September 2026 — Online-Abrechnung & Kontosicherheit",
        items: [
          "Serverseitige Match-Validierung zur Vermeidung von Mehrfachabrechnungen.",
          "Sichere Kontoumstellung ohne Datenübertrag vom vorherigen Nutzer.",
          "HTML-Escaping für Spielernamen in der Benutzeroberfläche.",
          "Einschränkung nicht synchronisierter Bauern-Umwandlungen und Königs-Sonderzüge im Online-Modus.",
        ],
      },
    ],
    helpTitle: "Ein Problem gefunden?",
    helpP: "Nutze unsere <a href=\"./about.html#contact\">Kontaktseite</a> für Fehlerbeschreibungen. Die Spielgrundlagen findest du unter <a href=\"./guide.html\">Steuerung & Regeln</a>.",
  },
  fr: {
    title: "Historique des mises à jour | ChessAlkkagi",
    description: "Journal des modifications et historique des mises à jour de ChessAlkkagi. Découvrez les nouvelles fonctionnalités et améliorations.",
    h1: "Historique des mises à jour",
    lead: "Récapitulatif des évolutions majeures intégrées à la version publique. Les guides sont mis à jour à chaque modification de règle ou d'interface.",
    entries: [
      {
        dateTitle: "15 septembre 2026 — Progression du compte et matchmaking libre",
        items: [
          "Sauvegarde par compte des étapes, points de recherche, améliorations, didacticiels et casse-têtes.",
          "Chargement automatique à la connexion et synchronisation en cours de jeu.",
          "Suppression du coût en pièces, de la boutique et des pubs récompensées en pièces pour le jeu en ligne.",
        ],
      },
      {
        dateTitle: "15 septembre 2026 — Architecture publicitaire & Guides web",
        items: [
          "Séparation des requêtes publicitaires entre Android (AdMob) et Web (AdSense).",
          "Suppression des récompenses par minuteur sur les bannières web simples.",
          "Désactivation des publicités web par défaut, validation uniquement sur récompenses réelles.",
          "Ajout des pages Présentation, Règles, Rangs et Contacts.",
        ],
        paragraphs: ["Le jeu en ligne ne requiert plus de pièces."],
      },
      {
        dateTitle: "15 septembre 2026 — Rangs, Classements et Casse-têtes",
        items: [
          "Affichage des cotes sous forme de rangs : Pion, Cavalier, Fou, Tour, Dame et Roi.",
          "Séparation des classements Classique / Stratégie avec liste des Rois et bouton réessayer.",
          "Allègement visuel des menus pour éviter les débordements sur petits écrans.",
          "Intégration du flux de sélection et de relance des casse-têtes dans le menu principal.",
        ],
      },
      {
        dateTitle: "14 septembre 2026 — Synchronisation en ligne et Sécurité",
        items: [
          "Vérification des résultats de match côté serveur contre les doubles décomptes.",
          "Nettoyage des sessions lors du changement de compte.",
          "Échappement HTML des pseudonymes pour sécuriser l'affichage.",
          "Restriction des promotions et compétences de Roi non synchronisées en ligne.",
        ],
      },
    ],
    helpTitle: "Un problème à signaler ?",
    helpP: "Consultez notre <a href=\"./about.html#contact\">page de contact</a> pour détailler les étapes du problème. Pour les bases, rendez-vous sur <a href=\"./guide.html\">Commandes & Règles</a>.",
  },
  es: {
    title: "Historial de Actualizaciones | ChessAlkkagi",
    description: "Registro de cambios y actualizaciones de ChessAlkkagi. Sigue las mejoras del sistema, novedades y balance.",
    h1: "Historial de Actualizaciones",
    lead: "Registro de los cambios principales aplicados a la versión en vivo. La documentación se mantiene sincronizada con las reglas del juego.",
    entries: [
      {
        dateTitle: "15 de septiembre de 2026 — Progreso de cuenta y emparejamiento libre",
        items: [
          "Guardado en la cuenta de fases superadas, puntos de investigación, mejoras, tutoriales y rompecabezas.",
          "Carga automática al iniciar sesión y guardado continuo durante la partida.",
          "Eliminación del coste de monedas, recargas y anuncios de monedas en el modo online.",
        ],
      },
      {
        dateTitle: "15 de septiembre de 2026 — Estructura publicitaria y guías web",
        items: [
          "Separación del flujo publicitario entre Android (AdMob) y Web (AdSense).",
          "Eliminación de recompensas por temporizador en banners web estándar.",
          "Publicidad web desactivada por defecto, supeditada a anuncios bonificados completos.",
          "Adición de páginas de presentación, reglas, rangos y contacto.",
        ],
        paragraphs: ["Las partidas online ya no consumen monedas."],
      },
      {
        dateTitle: "15 de septiembre de 2026 — Rangos, Clasificación y Rompecabezas",
        items: [
          "Sustitución de puntuaciones numéricas por rangos de Peón a Rey.",
          "Clasificaciones separadas para Clásico y Estrategia, con lista de Reyes y botón de reintento.",
          "Optimización de menús para evitar desbordamientos en pantallas pequeñas.",
          "Integración de retos de rompecabezas y selector de niveles en el menú principal.",
        ],
      },
      {
        dateTitle: "14 de septiembre de 2026 — Liquidación online y Seguridad",
        items: [
          "Validación de partidas en el servidor y bloqueo de liquidaciones duplicadas.",
          "Aislamiento de sesiones al cambiar de cuenta para evitar cruce de datos.",
          "Escape HTML en los nombres de jugador para evitar inyecciones.",
          "Restricción en partidas online de coronaciones y habilidades de Rey no sincronizadas.",
        ],
      },
    ],
    helpTitle: "¿Encontraste algún problema?",
    helpP: "Revisa nuestra <a href=\"./about.html#contact\">Guía de Contacto</a> para indicarnos los pasos. Si eres nuevo, consulta <a href=\"./guide.html\">Controles y Reglas</a>.",
  },
  ru: {
    title: "История обновлений | ChessAlkkagi",
    description: "Журнал изменений и история обновлений ChessAlkkagi. Следите за новыми функциями, балансом и улучшениями.",
    h1: "История обновлений",
    lead: "Хроника ключевых изменений, вошедших в текущую версию. Документация обновляется вместе с правилами и интерфейсом.",
    entries: [
      {
        dateTitle: "15 сентября 2026 г. — Прогресс аккаунта и свободный подбор матчей",
        items: [
          "Сохранение этапов, очков исследований, прокачки фигур, прохождения обучения и головоломок в профиле.",
          "Автоматическая загрузка прогресса при входе и синхронизация во время игры.",
          "Удалена плата монетами за сетевые матчи, магазин монет и реклама за монеты.",
        ],
      },
      {
        dateTitle: "15 сентября 2026 г. — Архитектура рекламы и страницы справки",
        items: [
          "Разделены потоки запросов рекламы для Android (AdMob) и Web (AdSense).",
          "Удалено начисление наград по таймеру на обычных веб-баннерах.",
          "Веб-реклама по умолчанию выключена, награды выдаются только за завершенные видео.",
          "Добавлены страницы об игре, правилах, рангах и контактах поддержки.",
        ],
        paragraphs: ["Для сетевых матчей монеты больше не требуются."],
      },
      {
        dateTitle: "15 сентября 2026 г. — Ранги, списки лидеров и головоломки",
        items: [
          "Отображение рейтинга рангами от Пешки до Короля.",
          "Разделение рейтингов Классики и Стратегии, списки Королей и кнопка повтора при сбое загрузки.",
          "Улучшена верстка меню для предотвращения горизонтального переполнения на экранах телефонов.",
          "Интеграция выбора и перезапуска головоломок в главное меню.",
        ],
      },
      {
        dateTitle: "14 сентября 2026 г. — Сетевой расчет и безопасность профилей",
        items: [
          "Серверная валидация итогов матча и защита от повторного зачисления очков.",
          "Очистка данных сессии при смене учетной записи.",
          "Экранирование HTML в никнеймах игроков.",
          "Ограничение несинхронизированных превращений пешек и спецприемов Короля в сетевой игре.",
        ],
      },
    ],
    helpTitle: "Обнаружили ошибку?",
    helpP: "Ознакомьтесь с <a href=\"./about.html#contact\">инструкцией по связи</a> и опишите шаги воспроизведения. Новичкам рекомендуем раздел <a href=\"./guide.html\">Управление и правила</a>.",
  },
  "pt-BR": {
    title: "Histórico de Atualizações | ChessAlkkagi",
    description: "Registro de atualizações do ChessAlkkagi. Acompanhe novos recursos, correções e melhorias de jogabilidade.",
    h1: "Histórico de Atualizações",
    lead: "Registro cronológico das principais alterações da versão pública. As instruções são atualizadas sempre que houver mudanças de interface ou regras.",
    entries: [
      {
        dateTitle: "15 de setembro de 2026 — Progresso da Conta e Partidas Livres",
        items: [
          "Progresso de fases, pontos de pesquisa, melhorias, tutoriais e quebra-cabeças salvos por conta.",
          "Carregamento automático ao entrar e salvamento contínuo durante o jogo.",
          "Fim do custo em moedas, da loja de moedas e de anúncios para recarga de partidas online.",
        ],
      },
      {
        dateTitle: "15 de setembro de 2026 — Estrutura de Anúncios e Páginas Web",
        items: [
          "Separação das requisições de anúncios entre Android (AdMob) e Web (AdSense).",
          "Remoção de recompensas por temporizador em banners simples da web.",
          "Anúncios web desativados por padrão, liberando recompensas apenas após a conclusão do anúncio.",
          "Criação das páginas Sobre o jogo, Regras, Ranques e Contato.",
        ],
        paragraphs: ["As partidas online não necessitam mais de moedas."],
      },
      {
        dateTitle: "15 de setembro de 2026 — Ranques, Classificação e Quebra-cabeças",
        items: [
          "Classificação por ranques de Peão a Rei em substituição à pontuação numérica pura.",
          "Separação das tabelas de Clássico e Estratégia, lista de Reis e botão de nova tentativa.",
          "Otimização do menu para evitar rolagem horizontal indesejada em telas compactas.",
          "Integração do fluxo de seleção e repetição de quebra-cabeças ao menu principal.",
        ],
      },
      {
        dateTitle: "14 de setembro de 2026 — Liquidação Online e Segurança",
        items: [
          "Validação de resultados pelo servidor e proteção contra liquidações duplicadas.",
          "Troca de conta segura sem sobreposição de dados residuais.",
          "Escape de HTML nos apelidos de jogadores para segurança visual.",
          "Restrição temporária de promoções e habilidades de Rei não sincronizadas no modo online.",
        ],
      },
    ],
    helpTitle: "Encontrou um problema?",
    helpP: "Consulte nosso <a href=\"./about.html#contact\">Canal de Contato</a> para relatar as etapas do erro. Para os primeiros passos, acesse <a href=\"./guide.html\">Controles e Regras</a>.",
  },
};
