/**
 * Trasy zjazdowe: oś (punkty z szerokością) → obrys na siatce, klasyfikacja trudności wzdłuż
 * kierunku zjazdu, profil podłużny, statystyki, ostrzeżenia, koszt i czas budowy.
 *
 * Klasyfikacja: wysokość osi = średnia terenu w poprzek trasy; o kolorze decyduje najtrudniejszy
 * odcinek o długości segmentLengthM (50 m) – nachylenie, które utrzymuje się na całym odcinku
 * (najmniejsze z nachyleń kawałków po profileSegmentM). Krótszy stromy fragment nie zmienia koloru.
 * Progi w data/pistes.json.
 */
import type { BuildIssue, PointM } from './lifts';
import { readNumber, readSection } from './params';
import type { TerrainGrid } from './terrainGrid';

const FILE = 'data/pistes.json';

export interface PisteClass {
  id: string;
  name: string;
  color: string;
  /** Górna granica [%] (włącznie); Infinity dla ostatniej. */
  maxSlopePercent: number;
}

export interface PisteParams {
  classes: PisteClass[];
  segmentLengthM: number;
  axisStepM: number;
  widthSamples: number;
  crossSlopeWarningPercent: number;
  uphillWarningPercent: number;
  profileSegmentM: number;
  defaultWidthM: number;
  minWidthM: number;
  maxWidthM: number;
  brushPointSpacingM: number;
  gradingCostPlnPerM2: number;
  gradingDaysPerHectare: number;
  buildDaysBase: number;
  stationRadiusM: number;
  baseRadiusM: number;
  junctionToleranceM: number;
  osmPisteWidthM: number;
  osmChainToleranceM: number;
  osmDifficultyToClass: Record<string, string>;
}

export function parsePisteParams(raw: unknown): PisteParams {
  const list = (raw as { classes?: unknown }).classes;
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${FILE}: brak listy „classes”`);
  const classes: PisteClass[] = list.map((e: Record<string, unknown>, n) => {
    if (typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.color !== 'string') throw new Error(`${FILE}: klasa ${n + 1} bez id, nazwy lub koloru`);
    return { id: e.id, name: e.name, color: e.color, maxSlopePercent: n === list.length - 1 ? Infinity : readNumber(e, 'maxSlopePercent', FILE, { min: 0 }) };
  });
  const c = readSection(raw, 'classification', FILE);
  const d = readSection(raw, 'drawing', FILE);
  const k = readSection(raw, 'costs', FILE);
  const net = readSection(raw, 'network', FILE);
  const osm = readSection(raw, 'osmComparison', FILE);
  const n = (s: Record<string, unknown>, key: string, o: { min?: number; max?: number; integer?: boolean } = {}) => readNumber(s, key, FILE, o);
  const map = osm.difficultyToClass;
  if (typeof map !== 'object' || map === null) throw new Error(`${FILE}: brak osmComparison.difficultyToClass`);
  return {
    classes,
    segmentLengthM: n(c, 'segmentLengthM', { min: 1 }),
    axisStepM: n(c, 'axisStepM', { min: 0.5 }),
    widthSamples: n(c, 'widthSamples', { min: 1, integer: true }),
    crossSlopeWarningPercent: n(c, 'crossSlopeWarningPercent', { min: 0 }),
    uphillWarningPercent: n(c, 'uphillWarningPercent', { min: 0 }),
    profileSegmentM: n(c, 'profileSegmentM', { min: 1 }),
    defaultWidthM: n(d, 'defaultWidthM', { min: 1 }),
    minWidthM: n(d, 'minWidthM', { min: 1 }),
    maxWidthM: n(d, 'maxWidthM', { min: 1 }),
    brushPointSpacingM: n(d, 'brushPointSpacingM', { min: 1 }),
    gradingCostPlnPerM2: n(k, 'gradingCostPlnPerM2', { min: 0 }),
    gradingDaysPerHectare: n(k, 'gradingDaysPerHectare', { min: 0 }),
    buildDaysBase: n(k, 'buildDaysBase', { min: 0 }),
    stationRadiusM: n(net, 'stationRadiusM', { min: 0 }),
    baseRadiusM: n(net, 'baseRadiusM', { min: 0 }),
    junctionToleranceM: n(net, 'junctionToleranceM', { min: 0 }),
    osmPisteWidthM: n(osm, 'pisteWidthM', { min: 1 }),
    osmChainToleranceM: n(osm, 'chainToleranceM', { min: 0 }),
    osmDifficultyToClass: map as Record<string, string>,
  };
}

/** Indeks klasy dla nachylenia [%] (wartość bezwzględna). */
export function pisteClassIndex(slopePercent: number, classes: PisteClass[]): number {
  const s = Math.abs(slopePercent);
  for (let i = 0; i < classes.length; i++) if (s <= classes[i].maxSlopePercent) return i;
  return classes.length - 1;
}

export interface AxisPoint extends PointM {
  widthM: number;
}

/** Trasa zapisana w układzie ośrodka: oś (od góry do dołu po analizie) z szerokością w punktach. */
export interface PisteDesign {
  id: string;
  name: string;
  points: AxisPoint[];
  /** Trasa zamknięta (goście nią nie jeżdżą). */
  closed?: boolean;
}

export interface AxisSample extends PointM {
  distanceM: number;
  widthM: number;
  /** Średnia wysokość terenu w poprzek trasy; NaN poza mapą. */
  elevationM: number;
  /** Spadek poprzeczny terenu [%] (średnio w poprzek). */
  crossSlopePercent: number;
}

export interface PisteProfileSegment {
  fromM: number;
  toM: number;
  /** Nachylenie w dół [%] (dodatnie = zjazd). */
  slopePercent: number;
  classIndex: number;
}

export interface PisteAnalysis {
  /** Oś zorientowana w kierunku zjazdu (od góry). */
  axis: AxisSample[];
  reversed: boolean;
  cells: number[];
  lengthM: number;
  surfaceLengthM: number;
  dropM: number;
  topElevationM: number;
  bottomElevationM: number;
  /** Nachylenie utrzymujące się na najtrudniejszym odcinku segmentLengthM i jego miejsce (środek odcinka). */
  maxSlopePercent: number;
  maxSlopeAtM: number;
  meanSlopePercent: number;
  /** Największe nachylenie lokalne (odcinki profileSegmentM) – informacyjnie. */
  maxLocalSlopePercent: number;
  maxCrossSlopePercent: number;
  maxCrossSlopeAtM: number;
  minWidthM: number;
  meanWidthM: number;
  areaM2: number;
  classIndex: number;
  profile: PisteProfileSegment[];
  cost: { gradingPln: number; clearingPln: number; totalPln: number };
  buildDays: number;
  issues: BuildIssue[];
  ok: boolean;
}

/** Oś przepróbkowana co `stepM` (szerokość interpolowana liniowo). */
export function resampleAxis(points: AxisPoint[], stepM: number): (AxisPoint & { distanceM: number; dirX: number; dirY: number })[] {
  const out: (AxisPoint & { distanceM: number; dirX: number; dirY: number })[] = [];
  if (points.length === 0) return out;
  if (points.length === 1) return [{ ...points[0], distanceM: 0, dirX: 0, dirY: 1 }];
  let total = 0;
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].xM - points[i - 1].xM, points[i].yM - points[i - 1].yM);
    cum.push(total);
  }
  const n = Math.max(1, Math.ceil(total / stepM));
  let seg = 0;
  for (let s = 0; s <= n; s++) {
    const d = (s / n) * total;
    while (seg < points.length - 2 && cum[seg + 1] < d) seg++;
    const a = points[seg];
    const b = points[seg + 1];
    const len = cum[seg + 1] - cum[seg] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[seg]) / len));
    out.push({
      xM: a.xM + t * (b.xM - a.xM),
      yM: a.yM + t * (b.yM - a.yM),
      widthM: a.widthM + t * (b.widthM - a.widthM),
      distanceM: d,
      dirX: (b.xM - a.xM) / len,
      dirY: (b.yM - a.yM) / len,
    });
  }
  return out;
}

/** Komórki siatki w obrysie trasy (środek komórki bliżej osi niż połowa szerokości). */
export function pisteCells(grid: TerrainGrid, points: AxisPoint[]): number[] {
  const cs = grid.cellSizeM;
  const set = new Set<number>();
  const segs = points.length === 1 ? [[points[0], points[0]] as const] : points.slice(1).map((p, i) => [points[i], p] as const);
  for (const [a, b] of segs) {
    const half = Math.max(a.widthM, b.widthM) / 2;
    const i0 = Math.max(0, Math.floor((Math.min(a.xM, b.xM) - half) / cs));
    const i1 = Math.min(grid.widthCells - 1, Math.floor((Math.max(a.xM, b.xM) + half) / cs));
    const j0 = Math.max(0, Math.floor((Math.min(a.yM, b.yM) - half) / cs));
    const j1 = Math.min(grid.heightCells - 1, Math.floor((Math.max(a.yM, b.yM) + half) / cs));
    const dx = b.xM - a.xM;
    const dy = b.yM - a.yM;
    const len2 = dx * dx + dy * dy;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * cs;
        const y = (j + 0.5) * cs;
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.xM) * dx + (y - a.yM) * dy) / len2)) : 0;
        const w = a.widthM + t * (b.widthM - a.widthM);
        if (Math.hypot(x - a.xM - t * dx, y - a.yM - t * dy) <= w / 2) set.add(grid.index(i, j));
      }
    }
  }
  return [...set];
}

/** Próbki osi: wysokość średnia w poprzek trasy i spadek poprzeczny terenu. */
export function sampleAxis(grid: TerrainGrid, points: AxisPoint[], p: PisteParams): AxisSample[] {
  const rs = resampleAxis(points, p.axisStepM);
  return rs.map((r) => {
    const nx = -r.dirY;
    const ny = r.dirX;
    let sum = 0;
    let cnt = 0;
    let cross = 0;
    let crossCnt = 0;
    let outside = false;
    const bearing = Math.atan2(r.dirX, -r.dirY);
    for (let s = 0; s < p.widthSamples; s++) {
      const off = p.widthSamples === 1 ? 0 : (s / (p.widthSamples - 1) - 0.5) * r.widthM;
      const x = r.xM + nx * off;
      const y = r.yM + ny * off;
      const h = grid.sampleElevationM(x, y);
      if (Number.isNaN(h)) {
        if (off === 0 || p.widthSamples === 1) outside = true;
        continue;
      }
      sum += h;
      cnt++;
      const slope = grid.sampleLayer(grid.slopePercent, x, y);
      const aspect = grid.sampleLayer(grid.aspectDeg, x, y);
      if (!Number.isNaN(slope) && !Number.isNaN(aspect)) {
        cross += slope * Math.abs(Math.sin((aspect * Math.PI) / 180 - bearing));
        crossCnt++;
      }
    }
    return {
      xM: r.xM,
      yM: r.yM,
      distanceM: r.distanceM,
      widthM: r.widthM,
      elevationM: outside || cnt === 0 ? Number.NaN : sum / cnt,
      crossSlopePercent: crossCnt ? cross / crossCnt : 0,
    };
  });
}

/**
 * Najtrudniejszy odcinek o długości ≥ segmentLengthM: największe nachylenie, które utrzymuje się
 * na całym odcinku tej długości (minimum nachyleń lokalnych na kawałkach localStepM w oknie).
 * Krótszy stromy fragment nie podnosi wyniku. Zwraca nachylenie w dół [%] i miejsce (środek okna).
 */
export function hardestSegment(
  axis: { distanceM: number; elevationM: number }[],
  segmentLengthM: number,
  localStepM = 10,
): { slopePercent: number; atM: number; uphillPercent: number } {
  const n = axis.length;
  const total = axis[n - 1].distanceM - axis[0].distanceM;
  if (n < 2) return { slopePercent: 0, atM: 0, uphillPercent: 0 };
  if (total <= segmentLengthM) {
    const s = total > 0 ? (100 * (axis[0].elevationM - axis[n - 1].elevationM)) / total : 0;
    return { slopePercent: Math.max(0, s), atM: total / 2, uphillPercent: Math.max(0, -s) };
  }
  // Nachylenia lokalne na kawałkach ~localStepM.
  const pieces: { from: number; to: number; slope: number }[] = [];
  for (let i = 0; i < n - 1; ) {
    let j = i + 1;
    while (j < n - 1 && axis[j].distanceM - axis[i].distanceM < localStepM - 1e-6) j++;
    const dl = axis[j].distanceM - axis[i].distanceM || 1;
    pieces.push({ from: axis[i].distanceM, to: axis[j].distanceM, slope: (100 * (axis[i].elevationM - axis[j].elevationM)) / dl });
    i = j;
  }
  let best = { slopePercent: 0, atM: 0, uphillPercent: 0 };
  for (let i = 0; i < pieces.length; i++) {
    let minSlope = Infinity;
    let maxSlope = -Infinity;
    let j = i;
    for (; j < pieces.length; j++) {
      minSlope = Math.min(minSlope, pieces[j].slope);
      maxSlope = Math.max(maxSlope, pieces[j].slope);
      if (pieces[j].to - pieces[i].from >= segmentLengthM - 1e-6) break;
    }
    if (j >= pieces.length) break;
    if (minSlope > best.slopePercent) best = { ...best, slopePercent: minSlope, atM: (pieces[i].from + pieces[j].to) / 2 };
    if (-maxSlope > best.uphillPercent) best.uphillPercent = -maxSlope;
  }
  return best;
}

export interface PisteContext {
  grid: TerrainGrid;
  params: PisteParams;
  forest: Float32Array | null;
  shrub: Float32Array | null;
  clearingCost: { forestCostPlnPerM2: number; shrubCostPlnPerM2: number; daysPerHectare: number };
}

const fmt0 = (x: number) => Math.round(x).toLocaleString('pl-PL');

/** Oś trasy zorientowana w dół (jeśli rysowano od dołu – odwracamy). */
export function orientDownhill(grid: TerrainGrid, points: AxisPoint[]): { points: AxisPoint[]; reversed: boolean } {
  if (points.length < 2) return { points, reversed: false };
  const h0 = grid.sampleElevationM(points[0].xM, points[0].yM);
  const h1 = grid.sampleElevationM(points[points.length - 1].xM, points[points.length - 1].yM);
  if (!Number.isNaN(h0) && !Number.isNaN(h1) && h1 > h0) return { points: [...points].reverse(), reversed: true };
  return { points, reversed: false };
}

export function analyzePiste(design: PisteDesign, ctx: PisteContext): PisteAnalysis {
  const { grid, params: p } = ctx;
  const { points, reversed } = orientDownhill(grid, design.points);
  const issues: BuildIssue[] = [];
  const axis = sampleAxis(grid, points, p);
  const outside = axis.find((a) => Number.isNaN(a.elevationM));
  if (outside) issues.push({ severity: 'error', message: `trasa wychodzi poza mapę (granica państwa) ${fmt0(outside.distanceM)} m od początku`, distanceM: outside.distanceM });
  const valid = axis.filter((a) => !Number.isNaN(a.elevationM));
  const lengthM = axis[axis.length - 1]?.distanceM ?? 0;
  if (valid.length < 2 || lengthM < p.axisStepM) {
    issues.push({ severity: 'error', message: 'trasa za krótka', distanceM: null });
  }
  const top = valid[0]?.elevationM ?? Number.NaN;
  const bottom = valid[valid.length - 1]?.elevationM ?? Number.NaN;
  const hard = valid.length >= 2 ? hardestSegment(valid, p.segmentLengthM, p.profileSegmentM) : { slopePercent: 0, atM: 0, uphillPercent: 0 };
  const classIndex = pisteClassIndex(hard.slopePercent, p.classes);
  if (hard.uphillPercent > p.uphillWarningPercent) issues.push({ severity: 'warning', message: `odcinek pod górę: ${fmt0(hard.uphillPercent)} % na ${fmt0(p.segmentLengthM)} m – narciarze będą musieli podchodzić`, distanceM: null });

  // Profil: odcinki profileSegmentM kolorowane nachyleniem.
  const profile: PisteProfileSegment[] = [];
  let maxLocal = 0;
  let surface = 0;
  for (let i = 0; i < valid.length - 1; ) {
    let j = i + 1;
    while (j < valid.length - 1 && valid[j].distanceM - valid[i].distanceM < p.profileSegmentM - 1e-6) j++;
    const dl = valid[j].distanceM - valid[i].distanceM || 1;
    const s = (100 * (valid[i].elevationM - valid[j].elevationM)) / dl;
    profile.push({ fromM: valid[i].distanceM, toM: valid[j].distanceM, slopePercent: s, classIndex: pisteClassIndex(Math.max(0, s), p.classes) });
    if (Math.abs(s) > maxLocal) maxLocal = Math.abs(s);
    surface += Math.hypot(dl, valid[i].elevationM - valid[j].elevationM);
    i = j;
  }
  // Spadek poprzeczny – średnio na odcinkach segmentLengthM.
  let maxCross = 0;
  let maxCrossAt = 0;
  for (let i = 0; i < valid.length; i++) {
    let s = 0;
    let k = 0;
    for (let j = i; j < valid.length && valid[j].distanceM - valid[i].distanceM <= p.segmentLengthM; j++) {
      s += valid[j].crossSlopePercent;
      k++;
    }
    if (k && s / k > maxCross) {
      maxCross = s / k;
      maxCrossAt = valid[i].distanceM + p.segmentLengthM / 2;
    }
  }
  if (maxCross > p.crossSlopeWarningPercent) {
    issues.push({ severity: 'warning', message: `duży spadek poprzeczny: ${fmt0(maxCross)} % na ${fmt0(maxCrossAt)} m od początku (trawers; ostrzeżenie powyżej ${fmt0(p.crossSlopeWarningPercent)} %)`, distanceM: maxCrossAt });
  }
  const widths = points.map((q) => q.widthM);
  const cells = pisteCells(grid, points).filter((k) => !Number.isNaN(grid.elevationM[k]));
  const cellM2 = grid.cellSizeM * grid.cellSizeM;
  let forestM2 = 0;
  let shrubM2 = 0;
  for (const k of cells) {
    forestM2 += (ctx.forest?.[k] ?? 0) * cellM2;
    shrubM2 += (ctx.shrub?.[k] ?? 0) * cellM2;
  }
  const areaM2 = cells.length * cellM2;
  const clearingPln = forestM2 * ctx.clearingCost.forestCostPlnPerM2 + shrubM2 * ctx.clearingCost.shrubCostPlnPerM2;
  const gradingPln = areaM2 * p.gradingCostPlnPerM2;
  const dropM = top - bottom;
  return {
    axis,
    reversed,
    cells,
    lengthM,
    surfaceLengthM: surface,
    dropM,
    topElevationM: top,
    bottomElevationM: bottom,
    maxSlopePercent: hard.slopePercent,
    maxSlopeAtM: hard.atM,
    meanSlopePercent: lengthM > 0 ? (100 * dropM) / lengthM : 0,
    maxLocalSlopePercent: maxLocal,
    maxCrossSlopePercent: maxCross,
    maxCrossSlopeAtM: maxCrossAt,
    minWidthM: Math.min(...widths),
    meanWidthM: widths.reduce((a, b) => a + b, 0) / widths.length,
    areaM2,
    classIndex,
    profile,
    cost: { gradingPln, clearingPln, totalPln: gradingPln + clearingPln },
    buildDays: p.buildDaysBase + (areaM2 / 10_000) * p.gradingDaysPerHectare + ((forestM2 + shrubM2) / 10_000) * ctx.clearingCost.daysPerHectare,
    issues,
    ok: !issues.some((i) => i.severity === 'error'),
  };
}
