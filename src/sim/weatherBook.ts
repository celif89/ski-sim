/**
 * Pogoda dla ekonomii (etap 6) bez terenu i słońca: ta sama seria dni co w Environment
 * (seasonWeather – ten sam seed), warunki dla gości w południe, prognoza wydana dzień wcześniej
 * (na niej goście decydują o przyjeździe). Lekka – do wątku widoku i trybu bez grafiki.
 */
import type { ClimateProfile } from './climate';
import { seasonWeather } from './environment';
import type { GuestConditions } from './guests';
import { daysBetween } from './time';
import type { CalendarDate, DailyWeather, ForecastDay, Location, WeatherParams } from './weather';
import { dailyAtElevation, hourlyAt, makeForecast } from './weather';

export interface DayWeather {
  /** Warunki w południe (dół i góra ośrodka) – do modelu zgrubnego dnia. */
  cond: GuestConditions;
  /** Średnia dobowa temperatura i wiatr na górze. */
  tMeanTopC: number;
  windTopMs: number;
}

export class WeatherBook {
  private readonly seasons = new Map<number, DailyWeather[]>();

  constructor(
    readonly profile: ClimateProfile,
    readonly weatherParams: WeatherParams,
    readonly seed: number,
    readonly location: Location,
    readonly bottomElevationM: number,
    readonly topElevationM: number,
  ) {}

  seasonStartYear(date: CalendarDate): number {
    return date.month >= this.weatherParams.seasonStartMonth ? date.year : date.year - 1;
  }

  series(startYear: number): DailyWeather[] {
    let s = this.seasons.get(startYear);
    if (!s) {
      s = seasonWeather(this.profile, this.weatherParams, this.seed, startYear);
      this.seasons.set(startYear, s);
      // Pamięć na 3 sezony wystarcza (bieżący, poprzedni dla prognozy, następny).
      if (this.seasons.size > 3) this.seasons.delete([...this.seasons.keys()].sort((a, b) => a - b)[0]);
    }
    return s;
  }

  private locate(date: CalendarDate): { series: DailyWeather[]; index: number } {
    const series = this.series(this.seasonStartYear(date));
    return { series, index: daysBetween(series[0].date, date) };
  }

  daily(date: CalendarDate): DailyWeather {
    const { series, index } = this.locate(date);
    return series[Math.max(0, Math.min(series.length - 1, index))];
  }

  day(date: CalendarDate): DayWeather {
    const { series, index } = this.locate(date);
    const i = Math.max(1, Math.min(series.length - 2, index));
    const prev = series[i - 1];
    const day = series[i];
    const next = series[i + 1];
    const at = (z: number) => hourlyAt(prev, day, next, 12, z, this.profile, this.weatherParams, this.location);
    const b = at(this.bottomElevationM);
    const t = at(this.topElevationM);
    const top = dailyAtElevation(day, this.topElevationM, this.profile, this.weatherParams);
    return {
      cond: {
        bottomElevM: this.bottomElevationM,
        topElevM: this.topElevationM,
        tempBottomC: b.temperatureC,
        tempTopC: t.temperatureC,
        windBottomMs: b.windMs,
        windTopMs: t.windMs,
        precipMmH: t.precipitationMm,
        rain: t.phase === 'rain' || b.phase === 'rain',
        cloud: b.cloudFraction,
      },
      tMeanTopC: top.tMeanC,
      windTopMs: top.windMs,
    };
  }

  /** Prognoza na `date` wydana dzień wcześniej (wyprzedzenie 1 dzień); temperatura na górze ośrodka. */
  forecastFor(date: CalendarDate): (ForecastDay & { topTMeanC: number; topWindMs: number }) | null {
    const { series, index } = this.locate(date);
    if (index < 1 || index >= series.length) return null;
    const f = makeForecast(series, index - 1, this.weatherParams, this.seed)[0];
    if (!f) return null;
    // Przeliczenie średniej temperatury i wiatru na górę jak w dailyAtElevation (prognoza podaje wartości odniesienia).
    const truth = series[index];
    const top = dailyAtElevation({ ...truth, tMeanC: f.tMeanC, windMs: f.windMs }, this.topElevationM, this.profile, this.weatherParams);
    return { ...f, topTMeanC: top.tMeanC, topWindMs: top.windMs };
  }
}
