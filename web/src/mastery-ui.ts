import { escapeHtml } from "./html";
import { I18nManager, type LanguageCode } from "./i18n";
import {
  MASTERY_DEFINITIONS, MASTERY_IDS, earnedMedalCount, equippedItem, isMedalEarned,
  loadMasterySnapshot, medalProgress, setEquippedMastery, setTrackedMastery,
  type EquipmentSlot, type MasteryId, type MasteryProgressItem, type MasteryStorage,
} from "./mastery";
import {
  ACHIEVEMENT_BANNER_IDS,
  getBannerProgress,
  ownsBanner,
  bannerImageUrl,
  type BannerId,
} from "./banner-collection";
import {
  bannerThemeName,
  bannerThemeCondition,
  bannerThemeMode,
} from "./banner-copy";

type Copy = {
  book: string; summary: string; personal: string; experience: string; skill: string; complete: string; locked: string;
  track: string; tracking: string; untrack: string; details: string; modes: string; reward: string; play: string; close: string;
  rewards: string; badge: string; title: string; frame: string; banner: string; none: string; equip: string;
  explorer: string; challenger: string; completeFrame: string; classicFrame: string;
  future: string; pending: string; malformed: string; result: string; viewAll: string;
  bannerObjectives: string; bannerReward: string;
  names: Record<MasteryId, string>; conditions: Record<MasteryId, string>; tips: Record<MasteryId, string>;
};

const EN_NAMES: Record<MasteryId, string> = {
  M01: "First Victory", M02: "Six Kinds of Feel", M03: "Problem Solver", M04: "Precise Solution",
  M05: "Sense of the Match", M06: "Double Out", M07: "Everyone Returned", M08: "Terrain Explorer",
};
const EN_CONDITIONS: Record<MasteryId, string> = {
  M01: "Win one normal PVE battle after an enemy actually falls.", M02: "Validly launch Pawn, Knight, Bishop, Rook, Queen, and King.",
  M03: "Complete three distinct official puzzles.", M04: "Earn gold on three distinct official puzzles.",
  M05: "Win five normal PVE battles.", M06: "Make at least two enemies actually fall during one player launch settlement.",
  M07: "Win normal PVE with an enemy fall and no friendly falls.", M08: "Win normal PVE on three distinct board templates.",
};
const EN_TIPS: Record<MasteryId, string> = {
  M01: "Play Stage Battle and finish the opponent.", M02: "Try the tutorial, PVE, or official puzzles.",
  M03: "Open Official Puzzles and solve new problems.", M04: "Replay official puzzles while meeting their gold rules.",
  M05: "Keep progressing through Stage Battle.", M06: "Look for chain shots in PVE or official puzzles.",
  M07: "Use controlled shots and protect every friendly piece.", M08: "Advance through stages to discover new terrain.",
};

const BASE: Omit<Copy, "names" | "conditions" | "tips"> = {
  book: "Mastery Medal Book", summary: "Mastery", personal: "Personal record", experience: "Experience", skill: "Skill",
  complete: "Earned", locked: "In progress", track: "Track objective", tracking: "Tracked", untrack: "Stop tracking",
  details: "Condition details", modes: "Eligible modes", reward: "Reward", play: "Recommended play", close: "Close",
  rewards: "Rewards & equipment", badge: "Badge", title: "Title", frame: "Profile frame", banner: "Banner", none: "None", equip: "Equip",
  explorer: "Explorer", challenger: "Challenger", completeFrame: "Mastery Complete frame", classicFrame: "Classic Gold Frame", bannerObjectives: "Banner Objectives", bannerReward: "Banner",
  future: "Woodgrain set entitlement — cosmetic scheduled for a future release.",
  pending: "New mastery records await server storage and are safe in this account's device cache.",
  malformed: "Mastery data needs recovery. New writes are paused to preserve it.",
  result: "Mastery progress", viewAll: "View All",
};

const localized: Partial<Record<LanguageCode, Partial<Copy>>> = {
  ko: {
    book: "숙련 메달 도감", summary: "숙련", personal: "개인 기록", experience: "경험", skill: "기술", complete: "획득",
    locked: "진행 중", track: "목표 추적", tracking: "추적 중", untrack: "추적 해제", details: "조건 상세", modes: "인정 모드",
    reward: "보상", play: "추천 플레이", close: "닫기", rewards: "보상 및 장착", badge: "배지", title: "칭호", frame: "프로필 프레임", banner: "배너",
    none: "없음", equip: "장착", explorer: "탐구자", challenger: "도전자", completeFrame: "숙련 완성 프레임", classicFrame: "클래식 골드 프레임", bannerObjectives: "배너 업적", bannerReward: "배너",
    future: "나뭇결 세트 이용권 — 꾸미기 아이템은 향후 출시 예정입니다.",
    pending: "새 숙련 기록이 서버 저장을 기다리며 이 계정의 기기 캐시에 안전하게 보관됩니다.",
    malformed: "숙련 기록 복구가 필요하여 원본 보존을 위해 새 저장을 멈췄습니다.",
    result: "숙련 진행", viewAll: "전체 보기",
    names: { M01: "첫 승리", M02: "여섯 가지 손맛", M03: "문제 해결사", M04: "정밀한 해법", M05: "대국의 감각", M06: "더블 아웃", M07: "모두 돌아왔다", M08: "지형 탐험가" },
    conditions: { M01: "적이 실제로 낙하한 정상 PVE 대전에서 1승하세요.", M02: "폰·나이트·비숍·룩·퀸·킹을 각각 한 번 유효 발사하세요.", M03: "서로 다른 공식 퍼즐 3개를 완료하세요.", M04: "서로 다른 공식 퍼즐 3개에서 금메달을 획득하세요.", M05: "정상 PVE 대전에서 5승하세요.", M06: "한 번의 플레이어 발사 정착 중 적 2개 이상을 실제 낙하시키세요.", M07: "적을 실제 낙하시키고 아군 낙하 없이 정상 PVE에서 승리하세요.", M08: "서로 다른 보드 템플릿 3종에서 정상 PVE 승리를 거두세요." },
    tips: { M01: "스테이지 대전에서 상대를 끝까지 밀어내세요.", M02: "튜토리얼·PVE·공식 퍼즐에서 다양한 기물을 써 보세요.", M03: "공식 퍼즐에서 새로운 문제를 해결하세요.", M04: "공식 퍼즐의 금메달 조건을 맞춰 다시 도전하세요.", M05: "스테이지 대전을 계속 진행하세요.", M06: "PVE나 공식 퍼즐에서 연쇄 낙하 각도를 노리세요.", M07: "정교한 발사로 모든 아군을 지키세요.", M08: "스테이지를 진행해 새로운 지형을 만나세요." },
  },
  ja: {
    book: "熟練メダルブック", summary: "熟練", personal: "個人記録", experience: "経験", skill: "技術", complete: "獲得済み",
    locked: "進行中", track: "目標を追跡", tracking: "追跡中", untrack: "追跡解除", details: "条件詳細", modes: "対象モード",
    reward: "報酬", play: "おすすめプレイ", close: "閉じる", rewards: "報酬と装備", badge: "バッジ", title: "称号", frame: "プロフィールフレーム", banner: "バナー",
    none: "なし", equip: "装備", explorer: "探究者", challenger: "挑戦者", completeFrame: "熟練達成フレーム", classicFrame: "クラシックゴールド枠", bannerObjectives: "バナー実績", bannerReward: "バナー",
    future: "木目セット権利 — コスメは今後リリース予定です。",
    pending: "新しい熟練記録はサーバー保存待ちで、この端末のアカウントキャッシュに安全に保持されています。",
    malformed: "熟練データの復旧が必要です。保護のため新しい保存を停止しました。",
    result: "熟練進行", viewAll: "すべて表示",
    names: { M01: "初勝利", M02: "六つの手応え", M03: "問題解決者", M04: "精密な解法", M05: "対局の感覚", M06: "ダブルアウト", M07: "全員帰還", M08: "地形探検家" },
    conditions: { M01: "敵が実際に落下した通常PVEで1勝する。", M02: "6種類の駒をそれぞれ有効に発射する。", M03: "異なる公式パズルを3問クリアする。", M04: "異なる公式パズル3問で金を取る。", M05: "通常PVEで5勝する。", M06: "1回の発射の静止までに敵を2個以上落とす。", M07: "味方を落とさず敵を落として通常PVEに勝つ。", M08: "異なる盤面3種で通常PVEに勝つ。" },
    tips: { M01: "ステージ対戦へ進みましょう。", M02: "チュートリアル、PVE、公式パズルで試しましょう。", M03: "公式パズルの新しい問題を解きましょう。", M04: "金条件を確認して再挑戦しましょう。", M05: "ステージ対戦を続けましょう。", M06: "連鎖落下を狙いましょう。", M07: "正確なショットで味方を守りましょう。", M08: "ステージを進めて地形を探しましょう。" },
  },
  "zh-CN": {
    book: "精通勋章册", summary: "精通", personal: "个人记录", experience: "经验", skill: "技巧", complete: "已获得",
    locked: "进行中", track: "追踪目标", tracking: "追踪中", untrack: "停止追踪", details: "条件详情", modes: "适用模式",
    reward: "奖励", play: "推荐玩法", close: "关闭", rewards: "奖励与装备", badge: "徽章", title: "称号", frame: "头像框", banner: "横幅",
    none: "无", equip: "装备", explorer: "探索者", challenger: "挑战者", completeFrame: "熟练完成头像框", classicFrame: "经典金色边框", bannerObjectives: "横幅成就", bannerReward: "横幅",
    future: "木纹套装权益 — 外观内容计划未来推出。",
    pending: "新的熟练记录正在等待服务器存储，并安全保存在此设备的账户缓存中。",
    malformed: "熟练数据需要恢复。为保护数据，已暂停写入。",
    result: "精通进度", viewAll: "查看全部",
    names: { M01: "初次胜利", M02: "六种手感", M03: "问题解决者", M04: "精确解法", M05: "对局感觉", M06: "双重出界", M07: "全员归来", M08: "地形探索者" },
    conditions: { M01: "在敌棋实际落下的普通PVE中获胜一次。", M02: "有效发射六种棋子各一次。", M03: "完成三个不同的官方谜题。", M04: "在三个不同的官方谜题获得金牌。", M05: "赢得五场普通PVE。", M06: "一次玩家发射结算中让至少两个敌棋落下。", M07: "零己方落下并让敌棋落下后赢得普通PVE。", M08: "在三种不同棋盘模板赢得普通PVE。" },
    tips: { M01: "进入关卡对战。", M02: "在教程、PVE或官方谜题尝试。", M03: "解决新的官方谜题。", M04: "按金牌条件重试。", M05: "继续关卡对战。", M06: "寻找连锁落下机会。", M07: "精准发射并保护己方。", M08: "推进关卡探索地形。" },
  },
  de: {
    book: "Meisterschaftsmedaillen", summary: "Meisterschaft", personal: "Persönlicher Rekord", experience: "Erfahrung",
    skill: "Fertigkeit", complete: "Verdient", locked: "In Arbeit", track: "Ziel verfolgen", tracking: "Verfolgt",
    untrack: "Nicht mehr verfolgen", details: "Bedingungen", modes: "Gültige Modi", reward: "Belohnung", play: "Empfohlen",
    close: "Schließen", rewards: "Belohnungen & Ausrüstung", badge: "Abzeichen", title: "Titel", frame: "Profilrahmen", banner: "Banner",
    none: "Keine", equip: "Ausrüsten", explorer: "Entdecker", challenger: "Herausforderer", completeFrame: "Meisterschaftsrahmen", classicFrame: "Klassischer Goldrahmen", bannerObjectives: "Banner-Ziele",
    bannerReward: "Banner", future: "Holzmaserungs-Set-Berechtigung — Kosmetik erscheint später.",
    pending: "Neue Meisterschaftsdaten warten auf die Serverspeicherung und bleiben sicher im Gerätespeicher dieses Kontos.",
    malformed: "Die Meisterschaftsdaten müssen wiederhergestellt werden. Neue Speicherungen sind zum Schutz angehalten.",
    result: "Meisterschaftsfortschritt", viewAll: "Alle anzeigen",
    names: { M01: "Erster Sieg", M02: "Sechs Spielgefühle", M03: "Problemlöser", M04: "Präzise Lösung", M05: "Gespür fürs Spiel", M06: "Doppel-Aus", M07: "Alle zurück", M08: "Geländeentdecker" },
    conditions: { M01: "Gewinne ein normales PVE mit einem echten gegnerischen Fall.", M02: "Starte jede der sechs Figurenarten gültig.", M03: "Löse drei verschiedene offizielle Rätsel.", M04: "Hole Gold in drei verschiedenen offiziellen Rätseln.", M05: "Gewinne fünf normale PVE-Kämpfe.", M06: "Lass in einer eigenen Setzphase mindestens zwei Gegner fallen.", M07: "Gewinne PVE mit Gegnerfall und ohne eigenen Verlust.", M08: "Gewinne PVE auf drei verschiedenen Brettvorlagen." },
    tips: { M01: "Starte einen Stufenkampf.", M02: "Nutze Tutorial, PVE oder offizielle Rätsel.", M03: "Löse neue offizielle Rätsel.", M04: "Wiederhole Rätsel nach den Goldregeln.", M05: "Spiele weitere Stufenkämpfe.", M06: "Suche Kettenschüsse.", M07: "Schieße kontrolliert und schütze alle Figuren.", M08: "Erkunde weitere Stufen." },
  },
  fr: {
    book: "Livre des médailles", summary: "Maîtrise", personal: "Record personnel", experience: "Expérience", skill: "Technique",
    complete: "Obtenue", locked: "En cours", track: "Suivre l’objectif", tracking: "Suivi", untrack: "Arrêter le suivi",
    details: "Conditions", modes: "Modes éligibles", reward: "Récompense", play: "Jeu conseillé", close: "Fermer",
    rewards: "Récompenses et équipement", badge: "Badge", title: "Titre", frame: "Cadre de profil", banner: "Bannière", none: "Aucun",
    equip: "Équiper", explorer: "Explorateur", challenger: "Challenger", completeFrame: "Cadre Maîtrise accomplie", classicFrame: "Cadre or classique", bannerObjectives: "Objectifs de bannière",
    bannerReward: "Bannière", future: "Droit au set bois — cosmétique prévu pour une sortie future.",
    pending: "Les nouvelles données de maîtrise attendent le stockage serveur et restent protégées dans le cache de ce compte sur cet appareil.",
    malformed: "Les données de maîtrise doivent être restaurées. Les nouvelles sauvegardes sont suspendues pour les protéger.",
    result: "Progression de maîtrise", viewAll: "Tout voir",
    names: { M01: "Première victoire", M02: "Six sensations", M03: "Résolveur", M04: "Solution précise", M05: "Sens du match", M06: "Double sortie", M07: "Tous revenus", M08: "Explorateur de terrain" },
    conditions: { M01: "Gagnez un PVE normal avec une chute ennemie réelle.", M02: "Lancez valablement chacun des six types de pièce.", M03: "Terminez trois puzzles officiels distincts.", M04: "Obtenez l’or sur trois puzzles officiels distincts.", M05: "Gagnez cinq combats PVE normaux.", M06: "Faites tomber deux ennemis durant le règlement d’un tir joueur.", M07: "Gagnez en PVE avec une chute ennemie et aucune perte alliée.", M08: "Gagnez en PVE sur trois plateaux distincts." },
    tips: { M01: "Jouez un combat de niveau.", M02: "Essayez tutoriel, PVE ou puzzles officiels.", M03: "Résolvez de nouveaux puzzles officiels.", M04: "Rejouez selon les règles d’or.", M05: "Continuez les combats de niveau.", M06: "Cherchez les tirs en chaîne.", M07: "Tirez avec précision et protégez vos pièces.", M08: "Avancez pour explorer les terrains." },
  },
  es: {
    book: "Libro de medallas", summary: "Maestría", personal: "Récord personal", experience: "Experiencia", skill: "Técnica",
    complete: "Obtenida", locked: "En progreso", track: "Seguir objetivo", tracking: "Siguiendo", untrack: "Dejar de seguir",
    details: "Condiciones", modes: "Modos válidos", reward: "Recompensa", play: "Juego recomendado", close: "Cerrar",
    rewards: "Recompensas y equipo", badge: "Insignia", title: "Título", frame: "Marco de perfil", banner: "Estandarte", none: "Ninguno",
    equip: "Equipar", explorer: "Explorador", challenger: "Aspirante", completeFrame: "Marco Maestría completa", classicFrame: "Marco de oro clásico", bannerObjectives: "Objetivos de estandarte",
    bannerReward: "Estandarte", future: "Derecho al set de madera — cosmético previsto para el futuro.",
    pending: "Los nuevos datos de maestría esperan guardarse en el servidor y permanecen seguros en la caché de esta cuenta en el dispositivo.",
    malformed: "Los datos de maestría necesitan recuperación. Se han pausado los guardados nuevos para protegerlos.",
    result: "Progreso de maestría", viewAll: "Ver todo",
    names: { M01: "Primera victoria", M02: "Seis sensaciones", M03: "Solucionador", M04: "Solución precisa", M05: "Sentido del combate", M06: "Doble fuera", M07: "Todos volvieron", M08: "Explorador de terreno" },
    conditions: { M01: "Gana un PVE normal con una caída enemiga real.", M02: "Lanza válidamente los seis tipos de pieza.", M03: "Completa tres puzles oficiales distintos.", M04: "Consigue oro en tres puzles oficiales distintos.", M05: "Gana cinco combates PVE normales.", M06: "Haz caer dos enemigos durante el asentamiento de un tiro propio.", M07: "Gana PVE con caída enemiga y sin bajas propias.", M08: "Gana PVE en tres tableros distintos." },
    tips: { M01: "Juega un combate de etapa.", M02: "Prueba tutorial, PVE o puzles oficiales.", M03: "Resuelve nuevos puzles oficiales.", M04: "Repite según las reglas de oro.", M05: "Continúa los combates de etapa.", M06: "Busca tiros en cadena.", M07: "Dispara con control y protege tus piezas.", M08: "Avanza para explorar terrenos." },
  },
  ru: {
    book: "Книга медалей мастерства", summary: "Мастерство", personal: "Личный рекорд", experience: "Опыт", skill: "Навык",
    complete: "Получено", locked: "В процессе", track: "Отслеживать", tracking: "Отслеживается", untrack: "Не отслеживать",
    details: "Условия", modes: "Доступные режимы", reward: "Награда", play: "Рекомендуемая игра", close: "Закрыть",
    rewards: "Награды и снаряжение", badge: "Значок", title: "Титул", frame: "Рамка профиля", banner: "Баннер", none: "Нет",
    equip: "Надеть", explorer: "Исследователь", challenger: "Претендент", completeFrame: "Рамка «Мастерство»", classicFrame: "Классическая золотая рамка", bannerObjectives: "Задачи баннеров",
    bannerReward: "Баннер", future: "Право на набор «Дерево» — косметика выйдет позже.",
    pending: "Новые записи мастерства ожидают сохранения на сервере и безопасно хранятся в кэше этой учётной записи на устройстве.",
    malformed: "Данные мастерства требуют восстановления. Новые сохранения приостановлены для их защиты.",
    result: "Прогресс мастерства", viewAll: "Показать все",
    names: { M01: "Первая победа", M02: "Шесть ощущений", M03: "Решатель задач", M04: "Точное решение", M05: "Чувство матча", M06: "Двойной вылет", M07: "Все вернулись", M08: "Исследователь поля" },
    conditions: { M01: "Победите в обычном PVE с реальным падением врага.", M02: "Успешно запустите каждый из шести типов фигур.", M03: "Завершите три разных официальных пазла.", M04: "Получите золото в трёх разных официальных пазлах.", M05: "Победите в пяти обычных PVE-боях.", M06: "Сбейте двух врагов за одно урегулирование выстрела игрока.", M07: "Победите в PVE со сбитым врагом и без своих потерь.", M08: "Победите в PVE на трёх разных шаблонах поля." },
    tips: { M01: "Играйте этапный бой.", M02: "Попробуйте обучение, PVE или официальные пазлы.", M03: "Решайте новые официальные пазлы.", M04: "Повторите пазл по золотым условиям.", M05: "Продолжайте этапные бои.", M06: "Ищите цепные удары.", M07: "Бейте точно и берегите фигуры.", M08: "Продвигайтесь по новым полям." },
  },
  "pt-BR": {
    book: "Livro de medalhas", summary: "Maestria", personal: "Recorde pessoal", experience: "Experiência", skill: "Técnica",
    complete: "Obtida", locked: "Em progresso", track: "Acompanhar objetivo", tracking: "Acompanhando", untrack: "Parar de acompanhar",
    details: "Condições", modes: "Modos válidos", reward: "Recompensa", play: "Jogo recomendado", close: "Fechar",
    rewards: "Recompensas e equipamento", badge: "Distintivo", title: "Título", frame: "Moldura de perfil", banner: "Banner", none: "Nenhum",
    equip: "Equipar", explorer: "Explorador", challenger: "Desafiante", completeFrame: "Moldura Maestria completa", classicFrame: "Moldura Ouro Clássico", bannerObjectives: "Objetivos de Banner",
    bannerReward: "Banner", future: "Direito ao conjunto amadeirado — cosmético previsto para o futuro.",
    pending: "Novos dados de maestria aguardam o servidor e permanecem seguros no cache desta conta no dispositivo.",
    malformed: "Os dados de maestria precisam de recuperação. Novos salvamentos foram pausados para protegê-los.",
    result: "Progresso de maestria", viewAll: "Ver tudo",
    names: { M01: "Primeira vitória", M02: "Seis sensações", M03: "Solucionador", M04: "Solução precisa", M05: "Sentido da partida", M06: "Saída dupla", M07: "Todos voltaram", M08: "Explorador de terreno" },
    conditions: { M01: "Vença um PVE normal com queda real de inimigo.", M02: "Lance validamente cada um dos seis tipos de peça.", M03: "Conclua três puzzles oficiais distintos.", M04: "Ganhe ouro em três puzzles oficiais distintos.", M05: "Vença cinco batalhas PVE normais.", M06: "Derrube dois inimigos no assentamento de um lançamento seu.", M07: "Vença PVE com queda inimiga e nenhuma perda própria.", M08: "Vença PVE em três modelos de tabuleiro distintos." },
    tips: { M01: "Jogue uma batalha de fase.", M02: "Tente tutorial, PVE ou puzzles oficiais.", M03: "Resolva novos puzzles oficiais.", M04: "Repita seguindo as regras de ouro.", M05: "Continue as batalhas de fase.", M06: "Procure jogadas em cadeia.", M07: "Jogue com precisão e proteja suas peças.", M08: "Avance para explorar terrenos." },
  },
};

export function masteryCopy(lang?: LanguageCode): Copy {
  const language = lang || I18nManager.getLanguage?.() || "en";
  const override = localized[language] ?? {};
  return { ...BASE, names: EN_NAMES, conditions: EN_CONDITIONS, tips: EN_TIPS, ...override } as Copy;
}

function rewardLabel(id: MasteryId): string { return `${masteryCopy().badge} · ${id}`; }
function modeLabel(mode: string): string {
  return I18nManager.t(mode === "stage" ? "lobby.mode_stage_short" : mode === "tutorial" ? "lobby.footer_tutorial" : "lobby.mode_puzzle");
}

export function renderMasteryProfileSummary(storage: MasteryStorage): string {
  const snapshot = loadMasterySnapshot(storage);
  const copy = masteryCopy();
  const count = earnedMedalCount(snapshot.progress);
  const eqTitle = equippedItem(snapshot, "title");
  const title = eqTitle === "title:explorer" ? copy.explorer : eqTitle === "title:challenger" ? copy.challenger : "";
  const badge = equippedItem(snapshot, "badge");
  const frame = equippedItem(snapshot, "frame");
  return `<section class="mastery-profile-summary${frame ? " mastery-frame-equipped" : ""}"><div><strong>${escapeHtml(copy.summary)} ${count}/8</strong>${title ? `<span class="mastery-equipped-title">${escapeHtml(title)}</span>` : ""}${badge ? `<span class="mastery-equipped-badge">${escapeHtml(badge.slice(-3).toUpperCase())}</span>` : ""}</div><button type="button" data-open-mastery>${escapeHtml(copy.book)}</button></section>`;
}

function medalCard(storage: MasteryStorage, id: MasteryId, detailMarkup = ""): string {
  const snapshot = loadMasterySnapshot(storage);
  const copy = masteryCopy();
  const def = MASTERY_DEFINITIONS.find(item => item.id === id)!;
  const value = medalProgress(snapshot.progress, id);
  const earned = isMedalEarned(snapshot.progress, id);
  const tracked = snapshot.preferences.tracked.medalId === id;
  return `<article class="mastery-card${earned ? " is-earned" : ""}" data-mastery-id="${id}"><button type="button" class="mastery-card-main" data-mastery-detail="${id}" aria-expanded="${!!detailMarkup}" aria-label="${escapeHtml(copy.details)}: ${escapeHtml(copy.names[id])}"><span class="mastery-medal-mark">${id}</span><span><small>${escapeHtml(def.category === "experience" ? copy.experience : copy.skill)}</small><strong>${escapeHtml(copy.names[id])}</strong><em>${earned ? escapeHtml(copy.complete) : `${value}/${def.threshold}`}</em></span></button><button type="button" class="mastery-track-btn" data-mastery-track="${id}" aria-pressed="${tracked}">${escapeHtml(tracked ? copy.tracking : copy.track)}</button>${detailMarkup}</article>`;
}

function bannerObjectiveCard(storage: MasteryStorage, bannerId: BannerId, lang: LanguageCode): string {
  const copy = masteryCopy();
  const name = bannerThemeName(bannerId, lang);
  const condition = bannerThemeCondition(bannerId, lang);
  const mode = bannerThemeMode(bannerId, lang);
  const progress = getBannerProgress(storage, bannerId);
  const earned = ownsBanner(storage, bannerId) || progress.earned;
  const imgSrc = bannerImageUrl(bannerId);

  return `
    <article class="mastery-card mastery-banner-card${earned ? " is-earned" : ""}" data-banner-id="${escapeHtml(bannerId)}" style="display:flex; flex-direction:column; gap:8px; background:#0f172a; border:1px solid ${earned ? "#3b82f6" : "#334155"}; border-radius:10px; padding:12px; box-sizing:border-box;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:11px; font-weight:700; color:#38bdf8; background:#1e293b; padding:2px 6px; border-radius:4px; text-transform:uppercase;">${escapeHtml(copy.bannerReward)}</span>
          <strong style="font-size:14px; font-weight:700; color:#f8fafc;">${escapeHtml(name)}</strong>
        </div>
        <em style="font-size:12px; font-style:normal; font-weight:700; color:${earned ? "#4ade80" : "#94a3b8"};">${earned ? escapeHtml(copy.complete) : `${progress.current}/${progress.target}`}</em>
      </div>
      <div style="width:100%; aspect-ratio:3/1; overflow:hidden; border-radius:6px; background:#070a10; ${earned ? "" : "filter:brightness(0.7);"}">
        <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(name)}" loading="lazy" style="width:100%; height:100%; object-fit:cover; display:block;" />
      </div>
      <p style="margin:0; font-size:12px; color:#cbd5e1; line-height:1.4;">${escapeHtml(condition)}</p>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#64748b; margin-top:2px;">
        <span>${escapeHtml(mode)}</span>
      </div>
    </article>
  `;
}

function ownedOptions(storage: MasteryStorage, slot: 'badge' | 'title' | 'frame'): string {
  const snapshot = loadMasterySnapshot(storage);
  const copy = masteryCopy();
  const equipped = equippedItem(snapshot, slot);
  const itemSet = new Set<string>();

  if (slot === "frame") {
    itemSet.add("frame:classic-gold");
  } else if (slot === "title") {
    itemSet.add("title:challenger");
  }

  for (const id of Object.keys(snapshot.rewards.items)) {
    if (id.startsWith(`${slot}:`)) {
      itemSet.add(id);
    }
  }

  if (equipped && equipped.startsWith(`${slot}:`)) {
    itemSet.add(equipped);
  }

  const items = Array.from(itemSet).sort();
  const label = (id: string) => {
    if (id === "title:challenger") return copy.challenger;
    if (id === "title:explorer") return copy.explorer;
    if (id === "frame:classic-gold") return copy.classicFrame;
    if (id === "frame:mastery-complete") return copy.completeFrame;
    if (id.startsWith("badge:")) return `${copy.badge} ${id.slice(-3).toUpperCase()}`;
    return id;
  };
  return `<fieldset><legend>${escapeHtml(copy[slot])}</legend><button type="button" data-equip-slot="${slot}" data-equip-item="" aria-pressed="${equipped === null}">${escapeHtml(copy.none)}</button>${items.map(id => `<button type="button" data-equip-slot="${slot}" data-equip-item="${escapeHtml(id)}" aria-pressed="${equipped === id}">${escapeHtml(label(id))}</button>`).join("")}</fieldset>`;
}

export function openMasteryBook(container: HTMLElement, storage: MasteryStorage, onRoute: (id: MasteryId) => void, onChanged?: () => void): void {
  const existing = document.querySelector<HTMLElement>(".mastery-modal");
  existing?.dispatchEvent(new Event("mastery-request-close"));
  existing?.remove();

  const lang = I18nManager.getLanguage?.() || "en";
  const copy = masteryCopy();
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openerSelector = previousFocus?.id
    ? `#${CSS.escape(previousFocus.id)}`
    : previousFocus?.hasAttribute("data-open-mastery")
      ? "[data-open-mastery]"
      : previousFocus?.hasAttribute("data-mastery-result-all")
        ? "[data-mastery-result-all]"
        : null;

  const modal = document.createElement("section");
  modal.className = "mastery-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "mastery-book-title");
  modal.tabIndex = -1;

  const background = [...container.children].filter((element): element is HTMLElement => element instanceof HTMLElement).map(element => ({ element, inert: element.inert }));
  let detail: MasteryId | null = null;
  let changed = false;
  let closed = false;

  const focusable = () => [...modal.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex='0']")].filter(element => element.getClientRects().length > 0);

  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", trapFocus, true);
    background.forEach(({ element, inert }) => { element.inert = inert; });
    modal.remove();
    if (changed) onChanged?.();
    if (restoreFocus) queueMicrotask(() => {
      const target = previousFocus?.isConnected ? previousFocus : openerSelector ? document.querySelector<HTMLElement>(openerSelector) : null;
      target?.focus();
    });
  };

  modal.addEventListener("mastery-request-close", () => close(false), { once: true });

  const trapFocus = (event: KeyboardEvent) => {
    if (closed) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== "Tab") return;
    event.preventDefault(); event.stopPropagation();
    const items = focusable();
    if (!items.length) { modal.focus(); return; }
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[index < 0 ? (event.shiftKey ? items.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
  };

  const render = (restore?: { kind: "track"; id: MasteryId; detail: boolean } | { kind: "equip"; slot: EquipmentSlot; item: string }) => {
    const scrollTop = modal.querySelector<HTMLElement>(".mastery-dialog")?.scrollTop ?? 0;
    const snapshot = loadMasterySnapshot(storage);
    const count = earnedMedalCount(snapshot.progress);
    const detailDef = detail ? MASTERY_DEFINITIONS.find(item => item.id === detail)! : null;
    const currentLanguage = I18nManager.getLanguage?.() || lang;

    const detailMarkup = detail && detailDef ? `
          <section class="mastery-detail" tabindex="-1" aria-labelledby="mastery-detail-title">
            <h3 id="mastery-detail-title">${escapeHtml(copy.names[detail])}</h3>
            <p>${escapeHtml(copy.conditions[detail])}</p>
            <dl>
              <div><dt>${escapeHtml(copy.modes)}</dt><dd>${detailDef.eligibleModes.map(modeLabel).map(escapeHtml).join(" · ")}</dd></div>
              <div><dt>${escapeHtml(copy.reward)}</dt><dd>${escapeHtml(rewardLabel(detail))}</dd></div>
              <div><dt>${escapeHtml(copy.play)}</dt><dd>${escapeHtml(copy.tips[detail])}</dd></div>
            </dl>
            <div class="mastery-detail-actions">
              <button type="button" data-mastery-route="${detail}">${escapeHtml(copy.play)}</button>
              <button type="button" data-mastery-track="${detail}">${escapeHtml(snapshot.preferences.tracked.medalId === detail ? copy.untrack : copy.track)}</button>
            </div>
          </section>
        ` : "";
    modal.innerHTML = `
      <div class="mastery-dialog">
        <header>
          <div>
            <small>${escapeHtml(copy.personal)}</small>
            <h2 id="mastery-book-title">${escapeHtml(copy.book)}</h2>
            <p>${count}/8</p>
          </div>
          <button type="button" data-mastery-close aria-label="${escapeHtml(copy.close)}">×</button>
        </header>
        ${snapshot.malformed ? `<p class="mastery-state is-error" role="alert">${escapeHtml(copy.malformed)}</p>` : ""}
        ${!snapshot.malformed && ((storage as { masteryPending?: boolean }).masteryPending || (storage as { bannersPending?: boolean }).bannersPending) ? `<p class="mastery-state" role="status">${escapeHtml(copy.pending)}</p>` : ""}

        <!-- 8 메달 도감 그리드 (기존 8종 유지) -->
        <div class="mastery-grid">${MASTERY_IDS.map(id => medalCard(storage, id, id === detail ? detailMarkup : "")).join("")}</div>



        <!-- 신규 3종 배너 업적 섹션 (별도 목표 카드) -->
        <section class="mastery-banner-section" style="display:flex; flex-direction:column; gap:12px; margin-top:16px;">
          <h3 style="margin:0; font-size:16px; font-weight:800; color:#f8fafc;">${escapeHtml(copy.bannerObjectives)}</h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
            ${ACHIEVEMENT_BANNER_IDS.map(id => bannerObjectiveCard(storage, id, currentLanguage)).join("")}
          </div>
        </section>

        <!-- 보상 및 장착 섹션 -->
        <section class="mastery-equipment" style="margin-top:16px;">
          <h3>${escapeHtml(copy.rewards)}</h3>
          <div>
            ${ownedOptions(storage, "badge")}
            ${ownedOptions(storage, "title")}
            ${ownedOptions(storage, "frame")}
          </div>
          ${snapshot.rewards.items["entitlement:woodgrain-set-scheduled"] ? `<p>${escapeHtml(copy.future)}</p>` : ""}
        </section>
      </div>
    `;

    if (snapshot.malformed) {
      for (const button of modal.querySelectorAll<HTMLButtonElement>("[data-mastery-track],[data-equip-slot]")) {
        button.disabled = true;
      }
    }

    modal.querySelector("[data-mastery-close]")?.addEventListener("click", () => close());
    for (const button of modal.querySelectorAll<HTMLButtonElement>("[data-mastery-detail]")) {
      button.onclick = () => {
        const id = button.dataset.masteryDetail as MasteryId;
        detail = detail === id ? null : id;
        render();
        const target = detail ? modal.querySelector<HTMLElement>(".mastery-detail") : modal.querySelector<HTMLElement>(`[data-mastery-detail="${id}"]`);
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: "nearest" });
      };
    }
    for (const button of modal.querySelectorAll<HTMLButtonElement>("[data-mastery-track]")) {
      button.onclick = () => {
        const id = button.dataset.masteryTrack as MasteryId;
        changed = setTrackedMastery(storage, snapshot.preferences.tracked.medalId === id ? null : id) || changed;
        render({ kind: "track", id, detail: button.closest(".mastery-detail") !== null });
      };
    }
    for (const button of modal.querySelectorAll<HTMLButtonElement>("[data-equip-slot]")) {
      button.onclick = () => {
        const slot = button.dataset.equipSlot as EquipmentSlot;
        const item = button.dataset.equipItem ?? "";
        changed = setEquippedMastery(storage, slot, item || null) || changed;
        render({ kind: "equip", slot, item });
      };
    }
    modal.querySelector<HTMLButtonElement>("[data-mastery-route]")?.addEventListener("click", () => {
      const id = detail;
      close(false);
      if (id) onRoute(id);
    });

    if (restore) {
      const target = restore.kind === "track"
        ? [...modal.querySelectorAll<HTMLButtonElement>(restore.detail ? ".mastery-detail [data-mastery-track]" : ".mastery-card [data-mastery-track]")].find(button => button.dataset.masteryTrack === restore.id)
        : [...modal.querySelectorAll<HTMLButtonElement>("[data-equip-slot]")].find(button => button.dataset.equipSlot === restore.slot && (button.dataset.equipItem ?? "") === restore.item);
      target?.focus({ preventScroll: true });
      const dialog = modal.querySelector<HTMLElement>(".mastery-dialog");
      if (dialog) dialog.scrollTop = scrollTop;
    }
  };

  modal.addEventListener("pointerdown", event => { if (event.target === modal) close(); });
  container.append(modal);
  render();
  modal.querySelector<HTMLButtonElement>("[data-mastery-close]")?.focus();
  background.forEach(({ element }) => { element.inert = true; });
  document.addEventListener("keydown", trapFocus, true);
}

export function trackedMasteryText(storage: MasteryStorage): string | null {
  const snapshot = loadMasterySnapshot(storage);
  const id = snapshot.preferences.tracked.medalId;
  if (!id) return null;
  const def = MASTERY_DEFINITIONS.find(item => item.id === id)!;
  return `${id} ${masteryCopy().names[id]} · ${medalProgress(snapshot.progress, id)}/${def.threshold}`;
}

export function appendMasteryResult(container: HTMLElement, items: readonly MasteryProgressItem[], openAll: () => void): void {
  container.querySelector(".mastery-result-progress")?.remove();
  if (!items.length) return;
  const copy = masteryCopy();
  container.hidden = false;
  const section = document.createElement("section");
  section.className = "mastery-result-progress";
  section.innerHTML = `<h3>${escapeHtml(copy.result)}</h3>${items.slice(0, 3).map(item => `<p><strong>${item.medalId} ${escapeHtml(copy.names[item.medalId])}</strong><span>${item.after}/${item.threshold}${item.achieved ? ` · ${escapeHtml(copy.complete)}` : ""}</span></p>`).join("")}<button type="button" data-mastery-result-all>${escapeHtml(copy.viewAll)}</button>`;
  section.querySelector("button")?.addEventListener("click", openAll);
  container.append(section);
}
