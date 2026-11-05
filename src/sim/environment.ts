/**
 * Środowisko ośrodka w danej chwili: Słońce, cienie, promieniowanie, pogoda (teraz i prognoza)
 * oraz pola temperatury i nasłonecznienia na całej mapie. Łączy moduły symulacji – używane przez
 * wątek obliczeń (Web Worker) i testy.
 */
import type { ClimateProfile } from './climate';
import { interpolateMonthly } from './climate';
import type { HorizonField } from './horizon';
import type { RadiationParams, SolarTerrain } from './radiation';
import { dailyRadiationSum, instantRadiation, prepareSolarTerrain } from './radiation';
import { sunDay, sunPosition } from './sun';
import type { TerrainGrid } from './terrainGrid';
import { MS_PER_HOUR, addDays, daysBetween, daysInMonth, localToUtcMs, utcMsToLocal } from './time';
import type { CalendarDate, DailyWeather, ForecastDay, HourlyWeather, Location, PrecipitationPhase, WeatherParams } from './weather';
import { dailyAtElevation, generateSeason, hourlyAt, makeForecast, precipitationPhase } from './weather';

/** Zapas dni na końcu serii pogody (żeby prognoza z końca sezonu miała dane). */
const FORECAST_MARGIN_DAYS = 10;
/** Seria pogody obejmuje cały rok od początku sezonu (także lato – np. podgląd słońca w czerwcu). */
const YEAR_DAYS = 366;

export interface PointWeather {
  elevationM: number;
  now: HourlyWeather;
  tMinC: number;
  tMaxC: number;
  dayPrecipitationMm: number;
  dayPhase: PrecipitationPhase;
}

export interface ForecastAtElevations extends ForecastDay {
  bottomTMeanC: number;
  topTMeanC: number;
  bottomPhase: PrecipitationPhase;
  topPhase: PrecipitationPhase;
}

export interface EnvironmentState {
  utcMs: number;
  date: CalendarDate;
  hour: number;
  summerTime: boolean;
  sun: { elevationDeg: number; azimuthDeg: number; sunriseHour: number | null; sunsetHour: number | null; noonElevationDeg: number };
  cloudFraction: number;
  bottom: PointWeather;
  top: PointWeather;
  forecast: ForecastAtElevations[];
  /** Promieniowanie całkowite na stok w tej chwili [W/m²] (NaN poza mapą). */
  insolationWm2: Float32Array;
  /** Temperatura powietrza w tej chwili [°C] (NaN poza mapą). */
  temperatureC: Float32Array;
}

/**
 * Pogoda sezonu gry (od początku sezonu przez rok + zapas na prognozę) – ta sama w grze
 * i w raportach.
 */
export function seasonWeather(profile: ClimateProfile, wp: WeatherParams, seed: number, startYear: number): DailyWeather[] {
  return generateSeason(profile, wp, seed, startYear, YEAR_DAYS + FORECAST_MARGIN_DAYS);
}

export class Environment {
  readonly solar: SolarTerrain;
  readonly bottomElevationM: number;
  readonly topElevationM: number;
  private readonly seasons = new Map<number, DailyWeather[]>();

  constructor(
    readonly grid: TerrainGrid,
    horizon: HorizonField,
    readonly profile: ClimateProfile,
    readonly weatherParams: WeatherParams,
    readonly radiationParams: RadiationParams,
    readonly seed: number,
    readonly location: Location,
  ) {
    this.solar = prepareSolarTerrain(grid, horizon);
    const { minM, maxM } = grid.elevationRangeM();
    this.bottomElevationM = Math.round(minM);
    this.topElevationM = Math.round(maxM);
  }

  /** Rok początku sezonu, do którego należy data (sezon od miesiąca seasonStartMonth). */
  seasonStartYear(date: CalendarDate): number {
    return date.month >= this.weatherParams.seasonStartMonth ? date.year : date.year - 1;
  }

  /** Pogoda dnia wraz z sąsiadami (dla przebiegu dobowego) i indeksem w serii. */
  weatherDay(date: CalendarDate): { series: DailyWeather[]; index: number } {
    const startYear = this.seasonStartYear(date);
    let series = this.seasons.get(startYear);
    if (!series) {
      series = seasonWeather(this.profile, this.weatherParams, this.seed, startYear);
      this.seasons.set(startYear, series);
    }
    const index = daysBetween(series[0].date, date);
    return { series, index };
  }

  private hourly(date: CalendarDate, hour: number, elevationM: number): HourlyWeather {
    const { series, index } = this.weatherDay(date);
    const day = series[index];
    const prev = series[Math.max(0, index - 1)];
    const next = series[Math.min(series.length - 1, index + 1)];
    return hourlyAt(prev, day, next, hour, elevationM, this.profile, this.weatherParams, this.location);
  }

  /** Zachmurzenie w chwili UTC (do sumy dobowej promieniowania). */
  cloudAt(utcMs: number): number {
    const local = utcMsToLocal(utcMs, this.location.timeZone);
    return this.hourly(local, local.hour, this.bottomElevationM).cloudFraction;
  }

  stateAt(date: CalendarDate, hour: number): EnvironmentState {
    const tz = this.location.timeZone;
    const utcMs = localToUtcMs({ ...date, hour }, tz);
    const local = utcMsToLocal(utcMs, tz);
    const sp = sunPosition(utcMs, this.location.latDeg, this.location.lonDeg);
    const sd = sunDay(date, this.location.latDeg, this.location.lonDeg, tz);
    const dayStart = localToUtcMs({ ...date, hour: 0 }, tz);
    const toHour = (ms: number | null) => (ms === null ? null : (ms - dayStart) / MS_PER_HOUR);

    const { series, index } = this.weatherDay(date);
    const day = series[index];
    const point = (elevationM: number): PointWeather => {
      const daily = dailyAtElevation(day, elevationM, this.profile, this.weatherParams);
      return {
        elevationM,
        now: this.hourly(date, hour, elevationM),
        tMinC: daily.tMinC,
        tMaxC: daily.tMaxC,
        dayPrecipitationMm: daily.precipitationMm,
        dayPhase: daily.phase,
      };
    };
    const bottom = point(this.bottomElevationM);
    const top = point(this.topElevationM);
    const cloudFraction = bottom.now.cloudFraction;

    // Temperatura jest liniowa względem wysokości (spadek i zmiana amplitudy są liniowe), więc
    // pole na całej mapie to interpolacja między dołem a górą.
    const temperatureC = new Float32Array(this.grid.cellCount);
    const dz = this.topElevationM - this.bottomElevationM || 1;
    const slope = (top.now.temperatureC - bottom.now.temperatureC) / dz;
    for (let k = 0; k < this.grid.cellCount; k++) {
      const z = this.grid.elevationM[k];
      temperatureC[k] = Number.isNaN(z) ? Number.NaN : bottom.now.temperatureC + slope * (z - this.bottomElevationM);
    }
    const insolationWm2 = instantRadiation(this.solar, utcMs, this.location.latDeg, this.location.lonDeg, cloudFraction, this.radiationParams);

    // Prognoza (wydana dziś) przeliczona na dół i górę ośrodka.
    const forecast = makeForecast(series, index, this.weatherParams, this.seed).map((f) => {
      const dim = daysInMonth(f.date.year, f.date.month);
      const lapse = interpolateMonthly(this.profile.temperature.lapseRateCPer100m, f.date.month, f.date.day, dim);
      const at = (z: number) => f.tMeanC + (lapse * (z - this.profile.referenceElevationM)) / 100;
      const phase = (t: number): PrecipitationPhase => (f.precipitationProbability >= 0.5 ? precipitationPhase(t, this.weatherParams) : 'none');
      return {
        ...f,
        bottomTMeanC: at(this.bottomElevationM),
        topTMeanC: at(this.topElevationM),
        bottomPhase: phase(at(this.bottomElevationM)),
        topPhase: phase(at(this.topElevationM)),
      };
    });

    return {
      utcMs,
      date: { year: local.year, month: local.month, day: local.day },
      hour: local.hour,
      summerTime: local.summerTime,
      sun: {
        elevationDeg: sp.elevationDeg,
        azimuthDeg: sp.azimuthDeg,
        sunriseHour: toHour(sd.sunriseUtcMs),
        sunsetHour: toHour(sd.sunsetUtcMs),
        noonElevationDeg: sd.noonElevationDeg,
      },
      cloudFraction,
      bottom,
      top,
      forecast,
      insolationWm2,
      temperatureC,
    };
  }

  /** Suma dobowa promieniowania [kWh/m²] z zachmurzeniem z generatora pogody. */
  dailyRadiation(date: CalendarDate, withClouds = true): Float32Array {
    return dailyRadiationSum(
      this.solar,
      date,
      this.location.latDeg,
      this.location.lonDeg,
      this.location.timeZone,
      this.radiationParams,
      withClouds ? (ms) => this.cloudAt(ms) : () => 0,
    );
  }
}

/** Data przesunięta o n dni (pomocniczo dla widoku). */
export function shiftDate(date: CalendarDate, n: number): CalendarDate {
  return addDays(date, n);
}
