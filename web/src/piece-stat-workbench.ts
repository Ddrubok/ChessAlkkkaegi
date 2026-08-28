import type { PieceType } from "./config";
import { I18nManager } from "./i18n";
import type { PieceStatWorkbenchAdapter } from "./piece-stat-adapter";
import { PIECE_STAT_ORDER, type PieceStatId, type PieceStatMutationResult, type PieceStatWorkbenchSummary } from "./piece-stat-model";
import { PiecePreviewRenderer, type PiecePreviewServices } from "./piece-preview-renderer";
import { effectLabel, pieceLabel, statText } from "./piece-stat-text";
import "./piece-stat-workbench.css";

let nextWorkbenchId = 0;
const symbols: Record<PieceType, string> = { Pawn: "♟", Knight: "♞", Bishop: "♝", Rook: "♜", Queen: "♛", King: "♚" };

/** 모달의 키 입력이 뒤쪽 메뉴/게임으로 전파되지 않도록 하고 포커스를 되돌린다. */
export function bindWorkbenchModal(modal: HTMLElement, onClose: () => void): () => void {
  const previousFocus = document.activeElement as HTMLElement | null;
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
  modal.tabIndex = -1;
  const focusable = () => [...modal.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']")].filter(el => el.getClientRects().length > 0 && !el.closest("[inert]"));
  const keydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.target instanceof Element && event.target.closest("dialog[open]")) return;
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "Tab") {
      event.preventDefault();
      const items = focusable();
      if (!items.length) { modal.focus(); return; }
      const index = items.indexOf(document.activeElement as HTMLElement);
      items[index < 0 ? (event.shiftKey ? items.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
    }
  };
  modal.addEventListener("keydown", keydown);
  queueMicrotask(() => { if (modal.isConnected) (focusable()[0] ?? modal).focus(); });
  return () => { modal.removeEventListener("keydown", keydown); if (previousFocus?.isConnected) previousFocus.focus(); };
}

export class PieceStatWorkbench {
  readonly element = document.createElement("section");
  private selectedPiece: PieceType;
  private preview: PiecePreviewRenderer | null = null;
  private readonly id = `piece-workbench-${++nextWorkbenchId}`;
  private readonly unsubscribe: (() => void)[] = [];
  private readonly observer: MutationObserver;
  private attached = false;
  private disposed = false;
  private busy = false;
  private effectTimer = 0;
  private pendingConfirm: ((confirmed: boolean) => void) | null = null;

  constructor(private readonly adapter: PieceStatWorkbenchAdapter, private readonly options: {
    previewServices?: PiecePreviewServices | null;
    selectedPiece?: PieceType;
    onSummaryChange?: (summary: PieceStatWorkbenchSummary) => void;
  } = {}) {
    this.selectedPiece = options.selectedPiece ?? "Pawn";
    this.element.className = "piece-stat-workbench";
    this.element.setAttribute("aria-labelledby", `${this.id}-title`);
    this.element.innerHTML = `
      <header class="psw-header"><div><h3 id="${this.id}-title" data-text="title"></h3><p data-text="description"></p></div><strong class="psw-resource" data-text="resource"></strong></header>
      <div class="psw-layout">
        <nav class="psw-pieces">${PIECE_STAT_ORDER.map(type => `<button type="button" data-piece="${type}"><span class="psw-piece-symbol" aria-hidden="true">${symbols[type]}</span><span data-name></span><small data-levels></small><small data-lock></small></button>`).join("")}</nav>
        <div class="psw-preview"><div class="psw-preview-title" data-text="piece"></div><div class="psw-canvas-wrap"><canvas class="psw-canvas" role="img"></canvas><p class="psw-fallback" data-text="fallback"></p><span class="psw-float" aria-hidden="true"></span></div><p data-label="previewHint"></p><button type="button" data-action="view" data-label="resetView"></button></div>
        <div class="psw-editor"><div class="psw-tiers" role="tablist"><button type="button" role="tab" data-tier="basic" data-label="basic"></button><button type="button" role="tab" data-tier="advanced" data-label="advanced"></button></div>
          <p class="psw-lock-reason" id="${this.id}-lock" data-text="lock"></p>
          ${(["force", "weight"] as const).map(stat => `<section class="psw-stat psw-${stat}" data-stat="${stat}"><div class="psw-stat-heading"><h4 data-label="${stat}"></h4><span data-field="level"></span></div><div class="psw-effects"><span><small data-label="current"></small><strong data-field="current"></strong></span><span class="psw-next"><small data-label="next"></small><strong data-field="next"></strong></span></div><p class="psw-breakdown" data-field="breakdown"></p><div class="psw-controls"><button type="button" data-action="decrease" data-stat="${stat}">−</button><span data-field="cost"></span><button type="button" data-action="increase" data-stat="${stat}">+</button></div><p class="psw-reason" id="${this.id}-${stat}-reason" data-field="reason"></p></section>`).join("")}
        </div>
      </div>
      <section class="psw-size"><div><h4 data-label="size"></h4><p data-label="sizeDescription"></p><strong data-text="sizeEffect"></strong><p id="${this.id}-size-reason" class="psw-reason" data-text="sizeReason"></p></div><button type="button" data-action="size"></button></section>
      <p class="psw-status" role="status" aria-live="polite" aria-atomic="true"></p>
      <footer class="psw-footer"><button type="button" data-action="reset"></button><button type="button" class="psw-primary" data-action="primary"></button></footer>
      <dialog class="psw-confirm" aria-labelledby="${this.id}-confirm-title"><h4 id="${this.id}-confirm-title"></h4><p data-confirm-message></p><div><button type="button" data-confirm="cancel" data-label="cancel"></button><button type="button" data-confirm="accept" data-label="confirm"></button></div></dialog>`;
    this.element.addEventListener("click", this.click);
    this.element.addEventListener("keydown", this.keydown);
    this.dialog.addEventListener("cancel", this.cancelConfirm);
    this.unsubscribe.push(adapter.subscribe(this.refresh), I18nManager.subscribe(this.refresh));
    this.observer = new MutationObserver(() => {
      if (this.element.isConnected) this.attached = true;
      else if (this.attached) this.dispose();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.setPreviewServices(options.previewServices ?? null);
    this.refresh();
  }
  get selection(): PieceType { return this.selectedPiece; }
  private get dialog(): HTMLDialogElement { return this.element.querySelector("dialog")!; }
  private label(selector: string, text: string): void { this.element.querySelector<HTMLElement>(selector)!.textContent = text; }
  setPreviewServices(services: PiecePreviewServices | null): void {
    this.preview?.dispose(); this.preview = null;
    if (this.disposed) return;
    if (services) {
      try {
        this.preview = new PiecePreviewRenderer(this.element.querySelector("canvas")!, services, available => {
          this.element.querySelector<HTMLElement>(".psw-fallback")!.hidden = available;
          if (!available) this.label('[data-text="fallback"]', statText("previewUnavailable"));
        });
        this.preview.setPiece(this.selectedPiece); this.preview.fitEffects();
      } catch (error) { console.warn("Piece preview unavailable", error); }
    }
    this.label('[data-text="fallback"]', statText(services ? "previewUnavailable" : "previewLoading"));
  }
  private readonly refresh = () => {
    if (this.disposed) return;
    const summary = this.adapter.getSummary(this.selectedPiece);
    const piece = summary.pieces.find(p => p.type === this.selectedPiece)!;
    this.element.dataset.mode = summary.mode;
    this.element.querySelectorAll<HTMLElement>("[data-label]").forEach(el => { el.textContent = statText(el.dataset.label!); });
    this.label('[data-text="title"]', statText(summary.titleKey));
    this.label('[data-text="description"]', statText(summary.descriptionKey));
    this.label('[data-text="resource"]', `${statText(summary.resourceLabelKey)} ${summary.resourceCurrent}${summary.resourceMaximum !== null ? ` / ${summary.resourceMaximum} · ${summary.resourceMaximum - summary.resourceCurrent} ${statText("remaining")}` : " P"}`);
    this.label('[data-text="piece"]', pieceLabel(this.selectedPiece));
    this.element.querySelector("canvas")!.setAttribute("aria-label", `${pieceLabel(this.selectedPiece)} ${statText("preview")}`);
    this.element.querySelector("nav")!.setAttribute("aria-label", statText("pieceList"));
    for (const p of summary.pieces) {
      const button = this.element.querySelector<HTMLButtonElement>(`[data-piece="${p.type}"]`)!;
      button.setAttribute("aria-current", String(p.type === this.selectedPiece));
      button.setAttribute("aria-label", `${pieceLabel(p.type)}${p.locked ? ` · ${statText(p.lockReasonKey!)}` : ""}`);
      button.querySelector("[data-name]")!.textContent = pieceLabel(p.type);
      button.querySelector("[data-levels]")!.textContent = `${statText("force")} ${p.force.level} · ${statText("weight")} ${p.weight.level}`;
      button.querySelector("[data-lock]")!.textContent = p.locked ? `🔒 ${statText("locked")}` : "";
    }
    this.element.querySelector<HTMLElement>(".psw-tiers")!.hidden = summary.mode !== "research";
    for (const button of this.element.querySelectorAll<HTMLButtonElement>("[data-tier]")) {
      button.setAttribute("aria-selected", String(button.dataset.tier === summary.researchTier));
      button.setAttribute("aria-controls", `${this.id}-force ${this.id}-weight`);
    }
    this.element.querySelector<HTMLElement>(".psw-editor")!.id = `${this.id}-editor`;
    this.label('[data-text="lock"]', piece.lockReasonKey ? statText(piece.lockReasonKey) : "");
    for (const stat of ["force", "weight"] as const) {
      const value = piece[stat];
      const card = this.element.querySelector<HTMLElement>(`.psw-stat[data-stat="${stat}"]`)!;
      card.id = `${this.id}-${stat}`;
      const set = (field: string, value: string) => { card.querySelector<HTMLElement>(`[data-field="${field}"]`)!.textContent = value; };
      set("level", `${statText("level")} ${value.level} / ${value.maximumLevel}`);
      set("current", effectLabel(value.currentEffectFraction));
      set("next", value.nextEffectFraction === null ? "—" : effectLabel(value.nextEffectFraction));
      set("cost", value.increaseCost !== null ? `${statText("cost")} ${value.increaseCost} P` : summary.mode === "strategy" ? "1 P / +2%" : statText("maximum"));
      set("reason", value.disabledReasonKey ? statText(value.disabledReasonKey) : "");
      set("breakdown", value.breakdown ? `${statText("basic")} ${effectLabel(value.breakdown.basicEffect)} + ${statText("advanced")} ${effectLabel(value.breakdown.advancedEffect)}` : "");
      for (const action of ["increase", "decrease"] as const) {
        const button = card.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
        button.hidden = action === "decrease" && summary.mode === "research";
        button.disabled = this.busy || !(action === "increase" ? value.canIncrease : value.canDecrease);
        button.setAttribute("aria-label", `${pieceLabel(this.selectedPiece)} ${statText(stat)} ${statText(action === "increase" && summary.mode === "research" ? "buy" : action)}`);
        button.setAttribute("aria-describedby", `${this.id}-${stat}-reason ${this.id}-lock`);
        button.textContent = action === "decrease" ? "−" : summary.mode === "research" ? statText("buy") : "+";
      }
    }
    this.element.querySelector<HTMLElement>(".psw-size")!.hidden = !summary.size;
    if (summary.size) {
      this.label('[data-text="sizeEffect"]', `${summary.size.level} / 1 · ${statText("current")} ${effectLabel(summary.size.currentEffectFraction)}${summary.size.nextEffectFraction !== null ? ` → ${effectLabel(summary.size.nextEffectFraction)}` : ""}`);
      this.label('[data-text="sizeReason"]', summary.size.disabledReasonKey ? statText(summary.size.disabledReasonKey) : "");
      const button = this.element.querySelector<HTMLButtonElement>('[data-action="size"]')!;
      button.textContent = summary.size.level ? statText("maximum") : `${statText("buy")} · ${summary.size.increaseCost} P`;
      button.disabled = this.busy || !summary.size.canIncrease;
      button.setAttribute("aria-describedby", `${this.id}-size-reason`);
    }
    const reset = this.element.querySelector<HTMLButtonElement>('[data-action="reset"]')!;
    reset.textContent = `${statText(summary.resetActionKey)}${summary.resetRefund !== null ? ` (+${summary.resetRefund} P)` : ""}`;
    reset.disabled = this.busy || !summary.resetEnabled;
    const primary = this.element.querySelector<HTMLButtonElement>('[data-action="primary"]')!;
    primary.hidden = !summary.primaryActionKey;
    primary.textContent = summary.primaryActionKey ? statText(summary.primaryActionKey) : "";
    primary.disabled = this.busy || !summary.primaryActionEnabled;
    this.preview?.setSize(summary.size?.currentEffectFraction ?? 0);
    this.options.onSummaryChange?.(summary);
  };
  private showResult(result: PieceStatMutationResult): void {
    this.refresh();
    const status = this.element.querySelector<HTMLElement>(".psw-status")!;
    status.textContent = result.messageKey ? statText(result.messageKey) : "";
    status.dataset.error = String(!result.changed || result.messageKey === "storageUnavailable");
    if (!result.changed) return;
    if (result.direction === "reset") { this.preview?.fitEffects(); return; }
    this.preview?.play(result);
    clearTimeout(this.effectTimer);
    this.element.dataset.effect = result.stat ?? "";
    this.element.getAnimations({ subtree: true }).forEach(animation => { animation.currentTime = 0; animation.play(); });
    const delta = Math.round(((result.effectAfter ?? 0) - (result.effectBefore ?? 0)) * 100);
    this.label(".psw-float", `${delta >= 0 ? "+" : ""}${delta}%`);
    this.effectTimer = window.setTimeout(() => { delete this.element.dataset.effect; }, 700);
  }
  private readonly click = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || button.disabled || this.disposed) return;
    if (button.dataset.confirm) { this.resolveConfirm(button.dataset.confirm === "accept"); return; }
    if (this.busy) return;
    if (button.dataset.piece) {
      this.selectedPiece = button.dataset.piece as PieceType;
      delete this.element.dataset.effect;
      this.preview?.setPiece(this.selectedPiece); this.preview?.fitEffects(); this.refresh(); return;
    }
    if (button.dataset.tier) { this.adapter.setResearchTier?.(button.dataset.tier as "basic" | "advanced"); return; }
    const action = button.dataset.action;
    if (action === "view") this.preview?.resetView();
    if (action === "increase" || action === "decrease") this.showResult(this.adapter[action](this.selectedPiece, button.dataset.stat as PieceStatId));
    if (action === "size" && this.adapter.increaseSize) this.showResult(this.adapter.increaseSize());
    if (action === "reset" || action === "primary") void this.performAction(action).then(() => {
      if (!this.disposed) (button.disabled ? this.element.querySelector<HTMLButtonElement>(`[data-piece="${this.selectedPiece}"]`)! : button).focus();
    });
  };
  private readonly keydown = (event: KeyboardEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-piece], [data-tier]");
    if (!button || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const buttons = [...this.element.querySelectorAll<HTMLButtonElement>(button.dataset.piece ? "[data-piece]" : "[data-tier]")];
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = buttons[(buttons.indexOf(button) + delta + buttons.length) % buttons.length];
    next.click(); next.focus();
  };
  private async performAction(action: "reset" | "primary"): Promise<void> {
    const summary = this.adapter.getSummary(this.selectedPiece);
    this.busy = true; this.refresh();
    try {
      if (action === "reset") {
        if (summary.resetRefund !== null && !await this.confirm(statText(summary.resetActionKey), `${statText("resetQuestion")} ${summary.resetRefund} P`)) return;
        if (!this.disposed) this.showResult(this.adapter.reset());
      } else {
        const unspent = (summary.resourceMaximum ?? 0) - summary.resourceCurrent;
        if (unspent > 0 && !await this.confirm(statText("findMatch"), `${statText("unspentQuestion")} ${unspent} P`)) return;
        if (!this.disposed) await this.adapter.executePrimaryAction?.();
      }
    } catch (error) {
      console.warn("Piece workbench action failed", error);
      this.label(".psw-status", statText("actionFailed"));
      this.element.querySelector<HTMLElement>(".psw-status")!.dataset.error = "true";
    } finally { this.busy = false; this.refresh(); }
  }
  private confirm(title: string, message: string): Promise<boolean> {
    this.dialog.querySelector("h4")!.textContent = title;
    this.dialog.querySelector("[data-confirm-message]")!.textContent = message;
    return new Promise(resolve => {
      this.pendingConfirm = resolve; this.dialog.showModal();
      this.dialog.querySelector<HTMLButtonElement>('[data-confirm="cancel"]')!.focus();
    });
  }
  private readonly cancelConfirm = (event: Event) => { event.preventDefault(); this.resolveConfirm(false); };
  private resolveConfirm(accepted: boolean): void { this.dialog.close(); this.pendingConfirm?.(accepted); this.pendingConfirm = null; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resolveConfirm(false); clearTimeout(this.effectTimer);
    this.preview?.dispose(); this.preview = null;
    this.observer.disconnect(); this.unsubscribe.forEach(unsubscribe => unsubscribe());
    this.element.removeEventListener("click", this.click); this.element.removeEventListener("keydown", this.keydown);
    this.dialog.removeEventListener("cancel", this.cancelConfirm);
  }
}
