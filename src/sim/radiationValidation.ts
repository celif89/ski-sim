/**
 * Sprawdzenie modelu promieniowania na pomiarach aktynometrycznych IMGW: suma dobowa promieniowania
 * całkowitego na powierzchnię poziomą – pomiar i model (z dobowym zachmurzeniem ze stacji).
 */
import type { RadiationParams } from './radiation';
import { skyRadiation } from './radiation';
import { sunPosition } from './sun';
import { MS_PER_DAY, parseIsoDate } from './time';

export interface RadiationStationData {
  name: string;
  latDeg: number;
  lonDeg: number;
  elevationM: number;
  /** [data RRRR-MM-DD, suma dobowa kWh/m², zachmurzenie 0–1] */
  days: [string, number, number][];
}

export interface RadiationMonthStats {
  month: number;
  days: number;
  measuredKwhM2: number;
  modelKwhM2: number;
  biasPercent: number;
}

export interface RadiationStationStats {
  name: string;
  elevationM: number;
  months: RadiationMonthStats[];
  /** Sezon XI–IV. */
  winterBiasPercent: number;
  winterRmseKwhM2: number;
  winterMeasuredKwhM2: number;
  /** Dni prawie bezchmurne (C ≤ 0,25) i pochmurne (C ≥ 0,85) w sezonie XI–IV. */
  clearBiasPercent: number;
  overcastBiasPercent: number;
}

/** Krok całkowania sumy dobowej [min]. */
const STEP_MINUTES = 10;
const CLEAR_MAX_CLOUD = 0.25;
const OVERCAST_MIN_CLOUD = 0.85;
const WINTER_MONTHS = new Set([11, 12, 1, 2, 3, 4]);

/** Suma dobowa promieniowania całkowitego na poziom [kWh/m²] przy stałym zachmurzeniu. */
export function modelDailyGlobalHorizontal(date: { year: number; month: number; day: number }, latDeg: number, lonDeg: number, elevationM: number, cloud: number, p: RadiationParams): number {
  const start = Date.UTC(date.year, date.month - 1, date.day);
  const stepMs = STEP_MINUTES * 60_000;
  let wh = 0;
  for (let t = start + stepMs / 2; t < start + MS_PER_DAY; t += stepMs) {
    const sun = sunPosition(t, latDeg, lonDeg);
    if (sun.elevationDeg <= 0) continue;
    wh += skyRadiation(sun.elevationDeg, elevationM, cloud, sun.sunDistanceAu, p).globalHorizontalWm2 * (STEP_MINUTES / 60);
  }
  return wh / 1000;
}

export function validateRadiation(stations: RadiationStationData[], p: RadiationParams): RadiationStationStats[] {
  return stations.map((st) => {
    const byMonth = Array.from({ length: 12 }, () => ({ n: 0, meas: 0, model: 0 }));
    let wN = 0;
    let wMeas = 0;
    let wModel = 0;
    let wSq = 0;
    const clear = { meas: 0, model: 0 };
    const overcast = { meas: 0, model: 0 };
    for (const [iso, measured, cloud] of st.days) {
      const date = parseIsoDate(iso);
      const model = modelDailyGlobalHorizontal(date, st.latDeg, st.lonDeg, st.elevationM, cloud, p);
      const m = byMonth[date.month - 1];
      m.n++;
      m.meas += measured;
      m.model += model;
      if (WINTER_MONTHS.has(date.month)) {
        wN++;
        wMeas += measured;
        wModel += model;
        wSq += (model - measured) ** 2;
        if (cloud <= CLEAR_MAX_CLOUD) {
          clear.meas += measured;
          clear.model += model;
        } else if (cloud >= OVERCAST_MIN_CLOUD) {
          overcast.meas += measured;
          overcast.model += model;
        }
      }
    }
    const pct = (model: number, meas: number) => (meas > 0 ? (100 * (model - meas)) / meas : 0);
    return {
      name: st.name,
      elevationM: st.elevationM,
      months: byMonth.map((m, i) => ({
        month: i + 1,
        days: m.n,
        measuredKwhM2: m.n ? m.meas / m.n : 0,
        modelKwhM2: m.n ? m.model / m.n : 0,
        biasPercent: pct(m.model, m.meas),
      })),
      winterBiasPercent: pct(wModel, wMeas),
      winterRmseKwhM2: wN ? Math.sqrt(wSq / wN) : 0,
      winterMeasuredKwhM2: wN ? wMeas / wN : 0,
      clearBiasPercent: pct(clear.model, clear.meas),
      overcastBiasPercent: pct(overcast.model, overcast.meas),
    };
  });
}
