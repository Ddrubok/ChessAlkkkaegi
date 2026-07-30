// Rapier가 안정적으로 수면 상태에 도달한 실측 중력값을 고정한다.
export const GRAVITY_Y = -9.81;

// Rapier의 접촉 허용오차가 미터 단위 모델과 일치하도록 길이 단위를 유지한다.
export const WORLD_LENGTH_UNIT = 1;

// 헤드리스 검증과 같은 적분 간격을 사용해 접지 안정성을 재현한다.
export const FIXED_STEP = 1 / 120;

// 2026-07-30 개발자 지시로 기본 배속을 2배로 올린다. 스텝 순서는 그대로라 온라인 동기화에는 영향이 없다.
export const TIME_SCALE = 2;

// 종류별 볼록껍질 부피에서 현실적인 말 질량을 계산하기 위한 공통 밀도다.
export const PIECE_DENSITY = 1.2;

// 말끼리와 말·보드 사이의 미끄러짐을 동일하게 맞추는 마찰값이다. 2026-07-27 기획자 요청값.
export const PIECE_FRICTION = 0.05;

// 충돌 감각을 남기면서도 모든 말이 수면 상태에 도달하게 하는 반발값이다. 2026-07-27 기획자 요청값.
export const PIECE_RESTITUTION = 0.6;

// 접촉 후 남는 병진 흔들림을 줄이는 감쇠값이다. 2026-07-27 기획자 요청으로 감쇠를 끈다.
export const PIECE_LINEAR_DAMPING = 0;

// 넘어질 수 있는 회전은 허용하면서 접지 지터를 가라앉히는 감쇠값이다. 2026-07-27 기획자 요청으로 감쇠를 끈다.
export const PIECE_ANGULAR_DAMPING = 0;

// 평탄화된 콜라이더 바닥이 보드 상면에 정확히 닿은 상태로 시작하게 한다.
export const SPAWN_GAP = 0;

// 최대 배속 4.0에서 필요한 120×4÷fps에 따라 24fps의 20스텝을 여유 있게 처리한다.
// 지원 하한 아래에서는 시간 빚을 쌓아 죽음의 나선에 들어가지 않고 의도적으로 느린 화면으로 저하된다.
export const MAX_STEPS_PER_FRAME = 24;

// 탭 복귀나 디버거 정지 뒤 과도한 물리 시간을 한꺼번에 처리하지 않게 한다.
export const MAX_FRAME_DELTA = 0.25;

// 로비와 대국에서 계속 재생하는 배경음이 효과음을 덮지 않도록 낮게 고정한 음량이다.
export const SOUND_BGM_VOLUME = 0.18;

// 버튼·세기·충돌 효과음을 같은 기준으로 재생하는 과하지 않은 고정 음량이다.
export const SOUND_SFX_VOLUME = 0.45;

// 말끼리 단순 접촉이나 정지 포개짐이 아닌 실제 충돌음으로 인정할 상대 선속도 하한이다.
export const SOUND_HIT_MIN_RELATIVE_SPEED = 0.65;

// 같은 말 쌍이 짧게 분리·재접촉해도 연타음이 나지 않게 하는 실제 시간 간격이다.
export const SOUND_HIT_PAIR_COOLDOWN_MS = 180;

// 여러 말이 동시에 부딪힐 때 한 프레임에 효과음이 겹쳐 폭주하지 않게 하는 전체 간격이다.
export const SOUND_HIT_GLOBAL_COOLDOWN_MS = 70;

// 말이 미끄러져 나갈 수 있는 평평한 여백을 셀 비율로 정의한다.
export const BOARD_BORDER_CELLS = 0.25;

// 공식 맵 디자인 문서의 2~10스테이지 판 전체 30% 확대를 렌더·물리 공통 배율로 고정한다.
export const STAGE_BOARD_SCALE = 1.3;

// 기획 해석을 되돌릴 때 한 상수로 셀 간격까지 확대할 수 있게 두되, 확정된 여백식 배치는 false다.
export const STAGE_BOARD_EXPANSION_SCALES_CELLS = false;

// 공식 맵 문서 45쪽의 한 변당 8조각 벽 구성을 확대 보드 외곽에도 그대로 적용한다.
export const BREAKABLE_WALL_SEGMENTS_PER_SIDE = 8;

// 공식 맵 문서의 당구장 벽과 같은 낮은 단차를 일반 발사는 반사하되 빠른 말은 넘을 수 있는 높이로 둔다.
export const BREAKABLE_WALL_HEIGHT = 0.16;

// 확대 보드 가장자리 안쪽에 놓이는 벽의 충돌 두께를 셀보다 충분히 얇게 유지한다.
export const BREAKABLE_WALL_THICKNESS = 0.08;

// 한 조각 파괴 시 Pawn은 지나가고 King은 이웃 조각에 걸리도록 인접 벽이 겹치는 길이를 셀 비율로 정한다.
export const BREAKABLE_WALL_OVERLAP_CELLS = 0.75;

// 맵 수정안 도면을 155px/월드 단위로 재어 각 벽 끝을 약 0.40만큼 비운 결과를 킹 밑동 지름의 2.4배 대각 출구 폭으로 해석한다.
// 도면 이미지에서 유도한 값이라 기획자가 수치를 확정하면 이 상수만 교체한다.
export const POCKET_WALL_EXIT_WIDTH_KING_DIAMETER_MULTIPLIER =
  2.4;

// 핀볼 맵 도면의 좌우 대칭 여섯 점을 셀 단위로 보존해 기획 수정 시 이 표만 바꾸게 한다.
export const PINBALL_OBSTACLE_CELLS = [
  { file: "c", rank: 6 },
  { file: "f", rank: 6 },
  { file: "a", rank: 4 },
  { file: "h", rank: 4 },
  { file: "c", rank: 3 },
  { file: "e", rank: 3 },
] as const;

// 핀볼 도면의 작은 원형 점을 재현하면서 말이 사이로 지날 여유를 남기는 셀 대비 원기둥 지름이다.
export const PINBALL_OBSTACLE_DIAMETER_CELLS = 0.35;

// 일반 발사는 막되 공중에 뜬 말은 넘을 수 있도록 벽 단차보다 높게 둔 고정 원기둥 높이다.
export const PINBALL_OBSTACLE_HEIGHT = 0.24;

// 데스크톱 마우스와 클래식 조작이 그대로 사용하는 최대 세기 드래그 거리다.
export const MAX_DRAG_PIXELS = 180;

// 실기기 가로 화면에서 손가락이 화면을 벗어나기 전에 최대 세기에 닿도록 높이의 28%를 쓴다.
export const TOUCH_MAX_DRAG_VIEWPORT_RATIO = 0.28;

// 매우 낮은 viewport에서도 터치 최대 세기 거리가 지나치게 민감해지지 않게 하는 하한이다.
export const TOUCH_MAX_DRAG_MIN_PIXELS = 80;

// 모바일 권장 터치 표적 44px(약 7~10mm)를 말 선택 중심점의 화면 반경으로 보장한다.
export const TOUCH_PIECE_HIT_RADIUS_PIXELS = 44;

// 기획자의 "아주 살짝 크게" 지침에 따라 터치 빨간 점 히트 반경에 최소 여유만 더한다.
export const TOUCH_RED_DOT_HIT_RADIUS_MULTIPLIER = 1.5;

// 최대 세기에서 질량과 무관하게 목표로 하는 발사 직후 속도다.
export const MAX_LAUNCH_SPEED = 11;

// 흑 준비 턴이 된 뒤 실제 조준 고리를 보여 주기 전까지 기다리는 실시간 초다.
export const AI_AIM_PREVIEW_DELAY = 0.25;

// AI의 실제 세기를 0에서 최종값까지 기존 조준 색·활시위로 충전하는 실시간 초다.
export const AI_AIM_CHARGE_SECONDS = 0.9;

// 스테이지 구간별 판단 방식과 좌우 조준 오차 상한을 기획서의 10/7/3/0도로 고정하는 표다.
export const AI_STAGE_DECISION_BANDS = [
  {
    minimumStage: 1,
    maximumStage: 3,
    judgement: "random",
    maximumAimErrorDegrees: 10,
  },
  {
    minimumStage: 4,
    maximumStage: 6,
    judgement: "edge",
    maximumAimErrorDegrees: 7,
  },
  {
    minimumStage: 7,
    maximumStage: 9,
    judgement: "chain",
    maximumAimErrorDegrees: 3,
  },
  {
    minimumStage: 10,
    maximumStage: 10,
    judgement: "optimal",
    maximumAimErrorDegrees: 0,
  },
] as const;

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

// 플래너 최종 스테이지별 표를 그대로 옮긴 흑 말 일반 크기 배율이며 표 밖의 고스테이지는 마지막 값을 유지한다.
export const STAGE_SIZE_MULTIPLIERS = [
  1,
  1,
  1.05,
  1.05,
  1.1,
  1.1,
  1.15,
  1.2,
  1.25,
  1.3,
] as const;

// 플래너 최종 결정에 따라 플레이어 카드와 AI 폰 티어가 공통으로 사용하는 원래 폰 대비 거대 폰 균일 배율이다.
export const GIANT_PAWN_SIZE_MULTIPLIER = 1.3;

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

// 한 런이 완주로 끝나는 마지막 스테이지 번호다.
export const STAGE_RUN_LENGTH = 10;

// 스테이지 N 클리어가 런 종료 정산액에 더하는 N배 포인트의 기본 단위다.
export const STAGE_POINT_CONTRIBUTION_UNIT = 1;

// 영구 힘·중량 강화 한 레벨이 원래 속도·hull 질량에 더하는 비율이다.
export const PERMANENT_UPGRADE_STEP = 0.01;

// 기초·심화 힘·중량 노드 하나에서 구매할 수 있는 최대 레벨이다.
export const PERMANENT_UPGRADE_TIER_MAX_LEVEL = 3;

// 중앙 전체 크기 노드가 플레이어의 모든 말 종류에 더하는 비율이다.
export const PERMANENT_PLAYER_SIZE_STEP = 0.03;

// 기초 일반 말 힘·중량 노드의 0→1, 1→2, 2→3 고정 비용이다.
export const PERMANENT_BASIC_REGULAR_COSTS = [1, 3, 5] as const;

// 기초 킹·퀸 힘·중량 노드의 0→1, 1→2, 2→3 고정 비용이다.
export const PERMANENT_BASIC_ROYAL_COSTS = [2, 4, 6] as const;

// 중앙 전체 크기 0→1 노드의 단일 구매 비용이다.
export const PERMANENT_PLAYER_SIZE_COST = 10;

// 심화 일반 말 힘·중량 노드의 0→1, 1→2, 2→3 고정 비용이다.
export const PERMANENT_ADVANCED_REGULAR_COSTS = [3, 5, 7] as const;

// 심화 킹·퀸 힘·중량 노드의 0→1, 1→2, 2→3 고정 비용이다.
export const PERMANENT_ADVANCED_ROYAL_COSTS = [4, 6, 8] as const;

// 힘·중량 24개와 중앙 크기 1개를 합친 전체 구매 노드 수다.
export const PERMANENT_UPGRADE_NODE_COUNT = 25;

// 세기와 무관한 짧은 경로 모양만 만들도록 실제 발사 속도와 분리한 안내용 기준 속도다.
export const NOMINAL_GUIDE_SPEED = 3.5;

// 세기와 무관한 명목 속도에서만 쓰는 고정 호 길이라 실제 착지 거리를 드러내지 않으면서 원뿔 간격을 넓힌다.
export const GUIDE_ARC_LENGTH = 2.2;

// 바닥 진행 띠는 고도·세기 어디에도 반응하지 않는 고정 길이라 화살표 간격이 항상 같고 방향 판단 기준이 흔들리지 않는다.
export const GROUND_LANE_LENGTH = 1.6;

// 전방 거리를 예측하지 않고 충전 장력만 뒤쪽으로 보여 주는 활줄 최대 당김 거리다.
export const BOWSTRING_MAX_PULL = 0.55;

// 무게중심에서 시각적 중심을 향한 타격 위치를 정해 0은 발사 순간 타격 토크가 없고 1은 시각 중심에 닿게 한다.
// 2026-07-27 기획자 요청으로 타격 토크 없이 무게중심을 때리는 0을 기본값으로 쓴다.
export const STRIKE_HEIGHT_RATIO = 0;

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
