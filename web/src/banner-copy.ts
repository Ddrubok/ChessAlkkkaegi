import { I18nManager, type LanguageCode } from "./i18n";

export type BannerId =
  | "classic"
  | "slate"
  | "forest"
  | "banner_cosmic_knight"
  | "banner_crimson_sun"
  | "banner_hidden_myeongnyang";

export interface BannerCopyDict {
  names: Record<BannerId, string>;
  descriptions: Record<BannerId, string>;
  conditions: Record<BannerId, string>;
  tips: Record<BannerId, string>;
  modes: Record<BannerId, string>;
  tab: string;
  hint: string;
  guestNotice: string;
  bannerObjectives: string;
  bannerReward: string;
  equip: string;
  equipped: string;
  locked: string;
  memberDefault: string;
  progressLabel: string;
  complete: string;
}

const DICTS: Record<LanguageCode, BannerCopyDict> = {
  ko: {
    names: {
      classic: "클래식",
      slate: "슬레이트",
      forest: "포레스트",
      banner_cosmic_knight: "성운의 나이트",
      banner_crimson_sun: "일도양단",
      banner_hidden_myeongnyang: "불멸: 열두 척의 기적",
    },
    descriptions: {
      classic: "회원 기본 제공 배너입니다.",
      slate: "회원 기본 제공 배너입니다.",
      forest: "회원 기본 제공 배너입니다.",
      banner_cosmic_knight: "직접 발사한 나이트로 적 기물 누적 50개를 장외로 떨어뜨리세요.",
      banner_crimson_sun: "직접 발사한 한 샷으로 서로 다른 적 기물 3개 이상을 장외로 떨어뜨리세요.",
      banner_hidden_myeongnyang: "내 기물 2개 이하, 상대 기물 5개 이상 상황을 겪은 뒤 그 경기에서 승리하세요.",
    },
    conditions: {
      classic: "회원 기본 제공",
      slate: "회원 기본 제공",
      forest: "회원 기본 제공",
      banner_cosmic_knight: "직접 발사한 나이트로 적 기물 총 50개를 장외로 떨어뜨림 (일반 PvE)",
      banner_crimson_sun: "직접 발사한 한 샷으로 서로 다른 적 기물 3개 이상을 장외로 떨어뜨림 (일반 PvE)",
      banner_hidden_myeongnyang: "내 기물 2개 이하이고 상대 기물이 5개 이상인 상황을 겪은 뒤 승리 (PvE 스테이지 5 이상)",
    },
    tips: {
      classic: "회원 계정에 기본으로 제공되는 테마입니다.",
      slate: "회원 계정에 기본으로 제공되는 차분한 슬레이트 테마입니다.",
      forest: "회원 계정에 기본으로 제공되는 포레스트 테마입니다.",
      banner_cosmic_knight: "스테이지 대전에서 나이트로 적 기물을 집중 공략하세요.",
      banner_crimson_sun: "연쇄 충돌 각도를 찾아 한 번에 적 기물 3개를 노리세요.",
      banner_hidden_myeongnyang: "스테이지 5 이상의 고난도 경기에서 끝까지 집중해 대역전극을 완성하세요.",
    },
    modes: {
      classic: "조건 없음",
      slate: "조건 없음",
      forest: "조건 없음",
      banner_cosmic_knight: "일반 PvE",
      banner_crimson_sun: "일반 PvE",
      banner_hidden_myeongnyang: "PvE 스테이지 5 이상",
    },
    tab: "배너",
    hint: "배너 설정은 회원 계정에 저장됩니다.",
    guestNotice: "게스트는 기본 단색 배너를 사용합니다. 이미지 배너는 회원 계정으로 로그인하면 선택할 수 있습니다.",
    bannerObjectives: "배너 업적",
    bannerReward: "배너 보상",
    equip: "장착",
    equipped: "장착 중",
    locked: "잠김",
    memberDefault: "회원 기본 제공",
    progressLabel: "진행도",
    complete: "획득 완료",
  },
  en: {
    names: {
      classic: "Classic",
      slate: "Slate",
      forest: "Forest",
      banner_cosmic_knight: "Cosmic Knight",
      banner_crimson_sun: "Cleave in Two",
      banner_hidden_myeongnyang: "Immortal: Twelve Ships",
    },
    descriptions: {
      classic: "Default banner provided to all members.",
      slate: "Default banner provided to all members.",
      forest: "Default banner provided to all members.",
      banner_cosmic_knight: "Knock 50 enemy pieces off the board with your launched Knight in normal PvE.",
      banner_crimson_sun: "Knock 3 or more enemy pieces off the board in a single shot in normal PvE.",
      banner_hidden_myeongnyang: "Win a match after having 2 or fewer friendly pieces against 5 or more enemies in PvE Stage 5+.",
    },
    conditions: {
      classic: "Member default",
      slate: "Member default",
      forest: "Member default",
      banner_cosmic_knight: "Knock 50 enemy pieces off the board with launched Knights (Normal PvE)",
      banner_crimson_sun: "Knock 3+ distinct enemy pieces off the board in a single shot (Normal PvE)",
      banner_hidden_myeongnyang: "Win after being down to ≤2 friendly pieces vs ≥5 enemy pieces (PvE Stage 5+)",
    },
    tips: {
      classic: "Standard theme available to all member accounts.",
      slate: "Muted slate theme available to all member accounts.",
      forest: "Natural forest theme available to all member accounts.",
      banner_cosmic_knight: "Focus on striking enemy pieces with Knights in Stage Battle.",
      banner_crimson_sun: "Look for chain collision angles to knock out 3 enemy pieces in one turn.",
      banner_hidden_myeongnyang: "Stay focused in challenging Stage 5+ battles to pull off a dramatic comeback.",
    },
    modes: {
      classic: "No conditions",
      slate: "No conditions",
      forest: "No conditions",
      banner_cosmic_knight: "Normal PvE",
      banner_crimson_sun: "Normal PvE",
      banner_hidden_myeongnyang: "PvE Stage 5+",
    },
    tab: "Banner",
    hint: "Banner preferences are saved to your account.",
    guestNotice: "Guests use the default plain banner. Log in with a member account to select image banners.",
    bannerObjectives: "Banner Objectives",
    bannerReward: "Banner Reward",
    equip: "Equip",
    equipped: "Equipped",
    locked: "Locked",
    memberDefault: "Member default",
    progressLabel: "Progress",
    complete: "Earned",
  },
  ja: {
    names: {
      classic: "クラシック",
      slate: "スレート",
      forest: "フォレスト",
      banner_cosmic_knight: "星雲のナイト",
      banner_crimson_sun: "一刀両断",
      banner_hidden_myeongnyang: "不滅：十二隻の奇跡",
    },
    descriptions: {
      classic: "会員初期提供の基本バナーです。",
      slate: "会員初期提供の基本バナーです。",
      forest: "会員初期提供の基本バナーです。",
      banner_cosmic_knight: "直接発射したナイトで敵駒を累計50個落とす（通常PvE）。",
      banner_crimson_sun: "1回のショットで敵駒を同時に3個以上落とす（通常PvE）。",
      banner_hidden_myeongnyang: "味方2個以下・敵5個以上の劣勢から逆転勝利する（PvEステージ5以上）。",
    },
    conditions: {
      classic: "会員初期提供",
      slate: "会員初期提供",
      forest: "会員初期提供",
      banner_cosmic_knight: "ナイト発射で敵駒累計50個落下（通常PvE）",
      banner_crimson_sun: "1回のショットで敵駒3個以上落下（通常PvE）",
      banner_hidden_myeongnyang: "味方≤2個 vs 敵≥5個の劣勢から勝利（PvEステージ5以上）",
    },
    tips: {
      classic: "会員アカウントに標準で提供されるテーマです。",
      slate: "会員アカウントに標準で提供されるスレートテーマです。",
      forest: "会員アカウントに標準で提供されるフォレストテーマです。",
      banner_cosmic_knight: "ステージ対戦でナイトを使って敵駒を集中的に狙いましょう。",
      banner_crimson_sun: "連鎖落下の角度を見つけ、1手で3個の敵駒を狙いましょう。",
      banner_hidden_myeongnyang: "ステージ5以上の高難度対戦で最後まで集中し、大逆転勝利を収めましょう。",
    },
    modes: {
      classic: "条件なし",
      slate: "条件なし",
      forest: "条件なし",
      banner_cosmic_knight: "通常PvE",
      banner_crimson_sun: "通常PvE",
      banner_hidden_myeongnyang: "PvEステージ5以上",
    },
    tab: "バナー",
    hint: "バナー設定はアカウントに保存されます。",
    guestNotice: "ゲストは標準の単色バナーを使用します。画像バナーは会員アカウントでログインすると選択できます。",
    bannerObjectives: "バナー実績",
    bannerReward: "バナー報酬",
    equip: "装備",
    equipped: "装備中",
    locked: "未解放",
    memberDefault: "会員初期提供",
    progressLabel: "進行度",
    complete: "獲得済み",
  },
  "zh-CN": {
    names: {
      classic: "经典",
      slate: "板岩",
      forest: "森林",
      banner_cosmic_knight: "星云骑士",
      banner_crimson_sun: "一刀两断",
      banner_hidden_myeongnyang: "不灭：十二艘的奇迹",
    },
    descriptions: {
      classic: "所有会员的默认提供横幅。",
      slate: "所有会员的默认提供横幅。",
      forest: "所有会员的默认提供横幅。",
      banner_cosmic_knight: "使用发动的骑士在普通PvE中累计将50个敌方棋子击落出界。",
      banner_crimson_sun: "在普通PvE中单次发射击落3个或更多敌方棋子出界。",
      banner_hidden_myeongnyang: "在己方≤2个、敌方≥5个的劣势下完成逆转胜利（PvE第5关及以上）。",
    },
    conditions: {
      classic: "会员默认提供",
      slate: "会员默认提供",
      forest: "会员默认提供",
      banner_cosmic_knight: "骑士发射累计击落50个敌棋（普通PvE）",
      banner_crimson_sun: "单次发射击落3个以上敌棋（普通PvE）",
      banner_hidden_myeongnyang: "己方≤2 vs 敌方≥5劣势逆转获胜（PvE第5关及以上）",
    },
    tips: {
      classic: "会员账号默认提供的经典主题。",
      slate: "会员账号默认提供的板岩主题。",
      forest: "会员账号默认提供的森林主题。",
      banner_cosmic_knight: "在关卡对战中重点使用骑士攻击敌方棋子。",
      banner_crimson_sun: "寻找连锁碰撞角度，争取一击击落3个敌方棋子。",
      banner_hidden_myeongnyang: "在第5关及以上的高难度关卡中保持专注，完成绝地大反击。",
    },
    modes: {
      classic: "无条件",
      slate: "无条件",
      forest: "无条件",
      banner_cosmic_knight: "普通PvE",
      banner_crimson_sun: "普通PvE",
      banner_hidden_myeongnyang: "PvE第5关及以上",
    },
    tab: "横幅",
    hint: "横幅设置保存在您的账号中。",
    guestNotice: "访客使用默认纯色横幅。登录会员账号后即可选择图片横幅。",
    bannerObjectives: "横幅成就",
    bannerReward: "横幅奖励",
    equip: "装备",
    equipped: "已装备",
    locked: "未解锁",
    memberDefault: "会员默认提供",
    progressLabel: "进度",
    complete: "已获得",
  },
  de: {
    names: {
      classic: "Klassisch",
      slate: "Schiefer",
      forest: "Wald",
      banner_cosmic_knight: "Kosmischer Springer",
      banner_crimson_sun: "Klarer Schnitt",
      banner_hidden_myeongnyang: "Unsterblich: Zwölf Schiffe",
    },
    descriptions: {
      classic: "Standard-Banner für alle Mitglieder.",
      slate: "Standard-Banner für alle Mitglieder.",
      forest: "Standard-Banner für alle Mitglieder.",
      banner_cosmic_knight: "Wirf mit deinem Springer im normalen PvE insgesamt 50 gegnerische Figuren heraus.",
      banner_crimson_sun: "Wirf in einem einzigen Schuss mindestens 3 gegnerische Figuren im normalen PvE heraus.",
      banner_hidden_myeongnyang: "Gewinne nach einem Rückstand von ≤2 eigenen gegen ≥5 gegnerische Figuren (PvE ab Stufe 5).",
    },
    conditions: {
      classic: "Mitglieder-Standard",
      slate: "Mitglieder-Standard",
      forest: "Mitglieder-Standard",
      banner_cosmic_knight: "50 gegnerische Figuren mit Springer herauswerfen (Normales PvE)",
      banner_crimson_sun: "Mindestens 3 gegnerische Figuren mit einem Schuss herauswerfen (Normales PvE)",
      banner_hidden_myeongnyang: "Sieg nach Rückstand von ≤2 gegen ≥5 Figuren (PvE ab Stufe 5)",
    },
    tips: {
      classic: "Klassisches Design für alle Mitgliedskonten.",
      slate: "Ruhiges Schiefer-Design für alle Mitgliedskonten.",
      forest: "Natürliches Wald-Design für alle Mitgliedskonten.",
      banner_cosmic_knight: "Nutze in Stufenkämpfen gezielt Springer gegen gegnerische Figuren.",
      banner_crimson_sun: "Finde Kettenschuss-Winkel, um 3 gegnerische Figuren auf einmal zu treffen.",
      banner_hidden_myeongnyang: "Bleibe in anspruchsvollen Kämpfen ab Stufe 5 konzentriert für ein starkes Comeback.",
    },
    modes: {
      classic: "Keine Bedingung",
      slate: "Keine Bedingung",
      forest: "Keine Bedingung",
      banner_cosmic_knight: "Normales PvE",
      banner_crimson_sun: "Normales PvE",
      banner_hidden_myeongnyang: "PvE ab Stufe 5",
    },
    tab: "Banner",
    hint: "Banner-Einstellungen werden in Ihrem Konto gespeichert.",
    guestNotice: "Gäste verwenden das standardmäßige einfarbige Banner. Melden Sie sich mit einem Mitgliedskonto an, um Bildbanner auszuwählen.",
    bannerObjectives: "Banner-Ziele",
    bannerReward: "Banner-Belohnung",
    equip: "Ausrüsten",
    equipped: "Ausgerüstet",
    locked: "Gesperrt",
    memberDefault: "Mitglieder-Standard",
    progressLabel: "Fortschritt",
    complete: "Verdient",
  },
  fr: {
    names: {
      classic: "Classique",
      slate: "Ardoise",
      forest: "Forêt",
      banner_cosmic_knight: "Cavalier cosmique",
      banner_crimson_sun: "Frappe décisive",
      banner_hidden_myeongnyang: "Immortel : Douze navires",
    },
    descriptions: {
      classic: "Bannière par défaut offerte à tous les membres.",
      slate: "Bannière par défaut offerte à tous les membres.",
      forest: "Bannière par défaut offerte à tous les membres.",
      banner_cosmic_knight: "Faites tomber 50 pièces ennemies avec votre Cavalier en PvE normal.",
      banner_crimson_sun: "Faites tomber 3 pièces ennemies ou plus en un seul tir en PvE normal.",
      banner_hidden_myeongnyang: "Gagnez après vous être retrouvé à ≤2 pièces contre ≥5 ennemis (PvE étape 5+).",
    },
    conditions: {
      classic: "Inclus pour les membres",
      slate: "Inclus pour les membres",
      forest: "Inclus pour les membres",
      banner_cosmic_knight: "Faire tomber 50 pièces ennemies avec le Cavalier (PvE normal)",
      banner_crimson_sun: "Faire tomber 3+ pièces ennemies en un seul tir (PvE normal)",
      banner_hidden_myeongnyang: "Gagner après un déficit de ≤2 vs ≥5 pièces (PvE étape 5+)",
    },
    tips: {
      classic: "Thème classique accessible à tous les membres.",
      slate: "Thème ardoise sobre accessible à tous les membres.",
      forest: "Thème forêt naturelle accessible à tous les membres.",
      banner_cosmic_knight: "Ciblez les pièces ennemies avec vos Cavaliers en combat de niveau.",
      banner_crimson_sun: "Trouvez des angles de collision en chaîne pour éliminer 3 pièces ennemies d'un coup.",
      banner_hidden_myeongnyang: "Restez concentré dans les combats difficiles de niveau 5+ pour renverser la vapeur.",
    },
    modes: {
      classic: "Sans condition",
      slate: "Sans condition",
      forest: "Sans condition",
      banner_cosmic_knight: "PvE normal",
      banner_crimson_sun: "PvE normal",
      banner_hidden_myeongnyang: "PvE étape 5+",
    },
    tab: "Bannière",
    hint: "Les préférences de bannière sont enregistrées sur votre compte.",
    guestNotice: "Les invités utilisent la bannière unie par défaut. Connectez-vous avec un compte membre pour choisir une bannière illustrée.",
    bannerObjectives: "Objectifs de bannière",
    bannerReward: "Récompense de bannière",
    equip: "Équiper",
    equipped: "Équipée",
    locked: "Verrouillée",
    memberDefault: "Inclus pour les membres",
    progressLabel: "Progression",
    complete: "Obtenue",
  },
  es: {
    names: {
      classic: "Clásico",
      slate: "Pizarra",
      forest: "Bosque",
      banner_cosmic_knight: "Caballo cósmico",
      banner_crimson_sun: "Corte decisivo",
      banner_hidden_myeongnyang: "Inmortal: Doce naves",
    },
    descriptions: {
      classic: "Estandarte predeterminado para todos los miembros.",
      slate: "Estandarte predeterminado para todos los miembros.",
      forest: "Estandarte predeterminado para todos los miembros.",
      banner_cosmic_knight: "Haz caer 50 piezas enemigas con tu Caballo en PvE normal.",
      banner_crimson_sun: "Haz caer 3 o más piezas enemigas de un solo tiro en PvE normal.",
      banner_hidden_myeongnyang: "Gana tras verte reducido a ≤2 piezas frente a ≥5 enemigas (PvE etapa 5+).",
    },
    conditions: {
      classic: "Incluido para miembros",
      slate: "Incluido para miembros",
      forest: "Incluido para miembros",
      banner_cosmic_knight: "Hacer caer 50 piezas enemigas con el Caballo (PvE normal)",
      banner_crimson_sun: "Hacer caer 3+ piezas enemigas de un solo tiro (PvE normal)",
      banner_hidden_myeongnyang: "Ganar tras desventaja de ≤2 vs ≥5 piezas (PvE etapa 5+)",
    },
    tips: {
      classic: "Tema clásico disponible para todas las cuentas de miembros.",
      slate: "Tema pizarra sobrio disponible para todas las cuentas de miembros.",
      forest: "Tema bosque natural disponible para todas las cuentas de miembros.",
      banner_cosmic_knight: "Apunta a las piezas enemigas con tus Caballos en combates de etapa.",
      banner_crimson_sun: "Busca ángulos de colisión en cadena para derribar 3 piezas enemigas en un tiro.",
      banner_hidden_myeongnyang: "Mantén la concentración en las difíciles batallas de etapa 5+ para una gran remontada.",
    },
    modes: {
      classic: "Sin condición",
      slate: "Sin condición",
      forest: "Sin condición",
      banner_cosmic_knight: "PvE normal",
      banner_crimson_sun: "PvE normal",
      banner_hidden_myeongnyang: "PvE etapa 5+",
    },
    tab: "Estandarte",
    hint: "Las preferencias de estandarte se guardan en tu cuenta.",
    guestNotice: "Los invitados usan el estandarte liso predeterminado. Inicia sesión con una cuenta de miembro para seleccionar estandartes con imagen.",
    bannerObjectives: "Objetivos de estandarte",
    bannerReward: "Recompensa de estandarte",
    equip: "Equipar",
    equipped: "Equipado",
    locked: "Bloqueado",
    memberDefault: "Incluido para miembros",
    progressLabel: "Progreso",
    complete: "Obtenida",
  },
  ru: {
    names: {
      classic: "Классический",
      slate: "Сланец",
      forest: "Лес",
      banner_cosmic_knight: "Космический конь",
      banner_crimson_sun: "Один удар",
      banner_hidden_myeongnyang: "Бессмертный: Двенадцать кораблей",
    },
    descriptions: {
      classic: "Стандартный баннер для всех участников.",
      slate: "Стандартный баннер для всех участников.",
      forest: "Стандартный баннер для всех участников.",
      banner_cosmic_knight: "Выбейте 50 вражеских фигур своим конём в обычном PvE.",
      banner_crimson_sun: "Выбейте 3 или более вражеских фигур одним выстрелом в обычном PvE.",
      banner_hidden_myeongnyang: "Победите в партии после ситуации с ≤2 фигурами против ≥5 врагов (PvE этап 5+).",
    },
    conditions: {
      classic: "Доступно участникам",
      slate: "Доступно участникам",
      forest: "Доступно участникам",
      banner_cosmic_knight: "Выбить 50 вражеских фигур конём (Обычный PvE)",
      banner_crimson_sun: "Выбить 3+ вражеских фигур одним выстрелом (Обычный PvE)",
      banner_hidden_myeongnyang: "Победа после отставания ≤2 против ≥5 фигур (PvE этап 5+)",
    },
    tips: {
      classic: "Классическая тема, доступная всем участникам.",
      slate: "Сдержанная сланцевая тема, доступная всем участникам.",
      forest: "Природная лесная тема, доступная всем участникам.",
      banner_cosmic_knight: "Атакуйте вражеские фигуры конями в этапных боях.",
      banner_crimson_sun: "Ищите углы цепных ударов, чтобы выбить 3 фигуры за раз.",
      banner_hidden_myeongnyang: "Сохраняйте концентрацию в сложных боях этапа 5+, чтобы совершить камбэк.",
    },
    modes: {
      classic: "Без условий",
      slate: "Без условий",
      forest: "Без условий",
      banner_cosmic_knight: "Обычный PvE",
      banner_crimson_sun: "Обычный PvE",
      banner_hidden_myeongnyang: "PvE этап 5+",
    },
    tab: "Баннер",
    hint: "Настройки баннера сохраняются в вашей учётной записи.",
    guestNotice: "Гости используют стандартный однотонный баннер. Войдите в учетную запись участника, чтобы выбрать графический баннер.",
    bannerObjectives: "Задачи баннеров",
    bannerReward: "Награда баннера",
    equip: "Надеть",
    equipped: "Надето",
    locked: "Заблокировано",
    memberDefault: "Доступно участникам",
    progressLabel: "Прогресс",
    complete: "Получено",
  },
  "pt-BR": {
    names: {
      classic: "Clássico",
      slate: "Ardósia",
      forest: "Floresta",
      banner_cosmic_knight: "Cavalo Cósmico",
      banner_crimson_sun: "Golpe Decisivo",
      banner_hidden_myeongnyang: "Imortal: Doze Navios",
    },
    descriptions: {
      classic: "Banner padrão fornecido a todos os membros.",
      slate: "Banner padrão fornecido a todos os membros.",
      forest: "Banner padrão fornecido a todos os membros.",
      banner_cosmic_knight: "Derrube 50 peças inimigas com seu Cavalo em PvE normal.",
      banner_crimson_sun: "Derrube 3 ou mais peças inimigas em um único disparo no PvE normal.",
      banner_hidden_myeongnyang: "Vença após ficar com ≤2 peças contra ≥5 inimigos (PvE fase 5+).",
    },
    conditions: {
      classic: "Padrão para membros",
      slate: "Padrão para membros",
      forest: "Padrão para membros",
      banner_cosmic_knight: "Derrubar 50 peças inimigas com o Cavalo (PvE normal)",
      banner_crimson_sun: "Derrubar 3+ peças inimigas em disparo único (PvE normal)",
      banner_hidden_myeongnyang: "Vencer após desvantagem de ≤2 vs ≥5 peças (PvE fase 5+)",
    },
    tips: {
      classic: "Tema padrão disponível para todas as contas de membros.",
      slate: "Tema ardósia sóbrio disponível para todas as contas de membros.",
      forest: "Tema floresta natural disponível para todas as contas de membros.",
      banner_cosmic_knight: "Foque em atingir peças inimigas com Cavalos na Batalha de Fases.",
      banner_crimson_sun: "Encontre ângulos de colisão em cadeia para derrubar 3 peças inimigas de uma vez.",
      banner_hidden_myeongnyang: "Mantenha o foco em batalhas difíceis da fase 5+ para virar o jogo.",
    },
    modes: {
      classic: "Sem requisitos",
      slate: "Sem requisitos",
      forest: "Sem requisitos",
      banner_cosmic_knight: "PvE normal",
      banner_crimson_sun: "PvE normal",
      banner_hidden_myeongnyang: "PvE fase 5+",
    },
    tab: "Banner",
    hint: "As preferências de banner são salvas na sua conta.",
    guestNotice: "Convidados usam o banner liso padrão. Faça login com uma conta de membro para selecionar banners com imagem.",
    bannerObjectives: "Objetivos de Banner",
    bannerReward: "Recompensa de banner",
    equip: "Equipar",
    equipped: "Equipado",
    locked: "Bloqueado",
    memberDefault: "Padrão para membros",
    progressLabel: "Progresso",
    complete: "Obtida",
  },
};

export function bannerCopy(language?: LanguageCode): BannerCopyDict {
  const lang = language || I18nManager.getLanguage?.() || "en";
  return DICTS[lang] || DICTS["en"];
}

export function bannerThemeName(id: BannerId, language?: LanguageCode): string {
  const dict = bannerCopy(language);
  return dict.names[id] || id;
}

export function bannerThemeCondition(id: BannerId, language?: LanguageCode): string {
  const dict = bannerCopy(language);
  return dict.conditions[id] || "";
}

export function bannerThemeDescription(id: BannerId, language?: LanguageCode): string {
  const dict = bannerCopy(language);
  return dict.descriptions[id] || "";
}

export function bannerThemeTip(id: BannerId, language?: LanguageCode): string {
  const dict = bannerCopy(language);
  return dict.tips[id] || "";
}

export function bannerThemeMode(id: BannerId, language?: LanguageCode): string {
  const dict = bannerCopy(language);
  return dict.modes[id] || "";
}
