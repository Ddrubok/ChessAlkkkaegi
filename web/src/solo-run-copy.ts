import { I18nManager, type LanguageCode } from "./i18n";
import type { CardId, RunCardState } from "./cards";

export type SoloRunTextKey =
  | "loss" | "draw" | "retained" | "retry" | "menu" | "pendingPoints"
  | "shotSummary" | "remainingSummary" | "aiShot" | "playerShot" | "yourLastShot" | "preparing"
  | "prepareFailed" | "prepareRetry" | "choiceCommitted" | "saveFailed"
  | "sessionOnly" | "resume" | "resumeCard" | "settlementPending"
  | "settlementRetry" | "endRun" | "endTitle" | "endDescription"
  | "continueRun" | "confirmEnd" | "newRun" | "conflict"
  | "lockUnavailable" | "invalidSave" | "migrated" | "alreadyEnded"
  | "settled" | "ownedUpgrade";

const COPY: Record<LanguageCode, Record<SoloRunTextKey, string>> = {
  ko: {
    loss: "스테이지 {stage} 패배", draw: "스테이지 {stage} 무승부",
    retained: "스테이지 {stage}와 현재 강화를 유지합니다.", retry: "스테이지 {stage} 다시 도전", menu: "메뉴로",
    pendingPoints: "정산 대기 중인 포인트: {points} P", shotSummary: "이번 샷 장외 · 내 말 {own} / 상대 말 {enemy}", remainingSummary: "남은 말 · 나 {own} / 상대 {enemy}", aiShot: "직전 발사: 상대", playerShot: "직전 발사: 나", yourLastShot: "내 마지막 샷",
    preparing: "다음 스테이지 준비 중…", prepareFailed: "다음 스테이지를 준비하지 못했습니다.", prepareRetry: "다시 준비", choiceCommitted: "강화 선택이 확정되었습니다.", saveFailed: "진행 상태를 저장하지 못했습니다.", sessionOnly: "이 창에서는 계속할 수 있지만, 닫으면 진행을 이어갈 수 없습니다.",
    resume: "스테이지 {stage} 이어하기", resumeCard: "이어하기 · 강화 선택", settlementPending: "포인트 정산 대기 중", settlementRetry: "정산 다시 시도", ownedUpgrade: "보유 강화: {card}",
    endRun: "런 종료", endTitle: "런을 종료할까요?", endDescription: "클리어한 단계까지 {points} P를 정산합니다. 현재 도전의 강화는 새 도전에 이어지지 않습니다.", continueRun: "계속 플레이", confirmEnd: "종료하고 정산", newRun: "새 런 시작",
    conflict: "다른 세션에서 진행 상태가 바뀌었습니다.", lockUnavailable: "진행 상태를 잠글 수 없습니다. 잠시 후 다시 시도하세요.", invalidSave: "저장된 런을 읽을 수 없습니다.", migrated: "이전 런 기록을 현재 형식으로 옮겼습니다.", alreadyEnded: "이 런은 이미 종료되었습니다.", settled: "획득 연구 포인트: {points} P",
  },
  en: {
    loss: "Stage {stage} lost", draw: "Stage {stage} draw", retained: "Stage {stage} and your upgrades are retained.", retry: "Retry Stage {stage}", menu: "Menu",
    pendingPoints: "Points awaiting settlement: {points} P", shotSummary: "Off the board this shot · Yours {own} / Opponent {enemy}", remainingSummary: "Pieces left · You {own} / Opponent {enemy}", aiShot: "Last shot: opponent", playerShot: "Last shot: you", yourLastShot: "Your last shot",
    preparing: "Preparing the next stage…", prepareFailed: "Could not prepare the next stage.", prepareRetry: "Try preparing again", choiceCommitted: "Upgrade choice confirmed.", saveFailed: "Could not save your progress.", sessionOnly: "You can keep playing in this window, but closing it will lose unsaved progress.",
    resume: "Resume Stage {stage}", resumeCard: "Resume · Choose an upgrade", settlementPending: "Point settlement pending", settlementRetry: "Retry settlement", ownedUpgrade: "Your upgrade: {card}",
    endRun: "End run", endTitle: "End this run?", endDescription: "Settle {points} P from cleared stages. This run’s upgrades will not carry into a new run.", continueRun: "Keep playing", confirmEnd: "End and settle", newRun: "Start a new run",
    conflict: "Progress changed in another session.", lockUnavailable: "Could not lock your progress. Try again shortly.", invalidSave: "Could not read the saved run.", migrated: "Your previous run was moved to the current format.", alreadyEnded: "This run has already ended.", settled: "Research points earned: {points} P",
  },
  ja: {
    loss: "ステージ{stage}で敗北", draw: "ステージ{stage}は引き分け", retained: "ステージ{stage}と現在の強化を維持します。", retry: "ステージ{stage}を再挑戦", menu: "メニューへ",
    pendingPoints: "精算待ちのポイント: {points} P", shotSummary: "今回の盤外 · 自分 {own} / 相手 {enemy}", remainingSummary: "残りの駒 · 自分 {own} / 相手 {enemy}", aiShot: "直前の発射：相手", playerShot: "直前の発射：自分", yourLastShot: "自分の最後の一打",
    preparing: "次のステージを準備中…", prepareFailed: "次のステージを準備できませんでした。", prepareRetry: "準備を再試行", choiceCommitted: "強化の選択を確定しました。", saveFailed: "進行状況を保存できませんでした。", sessionOnly: "このウィンドウでは続けられますが、閉じると未保存の進行は失われます。",
    resume: "ステージ{stage}から再開", resumeCard: "再開 · 強化を選択", settlementPending: "ポイントの精算待ち", settlementRetry: "精算を再試行", ownedUpgrade: "所持強化: {card}",
    endRun: "ランを終了", endTitle: "ランを終了しますか？", endDescription: "クリア済みステージの{points} Pを精算します。今回の強化は新しい挑戦に引き継がれません。", continueRun: "プレイを続ける", confirmEnd: "終了して精算", newRun: "新しいランを開始",
    conflict: "別のセッションで進行状況が変更されました。", lockUnavailable: "進行状況をロックできません。少し待ってから再試行してください。", invalidSave: "保存されたランを読み込めません。", migrated: "以前のランを現在の形式に移行しました。", alreadyEnded: "このランはすでに終了しています。", settled: "獲得研究ポイント: {points} P",
  },
  "zh-CN": {
    loss: "第{stage}关失败", draw: "第{stage}关平局", retained: "保留第{stage}关和当前强化。", retry: "重试第{stage}关", menu: "返回菜单",
    pendingPoints: "待结算积分：{points} P", shotSummary: "本次击出棋盘 · 己方 {own} / 对方 {enemy}", remainingSummary: "剩余棋子 · 你 {own} / 对手 {enemy}", aiShot: "上次出手：对手", playerShot: "上次出手：你", yourLastShot: "你的上一次击打",
    preparing: "正在准备下一关…", prepareFailed: "无法准备下一关。", prepareRetry: "重新准备", choiceCommitted: "强化选择已确认。", saveFailed: "无法保存进度。", sessionOnly: "可以在当前窗口继续，但关闭后将丢失未保存的进度。",
    resume: "继续第{stage}关", resumeCard: "继续 · 选择强化", settlementPending: "积分待结算", settlementRetry: "重试结算", ownedUpgrade: "已有强化：{card}",
    endRun: "结束挑战", endTitle: "要结束本次挑战吗？", endDescription: "结算已通关获得的 {points} P。本次挑战的强化不会带入新挑战。", continueRun: "继续游玩", confirmEnd: "结束并结算", newRun: "开始新挑战",
    conflict: "进度已在另一会话中更改。", lockUnavailable: "无法锁定进度。请稍后重试。", invalidSave: "无法读取已保存的挑战。", migrated: "上次挑战已迁移到当前格式。", alreadyEnded: "本次挑战已经结束。", settled: "获得研究积分：{points} P",
  },
  de: {
    loss: "Stufe {stage} verloren", draw: "Stufe {stage} unentschieden", retained: "Stufe {stage} und deine Verbesserungen bleiben erhalten.", retry: "Stufe {stage} wiederholen", menu: "Menü",
    pendingPoints: "Punkte warten auf Abrechnung: {points} P", shotSummary: "In diesem Schuss vom Brett · Eigene {own} / Gegner {enemy}", remainingSummary: "Übrige Figuren · Du {own} / Gegner {enemy}", aiShot: "Letzter Schuss: Gegner", playerShot: "Letzter Schuss: du", yourLastShot: "Dein letzter Schuss",
    preparing: "Nächste Stufe wird vorbereitet…", prepareFailed: "Die nächste Stufe konnte nicht vorbereitet werden.", prepareRetry: "Erneut vorbereiten", choiceCommitted: "Verbesserung bestätigt.", saveFailed: "Fortschritt konnte nicht gespeichert werden.", sessionOnly: "Du kannst in diesem Fenster weiterspielen. Beim Schließen geht ungespeicherter Fortschritt verloren.",
    resume: "Stufe {stage} fortsetzen", resumeCard: "Fortsetzen · Verbesserung wählen", settlementPending: "Punkteabrechnung ausstehend", settlementRetry: "Abrechnung erneut versuchen", ownedUpgrade: "Deine Verbesserung: {card}",
    endRun: "Durchlauf beenden", endTitle: "Diesen Durchlauf beenden?", endDescription: "{points} P für abgeschlossene Stufen abrechnen. Die Verbesserungen dieses Durchlaufs werden nicht übernommen.", continueRun: "Weiterspielen", confirmEnd: "Beenden und abrechnen", newRun: "Neuen Durchlauf starten",
    conflict: "Der Fortschritt wurde in einer anderen Sitzung geändert.", lockUnavailable: "Fortschritt konnte nicht gesperrt werden. Bitte versuche es später erneut.", invalidSave: "Gespeicherter Durchlauf konnte nicht gelesen werden.", migrated: "Dein vorheriger Durchlauf wurde ins aktuelle Format übertragen.", alreadyEnded: "Dieser Durchlauf ist bereits beendet.", settled: "Erhaltene Forschungspunkte: {points} P",
  },
  fr: {
    loss: "Étape {stage} perdue", draw: "Étape {stage} : égalité", retained: "L’étape {stage} et vos améliorations sont conservées.", retry: "Rejouer l’étape {stage}", menu: "Menu",
    pendingPoints: "Points en attente de règlement : {points} P", shotSummary: "Sorties du plateau sur ce tir · Vous {own} / Adversaire {enemy}", remainingSummary: "Pièces restantes · Vous {own} / Adversaire {enemy}", aiShot: "Dernier tir : adversaire", playerShot: "Dernier tir : vous", yourLastShot: "Votre dernier tir",
    preparing: "Préparation de l’étape suivante…", prepareFailed: "Impossible de préparer l’étape suivante.", prepareRetry: "Réessayer la préparation", choiceCommitted: "Amélioration confirmée.", saveFailed: "Impossible d’enregistrer votre progression.", sessionOnly: "Vous pouvez continuer dans cette fenêtre, mais la fermer fera perdre la progression non enregistrée.",
    resume: "Reprendre l’étape {stage}", resumeCard: "Reprendre · Choisir une amélioration", settlementPending: "Règlement des points en attente", settlementRetry: "Réessayer le règlement", ownedUpgrade: "Votre amélioration : {card}",
    endRun: "Terminer la partie", endTitle: "Terminer cette partie ?", endDescription: "Régler {points} P pour les étapes terminées. Les améliorations actuelles ne seront pas conservées dans une nouvelle partie.", continueRun: "Continuer", confirmEnd: "Terminer et régler", newRun: "Commencer une nouvelle partie",
    conflict: "La progression a changé dans une autre session.", lockUnavailable: "Impossible de verrouiller la progression. Réessayez plus tard.", invalidSave: "Impossible de lire la partie enregistrée.", migrated: "Votre ancienne partie a été convertie au format actuel.", alreadyEnded: "Cette partie est déjà terminée.", settled: "Points de recherche gagnés : {points} P",
  },
  es: {
    loss: "Etapa {stage} perdida", draw: "Etapa {stage} empatada", retained: "Se conservan la etapa {stage} y tus mejoras.", retry: "Reintentar etapa {stage}", menu: "Menú",
    pendingPoints: "Puntos pendientes de liquidación: {points} P", shotSummary: "Fuera del tablero en este tiro · Tuyas {own} / Rival {enemy}", remainingSummary: "Piezas restantes · Tú {own} / Rival {enemy}", aiShot: "Último tiro: rival", playerShot: "Último tiro: tú", yourLastShot: "Tu último tiro",
    preparing: "Preparando la siguiente etapa…", prepareFailed: "No se pudo preparar la siguiente etapa.", prepareRetry: "Reintentar preparación", choiceCommitted: "Mejora confirmada.", saveFailed: "No se pudo guardar tu progreso.", sessionOnly: "Puedes seguir en esta ventana, pero al cerrarla perderás el progreso no guardado.",
    resume: "Continuar etapa {stage}", resumeCard: "Continuar · Elegir mejora", settlementPending: "Liquidación de puntos pendiente", settlementRetry: "Reintentar liquidación", ownedUpgrade: "Tu mejora: {card}",
    endRun: "Terminar partida", endTitle: "¿Terminar esta partida?", endDescription: "Liquidar {points} P de etapas completadas. Las mejoras actuales no pasarán a una nueva partida.", continueRun: "Seguir jugando", confirmEnd: "Terminar y liquidar", newRun: "Empezar una partida nueva",
    conflict: "El progreso cambió en otra sesión.", lockUnavailable: "No se pudo bloquear el progreso. Inténtalo de nuevo en breve.", invalidSave: "No se pudo leer la partida guardada.", migrated: "Tu partida anterior se convirtió al formato actual.", alreadyEnded: "Esta partida ya terminó.", settled: "Puntos de investigación obtenidos: {points} P",
  },
  ru: {
    loss: "Этап {stage} проигран", draw: "Ничья на этапе {stage}", retained: "Этап {stage} и ваши улучшения сохранены.", retry: "Повторить этап {stage}", menu: "Меню",
    pendingPoints: "Очки ожидают начисления: {points} P", shotSummary: "Вылетели за этот удар · Ваши {own} / Соперник {enemy}", remainingSummary: "Осталось фигур · Вы {own} / Соперник {enemy}", aiShot: "Последний удар: соперник", playerShot: "Последний удар: вы", yourLastShot: "Ваш последний удар",
    preparing: "Подготовка следующего этапа…", prepareFailed: "Не удалось подготовить следующий этап.", prepareRetry: "Повторить подготовку", choiceCommitted: "Улучшение выбрано.", saveFailed: "Не удалось сохранить прогресс.", sessionOnly: "Можно продолжить в этом окне, но при закрытии несохранённый прогресс будет потерян.",
    resume: "Продолжить этап {stage}", resumeCard: "Продолжить · Выбрать улучшение", settlementPending: "Начисление очков ожидается", settlementRetry: "Повторить начисление", ownedUpgrade: "Ваше улучшение: {card}",
    endRun: "Завершить прохождение", endTitle: "Завершить это прохождение?", endDescription: "Начислить {points} P за пройденные этапы. Улучшения не переносятся в новое прохождение.", continueRun: "Продолжить игру", confirmEnd: "Завершить и начислить", newRun: "Начать новое прохождение",
    conflict: "Прогресс изменился в другой сессии.", lockUnavailable: "Не удалось заблокировать прогресс. Повторите попытку позже.", invalidSave: "Не удалось прочитать сохранённое прохождение.", migrated: "Прошлое прохождение перенесено в текущий формат.", alreadyEnded: "Это прохождение уже завершено.", settled: "Получено очков исследования: {points} P",
  },
  "pt-BR": {
    loss: "Fase {stage} perdida", draw: "Empate na fase {stage}", retained: "A fase {stage} e suas melhorias foram mantidas.", retry: "Tentar a fase {stage} novamente", menu: "Menu",
    pendingPoints: "Pontos aguardando acerto: {points} P", shotSummary: "Fora do tabuleiro nesta jogada · Suas {own} / Adversário {enemy}", remainingSummary: "Peças restantes · Você {own} / Adversário {enemy}", aiShot: "Última jogada: adversário", playerShot: "Última jogada: você", yourLastShot: "Sua última jogada",
    preparing: "Preparando a próxima fase…", prepareFailed: "Não foi possível preparar a próxima fase.", prepareRetry: "Tentar preparar novamente", choiceCommitted: "Melhoria confirmada.", saveFailed: "Não foi possível salvar seu progresso.", sessionOnly: "Você pode continuar nesta janela, mas fechá-la apagará o progresso não salvo.",
    resume: "Continuar fase {stage}", resumeCard: "Continuar · Escolher melhoria", settlementPending: "Acerto de pontos pendente", settlementRetry: "Tentar acerto novamente", ownedUpgrade: "Sua melhoria: {card}",
    endRun: "Encerrar partida", endTitle: "Encerrar esta partida?", endDescription: "Acertar {points} P das fases concluídas. As melhorias atuais não serão mantidas em uma nova partida.", continueRun: "Continuar jogando", confirmEnd: "Encerrar e acertar", newRun: "Iniciar nova partida",
    conflict: "O progresso mudou em outra sessão.", lockUnavailable: "Não foi possível bloquear o progresso. Tente novamente em instantes.", invalidSave: "Não foi possível ler a partida salva.", migrated: "Sua partida anterior foi convertida para o formato atual.", alreadyEnded: "Esta partida já terminou.", settled: "Pontos de pesquisa recebidos: {points} P",
  },
};

export function soloRunText(key: SoloRunTextKey, vars: Partial<Record<"stage" | "points" | "own" | "enemy" | "card", string | number>> = {}): string {
  const language = I18nManager.getLanguage();
  const template = (COPY[language] ?? COPY.en)[key];
  return template.replace(/\{(stage|points|own|enemy|card)\}/g, (match, name: keyof typeof vars) =>
    vars[name] === undefined ? match : String(vars[name]));
}

/** A compact, localized example of an upgrade already applied to this run. */
export function soloRunOwnedUpgrade(cards: Readonly<RunCardState>, latestPick?: CardId | null): string | null {
  const grades = { size: cards.sizeGrade, weight: cards.weightGrade, force: cards.forceGrade };
  const owned = (id: CardId): boolean => id === "giantPawn" || id === "proneStart" ? cards[id] : grades[id] > 0;
  const id = latestPick && owned(latestPick) ? latestPick
    : (["force", "weight", "size", "giantPawn", "proneStart"] as const).find(owned);
  if (!id) return null;
  const name = I18nManager.t(`cards.${id}_name`);
  const card = id === "giantPawn" || id === "proneStart" ? name
    : `${name} ${I18nManager.t("lobby.upgrade_col_level")} ${grades[id]}`;
  return soloRunText("ownedUpgrade", { card });
}
