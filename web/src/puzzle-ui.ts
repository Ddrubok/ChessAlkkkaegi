import type { PieceType } from "./config";
import { I18nManager, type LanguageCode } from "./i18n";
import { failureReason, medalText, puzzleText } from "./puzzle-text";
import { describePuzzleRule } from "./puzzle-rule-text";
import { getPuzzleDefinition } from "./puzzle";
import "./puzzle-ui.css";

export interface PuzzlePreviewPiece {
  id?: string;
  type: PieceType | string;
  color: "white" | "black";
  x: number;
  y: number;
  rotation?: number;
}

export interface PuzzleUiPuzzle {
  id: string;
  index: number;
  chapter?: number;
  title?: string;
  titleKey?: string;
  objective?: string;
  objectiveKey?: string;
  goldCondition?: string;
  goldConditionKey?: string;
  abilityLimit?: string;
  abilityLimitKey?: string;
  hints?: readonly [string, string];
  hintKeys?: readonly [string, string];
  protectedPiece?: string;
  protectedPieceKey?: string;
  specialRules?: readonly string[];
  specialRuleKeys?: readonly string[];
  board?: readonly PuzzlePreviewPiece[];
}

export interface PuzzleUiProgress {
  clearedIds: readonly string[];
  medals: Readonly<Record<string, number>>;
}

export interface PuzzlePlayState {
  shotsRemaining: number;
  objectiveProgress?: string;
  objectiveProgressKey?: string;
  protectedPiece?: string;
  protectedPieceKey?: string;
  hintLevel?: 0 | 1 | 2;
}

export type PuzzleFailureCode =
  | "no-player-pieces"
  | "forbidden-fall"
  | "required-alive-fallen"
  | "forbidden-contact"
  | "launch-budget-exceeded"
  | "required-hole-out-missing"
  | "required-wall-destruction-missing"
  | "wall-destruction-order-missing"
  | "contact-sequence-missing"
  | "custom-hit-missing"
  | "rook-shot-rule-missing"
  | "required-fall-missing"
  | "data-error";

export interface PuzzleMarker {
  id: string;
  x: number;
  y: number;
  role: "target" | "protect";
  label: string;
}

export interface PuzzleResult {
  success: boolean;
  objectiveMet: boolean;
  goldMet: boolean;
  medal: number;
  failureCode?: PuzzleFailureCode | string;
  message?: string;
  messageKey?: string;
}

export interface PuzzleUiOptions {
  puzzles?: readonly PuzzleUiPuzzle[];
  progress?: () => PuzzleUiProgress;
  onStart: (puzzleId: string) => Promise<void> | void;
  onRetry?: (puzzleId: string) => Promise<void> | void;
  onHint?: (puzzleId: string, level: 1 | 2) => Promise<void> | void;
  onExit?: () => void;
  onLibrary?: () => void;
}

const SYMBOLS: Record<string, string> = {
  Pawn: "♟",
  Knight: "♞",
  Bishop: "♝",
  Rook: "♜",
  Queen: "♛",
  King: "♚",
};

const COLORS: Record<"white" | "black", string> = { white: "#f8fafc", black: "#111827" };
const DEFAULT_BOARD: readonly PuzzlePreviewPiece[] = [
  { type: "Pawn", color: "white", x: 0.34, y: 0.72 },
  { type: "Pawn", color: "black", x: 0.58, y: 0.28 },
];

const DEFAULT_PUZZLES: readonly PuzzleUiPuzzle[] = Array.from({ length: 12 }, (_, index) => ({
  id: `puzzle-${String(index + 1).padStart(2, "0")}`,
  index: index + 1,
  chapter: Math.floor(index / 4) + 1,
  titleKey: `puzzle_${String(index + 1).padStart(2, "0")}_title`,
  objectiveKey: `puzzle_${String(index + 1).padStart(2, "0")}_objective`,
  goldConditionKey: `puzzle_${String(index + 1).padStart(2, "0")}_gold`,
  abilityLimitKey: `puzzle_${String(index + 1).padStart(2, "0")}_limit`,
  hintKeys: [`puzzle_${String(index + 1).padStart(2, "0")}_hint_1`, `puzzle_${String(index + 1).padStart(2, "0")}_hint_2`],
  board: DEFAULT_BOARD,
}));

type Screen = "library" | "briefing" | "playing" | "result";

/** 퍼즐 목록·상세·플레이 HUD·결과를 하나의 독립 오버레이로 관리합니다. */
export class PuzzleUI {
  private readonly root: HTMLElement;
  private readonly puzzles: readonly PuzzleUiPuzzle[];
  private readonly unsubscribe: () => void;
  private screen: Screen = "library";
  private currentPuzzle: PuzzleUiPuzzle | null = null;
  private playState: PuzzlePlayState | null = null;
  private result: PuzzleResult | null = null;
  private markers: readonly PuzzleMarker[] = [];
  private hintOpen = false;
  private activeHintLevel: 0 | 1 | 2 = 0;
  private busy = false;
  private actionError = "";

  constructor(private readonly app: HTMLElement, private readonly options: PuzzleUiOptions) {
    this.puzzles = options.puzzles?.length ? options.puzzles : DEFAULT_PUZZLES;
    this.root = document.createElement("section");
    this.root.className = "puzzle-ui-overlay piece-stat-modal";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", puzzleText("library_title"));
    this.root.addEventListener("click", this.handleClick);
    this.root.addEventListener("keydown", this.handleKeydown);
    this.app.append(this.root);
    this.unsubscribe = I18nManager.subscribe(() => {
      this.root.setAttribute("aria-label", puzzleText("library_title"));
      if (!this.root.hidden) this.render();
    });
  }

  get blocking(): boolean { return !this.root.hidden && (this.screen !== "playing" || this.hintOpen); }

  /** 메뉴 연결부에서 이름을 직관적으로 사용할 수 있는 별칭입니다. */
  openLibrary(): void { this.showLibrary(); }

  showLibrary(): void {
    this.screen = "library";
    this.currentPuzzle = null;
    this.playState = null;
    this.result = null;
    this.hintOpen = false;
    this.activeHintLevel = 0;
    this.actionError = "";
    this.root.hidden = false;
    this.render();
  }

  showBriefing(puzzleId: string): void {
    const puzzle = this.find(puzzleId);
    if (!puzzle || !this.isUnlocked(puzzle)) return;
    this.screen = "briefing";
    this.currentPuzzle = puzzle;
    this.playState = null;
    this.result = null;
    this.hintOpen = false;
    this.activeHintLevel = 0;
    this.actionError = "";
    this.root.hidden = false;
    this.render();
  }

  showPlaying(puzzle: PuzzleUiPuzzle | string, state: PuzzlePlayState): void {
    const resolved = typeof puzzle === "string" ? this.find(puzzle) : puzzle;
    if (!resolved) return;
    this.screen = "playing";
    this.currentPuzzle = resolved;
    this.playState = state;
    this.result = null;
    this.actionError = "";
    this.activeHintLevel = state.hintLevel ?? 0;
    this.hintOpen = this.activeHintLevel > 0;
    this.root.hidden = false;
    this.render();
  }

  update(state: PuzzlePlayState): void {
    if (this.screen !== "playing") return;
    this.playState = state;
    this.render();
  }

  updateMarkers(markers: readonly PuzzleMarker[]): void {
    this.markers = markers;
    if (this.screen === "playing" && !this.root.hidden) {
      const layer = this.root.querySelector<HTMLElement>("[data-markers]");
      if (layer) this.renderMarkers(layer);
    }
  }

  showResult(puzzle: PuzzleUiPuzzle | string, result: PuzzleResult): void {
    const resolved = typeof puzzle === "string" ? this.find(puzzle) : puzzle;
    if (!resolved) return;
    this.screen = "result";
    this.currentPuzzle = resolved;
    this.result = result;
    this.playState = null;
    this.hintOpen = false;
    this.activeHintLevel = 0;
    this.root.hidden = false;
    this.recordResult(resolved, result);
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }

  dispose(): void {
    this.unsubscribe();
    this.root.removeEventListener("click", this.handleClick);
    this.root.removeEventListener("keydown", this.handleKeydown);
    this.root.remove();
  }

  private find(id: string): PuzzleUiPuzzle | null {
    return this.puzzles.find(puzzle => puzzle.id === id) ?? null;
  }

  private progress(): PuzzleUiProgress {
    return this.options.progress?.() ?? {
      clearedIds: JSON.parse(localStorage.getItem("ca_puzzle_cleared_v1") ?? "[]") as string[],
      medals: JSON.parse(localStorage.getItem("ca_puzzle_medals_v1") ?? "{}") as Record<string, number>,
    };
  }

  private isUnlocked(puzzle: PuzzleUiPuzzle): boolean {
    if ((puzzle.chapter ?? Math.floor((puzzle.index - 1) / 4) + 1) <= 1) return true;
    const prior = this.puzzles.filter(candidate => candidate.chapter === (puzzle.chapter ?? 1) - 1);
    return prior.filter(candidate => this.progress().clearedIds.includes(candidate.id)).length >= 3;
  }

  private medalFor(puzzle: PuzzleUiPuzzle): number {
    return this.progress().medals[puzzle.id] ?? 0;
  }

  private recordResult(puzzle: PuzzleUiPuzzle, result: PuzzleResult): void {
    if (!result.success || this.options.progress) return;
    const progress = this.progress();
    const cleared = new Set(progress.clearedIds);
    cleared.add(puzzle.id);
    const medals = { ...progress.medals, [puzzle.id]: Math.max(progress.medals[puzzle.id] ?? 0, result.medal) };
    localStorage.setItem("ca_puzzle_cleared_v1", JSON.stringify([...cleared]));
    localStorage.setItem("ca_puzzle_medals_v1", JSON.stringify(medals));
  }

  private localized(value: string | undefined, key: string | undefined, fallback: string): string {
    if (value) return value;
    if (key) return puzzleText(key);
    return fallback;
  }

  private chapterName(chapter: number): string {
    return puzzleText(`chapter_${chapter}`);
  }

  private defaultKey(puzzle: PuzzleUiPuzzle, kind: "title" | "objective" | "gold" | "limit" | "hint_1" | "hint_2"): string {
    return `puzzle_${String(puzzle.index).padStart(2, "0")}_${kind}`;
  }

  private objectiveText(puzzle: PuzzleUiPuzzle): string {
    const definition = getPuzzleDefinition(puzzle.id);
    if (definition) return describePuzzleRule(definition, definition.required, I18nManager.getLanguage());
    return this.localized(puzzle.objective, puzzle.objectiveKey ?? this.defaultKey(puzzle, "objective"), puzzleText("default_objective"));
  }

  private goldText(puzzle: PuzzleUiPuzzle): string {
    const definition = getPuzzleDefinition(puzzle.id);
    if (definition) return describePuzzleRule(definition, definition.medals.gold, I18nManager.getLanguage());
    return this.localized(puzzle.goldCondition, puzzle.goldConditionKey ?? this.defaultKey(puzzle, "gold"), puzzleText("default_gold"));
  }

  private protectedText(puzzle: PuzzleUiPuzzle, state?: PuzzlePlayState): string {
    if (state?.protectedPiece || state?.protectedPieceKey) {
      return this.localized(state.protectedPiece, state.protectedPieceKey, puzzle.protectedPiece ?? "—");
    }
    const definition = getPuzzleDefinition(puzzle.id);
    const protectedPieces = definition?.pieces.filter((piece) => piece.protected) ?? [];
    return protectedPieces.map((piece) => {
      const side = I18nManager.t(piece.side === "white" ? "ingame.turn_white" : "ingame.turn_black");
      const name = I18nManager.t(`lobby.piece_${piece.type.toLowerCase()}`);
      return `${side} ${name}`;
    }).join(", ") || "—";
  }

  private render(): void {
    this.root.dataset.screen = this.screen;
    this.root.dataset.hintOpen = this.screen === "playing" ? String(this.hintOpen) : "false";
    this.root.replaceChildren();
    if (this.screen === "library") this.renderLibrary();
    else if (this.screen === "briefing") this.renderBriefing();
    else if (this.screen === "playing") this.renderPlaying();
    else this.renderResult();
  }

  private renderLibrary(): void {
    const card = this.createCard("puzzle-ui-library-card");
    card.innerHTML = `<header class="puzzle-ui-header"><div><h2 data-title></h2><p data-desc></p></div><button type="button" data-action="exit"></button></header><div class="puzzle-ui-chapters" data-chapters></div>`;
    card.querySelector<HTMLElement>("[data-title]")!.textContent = puzzleText("library_title");
    card.querySelector<HTMLElement>("[data-desc]")!.textContent = puzzleText("library_desc");
    card.querySelector<HTMLButtonElement>('[data-action="exit"]')!.textContent = puzzleText("close");
    const chapters = card.querySelector<HTMLElement>("[data-chapters]")!;
    for (let chapter = 1; chapter <= 3; chapter++) {
      const section = document.createElement("section");
      section.className = "puzzle-ui-chapter";
      const heading = document.createElement("h3");
      heading.textContent = `${puzzleText("chapter", { chapter })} · ${this.chapterName(chapter)}`;
      section.append(heading);
      const grid = document.createElement("div");
      grid.className = "puzzle-ui-grid";
      this.puzzles.filter(puzzle => (puzzle.chapter ?? Math.floor((puzzle.index - 1) / 4) + 1) === chapter).forEach(puzzle => {
        const unlocked = this.isUnlocked(puzzle);
        const medal = this.medalFor(puzzle);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "puzzle-ui-card";
        button.dataset.puzzleId = puzzle.id;
        button.disabled = !unlocked;
        button.innerHTML = `<span class="puzzle-ui-card-index"></span><strong data-card-title></strong><span data-card-status></span><span data-card-medal></span>`;
        button.querySelector<HTMLElement>(".puzzle-ui-card-index")!.textContent = String(puzzle.index).padStart(2, "0");
        button.querySelector<HTMLElement>("[data-card-title]")!.textContent = this.localized(puzzle.title, puzzle.titleKey ?? this.defaultKey(puzzle, "title"), puzzleText("default_title", { index: puzzle.index }));
        button.querySelector<HTMLElement>("[data-card-status]")!.textContent = unlocked ? (this.progress().clearedIds.includes(puzzle.id) ? puzzleText("cleared") : puzzleText("available")) : `🔒 ${puzzleText("locked")}`;
        button.querySelector<HTMLElement>("[data-card-medal]")!.textContent = `${puzzleText("medal")}: ${medalText(medal)}`;
        grid.append(button);
      });
      section.append(grid);
      chapters.append(section);
    }
    this.root.append(card);
  }

  private renderBriefing(): void {
    const puzzle = this.currentPuzzle!;
    const card = this.createCard("puzzle-ui-briefing-card");
    card.innerHTML = `<header class="puzzle-ui-header"><div><small data-chapter></small><h2 data-title></h2></div><button type="button" data-action="library"></button></header><div class="puzzle-ui-detail-layout"><div class="puzzle-ui-preview"><h3 data-preview-label></h3><div data-board></div></div><div class="puzzle-ui-briefing-copy"><div class="puzzle-ui-info"><h3 data-objective-label></h3><p data-objective></p><h3 data-gold-label></h3><p data-gold></p><h3 data-limit-label></h3><p data-limit></p></div><div class="puzzle-ui-hints"><h3 data-hint-label></h3><div data-hints></div></div><p class="puzzle-ui-action-error" data-action-error hidden></p></div></div><div class="puzzle-ui-rules"><p data-policy></p><p data-king></p><p data-promotion></p></div><footer class="puzzle-ui-footer"><button type="button" data-action="start" class="puzzle-ui-primary"></button></footer>`;
    card.querySelector<HTMLElement>("[data-chapter]")!.textContent = puzzleText("chapter", { chapter: puzzle.chapter ?? Math.floor((puzzle.index - 1) / 4) + 1 });
    card.querySelector<HTMLElement>("[data-title]")!.textContent = this.localized(puzzle.title, puzzle.titleKey ?? this.defaultKey(puzzle, "title"), puzzleText("default_title", { index: puzzle.index }));
    card.querySelector<HTMLButtonElement>('[data-action="library"]')!.textContent = puzzleText("back");
    card.querySelector<HTMLElement>("[data-preview-label]")!.textContent = puzzleText("board_preview");
    card.querySelector<HTMLElement>("[data-objective-label]")!.textContent = puzzleText("objective");
    card.querySelector<HTMLElement>("[data-objective]")!.textContent = this.objectiveText(puzzle);
    card.querySelector<HTMLElement>("[data-gold-label]")!.textContent = puzzleText("gold_condition");
    card.querySelector<HTMLElement>("[data-gold]")!.textContent = this.goldText(puzzle);
    card.querySelector<HTMLElement>("[data-limit-label]")!.textContent = puzzleText("restrictions");
    card.querySelector<HTMLElement>("[data-limit]")!.textContent = this.localized(puzzle.abilityLimit, puzzle.abilityLimitKey ?? this.defaultKey(puzzle, "limit"), puzzleText("default_limit"));
    card.querySelector<HTMLElement>("[data-hint-label]")!.textContent = puzzleText("hint");
    const hints = card.querySelector<HTMLElement>("[data-hints]")!;
    const hintValues = puzzle.hints ?? puzzle.hintKeys ?? [`puzzle_${String(puzzle.index).padStart(2, "0")}_hint_1`, `puzzle_${String(puzzle.index).padStart(2, "0")}_hint_2`];
    hintValues.forEach((value, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.hintIndex = String(index);
      button.textContent = puzzleText("hint_level", { level: index + 1 });
      const content = document.createElement("p");
      content.hidden = true;
      content.dataset.hintContent = String(index);
      content.textContent = puzzle.hints ? value : puzzleText(value);
      hints.append(button, content);
    });
    card.querySelector<HTMLElement>("[data-policy]")!.textContent = puzzleText("ability_policy");
    card.querySelector<HTMLElement>("[data-king]")!.textContent = puzzleText("special_king");
    card.querySelector<HTMLElement>("[data-promotion]")!.textContent = puzzleText("special_promotion");
    const briefingError = card.querySelector<HTMLElement>("[data-action-error]")!;
    briefingError.hidden = !this.actionError;
    briefingError.textContent = this.actionError;
    card.querySelector<HTMLButtonElement>('[data-action="start"]')!.textContent = puzzleText("start");
    card.querySelector("[data-board]")!.append(this.createBoard(puzzle.board ?? DEFAULT_BOARD));
    this.root.append(card);
  }

  private renderPlaying(): void {
    const puzzle = this.currentPuzzle!;
    const state = this.playState!;
    const hud = document.createElement("div");
    hud.className = "puzzle-ui-playing puzzle-ui-hud";
    hud.innerHTML = `<div class="puzzle-ui-hud-top"><div><strong data-title></strong><span data-target></span></div><div class="puzzle-ui-hud-stats"><span data-shots></span><span data-protected></span></div></div><div class="puzzle-ui-marker-layer" data-markers aria-hidden="true"></div><p class="puzzle-ui-hud-hint" data-hud-hint hidden></p><p class="puzzle-ui-action-error" data-action-error hidden></p><div class="puzzle-ui-hud-bottom"><button type="button" data-action="restart"></button><button type="button" data-action="hint"></button><button type="button" data-action="library"></button></div>`;
    hud.querySelector<HTMLElement>("[data-title]")!.textContent = this.localized(puzzle.title, puzzle.titleKey ?? this.defaultKey(puzzle, "title"), puzzleText("default_title", { index: puzzle.index }));
    hud.querySelector<HTMLElement>("[data-target]")!.textContent = `${puzzleText("target")}: ${this.objectiveText(puzzle)}`;
    hud.querySelector<HTMLElement>("[data-shots]")!.textContent = puzzleText("shots_remaining", { count: state.shotsRemaining });
    hud.querySelector<HTMLElement>("[data-protected]")!.textContent = `${puzzleText("protected")}: ${this.protectedText(puzzle, state)}`;
    const restartButton = hud.querySelector<HTMLButtonElement>('[data-action="restart"]')!;
    restartButton.textContent = puzzleText("restart");
    restartButton.setAttribute("aria-label", puzzleText("restart"));
    const hintButton = hud.querySelector<HTMLButtonElement>('[data-action="hint"]')!;
    hintButton.textContent = this.hintOpen && this.activeHintLevel < 2 ? puzzleText("hint_level", { level: 2 }) : this.hintOpen ? puzzleText("hide_hint") : puzzleText("show_hint");
    hintButton.setAttribute("aria-label", hintButton.textContent);
    const libraryButton = hud.querySelector<HTMLButtonElement>('[data-action="library"]')!;
    libraryButton.textContent = puzzleText("back");
    libraryButton.setAttribute("aria-label", puzzleText("back"));
    const hintPanel = hud.querySelector<HTMLElement>("[data-hud-hint]")!;
    hintPanel.hidden = !this.hintOpen;
    const hintValues = puzzle.hints ?? puzzle.hintKeys ?? [`puzzle_${String(puzzle.index).padStart(2, "0")}_hint_1`, `puzzle_${String(puzzle.index).padStart(2, "0")}_hint_2`];
    hintPanel.setAttribute("role", "status");
    hintPanel.setAttribute("aria-live", "polite");
    const hintIndex = Math.max(0, Math.min(1, (this.activeHintLevel || 1) - 1));
    const hintValue = hintValues[hintIndex] ?? `puzzle_${String(puzzle.index).padStart(2, "0")}_hint_${hintIndex + 1}`;
    hintPanel.textContent = this.hintOpen ? (puzzle.hints ? hintValue : puzzleText(hintValue)) : "";
    const playingError = hud.querySelector<HTMLElement>("[data-action-error]")!;
    playingError.hidden = !this.actionError;
    playingError.textContent = this.actionError;
    this.renderMarkers(hud.querySelector<HTMLElement>("[data-markers]")!);
    this.root.append(hud);
  }

  private renderMarkers(layer: HTMLElement): void {
    layer.replaceChildren();
    for (const marker of this.markers) {
      const item = document.createElement("span");
      item.className = `puzzle-ui-marker puzzle-ui-marker-${marker.role}`;
      item.style.left = `${Math.max(0, Math.min(1, marker.x)) * 100}%`;
      item.style.top = `${Math.max(0, Math.min(1, marker.y)) * 100}%`;
      item.textContent = marker.role === "target" ? "◎" : "◇";
      item.title = marker.label || puzzleText(marker.role === "target" ? "target" : "protected");
      layer.append(item);
    }
  }

  private renderResult(): void {
    const puzzle = this.currentPuzzle!;
    const result = this.result!;
    const card = this.createCard("puzzle-ui-result-card");
    const nextPuzzle = this.puzzles.find(candidate => candidate.index === puzzle.index + 1);
    card.innerHTML = `<header class="puzzle-ui-result-heading"><span data-result-icon></span><h2 data-result-title></h2><p data-failure></p><p data-result-medal></p></header><div class="puzzle-ui-result-conditions"><p data-objective></p><p data-gold></p></div><footer class="puzzle-ui-footer"><button type="button" data-action="retry"></button><button type="button" data-action="next"></button><button type="button" data-action="library"></button></footer>`;
    card.querySelector<HTMLElement>("[data-result-icon]")!.textContent = result.success ? "✓" : "!";
    card.querySelector<HTMLElement>("[data-result-title]")!.textContent = result.messageKey ? puzzleText(result.messageKey) : result.message ?? puzzleText(result.success ? "result_clear" : "result_fail");
    const failure = card.querySelector<HTMLElement>("[data-failure]")!;
    failure.hidden = result.success || !result.failureCode;
    failure.textContent = result.failureCode ? failureReason(result.failureCode) : "";
    card.querySelector<HTMLElement>("[data-result-medal]")!.textContent = puzzleText("result_medal", { medal: medalText(result.medal) });
    card.querySelector<HTMLElement>("[data-objective]")!.textContent = `${puzzleText("result_objective")}: ${result.objectiveMet ? puzzleText("condition_met") : puzzleText("condition_unmet")}`;
    card.querySelector<HTMLElement>("[data-gold]")!.textContent = `${puzzleText("result_gold")}: ${result.goldMet ? puzzleText("condition_met") : puzzleText("condition_unmet")}`;
    const retry = card.querySelector<HTMLButtonElement>('[data-action="retry"]')!;
    const next = card.querySelector<HTMLButtonElement>('[data-action="next"]')!;
    retry.textContent = puzzleText("retry");
    next.textContent = puzzleText("next");
    next.hidden = !result.success || !nextPuzzle || !this.isUnlocked(nextPuzzle);
    card.querySelector<HTMLButtonElement>('[data-action="library"]')!.textContent = puzzleText("back");
    this.root.append(card);
  }

  private createCard(className: string): HTMLElement {
    const card = document.createElement("div");
    card.className = `piece-stat-modal-card puzzle-ui-card-shell ${className}`;
    card.tabIndex = -1;
    return card;
  }

  private createBoard(pieces: readonly PuzzlePreviewPiece[]): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", puzzleText("board_preview"));
    const board = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    board.setAttribute("x", "2"); board.setAttribute("y", "2"); board.setAttribute("width", "96"); board.setAttribute("height", "96"); board.setAttribute("rx", "5"); board.setAttribute("class", "puzzle-ui-board-surface");
    svg.append(board);
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const square = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        square.setAttribute("x", String(4 + column * 11.5));
        square.setAttribute("y", String(4 + row * 11.5));
        square.setAttribute("width", "11.5");
        square.setAttribute("height", "11.5");
        square.setAttribute("fill", (row + column) % 2 === 0 ? "#e4d3b5" : "#80664b");
        svg.append(square);
      }
    }
    for (const piece of pieces) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(Math.max(8, Math.min(92, piece.x * 100))));
      text.setAttribute("y", String(Math.max(15, Math.min(94, piece.y * 100))));
      text.setAttribute("fill", COLORS[piece.color]);
      text.setAttribute("stroke", piece.color === "white" ? "#0f172a" : "#f8fafc");
      text.setAttribute("class", "puzzle-ui-board-piece");
      text.textContent = SYMBOLS[piece.type] ?? "●";
      svg.append(text);
    }
    return svg;
  }

  private goLibrary(): void {
    this.options.onLibrary?.();
    this.showLibrary();
  }

  private leave(): void {
    this.hide();
    this.options.onExit?.();
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    const puzzleCard = target.closest<HTMLButtonElement>("[data-puzzle-id]");
    if (puzzleCard) {
      this.showBriefing(puzzleCard.dataset.puzzleId!);
      return;
    }
    const hintButton = target.closest<HTMLButtonElement>("[data-hint-index]");
    if (hintButton) {
      const content = this.root.querySelector<HTMLElement>(`[data-hint-content="${hintButton.dataset.hintIndex}"]`);
      if (content) content.hidden = !content.hidden;
      return;
    }
    const action = target.closest<HTMLButtonElement>("[data-action]")?.dataset.action;
    if (!action || this.busy) return;
    if (action === "exit") { this.leave(); return; }
    if (action === "library") { this.goLibrary(); return; }
    if (action === "start" && this.currentPuzzle) {
      this.busy = true;
      this.render();
      void Promise.resolve(this.options.onStart(this.currentPuzzle.id)).catch(error => {
        console.error("Puzzle start failed", error);
        this.actionError = error instanceof Error ? error.message : String(error);
        this.busy = false;
        this.render();
      }).finally(() => { this.busy = false; });
      return;
    }
    if (action === "retry" && this.currentPuzzle) {
      this.busy = true;
      void Promise.resolve(this.options.onRetry?.(this.currentPuzzle.id)).catch(error => {
        console.error("Puzzle retry failed", error);
        this.actionError = error instanceof Error ? error.message : String(error);
        this.busy = false;
        this.render();
      }).finally(() => { this.busy = false; });
      return;
    }
    if (action === "next" && this.currentPuzzle) {
      const next = this.puzzles.find(candidate => candidate.index === this.currentPuzzle!.index + 1);
      if (next) this.showBriefing(next.id);
      return;
    }
    if (action === "restart" && this.currentPuzzle) {
      this.busy = true;
      void Promise.resolve(this.options.onRetry?.(this.currentPuzzle.id)).catch(error => {
        console.error("Puzzle restart failed", error);
        this.actionError = error instanceof Error ? error.message : String(error);
        this.busy = false;
        this.render();
      }).finally(() => { this.busy = false; });
      return;
    }
    if (action === "hint" && this.currentPuzzle) {
      if (!this.hintOpen) {
        this.activeHintLevel = 1;
        this.hintOpen = true;
        void Promise.resolve(this.options.onHint?.(this.currentPuzzle.id, this.activeHintLevel));
      } else if (this.activeHintLevel < 2) {
        this.activeHintLevel = 2;
        void Promise.resolve(this.options.onHint?.(this.currentPuzzle.id, 2));
      } else {
        this.hintOpen = false;
      }
      this.render();
    }
  };

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.screen !== "playing") {
      event.preventDefault();
      if (this.screen === "library") this.leave();
      else this.goLibrary();
    }
  };
}

export type PuzzleUiLanguage = LanguageCode;
