/**
 * Etap 3D-2: podgląd wyciągu w 3D – podpory i lina w prawdziwej wysokości (z analizy symulacji),
 * odcinki liny ze zbyt małym prześwitem na czerwono (te same zasady co sprawdzenie w `lifts.ts`:
 * bez strefy stacji). Rysowany wyciąg (podgląd budowy) i zaznaczony wyciąg w trakcie edycji.
 */
import * as THREE from 'three';
import type { LiftAnalysis, LiftDesign, LiftParams } from '../sim/lifts';
import { hasCable, liftPath, pointAlongPath } from '../sim/lifts';

export interface ClearanceSpan {
  fromM: number;
  toM: number;
}

/** Odcinki (odległość od dolnej stacji) ze zbyt małym prześwitem – poza strefą stacji. */
export function lowClearanceSpans(an: LiftAnalysis, lp: LiftParams): ClearanceSpan[] {
  if (!hasCable(an.type) || an.ground.length < 2) return [];
  const c = lp.common;
  const L = an.ground[an.ground.length - 1].distanceM;
  const near = (d: number) =>
    d < c.stationApproachM || d > L - c.stationApproachM || an.supports.some((s) => (s.kind === 'station' || (s.kind === 'bend' && an.type.kind === 'aerial')) && Math.abs(s.distanceM - d) < c.stationApproachM);
  const out: ClearanceSpan[] = [];
  let cur: ClearanceSpan | null = null;
  an.ground.forEach((g, i) => {
    const low = !near(g.distanceM) && an.cableElevationM[i] - g.elevationM < an.type.minClearanceM - 0.05;
    if (low) {
      if (!cur) cur = { fromM: g.distanceM, toM: g.distanceM };
      else cur.toM = g.distanceM;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}

export class LiftPreview3D {
  readonly group = new THREE.Group();
  private readonly towerMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.6 });
  private readonly okMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  private readonly badMat = new THREE.LineBasicMaterial({ color: 0xff2d2d });
  /** Ta sama lina za drzewami i wzgórzem – przerywana, półprzezroczysta. */
  private readonly okHidden = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.6, depthWrite: false, depthFunc: THREE.GreaterDepth });
  private readonly badHidden = new THREE.LineDashedMaterial({ color: 0xff2d2d, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.8, depthWrite: false, depthFunc: THREE.GreaterDepth });
  private readonly badTowerMat = new THREE.MeshStandardMaterial({ color: 0xff2d2d, emissive: 0x661111, roughness: 0.6 });
  private key = '';

  constructor(
    private readonly lp: LiftParams,
    private readonly groundAt: (x: number, z: number) => number,
  ) {}

  private clear(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
  }

  /** Przebudowa przy zmianie podglądu (klucz: wersja rysunku). */
  update(items: { design: LiftDesign; analysis: LiftAnalysis }[], key: string): void {
    if (key === this.key) return;
    this.key = key;
    this.clear();
    for (const { design, analysis: an } of items) this.addLift(design, an);
  }

  private addLift(design: LiftDesign, an: LiftAnalysis): void {
    if (an.ground.length < 2) return;
    const path = liftPath(design);
    const bad = lowClearanceSpans(an, this.lp);
    const isBad = (d: number) => bad.some((s) => d >= s.fromM - 3 && d <= s.toM + 3);
    // Lina: odcinki między próbkami terenu, kolor wg prześwitu.
    const ok: number[] = [];
    const red: number[] = [];
    for (let i = 1; i < an.ground.length; i++) {
      const a = an.ground[i - 1];
      const b = an.ground[i];
      const arr = isBad((a.distanceM + b.distanceM) / 2) ? red : ok;
      arr.push(a.xM, an.cableElevationM[i - 1], a.yM, b.xM, an.cableElevationM[i], b.yM);
    }
    for (const [arr, mat, hid] of [
      [ok, this.okMat, this.okHidden],
      [red, this.badMat, this.badHidden],
    ] as const) {
      if (!arr.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      this.group.add(new THREE.LineSegments(g, mat));
      const hidden = new THREE.LineSegments(g, hid);
      hidden.computeLineDistances();
      hidden.renderOrder = 15;
      this.group.add(hidden);
    }
    // Podpory i stacje: słup od terenu do liny.
    const aerial = an.type.kind === 'aerial';
    for (const s of an.supports) {
      const p = pointAlongPath(path, Math.max(0, Math.min(an.horizontalLengthM, s.distanceM)));
      const g0 = this.groundAt(p.xM, p.yM);
      if (!Number.isFinite(g0)) continue;
      const h = Math.max(1, s.cableElevationM - g0);
      const r = s.kind === 'station' ? (aerial ? 2.5 : 1.2) : aerial ? 0.45 : 0.25;
      const geo = s.kind === 'station' ? new THREE.BoxGeometry(r * 2, h, r * 2) : new THREE.CylinderGeometry(r * 0.8, r, h, 8);
      geo.translate(p.xM, g0 + h / 2, p.yM);
      const m = new THREE.Mesh(geo, isBad(s.distanceM) ? this.badTowerMat : this.towerMat);
      this.group.add(m);
    }
  }
}
