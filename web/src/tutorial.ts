import { progressStorage } from "./progress-storage";
import { PLATFORM } from "./platform";
import { soloCopy, writeSoloIntro } from "./crazygames-solo";
import { gameplay } from "./poki-sdk";
/**
 * 기초: 장외 → 방향 조절 → 미니 대전. 심화: 기존 5단계 기물 특성 연습.
 */

import type { PieceInstance } from "./layout";
import type { MetaRuntime } from "./meta";
import { saveMetaState } from "./meta";
import { I18nManager } from "./i18n";
import { marketingRuntime } from "./marketing-runtime";
import { getRuntimeText } from "./runtime-text";
import { Vector3 } from "three";
import { computeEffectiveMaxDragPixels, type InputRuntime } from "./input";
import { MOUSE_POWER_EXPONENT, pullDistanceForPower } from "./power-controls";
import { getSupabaseClient } from "./supabase-client";
import { cancelItchAuth, startItchAuth } from "./itch-auth";
import { feedbackCopy, isPracticePower } from "./feedback-copy";
import { isCoarsePointerEnvironment } from "./input-capability";

export type TutorialType = "basic" | "advanced";

export function getTutorialInputMode(step: number, type: TutorialType): "classic" | "billiards" {
  return type === "advanced" && step >= 3 ? "billiards" : "classic";
}

export interface TutorialStepInfo {
  step: number;
  title: string;
  mission: string;
  guide: string;
  successMessage: string;
}

export function getTutorialStepInfo(
  step: number,
  type: TutorialType = "basic",
): TutorialStepInfo {
  const prefix = type === "advanced" ? "tutorial.adv_step" : "tutorial.step";
  const s = Math.max(1, Math.min(type === "basic" ? 3 : 5, step));
  return {
    step: s,
    title: I18nManager.t(`${prefix}${s}_title`),
    mission: PLATFORM.features.solo && type === "basic" && s === 3 ? soloCopy().goal : I18nManager.t(`${prefix}${s}_mission`),
    guide: PLATFORM.features.solo && type === "basic" && s === 3 ? soloCopy().pull : I18nManager.t(`${prefix}${s}_guide`),
    successMessage: I18nManager.t(`${prefix}${s}_success`),
  };
}

export class TutorialManager {
  public currentStep: number = 1;
  public tutorialType: TutorialType = "basic";
  public isActive: boolean = false;
  public isTransitioning = false;
  public quickIntro = false;
  public powerPractice = false;
  private practicePower: number | null = null;
  private practiceModalCleanup: (() => void) | null = null;
  private showItchSignIn = false;
  private itchAuthBusy = false;
  private itchAuthStarted = false;
  private itchAuthStatus = "";
  private generation = 0;
  public get sessionToken(): number { return this.generation; }
  private completionModal: HTMLElement | null = null;
  private rewardRequest = 0;
  private overlayElement: HTMLElement | null = null;
  private gestureElement: SVGSVGElement | null = null;
  private nextControl: HTMLElement | null = null;
  private kingSwapped = false;
  private readonly guidePoint = new Vector3();
  private coachResizeObserver: ResizeObserver | null = null;
  private onStepCompletedCallback: ((nextStep: number) => Promise<void>) | null = null;
  private onTutorialFinishedCallback: ((destination?: "stage" | "power") => Promise<void>) | null = null;
  private metaRuntime: MetaRuntime | null = null;

  /**
   * 튜토리얼 런타임 초기화
   */
  public init(
    metaRuntime: MetaRuntime,
    onStepCompleted: (nextStep: number) => Promise<void>,
    onTutorialFinished: (destination?: "stage" | "power") => Promise<void>,
  ): void {
    this.metaRuntime = metaRuntime;
    this.onStepCompletedCallback = onStepCompleted;
    this.onTutorialFinishedCallback = onTutorialFinished;
  }

  /**
   * 튜토리얼 모드 시작 (1단계부터)
   */
  public start(
    startStep: number = 1,
    tutorialType: TutorialType = "basic",
    quickIntro = false,
    powerPractice = false,
  ): void {
    this.stop();
    this.isActive = true;
    this.tutorialType = tutorialType;
    this.powerPractice = powerPractice;
    this.practicePower = null;
    this.quickIntro = quickIntro && !powerPractice && tutorialType === "basic" && PLATFORM.features.solo;
    this.showItchSignIn = PLATFORM.id === "itch" && this.quickIntro && progressStorage.owner === null;
    this.currentStep = Math.max(1, Math.min(this.stepCount, startStep));
    if (!powerPractice && tutorialType === "basic" && progressStorage.getItem("has_completed_tutorial") === null) {
      progressStorage.setItem("has_completed_tutorial", "started");
    }
    document.body.dataset.tutorial = tutorialType;
    this.renderCoachOverlay();
  }

  public get stepCount(): number { return this.tutorialType === "basic" ? 3 : 5; }
  public get isMatchStep(): boolean { return this.isActive && !this.powerPractice && this.currentStep === this.stepCount; }

  public recordPracticeShot(power: number): void {
    if (this.powerPractice && this.isActive && !this.isTransitioning) this.practicePower = power;
  }

  /**
   * 튜토리얼 모드 종료 및 UI 제거
   */
  public stop(): void {
    if (PLATFORM.id === "itch" && this.itchAuthStarted) void cancelItchAuth();
    this.itchAuthStarted = false;
    this.itchAuthBusy = false;
    this.itchAuthStatus = "";
    this.showItchSignIn = false;
    this.generation += 1;
    this.isTransitioning = false;
    this.isActive = false;
    this.quickIntro = false;
    this.powerPractice = false;
    this.practicePower = null;
    this.practiceModalCleanup?.(); this.practiceModalCleanup = null;
    this.kingSwapped = false;
    this.gestureElement?.remove();
    this.gestureElement = null;
    this.nextControl?.classList.remove("tutorial-next-control");
    this.nextControl = null;
    delete document.body.dataset.tutorial;
    this.coachResizeObserver?.disconnect();
    this.coachResizeObserver = null;
    document.body.style.removeProperty("--tutorial-coach-height");
    this.completionModal?.remove();
    this.completionModal = null;
    if (this.overlayElement) {
      this.overlayElement.remove();
      this.overlayElement = null;
    }
  }

  /**
   * 단계별 기물 배치 생성
   */
  public getStepPieces(
    step: number,
    type: TutorialType = this.tutorialType,
  ): PieceInstance[] {
    if (this.powerPractice) return [
      { id: "white-pawn-d4", type: "Pawn", side: "white", startingSquare: { file: "d", rank: 4 } },
      { id: "black-pawn-h8", type: "Pawn", side: "black", startingSquare: { file: "h", rank: 8 } },
    ];
    if (type === "basic") {
      // Real starting-square spawns, with the first target close to the edge.
      if (step === 1) return [
        { id: "white-pawn-d6", type: "Pawn", side: "white", startingSquare: { file: "d", rank: 6 } },
        { id: "black-pawn-d8", type: "Pawn", side: "black", startingSquare: { file: "d", rank: 8 } },
      ];
      if (step === 2) return [
        { id: "white-pawn-c5", type: "Pawn", side: "white", startingSquare: { file: "c", rank: 5 } },
        { id: "black-pawn-f8", type: "Pawn", side: "black", startingSquare: { file: "f", rank: 8 } },
      ];
      return [
        { id: "white-pawn-c2", type: "Pawn", side: "white", startingSquare: { file: "c", rank: 2 } },
        { id: "white-rook-d3", type: "Rook", side: "white", startingSquare: { file: "d", rank: 3 } },
        { id: "white-king-e1", type: "King", side: "white", startingSquare: { file: "e", rank: 1 } },
        { id: "black-pawn-c7", type: "Pawn", side: "black", startingSquare: { file: "c", rank: 7 } },
        { id: "black-pawn-f7", type: "Pawn", side: "black", startingSquare: { file: "f", rank: 7 } },
        { id: "black-king-d8", type: "King", side: "black", startingSquare: { file: "d", rank: 8 } },
      ];
    }

    // type === "advanced"
    switch (step) {
      case 1:
        // Step 1: 폰(Pawn) 슬링샷 기본 발사와 전진/승급
        return [
          {
            id: "white-pawn-d2",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "d", rank: 2 },
          },
          {
            id: "black-pawn-d6",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "d", rank: 6 },
          },
        ];

      case 2:
        // Step 2: 나이트(Knight) 65도 포물선 도약 기믹 (앞 폰을 뛰어넘어 적 타격)
        return [
          {
            id: "white-knight-d2",
            type: "Knight",
            side: "white",
            startingSquare: { file: "d", rank: 2 },
          },
          {
            id: "white-pawn-d4",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "d", rank: 4 },
          },
          {
            id: "black-pawn-d7",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "d", rank: 7 },
          },
        ];

      case 3:
        // Step 3: 비숍(Bishop) 스핀 쿠션 마스터 기믹 (타점 설정 후 스핀 타격)
        return [
          {
            id: "white-bishop-d2",
            type: "Bishop",
            side: "white",
            startingSquare: { file: "d", rank: 2 },
          },
          {
            id: "black-pawn-d6",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "d", rank: 6 },
          },
        ];

      case 4:
        // Step 4: 킹(King)의 특수 생존기: 스왑과 철벽 방어 (전방 폰과 스왑 후 적 장외)
        return [
          {
            id: "white-king-d2",
            type: "King",
            side: "white",
            startingSquare: { file: "d", rank: 2 },
          },
          {
            id: "white-pawn-f6",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "f", rank: 6 },
          },
          {
            id: "black-pawn-f8",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "f", rank: 8 },
          },
        ];

      case 5:
      default:
        // Step 5: 기믹 총동원 실전 미니 대전
        return [
          {
            id: "white-pawn-d2",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "d", rank: 2 },
          },
          {
            id: "white-knight-b1",
            type: "Knight",
            side: "white",
            startingSquare: { file: "b", rank: 1 },
          },
          {
            id: "white-bishop-f1",
            type: "Bishop",
            side: "white",
            startingSquare: { file: "f", rank: 1 },
          },
          {
            id: "white-queen-d1",
            type: "Queen",
            side: "white",
            startingSquare: { file: "d", rank: 1 },
          },
          {
            id: "white-king-e1",
            type: "King",
            side: "white",
            startingSquare: { file: "e", rank: 1 },
          },
          {
            id: "black-pawn-d7",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "d", rank: 7 },
          },
          {
            id: "black-knight-b8",
            type: "Knight",
            side: "black",
            startingSquare: { file: "b", rank: 8 },
          },
          {
            id: "black-king-e8",
            type: "King",
            side: "black",
            startingSquare: { file: "e", rank: 8 },
          },
        ];
    }
  }

  /**
   * 턴 종료 시 물리 판정을 바탕으로 스텝 클리어 여부 검사
   */
  public checkStepClear(
    remainingBlackPieceCount: number,
    remainingBlackPieces: Array<{ type: string }>,
    hadWhiteHitBlack: boolean,
    hasCustomStrikePoint: boolean = false,
  ): { cleared: boolean; hint?: string } {
    if (!this.isActive) return { cleared: false };
    if (this.powerPractice) return {
      cleared: this.practicePower !== null && isPracticePower(this.practicePower),
      hint: this.practicePower === null ? feedbackCopy().practiceGuide : feedbackCopy().practiceMiss(Math.round(this.practicePower * 100)),
    };

    if (this.tutorialType === "basic") {
      return { cleared: this.currentStep < 3 || PLATFORM.features.solo
        ? remainingBlackPieceCount === 0
        : !remainingBlackPieces.some(p => p.type === "King") };
    }

    switch (this.currentStep) {
      case 1:
        return { cleared: hadWhiteHitBlack || remainingBlackPieceCount === 0 };

      case 2:
        return { cleared: hadWhiteHitBlack || remainingBlackPieceCount === 0 };

      case 3:
        if (!hasCustomStrikePoint) {
          const hintKey =
            this.tutorialType === "advanced"
              ? "tutorial.adv_step3_hint"
              : "tutorial.step3_hint";
          return {
            cleared: false,
            hint: I18nManager.t(hintKey),
          };
        }
        return { cleared: hadWhiteHitBlack || remainingBlackPieceCount === 0 };

      case 4:
        return { cleared: remainingBlackPieceCount === 0 };

      case 5:
        return { cleared: !remainingBlackPieces.some((p) => p.type === "King") };

      default:
        return { cleared: false };
    }
  }

  /**
   * 현재 단계 완료 처리 및 다음 단계 전환 / 최종 완료 연출
   */
  public async handleStepSuccess(): Promise<void> {
    if (!this.isActive || this.isTransitioning) return;
    this.isTransitioning = true;
    const generation = this.generation;
    if (this.powerPractice) {
      this.showPracticeChoice(true);
      return;
    }
    const stepInfo = getTutorialStepInfo(this.currentStep, this.tutorialType);

    this.updateCoachMessage(stepInfo.successMessage, true);

    await new Promise((r) => setTimeout(r, 1200));
    if (!this.isActive || this.generation !== generation) return;

    if (this.quickIntro) {
      // One real knockout is the quick introduction, not the full three-step
      // basic tutorial. Its existing 100P reward remains attached to that course.
      writeSoloIntro(progressStorage.owner, "complete");
      this.showPracticeChoice(false);
      return;
    }

    if (this.currentStep < this.stepCount) {
      const nextStep = this.currentStep + 1;
      this.currentStep = nextStep;
      this.renderCoachOverlay();
      if (this.onStepCompletedCallback) {
        await this.onStepCompletedCallback(nextStep);
      }
      if (this.generation === generation) this.isTransitioning = false;
    } else {
      this.completeTutorial();
    }
  }

  public async retryStep(): Promise<void> {
    if (!this.isActive || this.isTransitioning) return;
    this.isTransitioning = true;
    const generation = this.generation;
    await new Promise(r => setTimeout(r, 1200));
    if (!this.isActive || this.generation !== generation) return;
    this.kingSwapped = false;
    this.practicePower = null;
    await this.onStepCompletedCallback?.(this.currentStep);
    if (this.generation === generation) {
      this.isTransitioning = false;
      this.renderCoachOverlay();
    }
  }

  /**
   * 실패 시 힌트 메시지 표시
   */
  public showFailureHint(hint: string): void {
    if (!this.overlayElement) return;
    const guideEl = this.overlayElement.querySelector<HTMLElement>(".tutorial-guide-text");
    if (guideEl) {
      guideEl.style.color = "#f87171";
      guideEl.textContent = hint;
    }
  }

  /**
   * 튜토리얼 최종 완료 및 100P 보상 지급
   */
  public completeTutorial(): void {
    if (!this.isActive) return;
    if (this.powerPractice) { this.showPracticeChoice(true); return; }
    marketingRuntime.tutorialComplete(this.tutorialType);
    const type = this.tutorialType;
    // A fresh profile has only in-memory defaults. Seed it once, never on a retry.
    if (this.metaRuntime && progressStorage.getItem("chessAlkkagi.meta.points") === null &&
      progressStorage.getItem("chessAlkkagi.meta.upgrades") === null) {
      saveMetaState(this.metaRuntime);
    }
    this.showCompletionModal();
    void this.settleCompletionReward(type);
  }

  private async settleCompletionReward(type: TutorialType): Promise<void> {
    const modal = this.completionModal;
    const runtime = this.metaRuntime;
    if (!modal || !runtime) return;
    const request = ++this.rewardRequest;
    const owner = progressStorage.owner;
    let status = modal.querySelector<HTMLElement>(".tutorial-reward-status");
    if (!status) {
      status = document.createElement("p");
      status.className = "tutorial-reward-status";
      status.setAttribute("role", "status");
      modal.querySelector(".tutorial-modal-card > p")?.after(status);
    }
    status.textContent = getRuntimeText("tutorial.reward_saving");
    modal.querySelector(".tutorial-reward-retry")?.remove();
    const result = owner
      ? await progressStorage.claimTutorialReward(type)
      : progressStorage.claimGuestTutorialReward(type);
    if (owner === progressStorage.owner && runtime === this.metaRuntime) {
      const points = progressStorage.getItem("chessAlkkagi.meta.points");
      if (points !== null) runtime.state.points = Number(points);
    }
    if (modal !== this.completionModal || request !== this.rewardRequest || owner !== progressStorage.owner) return;
    if (result !== "pending") {
      status.textContent = getRuntimeText(result === "granted" ? "tutorial.reward_granted" : "tutorial.reward_repeat");
      return;
    }
    status.textContent = getRuntimeText("tutorial.reward_pending");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "tutorial-reward-retry";
    retry.textContent = getRuntimeText("tutorial.reward_retry");
    retry.addEventListener("click", () => { retry.disabled = true; void this.settleCompletionReward(type); });
    status.after(retry);
  }

  /**
   * 상단 코치 가이드 오버레이 렌더링
   */
  public renderCoachOverlay(): void {
    if (!this.isActive) return;
    if (!this.overlayElement) {
      this.overlayElement = document.createElement("div");
      this.overlayElement.className = "tutorial-coach-overlay";
      document.body.appendChild(this.overlayElement);
      this.coachResizeObserver = new ResizeObserver(() => {
        if (this.overlayElement) document.body.style.setProperty(
          "--tutorial-coach-height", `${this.overlayElement.offsetHeight}px`,
        );
      });
      this.coachResizeObserver.observe(this.overlayElement);
    }

    const stepInfo = getTutorialStepInfo(this.currentStep, this.tutorialType);
    const practice = this.powerPractice ? feedbackCopy() : null;
    const rawBadge =
      this.tutorialType === "advanced"
        ? I18nManager.t("lobby.mode_tutorial_advanced")
        : I18nManager.t("lobby.mode_tutorial");
    const badgePrefix = rawBadge.replace(/\n/g, " ");

    this.overlayElement.innerHTML = `
      <div class="tutorial-coach-card">
        <div class="tutorial-coach-header">
          <span class="tutorial-step-badge">${practice ? practice.practiceTitle : this.quickIntro ? soloCopy().quick : `${badgePrefix} ${this.currentStep}/${this.stepCount}`}</span>
          <strong class="tutorial-step-title">${practice ? "30–50%" : this.quickIntro ? soloCopy().pull : stepInfo.title}</strong>
          <button type="button" class="tutorial-skip-button">${practice ? practice.practiceExit : this.quickIntro ? soloCopy().skip : I18nManager.t("tutorial.skip_btn")}</button>
        </div>
        <div class="tutorial-mission-text">${practice ? practice.practiceGoal : this.quickIntro ? soloCopy().goal : stepInfo.mission}</div>
        <div class="tutorial-guide-text">${practice ? practice.practiceGuide : (this.tutorialType === "basic" && this.currentStep < 3) || (this.tutorialType === "advanced" && this.currentStep === 4) ? "" : stepInfo.guide}</div>
        ${this.showItchSignIn ? `<div class="tutorial-itch-auth"><button type="button" class="tutorial-itch-sign-in">Sign in with itch.io</button><button type="button" class="tutorial-itch-cancel"${this.itchAuthBusy ? "" : " hidden"}>Cancel sign-in</button><p class="tutorial-itch-status" role="status" aria-live="polite"></p></div>` : ""}
      </div>
    `;
    this.updateItchAuthControls();
    this.overlayElement.querySelector<HTMLButtonElement>(".tutorial-itch-sign-in")?.addEventListener("click", () => {
      if (PLATFORM.id !== "itch") return;
      const client = getSupabaseClient();
      if (!client) { this.setItchAuthStatus(I18nManager.t("lobby.supabase_not_configured"), false); return; }
      this.itchAuthStarted = true;
      const generation = this.generation;
      startItchAuth(client, false, (message, busy) => {
        if (this.generation === generation && this.isActive) this.setItchAuthStatus(message, busy);
      });
    });
    this.overlayElement.querySelector<HTMLButtonElement>(".tutorial-itch-cancel")?.addEventListener("click", async () => {
      if (PLATFORM.id !== "itch") return;
      if (!await cancelItchAuth()) return;
      this.itchAuthStarted = false;
      this.setItchAuthStatus("Itch.io sign-in cancelled.", false);
    });
    this.overlayElement.querySelector<HTMLButtonElement>(".tutorial-skip-button")?.addEventListener("click", async (event) => {
      if (!this.isActive) return;
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      if (PLATFORM.id === "itch" && this.itchAuthStarted && !await cancelItchAuth()) { button.disabled = false; return; }
      this.itchAuthStarted = false;
      const quick = this.quickIntro;
      if (quick) writeSoloIntro(progressStorage.owner, "skipped");
      if (!this.powerPractice && this.tutorialType === "basic" && progressStorage.getItem("has_completed_tutorial") !== "true") {
        progressStorage.setItem("has_completed_tutorial", "skipped");
      }
      this.stop();
      await this.onTutorialFinishedCallback?.(quick ? "stage" : undefined);
    });
  }

  private setItchAuthStatus(message: string, busy: boolean): void {
    this.itchAuthStatus = message;
    this.itchAuthBusy = busy;
    this.updateItchAuthControls();
  }

  private updateItchAuthControls(): void {
    if (!this.overlayElement) return;
    const signIn = this.overlayElement.querySelector<HTMLButtonElement>(".tutorial-itch-sign-in");
    const cancel = this.overlayElement.querySelector<HTMLButtonElement>(".tutorial-itch-cancel");
    const status = this.overlayElement.querySelector<HTMLElement>(".tutorial-itch-status");
    if (signIn) signIn.disabled = this.itchAuthBusy;
    if (cancel) cancel.hidden = !this.itchAuthBusy;
    if (status) status.textContent = this.itchAuthStatus;
  }

  public showKingSwapFollowup(): void {
    if (!this.isActive || this.tutorialType !== "advanced" || this.currentStep !== 4) return;
    this.kingSwapped = true;
    const mission = this.overlayElement?.querySelector(".tutorial-mission-text");
    if (mission) mission.textContent = I18nManager.t("tutorial.adv_step4_after_swap");
  }

  /** A non-interactive cue follows the real piece; input, menus and scene exits hide it. */
  public updateInputGuide(input: InputRuntime): void {
    if (!this.isActive) return;
    const idle = !this.isTransitioning && !input.policy.isInputBlocked() && input.activePointerId === null && input.cameraTransition === null;
    const bishop = this.tutorialType === "advanced" && this.currentStep === 3;
    const king = this.tutorialType === "advanced" && this.currentStep === 4;
    const action = idle && input.aimRuntime.selectedPieceId !== null
      ? bishop ? (input.strikeMode && input.aimParametersRuntime.strikePointOverride !== null ? "launch" : !input.strikeMode && input.aimParametersRuntime.strikePointOverride === null ? "strike" : null)
      : king && !this.kingSwapped && !input.kingSwapMode ? "swap" : null : null;
    const next = action ? input.actionBar.querySelector<HTMLElement>(`[data-action="${action}"]`) : null;
    if (next !== this.nextControl) {
      this.nextControl?.classList.remove("tutorial-next-control");
      next?.classList.add("tutorial-next-control");
      this.nextControl = next;
    }
    const firstShot = this.tutorialType === "basic" && this.currentStep === 1;
    const showPull = firstShot || (king && this.kingSwapped && input.mode === "billiards" && input.aimRuntime.selectedPieceId !== null && !input.strikeMode);
    const pieceId = firstShot ? this.powerPractice ? "white-pawn-d4" : "white-pawn-d6" : bishop && input.aimRuntime.selectedPieceId === null ? "white-bishop-d2" : king && !this.kingSwapped ? (input.kingSwapMode ? "white-pawn-f6" : input.aimRuntime.selectedPieceId === null ? "white-king-d2" : null) : null;
    const mesh = pieceId ? input.sceneRuntime.pieceMeshes.get(pieceId) : showPull ? input.aimParametersRuntime.redDot : undefined;
    if (!idle || !mesh || !mesh.visible || (pieceId && !input.policy.canSelectPiece(pieceId))) {
      if (this.gestureElement) this.gestureElement.style.display = "none";
      return;
    }
    if (!this.gestureElement) {
      this.gestureElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.gestureElement.classList.add("tutorial-gesture");
      this.gestureElement.setAttribute("aria-hidden", "true");
      this.gestureElement.innerHTML = '<circle r="16"/><path/>';
      document.body.append(this.gestureElement);
    }
    const canvas = input.sceneRuntime.renderer.domElement.getBoundingClientRect();
    mesh.getWorldPosition(this.guidePoint).project(input.sceneRuntime.camera);
    const x = canvas.left + (this.guidePoint.x + 1) * canvas.width / 2;
    const y = canvas.top + (1 - this.guidePoint.y) * canvas.height / 2;
    const isTouch = isCoarsePointerEnvironment();
    const guideDistance = computeEffectiveMaxDragPixels(
      { pointerType: isTouch ? "touch" : "mouse" }, canvas.height, canvas.width,
    );
    const end = Math.min(y + pullDistanceForPower(0.4, guideDistance, isTouch ? 1 : MOUSE_POWER_EXPONENT), canvas.bottom - 12);
    this.gestureElement.style.display = this.guidePoint.z < -1 || this.guidePoint.z > 1 ? "none" : "block";
    const circle = this.gestureElement.querySelector("circle")!;
    circle.setAttribute("cx", String(x)); circle.setAttribute("cy", String(y));
    const pullLength = Math.max(0, end - y);
    const radius = Math.min(16, pullLength / 4);
    const arrow = Math.min(7, pullLength / 4);
    circle.setAttribute("r", String(showPull ? radius : 16));
    this.gestureElement.querySelector("path")!.setAttribute("d", showPull && pullLength > 4 ? `M ${x} ${y + radius + 1} V ${end} m ${-arrow} ${-arrow} l ${arrow} ${arrow} l ${arrow} ${-arrow}` : "");
  }

  /**
   * 코치 말풍선 문구 갱신
   */
  private updateCoachMessage(message: string, isSuccess = false): void {
    if (!this.overlayElement) return;
    const missionEl = this.overlayElement.querySelector<HTMLElement>(".tutorial-mission-text");
    const guideEl = this.overlayElement.querySelector<HTMLElement>(".tutorial-guide-text");

    if (missionEl && isSuccess) {
      missionEl.style.color = "#4ade80";
      missionEl.textContent = message;
    }
    if (guideEl && isSuccess) {
      guideEl.style.color = "#93c5fd";
      guideEl.textContent = "";
    }
  }

  /** Optional, reward-free practice never completes or pays for a tutorial course. */
  private showPracticeChoice(practiceComplete: boolean): void {
    this.stop();
    gameplay.leave("power-practice-choice");
    const copy = feedbackCopy();
    const modal = document.createElement("div");
    modal.className = "tutorial-modal-overlay feedback-practice-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "feedback-practice-heading");
    const card = document.createElement("div"); card.className = "tutorial-modal-card";
    const heading = document.createElement("h2"); heading.id = "feedback-practice-heading";
    heading.textContent = practiceComplete ? copy.practiceSuccess : copy.firstSuccess;
    const description = document.createElement("p");
    description.textContent = practiceComplete ? copy.practiceNoReward : copy.firstNext;
    const actions = document.createElement("div"); actions.className = "feedback-practice-actions";
    const status = document.createElement("p"); status.setAttribute("role", "status");
    const addAction = (label: string, destination: "stage" | "power" | undefined, id: string) => {
      const button = document.createElement("button"); button.textContent = label; button.id = id;
      button.onclick = async () => {
        if (button.disabled) return;
        const buttons = Array.from(actions.querySelectorAll("button"));
        buttons.forEach(item => item.disabled = true);
        try {
          await this.onTutorialFinishedCallback?.(destination);
          modal.remove();
        } catch {
          if (modal.isConnected) {
            status.textContent = I18nManager.t("common.retry");
            buttons.forEach(item => item.disabled = false);
          }
        }
      };
      actions.append(button); return button;
    };
    if (!practiceComplete) addAction(copy.startStage, "stage", "feedback-start-stage");
    addAction(practiceComplete ? copy.practiceRetry : copy.practice, "power", "feedback-practice-again");
    const exit = addAction(copy.menu, undefined, "feedback-practice-menu");
    card.append(heading, description, actions, status); modal.append(card);
    this.completionModal = modal; document.body.append(modal);
    const keyboard = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); exit.click(); }
      if (event.key === "Tab") {
        const buttons = Array.from(actions.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    modal.addEventListener("keydown", keyboard);
    this.practiceModalCleanup = () => modal.removeEventListener("keydown", keyboard);
    actions.querySelector<HTMLButtonElement>("button")?.focus();
  }

  /**
   * 튜토리얼 최종 완료 축하 팝업 모달
   */
  private showCompletionModal(): void {
    gameplay.leave("tutorial-complete");
    this.stop();

    const modal = document.createElement("div");
    modal.className = "tutorial-modal-overlay";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", I18nManager.t(this.tutorialType === "basic" ? "tutorial.basic_complete_title" : "tutorial.adv_complete_title"));
    this.completionModal = modal;

    if (this.tutorialType === "basic") {
      modal.innerHTML = `
        <div class="tutorial-modal-card" style="max-width:380px;">
          <h2 style="margin:0 0 10px 0; font-size:22px; color:#38bdf8; font-weight:800;">${I18nManager.t("tutorial.basic_complete_title")}</h2>
          <p style="margin:0 0 16px 0; font-size:14px; color:#cbd5e1; line-height:1.5;">
            ${PLATFORM.features.solo ? soloCopy().goal : I18nManager.t("tutorial.basic_complete_desc").split("<br>")[0]}
          </p>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <button id="btn-tutorial-start-stage" style="background:#2563eb; color:white; border:none; border-radius:8px; padding:14px 20px; font-size:15px; font-weight:700; cursor:pointer; width:100%;">
              ${I18nManager.t("tutorial.basic_complete_accept")}
            </button>
            <button id="btn-tutorial-decline-adv" style="background:#334155; color:#cbd5e1; border:none; border-radius:8px; padding:12px 20px; font-size:14px; font-weight:600; cursor:pointer; width:100%;">
              ${I18nManager.t("tutorial.basic_complete_decline")}
            </button>
          </div>
          <button id="btn-tutorial-accept-adv" class="tutorial-more-button">${I18nManager.t("lobby.tutorial_advanced")}</button>
        </div>
      `;

      document.body.appendChild(modal);
      modal.querySelector("#btn-tutorial-start-stage")?.addEventListener("click", async () => {
        modal.remove();
        await this.onTutorialFinishedCallback?.("stage");
      });

      modal.querySelector("#btn-tutorial-accept-adv")?.addEventListener("click", async () => {
        if (PLATFORM.id === "poki") await gameplay.beforeNewMatch();
        modal.remove();
        this.start(1, "advanced");
        if (this.onStepCompletedCallback) {
          await this.onStepCompletedCallback(1);
        }
        gameplay.enter("tutorial-advanced");
      });

      modal.querySelector("#btn-tutorial-decline-adv")?.addEventListener("click", async () => {
        modal.remove();
        if (this.onTutorialFinishedCallback) {
          await this.onTutorialFinishedCallback();
        }
      });
    } else {
      modal.innerHTML = `
        <div class="tutorial-modal-card" style="max-width:380px;">
          <h2 style="margin:0 0 10px 0; font-size:22px; color:#38bdf8; font-weight:800;">${I18nManager.t("tutorial.adv_complete_title")}</h2>
          <p style="margin:0 0 16px 0; font-size:14px; color:#cbd5e1; line-height:1.5;">
            ${I18nManager.t("tutorial.adv_complete_desc").split("<br>")[0]}
          </p>
          <button id="btn-tutorial-finish" style="background:#16a34a; color:white; border:none; border-radius:8px; padding:14px 28px; font-size:15px; font-weight:700; cursor:pointer; width:100%;">
            ${I18nManager.t("tutorial.adv_complete_btn")}
          </button>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelector("#btn-tutorial-finish")?.addEventListener("click", async () => {
        modal.remove();
        if (this.onTutorialFinishedCallback) {
          await this.onTutorialFinishedCallback();
        }
      });
    }
    modal.querySelector<HTMLButtonElement>("button")?.focus();
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        modal.querySelector<HTMLButtonElement>("#btn-tutorial-decline-adv, #btn-tutorial-finish")?.click();
      } else if (event.key === "Tab") {
        const buttons = Array.from(modal.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
  }

  /**
   * 최초 접속 시 튜토리얼 권장 팝업 표시 (로컬스토리지 확인)
   */
  public static checkFirstVisitAndPrompt(
    onStartTutorial: () => void,
    onSkip: () => void,
  ): void {
    const isCompleted = progressStorage.getItem("has_completed_tutorial");
    if (isCompleted) {
      return;
    }

    if (document.querySelector(".tutorial-modal-overlay")) {
      return;
    }

    const modal = document.createElement("div");
    modal.className = "tutorial-modal-overlay";
    modal.innerHTML = `
      <div class="tutorial-modal-card">
        <h2 style="margin:0 0 10px 0; font-size:20px; color:#f8fafc; font-weight:800;">${I18nManager.t("tutorial.welcome_title")}</h2>
        <p style="margin:0 0 20px 0; font-size:14px; color:#94a3b8; line-height:1.5;">
          ${I18nManager.t("tutorial.welcome_desc")}
        </p>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <button id="btn-start-tutorial-prompt" style="background:#2563eb; color:white; border:none; border-radius:8px; padding:14px; font-size:15px; font-weight:700; cursor:pointer;">
            ${I18nManager.t("tutorial.welcome_start_btn")}
          </button>
          <button id="btn-skip-tutorial-prompt" style="background:transparent; color:#94a3b8; border:1px solid #475569; border-radius:8px; padding:12px; font-size:13px; font-weight:600; cursor:pointer;">
            ${I18nManager.t("tutorial.welcome_skip_btn")}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#btn-start-tutorial-prompt")?.addEventListener("click", () => {
      progressStorage.setItem("has_completed_tutorial", "started");
      modal.remove();
      onStartTutorial();
    });

    modal.querySelector("#btn-skip-tutorial-prompt")?.addEventListener("click", () => {
      progressStorage.setItem("has_completed_tutorial", "skipped");
      modal.remove();
      onSkip();
    });
  }
}

export const tutorialManager = new TutorialManager();
