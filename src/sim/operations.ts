/**
 * Doba naśnieżania i noc ratraków w grze (etap 7): infrastruktura z układu (zbiornik, ujęcie,
 * pompownia, przyłącze, garaż, kotwy, rurociągi z hydrantami, armatki), plan naśnieżania tras,
 * śnieg z armatek rozłożony z wiatrem (pryzmy), plan nocy ratraków (awarie, wyciągarka, czas pracy),
 * koszty (energia z taryfą nocną, woda, paliwo, operatorzy, serwis, leasing, naprawy), operacje na
 * śniegu dla modelu śniegu i podsumowanie dla paneli. Bez DOM – ta sama logika w grze i bez grafiki.
 */
import type { DayExtra, Flows, GameState, OpsState, OpsSummary, ResortFacts, WaterSourceDay } from './economy';
import { costSignature, ditchKey, ensureOps } from './economy';
import type { EconomyParams } from './economyParams';
import type { GroomPiste, GroomerUnit } from './grooming';
import { anchorsReach, breakdownTonight, planNight } from './grooming';
import type { PointM } from './lifts';
import type { ResortAnalysis, ResortLayout } from './resort';
import { Rng } from './rng';
import type { GunFact, PipelineDesign, PisteSnowNeed } from './snowmaking';
import { connectPipelines, depositSnow, intakeRateM3h, pipelineHydrants, pumpEnergyKWh, pumpHeadM, runSnowmakingDay, tariffPrice } from './snowmaking';
import type { SnowOps } from './snowOps';
import { emptyOps } from './snowOps';
import type { SnowmakingParams } from './snowmakingParams';
import { groomerTypeById, gunTypeById } from './snowmakingParams';
import type { RidingParams } from './snowRiding';
import { packedBaseCm } from './snowRiding';
import { formatIsoDate, parseIsoDate, daysBetween } from './time';
import type { CalendarDate } from './weather';
import { dailyAtElevation } from './weather';
import type { WeatherBook } from './weatherBook';
import type { Catchment, StreamNet, SupplyLink, WaterParams } from './water';
import { allocateIntakes, analyzeDitch, catchmentInflowM3, connectSources, flowFactor, legacyDitchPoints, normalPrecipMm, reservoirCatchment, streamAt, villageCoverage, wellYieldM3h } from './water';

export interface OpsGrid {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  sampleElevationM(xM: number, yM: number): number;
}

/** Etap 6b: model wody – sieć cieków, parametry, zabudowa wsi (zasięg wodociągu), wysokości. */
export interface WaterContext {
  net: StreamNet;
  wp: WaterParams;
  villageBuildings: PointM[];
  elevationM: Float32Array;
}

export type WaterSourceKind = 'intake' | 'mains' | 'well' | 'catchment';

/** Zbudowane źródło wody: połączenie ze zbiornikiem i to, co wiadomo o jego wydajności. */
export interface WaterSourceFact {
  id: string;
  kind: WaterSourceKind;
  name: string;
  xM: number;
  yM: number;
  zM: number;
  /** Wydajność urządzenia: ujęcie i wodociąg – m³/h, studnia – głębokość m, rowy – największa zlewnia m². */
  capacity: number;
  link: SupplyLink | null;
  /** Dlaczego nie daje wody (null – działa). */
  problem: string | null;
  /** Ujęcie: potok i komórka dna doliny. */
  streamName?: string;
  cell?: number;
  meanFlowM3s?: number;
  /** Studnia: wydajność po wierceniu [m³/h]. */
  wellYieldM3h?: number;
  /** Rowy: zlewnia zbiornika. */
  catchment?: Catchment;
  /** Wysokość podnoszenia do zbiornika [m] (0 – grawitacyjnie). */
  headM: number;
}

export interface OpsSnow {
  sweMm: Float32Array;
  depthCm: Float32Array;
  pileMm: Float32Array;
  techMm: Float32Array;
  liquidMm: Float32Array;
}

// ------------------------------------------------------------------ infrastruktura

export interface Infra {
  reservoirCapacityM3: number;
  intakeM3h: number;
  pumpCapacityM3h: number;
  pump: PointM | null;
  pumpZ: number;
  gridKw: number;
  garageSlots: number;
  anchors: { xM: number; yM: number; rangeM: number }[];
  /** Armatki gotowe do pracy (zbudowane, na połączonym rurociągu). */
  guns: GunFact[];
  /** Połączone rurociągi: odległość rurą od pompowni do początku. */
  connected: Map<string, number>;
  /** Etap 6b: źródła wody (gdy jest model wody). */
  sources: WaterSourceFact[];
}

const built = (state: GameState, id: string) => !state.construction[id];

export function infraFacts(layout: ResortLayout, analysis: ResortAnalysis, state: GameState, sp: SnowmakingParams, grid: OpsGrid, water: WaterContext | null = null): Infra {
  const ops = ensureOps(state);
  const out: Infra = { reservoirCapacityM3: 0, intakeM3h: 0, pumpCapacityM3h: 0, pump: null, pumpZ: 0, gridKw: 0, garageSlots: 0, anchors: [], guns: [], connected: new Map(), sources: [] };
  for (const b of layout.buildings ?? []) {
    const t = sp.buildings.find((x) => x.id === b.typeId);
    if (!t || !built(state, b.id)) continue;
    if (t.kind === 'reservoir') out.reservoirCapacityM3 += t.capacity;
    else if (t.kind === 'intake') out.intakeM3h += t.capacity;
    else if (t.kind === 'pump') {
      out.pumpCapacityM3h += t.capacity;
      if (!out.pump) {
        out.pump = { xM: b.xM, yM: b.yM };
        out.pumpZ = grid.sampleElevationM(b.xM, b.yM);
      }
    } else if (t.kind === 'grid') out.gridKw += t.capacity;
    else if (t.kind === 'garage') out.garageSlots += t.capacity;
    else if (t.kind === 'anchor') out.anchors.push({ xM: b.xM, yM: b.yM, rangeM: t.capacity });
  }
  const pipes = (layout.pipelines ?? []).filter((p) => built(state, p.id));
  out.connected = connectPipelines(pipes, out.pump, sp);
  if (water) out.sources = waterSources(layout, state, sp, grid, water, pipes);
  const pisteOf = pisteCellMap(analysis, grid);
  for (const g of layout.snowGuns ?? []) {
    if (!built(state, g.id)) continue;
    const pipe = pipes.find((p) => p.id === g.pipelineId);
    const base = out.connected.get(g.pipelineId);
    if (!pipe || base === undefined) continue;
    const h = pipelineHydrants(pipe, sp)[g.hydrant];
    if (!h) continue;
    const t = gunTypeById(sp, g.typeId);
    const z = grid.sampleElevationM(h.xM, h.yM);
    const pid = nearestPiste(pisteOf, grid, h.xM, h.yM, 40);
    out.guns.push({
      id: g.id,
      typeId: g.typeId,
      xM: h.xM,
      yM: h.yM,
      zM: Number.isNaN(z) ? out.pumpZ : z,
      headM: pumpHeadM(Number.isNaN(z) ? out.pumpZ : z, out.pumpZ, base + h.alongM, t.nozzleHeadM, sp),
      pisteId: pid,
      ...aimAt(analysis, pid, h.xM, h.yM),
      mode: ops.gunModes[g.id] ?? 'auto',
    });
  }
  return out;
}

/** Źródła wody z układu: ujęcia na ciekach, wodociąg, studnie, rowy – z połączeniem do zbiornika. */
export function waterSources(layout: ResortLayout, state: GameState, sp: SnowmakingParams, grid: OpsGrid, water: WaterContext, builtPipes?: PipelineDesign[]): WaterSourceFact[] {
  const wp = water.wp;
  const reservoirs: { id: string; xM: number; yM: number; capacity: number }[] = [];
  const raw: { id: string; kind: WaterSourceKind; name: string; xM: number; yM: number; capacity: number }[] = [];
  for (const b of layout.buildings ?? []) {
    const t = sp.buildings.find((x) => x.id === b.typeId);
    if (!t || !built(state, b.id)) continue;
    if (t.kind === 'reservoir') reservoirs.push({ id: b.id, xM: b.xM, yM: b.yM, capacity: t.capacity });
    else if (t.kind === 'intake' || t.kind === 'mains' || t.kind === 'well' || t.kind === 'catchment') raw.push({ id: b.id, kind: t.kind, name: b.name, xM: b.xM, yM: b.yM, capacity: t.capacity });
  }
  const pipes = (builtPipes ?? (layout.pipelines ?? []).filter((p) => built(state, p.id))).filter((p) => p.supply);
  const links = connectSources(raw, reservoirs, pipes, wp);
  // Etap 7f: rowy rysowane jako linie – zbierają spływ z obszaru powyżej siebie do zbiornika przy końcu.
  const ditchFacts: WaterSourceFact[] = [];
  for (const d of layout.ditches ?? []) {
    if (!built(state, d.id)) continue;
    const a = analyzeDitch(d.points, water.net, water.elevationM, reservoirs, wp);
    const end = a.oriented[a.oriented.length - 1];
    ditchFacts.push({
      id: d.id,
      kind: 'catchment',
      name: d.name,
      xM: end.xM,
      yM: end.yM,
      capacity: a.effectiveAreaM2,
      zM: grid.sampleElevationM(end.xM, end.yM),
      link: a.reservoirId ? { reservoirId: a.reservoirId, lengthM: 0 } : null,
      problem: a.ok ? null : a.issues[0],
      headM: 0,
      catchment: { cells: a.catchment.cells, areaM2: a.effectiveAreaM2, meanZM: a.catchment.meanZM },
    });
  }
  return [...raw.map((r) => {
    const z = grid.sampleElevationM(r.xM, r.yM);
    const link = links.get(r.id) ?? null;
    const res = link ? reservoirs.find((x) => x.id === link.reservoirId)! : null;
    const zRes = res ? grid.sampleElevationM(res.xM, res.yM) : z;
    const f: WaterSourceFact = { ...r, zM: z, link, problem: link ? null : 'brak połączenia ze zbiornikiem (rura zasilająca)', headM: 0 };
    let lift = Math.max(0, zRes - z);
    if (r.kind === 'intake') {
      const hit = streamAt(water.net, r.xM, r.yM, wp.streams.intakeMaxDistanceM, wp);
      if (!hit) f.problem = 'poza ciekiem – ujęcie musi stać na potoku';
      else {
        f.streamName = hit.line.name;
        f.cell = hit.cell;
        f.meanFlowM3s = hit.meanFlowM3s;
      }
    } else if (r.kind === 'mains') {
      const v = villageCoverage(r.xM, r.yM, water.villageBuildings, wp);
      if (!v.ok) f.problem = `poza zasięgiem wodociągu wsi (budynków w promieniu ${wp.mains.villageRadiusM} m: ${v.buildings})`;
    } else if (r.kind === 'well') {
      f.wellYieldM3h = wellYieldM3h(state.seed, r.id, r.capacity, wp);
      lift += wp.wells.dynamicLevelShare * r.capacity;
    } else if (r.kind === 'catchment') {
      // Rowy zbierają wodę ze zlewni zbiornika, do którego są podłączone.
      if (res) {
        f.catchment = reservoirCatchment(water.net, res.xM, res.yM, r.capacity, wp, water.elevationM);
        lift = 0;
      }
    }
    if (r.kind !== 'catchment' && r.kind !== 'mains') f.headM = lift > 0 ? lift + (sp.pumping.pipeLossMPerKm * (link?.lengthM ?? 0)) / 1000 : 0;
    return f;
  }), ...ditchFacts];
}

/**
 * Etap 7f: zamiana starego „budynku” rowów (zlewnia wokół zbiornika) na rów wzdłuż dna doliny
 * powyżej zbiornika – ten sam identyfikator i podpis kosztowy (bez opłaty i bez przebudowy).
 * Zwraca null, gdy nie ma czego zamieniać.
 */
export function convertLegacyCatchments(layout: ResortLayout, sp: SnowmakingParams, water: WaterContext): ResortLayout | null {
  const kindOf = (typeId: string) => sp.buildings.find((x) => x.id === typeId)?.kind;
  const old = (layout.buildings ?? []).filter((b) => kindOf(b.typeId) === 'catchment');
  if (!old.length) return null;
  const next = JSON.parse(JSON.stringify(layout)) as ResortLayout;
  const reservoirs = (next.buildings ?? []).filter((b) => kindOf(b.typeId) === 'reservoir');
  for (const b of old) {
    next.buildings = (next.buildings ?? []).filter((x) => x.id !== b.id);
    let near: (typeof reservoirs)[number] | null = null;
    let nd = Infinity;
    for (const r of reservoirs) {
      const d = Math.hypot(r.xM - b.xM, r.yM - b.yM);
      if (d < nd) {
        nd = d;
        near = r;
      }
    }
    if (!near) continue;
    const pts = legacyDitchPoints(water.net, water.elevationM, near.xM, near.yM, water.wp);
    if (pts.length < 2) continue;
    const points = pts.map((q) => ({ xM: Math.round(q.xM * 10) / 10, yM: Math.round(q.yM * 10) / 10 }));
    (next.ditches ??= []).push({ id: b.id, name: 'Rów zbierający (dawne rowy przy zbiorniku)', points, legacySig: costSignature({ ...b, rotDeg: undefined }), legacyKey: ditchKey(points) });
  }
  return next;
}

/** Najbliższy punkt osi trasy (cel armatki). */
function aimAt(analysis: ResortAnalysis, pisteId: string | null, x: number, y: number): { aimXM: number; aimYM: number } {
  const a = pisteId ? analysis.pistes.get(pisteId) : undefined;
  if (!a) return { aimXM: x, aimYM: y };
  let best = { aimXM: x, aimYM: y };
  let bd = Infinity;
  for (const s of a.axis) {
    const d = (s.xM - x) ** 2 + (s.yM - y) ** 2;
    if (d < bd) {
      bd = d;
      best = { aimXM: s.xM, aimYM: s.yM };
    }
  }
  return best;
}

/** Komórka → trasa (pierwsza, która ją obejmuje). */
function pisteCellMap(analysis: ResortAnalysis, grid: OpsGrid): Map<number, string> {
  const m = new Map<number, string>();
  for (const [id, a] of analysis.pistes) for (const k of a.cells) if (!m.has(k)) m.set(k, id);
  void grid;
  return m;
}

function nearestPiste(map: Map<number, string>, grid: OpsGrid, x: number, y: number, radiusM: number): string | null {
  const cs = grid.cellSizeM;
  const r = Math.ceil(radiusM / cs);
  const ci = Math.floor(x / cs);
  const cj = Math.floor(y / cs);
  let best: string | null = null;
  let bestD = Infinity;
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= grid.widthCells || j >= grid.heightCells) continue;
      const id = map.get(j * grid.widthCells + i);
      const d = Math.hypot(di, dj);
      if (id && d < bestD) {
        bestD = d;
        best = id;
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------ geometria tras dla ratraków

interface PisteGeom {
  cells: number[];
  steep: Uint8Array;
  steepTops: PointM[];
  meanSlopePercent: number;
  zMid: number;
}

const geomCache = new WeakMap<ResortAnalysis, Map<string, PisteGeom>>();

/** Komórki trasy od góry, strome odcinki (nachylenie na ±25 m osi ponad próg wyciągarki). */
export function pisteGeometry(analysis: ResortAnalysis, id: string, grid: OpsGrid, sp: SnowmakingParams): PisteGeom | null {
  let cache = geomCache.get(analysis);
  if (!cache) {
    cache = new Map();
    geomCache.set(analysis, cache);
  }
  const hit = cache.get(id);
  if (hit) return hit;
  const a = analysis.pistes.get(id);
  if (!a) return null;
  const axis = a.axis.filter((s) => !Number.isNaN(s.elevationM));
  if (axis.length < 2) return null;
  const slope = axis.map((s, i) => {
    let j0 = i;
    let j1 = i;
    while (j0 > 0 && s.distanceM - axis[j0].distanceM < 25) j0--;
    while (j1 < axis.length - 1 && axis[j1].distanceM - s.distanceM < 25) j1++;
    const run = axis[j1].distanceM - axis[j0].distanceM;
    return run > 0 ? ((axis[j0].elevationM - axis[j1].elevationM) / run) * 100 : 0;
  });
  const cs = grid.cellSizeM;
  const near = a.cells.map((k) => {
    const x = ((k % grid.widthCells) + 0.5) * cs;
    const y = (Math.floor(k / grid.widthCells) + 0.5) * cs;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < axis.length; i++) {
      const d = (axis[i].xM - x) ** 2 + (axis[i].yM - y) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return { k, i: bi };
  });
  near.sort((p, q) => p.i - q.i || p.k - q.k);
  const steepAt = slope.map((v) => v > sp.groomers.winchSlopePercent);
  const tops: PointM[] = [];
  for (let i = 0; i < axis.length; i++) if (steepAt[i] && (i === 0 || !steepAt[i - 1])) tops.push({ xM: axis[i].xM, yM: axis[i].yM });
  const g: PisteGeom = {
    cells: near.map((n) => n.k),
    steep: Uint8Array.from(near, (n) => (steepAt[n.i] ? 1 : 0)),
    steepTops: tops,
    meanSlopePercent: a.meanSlopePercent,
    zMid: (a.topElevationM + a.bottomElevationM) / 2,
  };
  cache.set(id, g);
  return g;
}

/** Odcinki osi trasy z nierozepchniętymi pryzmami (trasa nierówna – nie nadaje się do otwarcia). */
export function pileSegments(analysis: ResortAnalysis, id: string, snow: { pileMm: Float32Array } | null, cellAt: (x: number, y: number) => number, sp: SnowmakingParams): { fromM: number; toM: number }[] {
  const a = analysis.pistes.get(id);
  if (!a || !snow) return [];
  const out: { fromM: number; toM: number }[] = [];
  let cur: { fromM: number; toM: number } | null = null;
  const axis = a.axis.filter((s) => !Number.isNaN(s.elevationM));
  for (const s of axis) {
    const k = cellAt(s.xM, s.yM);
    // Pryzma w pobliżu osi (komórka osi albo sąsiednie w pasie trasy).
    let pile = k >= 0 ? snow.pileMm[k] : 0;
    for (const d of [-1, 1]) {
      const k2 = cellAt(s.xM + d * s.widthM * 0.3, s.yM);
      if (k2 >= 0) pile = Math.max(pile, snow.pileMm[k2]);
    }
    if (pile > sp.snow.pileThresholdMm) {
      if (!cur) cur = { fromM: s.distanceM, toM: s.distanceM };
      else cur.toM = s.distanceM;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Trasy zablokowane pryzmami albo ratrakowaniem w dzień (zamknięte dla gości). */
export function blockedPistes(state: GameState, analysis: ResortAnalysis, snow: { pileMm: Float32Array } | null, cellAt: (x: number, y: number) => number, sp: SnowmakingParams | null | undefined): Set<string> {
  const out = new Set<string>(ensureOps(state).dayGroom);
  if (!sp || !snow) return out;
  for (const id of analysis.pistes.keys()) if (pileSegments(analysis, id, snow, cellAt, sp).length) out.add(id);
  return out;
}

// ------------------------------------------------------------------ doba

export interface DayOpsInput {
  state: GameState;
  layout: ResortLayout;
  analysis: ResortAnalysis;
  facts: ResortFacts;
  grid: OpsGrid;
  cellAt(x: number, y: number): number;
  snow: OpsSnow | null;
  book: WeatherBook;
  ep: EconomyParams;
  riding: RidingParams;
  date: CalendarDate;
  /** Etap 6b: model wody (potoki, wodociąg, studnie, zlewnia); brak – uproszczony dopływ z ujęcia (etap 7). */
  water?: WaterContext | null;
}

interface WaterPlanItem {
  id: string;
  kind: WaterSourceKind;
  name: string;
  rateM3h: number;
  feePlnPerM3: number;
  energyKWhPerM3: number;
  fixedPln: number;
  note: string;
}

const fmt1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('pl-PL');

/**
 * Plan wody na dobę: ile każde źródło może dać do zbiornika [m³/h]. Ujęcia – przepływ potoku dziś
 * i wspólny limit poboru; studnie – wydajność; rowy – topnienie i deszcz na zlewni (z modelu śniegu);
 * wodociąg – limit przyłącza, gdy gracz go włączył. Bez modelu wody – uproszczony dopływ z ujęć.
 */
export function planWater(i: DayOpsInput, infra: Infra): { items: WaterPlanItem[]; freeM3h: number; mainsM3h: number } {
  const sp = i.ep.snowmaking!;
  const ops = ensureOps(i.state);
  const date = i.date;
  const items: WaterPlanItem[] = [];
  if (!i.water) {
    const precip = i.book.precipitationBefore(date, sp.water.precipWindowDays);
    const rate = intakeRateM3h(infra.intakeM3h, date.month, precip, sp);
    if (rate > 0) items.push({ id: 'ujecia', kind: 'intake', name: 'Ujęcia', rateM3h: rate, feePlnPerM3: 0, energyKWhPerM3: 0, fixedPln: 0, note: 'uproszczony dopływ' });
    return { items, freeM3h: rate, mainsM3h: 0 };
  }
  const wp = i.water.wp;
  const precip = i.book.precipitationBefore(date, wp.streams.precipWindowDays);
  const factor = flowFactor(date.month, precip, normalPrecipMm(i.book.profile, date.month, wp.streams.precipWindowDays), wp);
  const energy = (s: WaterSourceFact) => (s.headM > 0 ? pumpEnergyKWh(1, s.headM, sp) : 0);
  const intakes = infra.sources.filter((s) => s.kind === 'intake');
  const alloc = allocateIntakes(
    i.water.net,
    intakes.map((s) => ({ id: s.id, cell: s.problem ? -1 : (s.cell ?? -1), capacityM3h: s.capacity })),
    factor,
    wp,
  );
  intakes.forEach((s, n) => {
    const a = alloc[n];
    const note = s.problem ?? `${s.streamName}: przepływ ${fmt1(a.flowM3h)} m³/h, wolno pobrać ${fmt1(a.availableM3h)} m³/h`;
    items.push({ id: s.id, kind: 'intake', name: s.name, rateM3h: s.problem ? 0 : a.allocatedM3h, feePlnPerM3: wp.streams.streamFeePlnPerM3, energyKWhPerM3: energy(s), fixedPln: 0, note });
  });
  for (const s of infra.sources.filter((x) => x.kind === 'well')) {
    const y = s.wellYieldM3h ?? 0;
    items.push({ id: s.id, kind: 'well', name: s.name, rateM3h: s.problem ? 0 : y, feePlnPerM3: wp.wells.groundwaterFeePlnPerM3, energyKWhPerM3: energy(s), fixedPln: 0, note: s.problem ?? `wydajność ${fmt1(y)} m³/h, pompa podnosi ${Math.round(s.headM)} m` });
  }
  const catchSwe = (ops.catchSweMm ??= {});
  for (const s of infra.sources.filter((x) => x.kind === 'catchment')) {
    let rate = 0;
    let note = s.problem ?? '';
    const c = s.catchment;
    if (!s.problem && c && c.cells.length) {
      let swe = 0;
      if (i.snow) for (const k of c.cells) swe += Number.isNaN(i.snow.sweMm[k]) ? 0 : i.snow.sweMm[k];
      swe /= c.cells.length;
      const prev = catchSwe[s.id] ?? swe;
      catchSwe[s.id] = swe;
      const p = dailyAtElevation(i.book.daily(date), c.meanZM, i.book.profile, i.book.weatherParams).precipitationMm;
      rate = catchmentInflowM3(c.areaM2, p, prev, swe, wp) / 24;
      note = `zlewnia ${fmt1(c.areaM2 / 10000)} ha: opad ${fmt1(p)} mm, śnieg ${fmt1(prev)} → ${fmt1(swe)} mm wody`;
    } else if (!s.problem) note = 'brak zlewni przy zbiorniku';
    items.push({ id: s.id, kind: 'catchment', name: s.name, rateM3h: rate, feePlnPerM3: 0, energyKWhPerM3: 0, fixedPln: 0, note });
  }
  const freeM3h = items.reduce((a, x) => a + x.rateM3h, 0);
  let mainsM3h = 0;
  for (const s of infra.sources.filter((x) => x.kind === 'mains')) {
    const on = !!ops.mainsOn && !s.problem;
    if (on) mainsM3h += s.capacity;
    items.push({
      id: s.id,
      kind: 'mains',
      name: s.name,
      rateM3h: on ? s.capacity : 0,
      feePlnPerM3: wp.mains.pricePlnPerM3,
      energyKWhPerM3: 0,
      fixedPln: date.day === 1 ? wp.mains.fixedPlnPerMonth : 0,
      note: s.problem ?? (on ? `zakup do ${fmt1(s.capacity)} m³/h po ${fmt1(wp.mains.pricePlnPerM3)} zł/m³` : 'wyłączony (włącz zakup w panelu)'),
    });
  }
  return { items, freeM3h, mainsM3h };
}

export interface DayOpsResult {
  extra: DayExtra;
  ops: SnowOps;
  summary: OpsSummary;
}

/** Doba naśnieżania i noc ratraków; aktualizuje stan (zbiornik, flota) i zwraca koszty i operacje. */
export function runDayOperations(i: DayOpsInput): DayOpsResult {
  const sp = i.ep.snowmaking!;
  const state = i.state;
  const ops = ensureOps(state);
  const date = i.date;
  const iso = formatIsoDate(date);
  const infra = infraFacts(i.layout, i.analysis, state, sp, i.grid, i.water ?? null);
  const flows: Partial<Flows> = {};
  const add = (k: keyof Flows, v: number) => (flows[k] = (flows[k] ?? 0) + v);
  const cellM2 = i.grid.cellSizeM ** 2;
  const capacity = infra.reservoirCapacityM3;
  ops.reservoirM3 = Math.min(ops.reservoirM3, capacity);
  const wplan = capacity > 0 ? planWater(i, infra) : { items: [], freeM3h: 0, mainsM3h: 0 };
  const inflowM3h = wplan.freeM3h;
  const working = state.seasonOpen && i.facts.lifts.some((l) => l.operating);
  const liftKw = working ? i.facts.lifts.filter((l) => l.operating).reduce((a, l) => a + l.powerKw, 0) : 0;
  const hours = state.hours;

  // ---- naśnieżanie (tylko gdy jest model śniegu – poza latem)
  const needs = new Map<string, PisteSnowNeed>();
  for (const pf of i.facts.pistes) {
    if (!pf.built) continue;
    const plan = ops.snowPlan[pf.id] ?? { targetCm: 50, priority: 2, enabled: true };
    const a = i.analysis.pistes.get(pf.id);
    // Baza średnio na całej trasie (śnieg w pryzmach liczy się – ratrak go rozepchnie).
    let base = 0;
    let n = 0;
    if (a && i.snow) {
      for (const k of a.cells) {
        base += packedBaseCm(Number.isNaN(i.snow.sweMm[k]) ? 0 : i.snow.sweMm[k], i.riding);
        n++;
      }
    }
    const baseCm = n ? base / n : 0;
    needs.set(pf.id, {
      needKg: (Math.max(0, plan.targetCm - baseCm) / 100) * i.riding.packedDensityKgM3 * pf.areaM2,
      priority: plan.priority,
      enabled: plan.enabled,
      openDuringDay: working && pf.open,
    });
  }
  const canMake = i.snow !== null && infra.guns.length > 0 && infra.pumpCapacityM3h > 0 && infra.gridKw > 0;
  // Automat nie naśnieża stromych odcinków, których nikt nie rozepchnie (brak ratraka z wyciągarką
  // albo punktu kotwienia w zasięgu liny) – pryzmy zostałyby tam na stałe i zamykały trasę.
  // Ręcznie włączona armatka pracuje mimo to (decyzja gracza).
  const winch = ops.groomers.some((g) => groomerTypeById(sp, g.typeId).winch);
  const cs = i.grid.cellSizeM;
  const steepNear = (g: GunFact): boolean => {
    if (!g.pisteId) return false;
    const geo = pisteGeometry(i.analysis, g.pisteId, i.grid, sp);
    if (!geo || !geo.steep.some((v) => v)) return false;
    if (winch && anchorsReach(geo.steepTops, infra.anchors)) return false;
    const r2 = (sp.snow.throwSpreadM + cs) ** 2;
    for (let n = 0; n < geo.cells.length; n++) {
      if (!geo.steep[n]) continue;
      const k = geo.cells[n];
      const x = ((k % i.grid.widthCells) + 0.5) * cs;
      const y = (Math.floor(k / i.grid.widthCells) + 0.5) * cs;
      if ((x - g.aimXM) ** 2 + (y - g.aimYM) ** 2 <= r2) return true;
    }
    return false;
  };
  const gunsToday = canMake ? infra.guns.map((g) => (g.mode === 'auto' && steepNear(g) ? { ...g, mode: 'off' as const } : g)) : [];
  const smd = runSnowmakingDay(
    {
      weather: (h, z) => i.book.hourAt(date, h, z),
      guns: gunsToday,
      needs,
      reservoirM3: ops.reservoirM3,
      reservoirCapacityM3: capacity,
      inflowM3h,
      mainsM3h: wplan.mainsM3h,
      pumpCapacityM3h: infra.pumpCapacityM3h,
      gridLimitKw: infra.gridKw,
      otherLoadKw: (h) => (h + 0.5 >= hours.openH && h + 0.5 < hours.closeH ? liftKw : 0),
      energyPrice: (h) => tariffPrice(h, i.ep.costs.energyPlnPerKWh, sp),
      liftsOpenH: hours.openH,
      liftsCloseH: hours.closeH,
      autoAllowed: sp.snow.autoFromMonth > sp.snow.autoToMonth ? date.month >= sp.snow.autoFromMonth || date.month <= sp.snow.autoToMonth : date.month >= sp.snow.autoFromMonth && date.month <= sp.snow.autoToMonth,
    },
    sp,
  );
  ops.reservoirM3 = smd.reservoirEndM3;
  add('snowEnergy', smd.energyCostPln);
  // Woda ze źródeł: bezpłatny dopływ dzielony proporcjonalnie do wydajności; opłaty za pobór,
  // energia pompowania do zbiornika (średnia cena doby), zakup z wodociągu.
  const meanPrice = Array.from({ length: 24 }, (_, h) => tariffPrice(h, i.ep.costs.energyPlnPerKWh, sp)).reduce((a, b) => a + b, 0) / 24;
  const sources: WaterSourceDay[] = [];
  let supplyKWh = 0;
  for (const it of wplan.items) {
    const m3 = it.kind === 'mains' ? (wplan.mainsM3h > 0 ? (smd.mainsM3 * it.rateM3h) / wplan.mainsM3h : 0) : wplan.freeM3h > 0 ? (smd.intakeM3 * it.rateM3h) / wplan.freeM3h : 0;
    const kwh = m3 * it.energyKWhPerM3;
    supplyKWh += kwh;
    const cost = m3 * it.feePlnPerM3 + kwh * meanPrice + it.fixedPln;
    add('water', m3 * it.feePlnPerM3 + it.fixedPln);
    add('snowEnergy', kwh * meanPrice);
    sources.push({ id: it.id, kind: it.kind, name: it.name, rateM3h: it.rateM3h, m3, costPln: cost, note: it.note });
  }
  if (!i.water) add('water', smd.waterM3 * sp.water.waterFeePlnPerM3); // uproszczony model (etap 7): opłata od zużycia
  // Suma od początku roku gry (1 V).
  const yStart = date.month >= 5 ? date.year : date.year - 1;
  const from = `${yStart}-05-01`;
  if (!ops.waterSeason || ops.waterSeason.from !== from) ops.waterSeason = { from, byKind: {} };
  for (const so of sources) {
    const b = (ops.waterSeason.byKind[so.kind] ??= { m3: 0, costPln: 0 });
    b.m3 += so.m3;
    b.costPln += so.costPln;
  }
  const snowOps = emptyOps();
  let offShare = 0;
  if (smd.snowKg > 0) {
    const mask = new Uint8Array(i.grid.widthCells * i.grid.heightCells);
    for (const a of i.analysis.pistes.values()) for (const k of a.cells) mask[k] = 1;
    const dep = depositSnow(smd, gunsToday, i.grid, mask, sp);
    snowOps.addSweMm = dep.addSweMm;
    snowOps.addDensityKgM3 = smd.meanDensityKgM3;
    snowOps.addLiquidFraction = smd.meanLiquidFraction;
    offShare = dep.offPisteKg / Math.max(1, dep.onPisteKg + dep.offPisteKg);
  }

  // ---- ratraki: awarie, plan nocy (etap 7f: ratraki ponad miejsca w garażach stoją pod chmurką)
  const rngBase = new Rng(state.seed).fork('ratraki').fork(iso);
  const broken: string[] = [];
  const units: GroomerUnit[] = [];
  const sheltered = shelteredGroomers(ops, infra.garageSlots);
  const nightMinC = nightMinTempC(i, date);
  const og = sp.groomers.outdoor;
  for (const g of ops.groomers) {
    const type = groomerTypeById(sp, g.typeId);
    const inGarage = sheltered.has(g.id);
    const age = groomerAgeYears(g, date, sp);
    let available = g.brokenNights <= 0;
    if (available && i.snow && breakdownTonight(age, rngBase.fork(g.id), sp, { sheltered: inGarage, nightMinC, condition: g.condition ?? 1 })) {
      available = false;
      g.brokenNights = sp.groomers.repairNights;
      broken.push(g.id);
      add('repairs', sp.groomers.repairCostPln);
    }
    if (!inGarage) g.outdoorDays = (g.outdoorDays ?? 0) + 1;
    units.push({ id: g.id, type, available, warmupH: inGarage ? 0 : og.warmupMin / 60 });
  }
  const gpistes: GroomPiste[] = [];
  let group = 0;
  if (i.snow && units.some((u) => u.available)) {
    for (const pf of i.facts.pistes) {
      group++;
      if (!pf.built) continue;
      const geo = pisteGeometry(i.analysis, pf.id, i.grid, sp);
      if (!geo) continue;
      const plan = ops.groomPlan[pf.id] ?? { priority: 2, enabled: true, groomerId: null };
      let depth = 0;
      let pileKg = 0;
      let swe = 0;
      let liquid = 0;
      for (const k of geo.cells) {
        depth += Number.isNaN(i.snow.depthCm[k]) ? 0 : i.snow.depthCm[k];
        pileKg += i.snow.pileMm[k] * cellM2;
        swe += Number.isNaN(i.snow.sweMm[k]) ? 0 : i.snow.sweMm[k];
        liquid += i.snow.liquidMm[k];
      }
      const meanDepth = geo.cells.length ? depth / geo.cells.length : 0;
      if (meanDepth < 3 && pileKg <= 0) continue; // bez śniegu nie ma czego ratrakować
      const day = dailyAtElevation(i.book.daily(date), geo.zMid, i.book.profile, i.book.weatherParams);
      const fresh = day.phase === 'snow' ? day.precipitationMm : day.phase === 'sleet' ? day.precipitationMm / 2 : 0;
      const zMid = geo.zMid;
      gpistes.push({
        id: pf.id,
        group,
        areaM2: pf.areaM2,
        lengthM: pf.lengthM,
        meanSlopePercent: geo.meanSlopePercent,
        cells: geo.cells,
        steep: geo.steep,
        steepTops: geo.steepTops,
        freshSnowCm: fresh,
        pileM3: pileKg / sp.snow.groomedDensityWetKgM3,
        priority: ops.dayGroom.includes(pf.id) ? 0 : plan.priority,
        enabled: plan.enabled || ops.dayGroom.includes(pf.id),
        groomerId: plan.groomerId,
        airTempC: (h) => i.book.hourAt(date, h, zMid).temperatureC,
        wetSnow: swe > 0 && liquid / swe >= sp.snow.wetSnowLiquidFraction,
      });
    }
  }
  const night = planNight(gpistes, units, infra.anchors, sp);
  if (night.jobs.length) {
    const n = i.grid.widthCells * i.grid.heightCells;
    snowOps.groomGroup = new Int16Array(n);
    snowOps.groomMode = new Uint8Array(n);
    for (const j of night.jobs) {
      const gp = gpistes.find((x) => x.id === j.pisteId)!;
      for (const k of j.groomedCells) {
        snowOps.groomGroup[k] = gp.group;
        snowOps.groomMode[k] = j.mode;
      }
    }
  }
  const wage = i.ep.costs.hourlyWagePln * i.ep.costs.employerCostFactor * sp.groomers.nightBonus;
  let engineH = 0;
  for (const h of night.engineHours.values()) engineH += h;
  add('groomFuel', night.fuelL * sp.groomers.fuelPlnPerL);
  add('groomStaff', engineH * wage);
  let serviceH = 0;
  for (const [id, h] of night.engineHours) serviceH += h * (sheltered.has(id) ? 1 : og.serviceFactor);
  add('groomService', serviceH * sp.groomers.servicePlnPerHour);
  if (date.day === 1) for (const g of ops.groomers) if (g.leased) add('leasing', groomerTypeById(sp, g.typeId).pricePln * sp.groomers.leaseMonthlyShare);
  for (const g of ops.groomers) if (g.brokenNights > 0 && !broken.includes(g.id)) g.brokenNights--;

  const gunHours: Record<string, [number, number, number, number][]> = {};
  for (const [id, gd] of smd.guns) gunHours[id] = gd.byHour.map((h) => [h.hour, Math.round((h.kg / Math.max(1, gd.densitySum / Math.max(1, gd.snowKg))) * 10) / 10, Math.round(h.windFromDeg), Math.round(h.windMs * 10) / 10]);
  const summary: OpsSummary = {
    date: iso,
    hourly: smd.hourly,
    gridLimitKw: infra.gridKw,
    reservoirCapacityM3: capacity,
    inflowM3: smd.intakeM3 + smd.mainsM3,
    snowM3: smd.snowM3,
    waterM3: smd.waterM3,
    energyKWh: smd.energyKWh + supplyKWh,
    offPisteShare: offShare,
    gunHours,
    jobs: night.jobs.map((j) => ({ groomerId: j.groomerId, pisteId: j.pisteId, startH: j.startH, endH: j.endH, complete: j.complete, steepDone: j.steepDone, mode: j.mode })),
    unfinished: night.unfinished,
    steepSkipped: night.steepSkipped,
    finishH: night.finishH,
    fuelL: night.fuelL,
    broken,
    sources,
  };
  ops.last = summary;
  ops.dayGroom = [];
  return {
    extra: {
      flows,
      snowM3: smd.snowM3,
      waterM3: smd.waterM3,
      snowKWh: smd.energyKWh,
      fuelL: night.fuelL,
      groomed: night.jobs.filter((j) => j.complete).length,
      unfinished: night.unfinished.length,
    },
    ops: snowOps,
    summary,
  };
}

/** Zakup lub leasing ratraka (potrzebne wolne miejsce w garażu). Zwraca komunikat błędu albo null. */
export function acquireGroomer(state: GameState, typeId: string, leased: boolean, _garageSlots: number, sp: SnowmakingParams): string | null {
  // Etap 7f: garaż nie jest wymagany – ratrak bez miejsca stoi pod chmurką (droższy w utrzymaniu).
  const ops: OpsState = ensureOps(state);
  const t = groomerTypeById(sp, typeId);
  if (!leased && state.mode === 'career' && state.balancePln < t.pricePln) return `Brak pieniędzy: ratrak kosztuje ${Math.round(t.pricePln / 1000)} tys. zł.`;
  const id = `R${ops.nextGroomerId++}`;
  ops.groomers.push({ id, typeId, leased, boughtOn: formatIsoDate(state.date), ageAtPurchase: 0, brokenNights: 0 });
  if (!leased && state.mode === 'career') {
    state.balancePln -= t.pricePln;
    state.pending.equipment += t.pricePln;
  }
  state.log.push({ date: formatIsoDate(state.date), text: `${leased ? 'Leasing' : 'Zakup'}: ${t.name} (${id})` });
  return null;
}

/** Etap 7f: ratraki w garażu – pierwsze według kolejności we flocie, tyle, ile miejsc. */
export function shelteredGroomers(ops: OpsState, garageSlots: number): Set<string> {
  return new Set(ops.groomers.slice(0, Math.max(0, garageSlots)).map((g) => g.id));
}

/** Wiek ratraka [lata]: wiek przy zakupie + czas we flocie; dni pod chmurką liczą się × agingFactor. */
export function groomerAgeYears(g: { ageAtPurchase: number; boughtOn: string; outdoorDays?: number }, date: CalendarDate, sp: SnowmakingParams): number {
  const days = Math.max(0, daysBetween(parseIsoDate(g.boughtOn), date));
  return g.ageAtPurchase + (days + (g.outdoorDays ?? 0) * (sp.groomers.outdoor.agingFactor - 1)) / 365;
}

/** Najniższa temperatura nocy przy najniżej położonej trasie (tam stoją ratraki). */
function nightMinTempC(i: DayOpsInput, date: CalendarDate): number {
  let z = Infinity;
  for (const a of i.analysis.pistes.values()) if (Number.isFinite(a.bottomElevationM)) z = Math.min(z, a.bottomElevationM);
  if (!Number.isFinite(z)) return 0;
  let m = Infinity;
  for (let h = 18; h <= 30; h += 2) m = Math.min(m, i.book.hourAt(date, h, z).temperatureC);
  return m;
}

// ------------------------------------------------------------------ etap 7f: ratraki używane

export interface UsedGroomerOffer {
  id: string;
  typeId: string;
  ageYears: number;
  /** Stan 0–1 (1 – jak nowy). */
  condition: number;
  pricePln: number;
}

/** Oferty ratraków używanych w sezonie (ziarno gry + rok sezonu – te same dla tego samego sezonu). */
export function usedGroomerOffers(seed: number, seasonYear: number, sp: SnowmakingParams): UsedGroomerOffer[] {
  const u = sp.groomers.used;
  const rng = new Rng(seed).fork('ratraki-uzywane').fork(String(seasonYear));
  const out: UsedGroomerOffer[] = [];
  for (let k = 0; k < Math.round(u.offersPerSeason); k++) {
    const t = sp.groomers.types[rng.int(0, sp.groomers.types.length)];
    const age = Math.round(rng.range(u.ageMinYears, u.ageMaxYears));
    // Stan: im starszy, tym słabszy, z rozrzutem.
    const ageShare = (age - u.ageMinYears) / Math.max(1, u.ageMaxYears - u.ageMinYears);
    const condition = Math.round(Math.max(0.15, Math.min(1, 0.9 - 0.5 * ageShare + rng.range(-0.15, 0.15))) * 100) / 100;
    const price = t.pricePln * u.priceShareOfNew * (1 - u.priceConditionSpread / 2 + u.priceConditionSpread * condition);
    out.push({ id: `U${seasonYear}-${k + 1}`, typeId: t.id, ageYears: age, condition, pricePln: Math.round(price / 1000) * 1000 });
  }
  return out;
}

/** Zakup ratraka używanego z oferty sezonu. */
export function acquireUsedGroomer(state: GameState, offer: UsedGroomerOffer, sp: SnowmakingParams): string | null {
  const ops: OpsState = ensureOps(state);
  if ((ops.usedTaken ?? []).includes(offer.id)) return 'Ta oferta jest już sprzedana.';
  if (state.mode === 'career' && state.balancePln < offer.pricePln) return `Brak pieniędzy: używany ratrak kosztuje ${Math.round(offer.pricePln / 1000)} tys. zł.`;
  const t = groomerTypeById(sp, offer.typeId);
  const id = `R${ops.nextGroomerId++}`;
  ops.groomers.push({ id, typeId: offer.typeId, leased: false, boughtOn: formatIsoDate(state.date), ageAtPurchase: offer.ageYears, brokenNights: 0, condition: offer.condition });
  (ops.usedTaken ??= []).push(offer.id);
  if (state.mode === 'career') {
    state.balancePln -= offer.pricePln;
    state.pending.equipment += offer.pricePln;
  }
  state.log.push({ date: formatIsoDate(state.date), text: `Zakup używanego: ${t.name}, ${offer.ageYears} lat (${id})` });
  return null;
}

/**
 * Podgląd doby (bez zmiany stanu gry): to samo liczenie na kopii stanu – plan naśnieżania dnia
 * (chmury armatek na mapie), plan nocy z przewidywanym czasem zakończenia, moc chwilowa.
 */
export function previewDayOperations(i: DayOpsInput): DayOpsResult {
  return runDayOperations({ ...i, state: JSON.parse(JSON.stringify(i.state)) as GameState });
}
