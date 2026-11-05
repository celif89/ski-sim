/**
 * Śnieg na mapie w grze: sezon liczony dzień po dzień w wątku obliczeń, z zapamiętywaniem stanów
 * co kilkanaście dni (szybki powrót do wcześniejszej daty). Pogoda – ta sama co w panelu pogody
 * (Environment), promieniowanie – z cieniami terenu.
 */
import type { Environment } from './environment';
import type { SnowParams } from './snow';
import { SNOW_QUALITY_CODES, SnowState, classifySnow } from './snow';
import type { SnowBalance, SnowDomain } from './snow';
import type { SolarCache } from './snowSeason';
import { SnowSeason, createSnowDomain, solarCacheBuilder } from './snowSeason';
import { daysBetween } from './time';
import type { CalendarDate } from './weather';

/** Co ile dni zapamiętywać stan (do cofania się w czasie). */
const SNAPSHOT_EVERY_DAYS = 15;

export interface SnowProgress {
  phase: 'radiation' | 'days';
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

  constructor(
    private readonly env: Environment,
    forest: Float32Array,
    shrub: Float32Array,
    private readonly sp: SnowParams,
  ) {
    this.domain = createSnowDomain(env.grid, forest, shrub, sp);
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
      cur.run.stepDay();
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
    this.domain = { ...this.domain, forest, shrub };
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

  /** Bieżący stan śniegu do pokazania na mapie. */
  snapshot(): SnowSnapshot {
    const cur = this.current;
    const n = this.domain.cellCount;
    const depthCm = new Float32Array(n);
    const sweMm = new Float32Array(n);
    const densityKgM3 = new Float32Array(n);
    const quality = new Uint8Array(n);
    if (cur) {
      const s = cur.run.state;
      for (let k = 0; k < n; k++) {
        if (this.domain.elevationM[k] !== this.domain.elevationM[k]) {
          depthCm[k] = Number.NaN;
          continue;
        }
        depthCm[k] = s.depthM(k) * 100;
        sweMm[k] = s.totalWater(k);
        densityKgM3[k] = s.bulkDensity(k);
        quality[k] = SNOW_QUALITY_CODES.indexOf(classifySnow(s, k, this.sp));
      }
    }
    // Data stanu = ostatni policzony dzień (koniec dnia).
    const date = cur ? cur.run.dateOfLastDay() : { year: 0, month: 1, day: 1 };
    return { date, depthCm, sweMm, densityKgM3, quality };
  }
}

/** Liczba dni od 1 października do daty (pomocniczo do raportów). */
export function seasonDayIndex(seasonStart: CalendarDate, date: CalendarDate): number {
  return daysBetween(seasonStart, date);
}
