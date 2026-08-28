/**
 * 5단계 마이크로 인터랙티브 튜토리얼 시스템 모듈 (TutorialManager)
 * 
 * 1. 기물 이동과 직진 타격 (슬링샷 기초)
 * 2. 각도 조절과 대각선 조준 (방향 전환 훈련)
 * 3. 타점 선택과 스핀 회전력 (타점 변경 필수 검증)
 * 4. 장외 낙사 시스템 (보드 밖 밀어내기)
 * 5. 실전 연습 미니 대전 (실전 체득 및 최종 졸업)
 */

import type { PieceInstance } from "./layout";
import type { MetaRuntime } from "./meta";
import { saveMetaState } from "./meta";
import { I18nManager } from "./i18n";

export interface TutorialStepInfo {
  step: number;
  title: string;
  mission: string;
  guide: string;
  successMessage: string;
}

export function getTutorialStepInfo(step: number): TutorialStepInfo {
  switch (step) {
    case 1:
      return {
        step: 1,
        title: I18nManager.t("tutorial.step1_title"),
        mission: I18nManager.t("tutorial.step1_mission"),
        guide: I18nManager.t("tutorial.step1_guide"),
        successMessage: I18nManager.t("tutorial.step1_success"),
      };
    case 2:
      return {
        step: 2,
        title: I18nManager.t("tutorial.step2_title"),
        mission: I18nManager.t("tutorial.step2_mission"),
        guide: I18nManager.t("tutorial.step2_guide"),
        successMessage: I18nManager.t("tutorial.step2_success"),
      };
    case 3:
      return {
        step: 3,
        title: I18nManager.t("tutorial.step3_title"),
        mission: I18nManager.t("tutorial.step3_mission"),
        guide: I18nManager.t("tutorial.step3_guide"),
        successMessage: I18nManager.t("tutorial.step3_success"),
      };
    case 4:
      return {
        step: 4,
        title: I18nManager.t("tutorial.step4_title"),
        mission: I18nManager.t("tutorial.step4_mission"),
        guide: I18nManager.t("tutorial.step4_guide"),
        successMessage: I18nManager.t("tutorial.step4_success"),
      };
    case 5:
    default:
      return {
        step: 5,
        title: I18nManager.t("tutorial.step5_title"),
        mission: I18nManager.t("tutorial.step5_mission"),
        guide: I18nManager.t("tutorial.step5_guide"),
        successMessage: I18nManager.t("tutorial.step5_success"),
      };
  }
}

export class TutorialManager {
  public currentStep: number = 1;
  public isActive: boolean = false;
  private overlayElement: HTMLElement | null = null;
  private onStepCompletedCallback: ((nextStep: number) => Promise<void>) | null = null;
  private onTutorialFinishedCallback: (() => Promise<void>) | null = null;
  private metaRuntime: MetaRuntime | null = null;

  /**
   * 튜토리얼 런타임 초기화
   */
  public init(
    metaRuntime: MetaRuntime,
    onStepCompleted: (nextStep: number) => Promise<void>,
    onTutorialFinished: () => Promise<void>,
  ): void {
    this.metaRuntime = metaRuntime;
    this.onStepCompletedCallback = onStepCompleted;
    this.onTutorialFinishedCallback = onTutorialFinished;
  }

  /**
   * 튜토리얼 모드 시작 (1단계부터)
   */
  public start(startStep: number = 1): void {
    this.isActive = true;
    this.currentStep = startStep;
    this.renderCoachOverlay();
  }

  /**
   * 튜토리얼 모드 종료 및 UI 제거
   */
  public stop(): void {
    this.isActive = false;
    if (this.overlayElement) {
      this.overlayElement.remove();
      this.overlayElement = null;
    }
  }

  /**
   * 단계별 기물 배치 생성
   */
  public getStepPieces(step: number): PieceInstance[] {
    switch (step) {
      case 1:
        return [
          {
            id: "white-pawn-d2",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "d", rank: 2 },
          },
          {
            id: "black-pawn-d5",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "d", rank: 5 },
          },
        ];

      case 2:
        return [
          {
            id: "white-pawn-d2",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "d", rank: 2 },
          },
          {
            id: "black-pawn-f5",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "f", rank: 5 },
          },
        ];

      case 3:
        return [
          {
            id: "white-pawn-d2",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "d", rank: 2 },
          },
          {
            id: "black-pawn-d5",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "d", rank: 5 },
          },
        ];

      case 4:
        return [
          {
            id: "white-pawn-d3",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "d", rank: 3 },
          },
          {
            id: "black-knight-d8",
            type: "Knight",
            side: "black",
            startingSquare: { file: "d", rank: 8 },
          },
        ];

      case 5:
      default:
        return [
          {
            id: "white-pawn-c2",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "c", rank: 2 },
          },
          {
            id: "white-pawn-e2",
            type: "Pawn",
            side: "white",
            startingSquare: { file: "e", rank: 2 },
          },
          {
            id: "white-rook-d1",
            type: "Rook",
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
            id: "black-pawn-c7",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "c", rank: 7 },
          },
          {
            id: "black-pawn-e7",
            type: "Pawn",
            side: "black",
            startingSquare: { file: "e", rank: 7 },
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

    switch (this.currentStep) {
      case 1:
        return { cleared: hadWhiteHitBlack || remainingBlackPieceCount === 0 };

      case 2:
        return { cleared: hadWhiteHitBlack || remainingBlackPieceCount === 0 };

      case 3:
        if (!hasCustomStrikePoint) {
          return {
            cleared: false,
            hint: I18nManager.t("tutorial.step3_hint"),
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
    if (!this.isActive) return;
    const stepInfo = getTutorialStepInfo(this.currentStep);

    this.updateCoachMessage(stepInfo.successMessage, true);

    await new Promise((r) => setTimeout(r, 1200));

    if (this.currentStep < 5) {
      const nextStep = this.currentStep + 1;
      this.currentStep = nextStep;
      this.renderCoachOverlay();
      if (this.onStepCompletedCallback) {
        await this.onStepCompletedCallback(nextStep);
      }
    } else {
      this.completeTutorial();
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
    localStorage.setItem("has_completed_tutorial", "true");

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
    }

    const stepInfo = getTutorialStepInfo(this.currentStep);

    this.overlayElement.innerHTML = `
      <div class="tutorial-coach-card">
        <div class="tutorial-coach-header">
          <span class="tutorial-step-badge">Step ${this.currentStep}/5</span>
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
      guideEl.textContent = "...";
    }
  }

  /**
   * 튜토리얼 최종 완료 축하 팝업 모달
   */
  private showCompletionModal(): void {
    this.stop();

    const modal = document.createElement("div");
    modal.className = "tutorial-modal-overlay";
    modal.innerHTML = `
      <div class="tutorial-modal-card">
        <h2 style="margin:0 0 10px 0; font-size:22px; color:#38bdf8; font-weight:800;">${I18nManager.t("tutorial.complete_title")}</h2>
        <p style="margin:0 0 16px 0; font-size:14px; color:#cbd5e1; line-height:1.5;">
          ${I18nManager.t("tutorial.complete_desc")}
        </p>
        <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:12px; margin-bottom:20px; font-size:13px; color:#38bdf8; font-weight:700;">
          ${I18nManager.t("tutorial.complete_reward")}
        </div>
        <button id="btn-tutorial-finish" style="background:#16a34a; color:white; border:none; border-radius:8px; padding:14px 28px; font-size:15px; font-weight:700; cursor:pointer; width:100%;">
          ${I18nManager.t("tutorial.complete_btn")}
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

  /**
   * 최초 접속 시 튜토리얼 권장 팝업 표시 (로컬스토리지 확인)
   */
  public static checkFirstVisitAndPrompt(
    onStartTutorial: () => void,
    onSkip: () => void,
  ): void {
    const isCompleted = localStorage.getItem("has_completed_tutorial");
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
      localStorage.setItem("has_completed_tutorial", "started");
      modal.remove();
      onStartTutorial();
    });

    modal.querySelector("#btn-skip-tutorial-prompt")?.addEventListener("click", () => {
      localStorage.setItem("has_completed_tutorial", "skipped");
      modal.remove();
      onSkip();
    });
  }
}

export const tutorialManager = new TutorialManager();
