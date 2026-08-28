import { Group, Mesh, MeshBasicMaterial, RingGeometry, DoubleSide } from "three";
import type { PieceStatMutationResult } from "./piece-stat-model";

/** 미리보기 전용 연출. 게임 메시와 Rapier 바디에는 접근하지 않는다. */
export class PieceUpgradeEffects {
  readonly group = new Group();
  private readonly material = new MeshBasicMaterial({ color: 0x80caff, transparent: true, depthWrite: false, side: DoubleSide });
  private readonly geometry = new RingGeometry(0.84, 1, 48);
  private readonly rings = Array.from({ length: 3 }, () => new Mesh(this.geometry, this.material));
  private event: PieceStatMutationResult | null = null;
  private start = 0;
  private radius = 1;
  private height = 1;

  constructor() {
    this.group.add(...this.rings);
    this.group.visible = false;
  }
  fit(radius: number, height: number): void { this.radius = radius; this.height = height; this.clear(); }
  play(result: PieceStatMutationResult, now: number): void {
    if (!result.changed || !result.stat) return;
    this.event = result; this.start = now;
  }
  clear(): void { this.event = null; this.group.visible = false; }
  update(now: number, model: Group, targetScale: number): boolean {
    model.rotation.z = 0;
    model.scale.setScalar(targetScale);
    if (!this.event) return false;
    const event = this.event;
    const decreasing = event.direction === "decrease";
    const duration = decreasing ? 350 : 650;
    const t = Math.min(1, (now - this.start) / duration);
    if (t >= 1) { this.clear(); return false; }
    const pulse = Math.sin(t * Math.PI);
    const direction = decreasing ? -1 : 1;
    const travel = decreasing ? 1 - t : t;
    this.group.visible = true;
    this.material.color.setHex(event.stat === "force" ? 0xffc86a : event.stat === "size" ? 0xb9a3ff : 0x80caff);
    this.material.opacity = (1 - t) * (decreasing ? 0.45 : 0.85);
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      if (event.stat === "force") {
        ring.rotation.set(0, 0, -0.3);
        ring.scale.set(this.radius * 0.13, this.height * (0.3 + travel * 0.5), 1);
        ring.position.set((i - 1) * this.radius * 0.9, this.height * (0.3 + travel * 0.5), -this.radius * 0.5);
      } else {
        ring.rotation.set(-Math.PI / 2, 0, 0);
        const radius = this.radius * (event.stat === "weight" ? 2.1 - travel * 1.2 + i * 0.22 : 1 + t + i * 0.25);
        ring.scale.setScalar(radius);
        ring.position.set(0, this.height * (0.02 + i * 0.1), 0);
      }
    }
    if (event.stat === "force") model.rotation.z = -direction * pulse * 0.065;
    if (event.stat === "weight") model.scale.set(targetScale * (1 + pulse * 0.025), targetScale * (1 - pulse * 0.045), targetScale * (1 + pulse * 0.025));
    if (event.stat === "size") model.scale.setScalar(1 + (event.effectBefore ?? 0) + ((event.effectAfter ?? 0) - (event.effectBefore ?? 0)) * (1 - (1 - t) ** 3));
    return true;
  }
  dispose(): void { this.clear(); this.geometry.dispose(); this.material.dispose(); this.group.clear(); }
}
