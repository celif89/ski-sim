/**
 * Porównanie wielu wygenerowanych zim z profilem klimatycznym (dane IMGW) – wspólne dla testów
 * i raportu „przewiń zimy”.
 */
import type { ClimateProfile } from './climate';
import { readNumber, readNumberArray, readSection } from './params';
import type { DailyWeather, WeatherParams } from './weather';
import { generateSeason } from './weather';

export interface ValidationSettings {
  winters: number;
  toleranceSigma: number;
  months: number[];
}

export function parseValidationSettings(raw: unknown): ValidationSettings {
  const FILE = 'data/weather-generator.json';
  const v = readSection(raw, 'validation', FILE);
  return {
    winters: readNumber(v, 'winters', FILE, { integer: true, min: 1 }),
    toleranceSigma: readNumber(v, 'toleranceSigma', FILE, { min: 0 }),
    months: readNumberArray(v, 'months', FILE, { min: 1, max: 12 }),
  };
}

export interface MetricComparison {
  generated: number;
  observed: number;
  /** Dopuszczalna różnica (toleranceSigma × błąd średniej z N sezonów). */
  tolerance: number;
  ok: boolean;
}

export interface MonthComparison {
  month: number;
  temperatureC: MetricComparison;
  precipitationMm: MetricComparison;
  wetDays: MetricComparison;
}

export interface ValidationResult {
  winters: number;
  months: MonthComparison[];
  allOk: boolean;
  seasons: DailyWeather[][];
}

/** Generuje `winters` sezonów (lata startYear, startYear+1, …) i porównuje z profilem. */
export function validateWinters(
  profile: ClimateProfile,
  params: WeatherParams,
  settings: ValidationSettings,
  seed: number,
  startYear: number,
): ValidationResult {
  const seasons: DailyWeather[][] = [];
  for (let w = 0; w < settings.winters; w++) seasons.push(generateSeason(profile, params, seed, startYear + w));
  const n = settings.winters;
  const months: MonthComparison[] = settings.months.map((month) => {
    const temps: number[] = [];
    const totals: number[] = [];
    const wets: number[] = [];
    for (const season of seasons) {
      const days = season.filter((d) => d.date.month === month);
      if (days.length === 0) continue;
      temps.push(days.reduce((s, d) => s + d.tMeanC, 0) / days.length);
      totals.push(days.reduce((s, d) => s + d.precipitationMm, 0));
      wets.push(days.filter((d) => d.wet).length);
    }
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const cmp = (generated: number, observed: number, interannualStd: number): MetricComparison => {
      const tolerance = (settings.toleranceSigma * interannualStd) / Math.sqrt(n);
      return { generated, observed, tolerance, ok: Math.abs(generated - observed) <= tolerance };
    };
    const m = month - 1;
    return {
      month,
      temperatureC: cmp(mean(temps), profile.temperature.meanC[m], profile.temperature.observedMonthlyMeanStdC[m]),
      precipitationMm: cmp(mean(totals), profile.precipitation.observedMonthlyTotalMm[m], profile.precipitation.observedMonthlyTotalStdMm[m]),
      wetDays: cmp(mean(wets), profile.precipitation.observedWetDays[m], profile.precipitation.observedWetDaysStd[m]),
    };
  });
  return {
    winters: n,
    months,
    allOk: months.every((m) => m.temperatureC.ok && m.precipitationMm.ok && m.wetDays.ok),
    seasons,
  };
}
