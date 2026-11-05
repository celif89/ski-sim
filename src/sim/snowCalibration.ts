/**
 * Porównanie modelu śniegu z pomiarami grubości pokrywy na stacjach IMGW (Korbielów, Zawoja,
 * Laliki) – wspólne dla narzędzia kalibracji, raportu „przewiń zimę” i testów.
 */
import type { ClimateProfile } from './climate';
import type { RadiationParams } from './radiation';
import type { SnowParams } from './snow';
import type { ObservedDay } from './snowPoint';
import { observedToDailyWeather, runPointSnow } from './snowPoint';
import { addDays, parseIsoDate } from './time';
import type { CalendarDate, WeatherParams } from './weather';

export interface StationWinterData {
  start: string;
  tMeanC: number[];
  tMaxC: number[];
  tMinC: number[];
  precipMm: number[];
  cloudFraction: number[];
  windMs: number[];
  humidityPercent: number[];
  snowDepthCm: (number | null)[];
}

export interface StationData {
  code: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  elevationM: number;
  winters: StationWinterData[];
}

export interface WinterComparison {
  station: string;
  start: CalendarDate;
  dates: CalendarDate[];
  observedCm: (number | null)[];
  modelCm: number[];
  /** Błędy liczone dla dni od 1 listopada do 30 kwietnia z pomiarem. */
  maeCm: number;
  biasCm: number;
  observedCoverDays: number;
  modelCoverDays: number;
  observedMaxCm: number;
  modelMaxCm: number;
}

export interface CalibrationSummary {
  winters: WinterComparison[];
  /** Średni błąd bezwzględny grubości [cm] (wszystkie stacje i zimy). */
  maeCm: number;
  biasCm: number;
  /** Średnia różnica liczby dni z pokrywą ≥ 1 cm (model − pomiar) i średnia jej wartość bezwzględna. */
  coverDaysBias: number;
  coverDaysMae: number;
  perStation: { station: string; maeCm: number; biasCm: number; coverDaysBias: number; winters: number }[];
}

/** Okres oceny: od 1 listopada do 30 kwietnia (sezon). */
const EVAL_FIRST_MONTH = 11;
const EVAL_LAST_MONTH = 4;
const COVER_CM = 1;

function inEvalPeriod(d: CalendarDate): boolean {
  return d.month >= EVAL_FIRST_MONTH || d.month <= EVAL_LAST_MONTH;
}

export function compareStations(
  stations: StationData[],
  profile: ClimateProfile,
  wp: WeatherParams,
  sp: SnowParams,
  rp: RadiationParams,
  timeZone = { standardOffsetHours: 1, euDaylightSaving: true },
): CalibrationSummary {
  const winters: WinterComparison[] = [];
  for (const st of stations) {
    for (const w of st.winters) {
      // Zimy bez żadnego pomiaru śniegu > 0 (brak obserwacji) – pomijamy.
      if (!w.snowDepthCm.some((v) => v !== null && v > 0)) continue;
      const start = parseIsoDate(w.start);
      const obs: ObservedDay[] = w.tMeanC.map((_, d) => ({
        date: addDays(start, d),
        tMeanC: w.tMeanC[d],
        tMaxC: w.tMaxC[d],
        tMinC: w.tMinC[d],
        precipMm: w.precipMm[d],
        cloudFraction: w.cloudFraction[d],
        windMs: w.windMs[d],
        humidityPercent: w.humidityPercent[d],
      }));
      const weather = observedToDailyWeather(obs, profile, wp);
      const run = runPointSnow({ elevationM: st.elevationM, latDeg: st.latDeg, lonDeg: st.lonDeg, timeZone, weather, profile, weatherParams: wp, snowParams: sp, radiationParams: rp });
      // Pomiar o 6 UTC dnia d ≈ stan modelu na koniec dnia d − 1.
      const dates: CalendarDate[] = [];
      const observedCm: (number | null)[] = [];
      const modelCm: number[] = [];
      let absSum = 0;
      let biasSum = 0;
      let n = 0;
      let obsCover = 0;
      let modelCover = 0;
      let obsMax = 0;
      let modelMax = 0;
      for (let d = 1; d < run.depthM.length; d++) {
        const date = run.dates[d];
        const m = run.depthM[d - 1] * 100;
        const o = w.snowDepthCm[d];
        dates.push(date);
        observedCm.push(o);
        modelCm.push(Math.round(m * 10) / 10);
        if (!inEvalPeriod(date) || o === null) continue;
        absSum += Math.abs(m - o);
        biasSum += m - o;
        n++;
        if (o >= COVER_CM) obsCover++;
        if (m >= COVER_CM) modelCover++;
        obsMax = Math.max(obsMax, o);
        modelMax = Math.max(modelMax, m);
      }
      winters.push({
        station: st.name,
        start,
        dates,
        observedCm,
        modelCm,
        maeCm: n ? absSum / n : 0,
        biasCm: n ? biasSum / n : 0,
        observedCoverDays: obsCover,
        modelCoverDays: modelCover,
        observedMaxCm: obsMax,
        modelMaxCm: modelMax,
      });
    }
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const perStation = [...new Set(winters.map((w) => w.station))].map((station) => {
    const ws = winters.filter((w) => w.station === station);
    return {
      station,
      maeCm: mean(ws.map((w) => w.maeCm)),
      biasCm: mean(ws.map((w) => w.biasCm)),
      coverDaysBias: mean(ws.map((w) => w.modelCoverDays - w.observedCoverDays)),
      winters: ws.length,
    };
  });
  return {
    winters,
    maeCm: mean(winters.map((w) => w.maeCm)),
    biasCm: mean(winters.map((w) => w.biasCm)),
    coverDaysBias: mean(winters.map((w) => w.modelCoverDays - w.observedCoverDays)),
    coverDaysMae: mean(winters.map((w) => Math.abs(w.modelCoverDays - w.observedCoverDays))),
    perStation,
  };
}
