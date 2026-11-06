/**
 * Doba naśnieżania i noc ratraków w grze (etap 7): infrastruktura z układu (zbiornik, ujęcie,
 * pompownia, przyłącze, garaż, kotwy, rurociągi z hydrantami, armatki), plan naśnieżania tras,
 * śnieg z armatek rozłożony z wiatrem (pryzmy), plan nocy ratraków (awarie, wyciągarka, czas pracy),
 * koszty (energia z taryfą nocną, woda, paliwo, operatorzy, serwis, leasing, naprawy), operacje na
 * śniegu dla modelu śniegu i podsumowanie dla paneli. Bez DOM – ta sama logika w grze i bez grafiki.
 */
import type { DayExtra, Flows, GameState, OpsState, OpsSummary, ResortFacts } from './economy';
import { ensureOps } from './economy';
import type { EconomyParams } from './economyParams';
import type { GroomPiste, GroomerUnit } from './grooming';
import { breakdownTonight, planNight } from './grooming';
import type { PointM } from './lifts';
import type { ResortAnalysis, ResortLayout } from './resort';
import { Rng } from './rng';
import type { GunFact, PisteSnowNeed } from './snowmaking';
import { connectPipelines, depositSnow, intakeRateM3h, pipelineHydrants, pumpHeadM, runSnowmakingDay, tariffPrice } from './snowmaking';
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

export interface OpsGrid {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  sampleElevationM(xM: number, yM: number): number;
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
}

const built = (state: GameState, id: string) => !state.construction[id];

export function infraFacts(layout: ResortLayout, analysis: ResortAnalysis, state: GameState, sp: SnowmakingParams, grid: OpsGrid): Infra {
  const ops = ensureOps(state);
  const out: Infra = { reservoirCapacityM3: 0, intakeM3h: 0, pumpCapacityM3h: 0, pump: null, pumpZ: 0, gridKw: 0, garageSlots: 0, anchors: [], guns: [], connected: new Map() };
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
  const infra = infraFacts(i.layout, i.analysis, state, sp, i.grid);
  const flows: Partial<Flows> = {};
  const add = (k: keyof Flows, v: number) => (flows[k] = (flows[k] ?? 0) + v);
  const cellM2 = i.grid.cellSizeM ** 2;
  const capacity = infra.reservoirCapacityM3;
  ops.reservoirM3 = Math.min(ops.reservoirM3, capacity);
  const precip = i.book.precipitationBefore(date, sp.water.precipWindowDays);
  const inflowM3h = capacity > 0 ? intakeRateM3h(infra.intakeM3h, date.month, precip, sp) : 0;
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
  const smd = runSnowmakingDay(
    {
      weather: (h, z) => i.book.hourAt(date, h, z),
      guns: canMake ? infra.guns : [],
      needs,
      reservoirM3: ops.reservoirM3,
      reservoirCapacityM3: capacity,
      inflowM3h,
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
  add('water', smd.waterM3 * sp.water.waterFeePlnPerM3);
  const snowOps = emptyOps();
  let offShare = 0;
  if (smd.snowKg > 0) {
    const mask = new Uint8Array(i.grid.widthCells * i.grid.heightCells);
    for (const a of i.analysis.pistes.values()) for (const k of a.cells) mask[k] = 1;
    const dep = depositSnow(smd, infra.guns, i.grid, mask, sp);
    snowOps.addSweMm = dep.addSweMm;
    snowOps.addDensityKgM3 = smd.meanDensityKgM3;
    snowOps.addLiquidFraction = smd.meanLiquidFraction;
    offShare = dep.offPisteKg / Math.max(1, dep.onPisteKg + dep.offPisteKg);
  }

  // ---- ratraki: awarie, plan nocy
  const rngBase = new Rng(state.seed).fork('ratraki').fork(iso);
  const broken: string[] = [];
  const units: GroomerUnit[] = [];
  for (const g of ops.groomers) {
    const type = groomerTypeById(sp, g.typeId);
    const age = g.ageAtPurchase + Math.max(0, daysBetween(parseIsoDate(g.boughtOn), date)) / 365;
    let available = g.brokenNights <= 0;
    if (available && i.snow && breakdownTonight(age, rngBase.fork(g.id), sp)) {
      available = false;
      g.brokenNights = sp.groomers.repairNights;
      broken.push(g.id);
      add('repairs', sp.groomers.repairCostPln);
    }
    units.push({ id: g.id, type, available });
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
  add('groomService', engineH * sp.groomers.servicePlnPerHour);
  if (date.day === 1) for (const g of ops.groomers) if (g.leased) add('leasing', groomerTypeById(sp, g.typeId).pricePln * sp.groomers.leaseMonthlyShare);
  for (const g of ops.groomers) if (g.brokenNights > 0 && !broken.includes(g.id)) g.brokenNights--;

  const gunHours: Record<string, [number, number, number, number][]> = {};
  for (const [id, gd] of smd.guns) gunHours[id] = gd.byHour.map((h) => [h.hour, Math.round((h.kg / Math.max(1, gd.densitySum / Math.max(1, gd.snowKg))) * 10) / 10, Math.round(h.windFromDeg), Math.round(h.windMs * 10) / 10]);
  const summary: OpsSummary = {
    date: iso,
    hourly: smd.hourly,
    gridLimitKw: infra.gridKw,
    reservoirCapacityM3: capacity,
    inflowM3: smd.intakeM3,
    snowM3: smd.snowM3,
    waterM3: smd.waterM3,
    energyKWh: smd.energyKWh,
    offPisteShare: offShare,
    gunHours,
    jobs: night.jobs.map((j) => ({ groomerId: j.groomerId, pisteId: j.pisteId, startH: j.startH, endH: j.endH, complete: j.complete, steepDone: j.steepDone, mode: j.mode })),
    unfinished: night.unfinished,
    steepSkipped: night.steepSkipped,
    finishH: night.finishH,
    fuelL: night.fuelL,
    broken,
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
export function acquireGroomer(state: GameState, typeId: string, leased: boolean, garageSlots: number, sp: SnowmakingParams): string | null {
  const ops: OpsState = ensureOps(state);
  if (ops.groomers.length >= garageSlots) return garageSlots === 0 ? 'Najpierw zbuduj garaż ratraków.' : 'Garaż pełny – zbuduj kolejny.';
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

/**
 * Podgląd doby (bez zmiany stanu gry): to samo liczenie na kopii stanu – plan naśnieżania dnia
 * (chmury armatek na mapie), plan nocy z przewidywanym czasem zakończenia, moc chwilowa.
 */
export function previewDayOperations(i: DayOpsInput): DayOpsResult {
  return runDayOperations({ ...i, state: structuredClone(i.state) });
}
