/**
 * Generator pogody z ziarnem (seed) – dzień po dniu, potem rozkład na godziny i wysokości.
 *
 * Dzień (na wysokości odniesienia profilu klimatycznego):
 *  – opad: łańcuch Markowa (dzień mokry po suchym / po mokrym) + suma dobowa z rozkładu gamma,
 *  – temperatura: norma dnia + przesunięcie dla dnia mokrego/suchego + odchylenie z pamięcią
 *    z dnia na dzień (proces AR(1)),
 *  – zachmurzenie i wilgotność zależne od tego, czy pada,
 *  – wiatr: prędkość (rozkład log-normalny) i kierunek (częstości sektorów + trwałość kierunku).
 * Godziny i wysokość: temperatura ze spadkiem z wysokością i przebiegiem dobowym (minimum o wschodzie
 * Słońca, maksimum po południu), opad rosnący z wysokością, rodzaj opadu (śnieg / deszcz ze śniegiem /
 * deszcz) z temperatury na danej wysokości – więc na górze może padać śnieg, a na dole deszcz.
 *
 * Rozszerzenia (etap 8 – anomalie): lista `modifiers` wywoływana po wygenerowaniu każdego dnia
 * może zmienić dzień (np. fala ciepła, halny). Teraz pusta.
 */
import type { ClimateProfile } from './climate';
import { interpolateMonthly, meanPreservingNodes } from './climate';
import { readNumber, readSection } from './params';
import { Rng } from './rng';
import { sunDay } from './sun';
import type { TimeZoneRule } from './time';
import { addDays, daysInMonth, localToUtcMs } from './time';

export type PrecipitationPhase = 'none' | 'snow' | 'sleet' | 'rain';

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Pogoda jednego dnia na wysokości odniesienia. */
export interface DailyWeather {
  date: CalendarDate;
  wet: boolean;
  /** Suma dobowa opadu na wysokości odniesienia opadu [mm]. */
  precipitationMm: number;
  /** Średnia dobowa temperatura na wysokości odniesienia [°C]. */
  tMeanC: number;
  /** Odchylenie od normy (część losowa z pamięcią) [°C]. */
  anomalyC: number;
  /** Amplituda dobowa na wysokości odniesienia [°C]. */
  diurnalRangeC: number;
  /** Zachmurzenie 0–1 (średnie dobowe). */
  cloudFraction: number;
  humidityPercent: number;
  /** Średnia dobowa prędkość wiatru na wysokości odniesienia [m/s]. */
  windMs: number;
  /** Kierunek, z którego wieje wiatr [°]. */
  windFromDeg: number;
  /** Godzina (lokalna) początku opadu i czas trwania [h]. */
  precipitationStartHour: number;
  precipitationDurationHours: number;
}

export interface WeatherParams {
  seasonStartMonth: number;
  seasonLengthDays: number;
  snowMaxTemperatureC: number;
  rainMinTemperatureC: number;
  maxTemperatureHourLocal: number;
  minPrecipitationDurationHours: number;
  maxPrecipitationDurationHours: number;
  precipitationCloudFraction: number;
  windDiurnalAmplitude: number;
  humidityPerDegreeC: number;
  precipitationDurationHalfSaturationScales: number;
  precipitationDurationNoise: number;
  rainHumidityMinPercent: number;
  humidityDailyNoiseFraction: number;
  windDirectionJitterDeg: number;
  forecast: {
    days: number;
    temperatureErrorDay1C: number;
    temperatureErrorGrowthPerDayC: number;
    precipitationMissDay1: number;
    precipitationMissGrowthPerDay: number;
    precipitationAmountErrorDay1: number;
    precipitationAmountErrorGrowthPerDay: number;
    cloudErrorDay1: number;
    cloudErrorGrowthPerDay: number;
    windErrorGrowthPerDay: number;
    precipitationProbabilityMinConfidence: number;
  };
}

const FILE = 'data/weather-generator.json';
/** Fizyczne granice wilgotności względnej używane przy losowaniu [%]. */
const MIN_HUMIDITY_PERCENT = 15;
const POLAR_FALLBACK_MIN_HOUR = 6;
/** Pamięć godzin wschodu Słońca (liczenie wschodu jest kosztowne, a dni się powtarzają). */
const SUNRISE_CACHE = new Map<string, number>();
const SUNRISE_CACHE_MAX = 20_000;

export function parseWeatherParams(raw: unknown): WeatherParams {
  const s = readSection(raw, 'season', FILE);
  const ph = readSection(raw, 'precipitationPhase', FILE);
  const h = readSection(raw, 'hourly', FILE);
  const wd = readSection(raw, 'windDirection', FILE);
  const hu = readSection(raw, 'humidity', FILE);
  const f = readSection(raw, 'forecast', FILE);
  const n = (sec: Record<string, unknown>, k: string, o: { min?: number; max?: number; integer?: boolean } = {}) => readNumber(sec, k, FILE, o);
  const params: WeatherParams = {
    seasonStartMonth: n(s, 'startMonth', { integer: true, min: 1, max: 12 }),
    seasonLengthDays: n(s, 'lengthDays', { integer: true, min: 1, max: 366 }),
    snowMaxTemperatureC: n(ph, 'snowMaxTemperatureC'),
    rainMinTemperatureC: n(ph, 'rainMinTemperatureC'),
    maxTemperatureHourLocal: n(h, 'maxTemperatureHourLocal', { min: 10, max: 18 }),
    minPrecipitationDurationHours: n(h, 'minPrecipitationDurationHours', { min: 1, max: 24 }),
    maxPrecipitationDurationHours: n(h, 'maxPrecipitationDurationHours', { min: 1, max: 24 }),
    precipitationCloudFraction: n(h, 'precipitationCloudFraction', { min: 0, max: 1 }),
    windDiurnalAmplitude: n(h, 'windDiurnalAmplitude', { min: 0, max: 1 }),
    humidityPerDegreeC: n(h, 'humidityPerDegreeC', { min: 0 }),
    precipitationDurationHalfSaturationScales: n(h, 'precipitationDurationHalfSaturationScales', { min: 0 }),
    precipitationDurationNoise: n(h, 'precipitationDurationNoise', { min: 0, max: 1 }),
    rainHumidityMinPercent: n(h, 'rainHumidityMinPercent', { min: 0, max: 100 }),
    humidityDailyNoiseFraction: n(hu, 'dailyNoiseFraction', { min: 0, max: 1 }),
    windDirectionJitterDeg: n(wd, 'dailyJitterDeg', { min: 0, max: 90 }),
    forecast: {
      days: n(f, 'days', { integer: true, min: 1, max: 16 }),
      temperatureErrorDay1C: n(f, 'temperatureErrorDay1C', { min: 0 }),
      temperatureErrorGrowthPerDayC: n(f, 'temperatureErrorGrowthPerDayC', { min: 0 }),
      precipitationMissDay1: n(f, 'precipitationMissDay1', { min: 0, max: 0.5 }),
      precipitationMissGrowthPerDay: n(f, 'precipitationMissGrowthPerDay', { min: 0 }),
      precipitationAmountErrorDay1: n(f, 'precipitationAmountErrorDay1', { min: 0 }),
      precipitationAmountErrorGrowthPerDay: n(f, 'precipitationAmountErrorGrowthPerDay', { min: 0 }),
      cloudErrorDay1: n(f, 'cloudErrorDay1', { min: 0 }),
      cloudErrorGrowthPerDay: n(f, 'cloudErrorGrowthPerDay', { min: 0 }),
      windErrorGrowthPerDay: n(f, 'windErrorGrowthPerDay', { min: 0 }),
      precipitationProbabilityMinConfidence: n(f, 'precipitationProbabilityMinConfidence', { min: 0, max: 1 }),
    },
  };
  if (params.rainMinTemperatureC <= params.snowMaxTemperatureC) throw new Error(`${FILE}: rainMinTemperatureC musi być większe od snowMaxTemperatureC`);
  if (params.maxPrecipitationDurationHours < params.minPrecipitationDurationHours) throw new Error(`${FILE}: zły zakres czasu trwania opadu`);
  return params;
}

/** Losowanie z rozkładu gamma (Marsaglia i Tsang 2000; dla kształtu < 1 – wzmocnienie). */
export function sampleGamma(rng: Rng, shape: number, scale: number): number {
  if (shape < 1) return sampleGamma(rng, shape + 1, scale) * rng.next() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = rng.normal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.next();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

/** Zmiana dnia przez moduł anomalii (etap 8). */
export interface WeatherModifier {
  apply(day: DailyWeather, rng: Rng): void;
}

/** Stan generatora przenoszony z dnia na dzień. */
interface GeneratorState {
  wet: boolean;
  residualC: number;
  sector: number;
}

/**
 * Generuje pogodę dzień po dniu od `startDate` przez `days` dni. Ten sam seed i te same daty
 * dają zawsze tę samą pogodę.
 */
export function generateDailyWeather(
  profile: ClimateProfile,
  params: WeatherParams,
  rng: Rng,
  startDate: CalendarDate,
  days: number,
  modifiers: WeatherModifier[] = [],
): DailyWeather[] {
  const out: DailyWeather[] = [];
  const t = profile.temperature;
  const p = profile.precipitation;
  // Norma temperatury: płynna krzywa, ale ze średnimi miesięcznymi dokładnie jak w profilu.
  const meanNodes = meanPreservingNodes(t.meanC);
  // Parametry opadu – stałe w obrębie miesiąca (płynne przejście zawyżałoby sumy w miesiącach
  // sąsiadujących z dużą zmianą, np. kwiecień → maj).
  const monthly = (v: number[], month: number) => v[month - 1];
  const state: GeneratorState = { wet: false, residualC: 0, sector: 0 };
  // Stan początkowy z rozkładów klimatycznych pierwszego dnia.
  {
    const dim = daysInMonth(startDate.year, startDate.month);
    const mi = (v: number[]) => interpolateMonthly(v, startDate.month, startDate.day, dim);
    const p01 = monthly(p.pWetAfterDry, startDate.month);
    const p11 = monthly(p.pWetAfterWet, startDate.month);
    state.wet = rng.next() < p01 / (1 - p11 + p01);
    state.residualC = rng.normal(0, mi(t.dailyAnomalyStdC));
    state.sector = sampleSector(profile.wind.directionFrequencies[startDate.month - 1], rng);
  }
  for (let n = 0; n < days; n++) {
    const date = addDays(startDate, n);
    const dim = daysInMonth(date.year, date.month);
    const mi = (v: number[]) => interpolateMonthly(v, date.month, date.day, dim);
    // Opad.
    const pWet = state.wet ? monthly(p.pWetAfterWet, date.month) : monthly(p.pWetAfterDry, date.month);
    const wet = rng.next() < pWet;
    const gammaScale = monthly(p.gammaScaleMm, date.month);
    const precipitationMm = wet ? p.wetDayThresholdMm + sampleGamma(rng, monthly(p.gammaShape, date.month), gammaScale) : 0;
    // Temperatura.
    const phi = mi(t.anomalyAutocorrelation);
    const sigma = mi(t.dailyAnomalyStdC);
    const residualC = phi * state.residualC + Math.sqrt(1 - phi * phi) * sigma * rng.normal();
    // Przesunięcie dla dnia mokrego/suchego, wyśrodkowane tak, żeby średnio po wszystkich dniach
    // było zero (statystyki pochodzą ze stacji o nieco innej częstości opadu niż posterunek opadowy).
    const p01m = monthly(p.pWetAfterDry, date.month);
    const pStationaryWet = p01m / (1 - monthly(p.pWetAfterWet, date.month) + p01m);
    const wetShift = mi(t.wetDayAnomalyC);
    const dryShift = mi(t.dryDayAnomalyC);
    const shiftMean = pStationaryWet * wetShift + (1 - pStationaryWet) * dryShift;
    const shift = (wet ? wetShift : dryShift) - shiftMean;
    const anomalyC = residualC + shift;
    const tMeanC = mi(meanNodes) + anomalyC;
    const diurnalRangeC = Math.max(1, wet ? mi(t.diurnalRangeWetC) : mi(t.diurnalRangeDryC));
    // Zachmurzenie i wilgotność.
    const c = profile.cloud;
    const cloudFraction = clamp(
      wet ? mi(c.meanWetFraction) + mi(c.stdWetFraction) * rng.normal() : mi(c.meanDryFraction) + mi(c.stdDryFraction) * rng.normal(),
      0,
      1,
    );
    const h = profile.humidity;
    const humidityPercent = clamp((wet ? mi(h.meanWetPercent) : mi(h.meanDryPercent)) + mi(h.stdPercent) * params.humidityDailyNoiseFraction * rng.normal(), MIN_HUMIDITY_PERCENT, 100);
    // Wiatr: log-normalny o zadanej średniej i odchyleniu.
    const wm = mi(profile.wind.meanSpeedMs);
    const ws = mi(profile.wind.speedStdMs);
    const s2 = Math.log(1 + (ws * ws) / (wm * wm));
    const windMs = Math.exp(Math.log(wm) - s2 / 2 + Math.sqrt(s2) * rng.normal());
    const sector =
      rng.next() < profile.wind.directionPersistence ? state.sector : sampleSector(profile.wind.directionFrequencies[date.month - 1], rng);
    const windFromDeg = (((sector * 45 + rng.range(-1, 1) * params.windDirectionJitterDeg) % 360) + 360) % 360;
    // Godziny opadu: im większa suma, tym dłużej pada.
    const halfSat = params.precipitationDurationHalfSaturationScales * gammaScale;
    const noise = params.precipitationDurationNoise;
    const durationFraction = clamp(precipitationMm / (precipitationMm + halfSat) + rng.range(-noise, noise), 0, 1);
    const precipitationDurationHours = wet
      ? Math.round(params.minPrecipitationDurationHours + durationFraction * (params.maxPrecipitationDurationHours - params.minPrecipitationDurationHours))
      : 0;
    const precipitationStartHour = wet ? rng.int(0, 24 - precipitationDurationHours + 1) : 0;

    const day: DailyWeather = {
      date,
      wet,
      precipitationMm,
      tMeanC,
      anomalyC,
      diurnalRangeC,
      cloudFraction,
      humidityPercent,
      windMs,
      windFromDeg,
      precipitationStartHour,
      precipitationDurationHours,
    };
    for (const m of modifiers) m.apply(day, rng);
    out.push(day);
    state.wet = day.wet;
    state.residualC = residualC;
    state.sector = sector;
  }
  return out;
}

function sampleSector(freq: number[], rng: Rng): number {
  const total = freq.reduce((s, x) => s + x, 0);
  let u = rng.next() * total;
  for (let k = 0; k < freq.length; k++) {
    u -= freq[k];
    if (u <= 0) return k;
  }
  return freq.length - 1;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

/**
 * Sezon zaczynający się w roku `startYear` (1 dnia miesiąca seasonStartMonth) – zawsze ten sam dla
 * tego samego ziarna. `days` – liczba dni (domyślnie długość sezonu); dłuższa seria ma te same
 * pierwsze dni co krótsza (generator idzie dzień po dniu).
 */
export function generateSeason(
  profile: ClimateProfile,
  params: WeatherParams,
  seed: number,
  startYear: number,
  days: number = params.seasonLengthDays,
): DailyWeather[] {
  const rng = new Rng(seed).fork('pogoda').fork(`sezon-${startYear}`);
  return generateDailyWeather(profile, params, rng, { year: startYear, month: params.seasonStartMonth, day: 1 }, days);
}

// ------------------------------------------------------------------ wysokość i godziny

/** Rodzaj opadu dla temperatury powietrza [°C]. */
export function precipitationPhase(temperatureC: number, params: WeatherParams): Exclude<PrecipitationPhase, 'none'> {
  if (temperatureC <= params.snowMaxTemperatureC) return 'snow';
  if (temperatureC >= params.rainMinTemperatureC) return 'rain';
  return 'sleet';
}

/** Warunki dobowe na danej wysokości n.p.m. */
export function dailyAtElevation(day: DailyWeather, elevationM: number, profile: ClimateProfile, params: WeatherParams) {
  const dim = daysInMonth(day.date.year, day.date.month);
  const mi = (v: number[]) => interpolateMonthly(v, day.date.month, day.date.day, dim);
  const dz = elevationM - profile.referenceElevationM;
  const tMeanC = day.tMeanC + (mi(profile.temperature.lapseRateCPer100m) * dz) / 100;
  const rangeC = Math.max(1, day.diurnalRangeC + (mi(profile.temperature.diurnalRangeChangePer100m) * dz) / 100);
  const precipFactor = Math.max(0, 1 + (profile.precipitation.elevationGradientPercentPer100m / 100) * ((elevationM - profile.precipitation.referenceElevationM) / 100));
  const precipitationMm = day.precipitationMm * precipFactor;
  const windMs = day.windMs * Math.exp((mi(profile.wind.growthPer1000m) * dz) / 1000);
  return {
    tMeanC,
    tMinC: tMeanC - rangeC / 2,
    tMaxC: tMeanC + rangeC / 2,
    precipitationMm,
    phase: day.wet ? precipitationPhase(tMeanC, params) : ('none' as PrecipitationPhase),
    windMs,
    cloudFraction: day.cloudFraction,
    humidityPercent: day.humidityPercent,
  };
}

export interface HourlyWeather {
  temperatureC: number;
  /** Opad w tej godzinie [mm]. */
  precipitationMm: number;
  phase: PrecipitationPhase;
  cloudFraction: number;
  humidityPercent: number;
  windMs: number;
  windFromDeg: number;
}

export interface Location {
  latDeg: number;
  lonDeg: number;
  timeZone: TimeZoneRule;
}

/**
 * Pogoda w danej godzinie lokalnej (0–24, z ułamkiem) na danej wysokości. Potrzebny dzień
 * poprzedni i następny (przebieg temperatury przechodzi płynnie przez północ).
 */
export function hourlyAt(
  prev: DailyWeather,
  day: DailyWeather,
  next: DailyWeather,
  hour: number,
  elevationM: number,
  profile: ClimateProfile,
  params: WeatherParams,
  location: Location,
): HourlyWeather {
  const today = dailyAtElevation(day, elevationM, profile, params);
  const yesterday = dailyAtElevation(prev, elevationM, profile, params);
  const tomorrow = dailyAtElevation(next, elevationM, profile, params);
  const sunriseHour = (d: DailyWeather) => {
    const key = `${d.date.year}-${d.date.month}-${d.date.day}|${location.latDeg}|${location.lonDeg}`;
    const cached = SUNRISE_CACHE.get(key);
    if (cached !== undefined) return cached;
    const value = computeSunriseHour(d);
    if (SUNRISE_CACHE.size > SUNRISE_CACHE_MAX) SUNRISE_CACHE.clear();
    SUNRISE_CACHE.set(key, value);
    return value;
  };
  const computeSunriseHour = (d: DailyWeather) => {
    const sd = sunDay(d.date, location.latDeg, location.lonDeg, location.timeZone);
    const start = localToUtcMs({ ...d.date, hour: 0 }, location.timeZone);
    // Noc/dzień polarny (nie dotyczy Polski): minimum o północy słonecznej + 6 h.
    return sd.sunriseUtcMs === null ? POLAR_FALLBACK_MIN_HOUR : (sd.sunriseUtcMs - start) / 3_600_000;
  };
  const hMin = sunriseHour(day);
  const hMax = params.maxTemperatureHourLocal;
  let temperatureC: number;
  if (hour < hMin) {
    // Noc przed świtem: spadek od wczorajszego maksimum do dzisiejszego minimum.
    const span = 24 - hMax + hMin;
    const t = (hour + 24 - hMax) / span;
    temperatureC = today.tMinC + (yesterday.tMaxC - today.tMinC) * (1 + Math.cos(Math.PI * t)) / 2;
  } else if (hour <= hMax) {
    const t = (hour - hMin) / (hMax - hMin);
    temperatureC = today.tMinC + (today.tMaxC - today.tMinC) * (1 - Math.cos(Math.PI * t)) / 2;
  } else {
    const hMinNext = sunriseHour(next) + 24;
    const t = (hour - hMax) / (hMinNext - hMax);
    temperatureC = tomorrow.tMinC + (today.tMaxC - tomorrow.tMinC) * (1 + Math.cos(Math.PI * t)) / 2;
  }
  const raining = day.wet && hour >= day.precipitationStartHour && hour < day.precipitationStartHour + day.precipitationDurationHours;
  const precipitationMm = raining ? today.precipitationMm / day.precipitationDurationHours : 0;
  const windMs = today.windMs * (1 + params.windDiurnalAmplitude * Math.sin((Math.PI * (hour - 9)) / 12));
  const humidityPercent = clamp(today.humidityPercent - params.humidityPerDegreeC * (temperatureC - today.tMeanC), MIN_HUMIDITY_PERCENT, 100);
  return {
    temperatureC,
    precipitationMm,
    phase: raining ? precipitationPhase(temperatureC, params) : 'none',
    cloudFraction: raining ? Math.max(day.cloudFraction, params.precipitationCloudFraction) : day.cloudFraction,
    humidityPercent: raining ? Math.max(humidityPercent, params.rainHumidityMinPercent) : humidityPercent,
    windMs,
    windFromDeg: day.windFromDeg,
  };
}

// ------------------------------------------------------------------ prognoza

export interface ForecastDay {
  date: CalendarDate;
  leadDays: number;
  /** Prognozowana średnia temperatura na wysokości odniesienia [°C]. */
  tMeanC: number;
  /** Niepewność temperatury (1 odchylenie standardowe) [°C]. */
  temperatureUncertaintyC: number;
  /** Prawdopodobieństwo opadu 0–1. */
  precipitationProbability: number;
  /** Prognozowana suma opadu na wysokości odniesienia opadu [mm]. */
  precipitationMm: number;
  cloudFraction: number;
  windMs: number;
}

/**
 * Prognoza na kolejne dni wydana w dniu `issueIndex` serii `days`. Błąd rośnie z wyprzedzeniem;
 * prognoza czasem się myli (opad zapowiedziany, a go nie ma, i odwrotnie).
 * Deterministyczna: ten sam seed i dzień wydania = ta sama prognoza.
 */
export function makeForecast(days: DailyWeather[], issueIndex: number, params: WeatherParams, seed: number): ForecastDay[] {
  const f = params.forecast;
  const out: ForecastDay[] = [];
  const base = days[issueIndex].date;
  const rng = new Rng(seed).fork('prognoza').fork(`${base.year}-${base.month}-${base.day}`);
  for (let lead = 1; lead <= f.days; lead++) {
    const truth = days[issueIndex + lead];
    if (!truth) break;
    const tErr = f.temperatureErrorDay1C + f.temperatureErrorGrowthPerDayC * (lead - 1);
    const miss = Math.min(0.5, f.precipitationMissDay1 + f.precipitationMissGrowthPerDay * (lead - 1));
    const forecastWet = rng.next() < miss ? !truth.wet : truth.wet;
    // Prawdopodobieństwo: pewne blisko, rozmyte daleko.
    const confidence = 1 - miss;
    const precipitationProbability = clamp(
      forecastWet ? confidence * rng.range(f.precipitationProbabilityMinConfidence, 1) : (1 - confidence) * rng.range(0, 1),
      0,
      1,
    );
    const amountErr = f.precipitationAmountErrorDay1 + f.precipitationAmountErrorGrowthPerDay * (lead - 1);
    const precipitationMm = forecastWet
      ? Math.max(truth.precipitationMm, 1) * Math.exp(amountErr * rng.normal() - (amountErr * amountErr) / 2)
      : 0;
    const cErr = f.cloudErrorDay1 + f.cloudErrorGrowthPerDay * (lead - 1);
    out.push({
      date: truth.date,
      leadDays: lead,
      tMeanC: truth.tMeanC + tErr * rng.normal(),
      temperatureUncertaintyC: tErr,
      precipitationProbability,
      precipitationMm,
      cloudFraction: clamp(truth.cloudFraction + cErr * rng.normal(), 0, 1),
      windMs: truth.windMs * Math.exp(f.windErrorGrowthPerDay * lead * rng.normal()),
    });
  }
  return out;
}
