/**
 * Ośrodek jako całość: układ (wyciągi, trasy, bazy), wycinka lasu, sieć (graf) do ruchu gości,
 * sprawdzanie połączeń, historia zmian (cofnij/ponów), zapis do JSON, porównanie z OSM.
 */
import type { BuildIssue, LiftAnalysis, LiftDesign, LiftParams, PointM } from './lifts';
import { analyzeLift, liftClearingCells, liftTypeById } from './lifts';
import { readNumber, readSection } from './params';
import type { AxisPoint, PisteAnalysis, PisteDesign, PisteParams } from './pistes';
import { analyzePiste } from './pistes';
import type { TerrainGrid } from './terrainGrid';
import type { GroundParams } from './ground';
import { groundAfterWorks, initialGround } from './ground';
import type { PipelineDesign, SnowGunDesign } from './snowmaking';

export interface BaseDesign {
  id: string;
  name: string;
  xM: number;
  yM: number;
  /** Typ budynku z data/economy.json (etap 6) – „parking”; brak – baza bez parkingu (miejsce przyjazdu). */
  typeId?: string;
}

/** Budynek z przychodem na gościa (gastronomia, wypożyczalnia, szkółka) – etap 6. */
export interface BuildingDesign {
  id: string;
  typeId: string;
  name: string;
  xM: number;
  yM: number;
}

export interface ResortLayout {
  version: 1;
  lifts: LiftDesign[];
  pistes: PisteDesign[];
  bases: BaseDesign[];
  /** Budynki usługowe (etap 6) i infrastruktura naśnieżania i ratraków (etap 7). */
  buildings?: BuildingDesign[];
  /** Rurociągi naśnieżania z hydrantami i armatki na hydrantach (etap 7). */
  pipelines?: PipelineDesign[];
  snowGuns?: SnowGunDesign[];
  /** Kolejne numery nowych obiektów. */
  nextId: number;
  /** Ośrodek otwarty (sezon trwa) – decyduje gracz; zamknięty – nie ma gości. Brak pola = otwarty. */
  resortOpen?: boolean;
}

export function emptyLayout(): ResortLayout {
  return { version: 1, lifts: [], pistes: [], bases: [], nextId: 1 };
}

export interface ClearingCost {
  forestCostPlnPerM2: number;
  shrubCostPlnPerM2: number;
  daysPerHectare: number;
}

export function parseConstructionParams(raw: unknown): { clearing: ClearingCost } {
  const c = readSection(raw, 'clearing', 'data/construction.json');
  const n = (k: string) => readNumber(c, k, 'data/construction.json', { min: 0 });
  return { clearing: { forestCostPlnPerM2: n('forestCostPlnPerM2'), shrubCostPlnPerM2: n('shrubCostPlnPerM2'), daysPerHectare: n('daysPerHectare') } };
}

// ---------------------------------------------------------------- zapis

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isPoint = (p: unknown): p is PointM => typeof p === 'object' && p !== null && isNum((p as PointM).xM) && isNum((p as PointM).yM);

/** Odczyt układu z JSON (pliku lub pamięci przeglądarki) z kontrolą formatu. */
export function parseLayout(raw: unknown): ResortLayout {
  if (typeof raw !== 'object' || raw === null) throw new Error('Plik układu ośrodka: oczekiwano obiektu JSON');
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new Error('Plik układu ośrodka: nieznana wersja');
  const lifts = Array.isArray(r.lifts) ? r.lifts : [];
  const pistes = Array.isArray(r.pistes) ? r.pistes : [];
  const bases = Array.isArray(r.bases) ? r.bases : [];
  const out: ResortLayout = { version: 1, lifts: [], pistes: [], bases: [], nextId: isNum(r.nextId) ? r.nextId : 1 };
  for (const l of lifts as Record<string, unknown>[]) {
    if (typeof l.id !== 'string' || typeof l.typeId !== 'string' || !isPoint(l.bottom) || !isPoint(l.top)) throw new Error('Plik układu ośrodka: uszkodzony wyciąg');
    const towers = Array.isArray(l.towers) ? (l.towers as Record<string, unknown>[]).filter((t) => isNum(t.distanceM) && isNum(t.heightM)).map((t) => ({ distanceM: t.distanceM as number, heightM: t.heightM as number })) : [];
    const bends = Array.isArray(l.bends) ? (l.bends as unknown[]).filter(isPoint).map((b) => ({ xM: b.xM, yM: b.yM, ...((b as { mid?: unknown }).mid === true ? { mid: true } : {}) })) : [];
    out.lifts.push({
      id: l.id,
      typeId: l.typeId,
      name: typeof l.name === 'string' ? l.name : l.id,
      bottom: { xM: l.bottom.xM, yM: l.bottom.yM },
      top: { xM: l.top.xM, yM: l.top.yM },
      ...(bends.length ? { bends } : {}),
      towers,
      manualTowers: l.manualTowers === true,
      ...(l.closed === true ? { closed: true } : {}),
    });
  }
  for (const p of pistes as Record<string, unknown>[]) {
    if (typeof p.id !== 'string' || !Array.isArray(p.points)) throw new Error('Plik układu ośrodka: uszkodzona trasa');
    const points = (p.points as Record<string, unknown>[]).filter((q) => isPoint(q) && isNum(q.widthM)).map((q) => ({ xM: q.xM as number, yM: q.yM as number, widthM: q.widthM as number }));
    if (points.length < 2) continue;
    out.pistes.push({ id: p.id, name: typeof p.name === 'string' ? p.name : p.id, points, ...(p.closed === true ? { closed: true } : {}), ...(p.graded === true ? { graded: true } : {}) });
  }
  for (const b of bases as Record<string, unknown>[]) {
    if (typeof b.id === 'string' && isNum(b.xM) && isNum(b.yM)) out.bases.push({ id: b.id, name: typeof b.name === 'string' ? b.name : 'Baza', xM: b.xM, yM: b.yM, ...(typeof b.typeId === 'string' ? { typeId: b.typeId } : {}) });
  }
  const buildings = Array.isArray(r.buildings) ? (r.buildings as Record<string, unknown>[]) : [];
  for (const b of buildings) {
    if (typeof b.id === 'string' && typeof b.typeId === 'string' && isNum(b.xM) && isNum(b.yM)) {
      (out.buildings ??= []).push({ id: b.id, typeId: b.typeId, name: typeof b.name === 'string' ? b.name : b.typeId, xM: b.xM, yM: b.yM });
    }
  }
  if (r.resortOpen === false) out.resortOpen = false;
  const pipes = Array.isArray(r.pipelines) ? (r.pipelines as Record<string, unknown>[]) : [];
  for (const pp of pipes) {
    if (typeof pp.id !== 'string' || !Array.isArray(pp.points)) continue;
    const points = (pp.points as unknown[]).filter(isPoint).map((q) => ({ xM: q.xM, yM: q.yM }));
    if (points.length >= 2) (out.pipelines ??= []).push({ id: pp.id, name: typeof pp.name === 'string' ? pp.name : pp.id, points });
  }
  const gunsRaw = Array.isArray(r.snowGuns) ? (r.snowGuns as Record<string, unknown>[]) : [];
  for (const g of gunsRaw) {
    if (typeof g.id === 'string' && typeof g.typeId === 'string' && typeof g.pipelineId === 'string' && isNum(g.hydrant)) (out.snowGuns ??= []).push({ id: g.id, typeId: g.typeId, pipelineId: g.pipelineId, hydrant: g.hydrant });
  }
  const maxId = [...out.lifts, ...out.pistes, ...out.bases, ...(out.buildings ?? []), ...(out.pipelines ?? []), ...(out.snowGuns ?? [])].reduce((m, o) => Math.max(m, Number(/\d+$/.exec(o.id)?.[0] ?? 0)), 0);
  out.nextId = Math.max(out.nextId, maxId + 1);
  return out;
}

export function serializeLayout(layout: ResortLayout): string {
  return JSON.stringify(layout);
}

/** Historia zmian układu: cofnij / ponów (stany zapisane jako tekst JSON). */
export class LayoutHistory {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  constructor(private readonly limit = 200) {}

  /** Zapamiętuje stan sprzed zmiany. */
  push(before: ResortLayout): void {
    this.undoStack.push(serializeLayout(before));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(current: ResortLayout): ResortLayout | null {
    const s = this.undoStack.pop();
    if (s === undefined) return null;
    this.redoStack.push(serializeLayout(current));
    return parseLayout(JSON.parse(s));
  }
  redo(current: ResortLayout): ResortLayout | null {
    const s = this.redoStack.pop();
    if (s === undefined) return null;
    this.undoStack.push(serializeLayout(current));
    return parseLayout(JSON.parse(s));
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

// ---------------------------------------------------------------- analiza całego ośrodka

export interface ResortContext {
  grid: TerrainGrid;
  lifts: LiftParams;
  pistes: PisteParams;
  clearing: ClearingCost;
  /** Pokrycie pierwotne (przed wycinką), udziały 0–1. */
  forest: Float32Array | null;
  shrub: Float32Array | null;
  /** Podłoże terenu (etap 5b) – bez tego brak mapy podłoża i kosztu wyrównania. */
  ground?: GroundParams | null;
}

export interface ResortAnalysis {
  lifts: Map<string, LiftAnalysis>;
  pistes: Map<string, PisteAnalysis>;
  network: ResortNetwork;
  /** Komórki objęte wycinką (1 – wycięte). */
  clearedMask: Uint8Array;
  /** Podłoże pierwotne i po budowie (pniaki po wycince, wyrównane trasy); null – bez parametrów podłoża. */
  baseGround: Uint8Array | null;
  ground: Uint8Array | null;
  totals: { costPln: number; buildDays: number; clearedForestM2: number };
}

export function analyzeResort(layout: ResortLayout, ctx: ResortContext): ResortAnalysis {
  const lifts = new Map<string, LiftAnalysis>();
  const pistes = new Map<string, PisteAnalysis>();
  for (const l of layout.lifts) lifts.set(l.id, analyzeLift(l, { grid: ctx.grid, params: ctx.lifts, forest: ctx.forest, shrub: ctx.shrub, clearingCost: ctx.clearing, otherLifts: layout.lifts }));
  const baseGround = ctx.ground ? initialGround(ctx.grid, ctx.forest, ctx.shrub, ctx.ground) : null;
  const leveling = ctx.ground ? { costPlnPerM2: ctx.ground.levelingCostPlnPerM2, daysPerHectare: ctx.ground.levelingDaysPerHectare } : null;
  for (const p of layout.pistes) pistes.set(p.id, analyzePiste(p, { grid: ctx.grid, params: ctx.pistes, forest: ctx.forest, shrub: ctx.shrub, clearingCost: ctx.clearing, baseGround, leveling }));
  const clearedMask = clearingMask(ctx.grid, layout, ctx.lifts, pistes);
  let ground: Uint8Array | null = null;
  if (baseGround) {
    const graded = new Uint8Array(ctx.grid.cellCount);
    for (const p of layout.pistes) if (p.graded) for (const k of pistes.get(p.id)?.cells ?? []) graded[k] = 1;
    ground = groundAfterWorks(baseGround, clearedMask, graded);
  }
  let clearedForestM2 = 0;
  const cellM2 = ctx.grid.cellSizeM ** 2;
  if (ctx.forest) for (let k = 0; k < clearedMask.length; k++) if (clearedMask[k]) clearedForestM2 += ctx.forest[k] * cellM2;
  let costPln = 0;
  let buildDays = 0;
  for (const a of lifts.values()) {
    costPln += a.cost.totalPln;
    buildDays += a.buildDays;
  }
  for (const a of pistes.values()) {
    costPln += a.cost.totalPln;
    buildDays += a.buildDays;
  }
  return { lifts, pistes, network: buildNetwork(layout, lifts, pistes, ctx.pistes), clearedMask, baseGround, ground, totals: { costPln, buildDays, clearedForestM2 } };
}

/** Maska wycinki: pasy pod wyciągami (szerokość z typu) i obrysy tras. */
export function clearingMask(grid: TerrainGrid, layout: ResortLayout, lp: LiftParams, pistes?: Map<string, PisteAnalysis>): Uint8Array {
  const mask = new Uint8Array(grid.cellCount);
  for (const l of layout.lifts) {
    const t = liftTypeById(lp, l.typeId);
    for (const k of liftClearingCells(grid, l, t)) mask[k] = 1;
  }
  for (const p of layout.pistes) {
    const cells = pistes?.get(p.id)?.cells;
    if (cells) for (const k of cells) mask[k] = 1;
  }
  return mask;
}

/** Pokrycie po wycince: w wyciętych komórkach las i kosodrzewina = 0. */
export function applyClearing(forest: Float32Array, shrub: Float32Array, mask: Uint8Array): { forest: Float32Array; shrub: Float32Array } {
  const f = forest.slice();
  const s = shrub.slice();
  for (let k = 0; k < mask.length; k++) {
    if (mask[k]) {
      f[k] = 0;
      s[k] = 0;
    }
  }
  return { forest: f, shrub: s };
}

// ---------------------------------------------------------------- sieć

export type NodeKind = 'liftBottom' | 'liftMid' | 'liftTop' | 'base' | 'pisteStart' | 'pisteEnd' | 'junction';

export interface NetworkNode {
  id: string;
  kind: NodeKind;
  xM: number;
  yM: number;
}

export interface NetworkEdge {
  from: string;
  to: string;
  kind: 'lift' | 'piste';
  /** Id wyciągu lub trasy. */
  objectId: string;
  /** Odcinek trasy [m od początku] (dla tras). */
  fromM?: number;
  toM?: number;
  lengthM: number;
}

export interface NetworkIssue extends BuildIssue {
  objectId: string;
}

export interface ResortNetwork {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  issues: NetworkIssue[];
}

function nearestOnAxis(axis: { xM: number; yM: number; distanceM: number; elevationM: number }[], p: PointM): { distM: number; atM: number; xM: number; yM: number } {
  let best = { distM: Infinity, atM: 0, xM: 0, yM: 0 };
  for (let i = 0; i < axis.length - 1; i++) {
    const a = axis[i];
    const b = axis[i + 1];
    const dx = b.xM - a.xM;
    const dy = b.yM - a.yM;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((p.xM - a.xM) * dx + (p.yM - a.yM) * dy) / len2));
    const x = a.xM + t * dx;
    const y = a.yM + t * dy;
    const d = Math.hypot(p.xM - x, p.yM - y);
    if (d < best.distM) best = { distM: d, atM: a.distanceM + t * (b.distanceM - a.distanceM), xM: x, yM: y };
  }
  return best;
}

/**
 * Graf ośrodka: wyciągi (dolna → górna stacja) i trasy (w dół) jako krawędzie. Trasa zaczyna się
 * przy górnej stacji wyciągu lub na innej trasie; kończy przy dolnej stacji, w bazie lub na innej
 * trasie. Trasy mijające stacje po drodze też się z nimi łączą.
 */
export function buildNetwork(layout: ResortLayout, lifts: Map<string, LiftAnalysis>, pistes: Map<string, PisteAnalysis>, p: PisteParams): ResortNetwork {
  const nodes: NetworkNode[] = [];
  const edges: NetworkEdge[] = [];
  const issues: NetworkIssue[] = [];
  const nodeById = new Map<string, NetworkNode>();
  const addNode = (n: NetworkNode) => {
    if (!nodeById.has(n.id)) {
      nodeById.set(n.id, n);
      nodes.push(n);
    }
    return nodeById.get(n.id)!;
  };
  // Wyciągi: przystanki dolny → pośrednie → górny; krawędź między kolejnymi przystankami.
  const liftStations = new Map<string, { id: string; point: PointM; canStart: boolean; canEnd: boolean }[]>();
  for (const l of layout.lifts) {
    const a = lifts.get(l.id);
    const st: { id: string; point: PointM; canStart: boolean; canEnd: boolean; dist: number }[] = [{ id: `${l.id}:dół`, point: l.bottom, canStart: false, canEnd: true, dist: 0 }];
    let midNo = 0;
    for (const s of a?.stops ?? []) {
      if (s.kind !== 'mid') continue;
      midNo++;
      st.push({ id: `${l.id}:pośr${midNo}`, point: { xM: s.xM, yM: s.yM }, canStart: true, canEnd: true, dist: s.slopeDistanceM });
    }
    st.push({ id: `${l.id}:góra`, point: l.top, canStart: true, canEnd: false, dist: a?.slopeLengthM ?? Math.hypot(l.top.xM - l.bottom.xM, l.top.yM - l.bottom.yM) });
    st.forEach((x, i) => addNode({ id: x.id, kind: i === 0 ? 'liftBottom' : i === st.length - 1 ? 'liftTop' : 'liftMid', ...x.point }));
    for (let i = 0; i < st.length - 1; i++) edges.push({ from: st[i].id, to: st[i + 1].id, kind: 'lift', objectId: l.id, lengthM: st[i + 1].dist - st[i].dist });
    liftStations.set(l.id, st);
  }
  for (const b of layout.bases) addNode({ id: b.id, kind: 'base', xM: b.xM, yM: b.yM });

  // Punkty na trasach (odległość wzdłuż osi → węzeł).
  const stops = new Map<string, Map<number, string>>();
  const addStop = (pisteId: string, atM: number, nodeId: string) => {
    let m = stops.get(pisteId);
    if (!m) stops.set(pisteId, (m = new Map()));
    for (const [d, id] of m) if (Math.abs(d - atM) < 1 && id === nodeId) return;
    m.set(atM, nodeId);
  };
  const valid = layout.pistes.filter((x) => (pistes.get(x.id)?.axis.length ?? 0) >= 2);
  for (const piste of valid) {
    const a = pistes.get(piste.id)!;
    const ax = a.axis.filter((s) => !Number.isNaN(s.elevationM));
    if (ax.length < 2) continue;
    const start = ax[0];
    const end = ax[ax.length - 1];
    const length = end.distanceM;
    // Stacje wyciągów i bazy przy trasie (na początku, końcu i po drodze).
    let startNode: string | null = null;
    let endNode: string | null = null;
    for (const l of layout.lifts) {
      for (const st of liftStations.get(l.id) ?? []) {
        const pt = st.point;
        const near = nearestOnAxis(ax, pt);
        if (near.distM > p.stationRadiusM) continue;
        if (st.canStart && !startNode && Math.hypot(start.xM - pt.xM, start.yM - pt.yM) <= p.stationRadiusM) startNode = st.id;
        if (st.canEnd && !endNode && Math.hypot(end.xM - pt.xM, end.yM - pt.yM) <= p.stationRadiusM) endNode = st.id;
        addStop(piste.id, near.atM, st.id);
      }
    }
    for (const b of layout.bases) {
      const near = nearestOnAxis(ax, b);
      if (near.distM > p.baseRadiusM) continue;
      if (Math.hypot(end.xM - b.xM, end.yM - b.yM) <= p.baseRadiusM) endNode = endNode ?? b.id;
      addStop(piste.id, near.atM, b.id);
    }
    // Połączenia z innymi trasami (początek lub koniec na innej trasie).
    for (const other of valid) {
      if (other.id === piste.id) continue;
      const oa = pistes.get(other.id)!;
      const oax = oa.axis.filter((s) => !Number.isNaN(s.elevationM));
      if (oax.length < 2) continue;
      const tolStart = p.junctionToleranceM + oax[0].widthM / 2;
      if (!startNode) {
        const near = nearestOnAxis(oax, start);
        const halfW = (oax[Math.min(oax.length - 1, Math.round(near.atM / Math.max(1e-6, oax[1].distanceM - oax[0].distanceM)))]?.widthM ?? tolStart) / 2;
        if (near.distM <= halfW + p.junctionToleranceM && near.atM < oax[oax.length - 1].distanceM - 1) {
          const id = `${other.id}@${Math.round(near.atM)}`;
          addNode({ id, kind: 'junction', xM: near.xM, yM: near.yM });
          addStop(other.id, near.atM, id);
          startNode = id;
        }
      }
      if (!endNode) {
        const near = nearestOnAxis(oax, end);
        const halfW = (oax[Math.min(oax.length - 1, Math.round(near.atM / Math.max(1e-6, oax[1].distanceM - oax[0].distanceM)))]?.widthM ?? tolStart) / 2;
        if (near.distM <= halfW + p.junctionToleranceM && near.atM > 1) {
          const id = `${other.id}@${Math.round(near.atM)}`;
          addNode({ id, kind: 'junction', xM: near.xM, yM: near.yM });
          addStop(other.id, near.atM, id);
          endNode = id;
        }
      }
    }
    if (!startNode) {
      startNode = `${piste.id}:start`;
      addNode({ id: startNode, kind: 'pisteStart', xM: start.xM, yM: start.yM });
      issues.push({ objectId: piste.id, severity: 'warning', distanceM: 0, message: `trasa „${piste.name}” zaczyna się donikąd – nie przy górnej stacji wyciągu ani na innej trasie` });
    }
    if (!endNode) {
      endNode = `${piste.id}:koniec`;
      addNode({ id: endNode, kind: 'pisteEnd', xM: end.xM, yM: end.yM });
      issues.push({ objectId: piste.id, severity: 'warning', distanceM: length, message: `trasa „${piste.name}” prowadzi donikąd – nie kończy się przy dolnej stacji, w bazie ani na innej trasie` });
    }
    addStop(piste.id, 0, startNode);
    addStop(piste.id, length, endNode);
  }
  // Krawędzie tras: między kolejnymi punktami wzdłuż osi.
  for (const piste of valid) {
    const m = stops.get(piste.id);
    if (!m) continue;
    const list = [...m.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i][1] === list[i + 1][1]) continue;
      edges.push({ from: list[i][1], to: list[i + 1][1], kind: 'piste', objectId: piste.id, fromM: list[i][0], toM: list[i + 1][0], lengthM: list[i + 1][0] - list[i][0] });
    }
  }
  // Wyciągi bez zjazdu: z górnej stacji nie wychodzi żadna trasa.
  for (const l of layout.lifts) {
    const top = `${l.id}:góra`;
    if (!edges.some((e) => e.kind === 'piste' && e.from === top)) {
      issues.push({ objectId: l.id, severity: 'warning', distanceM: null, message: `wyciąg „${l.name}” nie ma zjazdu – z górnej stacji nie zaczyna się żadna trasa` });
    }
  }
  return { nodes, edges, issues };
}

// ---------------------------------------------------------------- porównanie z OSM

export interface OsmPiste {
  osmId: number;
  name: string;
  ref: string;
  difficulty: string;
  area: boolean;
  points: number[][];
}

export interface OsmResort {
  lifts: { osmId: number; name: string; ref: string; aerialway: string; capacityPerHour: number | null; points: number[][] }[];
  pistes: OsmPiste[];
}

export interface RealPisteComparison {
  label: string;
  osmIds: number[];
  lengthM: number;
  dropM: number;
  maxSlopePercent: number;
  officialClass: string | null;
  ourClass: string;
  agree: boolean;
  analysis: PisteAnalysis;
  /** Oś w układzie lokalnym (do rysowania). */
  axis: PointM[];
}

/** Łączy odcinki tej samej trasy (te same nazwy i trudność) w ciągi, gdy końce się stykają. */
export function chainOsmPistes(list: { key: string; points: PointM[]; ids: number[] }[], toleranceM: number): { key: string; points: PointM[]; ids: number[] }[] {
  const pending = list.map((x) => ({ ...x, points: [...x.points], ids: [...x.ids] }));
  const out: typeof pending = [];
  const close = (a: PointM, b: PointM) => Math.hypot(a.xM - b.xM, a.yM - b.yM) <= toleranceM;
  while (pending.length) {
    const cur = pending.shift()!;
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < pending.length; i++) {
        const o = pending[i];
        if (o.key !== cur.key) continue;
        const cs = cur.points[0];
        const ce = cur.points[cur.points.length - 1];
        const os = o.points[0];
        const oe = o.points[o.points.length - 1];
        let joined: PointM[] | null = null;
        if (close(ce, os)) joined = [...cur.points, ...o.points.slice(1)];
        else if (close(oe, cs)) joined = [...o.points, ...cur.points.slice(1)];
        else if (close(ce, oe)) joined = [...cur.points, ...[...o.points].reverse().slice(1)];
        else if (close(cs, os)) joined = [...[...o.points].reverse(), ...cur.points.slice(1)];
        if (joined) {
          cur.points = joined;
          cur.ids.push(...o.ids);
          pending.splice(i, 1);
          merged = true;
          break;
        }
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * Klasyfikacja prawdziwych tras z OSM naszą metodą i porównanie z ich oficjalnymi kolorami
 * (piste:difficulty). Trasy o tej samej nazwie łączone w ciągi; kolor trasy = najtrudniejszy ciąg.
 */
export function compareRealPistes(osm: OsmResort, grid: TerrainGrid, p: PisteParams, toLocal: (e: number, n: number) => PointM | null): RealPisteComparison[] {
  const items = osm.pistes
    // Tylko trasy z nazwą lub numerem – odcinki bez nazwy (łączniki) nie mają oficjalnego koloru.
    .filter((x) => !x.area && (x.ref || x.name))
    .map((x) => ({
      key: `${x.ref || x.name}|${x.difficulty}`,
      ids: [x.osmId],
      points: x.points.map(([e, n]) => toLocal(e, n)).filter((q): q is PointM => q !== null),
    }))
    .filter((x) => x.points.length >= 2);
  const chains = chainOsmPistes(items, p.osmChainToleranceM);
  const byName = new Map<string, RealPisteComparison>();
  for (const ch of chains) {
    const [label, difficulty] = ch.key.split('|');
    const design: PisteDesign = { id: `osm-${ch.ids[0]}`, name: label, points: ch.points.map((q): AxisPoint => ({ ...q, widthM: p.osmPisteWidthM })) };
    const a = analyzePiste(design, { grid, params: p, forest: null, shrub: null, clearingCost: { forestCostPlnPerM2: 0, shrubCostPlnPerM2: 0, daysPerHectare: 0 } });
    if (a.axis.filter((s) => !Number.isNaN(s.elevationM)).length < 2) continue;
    const officialClass = p.osmDifficultyToClass[difficulty] ?? null;
    const prev = byName.get(ch.key);
    // Kolor trasy = najtrudniejszy z jej ciągów (jak najtrudniejszy odcinek jednej trasy).
    const hardest = !prev || a.maxSlopePercent > prev.maxSlopePercent;
    const ourClass = hardest ? p.classes[a.classIndex].id : prev.ourClass;
    byName.set(ch.key, {
      label,
      osmIds: [...(prev?.osmIds ?? []), ...ch.ids],
      lengthM: (prev?.lengthM ?? 0) + a.lengthM,
      dropM: (prev?.dropM ?? 0) + a.dropM,
      maxSlopePercent: hardest ? a.maxSlopePercent : prev.maxSlopePercent,
      officialClass,
      ourClass,
      agree: officialClass === ourClass,
      analysis: hardest ? a : prev.analysis,
      axis: hardest ? design.points : prev.axis,
    });
  }
  return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label, 'pl', { numeric: true }));
}

// ---------------------------------------------------------------- prawdziwy ośrodek jako układ do gry

/** Typ wyciągu z OSM (aerialway, przepustowość) → typ z data/lifts.json. */
export function liftTypeFromOsm(aerialway: string, capacityPerHour: number | null, lp: LiftParams): string {
  const has = (id: string) => lp.types.some((t) => t.id === id);
  const pickBy = (ids: string[]) => ids.find(has) ?? lp.types[0].id;
  if (aerialway === 'chair_lift') {
    if (capacityPerHour !== null && capacityPerHour >= 2200) return pickBy(['kanapa4d', 'kanapa4s']);
    if (capacityPerHour !== null && capacityPerHour <= 1400) return pickBy(['kanapa2s', 'kanapa4s']);
    return pickBy(['kanapa4s', 'kanapa2s']);
  }
  if (aerialway === 'gondola' || aerialway === 'cable_car') return pickBy(['gondola']);
  if (aerialway === 't-bar' || aerialway === 'drag_lift' || aerialway === 'j-bar') return pickBy(['orczyk']);
  if (aerialway === 'platter' || aerialway === 'rope_tow') return pickBy(['talerzyk']);
  if (aerialway === 'magic_carpet') return pickBy(['tasma']);
  return pickBy(['orczyk']);
}

export interface OsmLayoutOptions {
  /** Do jakiej odległości od stacji dociągnąć koniec trasy do stacji [m]. */
  snapToStationM: number;
  /** Parkingi (środki) – bazy przy najbliższej dolnej stacji. */
  parkings: PointM[];
}

/**
 * Prawdziwy ośrodek (wyciągi i trasy z OpenStreetMap) jako układ do gry: wyciągi od niższego do
 * wyższego końca, trasy połączone w ciągi (jak w porównaniu), końce tras dociągnięte do pobliskich
 * stacji, bazy przy parkingach. Wynik można dalej edytować jak własny ośrodek.
 */
export function layoutFromOsm(
  osm: OsmResort,
  grid: TerrainGrid,
  lp: LiftParams,
  p: PisteParams,
  toLocal: (e: number, n: number) => PointM | null,
  o: OsmLayoutOptions,
  design: (id: string, typeId: string, name: string, bottom: PointM, top: PointM) => LiftDesign,
): ResortLayout {
  const layout = emptyLayout();
  const z = (q: PointM) => grid.sampleElevationM(q.xM, q.yM);
  let n = 1;
  for (const l of osm.lifts) {
    const pts = l.points.map(([e, nn]) => toLocal(e, nn)).filter((q): q is PointM => q !== null);
    if (pts.length < 2) continue;
    let a = pts[0];
    let b = pts[pts.length - 1];
    if (Number.isNaN(z(a)) || Number.isNaN(z(b))) continue;
    if (z(a) > z(b)) [a, b] = [b, a];
    const name = [l.ref, l.name].filter(Boolean).join(' ').trim() || `W${n}`;
    layout.lifts.push(design(`W${n}`, liftTypeFromOsm(l.aerialway, l.capacityPerHour, lp), name, a, b));
    n++;
  }
  const items = osm.pistes
    .filter((x) => !x.area)
    .map((x) => ({ key: `${x.ref || x.name || `#${x.osmId}`}|${x.difficulty}`, ids: [x.osmId], points: x.points.map(([e, nn]) => toLocal(e, nn)).filter((q): q is PointM => q !== null) }))
    .filter((x) => x.points.length >= 2);
  const chains = chainOsmPistes(items, p.osmChainToleranceM);
  let t = 1;
  for (const ch of chains) {
    let pts = [...ch.points];
    // Od góry do dołu.
    if (z(pts[0]) < z(pts[pts.length - 1])) pts.reverse();
    if (Number.isNaN(z(pts[0])) || Number.isNaN(z(pts[pts.length - 1]))) continue;
    const near = (q: PointM, which: 'top' | 'bottom') => {
      let best: PointM | null = null;
      let bestD = o.snapToStationM;
      for (const l of layout.lifts) {
        const s = which === 'top' ? l.top : l.bottom;
        const d = Math.hypot(s.xM - q.xM, s.yM - q.yM);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    };
    const top = near(pts[0], 'top');
    if (top && Math.hypot(top.xM - pts[0].xM, top.yM - pts[0].yM) > 1) pts = [{ xM: top.xM, yM: top.yM }, ...pts];
    const bottom = near(pts[pts.length - 1], 'bottom');
    if (bottom && Math.hypot(bottom.xM - pts[pts.length - 1].xM, bottom.yM - pts[pts.length - 1].yM) > 1) pts = [...pts, { xM: bottom.xM, yM: bottom.yM }];
    const label = ch.key.split('|')[0];
    layout.pistes.push({ id: `T${t}`, name: label.startsWith('#') ? `${t}` : label, points: pts.map((q) => ({ xM: q.xM, yM: q.yM, widthM: p.osmPisteWidthM })) });
    t++;
  }
  // Bazy: przy parkingach, w miejscu najbliższej dolnej stacji (tam kończą się trasy).
  let b = 1;
  const used = new Set<string>();
  for (const pk of o.parkings) {
    let best: LiftDesign | null = null;
    let bestD = 600;
    for (const l of layout.lifts) {
      const d = Math.hypot(l.bottom.xM - pk.xM, l.bottom.yM - pk.yM);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    if (!best || used.has(best.id)) continue;
    used.add(best.id);
    layout.bases.push({ id: `B${b}`, name: `Parking – ${best.name}`, xM: best.bottom.xM, yM: best.bottom.yM + 15, typeId: 'parking' });
    b++;
  }
  layout.nextId = Math.max(n, t, b) + 1;
  return layout;
}
