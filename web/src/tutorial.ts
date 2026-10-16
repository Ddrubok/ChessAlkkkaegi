import { progressStorage } from "./progress-storage";
/**
 * 기초: 장외 → 방향 조절 → 미니 대전. 심화: 기존 5단계 기물 특성 연습.
 */

import type { PieceInstance } from "./layout";
import type { MetaRuntime } from "./meta";
import { saveMetaState } from "./meta";
import { I18nManager } from "./i18n";

export type TutorialType = "basic" | "advanced";

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
    mission: I18nManager.t(`${prefix}${s}_mission`),
    guide: I18nManager.t(`${prefix}${s}_guide`),
    successMessage: I18nManager.t(`${prefix}${s}_success`),
  };
}

export class TutorialManager {
  public currentStep: number = 1;
  public tutorialType: TutorialType = "basic";
  public isActive: boolean = false;
  public isTransitioning = false;
  private generation = 0;
  private completionModal: HTMLElement | null = null;
  private overlayElement: HTMLElement | null = null;
  private coachResizeObserver: ResizeObserver | null = null;
  private onStepCompletedCallback: ((nextStep: number) => Promise<void>) | null = null;
  private onTutorialFinishedCallback: ((destination?: "stage") => Promise<void>) | null = null;
  private metaRuntime: MetaRuntime | null = null;

  /**
   * 튜토리얼 런타임 초기화
   */
  public init(
    metaRuntime: MetaRuntime,
    onStepCompleted: (nextStep: number) => Promise<void>,
    onTutorialFinished: (destination?: "stage") => Promise<void>,
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
  ): void {
    this.stop();
    this.isActive = true;
    this.tutorialType = tutorialType;
    this.currentStep = Math.max(1, Math.min(this.stepCount, startStep));
    document.body.dataset.tutorial = tutorialType;
    this.renderCoachOverlay();
  }

  public get stepCount(): number { return this.tutorialType === "basic" ? 3 : 5; }
  public get isMatchStep(): boolean { return this.isActive && this.currentStep === this.stepCount; }

  /**
   * 튜토리얼 모드 종료 및 UI 제거
   */
  public stop(): void {
    this.generation += 1;
    this.isTransitioning = false;
    this.isActive = false;
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

    if (this.tutorialType === "basic") {
      return { cleared: this.currentStep < 3
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
    const stepInfo = getTutorialStepInfo(this.currentStep, this.tutorialType);

    this.updateCoachMessage(stepInfo.successMessage, true);

    await new Promise((r) => setTimeout(r, 1200));
    if (!this.isActive || this.generation !== generation) return;

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
    const storageKey =
      this.tutorialType === "advanced"
        ? "has_completed_adv_tutorial"
        : "has_completed_tutorial";
    progressStorage.setItem(storageKey, "true");

    if (this.metaRuntime) {
      this.metaRuntime.state.points += 100;
      saveMetaState(this.metaRuntime);
    }

    this.showCompletionModal();
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
    const rawBadge =
      this.tutorialType === "advanced"
        ? I18nManager.t("lobby.mode_tutorial_advanced")
        : I18nManager.t("lobby.mode_tutorial");
    const badgePrefix = rawBadge.replace(/\n/g, " ");

    this.overlayElement.innerHTML = `
      <div class="tutorial-coach-card">
        <div class="tutorial-coach-header">
          <span class="tutorial-step-badge">${badgePrefix} ${this.currentStep}/${this.stepCount}</span>
          <strong class="tutorial-step-title">${stepInfo.title}</strong>
        </div>
        <div class="tutorial-mission-text">${stepInfo.mission}</div>
        <div class="tutorial-guide-text">${stepInfo.guide}</div>
      </div>
    `;
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

  /**
   * 튜토리얼 최종 완료 축하 팝업 모달
   */
  private showCompletionModal(): void {
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
            ${I18nManager.t("tutorial.basic_complete_desc")}
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
        modal.remove();
        this.start(1, "advanced");
        if (this.onStepCompletedCallback) {
          await this.onStepCompletedCallback(1);
        }
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
            ${I18nManager.t("tutorial.adv_complete_desc")}
          </p>
          <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:12px; margin-bottom:20px; font-size:13px; color:#38bdf8; font-weight:700; text-align:center;">
            ${I18nManager.t("tutorial.complete_reward")}
          </div>
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
