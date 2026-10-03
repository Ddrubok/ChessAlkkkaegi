import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { I18nManager, type LanguageCode } from "../i18n";
import type { PhysicsRuntime } from "../physics";
import type { SceneRuntime } from "../scene";
import { mapPointToWorld } from "./hotseat-map-types";

const statusCopy: Record<LanguageCode, [string, string]> = {
  ko: ["중앙 붕괴까지 {n}회 발사", "중앙 바닥 붕괴"],
  en: ["Center collapses in {n} shots", "Center floor collapsed"],
  ja: ["中央崩壊まであと{n}回", "中央の床が崩壊"],
  "zh-CN": ["中央地板将在{n}次发射后坍塌", "中央地板已坍塌"],
  de: ["Mitte bricht nach {n} Schüssen ein", "Mittlerer Boden eingestürzt"],
  fr: ["Effondrement dans {n} tirs", "Sol central effondré"],
  es: ["El centro colapsa en {n} tiros", "El suelo central ha colapsado"],
  ru: ["До обвала центра: {n} выстрелов", "Центральный пол обрушился"],
  "pt-BR": ["Centro desaba em {n} disparos", "Piso central desabou"],
};

const platformStatusCopy: Record<LanguageCode, [string, string]> = {
  ko: ["발판 붕괴까지 {n}회 발사", "주변 발판 붕괴"],
  en: ["Platforms collapse in {n} shots", "Surrounding platforms collapsed"],
  ja: ["足場崩壊まであと{n}回", "周囲の足場が崩壊"],
  "zh-CN": ["踏板将在{n}次发射后坍塌", "周围踏板已坍塌"],
  de: ["Plattformen brechen nach {n} Schüssen ein", "Umliegende Plattformen eingestürzt"],
  fr: ["Les plateformes s’effondrent dans {n} tirs", "Plateformes alentour effondrées"],
  es: ["Las plataformas colapsan en {n} tiros", "Las plataformas de alrededor han colapsado"],
  ru: ["До обвала площадок: {n} выстрелов", "Окружающие площадки обрушились"],
  "pt-BR": ["Plataformas desabam em {n} disparos", "Plataformas ao redor desabaram"],
};

/** A tile countdown plus a compact row inside the existing, non-interactive turn HUD. */
export function createCollapsingFloorDisplay(runtime: PhysicsRuntime, scene: SceneRuntime): {
  update: (shots: number, collapsed: ReadonlySet<string>) => void; dispose: () => void;
} {
  const surfaces = runtime.hotseatMap!.definition.surfaces.filter(surface => surface.collapseAfterShots !== undefined);
  const labels = surfaces.map(surface => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot draw collapse tile countdown");
    const texture = new CanvasTexture(canvas);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    const rectangle = surface.rectangle;
    const mesh = new Mesh(new PlaneGeometry((rectangle.maxU - rectangle.minU) * runtime.boardHalfExtent,
      (rectangle.maxV - rectangle.minV) * runtime.boardHalfExtent), material);
    const center = mapPointToWorld((rectangle.minU + rectangle.maxU) / 2, (rectangle.minV + rectangle.maxV) / 2, runtime.boardHalfExtent);
    mesh.name = `CollapseLabel-${surface.id}`;
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(center.x, runtime.boardTop + .003, center.z);
    mesh.raycast = () => {};
    // Keep the hazard footprint fixed; only the square numeral follows the camera.
    const countCanvas = document.createElement("canvas");
    countCanvas.width = countCanvas.height = 128;
    const countContext = countCanvas.getContext("2d");
    if (!countContext) throw new Error("Cannot draw collapse tile number");
    const countTexture = new CanvasTexture(countCanvas);
    const countMaterial = new MeshBasicMaterial({ map: countTexture, transparent: true, depthWrite: false });
    const countWidth = Math.min(rectangle.maxU - rectangle.minU, rectangle.maxV - rectangle.minV) * runtime.boardHalfExtent * .36;
    const countMesh = new Mesh(new PlaneGeometry(countWidth, countWidth), countMaterial);
    countMesh.name = `CollapseCountdown-${surface.id}`;
    countMesh.position.z = .001;
    countMesh.renderOrder = 1;
    countMesh.raycast = () => {};
    countMesh.onBeforeRender = (_renderer, _scene, camera) => {
      // Plane +y/texture top points toward world -z before this in-plane rotation.
      countMesh.rotation.z = Math.atan2(camera.position.x - center.x, camera.position.z - center.z);
      countMesh.updateWorldMatrix(false, false);
    };
    mesh.add(countMesh);
    scene.scene.add(mesh);
    return { surface, canvas, context, texture, material, mesh, countContext, countTexture, countMaterial, countMesh };
  });
  const hud = document.querySelector?.(".turn-hud-container");
  const badge = hud ? document.createElement("div") : null;
  if (badge) {
    badge.className = "collapsing-floor-status";
    badge.setAttribute("role", "status");
    badge.style.cssText = "max-width: min(280px, 80vw); padding: 3px 8px; border: 1px solid #e4ac54; border-radius: 6px; background: rgba(32,24,15,.9); color: #ffe6b3; font-size: 11px; line-height: 1.3; text-align: center; pointer-events: none;";
    hud!.appendChild(badge);
  }
  let lastShots = 0;
  let lastCollapsed: ReadonlySet<string> = new Set();
  const update = (shots: number, collapsed: ReadonlySet<string>) => {
    lastShots = shots; lastCollapsed = collapsed;
    const remaining = [...new Set(surfaces.filter(surface => !collapsed.has(surface.id))
      .map(surface => Math.max(0, surface.collapseAfterShots! - shots)))].sort((a, b) => a - b);
    const copy = (surfaces.length > 1 ? platformStatusCopy : statusCopy)[I18nManager.getLanguage()];
    if (badge) badge.textContent = remaining.length ? copy[0].replace("{n}", remaining.join(" / ")) : copy[1];
    for (const { surface, context, canvas, texture, mesh, countContext, countTexture } of labels) {
      mesh.visible = !collapsed.has(surface.id);
      if (!mesh.visible) continue;
      const n = Math.max(0, surface.collapseAfterShots! - shots);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = n <= 1 ? "rgba(210,64,27,.34)" : "rgba(217,155,39,.24)";
      context.fillRect(0, 0, 256, 256);
      context.strokeStyle = n <= 1 ? "#ff9d67" : "#f3cb76";
      context.lineWidth = 8; context.strokeRect(5, 5, 246, 246);
      // More branches appear as the approved shot count approaches the threshold.
      for (let branch = 0; branch < Math.min(shots + 1, 6); branch++) {
        const x = 26 + branch * 40;
        context.beginPath(); context.moveTo(x, 10); context.lineTo(x + 14, 60 + branch * 17);
        context.lineTo(x - 9, 98 + branch * 15); context.stroke();
      }
      countContext.clearRect(0, 0, 128, 128);
      countContext.fillStyle = "rgba(42,25,12,.85)"; countContext.fillRect(0, 0, 128, 128);
      countContext.fillStyle = "#fff1cc"; countContext.textAlign = "center"; countContext.textBaseline = "middle";
      countContext.font = "bold 96px sans-serif"; countContext.fillText(String(n), 64, 69);
      countTexture.needsUpdate = true;
      texture.needsUpdate = true;
    }
  };
  const unsubscribe = I18nManager.subscribe(() => update(lastShots, lastCollapsed));
  return { update, dispose: () => {
    unsubscribe(); badge?.remove();
    for (const { mesh, material, texture, countMesh, countMaterial, countTexture } of labels) {
      scene.scene.remove(mesh); mesh.geometry.dispose(); material.dispose(); texture.dispose();
      countMesh.geometry.dispose(); countMaterial.dispose(); countTexture.dispose();
    }
  } };
}
