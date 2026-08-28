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

export interface TutorialStepInfo {
  step: number;
  title: string;
  mission: string;
  guide: string;
  successMessage: string;
}

export const TUTORIAL_STEPS: Record<number, TutorialStepInfo> = {
  1: {
    step: 1,
    title: "기초 이동과 직진 타격",
    mission: "내 폰(Pawn)을 발사하여 전방의 적 폰을 맞추세요.",
    guide: "내 기물을 터치한 뒤 목표 반대 방향으로 끌어당겨 놓으세요.",
    successMessage: "타격 성공. 기물 충돌 물리 감각을 익혔습니다.",
  },
  2: {
    step: 2,
    title: "각도 조절과 대각선 조준",
    mission: "드래그 각도를 조절하여 대각선 위치의 적 폰을 맞추세요.",
    guide: "적이 대각선에 있습니다. 원하는 방향의 정확한 반대 각도로 조준하세요.",
    successMessage: "명중. 조준 각도 조절을 마스터했습니다.",
  },
  3: {
    step: 3,
    title: "타점 선택과 스핀 회전력",
    mission: "좌측 [타점 선택창]에서 가장자리를 찍고 스핀 샷으로 적을 치세요.",
    guide: "[타점 선택창]에서 중심이 아닌 좌/우 가장자리를 클릭하고 발사해야 인정됩니다.",
    successMessage: "스핀 샷 성공. 회전력을 이용해 적을 타격했습니다.",
  },
  4: {
    step: 4,
    title: "장외 낙사 시스템",
    mission: "적 나이트를 보드 밖(장외)으로 밀어내세요.",
    guide: "상대 기물을 보드 밖으로 떨어뜨리면 즉시 파괴됩니다. 강하게 밀어보세요.",
    successMessage: "장외 성공. 상대 기물을 파괴했습니다.",
  },
  5: {
    step: 5,
    title: "실전 연습 미니 대전",
    mission: "배운 기술을 종합 활용하여 상대 킹(King)을 격파하고 승리하세요.",
    guide: "실전 연습 대전입니다. 20초 안에 각도와 스핀을 활용해 적 킹을 격파하세요.",
    successMessage: "튜토리얼 완료. 모든 실전 준비를 마쳤습니다.",
  },
};

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
        // Step 1 (직진 타격): 백 폰 (d2) vs 흑 폰 (d5)
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
        // Step 2 (대각선 각도 조준): 백 폰 (d2) vs 대각선 흑 폰 (f5)
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
        // Step 3 (타점 스핀 훈련): 백 폰 (d2) vs 흑 폰 (d5)
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
        // Step 4 (장외 낙사): 백 폰 (d3) vs 흑 나이트 (d8 보드 가장자리)
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
        // Step 5 (실전 연습 미니 대전): 백 4개 vs 흑 3개
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
        // Step 1: 내 폰이 적 폰을 한 번이라도 맞추거나 장외시키면 성공
        return { cleared: hadWhiteHitBlack || remainingBlackPieceCount === 0 };

      case 2:
        // Step 2: 대각선 적 폰을 맞추거나 장외시키면 성공
        return { cleared: hadWhiteHitBlack || remainingBlackPieceCount === 0 };

      case 3:
        // Step 3: 반드시 타점을 바꾼 상태에서 적을 타격해야 인정!
        if (!hasCustomStrikePoint) {
          return {
            cleared: false,
            hint: "[안내] 좌측 타점 선택창에서 기물의 가장자리를 먼저 클릭하고 발사하세요.",
          };
        }
        return { cleared: hadWhiteHitBlack || remainingBlackPieceCount === 0 };

      case 4:
        // Step 4: 적 나이트가 장외되어 흑 기물이 0개가 되면 성공
        return { cleared: remainingBlackPieceCount === 0 };

      case 5:
        // Step 5: 적 킹이 장외/격파되면 최종 승리!
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
    const stepInfo = TUTORIAL_STEPS[this.currentStep];

    // 코치 말풍선에 성공 메시지 연출
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
      // 5단계 최종 완료: 100포인트 보상 지급 및 완료 팝업
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

    // 100 PVE 포인트 보상 지급
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

    const stepInfo = TUTORIAL_STEPS[this.currentStep] || TUTORIAL_STEPS[1];

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
      guideEl.textContent = "다음 단계로 이동합니다.";
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
        <h2 style="margin:0 0 10px 0; font-size:22px; color:#38bdf8; font-weight:800;">튜토리얼 완료</h2>
        <p style="margin:0 0 16px 0; font-size:14px; color:#cbd5e1; line-height:1.5;">
          기본 타격, 각도 조절, 스핀 회전력, 장외 낙사, 실전 대전까지 모두 마스터하셨습니다.<br>
          완료 보상으로 <strong>100 PVE 포인트</strong>가 지급되었습니다.
        </p>
        <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:12px; margin-bottom:20px; font-size:13px; color:#38bdf8; font-weight:700;">
          완료 보상: +100 PVE 포인트 지급 완료
        </div>
        <button id="btn-tutorial-finish" style="background:#16a34a; color:white; border:none; border-radius:8px; padding:14px 28px; font-size:15px; font-weight:700; cursor:pointer; width:100%;">
          메인 로비로 이동
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
        <h2 style="margin:0 0 10px 0; font-size:20px; color:#f8fafc; font-weight:800;">체스 알까기 튜토리얼</h2>
        <p style="margin:0 0 20px 0; font-size:14px; color:#94a3b8; line-height:1.5;">
          기본 조작법과 스핀 타격, 승리 규칙을 <strong>1분 안에</strong> 학습할 수 있습니다.<br>
          완료 시 <strong>100 PVE 포인트</strong>를 드립니다.
        </p>
        <div style="display:flex; flex-direction:column; gap:10px;">
          <button id="btn-start-tutorial-prompt" style="background:#2563eb; color:white; border:none; border-radius:8px; padding:14px; font-size:15px; font-weight:700; cursor:pointer;">
            튜토리얼 시작하기 (권장)
          </button>
          <button id="btn-skip-tutorial-prompt" style="background:transparent; color:#94a3b8; border:1px solid #475569; border-radius:8px; padding:12px; font-size:13px; font-weight:600; cursor:pointer;">
            바로 게임하기
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
