/**
 * Jeden sezon śniegu na całej mapie z zapisem statystyk do raportu „przewiń zimę”:
 * grubość w punktach kontrolnych dzień po dniu, mapy w wybranych dniach, liczba dni z pokrywą,
 * maksimum grubości i dzień zaniku w każdej komórce.
 */
import type { ClimateProfile } from '../sim/climate';
import type { RadiationParams } from '../sim/radiation';
import type { SnowBalance, SnowDomain, SnowParams } from '../sim/snow';
import { SNOW_QUALITY_CODES, classifySnow } from '../sim/snow';
import type { SolarCache } from '../sim/snowSeason';
import { SnowSeason } from '../sim/snowSeason';
import type { DailyWeather, Location, WeatherParams } from '../sim/weather';

export interface SeasonRunInput {
  domain: SnowDomain;
  solar: SolarCache;
  /** Pogoda od 1. dnia sezonu (indeks 0). */
  weather: DailyWeather[];
  profile: ClimateProfile;
  weatherParams: WeatherParams;
  snowParams: SnowParams;
  radiationParams: RadiationParams;
  location: Location;
  /** Liczba dni do policzenia. */
  days: number;
  /** Zakres dni liczonych do statystyk sezonu [od, do) – indeksy dni. */
  statsFromDay: number;
  statsToDay: number;
  deepThresholdM: number;
  coverThresholdM: number;
  pointCells: number[];
  /** Po ilu policzonych dniach zapisać mapę grubości (stan o północy). */
  mapAfterDays: number[];
}

export interface SeasonRunOutput {
  /** Grubość [cm] na koniec każdego dnia, dla każdego punktu. */
  pointDepthCm: Float32Array[];
  pointSweMm: Float32Array[];
  /** Indeks stanu w SNOW_QUALITY_CODES. */
  pointQuality: Uint8Array[];
  /** Dni z grubością ≥ progu „głębokiej” pokrywy w zakresie statystyk. */
  deepDays: Uint16Array;
  /** Dni z pokrywą ≥ progu (1 cm) w zakresie statystyk. */
  coverDays: Uint16Array;
  /** Dni z pokrywą ≥ progu w całym policzonym okresie (jak „dni z pokrywą” w pracach o całym sezonie). */
  coverDaysAll: Uint16Array;
  /** Największa grubość w sezonie [cm]. */
  maxDepthCm: Float32Array;
  /** Indeks ostatniego dnia z pokrywą (−1 – brak pokrywy). */
  lastCoverDay: Int16Array;
  maps: Float32Array[];
  balance: SnowBalance;
  /** Woda w pokrywie na koniec [mm·komórka] – do bilansu. */
  storageMm: number;
  /** Liczba komórek mapy (bez „poza mapą”). */
  validCells: number;
  elapsedMs: number;
}

export function runSeasonStats(o: SeasonRunInput): SeasonRunOutput {
  const t0 = performance.now();
  const n = o.domain.cellCount;
  const season = new SnowSeason({
    domain: o.domain,
    solar: o.solar,
    weather: o.weather,
    profile: o.profile,
    weatherParams: o.weatherParams,
    snowParams: o.snowParams,
    radiationParams: o.radiationParams,
    location: o.location,
  });
  const out: SeasonRunOutput = {
    pointDepthCm: o.pointCells.map(() => new Float32Array(o.days)),
    pointSweMm: o.pointCells.map(() => new Float32Array(o.days)),
    pointQuality: o.pointCells.map(() => new Uint8Array(o.days)),
    deepDays: new Uint16Array(n),
    coverDays: new Uint16Array(n),
    coverDaysAll: new Uint16Array(n),
    maxDepthCm: new Float32Array(n),
    lastCoverDay: new Int16Array(n).fill(-1),
    maps: [],
    balance: season.balance,
    storageMm: 0,
    validCells: 0,
    elapsedMs: 0,
  };
  const z = o.domain.elevationM;
  for (let d = 0; d < o.days; d++) {
    season.stepDay();
    const s = season.state;
    const inStats = d >= o.statsFromDay && d < o.statsToDay;
    for (let k = 0; k < n; k++) {
      if (z[k] !== z[k]) continue;
      const depth = s.depthM(k);
      if (depth >= o.coverThresholdM) {
        out.lastCoverDay[k] = d;
        out.coverDaysAll[k]++;
        if (inStats) out.coverDays[k]++;
        if (inStats && depth >= o.deepThresholdM) out.deepDays[k]++;
      }
      if (depth * 100 > out.maxDepthCm[k]) out.maxDepthCm[k] = depth * 100;
    }
    o.pointCells.forEach((k, i) => {
      out.pointDepthCm[i][d] = s.depthM(k) * 100;
      out.pointSweMm[i][d] = s.totalWater(k);
      out.pointQuality[i][d] = SNOW_QUALITY_CODES.indexOf(classifySnow(s, k, o.snowParams));
    });
    if (o.mapAfterDays.includes(d + 1)) {
      const map = new Float32Array(n);
      for (let k = 0; k < n; k++) map[k] = z[k] !== z[k] ? Number.NaN : s.depthM(k) * 100;
      out.maps.push(map);
    }
  }
  out.balance = season.balance;
  for (let k = 0; k < n; k++) {
    if (z[k] !== z[k]) continue;
    out.storageMm += season.state.totalWater(k);
    out.validCells++;
  }
  out.elapsedMs = performance.now() - t0;
  return out;
}
