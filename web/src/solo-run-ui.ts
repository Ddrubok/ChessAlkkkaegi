import { showSoloDrawResult, showStageRunResult, type MatchRuntime } from "./match";
import { soloRunPayout, type SoloRun } from "./solo-run";
import { soloRunText as text } from "./solo-run-copy";

/** Extend the existing result panel; none of these labels imply a successful disk write. */
export function showSoloRunState(
  runtime: MatchRuntime, run: SoloRun,
  onRetry: () => Promise<void>, onMenu: () => Promise<void>,
  remaining?: { white: number; black: number },
  confirmedPayout?: number,
): void {
  if (run.phase === "ended") {
    showStageRunResult(runtime, run.stage, 0, run.endReason === "completed", onMenu,
      run.endReason === "completed" ? "white" : "black", null);
    runtime.resultDetails.replaceChildren();
  } else {
    showSoloDrawResult(runtime, run.stage, onRetry, onMenu);
  }
  const values = { stage: run.stage };
  runtime.resultKicker.hidden = true;
  runtime.overlay.dataset.soloRunState = run.phase;
  const result = run.result;
  runtime.winner = result?.winner ?? (run.endReason === "completed" ? "white" : "black");
  if (run.phase === "ending") runtime.winnerHeading.textContent = text("settlementPending");
  else if (run.phase === "preparing-stage") runtime.winnerHeading.textContent = text("choiceCommitted");
  else if (run.phase !== "ended") runtime.winnerHeading.textContent = text(result?.winner === "draw" ? "draw" : "loss", values);
  runtime.resultDetails.replaceChildren();
  const line = (value: string) => {
    const p = document.createElement("p"); p.textContent = value; runtime.resultDetails.append(p);
  };
  if (run.phase === "stage-result" && result?.observed) {
    if (result.byAI) line(text("aiShot"));
    line(text("shotSummary", { own: result.ownOut, enemy: result.enemyOut }));
  } else if (remaining && (run.phase === "stage-ready" || run.phase === "stage-result")) {
    line(text("remainingSummary", { own: result?.remainingOwn ?? remaining.white, enemy: result?.remainingEnemy ?? remaining.black }));
  }
  if (run.phase === "stage-result" || run.phase === "stage-ready") line(text("retained", values));
  if (run.phase !== "ended") line(text("pendingPoints", { points: soloRunPayout(run) }));
  else line(text("settled", { points: confirmedPayout ?? soloRunPayout(run) }));
  runtime.resultDetails.hidden = false;
  runtime.menuButton.hidden = false;
  runtime.menuButton.textContent = text("menu");
  runtime.restartButton.hidden = run.phase === "ended";
  runtime.restartButton.textContent = text(run.phase === "ending" ? "settlementRetry"
    : run.phase === "preparing-stage" ? "prepareRetry" : "retry", values);
  runtime.actionStatus.hidden = true;
  (runtime.restartButton.hidden ? runtime.menuButton : runtime.restartButton).focus();
}

/** The only destructive run action uses the existing two-action confirmation style. */
export function confirmSoloRunEnd(container: HTMLElement, points: number): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = document.createElement("section");
    overlay.className = "match-result-overlay menu-confirm-overlay";
    overlay.dataset.soloRunConfirm = "";
    overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "solo-run-end-title");
    const panel = document.createElement("div"); panel.className = "match-result-panel";
    const title = document.createElement("h1"); title.id = "solo-run-end-title"; title.textContent = text("endTitle");
    const description = document.createElement("p"); description.textContent = text("endDescription", { points });
    const actions = document.createElement("div"); actions.className = "match-result-actions";
    const cancel = document.createElement("button"), confirm = document.createElement("button");
    cancel.type = confirm.type = "button";
    cancel.textContent = text("continueRun"); confirm.textContent = text("confirmEnd");
    const previous = document.activeElement;
    const finish = (accepted: boolean) => { overlay.remove(); if (previous instanceof HTMLElement) previous.focus(); resolve(accepted); };
    cancel.addEventListener("click", () => finish(false)); confirm.addEventListener("click", () => finish(true));
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
      if (event.key === "Tab") { event.preventDefault(); (document.activeElement === cancel ? confirm : cancel).focus(); }
      event.stopPropagation();
    });
    actions.append(cancel, confirm); panel.append(title, description, actions); overlay.append(panel);
    container.append(overlay); cancel.focus();
  });
}
