import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InterleavedBufferAttribute,
  Mesh,
  MeshNormalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import type { Material } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { PIECE_TYPES, type PieceType } from "../config";
import "./convert.css";

type StageName = "parse" | "classify" | "simplify" | "export";
type StageStatus = "pending" | "running" | "done" | "error";
type LastAction = "inspect" | "convert";
type Point3 = [number, number, number];

interface MeshInventoryItem {
  mesh: Mesh<BufferGeometry>;
  vertexCount: number;
  triangles: number;
  bounds: Box3;
  center: Vector3;
  size: Vector3;
  horizontalArea: number;
}

interface PieceGroup {
  observedVertexCount: number;
  detectedType: PieceType;
  items: MeshInventoryItem[];
  representative: MeshInventoryItem;
}

interface Workspace {
  sourceHash: string;
  scene: Group;
  boards: MeshInventoryItem[];
  groups: PieceGroup[];
  sourceCellSize: number;
  sourceBoardThickness: number;
}

interface GroupControls {
  select: HTMLSelectElement;
  budget: HTMLInputElement;
  baseFlattenEps: HTMLInputElement;
}

interface CrossCheckResult {
  valid: boolean;
  message: string;
}

interface CrossCheckResults {
  height: CrossCheckResult;
  position: CrossCheckResult;
}

interface ColliderSample {
  points: Point3[];
  aabbMatches: boolean;
  baseRadius: number;
  // 샘플링 전 평탄화된 바닥의 모든 중복 제거 후보 수이며 볼록껍질 정점 수와 다르다.
  basePointCount: number;
  baseHullPointCount: number;
}

interface FinalAlignment {
  minY: number;
  centerX: number;
  centerZ: number;
}

interface PieceConversion {
  type: PieceType;
  node: Mesh<BufferGeometry, MeshStandardMaterial>;
  observedVertexCount: number;
  beforeTriangles: number;
  afterTriangles: number;
  bounds: Vector3;
  colliderPoints: Point3[];
  colliderAabbMatches: boolean;
  baseRadius: number;
  basePointCount: number;
  baseFlattenEps: number;
  baseHullPointCount: number;
  finalAlignment: FinalAlignment;
  identity: boolean;
}

interface ConversionReport {
  glbBytes: number;
  pieces: PieceConversion[];
  counts: Record<PieceType, number>;
  boardCount: number;
  pieceCount: number;
  crossChecks: CrossCheckResults;
  overrideUsed: boolean;
}

interface DownloadArtifacts {
  glb: Blob;
  meta: Blob;
}

interface GltfNode {
  name?: string;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}

interface GltfDocument {
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNode[];
  meshes?: Array<{ primitives?: Array<{ material?: number }> }>;
  materials?: unknown[];
}

// 자기 보정 분류가 완전한 체스 배치의 그룹 구성인지 확인하는 유일한 개수 기준이다.
const EXPECTED_GROUP_SIZES = [2, 2, 4, 4, 4, 16] as const;

// 고폴리 형상을 3MB 이하 배포 자산으로 줄이되 종류별 윤곽 차이를 보존하려는 기본 예산이다.
const DEFAULT_BUDGETS: Readonly<Record<PieceType, number>> = {
  Pawn: 3_000,
  Rook: 5_000,
  Knight: 7_000,
  Bishop: 8_000,
  Queen: 6_000,
  King: 8_000,
};

// 잘못된 원본을 변환하지 않도록 설계 문서에 확정된 해시를 브라우저에서도 확인한다.
const EXPECTED_SOURCE_HASH =
  "EC72D21CF6ACE76BFBC6F40DB7EF8DA6DB7C5B24D0098ADA4CD9438449870CF0";

// Rapier convexHull 입력 크기와 브라우저 메타 파일 크기를 제한하는 상한이다.
const MAX_COLLIDER_POINTS = 400;

// 얕은 원뿔형 바닥을 안정된 지지면으로 바꾸는 기본 높이 허용치다.
const BASE_FLATTEN_EPS = 0.004;

// 점 하나나 좁은 선분으로 서는 콜라이더를 거부하기 위한 최소 지지 다각형 정점 수다.
const MIN_BASE_HULL_POINTS = 12;

// GLB 2.0 청크를 읽고 다시 조립할 때 사용하는 고정 식별자다.
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;

const fileInput = mustFind<HTMLInputElement>("#file-input");
const dropZone = mustFind<HTMLElement>("#drop-zone");
const fileSummary = mustFind<HTMLElement>("#file-summary");
const runMessage = mustFind<HTMLElement>("#run-message");
const errorPanel = mustFind<HTMLElement>("#error-panel");
const errorText = mustFind<HTMLElement>("#error-text");
const retryButton = mustFind<HTMLButtonElement>("#retry-button");
const groupsSection = mustFind<HTMLElement>("#groups-section");
const groupGrid = mustFind<HTMLElement>("#group-grid");
const heightCheckResult = mustFind<HTMLElement>("#height-check-result");
const positionCheckResult = mustFind<HTMLElement>("#position-check-result");
const crossCheckOverrideRow = mustFind<HTMLElement>(
  "#cross-check-override-row",
);
const crossCheckOverride = mustFind<HTMLInputElement>(
  "#cross-check-override",
);
const convertButton = mustFind<HTMLButtonElement>("#convert-button");
const reportSection = mustFind<HTMLElement>("#report-section");
const reportContent = mustFind<HTMLElement>("#report-content");
const downloadGlbButton = mustFind<HTMLButtonElement>(
  "#download-glb-button",
);
const downloadMetaButton = mustFind<HTMLButtonElement>(
  "#download-meta-button",
);

const stageElements = new Map<StageName, HTMLLIElement>();
for (const stage of ["parse", "classify", "simplify", "export"] as const) {
  stageElements.set(
    stage,
    mustFind<HTMLLIElement>(`[data-stage="${stage}"]`),
  );
}

let busy = false;
let workspace: Workspace | null = null;
let artifacts: DownloadArtifacts | null = null;
let lastFile: File | null = null;
let lastAction: LastAction = "inspect";
let failedStage: StageName = "parse";
let previewControllers: PreviewController[] = [];
const groupControls = new Map<number, GroupControls>();

/**
 * 변환 페이지의 필수 DOM 요소를 타입과 함께 찾고 누락 시 즉시 원인을 알린다.
 */
function mustFind<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`필수 화면 요소를 찾지 못했습니다: ${selector}`);
  }
  return element;
}

/**
 * 각 그룹의 대표 형상을 별도 WebGL 장면에서 회전·확대할 수 있게 보여준다.
 */
class PreviewController {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(35, 4 / 3, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly model: Mesh<BufferGeometry, MeshNormalMaterial>;
  private readonly resizeObserver: ResizeObserver;
  private animationFrame = 0;

  constructor(
    private readonly host: HTMLElement,
    source: MeshInventoryItem,
  ) {
    const geometry = createPreviewGeometry(source);
    const material = new MeshNormalMaterial({ flatShading: false });
    this.model = new Mesh(geometry, material);

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(new Color("#eae2d4"), 1);
    this.host.append(this.renderer.domElement);

    this.scene.add(
      new HemisphereLight(0xffffff, 0x5d4933, 2.1),
      new DirectionalLight(0xffffff, 1.4),
      this.model,
    );

    const sphere = geometry.boundingSphere;
    const radius = Math.max(sphere?.radius ?? 1, 0.01);
    this.camera.position.set(radius * 2.3, radius * 1.45, radius * 2.3);
    this.camera.near = Math.max(radius / 100, 0.001);
    this.camera.far = radius * 20;
    this.camera.updateProjectionMatrix();

    this.controls = new OrbitControls(
      this.camera,
      this.renderer.domElement,
    );
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = radius * 1.3;
    this.controls.maxDistance = radius * 6;
    this.controls.target.set(0, 0, 0);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.render();
  }

  /**
   * 새 FBX를 읽을 때 이전 WebGL 자원을 정리해 컨텍스트와 메모리가 누적되지 않게 한다.
   */
  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.model.geometry.dispose();
    this.model.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /**
   * 카드 크기 변화에 맞춰 캔버스 해상도와 카메라 종횡비를 함께 갱신한다.
   */
  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 형상을 천천히 돌리면서 사용자의 OrbitControls 입력도 매 프레임 반영한다.
   */
  private render = (): void => {
    this.animationFrame = requestAnimationFrame(this.render);
    this.model.rotation.y += 0.003;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

/**
 * 원본 메시를 월드 좌표로 bake하고 중앙에 놓아 카드 안에서 온전한 형상을 보여준다.
 */
function createPreviewGeometry(source: MeshInventoryItem): BufferGeometry {
  const geometry = source.mesh.geometry.clone();
  geometry.applyMatrix4(source.mesh.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box === null || box.isEmpty()) {
    geometry.dispose();
    throw new Error(
      `${source.mesh.name || "(이름 없음)"} 대표 메시의 미리보기 경계를 계산하지 못했습니다.`,
    );
  }
  const center = box.getCenter(new Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 상태 칸 하나를 대기·진행·완료·오류 중 하나로 갱신한다.
 */
function setStage(
  stage: StageName,
  status: StageStatus,
  detail?: string,
): void {
  const element = stageElements.get(stage);
  if (element === undefined) {
    throw new Error(`알 수 없는 단계입니다: ${stage}`);
  }

  element.dataset.status = status;
  const output = element.querySelector("output");
  if (output === null) {
    throw new Error(`${stage} 단계의 상태 출력 요소가 없습니다.`);
  }

  const fallback: Record<StageStatus, string> = {
    pending: "대기",
    running: "진행 중",
    done: "완료",
    error: "실패",
  };
  output.textContent = detail ?? fallback[status];
}

/**
 * 새 파일 검사를 시작하기 전 네 단계 표시를 모두 초기 상태로 되돌린다.
 */
function resetStages(): void {
  for (const stage of stageElements.keys()) {
    setStage(stage, "pending");
  }
}

/**
 * 중복 실행을 막기 위해 파일 입력과 실행 버튼을 한 번에 잠그거나 해제한다.
 */
function setBusy(nextBusy: boolean): void {
  busy = nextBusy;
  fileInput.disabled = nextBusy;
  dropZone.classList.toggle("is-disabled", nextBusy);
  convertButton.disabled = nextBusy || !canStartConversion();
  retryButton.disabled = nextBusy;
}

/**
 * 예외 객체의 이름·메시지·스택을 생략하지 않고 오류 패널에 표시한다.
 */
function showError(stage: StageName, error: unknown): void {
  failedStage = stage;
  setStage(stage, "error");
  errorPanel.hidden = false;
  errorText.textContent = formatError(error);
  runMessage.textContent =
    "변환이 중단되었습니다. 오류 전문을 확인한 뒤 다시 시도할 수 있습니다.";
}

/**
 * Error가 아닌 값까지 포함해 사용자가 원인을 복사할 수 있는 전체 문자열로 바꾼다.
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    const summary = `${error.name}: ${error.message}`;
    return error.stack === undefined || error.stack.startsWith(summary)
      ? (error.stack ?? summary)
      : `${summary}\n\n${error.stack}`;
  }
  return String(error);
}

/**
 * 이전 실패 내용을 숨겨 새 시도의 상태와 섞이지 않게 한다.
 */
function clearError(): void {
  errorPanel.hidden = true;
  errorText.textContent = "";
}

/**
 * 브라우저가 상태 문구를 먼저 그릴 한 프레임을 확보한 뒤 무거운 작업을 시작한다.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * 파일 크기를 보고서와 파일 선택 요약에 읽기 쉬운 단위로 표시한다.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes.toLocaleString("ko-KR")} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * 드롭된 원본의 SHA-256을 대문자 16진수로 계산한다.
 */
async function calculateSha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
}

/**
 * Object3D가 정적 BufferGeometry 메시인지 확인해 순회 결과를 안전하게 좁힌다.
 */
function isBufferMesh(object: Object3D): object is Mesh<BufferGeometry> {
  const candidate = object as Mesh<BufferGeometry>;
  return candidate.isMesh === true && candidate.geometry?.isBufferGeometry;
}

/**
 * 월드 AABB와 정점·삼각형 수를 모든 메시에서 수집한다.
 */
function buildInventory(scene: Group): MeshInventoryItem[] {
  scene.updateMatrixWorld(true);
  const inventory: MeshInventoryItem[] = [];

  scene.traverse((object) => {
    if (!isBufferMesh(object)) {
      return;
    }

    const position = object.geometry.getAttribute("position");
    if (position === undefined || position.itemSize < 3) {
      throw new Error(
        `${object.name || "(이름 없음)"} 메시에는 유효한 position 속성이 없습니다.`,
      );
    }

    const bounds = new Box3().setFromObject(object);
    if (bounds.isEmpty()) {
      throw new Error(
        `${object.name || "(이름 없음)"} 메시의 월드 AABB가 비어 있습니다.`,
      );
    }

    const size = bounds.getSize(new Vector3());
    const index = object.geometry.getIndex();
    const triangles = (index?.count ?? position.count) / 3;
    if (!Number.isInteger(triangles)) {
      throw new Error(
        `${object.name || "(이름 없음)"} 메시의 인덱스 수가 삼각형 단위가 아닙니다.`,
      );
    }

    inventory.push({
      mesh: object,
      vertexCount: position.count,
      triangles,
      bounds,
      center: bounds.getCenter(new Vector3()),
      size,
      horizontalArea: size.x * size.z,
    });
  });

  return inventory;
}

/**
 * 수평 면적이 가장 큰 두 메시를 보드로 제외하고 관측 정점 수와 그룹 크기로 종류를 자기 보정한다.
 */
function classifyInventory(inventory: MeshInventoryItem[]): {
  boards: MeshInventoryItem[];
  groups: PieceGroup[];
} {
  if (inventory.length !== 34) {
    throw new Error(
      `지오메트리 메시가 34개여야 하지만 ${inventory.length}개를 찾았습니다.`,
    );
  }

  const sortedByArea = [...inventory].sort(
    (left, right) => right.horizontalArea - left.horizontalArea,
  );
  const boards = sortedByArea.slice(0, 2);
  const boardSet = new Set(boards);
  const pieces = inventory.filter((item) => !boardSet.has(item));

  if (pieces.length !== 32) {
    throw new Error(`말 메시가 32개여야 하지만 ${pieces.length}개입니다.`);
  }

  const itemsByVertexCount = new Map<number, MeshInventoryItem[]>();
  for (const piece of pieces) {
    const group = itemsByVertexCount.get(piece.vertexCount) ?? [];
    group.push(piece);
    itemsByVertexCount.set(piece.vertexCount, group);
  }

  const observedGroups = [...itemsByVertexCount.entries()].map(
    ([observedVertexCount, items]) => ({ observedVertexCount, items }),
  );
  const groupSummary = observedGroups
    .sort(
      (left, right) =>
        left.observedVertexCount - right.observedVertexCount,
    )
    .map(
      (group) =>
        `${group.observedVertexCount.toLocaleString("ko-KR")} 정점 × ${group.items.length}개`,
    )
    .join(", ");

  if (observedGroups.length !== PIECE_TYPES.length) {
    throw new Error(
      `동일 position.count 기준 그룹이 6개여야 하지만 ${observedGroups.length}개입니다.\n관측 그룹: ${groupSummary}`,
    );
  }

  const observedGroupSizes = observedGroups
    .map((group) => group.items.length)
    .sort((left, right) => left - right);
  const hasExpectedSizes = EXPECTED_GROUP_SIZES.every(
    (expected, index) => observedGroupSizes[index] === expected,
  );
  if (!hasExpectedSizes) {
    throw new Error(
      `말 그룹 크기 구성이 2,2,4,4,4,16이어야 하지만 ${observedGroupSizes.join(",")}입니다.\n관측 그룹: ${groupSummary}`,
    );
  }

  const pawnGroup = observedGroups.find((group) => group.items.length === 16);
  const fourPieceGroups = observedGroups
    .filter((group) => group.items.length === 4)
    .sort(
      (left, right) =>
        left.observedVertexCount - right.observedVertexCount,
    );
  const twoPieceGroups = observedGroups
    .filter((group) => group.items.length === 2)
    .sort(
      (left, right) =>
        left.observedVertexCount - right.observedVertexCount,
    );
  if (
    pawnGroup === undefined ||
    fourPieceGroups.length !== 3 ||
    twoPieceGroups.length !== 2
  ) {
    throw new Error(
      `자기 보정 그룹을 16개 그룹 하나, 4개 그룹 셋, 2개 그룹 둘로 나누지 못했습니다.\n관측 그룹: ${groupSummary}`,
    );
  }

  const assigned = new Map<
    PieceType,
    { observedVertexCount: number; items: MeshInventoryItem[] }
  >();
  assigned.set(PIECE_TYPES[0], pawnGroup);
  for (let index = 0; index < fourPieceGroups.length; index += 1) {
    assigned.set(PIECE_TYPES[index + 1], fourPieceGroups[index]);
  }
  for (let index = 0; index < twoPieceGroups.length; index += 1) {
    assigned.set(PIECE_TYPES[index + 4], twoPieceGroups[index]);
  }

  const groups = PIECE_TYPES.map((type): PieceGroup => {
    const observed = assigned.get(type);
    if (observed === undefined) {
      throw new Error(`${type} 자기 보정 그룹을 만들지 못했습니다.`);
    }
    return {
      observedVertexCount: observed.observedVertexCount,
      detectedType: type,
      items: observed.items,
      representative: observed.items[0],
    };
  });

  return { boards, groups };
}

/**
 * 플레이 면과 프레임의 월드 AABB에서 셀 크기와 보드 두께 원본값을 구한다.
 */
function measureBoard(boards: MeshInventoryItem[]): {
  sourceCellSize: number;
  sourceBoardThickness: number;
} {
  const byArea = [...boards].sort(
    (left, right) => left.horizontalArea - right.horizontalArea,
  );
  const playingSurface = byArea[0];
  const frame = byArea[1];
  const sourceCellSize = Math.min(
    playingSurface.size.x,
    playingSurface.size.z,
  ) / 8;
  const sourceBoardThickness = frame.size.y;

  if (sourceCellSize <= 0 || sourceBoardThickness <= 0) {
    throw new Error(
      `보드 치수가 유효하지 않습니다. 셀=${sourceCellSize}, 두께=${sourceBoardThickness}`,
    );
  }

  return { sourceCellSize, sourceBoardThickness };
}

/**
 * 현재 그룹 지정에서 높이와 백랭크 위치라는 독립 근거 두 가지를 계산한다.
 */
function evaluateCrossChecks(
  assigned: Map<PieceType, PieceGroup>,
): CrossCheckResults {
  const king = assigned.get("King");
  const queen = assigned.get("Queen");
  const height: CrossCheckResult =
    king === undefined || queen === undefined
      ? {
          valid: false,
          message: "King과 Queen을 각각 한 그룹에 지정해야 높이를 확인할 수 있습니다.",
        }
      : {
          valid:
            king.representative.size.y > queen.representative.size.y,
          message:
            king.representative.size.y > queen.representative.size.y
              ? `높이 통과 · King ${king.representative.size.y.toFixed(6)} > Queen ${queen.representative.size.y.toFixed(6)}`
              : `높이 경고 · King ${king.representative.size.y.toFixed(6)}가 Queen ${queen.representative.size.y.toFixed(6)}보다 높지 않습니다.`,
        };

  return {
    height,
    position: checkBackRankPosition(
      assigned.get("Rook"),
      assigned.get("Knight"),
      assigned.get("Bishop"),
    ),
  };
}

/**
 * 세 백랭크 그룹이 중앙에서 Rook, Knight, Bishop 순으로 멀어지는지 검사한다.
 */
function checkBackRankPosition(
  rookGroup: PieceGroup | undefined,
  knightGroup: PieceGroup | undefined,
  bishopGroup: PieceGroup | undefined,
): CrossCheckResult {
  if (
    rookGroup === undefined ||
    knightGroup === undefined ||
    bishopGroup === undefined
  ) {
    return {
      valid: false,
      message:
        "Rook, Knight, Bishop을 각각 한 그룹에 지정해야 백랭크 위치를 확인할 수 있습니다.",
    };
  }

  const combined = [
    ...rookGroup.items,
    ...knightGroup.items,
    ...bishopGroup.items,
  ];
  const uniqueX = countDistinctCoordinates(combined.map((item) => item.center.x));
  const uniqueZ = countDistinctCoordinates(combined.map((item) => item.center.z));
  const columnAxis: "x" | "z" = uniqueX >= uniqueZ ? "x" : "z";
  const center =
    combined.reduce((sum, item) => sum + item.center[columnAxis], 0) /
    combined.length;
  const rookOffset = averageAbsoluteOffset(
    rookGroup.items,
    columnAxis,
    center,
  );
  const knightOffset = averageAbsoluteOffset(
    knightGroup.items,
    columnAxis,
    center,
  );
  const bishopOffset = averageAbsoluteOffset(
    bishopGroup.items,
    columnAxis,
    center,
  );
  const valid = rookOffset > knightOffset && knightOffset > bishopOffset;
  const values = `Rook ${rookOffset.toFixed(6)} > Knight ${knightOffset.toFixed(6)} > Bishop ${bishopOffset.toFixed(6)}`;

  return {
    valid,
    message: valid
      ? `위치 통과 · ${columnAxis.toUpperCase()}축 평균 절대 오프셋 ${values}`
      : `위치 경고 · ${columnAxis.toUpperCase()}축 평균 절대 오프셋이 ${values} 순서를 만족하지 않습니다.`,
  };
}

/**
 * 부동소수점 흔들림을 제거한 뒤 한 축에 서로 다른 보드 좌표가 몇 개인지 센다.
 */
function countDistinctCoordinates(values: number[]): number {
  return new Set(values.map((value) => Math.round(value * 1_000))).size;
}

/**
 * 한 그룹이 백랭크 중앙에서 평균적으로 얼마나 떨어져 있는지 계산한다.
 */
function averageAbsoluteOffset(
  items: MeshInventoryItem[],
  axis: "x" | "z",
  center: number,
): number {
  return (
    items.reduce(
      (sum, item) => sum + Math.abs(item.center[axis] - center),
      0,
    ) / items.length
  );
}

/**
 * 분류된 여섯 그룹의 드롭다운·예산·3D 미리보기를 새로 만든다.
 */
function renderGroups(groups: PieceGroup[]): void {
  disposePreviews();
  groupControls.clear();
  crossCheckOverride.checked = false;
  groupGrid.replaceChildren();
  groupsSection.hidden = false;

  for (const group of groups) {
    const card = document.createElement("article");
    card.className = "group-card";

    const previewHost = document.createElement("div");
    previewHost.className = "preview-host";

    const fields = document.createElement("div");
    fields.className = "group-fields";

    const heading = document.createElement("h3");
    heading.textContent = `관측 position.count ${group.observedVertexCount.toLocaleString("ko-KR")}`;

    const stats = document.createElement("p");
    stats.className = "group-stats";
    stats.textContent = `메시 ${group.items.length}개 · 대표 원본 ${group.representative.triangles.toLocaleString("ko-KR")} triangles`;

    const typeLabel = document.createElement("label");
    typeLabel.textContent = "그룹 종류";
    const select = document.createElement("select");
    select.setAttribute(
      "aria-label",
      `${group.observedVertexCount} 정점 그룹 종류 재지정`,
    );
    for (const type of PIECE_TYPES) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      option.selected = type === group.detectedType;
      select.append(option);
    }
    typeLabel.append(select);

    const budgetLabel = document.createElement("label");
    budgetLabel.textContent = "삼각형 예산";
    const budget = document.createElement("input");
    budget.type = "number";
    budget.min = "100";
    budget.max = "100000";
    budget.step = "100";
    budget.value = String(DEFAULT_BUDGETS[group.detectedType]);
    budget.setAttribute(
      "aria-label",
      `${group.observedVertexCount} 정점 그룹 삼각형 예산`,
    );
    budgetLabel.append(budget);

    const baseFlattenLabel = document.createElement("label");
    baseFlattenLabel.textContent = "바닥 평탄화 ε";
    const baseFlattenEps = document.createElement("input");
    baseFlattenEps.type = "number";
    baseFlattenEps.min = "0";
    baseFlattenEps.step = "0.0001";
    baseFlattenEps.value = String(BASE_FLATTEN_EPS);
    baseFlattenEps.setAttribute(
      "aria-label",
      `${group.observedVertexCount} 정점 그룹 바닥 평탄화 허용치`,
    );
    baseFlattenLabel.append(baseFlattenEps);

    fields.append(
      heading,
      stats,
      typeLabel,
      budgetLabel,
      baseFlattenLabel,
    );
    card.append(previewHost, fields);
    groupGrid.append(card);

    groupControls.set(group.observedVertexCount, {
      select,
      budget,
      baseFlattenEps,
    });
    previewControllers.push(
      new PreviewController(previewHost, group.representative),
    );

    select.addEventListener("change", () => {
      const selectedType = select.value as PieceType;
      budget.value = String(DEFAULT_BUDGETS[selectedType]);
      crossCheckOverride.checked = false;
      updateAssignmentState();
    });
    budget.addEventListener("input", updateAssignmentState);
    baseFlattenEps.addEventListener("input", updateAssignmentState);
  }

  updateAssignmentState();
}

/**
 * 현재 드롭다운에서 각 종류가 정확히 한 번 지정되었는지 확인한다.
 */
function hasValidAssignments(): boolean {
  if (workspace === null || groupControls.size !== PIECE_TYPES.length) {
    return false;
  }

  const assigned = [...groupControls.values()].map(
    (control) => control.select.value,
  );
  const unique = new Set(assigned);
  const inputsValid = [...groupControls.values()].every((control) => {
    const budget = Number(control.budget.value);
    const baseFlattenEps = Number(control.baseFlattenEps.value);
    return (
      Number.isInteger(budget) &&
      budget >= 100 &&
      Number.isFinite(baseFlattenEps) &&
      baseFlattenEps >= 0
    );
  });
  return (
    unique.size === PIECE_TYPES.length &&
    PIECE_TYPES.every((type) => unique.has(type)) &&
    inputsValid
  );
}

/**
 * 종류·예산 입력과 교차검사 승인 상태를 모두 만족할 때만 실행 가능하다고 판단한다.
 */
function canStartConversion(): boolean {
  if (!hasValidAssignments()) {
    return false;
  }
  const checks = evaluateCrossChecks(getAssignedGroups(false));
  return (
    (checks.height.valid && checks.position.valid) ||
    crossCheckOverride.checked
  );
}

/**
 * 수동 재지정과 두 교차검사를 다시 계산해 경고 확인 전에는 변환 실행을 차단한다.
 */
function updateAssignmentState(): void {
  const assignmentsValid = hasValidAssignments();
  const checks = evaluateCrossChecks(getAssignedGroups(false));
  const automaticPass = checks.height.valid && checks.position.valid;

  heightCheckResult.textContent = checks.height.message;
  heightCheckResult.classList.toggle("warning", !checks.height.valid);
  positionCheckResult.textContent = checks.position.message;
  positionCheckResult.classList.toggle("warning", !checks.position.valid);

  if (!assignmentsValid || automaticPass) {
    crossCheckOverride.checked = false;
  }
  crossCheckOverrideRow.hidden = !assignmentsValid || automaticPass;
  const warningAccepted = automaticPass || crossCheckOverride.checked;
  convertButton.disabled = busy || !assignmentsValid || !warningAccepted;

  if (!assignmentsValid) {
    runMessage.textContent =
      "각 종류를 정확히 한 번씩 지정하고 100 이상의 정수 예산과 0 이상의 바닥 평탄화 허용치를 입력하세요.";
  } else if (!automaticPass && !crossCheckOverride.checked) {
    runMessage.textContent =
      "위치 또는 높이 교차 확인이 실패했습니다. 수동 지정을 검토하고 경고 확인란을 선택해야 진행할 수 있습니다.";
  } else if (!automaticPass) {
    runMessage.textContent =
      "교차 확인 경고를 수동으로 승인했습니다. 미리보기와 예산을 다시 확인하세요.";
  } else if (!busy) {
    runMessage.textContent =
      "판별과 교차 확인 2종이 통과했습니다. 미리보기와 예산을 확인한 뒤 변환을 실행하세요.";
  }
}

/**
 * 화면의 종류 선택을 PieceType별 그룹 맵으로 읽고 필요하면 완전성을 강제한다.
 */
function getAssignedGroups(
  strict: boolean,
): Map<PieceType, PieceGroup> {
  const assigned = new Map<PieceType, PieceGroup>();
  if (workspace === null) {
    return assigned;
  }

  for (const group of workspace.groups) {
    const controls = groupControls.get(group.observedVertexCount);
    if (controls === undefined) {
      if (strict) {
        throw new Error(
          `${group.observedVertexCount} 정점 그룹의 수동 지정 입력을 찾지 못했습니다.`,
        );
      }
      continue;
    }
    const type = controls.select.value as PieceType;
    if (assigned.has(type)) {
      if (strict) {
        throw new Error(`${type} 종류가 두 그룹 이상에 지정되었습니다.`);
      }
      continue;
    }
    assigned.set(type, group);
  }

  if (
    strict &&
    (assigned.size !== PIECE_TYPES.length ||
      PIECE_TYPES.some((type) => !assigned.has(type)))
  ) {
    throw new Error("여섯 종류를 각각 정확히 한 그룹에 지정해야 합니다.");
  }
  return assigned;
}

/**
 * 그룹 카드에 입력된 삼각형 예산을 PieceType 기준으로 읽고 범위를 검증한다.
 */
function readBudget(group: PieceGroup): number {
  const control = groupControls.get(group.observedVertexCount);
  if (control === undefined) {
    throw new Error(
      `${group.observedVertexCount} 정점 그룹의 삼각형 예산 입력을 찾지 못했습니다.`,
    );
  }
  const budget = Number(control.budget.value);
  if (!Number.isInteger(budget) || budget < 100) {
    throw new Error(
      `${control.select.value} 삼각형 예산은 100 이상의 정수여야 합니다.`,
    );
  }
  return budget;
}

/**
 * 그룹 카드의 바닥 평탄화 허용치를 읽고 음수나 숫자가 아닌 입력을 거부한다.
 */
function readBaseFlattenEps(group: PieceGroup): number {
  const control = groupControls.get(group.observedVertexCount);
  if (control === undefined) {
    throw new Error(
      `${group.observedVertexCount} 정점 그룹의 바닥 평탄화 입력을 찾지 못했습니다.`,
    );
  }
  const baseFlattenEps = Number(control.baseFlattenEps.value);
  if (!Number.isFinite(baseFlattenEps) || baseFlattenEps < 0) {
    throw new Error(
      `${control.select.value} 바닥 평탄화 허용치는 0 이상의 숫자여야 합니다.`,
    );
  }
  return baseFlattenEps;
}

/**
 * 새 파일 검사 전에 이전 미리보기의 WebGL 자원을 모두 해제한다.
 */
function disposePreviews(): void {
  for (const controller of previewControllers) {
    controller.dispose();
  }
  previewControllers = [];
}

/**
 * 교체되는 FBX 장면의 지오메트리와 재질을 중복 없이 해제한다.
 */
function disposeWorkspace(current: Workspace | null): void {
  if (current === null) {
    return;
  }
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();

  current.scene.traverse((object) => {
    if (!isBufferMesh(object)) {
      return;
    }
    geometries.add(object.geometry);
    const list = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of list) {
      materials.add(material);
    }
  });

  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
}

/**
 * FBX를 읽고 해시·메시 집계·시그니처 분류를 마친 뒤 검토 UI를 연다.
 */
async function inspectFile(file: File): Promise<void> {
  if (busy) {
    runMessage.textContent =
      "이미 작업이 진행 중입니다. 현재 단계가 끝난 뒤 다시 시도하세요.";
    return;
  }

  lastFile = file;
  lastAction = "inspect";
  failedStage = "parse";
  clearError();
  resetStages();
  reportSection.hidden = true;
  groupsSection.hidden = true;
  artifacts = null;
  disposePreviews();
  groupControls.clear();
  disposeWorkspace(workspace);
  workspace = null;
  setBusy(true);

  try {
    setStage("parse", "running", "파일 읽는 중");
    runMessage.textContent = "FBX 파일과 SHA-256을 읽고 있습니다.";
    fileSummary.textContent = `${file.name} · ${formatBytes(file.size)}`;
    await nextFrame();

    if (!file.name.toLowerCase().endsWith(".fbx")) {
      throw new Error(`FBX 파일만 선택할 수 있습니다: ${file.name}`);
    }

    const buffer = await file.arrayBuffer();
    const sourceHash = await calculateSha256(buffer);
    if (sourceHash !== EXPECTED_SOURCE_HASH) {
      throw new Error(
        `원본 SHA-256이 설계값과 다릅니다.\n예상: ${EXPECTED_SOURCE_HASH}\n실제: ${sourceHash}`,
      );
    }

    const scene = new FBXLoader().parse(buffer, "");
    scene.updateMatrixWorld(true);
    setStage("parse", "done", "FBX + SHA 확인");

    failedStage = "classify";
    setStage("classify", "running", "메시 집계 중");
    runMessage.textContent =
      "월드 AABB와 정점 수를 집계하고 보드와 말 그룹을 판별하고 있습니다.";
    await nextFrame();

    const inventory = buildInventory(scene);
    const classified = classifyInventory(inventory);
    const boardMeasurements = measureBoard(classified.boards);
    workspace = {
      sourceHash,
      scene,
      boards: classified.boards,
      groups: classified.groups,
      ...boardMeasurements,
    };

    renderGroups(classified.groups);
    setStage("classify", "done", "보드 2 · 말 32");
    setStage("simplify", "pending", "검토 후 실행");
    setStage("export", "pending");
  } catch (error) {
    showError(failedStage, error);
  } finally {
    setBusy(false);
  }
}

/**
 * 정규화 5단계를 설계 순서 그대로 적용해 모든 변환을 지오메트리에 남긴다.
 */
function normalizeRepresentative(
  source: MeshInventoryItem,
  type: PieceType,
  globalScale: number,
  material: MeshStandardMaterial,
): Mesh<BufferGeometry, MeshStandardMaterial> {
  const geometry = source.mesh.geometry.clone();

  // 계층에 흩어진 피벗·회전·스케일을 먼저 bake해 이후 경계 계산을 월드 형상 기준으로 통일한다.
  geometry.applyMatrix4(source.mesh.matrixWorld);
  geometry.computeBoundingBox();
  let bounds = requireBounds(geometry, `${type} 월드 bake`);

  // 바닥 높이를 보존한 채 월드 AABB의 가로 중심만 원점으로 옮겨 종류별 피벗 차이를 없앤다.
  const center = bounds.getCenter(new Vector3());
  geometry.translate(-center.x, 0, -center.z);
  geometry.computeBoundingBox();
  bounds = requireBounds(geometry, `${type} x/z 중앙 정렬`);

  // 수평 정렬이 끝난 형상의 최저점을 y=0에 맞춰 이후 스폰 높이의 공통 기준을 만든다.
  geometry.translate(0, -bounds.min.y, 0);

  // 종류 간 원본 비율을 보존하려고 킹 높이에서 얻은 하나의 전역 배율만 모든 형상에 적용한다.
  geometry.scale(globalScale, globalScale, globalScale);
  geometry.computeBoundingBox();

  const node = new Mesh(geometry, material);
  node.name = type;
  node.updateMatrix();

  // bake 결과가 지오메트리에만 남아야 하므로 내보내기 전에 노드 변환이 비어 있는지 검증한다.
  assertIdentityTransform(node, type);
  return node;
}

/**
 * 계산된 BufferGeometry 경계가 비어 있지 않은지 확인하고 Box3를 반환한다.
 */
function requireBounds(geometry: BufferGeometry, context: string): Box3 {
  const bounds = geometry.boundingBox;
  if (bounds === null || bounds.isEmpty()) {
    throw new Error(`${context} 단계에서 유효한 AABB를 계산하지 못했습니다.`);
  }
  return bounds;
}

/**
 * 위치·회전·스케일과 행렬이 모두 identity인지 작은 부동소수점 오차 범위에서 확인한다.
 */
function isIdentityTransform(object: Object3D): boolean {
  object.updateMatrix();
  const epsilon = 1e-9;
  const expectedMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return (
    object.position.lengthSq() <= epsilon &&
    Math.abs(object.quaternion.x) <= epsilon &&
    Math.abs(object.quaternion.y) <= epsilon &&
    Math.abs(object.quaternion.z) <= epsilon &&
    Math.abs(object.quaternion.w - 1) <= epsilon &&
    Math.abs(object.scale.x - 1) <= epsilon &&
    Math.abs(object.scale.y - 1) <= epsilon &&
    Math.abs(object.scale.z - 1) <= epsilon &&
    object.matrix.elements.every(
      (value, index) => Math.abs(value - expectedMatrix[index]) <= epsilon,
    )
  );
}

/**
 * identity 계약 위반을 종류 이름과 함께 즉시 중단 오류로 바꾼다.
 */
function assertIdentityTransform(object: Object3D, type: PieceType): void {
  if (!isIdentityTransform(object)) {
    throw new Error(`${type} 최상위 노드의 TRS가 identity가 아닙니다.`);
  }
}

/**
 * 위치만 남긴 지오메트리를 병합·index화하고 meshoptimizer로 예산까지 감축한다.
 */
function simplifyGeometry(
  normalized: BufferGeometry,
  type: PieceType,
  triangleBudget: number,
): BufferGeometry {
  const sourcePosition = normalized.getAttribute("position");
  if (sourcePosition === undefined || sourcePosition.itemSize < 3) {
    throw new Error(`${type} 정규화 지오메트리에 position 속성이 없습니다.`);
  }

  const clean = new BufferGeometry();
  clean.setAttribute(
    "position",
    new Float32BufferAttribute(copyPositions(sourcePosition), 3),
  );
  const sourceIndex = normalized.getIndex();
  if (sourceIndex !== null) {
    clean.setIndex(new BufferAttribute(copyIndices(sourceIndex), 1));
  }
  clean.clearGroups();

  const merged = mergeVertices(clean, 1e-6);
  clean.dispose();
  const mergedPosition = merged.getAttribute("position");
  const mergedIndex = merged.getIndex();
  if (mergedIndex === null) {
    merged.dispose();
    throw new Error(`${type} 정점 병합 후 index가 생성되지 않았습니다.`);
  }

  const indices = copyIndices(mergedIndex);
  const positions = copyPositions(mergedPosition);
  const targetIndexCount = Math.min(
    indices.length,
    Math.max(3, triangleBudget * 3),
  );
  const [simplifiedIndices] =
    targetIndexCount < indices.length
      ? MeshoptSimplifier.simplify(
          indices,
          positions,
          3,
          targetIndexCount,
          0.05,
          ["Permissive"],
        )
      : [indices, 0];

  if (simplifiedIndices.length > targetIndexCount) {
    merged.dispose();
    throw new Error(
      `${type} 감축이 예산에 도달하지 못했습니다. 목표 ${Math.floor(targetIndexCount / 3).toLocaleString("ko-KR")}, 결과 ${Math.floor(simplifiedIndices.length / 3).toLocaleString("ko-KR")} triangles`,
    );
  }

  const compacted = compactGeometry(positions, simplifiedIndices);
  merged.dispose();
  compacted.computeVertexNormals();
  return compacted;
}

/**
 * 감축이 없앤 극점 때문에 생긴 중심·바닥 오차를 다시 맞추고 최종 산출물 계약을 단언한다.
 */
function realignDecimatedGeometry(
  geometry: BufferGeometry,
  type: PieceType,
): FinalAlignment {
  geometry.computeBoundingBox();
  let bounds = requireBounds(geometry, `${type} 감축 후 수평 재정렬`);
  const center = bounds.getCenter(new Vector3());

  // 감축 결과 자체의 AABB 중심을 기준으로 옮겨 원본 정규화 때 사라진 극점에 의존하지 않게 한다.
  geometry.translate(-center.x, 0, -center.z);
  geometry.computeBoundingBox();
  bounds = requireBounds(geometry, `${type} 감축 후 접지`);

  // 재정렬된 형상의 실제 최저점을 바닥에 맞춰 슬라이스 1이 보정 없이 스폰할 수 있게 한다.
  geometry.translate(0, -bounds.min.y, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const finalBounds = requireBounds(geometry, `${type} 최종 정렬 검증`);
  const finalCenter = finalBounds.getCenter(new Vector3());
  const alignment: FinalAlignment = {
    minY: finalBounds.min.y,
    centerX: finalCenter.x,
    centerZ: finalCenter.z,
  };
  const tolerance = 1e-6;
  if (
    Math.abs(alignment.centerX) > tolerance ||
    Math.abs(alignment.centerZ) > tolerance ||
    Math.abs(alignment.minY) > tolerance
  ) {
    throw new Error(
      `${type} 감축 후 재정렬 계약을 만족하지 못했습니다. center.x=${alignment.centerX}, center.z=${alignment.centerZ}, minY=${alignment.minY}, 허용 오차=${tolerance}`,
    );
  }
  return alignment;
}

/**
 * BufferAttribute 구현 방식과 무관하게 position 값을 연속 Float32Array로 복사한다.
 */
function copyPositions(
  attribute: BufferAttribute | InterleavedBufferAttribute,
): Float32Array {
  const result = new Float32Array(attribute.count * 3);
  for (let index = 0; index < attribute.count; index += 1) {
    const offset = index * 3;
    result[offset] = attribute.getX(index);
    result[offset + 1] = attribute.getY(index);
    result[offset + 2] = attribute.getZ(index);
  }
  return result;
}

/**
 * 인덱스 비트 폭과 무관하게 meshoptimizer가 요구하는 Uint32Array로 복사한다.
 */
function copyIndices(
  attribute: BufferAttribute | InterleavedBufferAttribute,
): Uint32Array {
  const result = new Uint32Array(attribute.count);
  for (let index = 0; index < attribute.count; index += 1) {
    result[index] = attribute.getX(index);
  }
  return result;
}

/**
 * 감축 뒤 참조되지 않는 정점을 제거해 GLB 크기와 충돌체 후보 수를 줄인다.
 */
function compactGeometry(
  sourcePositions: Float32Array,
  sourceIndices: Uint32Array,
): BufferGeometry {
  const oldVertexCount = sourcePositions.length / 3;
  const remap = new Int32Array(oldVertexCount);
  remap.fill(-1);
  let nextIndex = 0;

  for (const sourceIndex of sourceIndices) {
    if (sourceIndex >= oldVertexCount) {
      throw new Error(
        `감축 인덱스 ${sourceIndex}가 정점 수 ${oldVertexCount} 범위를 벗어났습니다.`,
      );
    }
    if (remap[sourceIndex] === -1) {
      remap[sourceIndex] = nextIndex;
      nextIndex += 1;
    }
  }

  const positions = new Float32Array(nextIndex * 3);
  const indices = new Uint32Array(sourceIndices.length);
  for (let index = 0; index < sourceIndices.length; index += 1) {
    const sourceIndex = sourceIndices[index];
    const targetIndex = remap[sourceIndex];
    indices[index] = targetIndex;
    positions[targetIndex * 3] = sourcePositions[sourceIndex * 3];
    positions[targetIndex * 3 + 1] = sourcePositions[sourceIndex * 3 + 1];
    positions[targetIndex * 3 + 2] = sourcePositions[sourceIndex * 3 + 2];
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}

/**
 * 바닥 후보의 외곽선을 모두 보존해야 실제 접촉면이 한 점이 아닌 지지 다각형이 된다.
 */
function computeBaseHullIndices(
  points: Point3[],
  baseIndices: number[],
): number[] {
  const sorted = [...baseIndices].sort((leftIndex, rightIndex) => {
    const left = points[leftIndex];
    const right = points[rightIndex];
    return left[0] - right[0] || left[2] - right[2];
  });

  if (sorted.length <= 1) {
    return sorted;
  }

  const cross = (
    originIndex: number,
    leftIndex: number,
    rightIndex: number,
  ): number => {
    const origin = points[originIndex];
    const left = points[leftIndex];
    const right = points[rightIndex];
    return (
      (left[0] - origin[0]) * (right[2] - origin[2]) -
      (left[2] - origin[2]) * (right[0] - origin[0])
    );
  };

  const lower: number[] = [];
  for (const index of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], index) <= 0
    ) {
      lower.pop();
    }
    lower.push(index);
  }

  const upper: number[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const pointIndex = sorted[index];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], pointIndex) <= 0
    ) {
      upper.pop();
    }
    upper.push(pointIndex);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * 콜라이더 복사본의 얕은 바닥 돌출만 평탄화한 뒤 지지 외곽선과 축 극점을 우선 보존한다.
 */
function createColliderPoints(
  geometry: BufferGeometry,
  type: PieceType,
  baseFlattenEps: number,
): ColliderSample {
  geometry.computeBoundingBox();
  const geometryBounds = requireBounds(
    geometry,
    `${type} 콜라이더 바닥 평탄화`,
  );
  const minimumY = geometryBounds.min.y;
  const position = geometry.getAttribute("position");
  const unique = new Map<string, Point3>();
  for (let index = 0; index < position.count; index += 1) {
    const sourceY = position.getY(index);
    const point: Point3 = [
      position.getX(index),
      Math.abs(sourceY - minimumY) <= baseFlattenEps ? minimumY : sourceY,
      position.getZ(index),
    ];
    const key = point.join(",");
    if (!unique.has(key)) {
      unique.set(key, point);
    }
  }

  const points = [...unique.values()];
  if (points.length === 0) {
    throw new Error(`${type} 감축 지오메트리에 충돌체 후보점이 없습니다.`);
  }

  const baseIndices: number[] = [];
  let baseRadius = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (points[index][1] === minimumY) {
      baseIndices.push(index);
      baseRadius = Math.max(
        baseRadius,
        Math.hypot(points[index][0], points[index][2]),
      );
    }
  }
  const basePointCount = baseIndices.length;
  const baseHullIndices = computeBaseHullIndices(points, baseIndices);
  if (baseHullIndices.length < MIN_BASE_HULL_POINTS) {
    throw new Error(
      `${type} 콜라이더 바닥의 2D 볼록껍질이 ${baseHullIndices.length}점뿐입니다. 최소 ${MIN_BASE_HULL_POINTS}점이 필요하므로 바닥 평탄화 ε를 조정하세요.`,
    );
  }

  const extremeIndices = [0, 0, 0, 0, 0, 0];
  for (let index = 1; index < points.length; index += 1) {
    if (points[index][0] < points[extremeIndices[0]][0]) {
      extremeIndices[0] = index;
    }
    if (points[index][0] > points[extremeIndices[1]][0]) {
      extremeIndices[1] = index;
    }
    if (points[index][1] < points[extremeIndices[2]][1]) {
      extremeIndices[2] = index;
    }
    if (points[index][1] > points[extremeIndices[3]][1]) {
      extremeIndices[3] = index;
    }
    if (points[index][2] < points[extremeIndices[4]][2]) {
      extremeIndices[4] = index;
    }
    if (points[index][2] > points[extremeIndices[5]][2]) {
      extremeIndices[5] = index;
    }
  }

  const targetCount = Math.min(MAX_COLLIDER_POINTS, points.length);
  const selectedIndices: number[] = [];
  const selected = new Uint8Array(points.length);
  for (const priorityIndex of [...baseHullIndices, ...extremeIndices]) {
    if (selected[priorityIndex] === 0) {
      selected[priorityIndex] = 1;
      selectedIndices.push(priorityIndex);
    }
  }
  if (selectedIndices.length > MAX_COLLIDER_POINTS) {
    throw new Error(
      `${type} 콜라이더의 바닥 볼록껍질과 축 극점 ${selectedIndices.length}개가 ${MAX_COLLIDER_POINTS}점 상한을 초과합니다.`,
    );
  }

  const minimumDistances = new Float64Array(points.length);
  minimumDistances.fill(Number.POSITIVE_INFINITY);
  for (const selectedIndex of selectedIndices) {
    for (let index = 0; index < points.length; index += 1) {
      if (selected[index] === 1) {
        minimumDistances[index] = 0;
        continue;
      }
      minimumDistances[index] = Math.min(
        minimumDistances[index],
        squaredPointDistance(points[index], points[selectedIndex]),
      );
    }
  }

  while (selectedIndices.length < targetCount) {
    let farthestIndex = -1;
    let farthestDistance = -1;
    for (let index = 0; index < points.length; index += 1) {
      if (
        selected[index] === 0 &&
        minimumDistances[index] > farthestDistance
      ) {
        farthestIndex = index;
        farthestDistance = minimumDistances[index];
      }
    }
    if (farthestIndex < 0) {
      throw new Error(
        `${type} 충돌체 최원점 샘플링에서 다음 후보점을 찾지 못했습니다.`,
      );
    }

    selected[farthestIndex] = 1;
    selectedIndices.push(farthestIndex);
    for (let index = 0; index < points.length; index += 1) {
      if (selected[index] === 1) {
        minimumDistances[index] = 0;
        continue;
      }
      minimumDistances[index] = Math.min(
        minimumDistances[index],
        squaredPointDistance(points[index], points[farthestIndex]),
      );
    }
  }

  const sampled = selectedIndices.map(
    (index): Point3 => [
      roundNumber(points[index][0]),
      roundNumber(points[index][1]),
      roundNumber(points[index][2]),
    ],
  );
  assertColliderAabbMatches(geometry, type, sampled);
  return {
    points: sampled,
    aabbMatches: true,
    baseRadius,
    basePointCount,
    baseHullPointCount: baseHullIndices.length,
  };
}

/**
 * 최원점 샘플링이 반복 제곱근 없이 거리를 비교할 수 있도록 제곱 거리를 반환한다.
 */
function squaredPointDistance(left: Point3, right: Point3): number {
  const x = left[0] - right[0];
  const y = left[1] - right[1];
  const z = left[2] - right[2];
  return x * x + y * y + z * z;
}

/**
 * 샘플 점의 각 축 최솟값·최댓값이 감축 메시와 허용 오차 안에서 같은지 단언한다.
 */
function assertColliderAabbMatches(
  geometry: BufferGeometry,
  type: PieceType,
  points: Point3[],
): void {
  geometry.computeBoundingBox();
  const meshBounds = requireBounds(geometry, `${type} 콜라이더 AABB 검증`);
  const colliderMinimum: Point3 = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const colliderMaximum: Point3 = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      colliderMinimum[axis] = Math.min(colliderMinimum[axis], point[axis]);
      colliderMaximum[axis] = Math.max(colliderMaximum[axis], point[axis]);
    }
  }

  const axisNames = ["x", "y", "z"] as const;
  const tolerance = 1e-6;
  for (let axis = 0; axis < axisNames.length; axis += 1) {
    const meshMinimum = meshBounds.min.getComponent(axis);
    const meshMaximum = meshBounds.max.getComponent(axis);
    const minimumDifference = Math.abs(
      meshMinimum - colliderMinimum[axis],
    );
    const maximumDifference = Math.abs(
      meshMaximum - colliderMaximum[axis],
    );
    if (minimumDifference > tolerance || maximumDifference > tolerance) {
      throw new Error(
        `${type} 충돌체 AABB가 감축 메시와 일치하지 않습니다. ${axisNames[axis]}축 메시=${meshMinimum}..${meshMaximum}, 충돌체=${colliderMinimum[axis]}..${colliderMaximum[axis]}, 허용 오차=${tolerance}`,
      );
    }
  }
}

/**
 * JSON 부동소수점 값이 불필요하게 길어지지 않도록 여섯 자리에서 반올림한다.
 */
function roundNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * 임시 재질로 만든 GLB에서 materials 배열과 모든 primitive 참조를 제거한다.
 */
function stripMaterialsFromGlb(source: ArrayBuffer): ArrayBuffer {
  const document = readGlbJson(source);
  delete document.materials;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      delete primitive.material;
    }
  }
  return replaceGlbJson(source, document);
}

/**
 * GLB 헤더와 JSON 청크를 검사한 뒤 파싱된 glTF 문서를 반환한다.
 */
function readGlbJson(source: ArrayBuffer): GltfDocument {
  const view = new DataView(source);
  if (
    source.byteLength < 20 ||
    view.getUint32(0, true) !== GLB_MAGIC ||
    view.getUint32(4, true) !== GLB_VERSION
  ) {
    throw new Error("GLTFExporter 결과가 유효한 GLB 2.0 형식이 아닙니다.");
  }

  let offset = 12;
  while (offset + 8 <= source.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > source.byteLength) {
      throw new Error("GLB 청크 길이가 전체 파일 범위를 벗어났습니다.");
    }
    if (type === GLB_JSON_CHUNK) {
      const jsonText = new TextDecoder()
        .decode(new Uint8Array(source, start, length))
        .trimEnd();
      return JSON.parse(jsonText) as GltfDocument;
    }
    offset = end;
  }
  throw new Error("GLB에서 JSON 청크를 찾지 못했습니다.");
}

/**
 * 원본의 비JSON 청크는 그대로 보존하면서 JSON 청크만 새 문서로 교체한다.
 */
function replaceGlbJson(
  source: ArrayBuffer,
  document: GltfDocument,
): ArrayBuffer {
  const sourceView = new DataView(source);
  const chunks: Array<{ type: number; data: Uint8Array }> = [];
  let offset = 12;
  while (offset + 8 <= source.byteLength) {
    const length = sourceView.getUint32(offset, true);
    const type = sourceView.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > source.byteLength) {
      throw new Error("GLB 청크를 다시 조립하는 중 길이 오류가 발생했습니다.");
    }
    if (type !== GLB_JSON_CHUNK) {
      chunks.push({
        type,
        data: new Uint8Array(source.slice(start, end)),
      });
    }
    offset = end;
  }

  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const paddedJsonLength = Math.ceil(encodedJson.length / 4) * 4;
  const jsonData = new Uint8Array(paddedJsonLength);
  jsonData.fill(0x20);
  jsonData.set(encodedJson);
  chunks.unshift({ type: GLB_JSON_CHUNK, data: jsonData });

  const totalLength = chunks.reduce(
    (sum, chunk) => sum + 8 + chunk.data.byteLength,
    12,
  );
  const result = new ArrayBuffer(totalLength);
  const resultView = new DataView(result);
  const bytes = new Uint8Array(result);
  resultView.setUint32(0, GLB_MAGIC, true);
  resultView.setUint32(4, GLB_VERSION, true);
  resultView.setUint32(8, totalLength, true);

  offset = 12;
  for (const chunk of chunks) {
    resultView.setUint32(offset, chunk.data.byteLength, true);
    resultView.setUint32(offset + 4, chunk.type, true);
    bytes.set(chunk.data, offset + 8);
    offset += 8 + chunk.data.byteLength;
  }
  return result;
}

/**
 * 최종 GLB의 최상위 이름·identity TRS·재질 부재 계약을 JSON 청크에서 검증한다.
 */
function validateGlbContract(glb: ArrayBuffer): Record<PieceType, boolean> {
  const document = readGlbJson(glb);
  if (document.materials !== undefined) {
    throw new Error("최종 GLB에 materials 배열이 남아 있습니다.");
  }
  const sceneIndex = document.scene ?? 0;
  const rootIndices = document.scenes?.[sceneIndex]?.nodes ?? [];
  const nodes = document.nodes ?? [];
  const rootNodes = rootIndices.map((index) => nodes[index]);
  const names = rootNodes.map((node) => node?.name);

  if (
    names.length !== PIECE_TYPES.length ||
    PIECE_TYPES.some((type, index) => names[index] !== type)
  ) {
    throw new Error(
      `GLB 최상위 노드 계약이 다릅니다.\n예상: ${PIECE_TYPES.join(", ")}\n실제: ${names.join(", ")}`,
    );
  }

  for (const mesh of document.meshes ?? []) {
    if (
      (mesh.primitives ?? []).some(
        (primitive) => primitive.material !== undefined,
      )
    ) {
      throw new Error("최종 GLB primitive에 material 참조가 남아 있습니다.");
    }
  }

  const result = {} as Record<PieceType, boolean>;
  for (let index = 0; index < PIECE_TYPES.length; index += 1) {
    const type = PIECE_TYPES[index];
    const identity = isGltfNodeIdentity(rootNodes[index]);
    result[type] = identity;
    if (!identity) {
      throw new Error(`${type} GLB 최상위 노드의 TRS가 identity가 아닙니다.`);
    }
  }
  return result;
}

/**
 * glTF에서 생략 가능한 identity 필드까지 고려해 노드 변환을 검사한다.
 */
function isGltfNodeIdentity(node: GltfNode | undefined): boolean {
  if (node === undefined) {
    return false;
  }
  const translation = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const scale = node.scale ?? [1, 1, 1];
  const matrix =
    node.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const expectedMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const equals = (left: number[], right: number[]) =>
    left.length === right.length &&
    left.every((value, index) => Math.abs(value - right[index]) <= 1e-9);
  return (
    equals(translation, [0, 0, 0]) &&
    equals(rotation, [0, 0, 0, 1]) &&
    equals(scale, [1, 1, 1]) &&
    equals(matrix, expectedMatrix)
  );
}

/**
 * 그룹 지정 결과를 정규화·감축하고 GLB와 메타 JSON을 메모리에 생성한다.
 */
async function convertWorkspace(): Promise<void> {
  if (busy) {
    runMessage.textContent =
      "이미 작업이 진행 중입니다. 현재 단계가 끝난 뒤 다시 시도하세요.";
    return;
  }
  if (workspace === null) {
    showError("classify", new Error("먼저 유효한 FBX 파일을 불러오세요."));
    return;
  }

  lastAction = "convert";
  failedStage = "simplify";
  clearError();
  reportSection.hidden = true;
  artifacts = null;
  setStage("simplify", "running", "초기화 중");
  setStage("export", "pending");
  setBusy(true);

  const exportScene = new Scene();
  const exportMaterial = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
  });
  const converted: PieceConversion[] = [];

  try {
    const assignedGroups = getAssignedGroups(true);
    const crossChecks = evaluateCrossChecks(assignedGroups);
    const automaticChecksPassed =
      crossChecks.height.valid && crossChecks.position.valid;
    const overrideUsed =
      !automaticChecksPassed && crossCheckOverride.checked;
    if (!automaticChecksPassed && !overrideUsed) {
      throw new Error(
        "위치 또는 높이 교차 확인이 실패했습니다. 수동 지정을 검토한 뒤 경고 확인란을 명시적으로 선택해야 변환할 수 있습니다.",
      );
    }

    const kingGroup = assignedGroups.get("King");
    if (kingGroup === undefined) {
      throw new Error("전역 스케일을 계산할 King 그룹이 없습니다.");
    }
    const kingHeight = kingGroup.representative.size.y;
    if (!Number.isFinite(kingHeight) || kingHeight <= 0) {
      throw new Error(`King 원본 높이가 유효하지 않습니다: ${kingHeight}`);
    }
    const globalScale = 1 / kingHeight;

    await MeshoptSimplifier.ready;
    for (const type of PIECE_TYPES) {
      const group = assignedGroups.get(type);
      if (group === undefined) {
        throw new Error(`${type} 그룹이 지정되지 않았습니다.`);
      }
      setStage("simplify", "running", `${type} 처리 중`);
      runMessage.textContent = `${type} 대표 메시를 정규화하고 삼각형을 감축하고 있습니다.`;
      await nextFrame();

      const node = normalizeRepresentative(
        group.representative,
        type,
        globalScale,
        exportMaterial,
      );
      const beforeTriangles = countTriangles(node.geometry);
      const simplified = simplifyGeometry(
        node.geometry,
        type,
        readBudget(group),
      );
      const finalAlignment = realignDecimatedGeometry(simplified, type);
      node.geometry.dispose();
      node.geometry = simplified;
      node.updateMatrixWorld(true);
      assertIdentityTransform(node, type);

      const bounds = requireBounds(simplified, `${type} 감축 결과`);
      const size = bounds.getSize(new Vector3());
      const afterTriangles = countTriangles(simplified);
      const baseFlattenEps = readBaseFlattenEps(group);
      const collider = createColliderPoints(
        simplified,
        type,
        baseFlattenEps,
      );
      if (collider.points.length > MAX_COLLIDER_POINTS) {
        throw new Error(
          `${type} 충돌체 점이 상한 ${MAX_COLLIDER_POINTS}개를 초과했습니다.`,
        );
      }

      exportScene.add(node);
      converted.push({
        type,
        node,
        observedVertexCount: group.observedVertexCount,
        beforeTriangles,
        afterTriangles,
        bounds: size,
        colliderPoints: collider.points,
        colliderAabbMatches: collider.aabbMatches,
        baseRadius: collider.baseRadius,
        basePointCount: collider.basePointCount,
        baseFlattenEps,
        baseHullPointCount: collider.baseHullPointCount,
        finalAlignment,
        identity: true,
      });
    }
    setStage("simplify", "done", "6종 완료");

    failedStage = "export";
    setStage("export", "running", "GLB 작성 중");
    runMessage.textContent =
      "GLB를 작성하고 최상위 노드와 재질 계약을 검증하고 있습니다.";
    await nextFrame();

    exportScene.updateMatrixWorld(true);
    const exported = await new GLTFExporter().parseAsync(exportScene, {
      binary: true,
      onlyVisible: true,
      trs: true,
    });
    if (!(exported instanceof ArrayBuffer)) {
      throw new Error("GLTFExporter가 binary ArrayBuffer를 반환하지 않았습니다.");
    }
    const glb = stripMaterialsFromGlb(exported);
    const identityChecks = validateGlbContract(glb);
    if (glb.byteLength > 3 * 1024 * 1024) {
      throw new Error(
        `GLB 크기가 3MiB 제한을 초과했습니다: ${formatBytes(glb.byteLength)}. 삼각형 예산을 낮추고 다시 시도하세요.`,
      );
    }

    for (const piece of converted) {
      piece.identity = identityChecks[piece.type];
    }

    const counts = {} as Record<PieceType, number>;
    for (const type of PIECE_TYPES) {
      const group = assignedGroups.get(type);
      counts[type] = group?.items.length ?? 0;
    }

    const meta = {
      unit: "king-height=1.0 스케일 적용 후 단위",
      globalScale: roundNumber(globalScale),
      cellSize: roundNumber(workspace.sourceCellSize * globalScale),
      boardThickness: roundNumber(
        workspace.sourceBoardThickness * globalScale,
      ),
      pieces: Object.fromEntries(
        converted.map((piece) => [
          piece.type,
          {
            triangles: piece.afterTriangles,
            bounds: {
              x: roundNumber(piece.bounds.x),
              y: roundNumber(piece.bounds.y),
              z: roundNumber(piece.bounds.z),
            },
            baseRadius: roundNumber(piece.baseRadius),
            basePointCount: piece.basePointCount,
            baseFlattenEps: roundNumber(piece.baseFlattenEps),
            baseHullPointCount: piece.baseHullPointCount,
            colliderPoints: piece.colliderPoints,
          },
        ]),
      ),
      source: {
        file: "chess.fbx",
        sha256: workspace.sourceHash,
      },
    };
    const metaJson = `${JSON.stringify(meta, null, 2)}\n`;
    const report: ConversionReport = {
      glbBytes: glb.byteLength,
      pieces: converted,
      counts,
      boardCount: workspace.boards.length,
      pieceCount: workspace.groups.reduce(
        (sum, group) => sum + group.items.length,
        0,
      ),
      crossChecks,
      overrideUsed,
    };
    artifacts = {
      glb: new Blob([glb], { type: "model/gltf-binary" }),
      meta: new Blob([metaJson], { type: "application/json" }),
    };

    renderReport(report);
    setStage("export", "done", formatBytes(glb.byteLength));
    runMessage.textContent =
      "변환과 계약 검증이 끝났습니다. 아래에서 두 파일을 다운로드하세요.";
  } catch (error) {
    for (const piece of converted) {
      piece.node.geometry.dispose();
    }
    exportScene.clear();
    showError(failedStage, error);
  } finally {
    exportMaterial.dispose();
    setBusy(false);
  }
}

/**
 * 지오메트리 인덱스 유무를 고려해 정확한 삼각형 수를 반환한다.
 */
function countTriangles(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const count = geometry.getIndex()?.count ?? position?.count ?? 0;
  if (count === 0 || count % 3 !== 0) {
    throw new Error(`삼각형 인덱스 수가 유효하지 않습니다: ${count}`);
  }
  return count / 3;
}

/**
 * 자기 보정 관측값부터 교차검사·콜라이더·GLB 계약까지 게이트 증빙을 한 표로 그린다.
 */
function renderReport(report: ConversionReport): void {
  const countText = PIECE_TYPES.map(
    (type) => `${type} ${report.counts[type]}`,
  ).join(" / ");
  const rows = report.pieces
    .map(
      (piece) => `
        <tr>
          <td>${piece.type}</td>
          <td>${report.counts[piece.type].toLocaleString("ko-KR")}</td>
          <td>${piece.observedVertexCount.toLocaleString("ko-KR")}</td>
          <td>${piece.beforeTriangles.toLocaleString("ko-KR")} → ${piece.afterTriangles.toLocaleString("ko-KR")}</td>
          <td>minY ${piece.finalAlignment.minY.toExponential(6)} / center x ${piece.finalAlignment.centerX.toExponential(6)} / z ${piece.finalAlignment.centerZ.toExponential(6)}</td>
          <td>${piece.baseFlattenEps.toFixed(4)}</td>
          <td>전체 후보 ${piece.basePointCount.toLocaleString("ko-KR")}점 / 볼록껍질 ${piece.baseHullPointCount.toLocaleString("ko-KR")}점</td>
          <td>${piece.baseRadius.toFixed(6)}</td>
          <td>${piece.colliderPoints.length.toLocaleString("ko-KR")} / ${MAX_COLLIDER_POINTS}</td>
          <td>${piece.colliderAabbMatches ? "일치" : "불일치"}</td>
          <td>${piece.identity ? "통과" : "실패"}</td>
        </tr>
      `,
    )
    .join("");

  reportContent.innerHTML = `
    <dl class="report-summary">
      <div>
        <dt>메시 집계</dt>
        <dd>보드 ${report.boardCount} / 말 ${report.pieceCount}</dd>
      </div>
      <div>
        <dt>종류별 개수</dt>
        <dd>${countText}</dd>
      </div>
      <div>
        <dt>GLB 크기</dt>
        <dd>${formatBytes(report.glbBytes)}</dd>
      </div>
      <div>
        <dt>높이 교차 확인</dt>
        <dd>${report.crossChecks.height.valid ? "자동 통과" : "자동 실패"}</dd>
        <p>${report.crossChecks.height.message}</p>
      </div>
      <div>
        <dt>위치 교차 확인</dt>
        <dd>${report.crossChecks.position.valid ? "자동 통과" : "자동 실패"}</dd>
        <p>${report.crossChecks.position.message}</p>
      </div>
      <div>
        <dt>경고 수동 override</dt>
        <dd>${report.overrideUsed ? "사용" : "미사용"}</dd>
      </div>
    </dl>
    <table class="report-table">
      <thead>
        <tr>
          <th>종류</th>
          <th>개수</th>
          <th>관측 position.count</th>
          <th>감축 전 → 후 triangles</th>
          <th>최종 정렬</th>
          <th>바닥 평탄화 ε</th>
          <th>바닥 후보 / 볼록껍질</th>
          <th>바닥 반지름</th>
          <th>콜라이더 점</th>
          <th>콜라이더 AABB</th>
          <th>TRS identity</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  reportSection.hidden = false;
}

/**
 * 메모리의 Blob을 임시 링크로 내려받고 URL을 바로 해제한다.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file !== undefined) {
    void inspectFile(file);
  }
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (!busy) {
    dropZone.classList.add("is-dragging");
  }
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) {
    void inspectFile(file);
  }
});

convertButton.addEventListener("click", () => {
  void convertWorkspace();
});

crossCheckOverride.addEventListener("change", updateAssignmentState);

retryButton.addEventListener("click", () => {
  clearError();
  if (lastAction === "convert" && workspace !== null) {
    void convertWorkspace();
  } else if (lastFile !== null) {
    void inspectFile(lastFile);
  } else {
    resetStages();
    runMessage.textContent = "다시 시도할 FBX 파일을 선택하세요.";
  }
});

downloadGlbButton.addEventListener("click", () => {
  if (artifacts === null) {
    showError("export", new Error("다운로드할 GLB가 아직 없습니다."));
    return;
  }
  downloadBlob(artifacts.glb, "chess-pieces.glb");
});

downloadMetaButton.addEventListener("click", () => {
  if (artifacts === null) {
    showError("export", new Error("다운로드할 메타 JSON이 아직 없습니다."));
    return;
  }
  downloadBlob(artifacts.meta, "chess-set.meta.json");
});
