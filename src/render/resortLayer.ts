/**
 * Rysowanie ośrodka na mapie: przecinki (wycięty las), obrysy tras w kolorach trudności, wyciągi
 * z podporami, strzałki kierunku i numery (nakładka sieci), podgląd w trakcie budowy, zaznaczenie
 * i nakładka „rzeczywistość” (wyciągi i trasy z OpenStreetMap).
 */
import { CanvasSource, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { LiftAnalysis, LiftDesign } from '../sim/lifts';
import type { PisteAnalysis, PisteParams } from '../sim/pistes';
import type { OsmResort, RealPisteComparison, ResortAnalysis, ResortLayout } from '../sim/resort';
import type { TerrainGrid } from '../sim/terrainGrid';
import type { Camera } from './camera';

const CLEARING_RGB = [214, 208, 170];
const SELECT_COLOR = 0xffd400;
const ERROR_COLOR = 0xe03131;
const REAL_LIFT_COLOR = 0xc2255c;

export interface ResortDrawState {
  layout: ResortLayout;
  analysis: ResortAnalysis;
  selection: { kind: 'lift' | 'piste' | 'base'; id: string } | null;
  showNetwork: boolean;
  showReality: boolean;
  realLifts: OsmResort['lifts'] | null;
  realPistes: RealPisteComparison[] | null;
  /** Podgląd budowanego wyciągu lub trasy. */
  draftLift: { design: LiftDesign; analysis: LiftAnalysis } | null;
  draftPiste: { points: { xM: number; yM: number; widthM: number }[]; analysis: PisteAnalysis | null } | null;
  /** Punkt na mapie wskazany na wykresie profilu. */
  hoverPoint: { xM: number; yM: number } | null;
  /** Wersja danych – zmienia się przy każdej zmianie układu (do odświeżania tekstur). */
  version: number;
  /** Wersja rysunku – zmienia się także przy podglądzie budowy i zaznaczeniu. */
  drawVersion: number;
}

const hex = (c: string) => parseInt(c.slice(1), 16);

export class ResortLayer {
  private readonly clearingCanvas: HTMLCanvasElement;
  private readonly pisteCanvas: HTMLCanvasElement;
  private readonly clearingSprite: Sprite;
  private readonly pisteSprite: Sprite;
  private readonly clearingSource: CanvasSource;
  private readonly pisteSource: CanvasSource;
  private readonly g = new Graphics();
  private readonly labels = new Container();
  private readonly labelPool: Text[] = [];
  private lastVersion = -1;
  private lastKey = '';

  constructor(
    world: Container,
    screenLayer: Container,
    private readonly grid: TerrainGrid,
    private readonly camera: Camera,
    private readonly pisteParams: PisteParams,
    private readonly forest0: Float32Array | null,
  ) {
    const make = () => {
      const c = document.createElement('canvas');
      c.width = grid.widthCells;
      c.height = grid.heightCells;
      return c;
    };
    this.clearingCanvas = make();
    this.pisteCanvas = make();
    this.clearingSource = new CanvasSource({ resource: this.clearingCanvas, scaleMode: 'nearest' });
    this.pisteSource = new CanvasSource({ resource: this.pisteCanvas, scaleMode: 'nearest' });
    this.clearingSprite = new Sprite(new Texture({ source: this.clearingSource }));
    this.pisteSprite = new Sprite(new Texture({ source: this.pisteSource }));
    for (const s of [this.clearingSprite, this.pisteSprite]) {
      s.width = grid.widthM;
      s.height = grid.heightM;
      world.addChild(s);
    }
    screenLayer.addChild(this.g);
    screenLayer.addChild(this.labels);
  }

  private updateTextures(st: ResortDrawState): void {
    const n = this.grid.cellCount;
    // Przecinki: wycięty las jako jasna łąka.
    const cctx = this.clearingCanvas.getContext('2d')!;
    const cimg = cctx.createImageData(this.grid.widthCells, this.grid.heightCells);
    const mask = st.analysis.clearedMask;
    for (let k = 0; k < n; k++) {
      const f = this.forest0?.[k] ?? 0;
      if (!mask[k] || f < 0.05) continue;
      cimg.data.set([CLEARING_RGB[0], CLEARING_RGB[1], CLEARING_RGB[2], Math.round(235 * Math.min(1, f + 0.2))], k * 4);
    }
    cctx.putImageData(cimg, 0, 0);
    this.clearingSource.update();
    // Trasy: obrys w kolorze klasy trudności (półprzezroczysty).
    const pctx = this.pisteCanvas.getContext('2d')!;
    const pimg = pctx.createImageData(this.grid.widthCells, this.grid.heightCells);
    const alpha = st.showNetwork ? 150 : 95;
    for (const p of st.layout.pistes) {
      const a = st.analysis.pistes.get(p.id);
      if (!a) continue;
      const c = this.pisteParams.classes[a.classIndex].color;
      const rgb = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
      for (const k of a.cells) pimg.data.set([rgb[0], rgb[1], rgb[2], alpha], k * 4);
    }
    pctx.putImageData(pimg, 0, 0);
    this.pisteSource.update();
  }

  private label(i: number, text: string, xPx: number, yPx: number, fill: number, bg: number): void {
    let t = this.labelPool[i];
    if (!t) {
      t = new Text({ text, style: { fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif', fontSize: 12, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
      t.anchor.set(0.5);
      this.labelPool[i] = t;
      this.labels.addChild(t);
    }
    t.text = text;
    t.style.fill = fill;
    t.style.stroke = { color: bg, width: 3 };
    t.position.set(xPx, yPx);
    t.visible = true;
  }

  /** Co klatkę: przerysowuje, gdy zmieniła się kamera albo dane. */
  update(st: ResortDrawState): void {
    if (st.version !== this.lastVersion) {
      this.updateTextures(st);
      this.lastVersion = st.version;
      this.lastKey = '';
    }
    const cam = this.camera;
    const key = [st.version, st.drawVersion, cam.centerXM, cam.centerYM, cam.metersPerPixel, cam.viewportWidthPx, cam.viewportHeightPx, st.showNetwork, st.showReality, st.hoverPoint?.xM, st.hoverPoint?.yM].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = this.g;
    g.clear();
    let labelIndex = 0;
    const toS = (x: number, y: number) => cam.worldToScreen(x, y);
    const pxPerM = 1 / cam.metersPerPixel;

    // ---- rzeczywistość (OSM)
    if (st.showReality) {
      for (const r of st.realPistes ?? []) {
        const pts = r.axis.map((p) => toS(p.xM, p.yM));
        const color = hex(this.pisteParams.classes.find((c) => c.id === r.officialClass)?.color ?? '#888888');
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const p of pts) g.lineTo(p.xPx, p.yPx);
        g.stroke({ width: Math.max(3, this.pisteParams.osmPisteWidthM * pxPerM), color, alpha: 0.35, cap: 'round', join: 'round' });
        const mid = pts[Math.floor(pts.length / 2)];
        this.label(labelIndex++, `${r.label}${r.agree ? '' : ' ≠'}`, mid.xPx, mid.yPx, 0xffffff, color);
      }
      for (const l of st.realLifts ?? []) {
        const pts = l.points.map(([e, n]) => this.grid.puwg92ToLocal(e, n)).filter((p): p is { xM: number; yM: number } => p !== null).map((p) => toS(p.xM, p.yM));
        if (pts.length < 2) continue;
        for (let i = 0; i < pts.length - 1; i++) {
          // linia przerywana
          const a = pts[i];
          const b = pts[i + 1];
          const len = Math.hypot(b.xPx - a.xPx, b.yPx - a.yPx);
          for (let d = 0; d < len; d += 12) {
            const t0 = d / len;
            const t1 = Math.min(1, (d + 7) / len);
            g.moveTo(a.xPx + t0 * (b.xPx - a.xPx), a.yPx + t0 * (b.yPx - a.yPx)).lineTo(a.xPx + t1 * (b.xPx - a.xPx), a.yPx + t1 * (b.yPx - a.yPx));
          }
        }
        g.stroke({ width: 3, color: REAL_LIFT_COLOR, alpha: 0.8 });
        const mid = pts[Math.floor(pts.length / 2)];
        this.label(labelIndex++, l.ref || l.name || l.aerialway, mid.xPx, mid.yPx - 10, 0xffffff, REAL_LIFT_COLOR);
      }
    }

    // ---- trasy: oś, strzałki, numery
    for (const p of st.layout.pistes) {
      const a = st.analysis.pistes.get(p.id);
      if (!a || a.axis.length < 2) continue;
      const color = hex(this.pisteParams.classes[a.classIndex].color);
      const selected = st.selection?.kind === 'piste' && st.selection.id === p.id;
      const pts = a.axis.map((s) => toS(s.xM, s.yM));
      if (selected) {
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width: Math.max(4, a.meanWidthM * pxPerM), color: SELECT_COLOR, alpha: 0.35, cap: 'round', join: 'round' });
      }
      if (st.showNetwork || selected) {
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
        // Strzałki w dół co ~120 m.
        const stepM = 120;
        for (let d = stepM / 2; d < a.lengthM; d += stepM) {
          const i = Math.min(a.axis.length - 2, Math.floor((d / a.lengthM) * (a.axis.length - 1)));
          const s0 = pts[i];
          const s1 = pts[i + 1];
          const ang = Math.atan2(s1.yPx - s0.yPx, s1.xPx - s0.xPx);
          const size = 7;
          const cx = (s0.xPx + s1.xPx) / 2;
          const cy = (s0.yPx + s1.yPx) / 2;
          g.moveTo(cx + Math.cos(ang) * size, cy + Math.sin(ang) * size)
            .lineTo(cx + Math.cos(ang + 2.5) * size, cy + Math.sin(ang + 2.5) * size)
            .lineTo(cx + Math.cos(ang - 2.5) * size, cy + Math.sin(ang - 2.5) * size)
            .closePath()
            .fill({ color })
            .stroke({ width: 1.5, color: 0xffffff });
        }
        this.label(labelIndex++, p.name, pts[0].xPx, pts[0].yPx - 12, 0xffffff, color);
      }
    }

    // ---- wyciągi
    const drawLift = (design: LiftDesign, a: LiftAnalysis, opts: { selected: boolean; draft: boolean }) => {
      const b = toS(design.bottom.xM, design.bottom.yM);
      const t = toS(design.top.xM, design.top.yM);
      const bad = !a.ok;
      g.moveTo(b.xPx, b.yPx).lineTo(t.xPx, t.yPx).stroke({ width: opts.selected ? 8 : 6, color: opts.selected ? SELECT_COLOR : 0xffffff, alpha: 0.9, cap: 'round' });
      g.moveTo(b.xPx, b.yPx)
        .lineTo(t.xPx, t.yPx)
        .stroke({ width: 3, color: bad ? ERROR_COLOR : a.type.kind === 'surface' ? 0x5c3d99 : 0x111111, cap: 'round' });
      const L = a.horizontalLengthM || 1;
      for (const s of a.supports) {
        if (s.kind !== 'tower') continue;
        const f = s.distanceM / L;
        const x = b.xPx + f * (t.xPx - b.xPx);
        const y = b.yPx + f * (t.yPx - b.yPx);
        g.rect(x - 3, y - 3, 6, 6).fill({ color: 0xffffff }).stroke({ width: 1.5, color: 0x111111 });
      }
      g.circle(b.xPx, b.yPx, 7).fill({ color: 0xffffff }).stroke({ width: 2.5, color: 0x111111 });
      g.circle(t.xPx, t.yPx, 7).fill({ color: 0x111111 }).stroke({ width: 2.5, color: 0xffffff });
      for (const issue of a.issues) {
        if (issue.severity !== 'error' || issue.distanceM === null) continue;
        const f = issue.distanceM / L;
        g.circle(b.xPx + f * (t.xPx - b.xPx), b.yPx + f * (t.yPx - b.yPx), 6).stroke({ width: 3, color: ERROR_COLOR });
      }
      if (!opts.draft) this.label(labelIndex++, design.name, (b.xPx + t.xPx) / 2 + 14, (b.yPx + t.yPx) / 2, 0xffffff, 0x111111);
    };
    for (const l of st.layout.lifts) {
      const a = st.analysis.lifts.get(l.id);
      if (a) drawLift(l, a, { selected: st.selection?.kind === 'lift' && st.selection.id === l.id, draft: false });
    }
    for (const b of st.layout.bases) {
      const p = toS(b.xM, b.yM);
      const sel = st.selection?.kind === 'base' && st.selection.id === b.id;
      g.roundRect(p.xPx - 9, p.yPx - 9, 18, 18, 3).fill({ color: 0x1c7ed6 }).stroke({ width: sel ? 3 : 2, color: sel ? SELECT_COLOR : 0xffffff });
      this.label(labelIndex++, 'P', p.xPx, p.yPx, 0xffffff, 0x1c7ed6);
    }

    // ---- sieć: węzły i ostrzeżenia
    if (st.showNetwork) {
      for (const node of st.analysis.network.nodes) {
        if (node.kind !== 'junction' && node.kind !== 'pisteStart' && node.kind !== 'pisteEnd') continue;
        const p = toS(node.xM, node.yM);
        if (node.kind === 'junction') g.circle(p.xPx, p.yPx, 4).fill({ color: 0xffffff }).stroke({ width: 1.5, color: 0x111111 });
        else {
          g.circle(p.xPx, p.yPx, 9).fill({ color: ERROR_COLOR }).stroke({ width: 2, color: 0xffffff });
          this.label(labelIndex++, '!', p.xPx, p.yPx, 0xffffff, ERROR_COLOR);
        }
      }
    }

    // ---- podgląd budowy
    if (st.draftPiste && st.draftPiste.points.length > 0) {
      const pts = st.draftPiste.points.map((q) => ({ ...toS(q.xM, q.yM), w: q.widthM * pxPerM }));
      const color = st.draftPiste.analysis ? hex(this.pisteParams.classes[st.draftPiste.analysis.classIndex].color) : 0xffffff;
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const q of pts) g.lineTo(q.xPx, q.yPx);
      g.stroke({ width: Math.max(4, pts[pts.length - 1].w), color, alpha: 0.45, cap: 'round', join: 'round' });
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const q of pts) g.lineTo(q.xPx, q.yPx);
      g.stroke({ width: 2, color: 0xffffff, alpha: 0.95 });
      for (const q of pts) g.circle(q.xPx, q.yPx, 3).fill({ color: 0xffffff });
    }
    if (st.draftLift) drawLift(st.draftLift.design, st.draftLift.analysis, { selected: false, draft: true });
    if (st.hoverPoint) {
      const p = toS(st.hoverPoint.xM, st.hoverPoint.yM);
      g.circle(p.xPx, p.yPx, 6).fill({ color: SELECT_COLOR }).stroke({ width: 2, color: 0x000000 });
    }
    for (let i = labelIndex; i < this.labelPool.length; i++) this.labelPool[i].visible = false;
  }
}
