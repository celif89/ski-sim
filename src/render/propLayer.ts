/**
 * Etap 7d: obiekty z bliska z atlasu (data/atlas.json): podpory z zestawami rolek, stacje z kołem
 * zwrotnym i bramkami, krzesełka / gondole / orczyki / talerzyki jadące po linie, armatki śmigłowe
 * i lance, lina wyciągarki ratraka do punktu kotwienia, skuter i ratownik przy wypadku.
 * Pokazywane tylko przy dużym przybliżeniu (wcześniej – uproszczone wektory w resortLayer.ts).
 * Położenia krzesełek liczone tak jak odjazdy w symulacji gości: (czas · prędkość) mod odstęp.
 */
import { Container, Graphics, Particle, ParticleContainer, Texture } from 'pixi.js';
import type { LiftAnalysis, LiftDesign } from '../sim/lifts';
import { carrierSpacingM, liftPath, pointAlongPath } from '../sim/lifts';
import type { QueueLayout } from '../sim/guests';
import type { SpriteAtlas } from './atlasTexture';
import { directionIndex } from './atlasGen';
import type { Camera } from './camera';
import { MoverLayer } from './movers';

export interface PropGun {
  xM: number;
  yM: number;
  aimXM: number;
  aimYM: number;
  lance: boolean;
}

export interface PropInput {
  lifts: { design: LiftDesign; analysis: LiftAnalysis }[];
  guns: PropGun[];
  /** Lina wyciągarki: ratrak → punkt kotwienia. */
  winches: { fromX: number; fromY: number; toX: number; toY: number }[];
  /** Wypadki: ratownik i skuter obok. */
  accidents: { xM: number; yM: number }[];
  /** Skuter ratowników zaparkowany (dolna stacja). */
  parked: { xM: number; yM: number; headingRad: number }[];
  timeS: number;
  night: number;
}

const CARRIER: Record<string, string> = { talerzyk: 'platter', orczyk: 'tbar', kanapa2s: 'chair2', kanapa4s: 'chair4', kanapa4d: 'chair4', kanapa6d: 'chair6', gondola: 'gondola' };

export class PropLayer {
  private readonly shadows: ParticleContainer;
  private readonly bodies: ParticleContainer;
  private readonly cables = new Graphics();
  readonly root = new Container();
  /** Od tego przybliżenia [m/px] obiekty z atlasu zastępują uproszczone wektory. */
  static readonly SHOW_MPP = 1.2;
  visibleCount = 0;

  constructor(
    private readonly atlas: SpriteAtlas,
    /** Szpalery kolejki przy dolnej stacji – ten sam układ co w symulacji gości (queueSlot). */
    private readonly queue: QueueLayout,
  ) {
    const dyn = { position: true, rotation: true, uvs: true, color: true, vertex: true };
    this.shadows = new ParticleContainer({ dynamicProperties: dyn });
    this.bodies = new ParticleContainer({ dynamicProperties: dyn });
    this.root.addChild(this.cables, this.shadows, this.bodies);
  }

  get active(): boolean {
    return this.root.visible;
  }

  update(camera: Camera, inp: PropInput): void {
    const mpp = camera.metersPerPixel;
    const show = this.atlas.ready && mpp <= PropLayer.SHOW_MPP;
    this.root.visible = show;
    if (!show) {
      this.visibleCount = 0;
      return;
    }
    const a = camera.screenToWorld(0, 0);
    const b = camera.screenToWorld(camera.viewportWidthPx, camera.viewportHeightPx);
    const m = 40;
    const x0 = Math.min(a.xM, b.xM) - m;
    const x1 = Math.max(a.xM, b.xM) + m;
    const y0 = Math.min(a.yM, b.yM) - m;
    const y1 = Math.max(a.yM, b.yM) + m;
    const inView = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
    type Item = { id: string; x: number; y: number; h: number; len: number };
    const items: Item[] = [];
    const ropes: { x: number; y: number; h: number }[] = [];
    for (const { design, analysis: an } of inp.lifts) {
      const path = liftPath(design);
      const type = an.type;
      const dirAt = (d: number) => {
        const p1 = pointAlongPath(path, Math.max(0, d - 1));
        const p2 = pointAlongPath(path, Math.min(an.horizontalLengthM, d + 1));
        return Math.atan2(p2.yM - p1.yM, p2.xM - p1.xM);
      };
      const aerial = type.kind === 'aerial';
      // Podpory z rolkami (głowica w poprzek linii).
      if (aerial) {
        for (const s of an.supports) {
          if (s.kind !== 'tower') continue;
          const p = pointAlongPath(path, s.distanceM);
          if (inView(p.xM, p.yM)) items.push({ id: 'towerHead', x: p.xM, y: p.yM, h: dirAt(s.distanceM), len: 5 });
        }
      }
      // Stacje: koło zwrotne na końcu linii, bramki przed dolną stacją.
      const hUp = dirAt(1);
      const hTop = dirAt(an.horizontalLengthM - 1);
      if (aerial) {
        if (inView(design.bottom.xM, design.bottom.yM)) items.push({ id: 'bullwheel', x: design.bottom.xM, y: design.bottom.yM, h: hUp + Math.PI, len: 7 });
        if (inView(design.top.xM, design.top.yM)) items.push({ id: 'bullwheel', x: design.top.xM, y: design.top.yM, h: hTop, len: 7 });
      }
      if (inView(design.bottom.xM, design.bottom.yM) && type.id !== 'tasma') {
        ropes.push({ x: design.bottom.xM, y: design.bottom.yM, h: hUp });
        for (let g = -1; g <= 1; g++) {
          const back = this.queue.frontM - 1.6;
          const across = g * 1.8;
          items.push({ id: 'gate', x: design.bottom.xM - Math.cos(hUp) * back - Math.sin(hUp) * across, y: design.bottom.yM - Math.sin(hUp) * back + Math.cos(hUp) * across, h: hUp, len: 1.6 });
        }
      }
      // Krzesełka / orczyki jadące w górę i w dół.
      const spacing = carrierSpacingM(type);
      const cid = CARRIER[type.id];
      if (!cid || spacing <= 0 || design.closed) continue;
      const Ls = an.slopeLengthM || an.horizontalLengthM;
      const ps = an.pathSlopeM;
      const vm = [0];
      for (let i = 1; i < path.length; i++) vm.push(vm[i - 1] + Math.hypot(path[i].xM - path[i - 1].xM, path[i].yM - path[i - 1].yM));
      const horiz = (dSlope: number) => {
        let i = 0;
        while (i < ps.length - 2 && ps[i + 1] < dSlope) i++;
        const f = (dSlope - ps[i]) / (ps[i + 1] - ps[i] || 1);
        return vm[i] + Math.min(1, Math.max(0, f)) * (vm[i + 1] - vm[i]);
      };
      const travel = (((inp.timeS * type.speedMs) % spacing) + spacing) % spacing;
      const half = aerial ? MoverLayer.ROPE_HALF_M : 1.2;
      const size = this.atlas.meta(cid).sizeM;
      for (let d = travel; d < Ls; d += spacing) {
        for (const dir of [1, -1]) {
          const hd = horiz(dir === 1 ? d : Ls - d);
          const p = pointAlongPath(path, hd);
          const hh = dirAt(hd) + (dir === 1 ? 0 : Math.PI);
          const x = p.xM - Math.sin(hh) * half;
          const y = p.yM + Math.cos(hh) * half;
          if (inView(x, y)) items.push({ id: cid, x, y, h: hh, len: size });
        }
      }
    }
    for (const g of inp.guns) {
      if (!inView(g.xM, g.yM)) continue;
      items.push({ id: g.lance ? 'lance' : 'fanGun', x: g.xM, y: g.yM, h: Math.atan2(g.aimYM - g.yM, g.aimXM - g.xM), len: g.lance ? 2.4 : 3.2 });
    }
    for (const acc of inp.accidents) {
      if (!inView(acc.xM, acc.yM)) continue;
      items.push({ id: 'patrol', x: acc.xM + 1.6, y: acc.yM + 0.8, h: Math.PI, len: 1.9 }, { id: 'snowmobile', x: acc.xM + 4.5, y: acc.yM + 3, h: -Math.PI / 4, len: 2.9 });
    }
    for (const p of inp.parked) if (inView(p.xM, p.yM)) items.push({ id: 'snowmobile', x: p.xM, y: p.yM, h: p.headingRad, len: 2.9 });
    this.visibleCount = items.length;
    const sh = this.sync(this.shadows, items.length);
    const bo = this.sync(this.bodies, items.length);
    const s = camera.sign;
    const counter = camera.rotated ? Math.PI : 0;
    const tint = inp.night > 0.3 ? 0x8899aa : 0xffffff;
    items.forEach((it, i) => {
      const meta = this.atlas.meta(it.id);
      const lod = this.atlas.lodFor(it.len / mpp);
      const dir = directionIndex(it.h + counter);
      const sc = this.atlas.scaleFor(it.id, it.len, lod);
      const p = bo[i];
      p.texture = this.atlas.frame(it.id, 'b', 0, dir, lod);
      p.x = it.x;
      p.y = it.y;
      p.rotation = counter;
      p.scaleX = sc;
      p.scaleY = sc;
      p.tint = tint;
      const q = sh[i];
      q.texture = this.atlas.frame(it.id, 's', 0, dir, lod);
      q.x = it.x + s * meta.shadowM;
      q.y = it.y + s * meta.shadowM;
      q.rotation = counter;
      q.scaleX = sc;
      q.scaleY = sc;
      q.tint = 0x0f172a;
      q.alpha = 0.28;
    });
    this.shadows.update();
    this.bodies.update();
    // Lina wyciągarki (napięta – prosta) z cieniem.
    const g = this.cables;
    g.clear();
    // Szpalery: taśmy między pasami kolejki, przejście na przemian na końcu i na początku pasa.
    const q = this.queue;
    for (const r of ropes) {
      const ux = Math.cos(r.h);
      const uy = Math.sin(r.h);
      const at = (back: number, across: number) => ({ x: r.x - ux * back - uy * across, y: r.y - uy * back + ux * across });
      const b0 = q.frontM - 0.8;
      const b1 = q.frontM + (q.perLane - 1) * q.spacingM + 0.8;
      for (let i = 0; i <= q.lanes; i++) {
        const c = (i - q.lanes / 2) * q.spacingM;
        let from = b0;
        let to = b1;
        if (i > 0 && i < q.lanes) {
          // Między pasem i−1 a i: przejście na dalszym końcu, gdy pas i−1 idzie w stronę stacji.
          if ((i - 1) % 2 === 0) to = b1 - 1.4;
          else from = b0 + 1.4;
        }
        const p0 = at(from, c);
        const p1 = at(to, c);
        g.moveTo(p0.x + s * 0.25, p0.y + s * 0.25).lineTo(p1.x + s * 0.25, p1.y + s * 0.25).stroke({ width: 0.1, color: 0x0f172a, alpha: 0.25 });
        g.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y).stroke({ width: 0.09, color: 0x2563eb, alpha: 0.9 });
        g.circle(p0.x, p0.y, 0.12).circle(p1.x, p1.y, 0.12).fill({ color: 0x1e293b });
      }
    }
    for (const w of inp.winches) {
      g.moveTo(w.fromX + s * 0.6, w.fromY + s * 0.6).lineTo(w.toX + s * 0.6, w.toY + s * 0.6).stroke({ width: 0.12, color: 0x0f172a, alpha: 0.3 });
      g.moveTo(w.fromX, w.fromY).lineTo(w.toX, w.toY).stroke({ width: 0.1, color: 0x1e293b, alpha: 0.95 });
    }
  }

  private sync(pc: ParticleContainer, n: number): Particle[] {
    const arr = pc.particleChildren as Particle[];
    while (arr.length < n) arr.push(new Particle({ texture: Texture.EMPTY, anchorX: 0.5, anchorY: 0.5 }));
    if (arr.length > n) arr.length = n;
    return arr;
  }
}
