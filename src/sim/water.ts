/**
 * Woda do naśnieżania (etap 6b): sieć cieków i przepływy, ujęcia ze wspólnym limitem poboru,
 * połączenia źródeł ze zbiornikiem (rury zasilające), wodociąg, studnie głębinowe, rowy zbierające
 * spływ ze zlewni zbiornika. Bez DOM – ta sama logika w grze, w testach i bez grafiki.
 *
 * Cieki: spływ po spadkach z modelu terenu (wypełnianie zagłębień metodą „priority flood”, kierunek
 * do najniższego sąsiada spośród 8), powierzchnia zlewni każdej komórki; ciek tam, gdzie zlewnia
 * przekracza próg z data/water.json, a przede wszystkim linie z OpenStreetMap (waterway=stream).
 * Średni przepływ = zlewnia × opad roczny na średniej wysokości zlewni × współczynnik odpływu;
 * przepływ dnia = średni × rytm miesięczny (IMGW) × czynnik suszy (opad 30 dni wobec normy).
 */
import type { ClimateProfile } from './climate';
import type { PointM } from './lifts';
import { readNumber, readNumberArray, readSection } from './params';
import { Rng } from './rng';

const FILE = 'data/water.json';
const SECONDS_PER_YEAR = 365.25 * 86400;

export interface WaterParams {
  streams: {
    accumulationThresholdM2: number;
    osmDedupRadiusM: number;
    intakeMaxDistanceM: number;
    flowSearchRadiusM: number;
    runoffCoefficient: number;
    monthlyFactor: number[];
    lowFlowFactor: number;
    highFlowFactor: number;
    precipWindowDays: number;
    dryFactorMin: number;
    dryFactorMax: number;
    ecologicalFlowShare: number;
    maxWithdrawalShare: number;
    streamFeePlnPerM3: number;
  };
  supply: { directRadiusM: number; connectRadiusM: number };
  mains: { pricePlnPerM3: number; fixedPlnPerMonth: number; villageRadiusM: number; villageMinBuildings: number };
  wells: { medianYieldM3h: number; yieldSigma: number; depthExponent: number; dryProbability: number; dryYieldM3h: number; dynamicLevelShare: number; groundwaterFeePlnPerM3: number };
  catchment: { runoffCoefficient: number; searchRadiusM: number };
}

export function parseWaterParams(raw: unknown): WaterParams {
  const s = readSection(raw, 'streams', FILE);
  const su = readSection(raw, 'supply', FILE);
  const m = readSection(raw, 'mains', FILE);
  const w = readSection(raw, 'wells', FILE);
  const c = readSection(raw, 'catchment', FILE);
  const n = (sec: Record<string, unknown>, k: string) => readNumber(sec, k, FILE, { min: 0 });
  return {
    streams: {
      accumulationThresholdM2: n(s, 'accumulationThresholdM2'),
      osmDedupRadiusM: n(s, 'osmDedupRadiusM'),
      intakeMaxDistanceM: n(s, 'intakeMaxDistanceM'),
      flowSearchRadiusM: n(s, 'flowSearchRadiusM'),
      runoffCoefficient: readNumber(s, 'runoffCoefficient', FILE, { min: 0, max: 1 }),
      monthlyFactor: readNumberArray(s, 'monthlyFactor', FILE, { length: 12, min: 0 }),
      lowFlowFactor: n(s, 'lowFlowFactor'),
      highFlowFactor: n(s, 'highFlowFactor'),
      precipWindowDays: n(s, 'precipWindowDays'),
      dryFactorMin: n(s, 'dryFactorMin'),
      dryFactorMax: n(s, 'dryFactorMax'),
      ecologicalFlowShare: readNumber(s, 'ecologicalFlowShare', FILE, { min: 0, max: 1 }),
      maxWithdrawalShare: readNumber(s, 'maxWithdrawalShare', FILE, { min: 0, max: 1 }),
      streamFeePlnPerM3: n(s, 'streamFeePlnPerM3'),
    },
    supply: { directRadiusM: n(su, 'directRadiusM'), connectRadiusM: n(su, 'connectRadiusM') },
    mains: { pricePlnPerM3: n(m, 'pricePlnPerM3'), fixedPlnPerMonth: n(m, 'fixedPlnPerMonth'), villageRadiusM: n(m, 'villageRadiusM'), villageMinBuildings: n(m, 'villageMinBuildings') },
    wells: {
      medianYieldM3h: n(w, 'medianYieldM3h'),
      yieldSigma: n(w, 'yieldSigma'),
      depthExponent: n(w, 'depthExponent'),
      dryProbability: readNumber(w, 'dryProbability', FILE, { min: 0, max: 1 }),
      dryYieldM3h: n(w, 'dryYieldM3h'),
      dynamicLevelShare: readNumber(w, 'dynamicLevelShare', FILE, { min: 0, max: 1 }),
      groundwaterFeePlnPerM3: n(w, 'groundwaterFeePlnPerM3'),
    },
    catchment: { runoffCoefficient: readNumber(c, 'runoffCoefficient', FILE, { min: 0, max: 1 }), searchRadiusM: n(c, 'searchRadiusM') },
  };
}

/** Opad roczny na wysokości z [mm] wg profilu klimatu (norma miesięczna × gradient z wysokością). */
export function annualPrecipitationMm(profile: ClimateProfile, elevationM: number): number {
  const p = profile.precipitation;
  const total = p.observedMonthlyTotalMm.reduce((a, b) => a + b, 0);
  return total * Math.max(0, 1 + (p.elevationGradientPercentPer100m / 100) * ((elevationM - p.referenceElevationM) / 100));
}

// ------------------------------------------------------------------ sieć cieków

export interface StreamGrid {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  /** Wysokość [m]; NaN – poza mapą. */
  elevationM: Float32Array;
}

export interface StreamLine {
  id: string;
  name: string;
  /** true – linia z OpenStreetMap; false – wyznaczona z modelu terenu. */
  osm: boolean;
  points: PointM[];
  /** Średni roczny przepływ w punktach linii [m³/s]. */
  meanFlowM3s: number[];
}

export interface StreamNet {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  /** Komórka, do której spływa woda (−1 – wypływ poza mapę). */
  down: Int32Array;
  /** Powierzchnia zlewni komórki (z nią samą) [m²]. */
  accM2: Float32Array;
  /** Średnia wysokość zlewni [m]. */
  meanZM: Float32Array;
  /** Średni roczny przepływ z komórki [m³/s]. */
  meanFlowM3s: Float32Array;
  lines: StreamLine[];
}

/** Kopiec minimalny na tablicach (wysokość, indeks) – do wypełniania zagłębień. */
class MinHeap {
  private z: Float64Array;
  private id: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.z = new Float64Array(cap);
    this.id = new Int32Array(cap);
  }
  push(z: number, id: number): void {
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.z[p] <= z) break;
      this.z[i] = this.z[p];
      this.id[i] = this.id[p];
      i = p;
    }
    this.z[i] = z;
    this.id[i] = id;
  }
  pop(): number {
    const top = this.id[0];
    const z = this.z[--this.size];
    const id = this.id[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.z[c + 1] < this.z[c]) c++;
      if (this.z[c] >= z) break;
      this.z[i] = this.z[c];
      this.id[i] = this.id[c];
      i = c;
    }
    this.z[i] = z;
    this.id[i] = id;
    return top;
  }
}

const DI = [1, 1, 0, -1, -1, -1, 0, 1];
const DJ = [0, 1, 1, 1, 0, -1, -1, -1];

export interface StreamNetInput {
  grid: StreamGrid;
  /** Linie cieków z OSM w lokalnych współrzędnych mapy [m]. */
  osm: { name: string; points: PointM[] }[];
  /** Opad roczny na wysokości z [mm]. */
  annualPrecipMm(zM: number): number;
  params: WaterParams;
}

export function buildStreamNet(input: StreamNetInput): StreamNet {
  const { grid, params: wp } = input;
  const W = grid.widthCells;
  const H = grid.heightCells;
  const N = W * H;
  const cs = grid.cellSizeM;
  const z = grid.elevationM;
  const down = new Int32Array(N).fill(-1);
  const filled = new Float64Array(N).fill(Number.NaN);
  const order = new Int32Array(N);
  let nOrder = 0;
  const seen = new Uint8Array(N);
  const heap = new MinHeap(N);
  // Wypływy: komórki na brzegu mapy i przy obszarze „poza mapą”.
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (Number.isNaN(z[k])) continue;
      let edge = i === 0 || j === 0 || i === W - 1 || j === H - 1;
      for (let d = 0; d < 8 && !edge; d++) {
        const ni = i + DI[d];
        const nj = j + DJ[d];
        if (Number.isNaN(z[nj * W + ni])) edge = true;
      }
      if (edge) {
        seen[k] = 1;
        filled[k] = z[k];
        heap.push(z[k], k);
      }
    }
  }
  // Wypełnianie zagłębień: komórka dostaje kierunek do sąsiada, z którego ją odkryto (najniższego).
  const eps = 1e-4;
  while (heap.size > 0) {
    const k = heap.pop();
    order[nOrder++] = k;
    const i = k % W;
    const j = (k - i) / W;
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d];
      const nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (seen[n] || Number.isNaN(z[n])) continue;
      seen[n] = 1;
      filled[n] = Math.max(z[n], filled[k] + eps);
      down[n] = k;
      heap.push(filled[n], n);
    }
  }
  // Zlewnie: od góry (odwrotna kolejność) w dół.
  const cellM2 = cs * cs;
  const accM2 = new Float32Array(N);
  const sumZ = new Float64Array(N);
  for (let o = 0; o < nOrder; o++) {
    const k = order[o];
    accM2[k] = cellM2;
    sumZ[k] = z[k] * cellM2;
  }
  for (let o = nOrder - 1; o >= 0; o--) {
    const k = order[o];
    const d = down[k];
    if (d >= 0) {
      accM2[d] += accM2[k];
      sumZ[d] += sumZ[k];
    }
  }
  const meanZM = new Float32Array(N).fill(Number.NaN);
  const meanFlowM3s = new Float32Array(N);
  const c = wp.streams.runoffCoefficient;
  for (let o = 0; o < nOrder; o++) {
    const k = order[o];
    meanZM[k] = sumZ[k] / accM2[k];
    meanFlowM3s[k] = (accM2[k] * (input.annualPrecipMm(meanZM[k]) / 1000) * c) / SECONDS_PER_YEAR;
  }
  const net: StreamNet = { widthCells: W, heightCells: H, cellSizeM: cs, down, accM2, meanZM, meanFlowM3s, lines: [] };

  // Linie z OSM (zagęszczone co 5 m, tylko na mapie) z przepływem z modelu terenu.
  const nearOsm = new Uint8Array(N);
  const rDedup = Math.ceil(wp.streams.osmDedupRadiusM / cs);
  let lineNo = 0;
  for (const l of input.osm) {
    const pts = densify(l.points, 5).filter((p) => {
      const k = cellIndex(net, p.xM, p.yM);
      return k >= 0 && !Number.isNaN(z[k]);
    });
    if (pts.length < 2) continue;
    const flows = pts.map((p) => {
      const k = thalwegCell(net, p.xM, p.yM, wp.streams.flowSearchRadiusM);
      return k >= 0 ? meanFlowM3s[k] : 0;
    });
    net.lines.push({ id: `osm${lineNo++}`, name: l.name || 'Potok bez nazwy', osm: true, points: pts, meanFlowM3s: flows });
    for (const p of pts) {
      const ci = Math.floor(p.xM / cs);
      const cj = Math.floor(p.yM / cs);
      for (let dj = -rDedup; dj <= rDedup; dj++) {
        for (let di = -rDedup; di <= rDedup; di++) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          if (Math.hypot((ni + 0.5) * cs - p.xM, (nj + 0.5) * cs - p.yM) <= wp.streams.osmDedupRadiusM) nearOsm[nj * W + ni] = 1;
        }
      }
    }
  }
  // Uzupełnienie z modelu terenu: cieki o zlewni ponad próg, poza miejscami pokrytymi przez OSM.
  const thr = wp.streams.accumulationThresholdM2;
  const isStream = (k: number) => k >= 0 && accM2[k] >= thr && !Number.isNaN(z[k]);
  const hasStreamUp = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (isStream(k) && down[k] >= 0) hasStreamUp[down[k]] = 1;
  const visited = new Uint8Array(N);
  let demNo = 0;
  const center = (k: number): PointM => ({ xM: ((k % W) + 0.5) * cs, yM: (Math.floor(k / W) + 0.5) * cs });
  // Odcinki zaczynają się u źródeł i przy wyjściu spod linii OSM.
  for (let o = nOrder - 1; o >= 0; o--) {
    const k0 = order[o];
    if (!isStream(k0) || nearOsm[k0] || visited[k0]) continue;
    const up = hasStreamUp[k0];
    if (up) {
      // Początek odcinka tylko tam, gdzie żaden ciek powyżej nie jest rysowany z modelu terenu.
      let fromDem = false;
      const i = k0 % W;
      const j = (k0 - i) / W;
      for (let d = 0; d < 8 && !fromDem; d++) {
        const ni = i + DI[d];
        const nj = j + DJ[d];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni;
        if (down[n] === k0 && isStream(n) && !nearOsm[n]) fromDem = true;
      }
      if (fromDem) continue;
    }
    const pts: PointM[] = [];
    const flows: number[] = [];
    let k = k0;
    while (k >= 0) {
      pts.push(center(k));
      flows.push(meanFlowM3s[k]);
      if (visited[k] || nearOsm[k] || !isStream(k)) break;
      visited[k] = 1;
      k = down[k];
    }
    if (pts.length >= 3) net.lines.push({ id: `dem${demNo++}`, name: 'Potok bez nazwy', osm: false, points: smooth(pts), meanFlowM3s: flows });
  }
  return net;
}

function densify(points: PointM[], stepM: number): PointM[] {
  const out: PointM[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const L = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    const n = Math.max(1, Math.ceil(L / stepM));
    for (let s = 0; s < n; s++) out.push({ xM: a.xM + ((b.xM - a.xM) * s) / n, yM: a.yM + ((b.yM - a.yM) * s) / n });
  }
  if (points.length) out.push(points[points.length - 1]);
  return out;
}

/** Wygładzenie łamanej po środkach komórek (jedna iteracja Chaikina, końce bez zmian). */
function smooth(pts: PointM[]): PointM[] {
  if (pts.length < 3) return pts;
  const out: PointM[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    out.push({ xM: 0.75 * a.xM + 0.25 * b.xM, yM: 0.75 * a.yM + 0.25 * b.yM }, { xM: 0.25 * a.xM + 0.75 * b.xM, yM: 0.25 * a.yM + 0.75 * b.yM });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function cellIndex(net: { widthCells: number; heightCells: number; cellSizeM: number }, xM: number, yM: number): number {
  const i = Math.floor(xM / net.cellSizeM);
  const j = Math.floor(yM / net.cellSizeM);
  if (i < 0 || j < 0 || i >= net.widthCells || j >= net.heightCells) return -1;
  return j * net.widthCells + i;
}

/** Komórka o największej zlewni w promieniu (dno doliny przy punkcie). */
export function thalwegCell(net: StreamNet, xM: number, yM: number, radiusM: number): number {
  const cs = net.cellSizeM;
  const r = Math.ceil(radiusM / cs);
  const ci = Math.floor(xM / cs);
  const cj = Math.floor(yM / cs);
  let best = -1;
  let bestA = -1;
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= net.widthCells || j >= net.heightCells) continue;
      if (Math.hypot((i + 0.5) * cs - xM, (j + 0.5) * cs - yM) > radiusM + cs * 0.5) continue;
      const k = j * net.widthCells + i;
      if (net.accM2[k] > bestA) {
        bestA = net.accM2[k];
        best = k;
      }
    }
  }
  return best;
}

export interface StreamHit {
  line: StreamLine;
  /** Odległość od linii [m]. */
  distanceM: number;
  /** Komórka dna doliny (do przepływu i zależności „w dół potoku”). */
  cell: number;
  meanFlowM3s: number;
}

/** Najbliższy ciek w promieniu (null – brak). */
export function streamAt(net: StreamNet, xM: number, yM: number, maxDistanceM: number, wp: WaterParams): StreamHit | null {
  let best: { line: StreamLine; d: number; p: PointM } | null = null;
  for (const l of net.lines) {
    for (let i = 1; i < l.points.length; i++) {
      const a = l.points[i - 1];
      const b = l.points[i];
      const dx = b.xM - a.xM;
      const dy = b.yM - a.yM;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((xM - a.xM) * dx + (yM - a.yM) * dy) / L2)) : 0;
      const p = { xM: a.xM + dx * t, yM: a.yM + dy * t };
      const d = Math.hypot(p.xM - xM, p.yM - yM);
      if (d <= maxDistanceM && (!best || d < best.d)) best = { line: l, d, p };
    }
  }
  if (!best) return null;
  const cell = thalwegCell(net, best.p.xM, best.p.yM, wp.streams.flowSearchRadiusM);
  return { line: best.line, distanceM: best.d, cell, meanFlowM3s: cell >= 0 ? net.meanFlowM3s[cell] : 0 };
}

// ------------------------------------------------------------------ przepływ dnia i limity poboru

/**
 * Czynnik przepływu dnia względem średniego rocznego: rytm miesięczny (IMGW) × czynnik suszy
 * (opad z ostatnich dni wobec normy z profilu klimatu), w granicach przepływu niskiego i wysokiego.
 */
export function flowFactor(month: number, precipLastMm: number, normalMm: number, wp: WaterParams): number {
  const s = wp.streams;
  const dry = normalMm > 0 ? Math.min(s.dryFactorMax, Math.max(s.dryFactorMin, precipLastMm / normalMm)) : 1;
  return Math.min(s.highFlowFactor, Math.max(s.lowFlowFactor, s.monthlyFactor[month - 1] * dry));
}

/** Norma opadu z profilu klimatu za `days` dni przed datą (miesiąc bieżący) [mm]. */
export function normalPrecipMm(profile: ClimateProfile, month: number, days: number): number {
  return (profile.precipitation.observedMonthlyTotalMm[month - 1] / 30.44) * days;
}

export interface IntakeInput {
  id: string;
  /** Komórka dna doliny przy ujęciu (−1 – ujęcie poza ciekiem). */
  cell: number;
  capacityM3h: number;
}

export interface IntakeAllocation {
  id: string;
  /** Przepływ potoku przy ujęciu dziś [m³/h]. */
  flowM3h: number;
  /** Ile wolno pobrać w tym miejscu (nadwyżka ponad przepływ nienaruszalny, najwyżej udział przepływu) [m³/h]. */
  availableM3h: number;
  /** Przydzielony pobór (z uwzględnieniem innych ujęć wyżej na tym samym potoku) [m³/h]. */
  allocatedM3h: number;
}

/**
 * Pobór z ujęć: każde najwyżej swoja wydajność; w każdym ujęciu suma poboru wszystkich ujęć powyżej
 * (na tym samym potoku i jego dopływach) i jego samego ≤ dostępne w tym miejscu. Ograniczenia
 * sprawdzane od góry potoku w dół; przy przekroczeniu pobór wszystkich ujęć powyżej zmniejszany
 * proporcjonalnie (zmniejszanie nie psuje warunków sprawdzonych wcześniej).
 */
export function allocateIntakes(net: StreamNet, intakes: IntakeInput[], factor: number, wp: WaterParams): IntakeAllocation[] {
  const s = wp.streams;
  const out: IntakeAllocation[] = intakes.map((it) => {
    if (it.cell < 0) return { id: it.id, flowM3h: 0, availableM3h: 0, allocatedM3h: 0 };
    const meanM3h = net.meanFlowM3s[it.cell] * 3600;
    const flow = meanM3h * factor;
    const available = Math.max(0, Math.min(s.maxWithdrawalShare * flow, flow - s.ecologicalFlowShare * meanM3h));
    return { id: it.id, flowM3h: flow, availableM3h: available, allocatedM3h: Math.max(0, it.capacityM3h) };
  });
  // Dla każdego ujęcia: zbiór komórek w dół potoku.
  const paths = intakes.map((it) => {
    const set = new Set<number>();
    let k = it.cell;
    let guard = 0;
    while (k >= 0 && guard++ < net.down.length) {
      set.add(k);
      k = net.down[k];
    }
    return set;
  });
  const order = intakes.map((_, i) => i).filter((i) => intakes[i].cell >= 0).sort((a, b) => net.accM2[intakes[a].cell] - net.accM2[intakes[b].cell]);
  for (const j of order) {
    const members = intakes.map((_, i) => i).filter((i) => intakes[i].cell >= 0 && paths[i].has(intakes[j].cell));
    const sum = members.reduce((a, i) => a + out[i].allocatedM3h, 0);
    if (sum > out[j].availableM3h + 1e-9) {
      const f = sum > 0 ? out[j].availableM3h / sum : 0;
      for (const i of members) out[i].allocatedM3h *= f;
    }
  }
  return out;
}

// ------------------------------------------------------------------ studnie, wodociąg, zlewnia

/** Wydajność studni [m³/h] – losowana z ziarnem gry i numerem studni (znana dopiero po wierceniu). */
export function wellYieldM3h(seed: number, wellId: string, depthM: number, wp: WaterParams): number {
  const rng = new Rng(seed).fork('studnia').fork(wellId);
  const w = wp.wells;
  if (rng.next() < w.dryProbability) return w.dryYieldM3h;
  return w.medianYieldM3h * Math.pow(Math.max(1, depthM) / 100, w.depthExponent) * Math.exp(w.yieldSigma * rng.normal());
}

/** Czy w tym miejscu jest sieć wodociągowa wsi (dość budynków w promieniu). */
export function villageCoverage(xM: number, yM: number, buildings: PointM[], wp: WaterParams): { ok: boolean; buildings: number } {
  const r2 = wp.mains.villageRadiusM ** 2;
  let n = 0;
  for (const b of buildings) if ((b.xM - xM) ** 2 + (b.yM - yM) ** 2 <= r2) n++;
  return { ok: n >= wp.mains.villageMinBuildings, buildings: n };
}

export interface Catchment {
  cells: Int32Array;
  areaM2: number;
  meanZM: number;
}

/**
 * Zlewnia zbiornika z rowami: komórki spływające do dna doliny przy zbiorniku, zbierane od zbiornika
 * w górę, aż do największej powierzchni, którą obejmują rowy.
 */
export function reservoirCatchment(net: StreamNet, xM: number, yM: number, maxAreaM2: number, wp: WaterParams, elevationM: Float32Array): Catchment {
  const start = thalwegCell(net, xM, yM, wp.catchment.searchRadiusM);
  if (start < 0) return { cells: new Int32Array(0), areaM2: 0, meanZM: 0 };
  const W = net.widthCells;
  const H = net.heightCells;
  const cellM2 = net.cellSizeM ** 2;
  const out: number[] = [];
  const queue = [start];
  let zSum = 0;
  for (let q = 0; q < queue.length && out.length * cellM2 < maxAreaM2; q++) {
    const k = queue[q];
    out.push(k);
    zSum += elevationM[k];
    const i = k % W;
    const j = (k - i) / W;
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d];
      const nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (net.down[n] === k) queue.push(n);
    }
  }
  return { cells: Int32Array.from(out), areaM2: out.length * cellM2, meanZM: out.length ? zSum / out.length : 0 };
}

/**
 * Dopływ ze zlewni w dobie [m³]: woda, która dotarła do gruntu (opad minus przyrost śniegu, czyli
 * deszcz i topnienie) × powierzchnia × współczynnik spływu.
 */
export function catchmentInflowM3(areaM2: number, precipMm: number, swePrevMm: number, sweNowMm: number, wp: WaterParams): number {
  const waterMm = Math.max(0, precipMm + swePrevMm - sweNowMm);
  return (waterMm / 1000) * areaM2 * wp.catchment.runoffCoefficient;
}

// ------------------------------------------------------------------ połączenia źródeł ze zbiornikiem

export interface SupplyLink {
  /** Zbiornik, do którego płynie woda. */
  reservoirId: string;
  /** Długość drogi wody (rury albo odległość bezpośrednia) [m]. */
  lengthM: number;
}

/**
 * Źródło połączone ze zbiornikiem: bliżej niż directRadiusM albo przez rury zasilające (koniec rury
 * przy źródle, kolejne rury stykające się końcami, koniec przy zbiorniku).
 */
export function connectSources(
  sources: { id: string; xM: number; yM: number }[],
  reservoirs: { id: string; xM: number; yM: number }[],
  pipes: { id: string; points: PointM[] }[],
  wp: WaterParams,
): Map<string, SupplyLink> {
  const out = new Map<string, SupplyLink>();
  const R = wp.supply.connectRadiusM;
  const len = (pts: PointM[]) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p.xM - pts[i - 1].xM, p.yM - pts[i - 1].yM) : 0), 0);
  const ends = pipes.filter((p) => p.points.length >= 2).map((p) => ({ id: p.id, a: p.points[0], b: p.points[p.points.length - 1], L: len(p.points) }));
  const near = (p: PointM, q: { xM: number; yM: number }, r: number) => Math.hypot(p.xM - q.xM, p.yM - q.yM) <= r;
  for (const s of sources) {
    let best: SupplyLink | null = null;
    for (const r of reservoirs) {
      const d = Math.hypot(r.xM - s.xM, r.yM - s.yM);
      if (d <= wp.supply.directRadiusM && (!best || d < best.lengthM)) best = { reservoirId: r.id, lengthM: d };
    }
    // Przeszukiwanie rur od źródła (najkrótsza droga – Dijkstra na małym grafie).
    const dist = new Map<string, { L: number; tip: PointM[] }>();
    const queue: { id: string; L: number; tips: PointM[] }[] = [];
    for (const e of ends) {
      if (near(e.a, s, R)) queue.push({ id: e.id, L: e.L, tips: [e.b] });
      else if (near(e.b, s, R)) queue.push({ id: e.id, L: e.L, tips: [e.a] });
    }
    while (queue.length) {
      queue.sort((x, y) => x.L - y.L);
      const cur = queue.shift()!;
      if (dist.has(cur.id)) continue;
      dist.set(cur.id, { L: cur.L, tip: cur.tips });
      for (const r of reservoirs) if (cur.tips.some((t) => near(t, r, R)) && (!best || cur.L < best.lengthM)) best = { reservoirId: r.id, lengthM: cur.L };
      for (const e of ends) {
        if (dist.has(e.id)) continue;
        if (cur.tips.some((t) => near(e.a, t, R))) queue.push({ id: e.id, L: cur.L + e.L, tips: [e.b] });
        else if (cur.tips.some((t) => near(e.b, t, R))) queue.push({ id: e.id, L: cur.L + e.L, tips: [e.a] });
      }
    }
    if (best) out.set(s.id, best);
  }
  return out;
}

/**
 * Wycinek sieci cieków (okno siatki i0, j0, W × H): zlewnie i przepływy z całej mapy (potok
 * wpływający z zewnątrz okna ma pełną zlewnię), spływ poza okno = wypływ; linie przycięte i przesunięte.
 */
export function cropStreamNet(net: StreamNet, i0: number, j0: number, W: number, H: number): StreamNet {
  const N = W * H;
  const down = new Int32Array(N).fill(-1);
  const accM2 = new Float32Array(N);
  const meanZM = new Float32Array(N);
  const meanFlowM3s = new Float32Array(N);
  const inside = (k: number) => {
    const i = (k % net.widthCells) - i0;
    const j = Math.floor(k / net.widthCells) - j0;
    return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const kf = (j0 + j) * net.widthCells + (i0 + i);
      const k = j * W + i;
      accM2[k] = net.accM2[kf];
      meanZM[k] = net.meanZM[kf];
      meanFlowM3s[k] = net.meanFlowM3s[kf];
      down[k] = net.down[kf] >= 0 ? inside(net.down[kf]) : -1;
    }
  }
  const cs = net.cellSizeM;
  const x0 = i0 * cs;
  const y0 = j0 * cs;
  const lines: StreamLine[] = [];
  for (const l of net.lines) {
    let pts: PointM[] = [];
    let flows: number[] = [];
    let part = 0;
    const flush = () => {
      if (pts.length >= 2) lines.push({ ...l, id: `${l.id}.${part++}`, points: pts, meanFlowM3s: flows });
      pts = [];
      flows = [];
    };
    l.points.forEach((p, n) => {
      const x = p.xM - x0;
      const y = p.yM - y0;
      if (x >= 0 && y >= 0 && x < W * cs && y < H * cs) {
        pts.push({ xM: x, yM: y });
        flows.push(l.meanFlowM3s[n]);
      } else flush();
    });
    flush();
  }
  return { widthCells: W, heightCells: H, cellSizeM: cs, down, accM2, meanZM, meanFlowM3s, lines };
}
