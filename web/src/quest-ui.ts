import { progressUiCopy } from "./progress-ui-copy";
import { createPanelMotion } from './ui-motion';
import { notifyResultProgress } from './result-motion';
import { formatProgressDuration } from "./progress-duration";
import { summarizeQuestTargets } from "./quest-target-summary";
import { puzzleText } from "./puzzle-text";
import { escapeHtml } from "./html";
import { I18nManager, type LanguageCode } from "./i18n";
import { eventSupportsMetric, questDefinitionsFor } from "./quest-definitions";
import { questProgressCount } from "./quest-evaluator";
import type { QuestCadence, QuestProgress } from "./quest-model";
import type { QuestStorage, QuestStorageView } from "./quest-storage";

interface Copy {
  title: string; summary: string; daily: string; weekly: string; close: string; viewAll: string; result: string;
  eligible: string; routes: string; stage: string; online: string; puzzle: string; tutorial: string; resets: string;
  sync: Record<string, string>; names: Record<string, string>; states: Record<"active" | "completed" | "expired" | "awaiting" | "stale", string>;
}
const EN: Copy = {
  title: "Daily & Weekly Quests", summary: "Quests", daily: "Daily", weekly: "Weekly", close: "Close", viewAll: "View All", result: "Quest progress",
  eligible: "Eligible modes", routes: "Recommended play", stage: "Stage Battle", online: "Online PVP", puzzle: "Official Puzzles", tutorial: "Tutorial", resets: "Resets in {time}",
  sync: { synced: "Saved to server", guest: "Saved on this device", pending: "Waiting to sync", offline: "Server unavailable — progress is stored for this account on this device", missing_server: "Quest server update pending — progress is stored for this account on this device", auth_error: "Sign-in verification failed. Retry after signing in again.", data_error: "Quest data needs recovery. New writes are paused to preserve it.", storage_error: "This device could not safely store more quest data.", loading: "Loading quests" },
  names: { "daily-wins": "Win 2 PVE or PVP matches", "daily-puzzle-clears": "Clear 1 official puzzle", "daily-piece-types": "Launch 2 different piece types", "weekly-wins": "Win 10 PVE or PVP matches", "weekly-puzzle-clears": "Clear 5 official puzzles", "weekly-distinct-puzzles": "Clear 3 different official puzzles", "weekly-piece-types": "Launch all 6 piece types", "weekly-distinct-gold-puzzles": "Earn gold on 3 different puzzles" },
  states: { active: "In progress", completed: "Completed", expired: "Expired", awaiting: "Awaiting sync", stale: "Closed-period event retained" },
};
const COPY: Partial<Record<LanguageCode, Partial<Copy>>> = {
  ko: { title: "일일 · 주간 퀘스트", summary: "퀘스트", daily: "일일", weekly: "주간", close: "닫기", viewAll: "전체 보기", result: "퀘스트 진척", eligible: "인정 모드", routes: "추천 플레이", stage: "스테이지 대전", online: "온라인 PVP", puzzle: "공식 퍼즐", tutorial: "튜토리얼", resets: "{time} 후 초기화", names: { "daily-wins": "PVE 또는 PVP 2승", "daily-puzzle-clears": "공식 퍼즐 1회 완료", "daily-piece-types": "서로 다른 기물 2종 발사", "weekly-wins": "PVE 또는 PVP 10승", "weekly-puzzle-clears": "공식 퍼즐 5회 완료", "weekly-distinct-puzzles": "서로 다른 공식 퍼즐 3개 완료", "weekly-piece-types": "기물 6종 모두 발사", "weekly-distinct-gold-puzzles": "서로 다른 퍼즐 3개 금메달" } },
  ja: { title: "デイリー・ウィークリークエスト", summary: "クエスト", daily: "デイリー", weekly: "ウィークリー", close: "閉じる", viewAll: "すべて表示", result: "クエスト進捗", eligible: "対象モード", routes: "おすすめ", stage: "ステージ対戦", online: "オンラインPVP", puzzle: "公式パズル", tutorial: "チュートリアル", resets: "{time}後にリセット" },
  "zh-CN": { title: "每日与每周任务", summary: "任务", daily: "每日", weekly: "每周", close: "关闭", viewAll: "查看全部", result: "任务进度", eligible: "适用模式", routes: "推荐玩法", stage: "关卡对战", online: "在线PVP", puzzle: "官方谜题", tutorial: "教程", resets: "{time} 后重置" },
  de: { title: "Tägliche & wöchentliche Aufgaben", summary: "Aufgaben", daily: "Täglich", weekly: "Wöchentlich", close: "Schließen", viewAll: "Alle anzeigen", result: "Aufgabenfortschritt", eligible: "Gültige Modi", routes: "Empfohlen", stage: "Stufenkampf", online: "Online-PVP", puzzle: "Offizielle Rätsel", tutorial: "Tutorial", resets: "Zurücksetzung in {time}" },
  fr: { title: "Quêtes quotidiennes et hebdomadaires", summary: "Quêtes", daily: "Quotidien", weekly: "Hebdomadaire", close: "Fermer", viewAll: "Tout voir", result: "Progression des quêtes", eligible: "Modes éligibles", routes: "Jeu conseillé", stage: "Combat de niveau", online: "PVP en ligne", puzzle: "Puzzles officiels", tutorial: "Tutoriel", resets: "Réinitialisation dans {time}" },
  es: { title: "Misiones diarias y semanales", summary: "Misiones", daily: "Diarias", weekly: "Semanales", close: "Cerrar", viewAll: "Ver todo", result: "Progreso de misiones", eligible: "Modos válidos", routes: "Juego recomendado", stage: "Batalla de etapa", online: "PVP en línea", puzzle: "Puzles oficiales", tutorial: "Tutorial", resets: "Se reinicia en {time}" },
  ru: { title: "Ежедневные и еженедельные задания", summary: "Задания", daily: "Ежедневно", weekly: "Еженедельно", close: "Закрыть", viewAll: "Показать все", result: "Прогресс заданий", eligible: "Доступные режимы", routes: "Рекомендуется", stage: "Бой этапа", online: "Сетевой PVP", puzzle: "Официальные головоломки", tutorial: "Обучение", resets: "Сброс через {time}" },
  "pt-BR": { title: "Missões diárias e semanais", summary: "Missões", daily: "Diárias", weekly: "Semanais", close: "Fechar", viewAll: "Ver tudo", result: "Progresso das missões", eligible: "Modos válidos", routes: "Jogo recomendado", stage: "Batalha de fase", online: "PVP online", puzzle: "Puzzles oficiais", tutorial: "Tutorial", resets: "Reinicia em {time}" },
};
const NAME_IDS = Object.keys(EN.names);
const NAME_ROWS: Partial<Record<LanguageCode, readonly string[]>> = {
  ja: ["PVEまたはPVPで2勝", "公式パズルを1回クリア", "異なる2種類の駒を発射", "PVEまたはPVPで10勝", "公式パズルを5回クリア", "異なる公式パズルを3個クリア", "6種類すべての駒を発射", "異なる3個のパズルでゴールド"],
  "zh-CN": ["赢得2场PVE或PVP", "完成1次官方谜题", "发射2种不同棋子", "赢得10场PVE或PVP", "完成5次官方谜题", "完成3个不同官方谜题", "发射全部6种棋子", "在3个不同谜题获得金牌"],
  de: ["2 PVE- oder PVP-Siege", "1 offizielles Rätsel lösen", "2 verschiedene Figuren starten", "10 PVE- oder PVP-Siege", "5 offizielle Rätsel lösen", "3 verschiedene offizielle Rätsel lösen", "Alle 6 Figurenarten starten", "Gold in 3 verschiedenen Rätseln"],
  fr: ["Gagner 2 matchs PVE ou PVP", "Terminer 1 puzzle officiel", "Lancer 2 types de pièce", "Gagner 10 matchs PVE ou PVP", "Terminer 5 puzzles officiels", "Terminer 3 puzzles officiels distincts", "Lancer les 6 types de pièce", "Or sur 3 puzzles distincts"],
  es: ["Gana 2 partidas PVE o PVP", "Completa 1 puzle oficial", "Lanza 2 tipos de pieza", "Gana 10 partidas PVE o PVP", "Completa 5 puzles oficiales", "Completa 3 puzles oficiales distintos", "Lanza los 6 tipos de pieza", "Oro en 3 puzles distintos"],
  ru: ["Победить 2 раза в PVE или PVP", "Решить 1 официальную головоломку", "Запустить 2 разных типа фигур", "Победить 10 раз в PVE или PVP", "Решить 5 официальных головоломок", "Решить 3 разные официальные головоломки", "Запустить все 6 типов фигур", "Получить золото в 3 разных головоломках"],
  "pt-BR": ["Vença 2 partidas PVE ou PVP", "Conclua 1 puzzle oficial", "Lance 2 tipos de peça", "Vença 10 partidas PVE ou PVP", "Conclua 5 puzzles oficiais", "Conclua 3 puzzles oficiais diferentes", "Lance os 6 tipos de peça", "Ganhe ouro em 3 puzzles diferentes"],
};
const SYNC_KEYS = Object.keys(EN.sync);
const SYNC_ROWS: Partial<Record<LanguageCode, readonly string[]>> = {
  ko: ["서버에 저장됨", "이 기기에 저장됨", "동기화 대기 중", "서버에 연결할 수 없어 이 계정의 진행도를 기기에 보관합니다.", "퀘스트 서버 업데이트 대기 중이며 이 계정의 진행도를 기기에 보관합니다.", "로그인 확인에 실패했습니다. 다시 로그인한 뒤 재시도하세요.", "퀘스트 데이터 복구가 필요해 원본 보존을 위해 새 저장을 멈췄습니다.", "이 기기에 퀘스트 데이터를 안전하게 더 저장할 수 없습니다.", "퀘스트 불러오는 중"],
  ja: ["サーバーに保存済み", "この端末に保存済み", "同期を待機中", "サーバーを利用できないため、このアカウントの進捗を端末に保存します。", "クエストサーバーの更新待ちです。進捗は端末に保存されます。", "ログイン確認に失敗しました。再ログイン後に再試行してください。", "クエストデータの復旧が必要です。保護のため新規保存を停止しました。", "この端末にクエストデータを安全に保存できません。", "クエストを読み込み中"],
  "zh-CN": ["已保存到服务器", "已保存到此设备", "等待同步", "服务器不可用，进度已暂存在此账户的设备缓存中。", "任务服务器等待更新，进度已暂存在设备中。", "登录验证失败，请重新登录后重试。", "任务数据需要恢复，已暂停新写入以保护原始数据。", "此设备无法安全保存更多任务数据。", "正在加载任务"],
  de: ["Auf dem Server gespeichert", "Auf diesem Gerät gespeichert", "Synchronisierung ausstehend", "Server nicht verfügbar; der Fortschritt dieses Kontos bleibt auf diesem Gerät.", "Quest-Serverupdate ausstehend; der Fortschritt bleibt auf diesem Gerät.", "Anmeldung konnte nicht bestätigt werden. Bitte erneut anmelden.", "Questdaten müssen wiederhergestellt werden. Neue Speicherungen sind angehalten.", "Dieses Gerät kann keine weiteren Questdaten sicher speichern.", "Aufgaben werden geladen"],
  fr: ["Enregistré sur le serveur", "Enregistré sur cet appareil", "Synchronisation en attente", "Serveur indisponible : la progression de ce compte reste sur cet appareil.", "Mise à jour du serveur de quêtes en attente : la progression reste sur cet appareil.", "Échec de la vérification de connexion. Reconnectez-vous puis réessayez.", "Les données de quête doivent être restaurées. Les nouvelles écritures sont suspendues.", "Cet appareil ne peut plus enregistrer les données de quête en sécurité.", "Chargement des quêtes"],
  es: ["Guardado en el servidor", "Guardado en este dispositivo", "Esperando sincronización", "Servidor no disponible; el progreso de esta cuenta se guarda en este dispositivo.", "Actualización del servidor de misiones pendiente; el progreso queda en este dispositivo.", "Falló la verificación de sesión. Inicia sesión de nuevo.", "Los datos de misiones necesitan recuperación. Se pausaron las escrituras nuevas.", "Este dispositivo no puede guardar más datos de misiones de forma segura.", "Cargando misiones"],
  ru: ["Сохранено на сервере", "Сохранено на этом устройстве", "Ожидание синхронизации", "Сервер недоступен; прогресс этой учётной записи хранится на устройстве.", "Ожидается обновление сервера заданий; прогресс хранится на устройстве.", "Не удалось подтвердить вход. Войдите снова и повторите.", "Данные заданий требуют восстановления. Новые записи приостановлены.", "На устройстве нельзя безопасно сохранить больше данных заданий.", "Загрузка заданий"],
  "pt-BR": ["Salvo no servidor", "Salvo neste dispositivo", "Aguardando sincronização", "Servidor indisponível; o progresso desta conta fica neste dispositivo.", "Atualização do servidor de missões pendente; o progresso fica neste dispositivo.", "Falha ao verificar o login. Entre novamente e tente outra vez.", "Os dados de missões precisam de recuperação. Novas gravações foram pausadas.", "Este dispositivo não pode salvar mais dados de missões com segurança.", "Carregando missões"],
};
const STATE_ROWS: Partial<Record<LanguageCode, Copy["states"]>> = {
  ko: { active: "진행 중", completed: "완료", expired: "만료", awaiting: "동기화 대기", stale: "종료된 기간의 기록 보관됨" },
  ja: { active: "進行中", completed: "完了", expired: "期限切れ", awaiting: "同期待ち", stale: "終了期間の記録を保持" },
  "zh-CN": { active: "进行中", completed: "已完成", expired: "已过期", awaiting: "等待同步", stale: "已保留过期时段记录" },
  de: { active: "In Bearbeitung", completed: "Abgeschlossen", expired: "Abgelaufen", awaiting: "Synchronisierung ausstehend", stale: "Ereignis aus geschlossenem Zeitraum gespeichert" },
  fr: { active: "En cours", completed: "Terminée", expired: "Expirée", awaiting: "En attente de synchronisation", stale: "Événement de période close conservé" },
  es: { active: "En curso", completed: "Completada", expired: "Caducada", awaiting: "Pendiente de sincronización", stale: "Evento de periodo cerrado conservado" },
  ru: { active: "В процессе", completed: "Завершено", expired: "Истекло", awaiting: "Ожидает синхронизации", stale: "Событие закрытого периода сохранено" },
  "pt-BR": { active: "Em andamento", completed: "Concluída", expired: "Expirada", awaiting: "Aguardando sincronização", stale: "Evento de período encerrado preservado" },
};
function copy(): Copy & ReturnType<typeof progressUiCopy> {
  const language = I18nManager.getLanguage(), local = COPY[language] ?? {};
  const names = NAME_ROWS[language] ? Object.fromEntries(NAME_IDS.map((id, index) => [id, NAME_ROWS[language]![index]])) : {};
  const sync = SYNC_ROWS[language] ? Object.fromEntries(SYNC_KEYS.map((id, index) => [id, SYNC_ROWS[language]![index]])) : {};
  const extra = progressUiCopy();
  const winTemplates: Record<LanguageCode, string> = { en: "Win {count} Stage or Online Ranked matches", ko: "스테이지 또는 온라인 랭크 {count}승", ja: "ステージまたはオンラインランクで{count}勝", "zh-CN": "关卡或在线排位获胜{count}次", de: "{count} Siege im Stufenkampf oder Online-Rangmodus", fr: "Gagner {count} combats de niveau ou classés en ligne", es: "Gana {count} batallas de etapa o clasificatorias en línea", ru: "{count} побед на этапах или в сетевом рейтинге", "pt-BR": "Vença {count} batalhas de fase ou ranqueadas online" };
  const winName = (count: number) => winTemplates[language].replace("{count}", String(count));
  const winNames = { "daily-wins": winName(2), "weekly-wins": winName(10) };
  return { ...EN, ...local, ...extra, sync: { ...EN.sync, ...sync, ...(local.sync ?? {}) }, names: { ...EN.names, ...names, ...(local.names ?? {}), ...winNames }, states: { ...EN.states, ...(STATE_ROWS[language] ?? {}), ...(local.states ?? {}) } };
}

function activeProgress(view: QuestStorageView, cadence: QuestCadence): QuestProgress[] {
  const period = view.periods.find((item) => item.cadence === cadence);
  return period ? view.progress.filter((item) => item.periodId === period.periodId) : [];
}
function completed(view: QuestStorageView, cadence: QuestCadence): number { return activeProgress(view, cadence).filter((item) => item.status === "completed").length; }
function syncLabel(view: QuestStorageView, c = copy()): string { return c.sync[view.status.replace("quest.sync_", "")] ?? c.sync.loading; }
function countdown(view: QuestStorageView, cadence: QuestCadence): string {
  const end = view.periods.find((item) => item.cadence === cadence)?.endsAt;
  if (!end) return "—";
  return formatProgressDuration(Date.parse(end), Date.parse(view.estimatedNow), I18nManager.getLanguage());
}
function eligibleModes(metric: string, c: ReturnType<typeof copy>): string {
  if (metric === "wins") return [c.stage, c.ranked].join(" · ");
  if (metric === "piece-types") return [c.stage, c.online, c.puzzle, c.tutorial].join(" · ");
  return c.puzzle;
}
function questHasPendingEvent(view: QuestStorageView, periodId: string, questId: string): boolean {
  const definition = questDefinitionsFor(questId.startsWith("daily-") ? "daily" : "weekly").find((item) => item.id === questId);
  if (!definition) return false;
  return view.outbox.some((event) => event.requestedPeriods.some((period) => period.periodId === periodId) && eventSupportsMetric(event.kind, definition.metric, event.kind === "puzzle-clear" ? event.payload.medal : undefined));
}

function summaryCounts(view: QuestStorageView): string {
  const c = copy();
  return view.ready ? `${c.daily} ${completed(view, "daily")}/3 · ${c.weekly} ${completed(view, "weekly")}/5` : c.sync.loading;
}
function renderQuestEntry(storage: QuestStorage, location: "lobby" | "profile"): string {
  const view = storage.view(), c = copy();
  return `<section class="quest-${location === "lobby" ? "lobby-entry" : "profile-summary"}"><div><strong>${escapeHtml(location === "lobby" ? c.todayQuests : c.summary)}</strong><span data-quest-summary-counts>${escapeHtml(summaryCounts(view))}</span></div><button type="button" data-open-quests data-quest-opener="${location}"${view.ready ? "" : " disabled"}>${escapeHtml(location === "lobby" ? c.viewAll : c.title)}</button></section>`;
}
export function renderQuestProfileSummary(storage: QuestStorage): string { return renderQuestEntry(storage, "profile"); }
export function renderQuestLobbyEntry(storage: QuestStorage): string { return renderQuestEntry(storage, "lobby"); }
export function updateQuestSummaries(root: HTMLElement, storage: QuestStorage): void {
  const view = storage.view();
  root.querySelectorAll<HTMLElement>("[data-quest-summary-counts]").forEach(node => { node.textContent = summaryCounts(view); });
  root.querySelectorAll<HTMLButtonElement>("[data-open-quests]").forEach(node => { node.disabled = !view.ready; });
}
function listHtml(view: QuestStorageView, cadence: QuestCadence): string {
  const c = copy(), progress = activeProgress(view, cadence);
  return questDefinitionsFor(cadence).map((definition) => {
    const item = progress.find((candidate) => candidate.questId === definition.id);
    const value = item ? questProgressCount(item) : 0;
    const targets = summarizeQuestTargets(definition, item, view.periods.find(p => p.cadence === cadence)?.periodId ?? "");
    const pieceNames: Record<string, string> = { Pawn:I18nManager.t("lobby.piece_pawn"), Knight:I18nManager.t("lobby.piece_knight"), Bishop:I18nManager.t("lobby.piece_bishop"), Rook:I18nManager.t("lobby.piece_rook"), Queen:I18nManager.t("lobby.piece_queen"), King:I18nManager.t("lobby.piece_king") };
    const targetName = (id: string) => targets?.kind === "pieces" ? pieceNames[id] ?? id
      : /^P(0[1-9]|1[0-2])$/.test(id) ? puzzleText("puzzle_" + id.slice(1) + "_title") : id;
    const targetHtml = targets ? `<ul class="quest-targets" aria-label="${escapeHtml(c.achievedTargets)}">${targets.achievedIds.map(id => `<li class="is-achieved">✓ ${escapeHtml(targetName(id))}</li>`).join("")}</ul>${targets.unrecordedIds.length ? `<small>${escapeHtml(c.unrecordedPieces)}</small><ul class="quest-targets" aria-label="${escapeHtml(c.unrecordedPieces)}">${targets.unrecordedIds.map(id => `<li>${escapeHtml(targetName(id))}</li>`).join("")}</ul>` : ""}<small class="quest-next">${escapeHtml(targets.complete ? c.targetComplete : (targets.kind === "pieces" ? c.needPieces : definition.metric === "distinct-gold-puzzles" ? c.needGoldPuzzles : c.needPuzzles).replace("{count}", String(targets.remaining)))}</small>` : "";

    const state = item?.status === "completed" ? c.states.completed : item?.status === "expired" ? c.states.expired : item && questHasPendingEvent(view, item.periodId, item.questId) ? c.states.awaiting : c.states.active;
    return `<article class="quest-card${item?.status === "completed" ? " is-complete" : ""}"><div><strong>${escapeHtml(c.names[definition.id] ?? definition.id)}</strong><span>${value}/${definition.target}</span></div><small>${escapeHtml(c.eligible)}: ${escapeHtml(eligibleModes(definition.metric, c))}</small>${definition.metric === "wins" ? `<small>${escapeHtml(c.winExclusions)}</small>` : ""}<em>${escapeHtml(state)}</em><progress max="${definition.target}" value="${Math.min(value, definition.target)}">${value}/${definition.target}</progress>${targetHtml}</article>`;
  }).join("");
}

let activeQuestBookClose: (() => void) | null = null;
export function openQuestBook(_container: HTMLElement, storage: QuestStorage, onRoute?: (route: "stage" | "puzzle") => void): void {
  activeQuestBookClose?.();
  const c = copy(), opener = document.activeElement instanceof HTMLElement ? document.activeElement : null, openedOwner = storage.owner;
  const openerKey = opener?.dataset.questOpener;
  const modal = document.createElement("section");
  modal.className = "quest-modal"; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-labelledby", "quest-title");
  let cadence: QuestCadence = "daily", closed = false, unsubscribe = () => {}, countdownTimer: number | null = null;
  const background = [...document.body.children] as HTMLElement[], previousInert = background.map((node) => node.inert);
  const priorHtmlOverflowX = document.documentElement.style.overflowX, priorBodyOverflowX = document.body.style.overflowX, hadOpenClass = document.body.classList.contains("quest-modal-open");
  const scrollX = window.scrollX, scrollY = window.scrollY;
  background.forEach((node) => { node.inert = true; });
  document.documentElement.style.overflowX = "hidden"; document.body.style.overflowX = "hidden"; document.body.classList.add("quest-modal-open");
  const focusSelector = (): string | null => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!active || !modal.contains(active)) return null;
    if (active.id === "quest-title") return "#quest-title";
    for (const key of ["questClose", "cadence", "questRetry", "questRoute"] as const) if (active.dataset[key] !== undefined) return `[data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${CSS.escape(active.dataset[key] ?? "")}"]`;
    return null;
  };
  const render = (preserve = false) => {
    const view = storage.view();
    if (view.owner !== openedOwner || !view.ready) { close(); return; }
    const selector = preserve ? focusSelector() : null, priorScroll = modal.querySelector<HTMLElement>(".quest-dialog")?.scrollTop ?? 0;
    const historyExpired = view.progress.filter((item) => item.status === "expired").length;
    const staleText = view.staleOutcomes.length ? ` · ${c.states.stale}: ${view.staleOutcomes.length}` : "";
    const routes = onRoute ? `<h3>${escapeHtml(c.routes)}</h3><div><button type="button" data-quest-route="stage">${escapeHtml(c.stage)}</button><button type="button" data-quest-route="puzzle">${escapeHtml(c.puzzle)}</button></div>` : "";
    modal.innerHTML = `<div class="quest-dialog"><header><div><p>${escapeHtml(c.summary)}</p><h2 id="quest-title" tabindex="-1">${escapeHtml(c.title)}</h2></div><button type="button" data-quest-close="" aria-label="${escapeHtml(c.close)}">×</button></header><div class="quest-tabs" role="tablist" aria-label="${escapeHtml(c.title)}"><button id="quest-tab-daily" type="button" role="tab" data-cadence="daily" aria-selected="${cadence === "daily"}" aria-controls="quest-panel-daily" tabindex="${cadence === "daily" ? 0 : -1}">${escapeHtml(c.daily)} ${completed(view, "daily")}/3</button><button id="quest-tab-weekly" type="button" role="tab" data-cadence="weekly" aria-selected="${cadence === "weekly"}" aria-controls="quest-panel-weekly" tabindex="${cadence === "weekly" ? 0 : -1}">${escapeHtml(c.weekly)} ${completed(view, "weekly")}/5</button></div><p class="quest-countdown">${escapeHtml(Date.parse(view.periods.find(p => p.cadence === cadence)?.endsAt ?? "") - Date.parse(view.estimatedNow) < 60000 ? c.resetsSoon : c.resets.replace("{time}", countdown(view, cadence)))}</p><div id="quest-panel-${cadence}" class="quest-list" role="tabpanel" aria-labelledby="quest-tab-${cadence}">${listHtml(view, cadence)}</div>${historyExpired ? `<p class="quest-history-status">${escapeHtml(c.states.expired)}: ${historyExpired}</p>` : ""}<section class="quest-routes">${routes}</section><footer><p class="quest-sync is-${view.syncState}" role="status">${escapeHtml(syncLabel(view, c) + staleText)}</p>${["offline", "missing-server", "auth-error"].includes(view.syncState) ? `<button type="button" data-quest-retry="">${escapeHtml(I18nManager.t("lobby.progress_retry"))}</button>` : ""}</footer></div>`;
    const dialog = modal.querySelector<HTMLElement>(".quest-dialog"); if (dialog) dialog.scrollTop = priorScroll;
    motion.refresh(dialog, cadence, modal.querySelector<HTMLElement>('[role="tabpanel"]'));
    if (selector) (modal.querySelector<HTMLElement>(selector) ?? modal.querySelector<HTMLElement>("[data-quest-close]") ?? modal.querySelector<HTMLElement>("#quest-title"))?.focus();
  };
  const motion = createPanelMotion();
  const close = () => {
    if (closed) return; closed = true; motion.cancel(); unsubscribe(); if (countdownTimer !== null) window.clearInterval(countdownTimer); modal.remove();
    background.forEach((node, index) => { node.inert = previousInert[index]; });
    document.documentElement.style.overflowX = priorHtmlOverflowX; document.body.style.overflowX = priorBodyOverflowX; if (!hadOpenClass) document.body.classList.remove("quest-modal-open");
    window.scrollTo(scrollX, scrollY); if (activeQuestBookClose === close) activeQuestBookClose = null;
    const visible = (node: HTMLElement | null): node is HTMLElement => !!node?.isConnected && node.getClientRects().length > 0 && !node.closest("[inert], [hidden]");
    const keyed = openerKey ? document.querySelector<HTMLElement>(`[data-quest-opener="${CSS.escape(openerKey)}"]`) : null;
    const liveOpener = visible(opener) ? opener : visible(keyed) ? keyed : [...document.querySelectorAll<HTMLElement>("[data-open-quests]")].find(visible);
    liveOpener?.focus();
  };
  activeQuestBookClose = close;
  unsubscribe = storage.subscribe(() => render(true));
  document.body.appendChild(modal); render();
  if (closed) return;
  countdownTimer = window.setInterval(() => render(true), 30000); modal.querySelector<HTMLElement>("#quest-title")?.focus();
  modal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null; if (!target) return;
    if (target.dataset.questClose !== undefined) close();
    else if (target.dataset.cadence === "daily" || target.dataset.cadence === "weekly") { cadence = target.dataset.cadence; render(); modal.querySelector<HTMLElement>(`[data-cadence="${cadence}"]`)?.focus(); }
    else if (target.dataset.questRetry !== undefined) void storage.retry();
    else if (target.dataset.questRoute === "stage" || target.dataset.questRoute === "puzzle") { const route = target.dataset.questRoute; close(); onRoute?.(route); }
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) && document.activeElement instanceof HTMLElement && document.activeElement.dataset.cadence) {
      event.preventDefault(); cadence = event.key === "ArrowLeft" || event.key === "Home" ? "daily" : "weekly"; render(); modal.querySelector<HTMLElement>(`[data-cadence="${cadence}"]`)?.focus(); return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...modal.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')]; if (!focusable.length) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement); const next = event.shiftKey ? (current <= 0 ? focusable.length - 1 : current - 1) : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
    event.preventDefault(); focusable[next].focus();
  });
}

export type QuestResultBaseline = Record<string, number>;
export function captureQuestResultBaseline(storage: QuestStorage): QuestResultBaseline { return Object.fromEntries(storage.view().progress.map((item) => [`${item.periodId}|${item.questId}`, questProgressCount(item)])); }
export function appendQuestResult(container: HTMLElement, before: QuestResultBaseline, storage: QuestStorage, onViewAll: () => void): void {
  container.querySelector(".quest-result")?.remove();
  const c = copy(), view = storage.view();
  const changed = view.progress.map((item) => ({ item, value: questProgressCount(item), prior: before[`${item.periodId}|${item.questId}`] ?? 0 })).filter(({ value, prior }) => value > prior).slice(0, 3);
  if (!changed.length) return;
  const section = document.createElement("section"); section.className = "quest-result";
  section.innerHTML = `<h3>${escapeHtml(c.result)}</h3>${changed.map(({ item, value }) => { const target = questDefinitionsFor(item.questId.startsWith("daily-") ? "daily" : "weekly").find((definition) => definition.id === item.questId)?.target ?? value; return `<p><span>${escapeHtml(c.names[item.questId] ?? item.questId)}</span><strong>${value}/${target}</strong></p>`; }).join("")}<button type="button" data-quest-view-all>${escapeHtml(c.viewAll)}</button>`;
  section.querySelector("button")?.addEventListener("click", onViewAll); container.appendChild(section); container.hidden = false;
  section.querySelectorAll<HTMLElement>('p').forEach((row, index) => {
    const {item, value, prior} = changed[index];
    notifyResultProgress(container, row, `quest:${item.periodId}:${item.questId}`, prior, value, view.syncState === 'synced' || view.syncState === 'provisional');
  });
}
