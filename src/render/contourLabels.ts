/**
 * Etap 7e: opisy wysokości na warstwicach co 100 m (mapa w stylu A). Napis leży wzdłuż warstwicy,
 * a jego góra wskazuje pod górę stoku (konwencja map topograficznych) – po obrocie mapy obraca się
 * razem z nią. Wielkość stała na ekranie; przy dużym oddaleniu opisów nie ma.
 * Same linie warstwic rysuje shader terenu (terrainShader.ts).
 */
import { Container, Text } from 'pixi.js';
import { contourLevels, traceLevel } from '../sim/contours';
import type { TerrainGrid } from '../sim/terrainGrid';
import type { Camera } from './camera';
import type { ReliefParams } from './relief';
import { contourLabelAngle } from './relief';

const FONT_COND = '"Barlow Condensed", Barlow, sans-serif';
/** Wielkość czcionki tekstury napisu [px] – skalowana do labelFontPx na ekranie. */
const BASE_FONT_PX = 32;

interface LabelSpot {
  text: Text;
  xM: number;
  yM: number;
}

export class ContourLabels {
  readonly root = new Container();
  private readonly spots: LabelSpot[] = [];
  enabled = true;

  constructor(
    private readonly grid: TerrainGrid,
    private p: ReliefParams['contours'],
  ) {
    this.root.eventMode = 'none';
    this.build();
  }

  setParams(p: ReliefParams['contours']): void {
    const rebuild = p.majorIntervalM !== this.p.majorIntervalM || p.labelSpacingM !== this.p.labelSpacingM || p.labelMinLineLengthM !== this.p.labelMinLineLengthM;
    this.p = p;
    if (rebuild) this.build();
  }

  private build(): void {
    for (const s of this.spots) s.text.destroy();
    this.spots.length = 0;
    const g = this.grid;
    const { minM, maxM } = g.elevationRangeM();
    for (const level of contourLevels(minM, maxM, this.p.majorIntervalM)) {
      for (const line of traceLevel(g, level)) {
        const pts = line.points;
        const n = pts.length / 2;
        let total = 0;
        for (let i = 1; i < n; i++) total += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
        if (total < this.p.labelMinLineLengthM) continue;
        // Opisy co labelSpacingM, pierwszy w połowie odstępu (albo w połowie krótkiej linii).
        let next = Math.min(this.p.labelSpacingM / 2, total / 2);
        let run = 0;
        for (let i = 1; i < n && next <= total; i++) {
          const ax = pts[2 * i - 2];
          const ay = pts[2 * i - 1];
          const seg = Math.hypot(pts[2 * i] - ax, pts[2 * i + 1] - ay);
          while (seg > 0 && run + seg >= next) {
            const t = (next - run) / seg;
            this.add(level, ax + (pts[2 * i] - ax) * t, ay + (pts[2 * i + 1] - ay) * t);
            next += this.p.labelSpacingM;
          }
          run += seg;
        }
      }
    }
  }

  private add(level: number, xM: number, yM: number): void {
    const [gx, gy] = this.gradient(xM, yM);
    if (Math.hypot(gx, gy) < 1e-4) return;
    const text = new Text({
      text: String(Math.round(level)),
      style: { fontFamily: FONT_COND, fontSize: BASE_FONT_PX, fontWeight: '600', fill: 0x5b6b85, stroke: { color: 0xffffff, width: 7 }, letterSpacing: 1 },
    });
    text.anchor.set(0.5);
    text.position.set(xM, yM);
    text.rotation = contourLabelAngle(gx, gy);
    this.root.addChild(text);
    this.spots.push({ text, xM, yM });
  }

  /** Gradient terenu [m/m] w punkcie (różnice środkowe na siatce 10 m, interpolacja dwuliniowa). */
  private gradient(xM: number, yM: number): [number, number] {
    const g = this.grid;
    const e = 15;
    const z = (x: number, y: number) => g.sampleLayer(g.elevationM, x, y);
    const gx = (z(xM + e, yM) - z(xM - e, yM)) / (2 * e);
    const gy = (z(xM, yM + e) - z(xM, yM - e)) / (2 * e);
    return Number.isFinite(gx) && Number.isFinite(gy) ? [gx, gy] : [0, 0];
  }

  update(camera: Camera): void {
    const mpp = camera.metersPerPixel;
    const show = this.enabled && mpp <= this.p.labelMaxMpp;
    this.root.visible = show;
    if (!show) return;
    const a = camera.screenToWorld(0, 0);
    const b = camera.screenToWorld(camera.viewportWidthPx, camera.viewportHeightPx);
    const m = 60 * mpp;
    const x0 = Math.min(a.xM, b.xM) - m;
    const x1 = Math.max(a.xM, b.xM) + m;
    const y0 = Math.min(a.yM, b.yM) - m;
    const y1 = Math.max(a.yM, b.yM) + m;
    const sc = (this.p.labelFontPx / BASE_FONT_PX) * mpp;
    // Zanik przy progu oddalenia (bez przeskoku).
    const alpha = Math.min(1, Math.max(0, (this.p.labelMaxMpp - mpp) / (0.25 * this.p.labelMaxMpp)));
    for (const s of this.spots) {
      const v = s.xM >= x0 && s.xM <= x1 && s.yM >= y0 && s.yM <= y1;
      s.text.visible = v;
      if (!v) continue;
      s.text.scale.set(sc);
      s.text.alpha = alpha;
    }
  }
}
