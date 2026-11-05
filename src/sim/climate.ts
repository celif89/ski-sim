/**
 * Profil klimatyczny lokalizacji (data/climate/<lokalizacja>.json, wynik npm run import-climate):
 * odczyt i płynna interpolacja wartości miesięcznych na dowolny dzień roku.
 */
import { readNumber, readNumberArray, readSection } from './params';

const M = 12;

export interface ClimateProfile {
  referenceElevationM: number;
  temperature: {
    meanC: number[];
    lapseRateCPer100m: number[];
    dailyAnomalyStdC: number[];
    observedMonthlyMeanStdC: number[];
    anomalyAutocorrelation: number[];
    wetDayAnomalyC: number[];
    dryDayAnomalyC: number[];
    /** Zmiana odchylenia temperatury dnia z opadem między najsłabszym a najsilniejszym opadem (percentyl 0 → 1) [°C]. */
    wetDayAnomalyPerPercentileC: number[];
    diurnalRangeDryC: number[];
    diurnalRangeWetC: number[];
    diurnalRangeChangePer100m: number[];
  };
  precipitation: {
    wetDayThresholdMm: number;
    referenceElevationM: number;
    pWetAfterDry: number[];
    pWetAfterWet: number[];
    gammaShape: number[];
    gammaScaleMm: number[];
    observedMonthlyTotalMm: number[];
    observedMonthlyTotalStdMm: number[];
    observedWetDays: number[];
    observedWetDaysStd: number[];
    elevationGradientPercentPer100m: number;
  };
  humidity: { meanDryPercent: number[]; meanWetPercent: number[]; stdPercent: number[] };
  cloud: { meanDryFraction: number[]; meanWetFraction: number[]; stdDryFraction: number[]; stdWetFraction: number[] };
  wind: {
    meanSpeedMs: number[];
    speedStdMs: number[];
    growthPer1000m: number[];
    /** [miesiąc][sektor 0..7: N, NE, E, SE, S, SW, W, NW] */
    directionFrequencies: number[][];
    directionPersistence: number;
  };
  /** Opis stacji (do raportu). */
  stations: Record<string, string>;
}

export function parseClimateProfile(raw: unknown, file = 'data/climate/pilsko.json'): ClimateProfile {
  const t = readSection(raw, 'temperature', file);
  const p = readSection(raw, 'precipitation', file);
  const h = readSection(raw, 'humidity', file);
  const c = readSection(raw, 'cloud', file);
  const w = readSection(raw, 'wind', file);
  const a = (s: Record<string, unknown>, k: string, opts: { min?: number; max?: number } = {}) =>
    readNumberArray(s, k, file, { length: M, ...opts });
  const dirEntry = w.directionFrequencies as { value?: unknown } | undefined;
  const dirs = dirEntry?.value;
  if (!Array.isArray(dirs) || dirs.length !== M || dirs.some((row) => !Array.isArray(row) || row.length !== 8)) {
    throw new Error(`${file}: wind.directionFrequencies – oczekiwano tablicy 12 × 8`);
  }
  const stationsRaw = (raw as Record<string, unknown>).stations;
  return {
    referenceElevationM: readNumber(raw as Record<string, unknown>, 'referenceElevationM', file),
    temperature: {
      meanC: a(t, 'meanC'),
      lapseRateCPer100m: a(t, 'lapseRateCPer100m'),
      dailyAnomalyStdC: a(t, 'dailyAnomalyStdC', { min: 0 }),
      observedMonthlyMeanStdC: a(t, 'observedMonthlyMeanStdC', { min: 0 }),
      anomalyAutocorrelation: a(t, 'anomalyAutocorrelation', { min: -1, max: 1 }),
      wetDayAnomalyC: a(t, 'wetDayAnomalyC'),
      dryDayAnomalyC: a(t, 'dryDayAnomalyC'),
      wetDayAnomalyPerPercentileC: a(t, 'wetDayAnomalyPerPercentileC'),
      diurnalRangeDryC: a(t, 'diurnalRangeDryC', { min: 0 }),
      diurnalRangeWetC: a(t, 'diurnalRangeWetC', { min: 0 }),
      diurnalRangeChangePer100m: a(t, 'diurnalRangeChangePer100m'),
    },
    precipitation: {
      wetDayThresholdMm: readNumber(p, 'wetDayThresholdMm', file, { min: 0 }),
      referenceElevationM: readNumber(p, 'referenceElevationM', file),
      pWetAfterDry: a(p, 'pWetAfterDry', { min: 0, max: 1 }),
      pWetAfterWet: a(p, 'pWetAfterWet', { min: 0, max: 1 }),
      gammaShape: a(p, 'gammaShape', { min: 0.01 }),
      gammaScaleMm: a(p, 'gammaScaleMm', { min: 0 }),
      observedMonthlyTotalMm: a(p, 'observedMonthlyTotalMm', { min: 0 }),
      observedMonthlyTotalStdMm: a(p, 'observedMonthlyTotalStdMm', { min: 0 }),
      observedWetDays: a(p, 'observedWetDays', { min: 0 }),
      observedWetDaysStd: a(p, 'observedWetDaysStd', { min: 0 }),
      elevationGradientPercentPer100m: readNumber(p, 'elevationGradientPercentPer100m', file),
    },
    humidity: { meanDryPercent: a(h, 'meanDryPercent'), meanWetPercent: a(h, 'meanWetPercent'), stdPercent: a(h, 'stdPercent') },
    cloud: {
      meanDryFraction: a(c, 'meanDryFraction', { min: 0, max: 1 }),
      meanWetFraction: a(c, 'meanWetFraction', { min: 0, max: 1 }),
      stdDryFraction: a(c, 'stdDryFraction', { min: 0 }),
      stdWetFraction: a(c, 'stdWetFraction', { min: 0 }),
    },
    wind: {
      meanSpeedMs: a(w, 'meanSpeedMs', { min: 0 }),
      speedStdMs: a(w, 'speedStdMs', { min: 0 }),
      growthPer1000m: a(w, 'growthPer1000m'),
      directionFrequencies: dirs as number[][],
      directionPersistence: readNumber(w, 'directionPersistence', file, { min: 0, max: 1 }),
    },
    stations: typeof stationsRaw === 'object' && stationsRaw !== null ? (stationsRaw as Record<string, string>) : {},
  };
}

/**
 * Wartość miesięczna interpolowana liniowo między środkami miesięcy (bez skoków na granicy
 * miesięcy). `dayInMonth` 1…31, `daysInMonth` – długość miesiąca.
 */
export function interpolateMonthly(values: number[], month: number, dayInMonth: number, daysInMonth: number): number {
  const pos = month - 1 + (dayInMonth - 0.5) / daysInMonth - 0.5; // 0 = środek stycznia
  const i0 = Math.floor(pos);
  const t = pos - i0;
  return values[(i0 + 12) % 12] * (1 - t) + values[(i0 + 13) % 12] * t;
}

/**
 * Węzły interpolacji zachowujące średnie miesięczne: przy interpolacji liniowej między środkami
 * miesięcy średnia z miesiąca to ¾·v_m + ⅛·(v_{m−1} + v_{m+1}). Węzły dobrane tak, żeby ta średnia
 * równała się wartości z profilu (iteracja, zbieżna, bo układ jest diagonalnie dominujący).
 */
export function meanPreservingNodes(monthlyMeans: number[]): number[] {
  let v = [...monthlyMeans];
  for (let iter = 0; iter < 100; iter++) {
    v = monthlyMeans.map((target, m) => {
      const prev = v[(m + 11) % 12];
      const next = v[(m + 1) % 12];
      return (target - (prev + next) / 8) / 0.75;
    });
  }
  return v;
}
