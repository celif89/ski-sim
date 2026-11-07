/**
 * Warstwa wektorowa w stylu A (ilustrowana mapa narciarska):
 *  – trasy: kolorowa linia z białą obwódką, numer w kółku,
 *  – wyciągi: ciemna linia z białą poświatą, podpory jako poprzeczne kreski, stacje, krzesełka
 *    jadące po linie zgodnie z prędkością wyciągu, etykieta,
 *  – otoczenie z OSM: drogi, parkingi, budynki (z daleka małe prostokąty, z bliska dachy ze śniegiem),
 *  – granica państwa, nazwy miejsc z białą obwódką,
 *  – nakładka sieci (strzałki, węzły, ostrzeżenia), „rzeczywistość” (OSM), podgląd budowy.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { LiftAnalysis, LiftDesign } from '../sim/lifts';
import { carrierSpacingM, liftPath, pointAlongPath } from '../sim/lifts';
import type { PisteAnalysis, PisteParams } from '../sim/pistes';
import type { OsmResort, RealPisteComparison, ResortAnalysis, ResortLayout } from '../sim/resort';
import type { TerrainGrid } from '../sim/terrainGrid';
import type { Camera } from './camera';
import type { LodThresholds } from './illustration';
import { lodWeights } from './illustration';

const INK = 0x1e293b;
const SLATE = 0x334155;
const SELECT_COLOR = 0xffd400;
const ERROR_COLOR = 0xdc2626;
const REAL_LIFT_COLOR = 0xc2255c;
const BORDER_COLOR = 0xb91c1c;
const CHAIR_FILL = 0xf59e0b;
const CHAIR_STROKE = 0x7c2d12;
const FONT = 'Barlow, system-ui, sans-serif';
const FONT_COND = '"Barlow Condensed", Barlow, sans-serif';

export interface MapContextData {
  buildings: { name: string; kind: string; points: number[][] }[];
  roads: { kind: string; name: string; points: number[][] }[];
  parkings: { points: number[][] }[];
  places: { name: string; kind: string; ele: string; point: number[] }[];
}

export interface MapLabel {
  text: string;
  kind: string;
  point: number[];
}

export interface ResortDrawState {
  layout: ResortLayout;
  analysis: ResortAnalysis;
  selection: { kind: 'lift' | 'piste' | 'base' | 'pipeline' | 'gun' | 'road' | 'trail'; id: string } | null;
  showNetwork: boolean;
  showReality: boolean;
  realLifts: OsmResort['lifts'] | null;
  realPistes: RealPisteComparison[] | null;
  draftLift: { design: LiftDesign; analysis: LiftAnalysis } | null;
  draftPiste: { points: { xM: number; yM: number; widthM: number }[]; analysis: PisteAnalysis | null } | null;
  hoverPoint: { xM: number; yM: number } | null;
  version: number;
  drawVersion: number;
  /** Czas rzeczywisty [s] – ruch krzesełek. */
  timeS: number;
  /** Uchwyty edycji zaznaczonej trasy / wyciągu (położenie w metrach). */
  handles?: EditHandle[];
  /** Odcinki tras ze zbyt cienką bazą (oś od góry, odległości [m]). */
  thinMarks?: Map<string, { fromM: number; toM: number }[]>;
  /** Etap 6: budowy w toku (id → postęp 0–1) – plac budowy na mapie. */
  construction?: Map<string, number>;
  buildingTypes?: { id: string; name: string }[] | null;
  /** Etap 7: hydranty (z armatkami), rysowany rurociąg, chmury śniegu pracujących armatek. */
  /** Etap 7b: rysowana trasa letnia (rower, ścieżka, tor) i kursor. */
  trailDraft?: { kind: 'bike' | 'walk' | 'toboggan'; points: { xM: number; yM: number }[]; cursor: { xM: number; yM: number } | null } | null;
  /** Etap 6b: rysowana droga (punkty) i kursor. */
  roadDraft?: { points: { xM: number; yM: number }[]; cursor: { xM: number; yM: number } | null } | null;
  snowNet?: {
    hydrants: { pipelineId: string; index: number; xM: number; yM: number; gunId: string | null }[];
    draftPipe: { xM: number; yM: number }[];
    plumes: { xM: number; yM: number; aimXM: number; aimYM: number; rateM3h: number; windFromDeg: number; windMs: number }[];
    cursor: { xM: number; yM: number } | null;
  } | null;
}

const BUILDING_STYLE: Record<string, { color: number; letter: string }> = {
  parking: { color: 0x2563eb, letter: 'P' },
  gastronomy: { color: 0xd9480f, letter: 'G' },
  rental: { color: 0x7048e8, letter: 'W' },
  school: { color: 0x2b8a3e, letter: 'S' },
  intake: { color: 0x1971c2, letter: 'U' },
  mains: { color: 0x1864ab, letter: 'Wd' },
  well100: { color: 0x0b7285, letter: 'St' },
  well200: { color: 0x0b7285, letter: 'St' },
  catchment: { color: 0x3b8fd9, letter: 'R' },
  reservoir20: { color: 0x1864ab, letter: 'Z' },
  reservoir50: { color: 0x1864ab, letter: 'Z' },
  reservoir100: { color: 0x1864ab, letter: 'Z' },
  pump150: { color: 0x0b7285, letter: 'Pm' },
  pump300: { color: 0x0b7285, letter: 'Pm' },
  pump600: { color: 0x0b7285, letter: 'Pm' },
  grid500: { color: 0xe67700, letter: 'E' },
  grid1000: { color: 0xe67700, letter: 'E' },
  grid2000: { color: 0xe67700, letter: 'E' },
  garage: { color: 0x495057, letter: 'R' },
  anchor: { color: 0x862e9c, letter: 'K' },
};
const PIPE_COLOR = 0x1c7ed6;
const SITE_COLOR = 0xf59f00;

export type HandleKind = 'pistePoint' | 'pisteAdd' | 'pisteWidth' | 'liftBottom' | 'liftTop' | 'liftBend' | 'liftAdd';

export interface EditHandle {
  kind: HandleKind;
  index: number;
  side?: 1 | -1;
  xM: number;
  yM: number;
  hover: boolean;
  /** Załamanie wyciągu – stacja pośrednia. */
  mid?: boolean;
}

const hex = (c: string) => parseInt(c.slice(1), 16);

/** Krótka nazwa typu wyciągu na etykiecie. */
function shortType(typeId: string): string {
  if (typeId.startsWith('kanapa')) return 'kanapa';
  if (typeId === 'gondola') return 'gondola';
  if (typeId === 'orczyk') return 'orczyk';
  if (typeId === 'talerzyk') return 'talerzyk';
  return 'taśma';
}

const ROAD_WIDTH_M: Record<string, number> = { primary: 7, secondary: 6, tertiary: 5.5, unclassified: 4.5, residential: 4.5, living_street: 4, service: 3.5, track: 3 };

export class ResortLayer {
  private readonly g = new Graphics();
  private readonly labels = new Container();
  private readonly labelPool: Text[] = [];
  private readonly contextLayer = new Container();
  private readonly roadsG = new Graphics();
  /** Etap 6b: potoki (z OSM i z modelu terenu) – pod drogami. */
  private readonly streamsG = new Graphics();
  /** Etap 7b: szlaki PTTK (tylko latem) – przerywane linie w kolorach znakowania. */
  private readonly hikingG = new Graphics();
  private hikingLines: { colour: string; points: { xM: number; yM: number }[] }[] = [];
  private hikingMpp = -1;
  private summerOn = false;
  private readonly buildingsFar = new Graphics();
  private readonly buildingsNear = new Graphics();
  private lastKey = '';
  private snowOnRoofs = true;
  private contextRotated: boolean | null = null;
  private readonly local: (p: number[]) => { xM: number; yM: number } | null;

  constructor(
    world: Container,
    screenLayer: Container,
    private readonly grid: TerrainGrid,
    private readonly camera: Camera,
    private readonly pisteParams: PisteParams,
    private readonly lod: LodThresholds,
    private readonly context: MapContextData | null,
    private readonly mapLabels: MapLabel[],
    private readonly borderLinesLocal: number[][][],
  ) {
    this.local = (p) => grid.puwg92ToLocal(p[0], p[1]);
    this.contextLayer.addChild(this.streamsG, this.roadsG, this.hikingG, this.buildingsFar, this.buildingsNear);
    world.addChild(this.contextLayer);
    screenLayer.addChild(this.g);
    screenLayer.addChild(this.labels);
    this.drawContext();
  }

  /**
   * Etap 6b: potoki na mapie – niebieskie linie, grubsze przy większym przepływie (z OSM pełne,
   * wyznaczone z modelu terenu – jaśniejsze).
   */
  setStreams(lines: { points: { xM: number; yM: number }[]; meanFlowM3s: number[]; osm: boolean }[]): void {
    this.streamLines = lines;
    this.streamMpp = -1;
  }

  /** Etap 7b: szlaki PTTK z OSM. */
  setHikingTrails(lines: { colour: string; points: { xM: number; yM: number }[] }[]): void {
    this.hikingLines = lines;
    this.hikingMpp = -1;
  }

  /** Etap 7b: lato – szlaki widoczne. */
  setSummer(on: boolean): void {
    if (on === this.summerOn) return;
    this.summerOn = on;
    this.hikingG.visible = on;
    this.hikingMpp = -1;
  }

  private drawHiking(mpp: number): void {
    if (!this.summerOn) return;
    const bucket = Math.round(Math.log2(mpp) * 4) / 4;
    if (bucket === this.hikingMpp) return;
    this.hikingMpp = bucket;
    const px = 2 ** bucket;
    const g = this.hikingG.clear();
    const COLORS: Record<string, number> = { red: 0xd62828, blue: 0x1d4ed8, green: 0x2b8a3e, yellow: 0xf2c200, black: 0x111111 };
    const w = Math.max(2, 2.2 * px);
    const dash = 7 * px;
    const gap = 5 * px;
    for (const l of this.hikingLines) {
      g.moveTo(l.points[0].xM, l.points[0].yM);
      for (const q of l.points) g.lineTo(q.xM, q.yM);
      g.stroke({ width: w + 2 * px, color: 0xffffff, alpha: 0.85, cap: 'round', join: 'round' });
    }
    for (const l of this.hikingLines) {
      for (let i = 1; i < l.points.length; i++) {
        const a = l.points[i - 1];
        const b = l.points[i];
        const L = Math.hypot(b.xM - a.xM, b.yM - a.yM);
        for (let d = 0; d < L; d += dash + gap) {
          const t0 = d / L;
          const t1 = Math.min(1, (d + dash) / L);
          g.moveTo(a.xM + (b.xM - a.xM) * t0, a.yM + (b.yM - a.yM) * t0).lineTo(a.xM + (b.xM - a.xM) * t1, a.yM + (b.yM - a.yM) * t1);
        }
      }
      g.stroke({ width: w, color: COLORS[l.colour] ?? 0xd62828, cap: 'butt' });
    }
  }

  private streamLines: { points: { xM: number; yM: number }[]; meanFlowM3s: number[]; osm: boolean }[] = [];
  private streamMpp = -1;

  /** Potoki rysowane w metrach świata; grubość co najmniej ok. 1,5 px – przerysowanie przy zmianie skali. */
  private drawStreams(mpp: number): void {
    const bucket = Math.round(Math.log2(mpp) * 4) / 4;
    if (bucket === this.streamMpp) return;
    this.streamMpp = bucket;
    const px = 2 ** bucket;
    const g = this.streamsG.clear();
    for (const l of this.streamLines) {
      if (l.points.length < 2) continue;
      const q = l.meanFlowM3s.reduce((a, b) => a + b, 0) / Math.max(1, l.meanFlowM3s.length);
      const w = Math.max(Math.min(5, 1.2 + 25 * q), (1.2 + Math.min(1.5, 12 * q)) * px);
      g.moveTo(l.points[0].xM, l.points[0].yM);
      for (let i = 1; i < l.points.length; i++) g.lineTo(l.points[i].xM, l.points[i].yM);
      g.stroke({ width: w, color: l.osm ? 0x3b8fd9 : 0x74b4ec, alpha: l.osm ? 0.85 : 0.7, cap: 'round', join: 'round' });
    }
  }

  /** Śnieg na dachach (z modelu śniegu przy budynkach). */
  setRoofSnow(snowy: boolean): void {
    if (snowy === this.snowOnRoofs) return;
    this.snowOnRoofs = snowy;
    this.drawContext();
  }

  /** Drogi, parkingi i budynki – w metrach świata (rysowane raz). */
  private drawContext(): void {
    const c = this.context;
    if (!c) return;
    const r = this.roadsG.clear();
    const onMap = (q: { xM: number; yM: number } | null): q is { xM: number; yM: number } => q !== null && !Number.isNaN(this.grid.sampleElevationM(q.xM, q.yM));
    for (const road of [...c.roads].sort((a, b) => (ROAD_WIDTH_M[a.kind] ?? 3) - (ROAD_WIDTH_M[b.kind] ?? 3))) {
      const w = ROAD_WIDTH_M[road.kind] ?? 3;
      // Tylko odcinki na mapie (bez Słowacji i okolic poza siatką).
      const pts = road.points.map(this.local);
      let pen = false;
      for (const q of pts) {
        if (!onMap(q)) {
          pen = false;
          continue;
        }
        if (pen) r.lineTo(q.xM, q.yM);
        else r.moveTo(q.xM, q.yM);
        pen = true;
      }
      r.stroke({ width: w, color: road.kind === 'track' ? 0xb8c2cc : 0x9aa3ad, alpha: road.kind === 'track' ? 0.6 : 0.95, cap: 'round', join: 'round' });
    }
    for (const p of c.parkings) {
      const pts = p.points.map(this.local).filter(onMap);
      if (pts.length < 3) continue;
      r.poly(pts.flatMap((q) => [q.xM, q.yM])).fill({ color: 0xdbe2ea }).stroke({ width: 0.6, color: 0x94a3b8 });
    }
    const far = this.buildingsFar.clear();
    const near = this.buildingsNear.clear();
    for (const b of c.buildings) {
      const pts = b.points.map(this.local).filter(onMap);
      if (pts.length < 3) continue;
      const flat = pts.flatMap((q) => [q.xM, q.yM]);
      // Z daleka: czerwono-brązowy prostokąt (jak na makiecie), powiększony do min. ok. 12 m.
      const cx = pts.reduce((s, q) => s + q.xM, 0) / pts.length;
      const cy = pts.reduce((s, q) => s + q.yM, 0) / pts.length;
      const scale = 1.6;
      far.poly(pts.flatMap((q) => [cx + (q.xM - cx) * scale, cy + (q.yM - cy) * scale])).fill({ color: 0x9a4a35 }).stroke({ width: 1.2, color: 0xffffff, alpha: 0.85 });
      // Z bliska: dach – połać jasna i cienista, kalenica wzdłuż dłuższego boku.
      const roof = this.snowOnRoofs ? 0xf8fafc : 0x9b4b3b;
      const roofShade = this.snowOnRoofs ? 0xcbd6e4 : 0x7a3a2e;
      // Cień budynku (w prawo w dół ekranu – jak drzewa).
      const sx = this.camera.sign * 1.5;
      near.poly(flat.map((v, i) => v + (i % 2 === 0 ? sx : sx))).fill({ color: 0x334155, alpha: 0.25 });
      near.poly(flat).fill({ color: roof }).stroke({ width: 0.5, color: 0x64748b });
      let best = 0;
      let bi = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const d = Math.hypot(pts[i + 1].xM - pts[i].xM, pts[i + 1].yM - pts[i].yM);
        if (d > best) {
          best = d;
          bi = i;
        }
      }
      const ax = pts[bi + 1].xM - pts[bi].xM;
      const ay = pts[bi + 1].yM - pts[bi].yM;
      const L = Math.hypot(ax, ay) || 1;
      const ux = ax / L;
      const uy = ay / L;
      // Połowa dachu po jednej stronie kalenicy w cieniu.
      const shadeHalf: number[] = [];
      for (const q of pts) {
        const side = (q.xM - cx) * -uy + (q.yM - cy) * ux;
        shadeHalf.push(side > 0 ? q.xM : cx + (q.xM - cx) * 0.02, side > 0 ? q.yM : cy + (q.yM - cy) * 0.02);
      }
      near.poly(shadeHalf).fill({ color: roofShade, alpha: 0.75 });
      near.moveTo(cx - ux * L * 0.45, cy - uy * L * 0.45).lineTo(cx + ux * L * 0.45, cy + uy * L * 0.45).stroke({ width: 0.4, color: 0x64748b });
    }
  }

  private sortedPlaces: MapContextData['places'] | null = null;

  /** Miejsca do opisania: najpierw Pilsko, potem szczyty od najwyższego, na końcu reszta. */
  private get placesByImportance(): MapContextData['places'] {
    if (!this.sortedPlaces) {
      const rank = (pl: MapContextData['places'][number]) => (pl.name === 'Pilsko' ? 1e6 : pl.kind === 'peak' ? Number.parseFloat(pl.ele) || 0 : -1);
      this.sortedPlaces = [...(this.context?.places ?? [])].sort((a, b) => rank(b) - rank(a));
    }
    return this.sortedPlaces;
  }

  private label(i: number, text: string, xPx: number, yPx: number, opts: { size?: number; cond?: boolean; fill?: number; stroke?: number; spacing?: number; anchorX?: number }): void {
    let t = this.labelPool[i];
    if (!t) {
      t = new Text({ text, style: { fontFamily: FONT, fontSize: 12, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
      t.anchor.set(0.5);
      this.labelPool[i] = t;
      this.labels.addChild(t);
    }
    if (t.text !== text) t.text = text;
    const st = t.style;
    st.fontFamily = opts.cond ? FONT_COND : FONT;
    st.fontSize = opts.size ?? 12;
    st.fill = opts.fill ?? 0xffffff;
    st.stroke = { color: opts.stroke ?? 0x000000, width: opts.stroke === 0xffffff ? 4 : 3, join: 'round' };
    st.letterSpacing = opts.spacing ?? 0;
    t.anchor.set(opts.anchorX ?? 0.5, 0.5);
    t.position.set(Math.round(xPx), Math.round(yPx));
    t.visible = true;
  }

  /** Co klatkę: przerysowuje, gdy zmieniła się kamera, dane albo jadą krzesełka. */
  update(st: ResortDrawState): void {
    const cam = this.camera;
    if (this.contextRotated !== cam.rotated) {
      this.contextRotated = cam.rotated;
      this.drawContext();
    }
    const mpp = cam.metersPerPixel;
    this.drawStreams(mpp);
    this.drawHiking(mpp);
    const w = lodWeights(mpp, this.lod);
    this.buildingsFar.alpha = w.w1;
    this.buildingsNear.alpha = 1 - w.w1;
    this.buildingsFar.visible = w.w1 > 0.01;
    this.buildingsNear.visible = w.w1 < 0.99;
    const chairsVisible = mpp < 5 && st.layout.lifts.length > 0;
    const key = [st.version, st.drawVersion, cam.centerXM, cam.centerYM, mpp, cam.viewportWidthPx, cam.viewportHeightPx, cam.rotated, st.showNetwork, st.showReality, st.hoverPoint?.xM, st.hoverPoint?.yM, chairsVisible ? st.timeS : 0, st.snowNet?.plumes.length ? Math.floor(performance.now() / 50) : 0].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;
    const g = this.g;
    g.clear();
    let li = 0;
    const toS = (x: number, y: number) => cam.worldToScreen(x, y);
    const pxPerM = 1 / mpp;

    // ---- granica państwa
    for (const line of this.borderLinesLocal) {
      const pts = line.map(([x, y]) => toS(x, y));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const len = Math.hypot(b.xPx - a.xPx, b.yPx - a.yPx);
        for (let d = 0; d < len; d += 14) {
          const t0 = d / len;
          const t1 = Math.min(1, (d + 8) / len);
          g.moveTo(a.xPx + t0 * (b.xPx - a.xPx), a.yPx + t0 * (b.yPx - a.yPx)).lineTo(a.xPx + t1 * (b.xPx - a.xPx), a.yPx + t1 * (b.yPx - a.yPx));
        }
      }
      g.stroke({ width: 2, color: BORDER_COLOR, alpha: 0.85 });
    }

    // ---- nazwy miejsc (bez nakładania: etykieta kolidująca z już postawioną jest pomijana)
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const fits = (idx: number, marginPx = 3): boolean => {
      const t = this.labelPool[idx];
      const x0 = t.x - t.anchor.x * t.width - marginPx;
      const y0 = t.y - t.anchor.y * t.height - marginPx;
      const box = { x0, y0, x1: x0 + t.width + 2 * marginPx, y1: y0 + t.height + 2 * marginPx };
      if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
        t.visible = false;
        return false;
      }
      placed.push(box);
      return true;
    };
    for (const l of this.mapLabels) {
      const p = this.local(l.point);
      if (!p) continue;
      const s = toS(p.xM, p.yM);
      if (l.kind === 'hut') {
        if (mpp > 6) continue;
        this.label(li, l.text, s.xPx, s.yPx, { size: 12, fill: 0x475569, stroke: 0xffffff });
      } else this.label(li, l.text, s.xPx, s.yPx, { size: 17, cond: true, fill: SLATE, stroke: 0xffffff, spacing: 2 });
      if (fits(li)) li++;
    }
    const seenNames = new Set<string>();
    for (const pl of this.placesByImportance) {
      if (pl.kind !== 'peak' && pl.kind !== 'hamlet' && pl.kind !== 'saddle') continue;
      if (pl.kind !== 'peak' && mpp > 3) continue;
      // Przy całej mapie tylko najważniejsze szczyty (Pilsko, ponad 1300 m).
      if (pl.kind === 'peak' && mpp > 3.5 && pl.name !== 'Pilsko' && !(Number.parseFloat(pl.ele) >= 1300)) continue;
      const p = this.local(pl.point);
      if (!p) continue;
      const s = toS(p.xM, p.yM);
      if (s.xPx < -50 || s.yPx < -50 || s.xPx > cam.viewportWidthPx + 50 || s.yPx > cam.viewportHeightPx + 50) continue;
      if (pl.kind === 'peak') {
        // Ta sama nazwa drugi raz (OSM ma np. dwa punkty „Góra Pięciu Kopców”) – tylko wyższy.
        if (seenNames.has(pl.name)) continue;
        const ele = pl.ele ? ` ${Math.round(Number.parseFloat(pl.ele))} m` : '';
        this.label(li, `${pl.name}${ele}`, s.xPx + 12, s.yPx, { size: pl.name === 'Pilsko' ? 18 : 14, cond: true, fill: INK, stroke: 0xffffff, anchorX: 0 });
        if (!fits(li)) continue;
        li++;
        seenNames.add(pl.name);
        g.moveTo(s.xPx, s.yPx - 6).lineTo(s.xPx + 7, s.yPx + 6).lineTo(s.xPx - 7, s.yPx + 6).closePath().fill({ color: INK }).stroke({ width: 1.5, color: 0xffffff });
      } else {
        this.label(li, pl.name, s.xPx, s.yPx, { size: 13, cond: true, fill: 0x475569, stroke: 0xffffff, spacing: 1 });
        if (fits(li)) li++;
      }
    }

    // ---- rzeczywistość (OSM)
    if (st.showReality) {
      for (const r of st.realPistes ?? []) {
        const pts = r.axis.map((p) => toS(p.xM, p.yM));
        const color = hex(this.pisteParams.classes.find((c) => c.id === r.officialClass)?.color ?? '#888888');
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const p of pts) g.lineTo(p.xPx, p.yPx);
        g.stroke({ width: Math.max(4, this.pisteParams.osmPisteWidthM * pxPerM), color, alpha: 0.35, cap: 'round', join: 'round' });
        const mid = pts[Math.floor(pts.length / 2)];
        this.label(li++, `${r.label}${r.agree ? '' : ' ≠'}`, mid.xPx, mid.yPx, { size: 12, fill: 0xffffff, stroke: color });
      }
      for (const l of st.realLifts ?? []) {
        const pts = l.points.map(this.local).filter((p): p is { xM: number; yM: number } => p !== null).map((p) => toS(p.xM, p.yM));
        if (pts.length < 2) continue;
        for (let i = 0; i < pts.length - 1; i++) {
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
        this.label(li++, l.ref || l.name || l.aerialway, mid.xPx, mid.yPx - 10, { size: 12, fill: 0xffffff, stroke: REAL_LIFT_COLOR });
      }
    }

    // ---- trasy: kolorowa linia z białą obwódką, numer w kółku
    const pisteBadges: { x: number; y: number; color: number; text: string }[] = [];
    for (const p of st.layout.pistes) {
      const a = st.analysis.pistes.get(p.id);
      if (!a || a.axis.length < 2) continue;
      const color = hex(this.pisteParams.classes[a.classIndex].color);
      const selected = st.selection?.kind === 'piste' && st.selection.id === p.id;
      const pts = a.axis.filter((x) => !Number.isNaN(x.elevationM)).map((s) => toS(s.xM, s.yM));
      if (pts.length < 2) continue;
      if (selected) {
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width: Math.max(16, a.meanWidthM * pxPerM), color: SELECT_COLOR, alpha: 0.4, cap: 'round', join: 'round' });
      }
      const closed = p.closed === true;
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const q of pts) g.lineTo(q.xPx, q.yPx);
      g.stroke({ width: 10, color: 0xffffff, alpha: closed ? 0.6 : 0.95, cap: 'round', join: 'round' });
      if (closed) {
        // Zamknięta – kreskowana, wyblakła.
        for (let i = 0; i < pts.length - 1; i++) {
          const a0 = pts[i];
          const a1 = pts[i + 1];
          const len = Math.hypot(a1.xPx - a0.xPx, a1.yPx - a0.yPx);
          for (let d = 0; d < len; d += 12) {
            const t0 = d / len;
            const t1 = Math.min(1, (d + 7) / len);
            g.moveTo(a0.xPx + t0 * (a1.xPx - a0.xPx), a0.yPx + t0 * (a1.yPx - a0.yPx)).lineTo(a0.xPx + t1 * (a1.xPx - a0.xPx), a0.yPx + t1 * (a1.yPx - a0.yPx));
          }
        }
        g.stroke({ width: 4, color, alpha: 0.55, cap: 'butt' });
      } else {
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width: 5, color, cap: 'round', join: 'round' });
      }
      // Za mało śniegu: czerwone kreski na odcinkach ze zbyt cienką bazą.
      const thin = st.thinMarks?.get(p.id);
      if (thin && !closed) {
        const axis = a.axis.filter((x) => !Number.isNaN(x.elevationM));
        for (const seg of thin) {
          const part = axis.filter((x) => x.distanceM >= seg.fromM && x.distanceM <= seg.toM).map((x) => toS(x.xM, x.yM));
          if (part.length < 2) continue;
          g.moveTo(part[0].xPx, part[0].yPx);
          for (const q of part) g.lineTo(q.xPx, q.yPx);
          g.stroke({ width: 13, color: ERROR_COLOR, alpha: 0.85, cap: 'round', join: 'round' });
          g.moveTo(part[0].xPx, part[0].yPx);
          for (const q of part) g.lineTo(q.xPx, q.yPx);
          g.stroke({ width: 4, color, cap: 'round', join: 'round' });
        }
      }
      if (st.showNetwork || selected) {
        const stepM = 150;
        for (let d = stepM / 2; d < a.lengthM; d += stepM) {
          const i = Math.min(pts.length - 2, Math.floor((d / a.lengthM) * (pts.length - 1)));
          const s0 = pts[i];
          const s1 = pts[i + 1];
          const ang = Math.atan2(s1.yPx - s0.yPx, s1.xPx - s0.xPx);
          const size = 6;
          const cx = (s0.xPx + s1.xPx) / 2;
          const cy = (s0.yPx + s1.yPx) / 2;
          g.moveTo(cx + Math.cos(ang) * size, cy + Math.sin(ang) * size)
            .lineTo(cx + Math.cos(ang + 2.5) * size, cy + Math.sin(ang + 2.5) * size)
            .lineTo(cx + Math.cos(ang - 2.5) * size, cy + Math.sin(ang - 2.5) * size)
            .closePath()
            .fill({ color: 0xffffff });
        }
      }
      const mid = pts[Math.floor(pts.length * 0.55)];
      pisteBadges.push({ x: mid.xPx, y: mid.yPx, color, text: p.name });
    }

    // ---- wyciągi
    const drawLift = (design: LiftDesign, a: LiftAnalysis, opts: { selected: boolean; draft: boolean }) => {
      const path = liftPath(design);
      const sp = path.map((q) => toS(q.xM, q.yM));
      const b = sp[0];
      const t = sp[sp.length - 1];
      const bad = !a.ok;
      const closed = design.closed === true;
      const line = (width: number, color: number, alpha = 1) => {
        g.moveTo(sp[0].xPx, sp[0].yPx);
        for (const q of sp) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
      };
      if (opts.selected) line(12, SELECT_COLOR, 0.5);
      line(5, 0xffffff, 0.9);
      line(2, bad ? ERROR_COLOR : INK, closed ? 0.4 : 1);
      // Punkt łamanej w odległości poziomej d (ekran) i kierunek prostopadły.
      const at = (d: number) => {
        const p = pointAlongPath(path, d);
        const p2 = pointAlongPath(path, Math.min(a.horizontalLengthM, d + 1));
        const p1 = pointAlongPath(path, Math.max(0, d - 1));
        const s0 = toS(p.xM, p.yM);
        const s1 = toS(p1.xM, p1.yM);
        const s2 = toS(p2.xM, p2.yM);
        const dx = s2.xPx - s1.xPx;
        const dy = s2.yPx - s1.yPx;
        const len = Math.hypot(dx, dy) || 1;
        return { x: s0.xPx, y: s0.yPx, nx: -dy / len, ny: dx / len };
      };
      // Podpory: krótkie poprzeczne kreski.
      for (const s of a.supports) {
        if (s.kind !== 'tower') continue;
        const q = at(s.distanceM);
        const half = Math.max(4, Math.min(8, 3 * pxPerM));
        g.moveTo(q.x - q.nx * half, q.y - q.ny * half).lineTo(q.x + q.nx * half, q.y + q.ny * half);
      }
      g.stroke({ width: 2.5, color: bad ? ERROR_COLOR : INK, cap: 'round' });
      // Krzesełka jadące po linie (w górę z jednej strony, w dół z drugiej).
      const spacing = carrierSpacingM(a.type);
      if (!opts.draft && !closed && mpp < 5 && spacing > 0 && a.type.towerMaxHeightM > 0) {
        const offPx = Math.max(2.5, 2 * pxPerM);
        // Odległość po linie (po skosie) – tak samo liczy wątek gości: krzesełko k odjeżdża w chwili
        // k · odstęp, więc jest w odległości (czas · prędkość) mod odstęp (goście siedzą na krzesełkach).
        const Ls = a.slopeLengthM || a.horizontalLengthM;
        const ps = a.pathSlopeM;
        const vm = [0];
        for (let i = 1; i < path.length; i++) vm.push(vm[i - 1] + Math.hypot(path[i].xM - path[i - 1].xM, path[i].yM - path[i - 1].yM));
        const horiz = (dSlope: number) => {
          let i = 0;
          while (i < ps.length - 2 && ps[i + 1] < dSlope) i++;
          const f = (dSlope - ps[i]) / (ps[i + 1] - ps[i] || 1);
          return vm[i] + Math.min(1, Math.max(0, f)) * (vm[i + 1] - vm[i]);
        };
        const travel = (((st.timeS * a.type.speedMs) % spacing) + spacing) % spacing;
        const cw = Math.max(4, Math.min(10, 2.2 * pxPerM));
        const ch = cw * 0.8;
        for (let d = travel; d < Ls; d += spacing) {
          for (const dir of [1, -1]) {
            const q = at(horiz(dir === 1 ? d : Ls - d));
            const x = q.x + q.nx * offPx * dir;
            const y = q.y + q.ny * offPx * dir;
            g.roundRect(x - cw / 2, y - ch / 2, cw, ch, 1).fill({ color: CHAIR_FILL }).stroke({ width: 0.8, color: CHAIR_STROKE });
          }
        }
      }
      // Stacje: końcowe i pośrednie – prostokąty; kątowe – romby.
      for (const p of [b, t]) g.roundRect(p.xPx - 11, p.yPx - 6.5, 22, 13, 3).fill({ color: SLATE }).stroke({ width: 2, color: 0xffffff });
      (design.bends ?? []).forEach((bend, i) => {
        const p = sp[i + 1];
        if (bend.mid) g.roundRect(p.xPx - 9, p.yPx - 6, 18, 12, 3).fill({ color: SLATE }).stroke({ width: 2, color: 0xffffff });
        else g.moveTo(p.xPx, p.yPx - 7).lineTo(p.xPx + 7, p.yPx).lineTo(p.xPx, p.yPx + 7).lineTo(p.xPx - 7, p.yPx).closePath().fill({ color: SLATE }).stroke({ width: 1.5, color: 0xffffff });
      });
      for (const issue of a.issues) {
        if (issue.severity !== 'error' || issue.distanceM === null) continue;
        const q = at(issue.distanceM);
        g.circle(q.x, q.y, 7).stroke({ width: 3, color: ERROR_COLOR });
      }
      if (!opts.draft) {
        const text = `${design.name} · ${shortType(design.typeId)}${closed ? ' · zamknięty' : ''}`;
        const q = at(a.horizontalLengthM / 2);
        const mx = q.x + q.nx * 26;
        const my = q.y + q.ny * 26;
        const wPx = 9 + text.length * 6.4;
        g.roundRect(mx - wPx / 2, my - 11, wPx, 22, 11).fill({ color: closed ? 0x64748b : INK }).stroke({ width: 1.5, color: 0xffffff });
        this.label(li++, text, mx, my, { size: 12, fill: 0xffffff, stroke: closed ? 0x64748b : INK });
      }
    };
    for (const l of st.layout.lifts) {
      const a = st.analysis.lifts.get(l.id);
      if (a) drawLift(l, a, { selected: st.selection?.kind === 'lift' && st.selection.id === l.id, draft: false });
    }
    // Numery tras na wierzchu.
    for (const bdg of pisteBadges) {
      g.circle(bdg.x, bdg.y, 12).fill({ color: bdg.color }).stroke({ width: 2.5, color: 0xffffff });
      this.label(li++, bdg.text, bdg.x, bdg.y, { size: 14, fill: 0xffffff, stroke: bdg.color });
    }
    for (const b of [...st.layout.bases, ...(st.layout.buildings ?? [])]) {
      const p = toS(b.xM, b.yM);
      const sel = st.selection?.kind === 'base' && st.selection.id === b.id;
      const style = BUILDING_STYLE[b.typeId ?? 'parking'] ?? BUILDING_STYLE.parking;
      // Widok z góry z cieniem w prawo w dół (styl A).
      g.roundRect(p.xPx - 8, p.yPx - 8, 20, 20, 5).fill({ color: 0x0f172a, alpha: 0.18 });
      g.roundRect(p.xPx - 10, p.yPx - 10, 20, 20, 5).fill({ color: style.color }).stroke({ width: sel ? 3 : 2, color: sel ? SELECT_COLOR : 0xffffff });
      this.label(li++, style.letter, p.xPx, p.yPx, { size: 13, fill: 0xffffff, stroke: style.color });
    }

    // ---- drogi dojazdowe (etap 6b): szara jezdnia z białym poboczem
    for (const road of st.layout.roads ?? []) {
      const pts = road.points.map((q) => toS(q.xM, q.yM));
      const sel = st.selection?.kind === 'road' && st.selection.id === road.id;
      const w = Math.max(3, Math.min(10, 5 / mpp));
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const q of pts) g.lineTo(q.xPx, q.yPx);
      g.stroke({ width: w + 3, color: sel ? SELECT_COLOR : 0xffffff, alpha: 0.95, cap: 'round', join: 'round' });
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const q of pts) g.lineTo(q.xPx, q.yPx);
      g.stroke({ width: w, color: 0x6b7280, cap: 'round', join: 'round' });
    }
    // ---- trasy letnie (etap 7b): rowerowe w kolorze trudności (przerywane), ścieżki, tor saneczkowy
    const dashLine = (pts: { xPx: number; yPx: number }[], on: number, off: number, width: number, color: number) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const L = Math.hypot(b.xPx - a.xPx, b.yPx - a.yPx);
        for (let d = 0; d < L; d += on + off) {
          const t0 = d / L;
          const t1 = Math.min(1, (d + on) / L);
          g.moveTo(a.xPx + (b.xPx - a.xPx) * t0, a.yPx + (b.yPx - a.yPx) * t0).lineTo(a.xPx + (b.xPx - a.xPx) * t1, a.yPx + (b.yPx - a.yPx) * t1);
        }
      }
      g.stroke({ width, color, cap: 'round' });
    };
    const BIKE_COLORS = [0x2f9e44, 0x1c7ed6, 0xe03131, 0x212529];
    for (const t of st.layout.trails ?? []) {
      const a = st.analysis.trails?.get(t.id);
      const pts = (a && a.axis.length > 1 ? a.axis : t.points).map((q) => toS(q.xM, q.yM));
      if (pts.length < 2) continue;
      const sel = st.selection?.kind === 'trail' && st.selection.id === t.id;
      const line = (width: number, color: number, alpha = 1) => {
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
      };
      if (t.kind === 'bike') {
        line(6, sel ? SELECT_COLOR : 0xffffff, 0.95);
        dashLine(pts, 9, 5, 3, BIKE_COLORS[Math.max(0, a?.classIndex ?? 1)]);
      } else if (t.kind === 'walk') {
        line(5, sel ? SELECT_COLOR : 0xffffff, 0.9);
        dashLine(pts, 4, 4, 2.5, 0x8d5524);
      } else {
        line(8, sel ? SELECT_COLOR : 0x64748b, 0.95);
        line(4, 0xe2e8f0);
        line(1.5, 0xdc2626);
      }
    }
    if (st.trailDraft && st.trailDraft.points.length) {
      const pts = [...st.trailDraft.points, ...(st.trailDraft.cursor ? [st.trailDraft.cursor] : [])].map((q) => toS(q.xM, q.yM));
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const q of pts) g.lineTo(q.xPx, q.yPx);
      g.stroke({ width: 4, color: st.trailDraft.kind === 'bike' ? 0x1c7ed6 : st.trailDraft.kind === 'walk' ? 0x8d5524 : 0xdc2626, alpha: 0.6 });
    }
    if (st.roadDraft && st.roadDraft.points.length) {
      const pts = [...st.roadDraft.points, ...(st.roadDraft.cursor ? [st.roadDraft.cursor] : [])].map((q) => toS(q.xM, q.yM));
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const q of pts) g.lineTo(q.xPx, q.yPx);
      g.stroke({ width: 4, color: 0x6b7280, alpha: 0.6 });
    }

    // ---- naśnieżanie (etap 7): rurociągi, hydranty, armatki, chmury śniegu
    if (st.snowNet) {
      for (const pipe of st.layout.pipelines ?? []) {
        const pts = pipe.points.map((q) => toS(q.xM, q.yM));
        const sel = st.selection?.kind === 'pipeline' && st.selection.id === pipe.id;
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width: 5, color: 0xffffff, alpha: 0.9, cap: 'round', join: 'round' });
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width: sel ? 3.5 : pipe.supply ? 2 : 2.5, color: sel ? SELECT_COLOR : pipe.supply ? 0x0c8599 : PIPE_COLOR, cap: 'round', join: 'round' });
      }
      if (st.snowNet.draftPipe.length) {
        const pts = [...st.snowNet.draftPipe, ...(st.snowNet.cursor ? [st.snowNet.cursor] : [])].map((q) => toS(q.xM, q.yM));
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width: 3, color: PIPE_COLOR, alpha: 0.6 });
      }
      const showHydrants = mpp < 6;
      for (const h of st.snowNet.hydrants) {
        const p = toS(h.xM, h.yM);
        if (h.gunId) {
          const sel = st.selection?.kind === 'gun' && st.selection.id === h.gunId;
          const gun = (st.layout.snowGuns ?? []).find((x) => x.id === h.gunId);
          // Widok z góry z cieniem w prawo w dół: armatka śmigłowa – okrągła obudowa wentylatora, lanca – smukła rura.
          if (gun?.typeId === 'lance') {
            g.rect(p.xPx - 1, p.yPx - 9, 4, 14).fill({ color: 0x0f172a, alpha: 0.18 });
            g.rect(p.xPx - 2, p.yPx - 11, 4, 14).fill({ color: 0x343a40 }).stroke({ width: sel ? 2.5 : 1.5, color: sel ? SELECT_COLOR : 0xffffff });
          } else {
            g.circle(p.xPx + 2, p.yPx + 2, 7).fill({ color: 0x0f172a, alpha: 0.18 });
            g.circle(p.xPx, p.yPx, 7).fill({ color: 0x343a40 }).stroke({ width: sel ? 2.5 : 1.5, color: sel ? SELECT_COLOR : 0xffffff });
            g.circle(p.xPx, p.yPx, 3).fill({ color: 0xdee2e6 });
          }
        } else if (showHydrants) g.circle(p.xPx, p.yPx, 3).fill({ color: 0xffffff }).stroke({ width: 1.5, color: PIPE_COLOR });
      }
      // Chmury śniegu: w stronę trasy i z wiatrem, ruchome (czas realny – tempo nie zależy od prędkości zegara gry).
      const t = performance.now() / 1000;
      for (const pl of st.snowNet.plumes) {
        const p0 = toS(pl.xM, pl.yM);
        const ax = pl.aimXM - pl.xM;
        const ay = pl.aimYM - pl.yM;
        const al = Math.hypot(ax, ay) || 1;
        const az = ((pl.windFromDeg + 180) * Math.PI) / 180;
        const dirX = (ax / al) * 25 + Math.sin(az) * 2.5 * pl.windMs;
        const dirY = (ay / al) * 25 - Math.cos(az) * 2.5 * pl.windMs;
        const end = toS(pl.xM + dirX, pl.yM + dirY);
        const n = 7;
        const strength = Math.min(1, pl.rateM3h / 60);
        for (let i = 0; i < n; i++) {
          const f = ((i + ((t * 0.6) % 1)) / n) % 1;
          const x = p0.xPx + (end.xPx - p0.xPx) * f;
          const y = p0.yPx + (end.yPx - p0.yPx) * f;
          g.circle(x, y, (3 + 14 * f) * Math.max(0.6, Math.min(2, 4 / mpp))).fill({ color: 0xffffff, alpha: (0.55 - 0.45 * f) * (0.4 + 0.6 * strength) });
        }
      }
    }

    // ---- plac budowy (etap 6): przerywana pomarańczowa linia, postęp w procentach
    if (st.construction && st.construction.size) {
      const dashed = (pts: { xPx: number; yPx: number }[]) => {
        let on = true;
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const len = Math.hypot(b.xPx - a.xPx, b.yPx - a.yPx);
          let t = 0;
          while (t < len) {
            const step = Math.min(len - t, 8 - acc);
            if (on) g.moveTo(a.xPx + ((b.xPx - a.xPx) * t) / len, a.yPx + ((b.yPx - a.yPx) * t) / len).lineTo(a.xPx + ((b.xPx - a.xPx) * (t + step)) / len, a.yPx + ((b.yPx - a.yPx) * (t + step)) / len);
            t += step;
            acc += step;
            if (acc >= 8) {
              acc = 0;
              on = !on;
            }
          }
        }
        g.stroke({ width: 4, color: SITE_COLOR, alpha: 0.95 });
      };
      const tag = (x: number, y: number, prog: number) => {
        g.roundRect(x - 34, y - 11, 68, 22, 11).fill({ color: SITE_COLOR }).stroke({ width: 2, color: 0xffffff });
        this.label(li++, `budowa ${Math.round(prog * 100)} %`, x, y, { size: 12, fill: 0xffffff, stroke: SITE_COLOR });
      };
      for (const [id, prog] of st.construction) {
        const pa = st.analysis.pistes.get(id);
        if (pa) {
          const pts = pa.axis.filter((q) => !Number.isNaN(q.elevationM)).map((q) => toS(q.xM, q.yM));
          if (pts.length > 1) {
            dashed(pts);
            const m = pts[Math.floor(pts.length / 2)];
            tag(m.xPx, m.yPx + 18, prog);
          }
          continue;
        }
        const lift = st.layout.lifts.find((l) => l.id === id);
        if (lift) {
          const pts = liftPath(lift).map((q) => toS(q.xM, q.yM));
          dashed(pts);
          const a = pts[0];
          const b = pts[pts.length - 1];
          tag((a.xPx + b.xPx) / 2, (a.yPx + b.yPx) / 2 - 20, prog);
          continue;
        }
        const pipe = (st.layout.pipelines ?? []).find((x) => x.id === id) ?? (st.layout.roads ?? []).find((x) => x.id === id);
        if (pipe) {
          const pts = pipe.points.map((q) => toS(q.xM, q.yM));
          dashed(pts);
          const m = pts[Math.floor(pts.length / 2)];
          tag(m.xPx, m.yPx - 16, prog);
          continue;
        }
        const bld = [...st.layout.bases, ...(st.layout.buildings ?? [])].find((x) => x.id === id);
        if (bld) {
          const p = toS(bld.xM, bld.yM);
          g.circle(p.xPx, p.yPx, 16).stroke({ width: 3, color: SITE_COLOR });
          tag(p.xPx, p.yPx + 26, prog);
        }
      }
    }

    // ---- sieć: węzły i ostrzeżenia
    if (st.showNetwork) {
      for (const node of st.analysis.network.nodes) {
        if (node.kind !== 'junction' && node.kind !== 'pisteStart' && node.kind !== 'pisteEnd') continue;
        const p = toS(node.xM, node.yM);
        if (node.kind === 'junction') g.circle(p.xPx, p.yPx, 4).fill({ color: 0xffffff }).stroke({ width: 1.5, color: INK });
        else {
          g.circle(p.xPx, p.yPx, 9).fill({ color: ERROR_COLOR }).stroke({ width: 2, color: 0xffffff });
          this.label(li++, '!', p.xPx, p.yPx, { size: 13, fill: 0xffffff, stroke: ERROR_COLOR });
        }
      }
    }

    // ---- podgląd budowy
    if (st.draftPiste && st.draftPiste.points.length > 0) {
      const pts = st.draftPiste.points.map((q) => ({ ...toS(q.xM, q.yM), w: q.widthM * pxPerM }));
      const color = st.draftPiste.analysis ? hex(this.pisteParams.classes[st.draftPiste.analysis.classIndex].color) : 0x64748b;
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const q of pts) g.lineTo(q.xPx, q.yPx);
      g.stroke({ width: Math.max(10, pts[pts.length - 1].w), color: 0xffffff, alpha: 0.55, cap: 'round', join: 'round' });
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const q of pts) g.lineTo(q.xPx, q.yPx);
      g.stroke({ width: 5, color, cap: 'round', join: 'round' });
      for (const q of pts) g.circle(q.xPx, q.yPx, 3).fill({ color: 0xffffff }).stroke({ width: 1, color: INK });
    }
    if (st.draftLift) drawLift(st.draftLift.design, st.draftLift.analysis, { selected: false, draft: true });
    // ---- uchwyty edycji (przeciąganie punktów osi, szerokości, stacji)
    for (const h of st.handles ?? []) {
      const p = toS(h.xM, h.yM);
      const r = h.hover ? 8 : 6;
      if (h.kind === 'pisteAdd' || h.kind === 'liftAdd') {
        g.circle(p.xPx, p.yPx, h.hover ? 7 : 5).fill({ color: 0xffffff, alpha: 0.85 }).stroke({ width: 1.5, color: 0x1c64d8 });
        g.moveTo(p.xPx - 3, p.yPx).lineTo(p.xPx + 3, p.yPx).moveTo(p.xPx, p.yPx - 3).lineTo(p.xPx, p.yPx + 3).stroke({ width: 1.5, color: 0x1c64d8 });
      } else if (h.kind === 'pisteWidth') {
        g.rect(p.xPx - r / 2, p.yPx - r / 2, r, r).fill({ color: 0x1c64d8 }).stroke({ width: 1.5, color: 0xffffff });
      } else if (h.kind === 'liftBend') {
        g.moveTo(p.xPx, p.yPx - r - 2).lineTo(p.xPx + r + 2, p.yPx).lineTo(p.xPx, p.yPx + r + 2).lineTo(p.xPx - r - 2, p.yPx).closePath().fill({ color: h.mid ? 0x2f9e44 : 0xfacc15 }).stroke({ width: 2, color: INK });
      } else if (h.kind === 'liftBottom' || h.kind === 'liftTop') {
        g.roundRect(p.xPx - r - 3, p.yPx - r, 2 * r + 6, 2 * r, 3).fill({ color: 0xfacc15 }).stroke({ width: 2, color: INK });
      } else {
        g.circle(p.xPx, p.yPx, r).fill({ color: 0xffffff }).stroke({ width: 2.5, color: 0x1c64d8 });
      }
    }
    if (st.hoverPoint) {
      const p = toS(st.hoverPoint.xM, st.hoverPoint.yM);
      g.circle(p.xPx, p.yPx, 6).fill({ color: SELECT_COLOR }).stroke({ width: 2, color: 0x000000 });
    }
    for (let i = li; i < this.labelPool.length; i++) this.labelPool[i].visible = false;
    void this.grid;
  }
}
