/**
 * Gra bez grafiki (etap 6): pogoda (Environment), śnieg na mapie (SnowWorld – ten sam co w grze),
 * konkurencja, ekonomia dzień po dniu; dzień z gośćmi liczony modelem zgrubnym albo pełną symulacją
 * gości (GuestDay). Do testów, raportu 10 sezonów i sprawdzania zapisu/wczytania.
 */
import type { ClimateProfile } from './climate';
import type { CompetitorSeason } from './competition';
import { competitorSeason, competitorsOn } from './competition';
import type { CloseDayResult, DayContext, DayOutcome, Flows, GameMode, GameState, ResortFacts } from './economy';
import { agentOutcome, closeDay, newGameState, objectCosts, operationalLayout, parkingCapacityPersons, planDay, quickDayOutcome, reconcileConstruction, resortFacts, resortSnow, skiSeasonYear } from './economy';
import type { EconomyParams } from './economyParams';
import { Environment } from './environment';
import type { GroundParams } from './ground';
import type { GuestNet } from './guestNetwork';
import { buildGuestNet } from './guestNetwork';
import type { GuestParams } from './guestParams';
import { GuestDay } from './guests';
import type { HorizonField } from './horizon';
import type { LiftParams, PointM } from './lifts';
import type { PisteParams } from './pistes';
import type { RadiationParams } from './radiation';
import type { ClearingCost, ResortAnalysis, ResortLayout, RoadParams } from './resort';
import { analyzeResort, applyClearing } from './resort';
import type { SnowParams } from './snow';
import type { RidingParams } from './snowRiding';
import { thinField } from './snowRiding';
import type { SnowSnapshot } from './snowWorld';
import { SnowWorld } from './snowWorld';
import type { TerrainGrid } from './terrainGrid';
import { addDays, daysBetween, formatIsoDate } from './time';
import type { CalendarDate, Location, WeatherParams } from './weather';
import { WeatherBook } from './weatherBook';
import type { GameSave } from './gameSave';
import { makeSave } from './gameSave';
import type { DayOpsResult } from './operations';
import type { WaterContext } from './operations';
import type { SeasonExtras, SummerFacts, SummerOutcome, SummerPlan } from './summer';
import { seasonExtras } from './summer';
import { blockedPistes, runDayOperations } from './operations';
import type { SnowOps } from './snowOps';

export interface HeadlessGameOptions {
  grid: TerrainGrid;
  horizon: HorizonField;
  forest: Float32Array;
  shrub: Float32Array;
  profile: ClimateProfile;
  weatherParams: WeatherParams;
  radiationParams: RadiationParams;
  snowParams: SnowParams;
  guestParams: GuestParams;
  liftParams: LiftParams;
  pisteParams: PisteParams;
  clearing: ClearingCost;
  ground: GroundParams;
  riding: RidingParams;
  economy: EconomyParams;
  seed: number;
  location: Location;
  mode: GameMode;
  startDate: CalendarDate;
  /** Dni z pełną symulacją gości (zamiast modelu zgrubnego). */
  agentsOn?: (date: CalendarDate) => boolean;
  /** Decyzje „gracza” przed każdym dniem (otwarcie sezonu, ceny…). */
  policy?: (g: HeadlessGame) => void;
  mapName?: string;
  /** Etap 6b: drogi – parametry i drogi publiczne (brak – każdy parking ma dojazd). */
  roads?: RoadParams | null;
  publicRoads?: PointM[][] | null;
  /** Etap 6b: model wody (potoki, wodociąg, studnie, zlewnia); brak – uproszczony dopływ z ujęć. */
  water?: WaterContext | null;
  /** Etap 7b: dzień letni z symulacji gości (brak – model zgrubny). */
  summerAgents?: ((g: HeadlessGame, plan: SummerPlan, sf: SummerFacts) => SummerOutcome) | null;
}

export class HeadlessGame {
  readonly env: Environment;
  readonly book: WeatherBook;
  snow: SnowWorld;
  state: GameState;
  layout: ResortLayout;
  analysis: ResortAnalysis;
  net: GuestNet | null = null;
  facts: ResortFacts;
  private compCache: CompetitorSeason | null = null;
  private maskKey = '';
  private lastSnap: SnowSnapshot | null = null;
  private lastSnapDate = '';
  /** Wynik ostatniego dnia (do raportów). */
  last: CloseDayResult | null = null;
  lastOutcome: DayOutcome | null = null;
  lastOps: DayOpsResult | null = null;
  lastSummer: SeasonExtras | null = null;

  constructor(readonly o: HeadlessGameOptions, init?: { state: GameState; layout: ResortLayout; traffic?: Map<string, Float32Array>; ops?: Map<string, SnowOps> }) {
    const g = o.grid;
    const { minM, maxM } = g.elevationRangeM();
    this.env = new Environment(g, o.horizon, o.profile, o.weatherParams, o.radiationParams, o.seed, o.location);
    this.book = new WeatherBook(o.profile, o.weatherParams, o.seed, o.location, Math.round(minM), Math.round(maxM));
    this.snow = new SnowWorld(this.env, o.forest, o.shrub, o.snowParams, o.guestParams.snowImpact);
    this.state = init?.state ?? newGameState({ mode: o.mode, seed: o.seed, date: o.startDate, ep: o.economy });
    this.layout = init?.layout ?? { version: 1, lifts: [], pistes: [], bases: [], nextId: 1 };
    if (o.economy.snowmaking) this.snow.snowmaking = o.economy.snowmaking;
    if (init?.traffic) for (const [k, v] of init.traffic) this.snow.setTraffic(parseIso(k), v);
    if (init?.ops) for (const [k, v] of init.ops) this.snow.setOperations(parseIso(k), v);
    this.analysis = this.analyze();
    this.facts = this.refreshFacts();
    this.updateLandCover();
  }

  private analyze(): ResortAnalysis {
    const o = this.o;
    return analyzeResort(this.layout, { grid: o.grid, lifts: o.liftParams, pistes: o.pisteParams, clearing: o.clearing, forest: o.forest, shrub: o.shrub, ground: o.ground, roads: o.roads, publicRoads: o.publicRoads, summer: o.economy.summer ?? null });
  }

  /** Trasy zamknięte przez pryzmy / ratrakowanie w dzień (etap 7). */
  private blocked: Set<string> | null = null;

  private refreshFacts(): ResortFacts {
    const o = this.o;
    const op = operationalLayout(this.layout, this.state, this.blocked);
    this.net = buildGuestNet({
      layout: op,
      lifts: this.analysis.lifts,
      pistes: this.analysis.pistes,
      network: analyzeResort(op, { grid: o.grid, lifts: o.liftParams, pistes: o.pisteParams, clearing: o.clearing, forest: o.forest, shrub: o.shrub, roads: o.roads, publicRoads: o.publicRoads }).network,
      accessibleBases: this.analysis.accessibleBases,
      baseCapacityPersons: parkingCapacityPersons(op, o.economy),
      liftParams: o.liftParams,
      pisteParams: o.pisteParams,
      stationWalkRadiusM: o.guestParams.operation.stationWalkRadiusM,
      foodPoints: [],
      grid: { cellSizeM: o.grid.cellSizeM, widthCells: o.grid.widthCells, heightCells: o.grid.heightCells },
    });
    this.facts = resortFacts(this.layout, this.analysis, this.net, this.state, o.liftParams, o.economy, this.blocked);
    return this.facts;
  }

  /** Wycinka zmienia pokrycie – model śniegu liczy sezon od nowa (jak w grze). */
  private updateLandCover(): void {
    const mask = this.analysis.clearedMask;
    let key = 0;
    for (let k = 0; k < mask.length; k++) if (mask[k]) key = (key * 31 + k) | 0;
    if (String(key) === this.maskKey) return;
    this.maskKey = String(key);
    const cover = applyClearing(this.o.forest, this.o.shrub, mask);
    this.snow.setLandCover(cover.forest, cover.shrub);
    this.lastSnap = null;
  }

  /** Zmiana układu ośrodka (budowa): opłaty i budowy w czasie jak w grze. */
  setLayout(next: ResortLayout): { netPln: number; messages: string[] } {
    this.layout = JSON.parse(JSON.stringify(next)) as ResortLayout;
    this.analysis = this.analyze();
    const r = reconcileConstruction(this.state, objectCosts(this.layout, this.analysis, this.o.economy), this.o.economy);
    this.refreshFacts();
    this.updateLandCover();
    return r;
  }

  /** Śnieg na koniec dnia `date` (null latem – bez śniegu). */
  snowOn(date: CalendarDate): SnowSnapshot | null {
    if (date.month >= 5 && date.month <= 9) return null;
    const key = formatIsoDate(date);
    if (this.lastSnap && this.lastSnapDate === key) return this.lastSnap;
    const it = this.snow.advanceTo(date);
    while (!it.next().done) {
      /* liczy do końca dnia */
    }
    this.lastSnap = this.snow.snapshot();
    this.lastSnapDate = key;
    return this.lastSnap;
  }

  private competitors(date: CalendarDate) {
    const y = skiSeasonYear(date);
    if (!this.compCache || this.compCache.startYear !== y) {
      this.compCache = competitorSeason(y, {
        book: this.book,
        ep: this.o.economy,
        snowParams: this.o.snowParams,
        radiationParams: this.o.radiationParams,
        location: this.o.location,
        packedDensityKgM3: this.o.riding.packedDensityKgM3,
      });
    }
    return competitorsOn(this.compCache, date);
  }

  cellAt = (x: number, y: number): number => {
    const c = this.o.grid.cellAt(x, y);
    return c ? this.o.grid.index(c.i, c.j) : -1;
  };

  /** Kontekst dnia (fakty, śnieg na trasach, pogoda, prognoza, konkurencja). */
  context(date: CalendarDate): DayContext {
    const snap = this.snowOn(date);
    const snow = resortSnow(this.analysis, this.facts, snap ? { quality: snap.quality, sweMm: snap.sweMm, techMm: snap.techMm } : null, this.cellAt, this.o.riding, this.o.guestParams);
    return { date, facts: this.facts, snow, weather: this.book.day(date), forecast: this.book.forecastFor(date), competitors: this.competitors(date) };
  }

  /** Jeden dzień gry: decyzje, plan, goście (model zgrubny lub symulacja), zamknięcie dnia. */
  stepDay(): CloseDayResult {
    this.o.policy?.(this);
    const date = { ...this.state.date };
    this.blocked = blockedPistes(this.state, this.analysis, this.snowOn(date), this.cellAt, this.o.economy.snowmaking);
    this.refreshFacts();
    const ctx = this.context(date);
    const plan = planDay(this.state, ctx, this.o.economy);
    let outcome: DayOutcome;
    if (plan.open && plan.guests > 0 && this.net && this.o.agentsOn?.(date)) outcome = this.runAgents(ctx, plan.guests, plan.typeShares);
    else outcome = quickDayOutcome(this.state, plan, ctx, this.o.economy, this.o.guestParams);
    this.lastOutcome = outcome;
    const names = { ids: [...this.layout.lifts, ...this.layout.pistes, ...this.layout.bases, ...(this.layout.buildings ?? [])].map((x) => x.id), names: [...this.layout.lifts, ...this.layout.pistes, ...this.layout.bases, ...(this.layout.buildings ?? [])].map((x) => x.name) };
    // Etap 7: doba naśnieżania i noc ratraków (gdy są parametry naśnieżania).
    let extra = null;
    if (this.o.economy.snowmaking) {
      const snap = this.snowOn(date);
      const res = runDayOperations({
        state: this.state,
        layout: this.layout,
        analysis: this.analysis,
        facts: this.facts,
        grid: this.o.grid,
        cellAt: this.cellAt,
        snow: snap,
        book: this.book,
        ep: this.o.economy,
        riding: this.o.riding,
        date,
        water: this.o.water ?? null,
      });
      extra = res.extra;
      this.lastOps = res;
      if (res.ops.addSweMm || res.ops.groomGroup) {
        this.snow.setOperations(date, res.ops);
        this.lastSnap = null;
      }
    }
    // Etap 7b: dzień letni (gdy sezon letni otwarty), tor saneczkowy zimą, utrzymanie tras letnich, koszenie.
    if (this.o.economy.summer) {
      const ex = seasonExtras({
        state: this.state,
        layout: this.layout,
        trails: this.analysis.trails ?? new Map(),
        facts: this.facts,
        lp: this.o.liftParams,
        ep: this.o.economy,
        book: this.book,
        date,
        winterGuests: plan.open ? outcome.guests : 0,
        winterHours: Math.max(0, plan.hours.closeH - plan.hours.openH),
        agents: this.o.summerAgents ? (p, sf) => this.o.summerAgents!(this, p, sf) : null,
      });
      this.lastSummer = ex;
      extra ??= { flows: {}, snowM3: 0, waterM3: 0, snowKWh: 0, fuelL: 0, groomed: 0, unfinished: 0 };
      for (const [k, v] of Object.entries(ex.flows)) extra.flows[k as keyof Flows] = (extra.flows[k as keyof Flows] ?? 0) + (v ?? 0);
      extra.summer = ex.summer;
      extra.objectRevenue = ex.objectRevenue;
    }
    const r = closeDay(this.state, ctx, plan, outcome, this.o.economy, names, extra);
    if (r.finishedConstruction.length) this.refreshFacts();
    this.last = r;
    return r;
  }

  /** Pełna symulacja gości jednego dnia (jak w grze) + przejazdy do modelu śniegu. */
  private runAgents(ctx: DayContext, guests: number, typeShares: number[]): DayOutcome {
    const o = this.o;
    const date = ctx.date;
    const day = new GuestDay(this.net!, o.guestParams, { seed: o.seed, date, guests, elevationM: o.grid.elevationM, hours: this.state.hours, typeShares });
    day.setConditions(ctx.weather.cond);
    const snap = this.snowOn(date);
    if (snap) {
      const thin = this.analysis.ground ? thinField(snap.sweMm, this.analysis.ground, o.riding) : null;
      day.setSnow({ quality: snap.quality, depthCm: snap.depthCm, moguls: Float32Array.from(snap.moguls, (v) => v / 255), thin });
    }
    day.advanceTo(24 * 3600);
    const out = agentOutcome(day.economySummary(), this.facts);
    this.snow.setTraffic(date, day.passes.slice());
    this.lastSnap = null;
    return out;
  }

  runUntil(date: CalendarDate, onDay?: (r: CloseDayResult) => void): void {
    while (daysBetween(this.state.date, date) > 0) {
      const r = this.stepDay();
      onDay?.(r);
    }
  }

  save(savedAt = '2026-01-01T00:00:00Z'): GameSave {
    return makeSave(this.state, this.layout, this.snow.trafficDays(), this.o.mapName ?? 'pilsko', savedAt, this.snow.operationDays());
  }
}

function parseIso(s: string): CalendarDate {
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/** Następny dzień po dacie (pomocniczo). */
export function nextDay(d: CalendarDate): CalendarDate {
  return addDays(d, 1);
}
