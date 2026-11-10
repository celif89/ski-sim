/**
 * Etap 7e: pomoc przy budowie – podczas rysowania trasy, wyciągu, drogi (i nartostrady) pod kursorem
 * pierścień w kolorze klasy nachylenia (jak klasy tras), strzałka kierunku spadku i nachylenie w %.
 * Nachylenie i ekspozycja z siatki terenu (metoda Horna, etap 1) – ta sama, z której liczone są
 * klasy tras. Rysowane na ekranie (stała wielkość), obok dymka przy kursorze.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { TerrainGrid } from '../sim/terrainGrid';
import type { Camera } from './camera';
import type { ReliefParams, RingClass } from './relief';
import { downhillScreen, ringClass } from './relief';

const FONT_COND = '"Barlow Condensed", Barlow, sans-serif';

/** Narzędzia budowy, przy których pokazujemy pierścień. */
export const RING_TOOLS = new Set(['pisteBrush', 'pisteAxis', 'lift', 'road', 'catwalk', 'bikeTrail', 'toboggan']);

export class SlopeRing {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly label: Text;

  constructor(
    private readonly grid: TerrainGrid,
    private readonly classes: RingClass[],
    private p: ReliefParams['buildRing'],
    private readonly flatPercent: number,
  ) {
    this.root.eventMode = 'none';
    this.label = new Text({ text: '', style: { fontFamily: FONT_COND, fontSize: 15, fontWeight: '700', fill: 0x0f172a, stroke: { color: 0xffffff, width: 4 } } });
    this.label.anchor.set(0.5, 1);
    this.root.addChild(this.g, this.label);
    this.root.visible = false;
  }

  setParams(p: ReliefParams['buildRing']): void {
    this.p = p;
  }

  /** Co klatkę: kursor na ekranie (albo null), czy narzędzie budowy rysuje linię. */
  update(camera: Camera, cursor: { xPx: number; yPx: number } | null, active: boolean): void {
    if (!active || !cursor) {
      this.root.visible = false;
      return;
    }
    const w = camera.screenToWorld(cursor.xPx, cursor.yPx);
    const sl = this.grid.sampleLayer(this.grid.slopePercent, w.xM, w.yM);
    const asp = this.grid.sampleLayer(this.grid.aspectDeg, w.xM, w.yM);
    if (!Number.isFinite(sl)) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const r = this.p.radiusPx;
    const col = parseInt(this.classes[ringClass(sl, this.classes)].color.replace('#', ''), 16);
    const g = this.g;
    g.clear();
    const cx = cursor.xPx;
    const cy = cursor.yPx;
    g.circle(cx, cy, r).stroke({ width: 7, color: 0xffffff, alpha: 0.85 });
    g.circle(cx, cy, r).stroke({ width: 4, color: col, alpha: 1 });
    if (sl > this.flatPercent && Number.isFinite(asp)) {
      const d = downhillScreen(asp, camera.rotated);
      const a = this.p.arrowPx;
      // Strzałka od pierścienia w dół stoku.
      const x0 = cx + d.x * (r - a * 0.35);
      const y0 = cy + d.y * (r - a * 0.35);
      const x1 = cx + d.x * (r + a);
      const y1 = cy + d.y * (r + a);
      const nx = -d.y;
      const ny = d.x;
      const hw = a * 0.32;
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 6, color: 0xffffff, alpha: 0.85, cap: 'round' });
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3, color: col, cap: 'round' });
      g.moveTo(x1 + d.x * hw * 0.6, y1 + d.y * hw * 0.6)
        .lineTo(x1 - d.x * hw + nx * hw, y1 - d.y * hw + ny * hw)
        .lineTo(x1 - d.x * hw - nx * hw, y1 - d.y * hw - ny * hw)
        .closePath()
        .fill({ color: col })
        .stroke({ width: 1.5, color: 0xffffff });
    }
    this.label.text = `${Math.round(sl)} %`;
    this.label.position.set(cx, cy - r - 4);
  }
}
