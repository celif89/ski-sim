/**
 * Model śniegu w jednym punkcie (płaski, otwarty teren – jak ogródek meteorologiczny stacji)
 * z rzeczywistą pogodą dobową. Służy do kalibracji na pomiarach grubości śniegu IMGW.
 */
import type { ClimateProfile } from './climate';
import type { RadiationParams } from './radiation';
import { prepareSolarTerrain } from './radiation';
import type { SnowParams } from './snow';
import { classifySnow } from './snow';
import type { SnowQuality } from './snow';
import { SnowSeason, buildSolarCache, createSnowDomain } from './snowSeason';
import { TerrainGrid } from './terrainGrid';
import { computeSlopeAndAspect } from './terrainAnalysis';
import type { TimeZoneRule } from './time';
import type { CalendarDate, DailyWeather, WeatherParams } from './weather';

/** Obserwacje dobowe stacji (dane wejściowe modelu). */
export interface ObservedDay {
  date: CalendarDate;
  tMeanC: number;
  tMaxC: number;
  tMinC: number;
  /** Suma opadu z doby [mm]. */
  precipMm: number;
  cloudFraction: number;
  windMs: number;
  humidityPercent: number;
}

/** Kierunek wiatru przyjęty, gdy nie ma pomiaru (dominujący zimą na Pilsku: SW – Łajczak 1996). */
const DEFAULT_WIND_FROM_DEG = 225;

/**
 * Zamienia obserwacje na dni pogody modelu. Suma dobowa opadu rozłożona równo na całą dobę: godzin
 * opadu nie znamy, a każde inne założenie przesuwa średnią temperaturę opadu (np. opad „w południe”
 * padał w najcieplejszej porze, więc za często jako deszcz – w porównaniu z generatorem, w którym
 * pora opadu jest losowa, model na prawdziwej pogodzie dostawał przez to za mało śniegu).
 */
export function observedToDailyWeather(obs: ObservedDay[], profile: ClimateProfile, wp: WeatherParams): DailyWeather[] {
  void wp;
  return obs.map((o) => {
    const wet = o.precipMm >= profile.precipitation.wetDayThresholdMm;
    return {
      date: o.date,
      wet,
      precipitationMm: wet ? o.precipMm : 0,
      tMeanC: o.tMeanC,
      anomalyC: 0,
      diurnalRangeC: Math.max(1, o.tMaxC - o.tMinC),
      cloudFraction: o.cloudFraction,
      humidityPercent: o.humidityPercent,
      windMs: o.windMs,
      windFromDeg: DEFAULT_WIND_FROM_DEG,
      precipitationStartHour: 0,
      precipitationDurationHours: wet ? 24 : 0,
    };
  });
}

/** Profil przestawiony tak, żeby pogoda podana „na wysokości odniesienia” była pogodą w punkcie (obserwacje stacji). */
export function profileAtPoint(profile: ClimateProfile, elevationM: number): ClimateProfile {
  return { ...profile, referenceElevationM: elevationM, precipitation: { ...profile.precipitation, referenceElevationM: elevationM } };
}

export interface PointRunResult {
  dates: CalendarDate[];
  /** Grubość na koniec dnia [m]. */
  depthM: number[];
  sweMm: number[];
  densityKgM3: number[];
  quality: SnowQuality[];
}

export interface PointRunOptions {
  elevationM: number;
  latDeg: number;
  lonDeg: number;
  timeZone: TimeZoneRule;
  weather: DailyWeather[];
  profile: ClimateProfile;
  weatherParams: WeatherParams;
  snowParams: SnowParams;
  radiationParams: RadiationParams;
  /** Udział lasu 0–1 (domyślnie 0 – teren otwarty). */
  forest?: number;
  /**
   * true (domyślnie) – pogoda podana na wysokości punktu (obserwacje stacji); false – pogoda na
   * wysokościach odniesienia profilu (np. z generatora), przeliczana na wysokość punktu.
   */
  weatherAtPointElevation?: boolean;
}

/**
 * Liczy sezon w jednym punkcie (bez przewiewania – stacje stoją w miejscach osłoniętych).
 * Pogoda jest „na wysokości punktu”: profil przestawiony na tę wysokość.
 */
export function runPointSnow(o: PointRunOptions): PointRunResult {
  const grid = new TerrainGrid(2, 2, 10, new Float32Array(4).fill(o.elevationM));
  computeSlopeAndAspect(grid);
  const horizon = { directions: 4, angleDeg: new Float32Array(16), skyViewFactor: new Float32Array(4).fill(1) };
  const st = prepareSolarTerrain(grid, horizon);
  const location = { latDeg: o.latDeg, lonDeg: o.lonDeg, timeZone: o.timeZone };
  const days = o.weather.length - 1;
  const profile: ClimateProfile = o.weatherAtPointElevation === false ? o.profile : profileAtPoint(o.profile, o.elevationM);
  const solar = buildSolarCache(st, o.weather[0].date, days, location, o.radiationParams, o.snowParams);
  const forest = new Float32Array(4).fill(o.forest ?? 0);
  const domain = createSnowDomain(grid, forest, new Float32Array(4), o.snowParams);
  const season = new SnowSeason({
    domain,
    solar,
    weather: o.weather,
    profile,
    weatherParams: o.weatherParams,
    snowParams: o.snowParams,
    radiationParams: o.radiationParams,
    location,
    windRedistribution: false,
  });
  const result: PointRunResult = { dates: [], depthM: [], sweMm: [], densityKgM3: [], quality: [] };
  for (let d = 0; d < days; d++) {
    result.dates.push(o.weather[d].date);
    season.stepDay();
    result.depthM.push(season.state.depthM(0));
    result.sweMm.push(season.state.totalWater(0));
    result.densityKgM3.push(season.state.bulkDensity(0));
    result.quality.push(classifySnow(season.state, 0, o.snowParams));
  }
  return result;
}
