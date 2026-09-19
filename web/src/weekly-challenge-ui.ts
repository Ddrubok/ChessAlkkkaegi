import { escapeHtml } from "./html";
import { I18nManager, type LanguageCode } from "./i18n";
import type { WeeklyChallengeStorage } from "./weekly-challenge-storage";
import { compareWeeklyScores } from "./weekly-challenge-run";
import type { LocalPracticeDefinition, WeeklyChallengeDefinition, WeeklyChallengeScore } from "./weekly-challenge-model";

interface Copy {
  title: string; summary: string; current: string; previous: string; close: string;
  condition: string; rules: string; cards: string; fallback: string; score: string;
  researchOff: string; boundary: string; practice: string; start: string; resume: string;
  takeover: string; terminate: string; loading: string; record: string; noRecord: string;
  deadline: string; ended: string; hold: string; serverMissing: string;
  actionError: string;
  practiceStatus: string; savedStatus: string; errorStatus: string; blockedStatus: string;
  cardNames: Record<string, string>;
  view: string; entryDetail: string; result: string; resultDetail: string; stages: string; turns: string;
  newBest: string; tiedBest: string; notBest: string; priorBest: string; pendingStatus: string;
}
const EN: Copy = {
  title: "Weekly Challenge", summary: "Challenge", current: "Current", previous: "Previous", close: "Close",
  condition: "W01 · Baseline test", rules: "Clear 10 stages. A defeat or draw ends the attempt; every stage starts from a fresh board.",
  cards: "Fixed card priority", fallback: "Fallback: Force → Weight → Size → Giant Pawn → Prone Start",
  score: "Best: stages first, then fewer turns on cleared stages", researchOff: "Research and rewards are disabled.",
  boundary: "Account recovery is available only before a fresh stage or while choosing a card. In-stage reloads become recovery hold.",
  practice: "Start personal practice", start: "Start account attempt", resume: "Resume at boundary", takeover: "Take over at boundary",
  terminate: "End attempt", loading: "Loading challenge", record: "Personal best", noRecord: "No record yet",
  deadline: "Ends in {time}", ended: "Ended", hold: "This attempt was interrupted mid-stage. End it or continue as personal practice.",
  serverMissing: "Account challenge server is unavailable. Personal practice remains available.",
  actionError: "The challenge action could not be completed. Your saved state was preserved.",
  practiceStatus: "Personal practice", savedStatus: "Saved to account", errorStatus: "Synchronization error", blockedStatus: "Stored data needs recovery", pendingStatus: "Account save pending",
  cardNames: { force: "Force", weight: "Weight", size: "Size", giantPawn: "Giant Pawn", proneStart: "Prone Start" },
  view: "View challenge", entryDetail: "W01 · 10 stages · no rewards", result: "Weekly Challenge record", resultDetail: "Failed-stage turns are excluded. No rewards are issued.", stages: "stages", turns: "turns", newBest: "New personal best", tiedBest: "Tied personal best", notBest: "Personal best unchanged", priorBest: "Previous best",
};
const TRANSLATED: Partial<Record<LanguageCode, Partial<Copy>>> = {
  ko: { title: "주간 도전", summary: "도전", current: "이번 주", previous: "지난 주", close: "닫기", condition: "W01 · 기본 실력 시험", rules: "10개 스테이지를 연속으로 완료하세요. 패배나 무승부면 종료되며 매 스테이지는 새 보드에서 시작합니다.", cards: "고정 카드 우선순위", fallback: "대체 순서: 힘 → 무게 → 크기 → 거대 폰 → 엎드려 시작", score: "최고 기록: 완료 스테이지 우선, 이후 완료한 스테이지의 적은 턴 우선", researchOff: "연구와 보상은 적용되지 않습니다.", boundary: "계정 복구는 새 스테이지 시작 전 또는 카드 선택 중에만 가능합니다. 진행 중 새로고침은 복구 보류가 됩니다.", practice: "개인 연습 시작", start: "계정 도전 시작", resume: "경계에서 이어하기", takeover: "경계에서 가져오기", terminate: "도전 종료", loading: "도전 불러오는 중", record: "개인 최고", noRecord: "아직 기록 없음", deadline: "{time} 후 종료", ended: "종료됨", hold: "스테이지 도중 중단된 도전입니다. 종료하거나 개인 연습으로 계속하세요.", serverMissing: "계정 도전 서버를 사용할 수 없습니다. 개인 연습은 가능합니다.", actionError: "도전 작업을 완료하지 못했습니다. 저장된 상태는 보존했습니다.", practiceStatus: "개인 연습", savedStatus: "계정에 저장됨", errorStatus: "동기화 오류", blockedStatus: "저장 데이터 복구 필요", cardNames: { force: "힘", weight: "무게", size: "크기", giantPawn: "거대 폰", proneStart: "엎드려 시작" }, view: "도전 보기", entryDetail: "W01 · 10 스테이지 · 보상 없음", result: "주간 도전 기록", resultDetail: "실패한 스테이지의 턴은 제외됩니다. 보상은 지급되지 않습니다.", stages: "스테이지", turns: "턴" },
  ja: { title: "ウィークリーチャレンジ", summary: "チャレンジ", current: "今週", previous: "先週", close: "閉じる", condition: "W01 · 基礎力テスト", rules: "10ステージを連続でクリアしてください。敗北または引き分けで終了し、各ステージは新しい盤面から始まります。", cards: "固定カード優先順", fallback: "代替順：力 → 重さ → 大きさ → 巨大ポーン → 伏せて開始", score: "最高記録：クリア数優先、同数ならクリアしたステージの手数が少ない方", researchOff: "研究と報酬は適用されません。", boundary: "アカウントの再開は、新しいステージの開始前またはカード選択中のみ可能です。ステージ中の再読み込みは復旧保留になります。", practice: "個人練習を開始", start: "アカウント挑戦を開始", resume: "境界から再開", takeover: "境界で引き継ぐ", terminate: "挑戦を終了", loading: "読み込み中", record: "自己ベスト", noRecord: "記録なし", deadline: "終了まで {time}", ended: "終了", hold: "ステージ途中で中断されました。終了するか個人練習として続けてください。", serverMissing: "アカウント挑戦サーバーを利用できません。個人練習は利用できます。", actionError: "操作を完了できませんでした。保存済みの状態は保持されています。", practiceStatus: "個人練習", savedStatus: "アカウントに保存済み", errorStatus: "同期エラー", blockedStatus: "保存データの復旧が必要", cardNames: { force: "力", weight: "重さ", size: "大きさ", giantPawn: "巨大ポーン", proneStart: "伏せて開始" }, view: "挑戦を見る", entryDetail: "W01 · 10ステージ · 報酬なし", result: "週間挑戦の記録", resultDetail: "失敗したステージの手数は除外されます。報酬はありません。", stages: "ステージ", turns: "手" },
  "zh-CN": { title: "每周挑战", summary: "挑战", current: "本周", previous: "上周", close: "关闭", condition: "W01 · 基础实力测试", rules: "连续完成10个关卡。失败或平局会结束挑战，每个关卡都从新棋盘开始。", cards: "固定卡牌优先级", fallback: "替补顺序：力量 → 重量 → 大小 → 巨型兵 → 卧倒开局", score: "最佳记录：先比较完成关卡数，再比较已完成关卡所用回合数", researchOff: "研究和奖励均不生效。", boundary: "账户恢复仅可在新关卡开始前或选卡时进行。关卡中刷新会进入恢复暂停。", practice: "开始个人练习", start: "开始账户挑战", resume: "在边界继续", takeover: "在边界接管", terminate: "结束挑战", loading: "正在加载", record: "个人最佳", noRecord: "暂无记录", deadline: "{time} 后结束", ended: "已结束", hold: "挑战在关卡中途被中断。请结束挑战或转为个人练习。", serverMissing: "账户挑战服务器不可用。仍可进行个人练习。", actionError: "操作未能完成。已保存的状态已保留。", practiceStatus: "个人练习", savedStatus: "已保存到账户", errorStatus: "同步错误", blockedStatus: "存储数据需要恢复", cardNames: { force: "力量", weight: "重量", size: "大小", giantPawn: "巨型兵", proneStart: "卧倒开局" }, view: "查看挑战", entryDetail: "W01 · 10关 · 无奖励", result: "每周挑战记录", resultDetail: "失败关卡的回合数不计入。不会发放奖励。", stages: "关卡", turns: "回合" },
  de: { title: "Wöchentliche Herausforderung", summary: "Herausforderung", current: "Aktuell", previous: "Vorwoche", close: "Schließen", condition: "W01 · Grundlagentest", rules: "Schließe 10 Stufen in Folge ab. Niederlage oder Remis beendet den Versuch; jede Stufe beginnt auf einem frischen Brett.", cards: "Feste Kartenpriorität", fallback: "Ersatzfolge: Kraft → Gewicht → Größe → Riesenbauer → Liegend starten", score: "Bestwert: zuerst Stufen, dann weniger Züge in abgeschlossenen Stufen", researchOff: "Forschung und Belohnungen sind deaktiviert.", boundary: "Kontowiederaufnahme ist nur vor einer neuen Stufe oder bei der Kartenwahl möglich. Neuladen während einer Stufe führt zum Wiederherstellungsstopp.", practice: "Persönliches Training", start: "Kontoversuch starten", resume: "An Grenze fortsetzen", takeover: "An Grenze übernehmen", terminate: "Versuch beenden", loading: "Herausforderung wird geladen", record: "Persönlicher Rekord", noRecord: "Noch kein Rekord", deadline: "Endet in {time}", ended: "Beendet", hold: "Der Versuch wurde mitten in einer Stufe unterbrochen. Beende ihn oder spiele als persönliches Training weiter.", serverMissing: "Der Kontoserver ist nicht verfügbar. Persönliches Training bleibt verfügbar.", actionError: "Die Aktion konnte nicht abgeschlossen werden. Der gespeicherte Stand bleibt erhalten.", practiceStatus: "Persönliches Training", savedStatus: "Im Konto gespeichert", errorStatus: "Synchronisierungsfehler", blockedStatus: "Gespeicherte Daten müssen wiederhergestellt werden", cardNames: { force: "Kraft", weight: "Gewicht", size: "Größe", giantPawn: "Riesenbauer", proneStart: "Liegend starten" }, view: "Herausforderung öffnen", entryDetail: "W01 · 10 Stufen · keine Belohnung", result: "Wochenrekord", resultDetail: "Züge der gescheiterten Stufe zählen nicht. Es gibt keine Belohnungen.", stages: "Stufen", turns: "Züge" },
  fr: { title: "Défi hebdomadaire", summary: "Défi", current: "Actuel", previous: "Précédent", close: "Fermer", condition: "W01 · Test de base", rules: "Terminez 10 niveaux à la suite. Une défaite ou un nul met fin à la tentative ; chaque niveau repart d'un plateau neuf.", cards: "Priorité fixe des cartes", fallback: "Ordre de secours : Force → Poids → Taille → Pion géant → Départ couché", score: "Record : niveaux d'abord, puis moins de tours sur les niveaux terminés", researchOff: "La recherche et les récompenses sont désactivées.", boundary: "La reprise du compte n'est possible qu'avant un nouveau niveau ou pendant le choix d'une carte. Recharger en cours de niveau suspend la récupération.", practice: "Entraînement personnel", start: "Commencer la tentative", resume: "Reprendre à la limite", takeover: "Reprendre la tentative", terminate: "Terminer la tentative", loading: "Chargement du défi", record: "Record personnel", noRecord: "Aucun record", deadline: "Fin dans {time}", ended: "Terminé", hold: "Cette tentative a été interrompue en cours de niveau. Terminez-la ou continuez en entraînement personnel.", serverMissing: "Le serveur du défi de compte est indisponible. L'entraînement personnel reste disponible.", actionError: "L'action n'a pas abouti. L'état enregistré a été conservé.", practiceStatus: "Entraînement personnel", savedStatus: "Enregistré sur le compte", errorStatus: "Erreur de synchronisation", blockedStatus: "Les données enregistrées doivent être récupérées", cardNames: { force: "Force", weight: "Poids", size: "Taille", giantPawn: "Pion géant", proneStart: "Départ couché" }, view: "Voir le défi", entryDetail: "W01 · 10 niveaux · sans récompense", result: "Record du défi", resultDetail: "Les tours du niveau échoué sont exclus. Aucune récompense n'est attribuée.", stages: "niveaux", turns: "tours" },
  es: { title: "Desafío semanal", summary: "Desafío", current: "Actual", previous: "Anterior", close: "Cerrar", condition: "W01 · Prueba básica", rules: "Completa 10 etapas seguidas. Una derrota o empate termina el intento; cada etapa comienza con un tablero nuevo.", cards: "Prioridad fija de cartas", fallback: "Orden alternativo: Fuerza → Peso → Tamaño → Peón gigante → Inicio tumbado", score: "Mejor marca: primero etapas y después menos turnos en etapas completadas", researchOff: "La investigación y las recompensas están desactivadas.", boundary: "La recuperación de cuenta solo está disponible antes de una etapa nueva o al elegir carta. Recargar durante una etapa deja el intento en espera de recuperación.", practice: "Práctica personal", start: "Iniciar intento", resume: "Continuar en el límite", takeover: "Tomar control en el límite", terminate: "Terminar intento", loading: "Cargando desafío", record: "Mejor marca", noRecord: "Sin marca", deadline: "Termina en {time}", ended: "Finalizado", hold: "El intento se interrumpió durante una etapa. Termínalo o continúa como práctica personal.", serverMissing: "El servidor del desafío de cuenta no está disponible. La práctica personal sigue disponible.", actionError: "No se pudo completar la acción. El estado guardado se conservó.", practiceStatus: "Práctica personal", savedStatus: "Guardado en la cuenta", errorStatus: "Error de sincronización", blockedStatus: "Los datos guardados necesitan recuperación", cardNames: { force: "Fuerza", weight: "Peso", size: "Tamaño", giantPawn: "Peón gigante", proneStart: "Inicio tumbado" }, view: "Ver desafío", entryDetail: "W01 · 10 etapas · sin recompensas", result: "Marca del desafío", resultDetail: "Se excluyen los turnos de la etapa fallida. No hay recompensas.", stages: "etapas", turns: "turnos" },
  ru: { title: "Еженедельное испытание", summary: "Испытание", current: "Текущее", previous: "Предыдущее", close: "Закрыть", condition: "W01 · Базовая проверка", rules: "Пройдите 10 этапов подряд. Поражение или ничья завершает попытку; каждый этап начинается с новой доски.", cards: "Фиксированный приоритет карт", fallback: "Запасной порядок: Сила → Вес → Размер → Гигантская пешка → Старт лёжа", score: "Рекорд: сначала этапы, затем меньше ходов на пройденных этапах", researchOff: "Исследования и награды отключены.", boundary: "Возобновление доступно только перед новым этапом или при выборе карты. Перезагрузка в ходе этапа переводит попытку в ожидание восстановления.", practice: "Личная тренировка", start: "Начать попытку", resume: "Продолжить на границе", takeover: "Перехватить на границе", terminate: "Завершить попытку", loading: "Загрузка испытания", record: "Личный рекорд", noRecord: "Рекорда нет", deadline: "До конца {time}", ended: "Завершено", hold: "Попытка прервана в ходе этапа. Завершите её или продолжите как личную тренировку.", serverMissing: "Сервер испытания недоступен. Личная тренировка остаётся доступной.", actionError: "Действие не выполнено. Сохранённое состояние не потеряно.", practiceStatus: "Личная тренировка", savedStatus: "Сохранено в аккаунте", errorStatus: "Ошибка синхронизации", blockedStatus: "Сохранённые данные требуют восстановления", cardNames: { force: "Сила", weight: "Вес", size: "Размер", giantPawn: "Гигантская пешка", proneStart: "Старт лёжа" }, view: "Открыть испытание", entryDetail: "W01 · 10 этапов · без наград", result: "Рекорд испытания", resultDetail: "Ходы проваленного этапа не учитываются. Наград нет.", stages: "этапов", turns: "ходов" },
  "pt-BR": { title: "Desafio semanal", summary: "Desafio", current: "Atual", previous: "Anterior", close: "Fechar", condition: "W01 · Teste básico", rules: "Conclua 10 fases seguidas. Derrota ou empate encerra a tentativa; cada fase começa em um tabuleiro novo.", cards: "Prioridade fixa de cartas", fallback: "Ordem alternativa: Força → Peso → Tamanho → Peão gigante → Início deitado", score: "Recorde: primeiro fases, depois menos turnos nas fases concluídas", researchOff: "Pesquisa e recompensas estão desativadas.", boundary: "A retomada da conta só é possível antes de uma nova fase ou na escolha de carta. Recarregar durante a fase deixa a tentativa aguardando recuperação.", practice: "Prática pessoal", start: "Iniciar tentativa", resume: "Continuar no limite", takeover: "Assumir no limite", terminate: "Encerrar tentativa", loading: "Carregando desafio", record: "Recorde pessoal", noRecord: "Sem recorde", deadline: "Termina em {time}", ended: "Encerrado", hold: "A tentativa foi interrompida durante uma fase. Encerre-a ou continue como prática pessoal.", serverMissing: "O servidor do desafio de conta está indisponível. A prática pessoal continua disponível.", actionError: "A ação não foi concluída. O estado salvo foi preservado.", practiceStatus: "Prática pessoal", savedStatus: "Salvo na conta", errorStatus: "Erro de sincronização", blockedStatus: "Os dados salvos precisam de recuperação", cardNames: { force: "Força", weight: "Peso", size: "Tamanho", giantPawn: "Peão gigante", proneStart: "Início deitado" }, view: "Ver desafio", entryDetail: "W01 · 10 fases · sem recompensas", result: "Recorde do desafio", resultDetail: "Os turnos da fase perdida são excluídos. Não há recompensas.", stages: "fases", turns: "turnos" },
};
const RESULT_STATUS: Partial<Record<LanguageCode, Pick<Copy, "newBest" | "tiedBest" | "notBest" | "priorBest">>> = {
  ko: { newBest: "새 개인 최고", tiedBest: "개인 최고와 동률", notBest: "개인 최고 유지", priorBest: "이전 최고" },
  ja: { newBest: "自己ベスト更新", tiedBest: "自己ベストと同点", notBest: "自己ベスト維持", priorBest: "以前のベスト" },
  "zh-CN": { newBest: "新的个人最佳", tiedBest: "追平个人最佳", notBest: "个人最佳未变", priorBest: "此前最佳" },
  de: { newBest: "Neue persönliche Bestleistung", tiedBest: "Persönliche Bestleistung eingestellt", notBest: "Bestleistung unverändert", priorBest: "Bisherige Bestleistung" },
  fr: { newBest: "Nouveau record personnel", tiedBest: "Record personnel égalé", notBest: "Record personnel inchangé", priorBest: "Record précédent" },
  es: { newBest: "Nueva mejor marca", tiedBest: "Mejor marca igualada", notBest: "Mejor marca sin cambios", priorBest: "Mejor marca anterior" },
  ru: { newBest: "Новый личный рекорд", tiedBest: "Личный рекорд повторён", notBest: "Личный рекорд без изменений", priorBest: "Предыдущий рекорд" },
  "pt-BR": { newBest: "Novo recorde pessoal", tiedBest: "Recorde pessoal igualado", notBest: "Recorde pessoal mantido", priorBest: "Recorde anterior" },
};
const RESULT_PENDING_STATUS: Partial<Record<LanguageCode, string>> = {
  ko: "계정 저장 대기 중",
  ja: "アカウントへの保存を待機中",
  "zh-CN": "正在等待保存到账户",
  de: "Kontospeicherung ausstehend",
  fr: "Enregistrement du compte en attente",
  es: "Guardado en la cuenta pendiente",
  ru: "Ожидается сохранение в аккаунте",
  "pt-BR": "Aguardando salvamento na conta",
};
export function weeklyChallengeCopy(): Copy { const language = I18nManager.getLanguage(), local = TRANSLATED[language] ?? {}, result = RESULT_STATUS[language] ?? {}; return { ...EN, ...local, ...result, pendingStatus: RESULT_PENDING_STATUS[language] ?? EN.pendingStatus, cardNames: { ...EN.cardNames, ...(local.cardNames ?? {}) } }; }
function countdown(endsAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 1000));
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600), m = Math.floor(seconds % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
export function renderWeeklyChallengeSummary(storage: WeeklyChallengeStorage): string {
  const c = weeklyChallengeCopy(), view = storage.view();
  const definition = view.snapshot?.currentWeek ?? view.localDefinitions[0] ?? view.practice?.definition;
  const identity = definition ? ("weekId" in definition ? definition.weekId : definition.localPracticeId) : null;
  const hash = definition ? ("definitionHash" in definition ? definition.definitionHash : definition.localDefinitionHash) : null;
  const accountRecord = view.snapshot?.records.current ?? null;
  const localRecord = identity && hash ? view.localRecords.find((item) => item.identity === identity && item.definitionHash === hash) : null;
  const values = [accountRecord ? `${accountRecord.completedStages}/10 · ${accountRecord.completedStageOwnTurns} · ${c.savedStatus}` : null, localRecord ? `${localRecord.completedStages}/10 · ${localRecord.completedStageOwnTurns} · ${c.practiceStatus}` : null].filter((value): value is string => value !== null);
  return `<section class="weekly-profile-summary"><div><strong>${escapeHtml(c.summary)}</strong><span>${values.length ? values.map(escapeHtml).join(" / ") : escapeHtml(c.noRecord)}</span></div><button type="button" data-open-weekly-challenge>${escapeHtml(c.title)}</button></section>`;
}
export interface WeeklyChallengeUiActions {
  practice: (definition: WeeklyChallengeDefinition | LocalPracticeDefinition) => Promise<void>; start: () => Promise<void>; resume: () => Promise<void>;
  takeover: () => Promise<void>; terminate: () => Promise<void>;
}
let activeClose: (() => void) | null = null;
export function openWeeklyChallenge(storage: WeeklyChallengeStorage, actions: WeeklyChallengeUiActions): void {
  activeClose?.();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const openedOwner = storage.owner, modal = document.createElement("section");
  modal.className = "weekly-modal"; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-labelledby", "weekly-title");
  let tab: "current" | "previous" = "current", closed = false, unsubscribe = () => {}, timer: number | null = null, actionFailed = false, actionPending = false, boundaryRefreshAttempted = "";
  const background = [...document.body.children] as HTMLElement[], inert = background.map((node) => node.inert);
  const priorHtmlOverflowX = document.documentElement.style.overflowX, priorBodyOverflowX = document.body.style.overflowX;
  const hadOpenClass = document.body.classList.contains("weekly-modal-open");
  const scrollX = window.scrollX, scrollY = window.scrollY;
  background.forEach((node) => { node.inert = true; });
  document.documentElement.style.overflowX = "hidden"; document.body.style.overflowX = "hidden"; document.body.classList.add("weekly-modal-open");
  const close = () => { if (closed) return; closed = true; unsubscribe(); if (timer !== null) clearInterval(timer); modal.remove(); document.documentElement.style.overflowX = priorHtmlOverflowX; document.body.style.overflowX = priorBodyOverflowX; if (!hadOpenClass) document.body.classList.remove("weekly-modal-open"); window.scrollTo(scrollX, scrollY); background.forEach((node, index) => { node.inert = inert[index]; }); if (activeClose === close) activeClose = null; (opener?.isConnected ? opener : document.querySelector<HTMLElement>("[data-open-weekly-challenge]"))?.focus(); };
  const render = (preserve = false) => {
    const view = storage.view(), c = weeklyChallengeCopy(); if (view.owner !== openedOwner || !view.ready) { close(); return; }
    const scrollTop = preserve ? modal.querySelector<HTMLElement>('.weekly-dialog')?.scrollTop ?? 0 : 0;
    const focused = preserve && document.activeElement instanceof HTMLElement && modal.contains(document.activeElement) ? document.activeElement.dataset.weeklyAction ?? document.activeElement.dataset.weeklyTab ?? null : null;
    const definition = tab === "current" ? (view.snapshot?.currentWeek ?? view.localDefinitions[0] ?? view.practice?.definition) : (view.snapshot?.previousWeek ?? view.localDefinitions[1]);
    const record = tab === "current" ? view.snapshot?.records.current : view.snapshot?.records.previous;
    const definitionIdentity = definition ? ("weekId" in definition ? definition.weekId : definition.localPracticeId) : null;
    const definitionHash = definition ? ("definitionHash" in definition ? definition.definitionHash : definition.localDefinitionHash) : null;
    const localRecord = definitionIdentity && definitionHash ? view.localRecords.find((item) => item.identity === definitionIdentity && item.definitionHash === definitionHash) : view.localRecords[tab === "current" ? 0 : 1];
    const scoreText = [record ? `${record.completedStages}/10 · ${record.completedStageOwnTurns} · ${c.savedStatus}` : null, localRecord ? `${localRecord.completedStages}/10 · ${localRecord.completedStageOwnTurns} · ${c.practiceStatus}` : null].filter((value): value is string => value !== null).join(" / ");
    const storedAttempt = view.snapshot?.activeAttempt;
    const attempt = storedAttempt && !["finished", "terminated", "expired"].includes(storedAttempt.status) ? storedAttempt : null;
    const attemptIsCurrent = !!attempt && attempt.weekId === view.snapshot?.currentWeek.weekId && attempt.definitionHash === view.snapshot.currentWeek.definitionHash;
    const disabled = actionPending || !definition ? " disabled" : "";
    let actionHtml = `<button type="button" data-weekly-action="practice"${disabled}>${escapeHtml(c.practice)}</button>`;
    if (tab === "current" && view.owner && view.syncState === "synced") {
      if (!attempt) actionHtml += `<button type="button" data-weekly-action="start"${disabled}>${escapeHtml(c.start)}</button>`;
      else if (view.recoveryHold || !attemptIsCurrent) actionHtml += `<button type="button" data-weekly-action="terminate"${disabled}>${escapeHtml(c.terminate)}</button>`;
      else if (attempt.ownerSessionId === view.sessionId) actionHtml += `<button type="button" data-weekly-action="resume"${disabled}>${escapeHtml(c.resume)}</button>`;
      else actionHtml += `<button type="button" data-weekly-action="takeover"${disabled}>${escapeHtml(c.takeover)}</button><button type="button" data-weekly-action="terminate"${disabled}>${escapeHtml(c.terminate)}</button>`;
    }
    const status = actionFailed ? c.actionError : view.recoveryHold ? c.hold : ["missing-server", "offline"].includes(view.syncState) ? c.serverMissing : view.syncState === "practice" ? c.practiceStatus : view.syncState === "synced" ? c.savedStatus : view.syncState === "blocked" ? c.blockedStatus : view.syncState === "error" ? c.errorStatus : c.loading;
    const slots = definition?.prioritySlots ?? [["force", "weight", "size"], ["weight", "size", "giantPawn"], ["force", "size", "proneStart"], ["force", "weight", "size"], ["force", "size", "giantPawn"], ["weight", "force", "proneStart"], ["force", "weight", "size"], ["force", "size", "giantPawn"], ["weight", "size", "proneStart"]];
    const cardRows = slots.map((slot) => `<li>${slot.map((id) => c.cardNames[String(id)] ?? String(id)).map(escapeHtml).join(" · ")}</li>`).join("");
    const endsAt = definition ? ("endsAt" in definition ? definition.endsAt : definition.localEndsAt) : null;
    const now = storage.estimatedNow();
    const deadline = endsAt ? Date.parse(endsAt) <= now ? c.ended : c.deadline.replace("{time}", countdown(endsAt, now)) : c.loading;
    modal.innerHTML = `<div class="weekly-dialog"><header><div><p>${escapeHtml(c.summary)}</p><h2 id="weekly-title" tabindex="-1">${escapeHtml(c.title)}</h2></div><button type="button" data-weekly-action="close" aria-label="${escapeHtml(c.close)}">×</button></header><div class="weekly-tabs" role="tablist"><button id="weekly-tab-current" type="button" role="tab" data-weekly-tab="current" aria-controls="weekly-panel" aria-selected="${tab === "current"}" tabindex="${tab === "current" ? 0 : -1}">${escapeHtml(c.current)}</button><button id="weekly-tab-previous" type="button" role="tab" data-weekly-tab="previous" aria-controls="weekly-panel" aria-selected="${tab === "previous"}" tabindex="${tab === "previous" ? 0 : -1}">${escapeHtml(c.previous)}</button></div><div id="weekly-panel" role="tabpanel" aria-labelledby="weekly-tab-${tab}"><section class="weekly-hero"><span>${escapeHtml(c.condition)}</span><strong>${escapeHtml(deadline)}</strong></section><p>${escapeHtml(c.rules)}</p><div class="weekly-rules"><article><h3>${escapeHtml(c.cards)}</h3><ol>${cardRows}</ol><p>${escapeHtml(c.fallback)}</p></article><article><h3>${escapeHtml(c.score)}</h3><p>${escapeHtml(c.researchOff)}</p><p>${escapeHtml(c.boundary)}</p></article></div><section class="weekly-record"><strong>${escapeHtml(c.record)}</strong><span>${scoreText ? escapeHtml(scoreText) : escapeHtml(c.noRecord)}</span></section><p class="weekly-status" role="status">${escapeHtml(status)}</p><div class="weekly-actions">${actionHtml}</div></div></div>`;
    if (focused) modal.querySelector<HTMLElement>(`[data-weekly-action="${CSS.escape(focused)}"],[data-weekly-tab="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    const dialog = modal.querySelector<HTMLElement>('.weekly-dialog');
    if (dialog) dialog.scrollTop = scrollTop;
  };
  activeClose = close; unsubscribe = storage.subscribe(() => render(true)); document.body.append(modal); render(); if (closed) return;
  modal.querySelector<HTMLElement>("#weekly-title")?.focus(); timer = window.setInterval(() => {
    const view = storage.view(), identity = view.snapshot?.currentWeek.weekId ?? view.localDefinitions[0]?.localPracticeId ?? "";
    const endsAt = view.snapshot?.currentWeek.endsAt ?? view.localDefinitions[0]?.localEndsAt;
    if (endsAt && storage.estimatedNow() >= Date.parse(endsAt) && boundaryRefreshAttempted !== identity) { boundaryRefreshAttempted = identity; void storage.refreshAtBoundary().finally(() => { if (!closed) render(true); }); }
    else render(true);
  }, 30_000);
  modal.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
    if (!button) return;
    const nextTab = button.dataset.weeklyTab;
    if (nextTab === "current" || nextTab === "previous") { tab = nextTab; render(); modal.querySelector<HTMLElement>(`[data-weekly-tab="${tab}"]`)?.focus(); return; }
    const action = button.dataset.weeklyAction as keyof WeeklyChallengeUiActions | "close" | undefined;
    if (action === "close") { close(); return; }
    if (!action || !(action in actions) || actionPending) return;
    const view = storage.view();
    const definition = tab === "current" ? (view.snapshot?.currentWeek ?? view.localDefinitions[0] ?? view.practice?.definition) : (view.snapshot?.previousWeek ?? view.localDefinitions[1]);
    if (action === "practice" && !definition) return;
    actionFailed = false; actionPending = true; render(true);
    const promise = action === "practice" ? actions.practice(definition!) : actions[action]();
    void promise.then(() => { if (action !== "terminate") close(); else { actionPending = false; render(true); } }).catch(() => { actionPending = false; actionFailed = true; if (!closed) render(true); });
  });
  modal.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); return; } if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && document.activeElement instanceof HTMLElement && document.activeElement.dataset.weeklyTab) { event.preventDefault(); tab = event.key === "ArrowLeft" || event.key === "Home" ? "current" : "previous"; render(); modal.querySelector<HTMLElement>(`[data-weekly-tab="${tab}"]`)?.focus(); return; } if (event.key !== "Tab") return; const items = [...modal.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex="0"]')]; if (!items.length) return; const current = items.indexOf(document.activeElement as HTMLElement), next = event.shiftKey ? (current <= 0 ? items.length - 1 : current - 1) : (current < 0 || current === items.length - 1 ? 0 : current + 1); event.preventDefault(); items[next].focus(); });
}

export function appendWeeklyChallengeResult(container: HTMLElement, scoreValue: WeeklyChallengeScore, prior: WeeklyChallengeScore | null, source: "account" | "practice" | "pending"): void {
  const c = weeklyChallengeCopy();
  const section = document.createElement("section"); section.className = "weekly-result";
  const title = document.createElement("strong"), score = document.createElement("span"), detail = document.createElement("small");
  const comparison = prior ? compareWeeklyScores(scoreValue, prior) : scoreValue.completedStages > 0 ? 1 : 0;
  title.textContent = c.result; score.textContent = `${scoreValue.completedStages}/10 ${c.stages} · ${scoreValue.completedStageOwnTurns} ${c.turns}`;
  const priorText = prior ? ` · ${c.priorBest}: ${prior.completedStages}/10 · ${prior.completedStageOwnTurns}` : "";
  if (source === "pending") detail.textContent = `${c.pendingStatus}${priorText}. ${c.resultDetail}`;
  else {
    const status = comparison > 0 ? c.newBest : prior && comparison === 0 ? c.tiedBest : prior ? c.notBest : c.noRecord;
    detail.textContent = `${source === "account" ? c.savedStatus : c.practiceStatus} · ${status}${priorText}. ${c.resultDetail}`;
  }
  section.append(title, score, detail); container.querySelector(".weekly-result")?.remove(); container.append(section); container.hidden = false;
  container.closest(".match-result-overlay")?.classList.add("weekly-result-open");
}

export function appendWeeklyRecoveryControls(container: HTMLElement, onRetry: () => Promise<void>, onPractice: () => Promise<void>, onTerminate: () => Promise<void>): void {
  const c = weeklyChallengeCopy(), controls = document.createElement("section"); controls.className = "weekly-recovery";
  const status = document.createElement("p"); status.textContent = c.actionError; status.setAttribute("role", "status");
  const actions = document.createElement("div");
  for (const [label, callback] of [[I18nManager.t("tier.retry"), onRetry], [c.practice, onPractice], [c.terminate, onTerminate]] as const) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = label;
    button.addEventListener("click", () => { for (const item of actions.querySelectorAll("button")) item.disabled = true; void callback().catch(() => { status.textContent = c.actionError; for (const item of actions.querySelectorAll("button")) item.disabled = false; }); });
    actions.append(button);
  }
  controls.append(status, actions); container.append(controls); container.hidden = false; actions.querySelector("button")?.focus();
}
