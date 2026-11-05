/**
 * Porównanie modelu śniegu z pomiarami grubości pokrywy na stacjach IMGW (Korbielów, Zawoja,
 * Laliki) – wspólne dla narzędzia kalibracji, raportu „przewiń zimę” i testów.
 */
import type { ClimateProfile } from './climate';
import type { RadiationParams } from './radiation';
import type { SnowParams } from './snow';
import type { ObservedDay } from './snowPoint';
import { observedToDailyWeather, runPointSnow } from './snowPoint';
import { snowFraction } from './snow';
import { addDays, parseIsoDate } from './time';
import type { CalendarDate, DailyWeather, Location, WeatherParams } from './weather';
import { dailyAtElevation, hourlyAt } from './weather';

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
  /** Dni, w których temperatura pochodzi z dalszej stacji (Bielsko-Biała) – zima mniej pewna do kalibracji. */
  temperatureFromBielskoDays?: number;
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

/** Dni pogody zmierzonej na stacji (wejście dla modelu). */
export function observedDays(w: StationWinterData): ObservedDay[] {
  const start = parseIsoDate(w.start);
  return w.tMeanC.map((_, d) => ({
    date: addDays(start, d),
    tMeanC: w.tMeanC[d],
    tMaxC: w.tMaxC[d],
    tMinC: w.tMinC[d],
    precipMm: w.precipMm[d],
    cloudFraction: w.cloudFraction[d],
    windMs: w.windMs[d],
    humidityPercent: w.humidityPercent[d],
  }));
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
      const weather = observedToDailyWeather(observedDays(w), profile, wp);
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

/** Stacje tylko z zimami, w których temperatura była mierzona na miejscu lub na sąsiedniej stacji. */
export function withMeasuredTemperature(stations: StationData[], maxSubstitutedDays: number): StationData[] {
  return stations.map((s) => ({ ...s, winters: s.winters.filter((w) => (w.temperatureFromBielskoDays ?? 0) <= maxSubstitutedDays) }));
}

/** Zima pełna: w okresie XI–IV brakuje najwyżej `maxMissingDays` pomiarów grubości śniegu. */
export function hasCompleteSnowRecord(w: StationWinterData, maxMissingDays: number): boolean {
  const start = parseIsoDate(w.start);
  let missing = 0;
  w.snowDepthCm.forEach((v, i) => {
    if (v === null && inEvalPeriod(addDays(start, i))) missing++;
  });
  return missing <= maxMissingDays;
}

/** Charakterystyka jednej zimy: dni z pokrywą i maksimum w XI–IV, pierwszy i ostatni dzień z pokrywą. */
export interface WinterSnowStats {
  coverDays: number;
  maxCm: number;
  /** Indeks dnia (od początku serii) pierwszego i ostatniego dnia z pokrywą ≥ 1 cm; −1 – brak pokrywy. */
  firstCoverDay: number;
  lastCoverDay: number;
}

export function winterSnowStats(dates: CalendarDate[], depthCm: (number | null)[]): WinterSnowStats {
  let coverDays = 0;
  let maxCm = 0;
  let firstCoverDay = -1;
  let lastCoverDay = -1;
  depthCm.forEach((v, i) => {
    if (v === null || v < COVER_CM) {
      if (v !== null && inEvalPeriod(dates[i]) && v > maxCm) maxCm = v;
      return;
    }
    if (firstCoverDay < 0) firstCoverDay = i;
    lastCoverDay = i;
    if (inEvalPeriod(dates[i])) {
      coverDays++;
      if (v > maxCm) maxCm = v;
    }
  });
  return { coverDays, maxCm, firstCoverDay, lastCoverDay };
}

/** Pogoda zimy (XI–IV) tak, jak „widzi” ją model śniegu – do porównania generatora z pomiarami. */
export interface WinterWeatherStats {
  tMeanC: number;
  precipMm: number;
  wetDays: number;
  /** Średnia temperatura ważona opadem (w jakiej temperaturze pada) [°C]. */
  precipWeightedTC: number;
  /** Opad w postaci śniegu wg temperatury godzinowej (bez poprawki na deszczomierz) [mm]. */
  snowfallMm: number;
  /** Suma dodatnich temperatur godzinowych / 24 [°C·doba] – energia odwilży. */
  positiveDegreeDays: number;
  /** Dni XII–II ze średnią > 0 °C. */
  thawDays: number;
}

export function winterWeatherStats(days: DailyWeather[], elevationM: number, profile: ClimateProfile, wp: WeatherParams, location: Location): WinterWeatherStats {
  const out: WinterWeatherStats = { tMeanC: 0, precipMm: 0, wetDays: 0, precipWeightedTC: 0, snowfallMm: 0, positiveDegreeDays: 0, thawDays: 0 };
  let n = 0;
  for (let i = 1; i < days.length - 1; i++) {
    const d = days[i];
    if (!inEvalPeriod(d.date)) continue;
    const a = dailyAtElevation(d, elevationM, profile, wp);
    n++;
    out.tMeanC += a.tMeanC;
    out.precipMm += a.precipitationMm;
    out.precipWeightedTC += a.precipitationMm * a.tMeanC;
    if (d.wet) out.wetDays++;
    if ((d.date.month === 12 || d.date.month <= 2) && a.tMeanC > 0) out.thawDays++;
    for (let h = 0; h < 24; h++) {
      const hw = hourlyAt(days[i - 1], d, days[i + 1], h + 0.5, elevationM, profile, wp, location);
      out.snowfallMm += hw.precipitationMm * snowFraction(hw.temperatureC, wp.snowMaxTemperatureC, wp.rainMinTemperatureC);
      if (hw.temperatureC > 0) out.positiveDegreeDays += hw.temperatureC / 24;
    }
  }
  out.tMeanC /= Math.max(1, n);
  out.precipWeightedTC /= Math.max(1e-9, out.precipMm);
  return out;
}
