/**
 * Śnieg na mapie w grze: sezon liczony dzień po dzień w wątku obliczeń, z zapamiętywaniem stanów
 * co kilkanaście dni (szybki powrót do wcześniejszej daty). Pogoda – ta sama co w panelu pogody
 * (Environment), promieniowanie – z cieniami terenu.
 */
import type { Environment } from './environment';
import type { SnowParams } from './snow';
import { SNOW_QUALITY_CODES, SnowState, classifySnow, snowStep } from './snow';
import type { SnowBalance, SnowDomain } from './snow';
import type { SolarCache } from './snowSeason';
import { SnowSeason, createSnowDomain, solarCacheBuilder } from './snowSeason';
import type { SnowImpactParams } from './guestParams';
import { applySkierTraffic, decayMoguls, downhillNeighbors } from './skierTraffic';
import { addDays, daysBetween, formatIsoDate } from './time';
import type { SnowOps } from './snowOps';
import { applySnowOps, clampTechnical } from './snowOps';
import type { SnowmakingParams } from './snowmakingParams';
import type { CalendarDate } from './weather';

/** Co ile dni zapamiętywać stan (do cofania się w czasie). */
const SNAPSHOT_EVERY_DAYS = 15;

export interface SnowProgress {
  phase: 'radiation' | 'days' | 'hours';
  fraction: number;
  date?: CalendarDate;
}

export interface SnowSnapshot {
  date: CalendarDate;
  depthCm: Float32Array;
  sweMm: Float32Array;
  densityKgM3: Float32Array;
  /** Indeks w SNOW_QUALITY_CODES. */
  quality: Uint8Array;
  /** Muldy od narciarzy 0–255 (0–1). */
  moguls: Uint8Array;
  /** Etap 7: śnieg w pryzmach i śnieg techniczny w pokrywie, woda ciekła [mm]. */
  pileMm: Float32Array;
  techMm: Float32Array;
  liquidMm: Float32Array;
}

interface SeasonRun {
  startYear: number;
  solar: SolarCache;
  run: SnowSeason;
  snapshots: Map<number, { state: SnowState; balance: SnowBalance }>;
}

export class SnowWorld {
  domain: SnowDomain;
  /** Rośnie przy każdej zmianie pokrycia – liczenie zaczęte na starym pokryciu jest nieważne. */
  version = 0;
  private current: SeasonRun | null = null;
  /** Przejazdy gości w poszczególnych dniach (klucz – data RRRR-MM-DD); doliczane po kroku dnia. */
  private readonly traffic = new Map<string, Float32Array>();
  /** Etap 7: naśnieżanie i ratrakowanie z poszczególnych dni (klucz – data); doliczane po przejazdach. */
  private readonly ops = new Map<string, SnowOps>();
  /** Parametry naśnieżania – bez nich operacje są pomijane. */
  snowmaking: SnowmakingParams | null = null;
  private down: Int32Array | null = null;

  constructor(
    private readonly env: Environment,
    forest: Float32Array,
    shrub: Float32Array,
    private readonly sp: SnowParams,
    private readonly impact: SnowImpactParams | null = null,
  ) {
    this.domain = createSnowDomain(env.grid, forest, shrub, sp);
  }

  /** Krok jednego dnia + muldy (zanik) + ruch narciarzy z tego dnia (jeśli zapisany). */
  private stepDayWithTraffic(cur: SeasonRun): void {
    const s = cur.run.state;
    const mogulCells: number[] = [];
    const before: number[] = [];
    if (this.impact) {
      for (let k = 0; k < s.n; k++) {
        if (s.moguls[k] > 0) {
          mogulCells.push(k);
          before.push(s.totalWater(k));
        }
      }
    }
    cur.run.stepDay();
    const key = formatIsoDate(cur.run.dateOfLastDay());
    if (this.impact) {
      decayMoguls(cur.run.state, mogulCells, before, this.impact);
      const passes = this.traffic.get(key);
      if (passes) this.applyTraffic(cur.run.state, passes);
    }
    const ops = this.ops.get(key);
    if (ops && this.snowmaking) applySnowOps(cur.run.state, ops, this.sp, this.snowmaking);
    clampTechnical(cur.run.state);
  }

  private applyTraffic(state: SnowState, passes: Float32Array): void {
    if (!this.impact) return;
    const d = this.domain;
    if (!this.down) this.down = downhillNeighbors({ elevationM: d.elevationM, widthCells: d.widthCells, heightCells: d.heightCells, cellSizeM: d.cellSizeM });
    applySkierTraffic(state, { elevationM: d.elevationM, widthCells: d.widthCells, heightCells: d.heightCells, cellSizeM: d.cellSizeM }, this.down, passes, this.impact, this.sp);
  }

  /** Zapamiętane przejazdy gości (do zapisu gry). */
  trafficDays(): Map<string, Float32Array> {
    return this.traffic;
  }

  /**
   * Przejazdy gości w dniu `date` (koniec dnia). Gdy ten dzień jest właśnie ostatnim policzonym –
   * doliczane od razu; gdy policzono już dalej (albo ruch tego dnia był już doliczony) – sezon
   * cofa się do zapamiętanego stanu sprzed tego dnia i liczy dalej z ruchem.
   */
  setTraffic(date: CalendarDate, passes: Float32Array): void {
    const key = formatIsoDate(date);
    const had = this.traffic.has(key) || this.ops.has(key);
    this.traffic.set(key, passes);
    this.dayInputChanged(date, had, (st) => this.applyTraffic(st, passes));
  }

  /** Operacje dnia (naśnieżanie, ratrakowanie) – jak przejazdy: na koniec dnia, z cofnięciem w razie potrzeby. */
  setOperations(date: CalendarDate, ops: SnowOps): void {
    const key = formatIsoDate(date);
    const had = this.ops.has(key);
    this.ops.set(key, ops);
    this.dayInputChanged(date, had, (st) => {
      if (this.snowmaking) applySnowOps(st, ops, this.sp, this.snowmaking);
      clampTechnical(st);
    });
  }

  /** Zapamiętane operacje (do zapisu gry). */
  operationDays(): Map<string, SnowOps> {
    return this.ops;
  }

  private dayInputChanged(date: CalendarDate, had: boolean, applyNow: (s: SnowState) => void): void {
    const cur = this.current;
    if (!cur) return;
    const idx = daysBetween(addSeasonStart(cur, this.env), date);
    if (idx < 0 || idx >= cur.run.dayIndex) return; // jeszcze nie policzony – doliczy się w swoim kroku
    if (!had && idx === cur.run.dayIndex - 1) {
      applyNow(cur.run.state);
      if (cur.snapshots.has(cur.run.dayIndex)) cur.snapshots.set(cur.run.dayIndex, { state: cur.run.state.clone(), balance: { ...cur.run.balance } });
      this.version++;
      return;
    }
    // Cofnięcie do stanu sprzed tego dnia.
    for (const d of [...cur.snapshots.keys()]) if (d > idx && d !== 0) cur.snapshots.delete(d);
    let best = 0;
    for (const d of cur.snapshots.keys()) if (d <= idx && d > best) best = d;
    const snap = cur.snapshots.get(best)!;
    cur.run.state = snap.state.clone();
    cur.run.balance = { ...snap.balance };
    cur.run.dayIndex = best;
    this.version++;
  }

  /**
   * Doprowadza symulację do końca dnia `date`. Generator – po każdym etapie zwraca postęp,
   * żeby wątek mógł odpowiadać na inne pytania i pokazywać pasek postępu.
   */
  *advanceTo(date: CalendarDate): Generator<SnowProgress, void, void> {
    const env = this.env;
    const startYear = env.seasonStartYear(date);
    const { series, index } = env.weatherDay(date);
    if (!this.current || this.current.startYear !== startYear) {
      const days = series.length - 2;
      const builder = solarCacheBuilder(env.solar, series[0].date, days, env.location, env.radiationParams, this.sp);
      let solar: SolarCache;
      for (;;) {
        const r = builder.next();
        if (r.done) {
          solar = r.value;
          break;
        }
        yield { phase: 'radiation', fraction: r.value };
      }
      const run = new SnowSeason({
        domain: this.domain,
        solar,
        weather: series,
        profile: env.profile,
        weatherParams: env.weatherParams,
        snowParams: this.sp,
        radiationParams: env.radiationParams,
        location: env.location,
      });
      this.current = { startYear, solar, run, snapshots: new Map([[0, { state: run.state.clone(), balance: { ...run.balance } }]]) };
    }
    const cur = this.current;
    const target = Math.min(index + 1, series.length - 2);
    if (cur.run.dayIndex > target) {
      // Cofnięcie: najbliższy wcześniejszy zapamiętany stan.
      let best = 0;
      for (const d of cur.snapshots.keys()) if (d <= target && d > best) best = d;
      const snap = cur.snapshots.get(best)!;
      cur.run.state = snap.state.clone();
      cur.run.balance = { ...snap.balance };
      cur.run.dayIndex = best;
    }
    const from = cur.run.dayIndex;
    while (cur.run.dayIndex < target) {
      this.stepDayWithTraffic(cur);
      if (cur.run.dayIndex % SNAPSHOT_EVERY_DAYS === 0 && !cur.snapshots.has(cur.run.dayIndex)) {
        cur.snapshots.set(cur.run.dayIndex, { state: cur.run.state.clone(), balance: { ...cur.run.balance } });
      }
      yield { phase: 'days', fraction: (cur.run.dayIndex - from) / Math.max(1, target - from), date: cur.run.date };
    }
  }

  /**
   * Nowe pokrycie terenu (np. po wycince pod wyciąg lub trasę): sezon liczy się od nowa, ale
   * promieniowanie bezchmurnego nieba (zależne tylko od terenu) zostaje.
   */
  setLandCover(forest: Float32Array, shrub: Float32Array): void {
    // Nowa domena – także osłona od wiatru (drzewa jako przeszkoda, etap 6b).
    this.domain = createSnowDomain(this.env.grid, forest, shrub, this.sp);
    this.version++;
    const cur = this.current;
    if (!cur) return;
    const env = this.env;
    const { series } = env.weatherDay({ year: cur.startYear, month: env.weatherParams.seasonStartMonth, day: 1 });
    const run = new SnowSeason({
      domain: this.domain,
      solar: cur.solar,
      weather: series,
      profile: env.profile,
      weatherParams: env.weatherParams,
      snowParams: this.sp,
      radiationParams: env.radiationParams,
      location: env.location,
    });
    this.current = { startYear: cur.startYear, solar: cur.solar, run, snapshots: new Map([[0, { state: run.state.clone(), balance: { ...run.balance } }]]) };
  }

  /**
   * Etap 6b: śnieg na żywo w ciągu dnia `date` do godziny `hour` – od stanu z końca poprzedniego dnia
   * (liczonego krokami 6 h) kroki godzinowe z chwilowym nasłonecznieniem (cienie, chmury). Zapamiętuje
   * stan, więc kolejne godziny liczą się przyrostowo. Ruch gości i operacje dnia doliczane są na koniec
   * dnia (jak dotąd), więc o północy obraz przechodzi na stan z kroków 6 h.
   */
  *advanceLive(date: CalendarDate, hour: number): Generator<SnowProgress, void, void> {
    const env = this.env;
    const { index } = env.weatherDay(date);
    const h = Math.max(0, Math.min(24, Math.floor(hour)));
    if (index < 1) {
      yield* this.advanceTo(date);
      this.live = null;
      return;
    }
    yield* this.advanceTo(addDays(date, -1));
    const cur = this.current!;
    const key = formatIsoDate(date);
    const l = this.live;
    if (!l || l.key !== key || l.hour > h || l.version !== this.version || l.baseDay !== cur.run.dayIndex) {
      this.live = { key, date: { ...date }, hour: 0, version: this.version, baseDay: cur.run.dayIndex, state: cur.run.state.clone() };
    }
    const live = this.live!;
    const scratch = { precipitationMm: 0, runoffMm: 0, sublimationMm: 0, windOutMm: 0 };
    const startHour = live.hour;
    while (live.hour < h) {
      const sw = env.stateAt(date, live.hour + 0.5).insolationWm2;
      const f = cur.run.hourlyForcing(index, live.hour, sw);
      snowStep(live.state, this.domain, f, this.sp, scratch);
      live.hour++;
      yield { phase: 'hours', fraction: (live.hour - startHour) / Math.max(1, h - startHour), date };
    }
  }

  /** Stan na żywo z advanceLive (null – brak). */
  liveSnapshot(): (SnowSnapshot & { hour: number }) | null {
    const l = this.live;
    if (!l) return null;
    return { ...this.snapshotOf(l.state, l.date), hour: l.hour };
  }

  private live: { key: string; date: CalendarDate; hour: number; version: number; baseDay: number; state: SnowState } | null = null;

  /** Bieżący stan śniegu do pokazania na mapie. */
  snapshot(): SnowSnapshot {
    const cur = this.current;
    if (!cur) return this.snapshotOf(null, { year: 0, month: 1, day: 1 });
    return this.snapshotOf(cur.run.state, cur.run.dateOfLastDay());
  }

  private snapshotOf(state: SnowState | null, date: CalendarDate): SnowSnapshot {
    const n = this.domain.cellCount;
    const depthCm = new Float32Array(n);
    const sweMm = new Float32Array(n);
    const densityKgM3 = new Float32Array(n);
    const quality = new Uint8Array(n);
    const moguls = new Uint8Array(n);
    const pileMm = new Float32Array(n);
    const techMm = new Float32Array(n);
    const liquidMm = new Float32Array(n);
    if (state) {
      const s = state;
      for (let k = 0; k < n; k++) {
        if (this.domain.elevationM[k] !== this.domain.elevationM[k]) {
          depthCm[k] = Number.NaN;
          continue;
        }
        depthCm[k] = s.depthM(k) * 100;
        sweMm[k] = s.totalWater(k);
        densityKgM3[k] = s.bulkDensity(k);
        quality[k] = SNOW_QUALITY_CODES.indexOf(classifySnow(s, k, this.sp));
        moguls[k] = Math.round(Math.min(1, s.moguls[k]) * 255);
        pileMm[k] = s.pileMm[k];
        techMm[k] = s.techMm[k];
        liquidMm[k] = s.topLiquid[k] + s.botLiquid[k];
      }
    }
    return { date, depthCm, sweMm, densityKgM3, quality, moguls, pileMm, techMm, liquidMm };
  }
}

/** Liczba dni od 1 października do daty (pomocniczo do raportów). */
export function seasonDayIndex(seasonStart: CalendarDate, date: CalendarDate): number {
  return daysBetween(seasonStart, date);
}

/** Dzień o indeksie 0 bieżącego przebiegu sezonu. */
function addSeasonStart(cur: SeasonRun, _env: Environment): CalendarDate {
  return addDays(cur.run.dateOfLastDay(), 1 - cur.run.dayIndex);
}
