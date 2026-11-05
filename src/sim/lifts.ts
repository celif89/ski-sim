/**
 * Wyciągi: typy (data/lifts.json), profil terenu pod linią, automatyczne rozstawienie podpór,
 * lina ze zwisem (parabola w każdym przęśle), kontrola prześwitu, nachylenia i przechyłu toru,
 * długość, przewyższenie, czas przejazdu, moc, koszt i czas budowy.
 *
 * Współrzędne lokalne mapy [m]: x na wschód, y na południe (jak w TerrainGrid). Odległości wzdłuż
 * linii – poziome, od dolnej stacji.
 */
import { readNumber, readSection } from './params';
import type { TerrainGrid } from './terrainGrid';

const FILE = 'data/lifts.json';

export type LiftKind = 'surface' | 'aerial';

export interface LiftType {
  id: string;
  name: string;
  kind: LiftKind;
  capacityPerHour: number;
  speedMs: number;
  maxLengthM: number;
  /** Tylko wyciągi powierzchniowe; null dla kolei linowych. */
  maxTrackSlopePercent: number | null;
  maxCrossSlopePercent: number | null;
  minClearanceM: number;
  maxSpanM: number;
  windLimitMs: number;
  stationHeightM: number;
  towerMinHeightM: number;
  towerMaxHeightM: number;
  corridorWidthM: number;
  baseLoadKw: number;
  frictionKwPer100m: number;
  stationCostPln: number;
  costPerMeterPln: number;
  towerCostPln: number;
  buildDaysBase: number;
  buildDaysPer100m: number;
  /** Miejsca na krzesełku/wagoniku/orczyku (0 – ruch ciągły, np. taśma). */
  carrierSeats: number;
}

export interface LiftCommonParams {
  passengerMassKg: number;
  driveEfficiency: number;
  cableSagRatio: number;
  profileStepM: number;
  slopeWindowM: number;
  stationApproachM: number;
  minSpanM: number;
  towerMarginM: number;
  minLengthM: number;
}

export interface LiftParams {
  common: LiftCommonParams;
  types: LiftType[];
}

export function parseLiftParams(raw: unknown): LiftParams {
  const c = readSection(raw, 'common', FILE);
  const n = (s: Record<string, unknown>, k: string, o: { min?: number; max?: number } = {}) => readNumber(s, k, FILE, o);
  const common: LiftCommonParams = {
    passengerMassKg: n(c, 'passengerMassKg', { min: 1 }),
    driveEfficiency: n(c, 'driveEfficiency', { min: 0.1, max: 1 }),
    cableSagRatio: n(c, 'cableSagRatio', { min: 0, max: 0.2 }),
    profileStepM: n(c, 'profileStepM', { min: 0.5 }),
    slopeWindowM: n(c, 'slopeWindowM', { min: 1 }),
    stationApproachM: n(c, 'stationApproachM', { min: 0 }),
    minSpanM: n(c, 'minSpanM', { min: 1 }),
    towerMarginM: n(c, 'towerMarginM', { min: 0 }),
    minLengthM: n(c, 'minLengthM', { min: 1 }),
  };
  const list = (raw as { types?: unknown }).types;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${FILE}: brak listy „types”`);
  const types = list.map((e: Record<string, unknown>) => {
    if (typeof e.id !== 'string' || typeof e.name !== 'string' || (e.kind !== 'surface' && e.kind !== 'aerial')) {
      throw new Error(`${FILE}: typ wyciągu bez id, nazwy lub rodzaju (surface/aerial)`);
    }
    const surface = e.kind === 'surface';
    return {
      id: e.id,
      name: e.name,
      kind: e.kind,
      capacityPerHour: n(e, 'capacityPerHour', { min: 1 }),
      speedMs: n(e, 'speedMs', { min: 0.1 }),
      maxLengthM: n(e, 'maxLengthM', { min: 1 }),
      maxTrackSlopePercent: surface ? n(e, 'maxTrackSlopePercent', { min: 0 }) : null,
      maxCrossSlopePercent: surface ? n(e, 'maxCrossSlopePercent', { min: 0 }) : null,
      minClearanceM: n(e, 'minClearanceM', { min: 0 }),
      maxSpanM: n(e, 'maxSpanM', { min: 1 }),
      windLimitMs: n(e, 'windLimitMs', { min: 0 }),
      stationHeightM: n(e, 'stationHeightM', { min: 0 }),
      towerMinHeightM: n(e, 'towerMinHeightM', { min: 0 }),
      towerMaxHeightM: n(e, 'towerMaxHeightM', { min: 0 }),
      corridorWidthM: n(e, 'corridorWidthM', { min: 0 }),
      baseLoadKw: n(e, 'baseLoadKw', { min: 0 }),
      frictionKwPer100m: n(e, 'frictionKwPer100m', { min: 0 }),
      stationCostPln: n(e, 'stationCostPln', { min: 0 }),
      costPerMeterPln: n(e, 'costPerMeterPln', { min: 0 }),
      towerCostPln: n(e, 'towerCostPln', { min: 0 }),
      buildDaysBase: n(e, 'buildDaysBase', { min: 0 }),
      buildDaysPer100m: n(e, 'buildDaysPer100m', { min: 0 }),
      carrierSeats: n(e, 'carrierSeats', { min: 0 }),
    } satisfies LiftType;
  });
  for (const t of types) if (t.towerMaxHeightM < t.towerMinHeightM) throw new Error(`${FILE}: ${t.id} – towerMaxHeightM < towerMinHeightM`);
  return { common, types };
}

export function liftTypeById(params: LiftParams, id: string): LiftType {
  const t = params.types.find((x) => x.id === id);
  if (!t) throw new Error(`Nieznany typ wyciągu „${id}”`);
  return t;
}

export interface PointM {
  xM: number;
  yM: number;
}

export interface Tower {
  /** Odległość pozioma od dolnej stacji [m]. */
  distanceM: number;
  /** Wysokość liny na podporze nad terenem [m]. */
  heightM: number;
}

/** Wyciąg zapisany w układzie ośrodka (to, co gracz zbudował). */
export interface LiftDesign {
  id: string;
  typeId: string;
  name: string;
  bottom: PointM;
  top: PointM;
  towers: Tower[];
  /** true – gracz zmieniał podpory ręcznie (nie rozstawiamy ich od nowa). */
  manualTowers: boolean;
}

export interface GroundSample {
  distanceM: number;
  xM: number;
  yM: number;
  elevationM: number;
}

export type Severity = 'error' | 'warning';

export interface BuildIssue {
  severity: Severity;
  message: string;
  /** Miejsce na profilu: odległość od początku [m] (dolna stacja / początek trasy); null – cały obiekt. */
  distanceM: number | null;
}

/** Punkt podparcia liny (stacja lub podpora): odległość i wysokość liny n.p.m. */
export interface Support {
  distanceM: number;
  cableElevationM: number;
  groundElevationM: number;
  kind: 'station' | 'tower';
}

export interface LiftAnalysis {
  type: LiftType;
  ground: GroundSample[];
  supports: Support[];
  /** Wysokość liny n.p.m. w każdej próbce terenu. */
  cableElevationM: Float64Array;
  horizontalLengthM: number;
  /** Długość liny (po skosie). */
  slopeLengthM: number;
  riseM: number;
  rideTimeS: number;
  capacityPerHour: number;
  powerKw: number;
  /** Najmniejszy prześwit w przęsłach (poza strefą stacji) i jego miejsce. */
  minClearanceM: number;
  minClearanceAtM: number;
  maxTrackSlopePercent: number | null;
  maxCrossSlopePercent: number | null;
  towerCount: number;
  cost: { stationsPln: number; linePln: number; towersPln: number; clearingPln: number; totalPln: number };
  buildDays: number;
  issues: BuildIssue[];
  ok: boolean;
}

/** Teren pod linią dolna → górna stacja, próbkowany co `stepM`. */
export function sampleGroundAlong(grid: TerrainGrid, a: PointM, b: PointM, stepM: number): GroundSample[] {
  const length = Math.hypot(b.xM - a.xM, b.yM - a.yM);
  const steps = Math.max(1, Math.ceil(length / stepM));
  const out: GroundSample[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const xM = a.xM + t * (b.xM - a.xM);
    const yM = a.yM + t * (b.yM - a.yM);
    out.push({ distanceM: t * length, xM, yM, elevationM: grid.sampleElevationM(xM, yM) });
  }
  return out;
}

function groundAt(ground: GroundSample[], d: number): number {
  if (d <= 0) return ground[0].elevationM;
  const last = ground[ground.length - 1];
  if (d >= last.distanceM) return last.elevationM;
  const step = last.distanceM / (ground.length - 1);
  const i = Math.min(ground.length - 2, Math.floor(d / step));
  const t = (d - ground[i].distanceM) / (ground[i + 1].distanceM - ground[i].distanceM || 1);
  return ground[i].elevationM + t * (ground[i + 1].elevationM - ground[i].elevationM);
}

/** Wysokość liny n.p.m. w odległości d: cięciwa między podparciami minus zwis paraboliczny. */
export function cableElevationAt(supports: Support[], d: number, sagRatio: number): number {
  for (let i = 0; i < supports.length - 1; i++) {
    const a = supports[i];
    const b = supports[i + 1];
    if (d > b.distanceM && i < supports.length - 2) continue;
    const span = b.distanceM - a.distanceM;
    if (span <= 0) return a.cableElevationM;
    const t = Math.min(1, Math.max(0, (d - a.distanceM) / span));
    const chord = a.cableElevationM + t * (b.cableElevationM - a.cableElevationM);
    return chord - 4 * sagRatio * span * t * (1 - t);
  }
  return supports[supports.length - 1].cableElevationM;
}

function makeSupports(ground: GroundSample[], type: LiftType, towers: Tower[]): Support[] {
  const length = ground[ground.length - 1].distanceM;
  const g0 = ground[0].elevationM;
  const g1 = ground[ground.length - 1].elevationM;
  const list: Support[] = [{ distanceM: 0, cableElevationM: g0 + type.stationHeightM, groundElevationM: g0, kind: 'station' }];
  for (const t of [...towers].sort((x, y) => x.distanceM - y.distanceM)) {
    if (t.distanceM <= 0 || t.distanceM >= length) continue;
    const g = groundAt(ground, t.distanceM);
    list.push({ distanceM: t.distanceM, cableElevationM: g + t.heightM, groundElevationM: g, kind: 'tower' });
  }
  list.push({ distanceM: length, cableElevationM: g1 + type.stationHeightM, groundElevationM: g1, kind: 'station' });
  return list;
}

/** Czy wyciąg ma linę na podporach (taśma leży na ziemi – nie ma). */
export function hasCable(type: LiftType): boolean {
  return type.towerMaxHeightM > 0;
}

/** Najgorszy niedobór prześwitu w przęśle [m] (dodatni = za nisko) i jego miejsce. */
function worstDeficit(ground: GroundSample[], supports: Support[], i: number, type: LiftType, c: LiftCommonParams): { deficitM: number; atM: number } {
  const a = supports[i];
  const b = supports[i + 1];
  const length = ground[ground.length - 1].distanceM;
  let worst = { deficitM: -Infinity, atM: (a.distanceM + b.distanceM) / 2 };
  for (const g of ground) {
    if (g.distanceM <= a.distanceM || g.distanceM >= b.distanceM) continue;
    if (g.distanceM < c.stationApproachM || g.distanceM > length - c.stationApproachM) continue;
    const clearance = cableElevationAt(supports, g.distanceM, c.cableSagRatio) - g.elevationM;
    const deficit = type.minClearanceM - clearance;
    if (deficit > worst.deficitM) worst = { deficitM: deficit, atM: g.distanceM };
  }
  return worst;
}

/**
 * Automatyczne rozstawienie podpór: przęsła nie dłuższe niż maxSpanM, w każdym przęśle prześwit
 * ≥ minClearanceM. Najpierw podnosimy sąsiednie podpory (do towerMaxHeightM), a gdy to nie wystarcza,
 * dzielimy przęsło nową podporą w miejscu największego niedoboru.
 */
export function autoPlaceTowers(ground: GroundSample[], type: LiftType, c: LiftCommonParams): Tower[] {
  if (!hasCable(type)) return [];
  const length = ground[ground.length - 1].distanceM;
  const towers: Tower[] = [];
  const baseHeight = Math.min(type.towerMaxHeightM, Math.max(type.towerMinHeightM, type.minClearanceM + c.towerMarginM));
  for (let iter = 0; iter < 2000; iter++) {
    const supports = makeSupports(ground, type, towers);
    let changed = false;
    for (let i = 0; i < supports.length - 1 && !changed; i++) {
      const a = supports[i];
      const b = supports[i + 1];
      const span = b.distanceM - a.distanceM;
      if (span > type.maxSpanM) {
        const d = (a.distanceM + b.distanceM) / 2;
        towers.push({ distanceM: d, heightM: baseHeight });
        changed = true;
        break;
      }
      const w = worstDeficit(ground, supports, i, type, c);
      if (w.deficitM <= 1e-6) continue;
      // 1) podnieś podpory na końcach przęsła (proporcjonalnie do odległości od miejsca niedoboru)
      const t = (w.atM - a.distanceM) / span;
      let raised = false;
      for (const [support, weight] of [
        [a, 1 - t],
        [b, t],
      ] as const) {
        if (support.kind !== 'tower' || weight <= 0.05) continue;
        const tower = towers.find((x) => Math.abs(x.distanceM - support.distanceM) < 1e-6)!;
        const add = Math.min(type.towerMaxHeightM - tower.heightM, w.deficitM / weight + 0.1);
        if (add > 0.05) {
          tower.heightM += add;
          raised = true;
        }
      }
      if (raised) {
        changed = true;
        break;
      }
      // 2) nowa podpora w miejscu niedoboru (jeśli przęsło da się jeszcze podzielić)
      const d = Math.min(Math.max(w.atM, a.distanceM + c.minSpanM), b.distanceM - c.minSpanM);
      if (b.distanceM - a.distanceM >= 2 * c.minSpanM && d > 0 && d < length) {
        towers.push({ distanceM: d, heightM: Math.min(type.towerMaxHeightM, Math.max(baseHeight, w.deficitM + type.minClearanceM)) });
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return towers.sort((x, y) => x.distanceM - y.distanceM).map((t) => ({ distanceM: Math.round(t.distanceM * 10) / 10, heightM: Math.round(t.heightM * 10) / 10 }));
}

/** Przecięcie odcinków p1–p2 i p3–p4 (płasko). */
export function segmentsIntersect(p1: PointM, p2: PointM, p3: PointM, p4: PointM): boolean {
  const d = (a: PointM, b: PointM, c: PointM) => (b.xM - a.xM) * (c.yM - a.yM) - (b.yM - a.yM) * (c.xM - a.xM);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Pas o szerokości `widthM` wokół odcinka a–b: komórki siatki, których środki leżą w pasie. */
export function corridorCells(grid: TerrainGrid, a: PointM, b: PointM, widthM: number): number[] {
  const half = widthM / 2;
  const out: number[] = [];
  if (half <= 0) return out;
  const cs = grid.cellSizeM;
  const i0 = Math.max(0, Math.floor((Math.min(a.xM, b.xM) - half) / cs));
  const i1 = Math.min(grid.widthCells - 1, Math.floor((Math.max(a.xM, b.xM) + half) / cs));
  const j0 = Math.max(0, Math.floor((Math.min(a.yM, b.yM) - half) / cs));
  const j1 = Math.min(grid.heightCells - 1, Math.floor((Math.max(a.yM, b.yM) + half) / cs));
  const dx = b.xM - a.xM;
  const dy = b.yM - a.yM;
  const len2 = dx * dx + dy * dy || 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * cs;
      const y = (j + 0.5) * cs;
      const t = Math.min(1, Math.max(0, ((x - a.xM) * dx + (y - a.yM) * dy) / len2));
      if (Math.hypot(x - a.xM - t * dx, y - a.yM - t * dy) <= half) out.push(grid.index(i, j));
    }
  }
  return out;
}

/** Średnia z okna długości ~windowM (próbki co stepM) – max wartości bezwzględnej i jej miejsce. */
function maxWindowed(values: number[], distances: number[], windowM: number): { value: number; atM: number } {
  let best = { value: 0, atM: 0 };
  const n = values.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    let k = 0;
    for (let j = i; j < n && distances[j] - distances[i] <= windowM + 1e-6; j++) {
      if (Number.isNaN(values[j])) continue;
      s += values[j];
      k++;
    }
    if (k === 0) continue;
    const v = Math.abs(s / k);
    if (v > best.value) best = { value: v, atM: (distances[i] + distances[Math.min(n - 1, i + k - 1)]) / 2 };
  }
  return best;
}

export interface LiftContext {
  grid: TerrainGrid;
  params: LiftParams;
  /** Udział lasu i kosodrzewiny 0–1 (pierwotny – przed wycinką) – do kosztu wycinki; może być null. */
  forest: Float32Array | null;
  shrub: Float32Array | null;
  clearingCost: { forestCostPlnPerM2: number; shrubCostPlnPerM2: number; daysPerHectare: number };
  /** Inne wyciągi ośrodka (do kontroli krzyżowania). */
  otherLifts: LiftDesign[];
}

const fmt0 = (x: number) => Math.round(x).toLocaleString('pl-PL');

/** Odstęp krzesełek na linie [m]: prędkość × miejsca / przepustowość (0 – ruch ciągły). */
export function carrierSpacingM(type: LiftType): number {
  return type.carrierSeats > 0 ? (type.speedMs * 3600 * type.carrierSeats) / type.capacityPerHour : 0;
}

/** Pełna analiza wyciągu: profil, lina, ostrzeżenia, liczby. */
export function analyzeLift(design: LiftDesign, ctx: LiftContext): LiftAnalysis {
  const { grid, params } = ctx;
  const c = params.common;
  const type = liftTypeById(params, design.typeId);
  const ground = sampleGroundAlong(grid, design.bottom, design.top, c.profileStepM);
  const issues: BuildIssue[] = [];
  const length = ground[ground.length - 1].distanceM;
  const outside = ground.find((g) => Number.isNaN(g.elevationM));
  const valid = !outside;
  if (outside) issues.push({ severity: 'error', message: `linia wychodzi poza mapę (granica państwa) ${fmt0(outside.distanceM)} m od dolnej stacji`, distanceM: outside.distanceM });
  if (length < c.minLengthM) issues.push({ severity: 'error', message: `za krótki: ${fmt0(length)} m, najmniej ${fmt0(c.minLengthM)} m`, distanceM: null });
  if (length > type.maxLengthM) issues.push({ severity: 'error', message: `za długi na ${type.name.toLowerCase()}: ${fmt0(length)} m, najwięcej ${fmt0(type.maxLengthM)} m`, distanceM: null });
  for (const other of ctx.otherLifts) {
    if (other.id === design.id) continue;
    if (segmentsIntersect(design.bottom, design.top, other.bottom, other.top)) {
      issues.push({ severity: 'error', message: `krzyżuje się z wyciągiem „${other.name}”`, distanceM: null });
    }
  }
  // Teren poza mapą: liczymy, ile się da, na wartościach skończonych.
  const safeGround = valid ? ground : ground.map((g) => ({ ...g, elevationM: Number.isNaN(g.elevationM) ? 0 : g.elevationM }));
  const riseM = safeGround[safeGround.length - 1].elevationM - safeGround[0].elevationM;
  if (valid && riseM < 0) issues.push({ severity: 'error', message: `górna stacja leży ${fmt0(-riseM)} m niżej niż dolna – rysuj od dołu do góry`, distanceM: null });

  const towers = hasCable(type) ? design.towers : [];
  const supports = makeSupports(safeGround, type, towers);
  const cable = new Float64Array(ground.length);
  let minClearance = Infinity;
  let minClearanceAt = 0;
  let slopeLength = 0;
  for (let k = 0; k < ground.length; k++) {
    const d = ground[k].distanceM;
    cable[k] = hasCable(type) ? cableElevationAt(supports, d, c.cableSagRatio) : safeGround[k].elevationM;
    if (k > 0) slopeLength += Math.hypot(d - ground[k - 1].distanceM, cable[k] - cable[k - 1]);
    if (hasCable(type) && d >= c.stationApproachM && d <= length - c.stationApproachM) {
      const cl = cable[k] - safeGround[k].elevationM;
      if (cl < minClearance) {
        minClearance = cl;
        minClearanceAt = d;
      }
    }
  }
  if (hasCable(type) && valid && minClearance < type.minClearanceM - 0.05) {
    issues.push({ severity: 'error', message: `za mały prześwit: ${minClearance.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} m na ${fmt0(minClearanceAt)} m od dolnej stacji, wymagane ${fmt0(type.minClearanceM)} m`, distanceM: minClearanceAt });
  }
  for (const t of towers) {
    if (t.heightM > type.towerMaxHeightM + 0.05 || t.heightM < type.towerMinHeightM - 0.05) {
      issues.push({ severity: 'warning', message: `podpora na ${fmt0(t.distanceM)} m ma ${fmt0(t.heightM)} m wysokości – dla tego typu ${fmt0(type.towerMinHeightM)}–${fmt0(type.towerMaxHeightM)} m`, distanceM: t.distanceM });
    }
  }
  for (let i = 0; i < supports.length - 1; i++) {
    const span = supports[i + 1].distanceM - supports[i].distanceM;
    if (hasCable(type) && span > type.maxSpanM + 0.5) issues.push({ severity: 'warning', message: `przęsło ${fmt0(span)} m dłuższe niż ${fmt0(type.maxSpanM)} m (${fmt0(supports[i].distanceM)}–${fmt0(supports[i + 1].distanceM)} m)`, distanceM: (supports[i].distanceM + supports[i + 1].distanceM) / 2 });
  }

  // Wyciągi powierzchniowe: nachylenie i przechył toru (średnio na odcinkach slopeWindowM).
  let maxTrack: number | null = null;
  let maxCross: number | null = null;
  if (type.kind === 'surface' && valid && ground.length > 1) {
    const dist = ground.map((g) => g.distanceM);
    const along: number[] = [];
    const cross: number[] = [];
    const bearing = Math.atan2(design.top.xM - design.bottom.xM, -(design.top.yM - design.bottom.yM)); // od północy, zgodnie z ruchem wskazówek
    for (let k = 0; k < ground.length; k++) {
      const k1 = Math.min(ground.length - 1, k + 1);
      const k0 = k1 - 1;
      along.push((100 * (ground[k1].elevationM - ground[k0].elevationM)) / (ground[k1].distanceM - ground[k0].distanceM || 1));
      const slope = grid.sampleLayer(grid.slopePercent, ground[k].xM, ground[k].yM);
      const aspect = grid.sampleLayer(grid.aspectDeg, ground[k].xM, ground[k].yM);
      cross.push(Number.isNaN(aspect) || Number.isNaN(slope) ? 0 : slope * Math.abs(Math.sin((aspect * Math.PI) / 180 - bearing)));
    }
    const t = maxWindowed(along, dist, c.slopeWindowM);
    const x = maxWindowed(cross, dist, c.slopeWindowM);
    maxTrack = t.value;
    maxCross = x.value;
    if (type.maxTrackSlopePercent !== null && t.value > type.maxTrackSlopePercent) {
      issues.push({ severity: 'error', message: `za stromo na ${type.name.toLowerCase()}: ${fmt0(t.value)} % na ${fmt0(t.atM)} m od dolnej stacji, dopuszczalne ${fmt0(type.maxTrackSlopePercent)} %`, distanceM: t.atM });
    }
    if (type.maxCrossSlopePercent !== null && x.value > type.maxCrossSlopePercent) {
      issues.push({ severity: 'error', message: `za duży przechył toru: ${fmt0(x.value)} % na ${fmt0(x.atM)} m od dolnej stacji, dopuszczalne ${fmt0(type.maxCrossSlopePercent)} %`, distanceM: x.atM });
    }
  }

  // Moc: podnoszenie ludzi przy pełnej przepustowości + opory + bieg jałowy.
  const g = 9.81;
  const liftKw = (type.capacityPerHour / 3600) * c.passengerMassKg * g * Math.max(0, riseM) / c.driveEfficiency / 1000;
  const powerKw = liftKw + type.baseLoadKw + (type.frictionKwPer100m * length) / 100;

  // Koszt i czas budowy (wycinka – las pierwotny w pasie pod linią).
  let clearForestM2 = 0;
  let clearShrubM2 = 0;
  if (ctx.forest && type.corridorWidthM > 0) {
    const cellM2 = grid.cellSizeM * grid.cellSizeM;
    for (const k of corridorCells(grid, design.bottom, design.top, type.corridorWidthM)) {
      clearForestM2 += ctx.forest[k] * cellM2;
      clearShrubM2 += (ctx.shrub?.[k] ?? 0) * cellM2;
    }
  }
  const clearingPln = clearForestM2 * ctx.clearingCost.forestCostPlnPerM2 + clearShrubM2 * ctx.clearingCost.shrubCostPlnPerM2;
  const cost = {
    stationsPln: type.stationCostPln,
    linePln: type.costPerMeterPln * slopeLength,
    towersPln: type.towerCostPln * towers.length,
    clearingPln,
    totalPln: 0,
  };
  cost.totalPln = cost.stationsPln + cost.linePln + cost.towersPln + cost.clearingPln;
  const buildDays = type.buildDaysBase + (type.buildDaysPer100m * length) / 100 + ((clearForestM2 + clearShrubM2) / 10_000) * ctx.clearingCost.daysPerHectare;

  return {
    type,
    ground,
    supports,
    cableElevationM: cable,
    horizontalLengthM: length,
    slopeLengthM: slopeLength,
    riseM,
    rideTimeS: slopeLength / type.speedMs,
    capacityPerHour: type.capacityPerHour,
    powerKw,
    minClearanceM: hasCable(type) ? minClearance : Number.NaN,
    minClearanceAtM: minClearanceAt,
    maxTrackSlopePercent: maxTrack,
    maxCrossSlopePercent: maxCross,
    towerCount: towers.length,
    cost,
    buildDays,
    issues,
    ok: !issues.some((i) => i.severity === 'error'),
  };
}

/** Nowy wyciąg z automatycznie rozstawionymi podporami. */
export function designLift(grid: TerrainGrid, params: LiftParams, id: string, typeId: string, name: string, bottom: PointM, top: PointM): LiftDesign {
  const type = liftTypeById(params, typeId);
  const ground = sampleGroundAlong(grid, bottom, top, params.common.profileStepM);
  const safe = ground.some((g) => Number.isNaN(g.elevationM)) ? ground.map((g) => ({ ...g, elevationM: Number.isNaN(g.elevationM) ? 0 : g.elevationM })) : ground;
  return { id, typeId, name, bottom, top, towers: autoPlaceTowers(safe, type, params.common), manualTowers: false };
}
