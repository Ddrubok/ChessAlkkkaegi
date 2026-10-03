import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial } from "three";
import { I18nManager, type LanguageCode } from "../i18n";
import type { PhysicsRuntime } from "../physics";
import type { SceneRuntime } from "../scene";
import type { ControlZoneState } from "./control-zone";
import { mapPointToWorld } from "./hotseat-map-types";

// Empty, contested, opponent-owned, bonus, spent. The numeric effect matches K08.
export const CONTROL_ZONE_COPY: Record<LanguageCode, readonly string[]> = {
  ko: ["중앙 비어 있음", "중앙 경합 · 보너스 없음", "상대 중앙 점유", "왕관 기물 발사 속도 +15%", "중앙 보너스 사용 완료"],
  en: ["Center empty", "Center contested · no bonus", "Opponent controls center", "Crowned piece: +15% launch speed", "Center bonus used"],
  ja: ["中央は空き", "中央は競合・ボーナスなし", "相手が中央を占有", "王冠の駒：発射速度+15%", "中央ボーナス使用済み"],
  "zh-CN": ["中央无人占据", "中央争夺中 · 无加成", "对方占据中央", "王冠棋子：发射速度+15%", "中央加成已使用"],
  de: ["Mitte frei", "Mitte umkämpft · kein Bonus", "Gegner kontrolliert Mitte", "Figur mit Krone: +15% Starttempo", "Mitte-Bonus verbraucht"],
  fr: ["Centre vide", "Centre disputé · aucun bonus", "L’adversaire contrôle le centre", "Pièce couronnée : vitesse de tir +15%", "Bonus du centre utilisé"],
  es: ["Centro vacío", "Centro disputado · sin bonificación", "El rival controla el centro", "Pieza coronada: velocidad de tiro +15%", "Bonificación del centro usada"],
  ru: ["Центр свободен", "Центр оспаривается · без бонуса", "Центр занят соперником", "Фигура с короной: скорость +15%", "Бонус центра использован"],
  "pt-BR": ["Centro vazio", "Centro disputado · sem bônus", "Oponente controla o centro", "Peça coroada: velocidade de tiro +15%", "Bônus do centro usado"],
};

function crown(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  context.beginPath();
  context.moveTo(x - size / 2, y + size / 3);
  context.lineTo(x - size / 2, y - size / 3);
  context.lineTo(x - size / 4, y);
  context.lineTo(x, y - size / 2);
  context.lineTo(x + size / 4, y);
  context.lineTo(x + size / 2, y - size / 3);
  context.lineTo(x + size / 2, y + size / 3);
  context.closePath(); context.fill(); context.stroke();
}

export function createControlZoneDisplay(runtime: PhysicsRuntime, scene: SceneRuntime): {
  update: (state: ControlZoneState) => void; dispose: () => void;
} {
  const zone = runtime.hotseatMap!.definition.controlZone!, r = zone.rectangle;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Cannot draw control zone");
  context.fillStyle = "rgba(212,160,50,.12)"; context.fillRect(0, 0, 256, 256);
  context.strokeStyle = "#ffe5a0"; context.lineWidth = 8; context.strokeRect(6, 6, 244, 244);
  context.setLineDash([12, 8]); context.lineWidth = 3; context.strokeRect(22, 22, 212, 212); context.setLineDash([]);
  context.fillStyle = "rgba(249,201,79,.55)"; crown(context, 128, 128, 70);
  const texture = new CanvasTexture(canvas);
  const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
  const mesh = new Mesh(new PlaneGeometry((r.maxU - r.minU) * runtime.boardHalfExtent, (r.maxV - r.minV) * runtime.boardHalfExtent), material);
  const center = mapPointToWorld((r.minU + r.maxU) / 2, (r.minV + r.maxV) / 2, runtime.boardHalfExtent);
  mesh.name = `ControlZone-${zone.id}`; mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.x, runtime.boardTop + .004, center.z); mesh.raycast = () => {};
  scene.scene.add(mesh);

  const markerCanvas = document.createElement("canvas"); markerCanvas.width = 256; markerCanvas.height = 128;
  const markerContext = markerCanvas.getContext("2d");
  if (!markerContext) throw new Error("Cannot draw control bonus marker");
  markerContext.fillStyle = "rgba(35,25,8,.94)"; markerContext.fillRect(1, 1, 254, 126);
  markerContext.strokeStyle = "#ffe5a0"; markerContext.lineWidth = 5; markerContext.strokeRect(3, 3, 250, 122);
  markerContext.fillStyle = "#ffd65d"; crown(markerContext, 40, 66, 44);
  markerContext.fillStyle = "#fff1c5"; markerContext.font = "bold 50px sans-serif"; markerContext.fillText("×1.15", 75, 82);
  const markerTexture = new CanvasTexture(markerCanvas);
  const markerMaterial = new SpriteMaterial({ map: markerTexture, depthTest: false, depthWrite: false });
  const marker = new Sprite(markerMaterial); marker.name = "ControlZone-beneficiary";
  marker.scale.set(runtime.cellSize * .65, runtime.cellSize * .325, 1);
  marker.raycast = () => {}; marker.visible = false; marker.renderOrder = 5;
  scene.scene.add(marker);

  const hud = document.querySelector?.(".turn-hud-container");
  const row = hud ? document.createElement("div") : null;
  const badge = row ? document.createElement("div") : null;
  // The existing HUD is a fixed-height timer. Keep both C05 statuses below it.
  const collapseBadge = hud?.querySelector<HTMLElement>(".collapsing-floor-status") ?? null;
  if (row && badge) {
    row.className = "hotseat-map-status-row";
    row.style.cssText = "position: absolute; top: calc(100% + 6px); width: min(280px, 88vw); display: flex; flex-wrap: wrap; justify-content: center; gap: 3px; pointer-events: none;";
    badge.className = "control-zone-status"; badge.setAttribute("role", "status");
    badge.style.cssText = "max-width: 100%; box-sizing: border-box; padding: 2px 6px; border: 1px solid #e4ac54; border-radius: 5px; background: rgba(32,24,15,.9); color: #ffe6b3; font-size: 10px; line-height: 1.3; text-align: center;";
    if (collapseBadge) row.appendChild(collapseBadge);
    row.appendChild(badge); hud!.appendChild(row);
  }
  let lastState: ControlZoneState;
  const update = (state: ControlZoneState) => {
    lastState = state;
    const index = ["empty", "contested", "opponent", "bonus", "spent"].indexOf(state.status);
    if (badge) badge.textContent = CONTROL_ZONE_COPY[I18nManager.getLanguage()][index];
    marker.visible = state.status === "bonus" && state.beneficiaryId !== null && runtime.pieces.has(state.beneficiaryId);
  };
  marker.onBeforeRender = () => {
    const binding = lastState?.beneficiaryId ? runtime.pieces.get(lastState.beneficiaryId) : undefined;
    if (!binding) { marker.visible = false; return; }
    const p = binding.body.translation();
    marker.position.set(p.x, p.y + runtime.cellSize * 1.15, p.z); marker.updateMatrixWorld(true);
  };
  const unsubscribe = I18nManager.subscribe(() => { if (lastState) update(lastState); });
  return { update, dispose: () => {
    unsubscribe(); if (collapseBadge) hud!.appendChild(collapseBadge); row?.remove();
    scene.scene.remove(mesh, marker); mesh.geometry.dispose(); material.dispose(); texture.dispose();
    markerMaterial.dispose(); markerTexture.dispose();
  } };
}
