// Rapier가 안정적으로 수면 상태에 도달한 실측 중력값을 고정한다.
export const GRAVITY_Y = -9.81;

// Rapier의 접촉 허용오차가 미터 단위 모델과 일치하도록 길이 단위를 유지한다.
export const WORLD_LENGTH_UNIT = 1;

// 헤드리스 검증과 같은 적분 간격을 사용해 접지 안정성을 재현한다.
export const FIXED_STEP = 1 / 120;

// 물리 상수는 유지하면서 작은 실물 체스말처럼 빠르게 보이게 하는 시간 배율이다.
export const TIME_SCALE = Math.sqrt(10);

// 종류별 볼록껍질 부피에서 현실적인 말 질량을 계산하기 위한 공통 밀도다.
export const PIECE_DENSITY = 1.2;

// 말끼리와 말·보드 사이의 미끄러짐을 동일하게 맞추는 마찰값이다.
export const PIECE_FRICTION = 0.4;

// 충돌 감각을 남기면서도 모든 말이 수면 상태에 도달하게 하는 반발값이다.
export const PIECE_RESTITUTION = 0.1;

// 접촉 후 남는 병진 흔들림을 실측 시간 안에 줄이는 감쇠값이다.
export const PIECE_LINEAR_DAMPING = 2.0;

// 넘어질 수 있는 회전은 허용하면서 접지 지터를 가라앉히는 감쇠값이다.
export const PIECE_ANGULAR_DAMPING = 2.0;

// 평탄화된 콜라이더 바닥이 보드 상면에 정확히 닿은 상태로 시작하게 한다.
export const SPAWN_GAP = 0;

// 최대 배속 4.0에서 필요한 120×4÷fps에 따라 24fps의 20스텝을 여유 있게 처리한다.
// 지원 하한 아래에서는 시간 빚을 쌓아 죽음의 나선에 들어가지 않고 의도적으로 느린 화면으로 저하된다.
export const MAX_STEPS_PER_FRAME = 24;

// 탭 복귀나 디버거 정지 뒤 과도한 물리 시간을 한꺼번에 처리하지 않게 한다.
export const MAX_FRAME_DELTA = 0.25;

// 말이 미끄러져 나갈 수 있는 평평한 여백을 셀 비율로 정의한다.
export const BOARD_BORDER_CELLS = 0.25;

// 마우스와 한 손가락 모두 화면 크기에 과도하게 의존하지 않는 최대 세기 드래그 거리다.
export const MAX_DRAG_PIXELS = 180;

// 최대 세기에서 질량과 무관하게 목표로 하는 발사 직후 속도다.
export const MAX_LAUNCH_SPEED = 11;

// 흑 준비 턴이 된 뒤 실제 조준 고리를 보여 주기 전까지 기다리는 실시간 초다.
export const AI_AIM_PREVIEW_DELAY = 0.25;

// AI의 실제 세기를 0에서 최종값까지 기존 조준 색·활시위로 충전하는 실시간 초다.
export const AI_AIM_CHARGE_SECONDS = 0.9;

// 흑 AI 샷 카운터 해시가 방향에 더하는 기본 좌우 오차 상한 각도다.
export const AI_BASE_JITTER_DEGREES = 5;

// 흑 AI 거리 비례 세기가 내려갈 수 있는 기본 하한이다.
export const AI_BASE_POWER_MIN = 0.35;

// 흑 AI 거리 비례 세기가 올라갈 수 있는 기본 상한이다.
export const AI_BASE_POWER_MAX = 1;

// 연결 확인 패킷을 보내 상대 브라우저가 살아 있는지 검사하는 실제 시간 간격이다.
export const NET_HEARTBEAT_INTERVAL_MS = 3_000;

// 상대에게서 어떤 패킷도 받지 못했을 때 연결 끊김으로 판정하는 실제 시간이다.
export const NET_TRAFFIC_TIMEOUT_MS = 10_000;

// 후보 수집이 끝나지 않는 네트워크에서 수동 코드 생성을 무한히 기다리지 않는 상한이다.
export const NET_ICE_GATHER_TIMEOUT_MS = 15_000;

// 스테이지 흑 중량·힘·크기 단계값에 공통으로 곱하는 기본 난이도 배율이다.
export const ENEMY_STAGE_BUFF_SCALE = 1;

// 짝수 스테이지 한 단계마다 흑 말의 원래 hull 질량에 더하는 비율이다.
export const STAGE_WEIGHT_STEP = 0.1;

// 3 이상 홀수 스테이지 한 단계마다 흑 AI 목표 발사 속도에 더하는 비율이다.
export const STAGE_FORCE_STEP = 0.05;

// 3의 배수 스테이지 한 단계마다 흑 말의 렌더와 콜라이더에 더하는 균일 배율이다.
export const STAGE_SIZE_STEP = 0.03;

// 보드 격자에 물리적으로 들어가는 총 배율 상한이다. 초고스테이지에서 지그재그로도 안 들어가는 것을 막되 중량·힘 버프는 계속 누적한다.
export const STAGE_MAX_PIECE_SCALE = 2.2;

// 일반·중급·상급·최상급·레전드 강화 카드가 기존 수치를 교체할 최종 효과 비율표다.
export const CARD_GRADE_EFFECTS = [
  0.01,
  0.03,
  0.05,
  0.07,
  0.1,
] as const;

// 크기·중량·힘 카드의 현재 등급 최종 효과에 공통으로 곱하는 로그라이트 성장 배율이다.
export const CARD_EFFECT_SCALE = 1;

// 뒷줄 최악 인접쌍(퀸+킹) 받침 합 0.429 × s가 칸 간격 0.536 − 0.02 이하가 되는 실측 상한이다. 카드로 그 이상 쌓아도 백 일반 말은 여기서 멈춘다.
export const PLAYER_MAX_SIZE_SCALE = 1.2;

// 스테이지 하나를 클리어할 때 즉시 지급하고 저장하는 영구 메타 포인트다.
export const STAGE_CLEAR_POINTS = 100;

// 영구 힘·중량 강화 한 레벨이 원래 속도·hull 질량에 더하는 비율이다.
export const PERMANENT_UPGRADE_STEP = 0.01;

// 말 종류별 힘·중량 트랙에서 구매할 수 있는 최대 레벨이다.
export const PERMANENT_UPGRADE_MAX_LEVEL = 10;

// 현재 레벨 N에서 다음 레벨을 살 때 (N + 1)에 곱하는 선형 비용 단위다.
export const PERMANENT_UPGRADE_COST_UNIT = 100;

// 세기와 무관한 짧은 경로 모양만 만들도록 실제 발사 속도와 분리한 안내용 기준 속도다.
export const NOMINAL_GUIDE_SPEED = 3.5;

// 세기와 무관한 명목 속도에서만 쓰는 고정 호 길이라 실제 착지 거리를 드러내지 않으면서 원뿔 간격을 넓힌다.
export const GUIDE_ARC_LENGTH = 2.2;

// 바닥 진행 띠는 고도·세기 어디에도 반응하지 않는 고정 길이라 화살표 간격이 항상 같고 방향 판단 기준이 흔들리지 않는다.
export const GROUND_LANE_LENGTH = 1.6;

// 전방 거리를 예측하지 않고 충전 장력만 뒤쪽으로 보여 주는 활줄 최대 당김 거리다.
export const BOWSTRING_MAX_PULL = 0.55;

// 무게중심에서 시각적 중심을 향한 타격 위치를 정해 0은 발사 순간 타격 토크가 없고 1은 시각 중심에 닿게 한다.
export const STRIKE_HEIGHT_RATIO = 1.0;

// 접지 미세 진동을 정지로 인정하되 눈에 보이는 이동은 계속 기다리는 선속도 한계다.
export const REST_LINEAR_EPS = 0.05;

// 제자리 회전을 정지로 오판하지 않도록 선속도와 별도로 검사하는 각속도 한계다.
export const REST_ANGULAR_EPS = 0.1;

// 모든 말이 저속 상태를 연속으로 유지해야 턴을 넘기는 시뮬레이션 시간이다.
export const REST_HOLD_SECONDS = 0.3;

// 긴 접지 지터에서 저속·접촉 중인 말만 안전하게 수면시키기까지 기다리는 시간이다.
export const MAX_SETTLE_SECONDS = 8;

// 보드 아래로 충분히 떨어진 말만 제거해 가장자리 접촉 중 조기 삭제하지 않게 한다.
export const FALL_OUT_Y = -2;

// 화면 드래그와 판 위 방향의 대응이 카메라 상하 움직임으로 변하지 않게 고정하는 고도각이다.
export const CAMERA_PITCH_DEG = 48;

// 첫 화면 전에 실제 접촉을 충분히 풀되 실패한 로딩이 무한히 멈추지 않게 하는 상한이다.
export const PRE_SETTLE_MAX_STEPS = 1200;

// 당구식 자유 시야가 판과 거의 수평인 낮은 각도까지 내려갈 수 있는 최소 고도다.
export const CAM_PITCH_MIN = 3;

// 수평 방향 계산이 불안정해지지 않는 범위에서 위에서 내려다보는 최대 고도다.
export const CAM_PITCH_MAX = 85;

// 키를 누른 실제 시간에 비례해 시점을 일정하게 돌리는 기본 각속도다.
export const CAM_KEY_DEG_PER_SEC = 90;

// 말을 처음 선택했을 때 힘이 수평으로 향하도록 복원할 중립 카메라 피치다.
export const CAM_INITIAL_AIM_PITCH_DEG = 44;

// 선택한 말에 가까이 붙되 near plane이나 메시 내부 진입을 피하는 최소 거리다.
export const CAM_MIN_DISTANCE = 0.8;

// 선택과 모드 전환 때 카메라 중심 변화가 갑자기 튀지 않게 하는 실제 시간이다.
export const CAMERA_TARGET_TRANSITION_SECONDS = 0.25;

// 변환기와 런타임 에셋 검증이 공유하는 필수 체스말 종류의 단일 원본이다.
export const PIECE_TYPES = [
  "Pawn",
  "Rook",
  "Knight",
  "Bishop",
  "Queen",
  "King",
] as const;

export type PieceType = (typeof PIECE_TYPES)[number];

// 보드의 물리·시각 크기가 같은 메타데이터 셀 크기에서 파생되도록 한다.
export function deriveBoardHalfExtent(cellSize: number): number {
  return ((8 + BOARD_BORDER_CELLS * 2) * cellSize) / 2;
}
