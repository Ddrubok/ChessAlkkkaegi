import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Vector3 } from "three";
import type { SceneRuntime } from "./scene";
import type { ImpactFeedbackEvent } from "./sound";
import { isMotionReduced, subscribeMotion } from "./ui-motion";

/** Two contact marks owned by the live scene; no collider or simulation writes. */
export function createImpactFeedback(scene: SceneRuntime) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([
    -.4, .2, 0, -1, .5, 0,
    0, .45, 0, 0, 1, 0,
    .4, .2, 0, 1, .5, 0,
  ], 3));
  const marks = Array.from({ length: 2 }, () => {
    const line = new LineSegments(geometry, new LineBasicMaterial({
      color: 0xffe9bd, transparent: true, depthWrite: false, depthTest: false,
    }));
    line.visible = false;
    line.name = "contact-feedback";
    line.renderOrder = 5;
    scene.scene.add(line);
    return { line, until: 0 };
  });
  const kick = new Vector3();
  let kickAt = -Infinity;
  let kickStrength = 0;
  const reset = () => {
    for (const mark of marks) { mark.line.visible = false; mark.until = 0; }
    kickAt = -Infinity;
    kickStrength = 0;
  };
  subscribeMotion(reset);
  document.addEventListener("visibilitychange", reset);
  window.addEventListener("pagehide", reset);
  return {
    reset,
    add(events: readonly ImpactFeedbackEvent[], now: number, aiming: boolean) {
      if (document.hidden || aiming || isMotionReduced()) return;
      for (const event of events) {
        if (event.strength < .25) continue;
        const mark = marks.reduce((a, b) => a.until <= b.until ? a : b);
        mark.line.position.copy(event.point);
        mark.line.quaternion.copy(scene.camera.quaternion);
        mark.line.scale.setScalar(scene.boardHalfExtent / 4 * (.09 + .04 * event.strength));
        mark.line.material.opacity = .8;
        mark.line.visible = true;
        mark.until = now + 90;
        // Only a strong event can replace a still-running kick, never stack it.
        if (event.strength >= .7 && (now - kickAt >= 100 || event.strength > kickStrength)) {
          kick.copy(event.direction);
          if (kick.lengthSq() > 0) kick.normalize();
          kickAt = now;
          kickStrength = event.strength;
        }
      }
    },
    render(now: number, allowKick: boolean) {
      if (document.hidden || isMotionReduced()) reset();
      for (const mark of marks) {
        mark.line.visible = now < mark.until;
        if (mark.line.visible) mark.line.material.opacity = .8 * (mark.until - now) / 90;
      }
      const camera = scene.camera;
      const position = camera.position.clone();
      const age = now - kickAt;
      try {
        if (allowKick && age >= 0 && age < 100 && !isMotionReduced()) {
          const screenHeight = 2 * position.distanceTo(scene.controls.target) * Math.tan(camera.fov * Math.PI / 360);
          camera.position.addScaledVector(kick, screenHeight * .0025 * kickStrength * (1 - age / 100));
          camera.updateMatrixWorld();
        }
        scene.renderer.render(scene.scene, camera);
      } finally {
        // Input rays and OrbitControls always see the exact original camera.
        camera.position.copy(position);
        camera.updateMatrixWorld();
      }
    },
  };
}
