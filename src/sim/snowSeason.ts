/**
 * Sezon śniegu na całej mapie: pogoda z generatora (albo rzeczywista) → kroki modelu śniegu.
 *
 * Promieniowanie bezchmurnego nieba w oknach 6-godzinnych liczone jest raz na kilkanaście dni
 * sezonu (SolarCache) i interpolowane – zmienia się powoli, a liczenie cieni na każdy dzień byłoby
 * za wolne. Wpływ chmur dokładany jest w każdym kroku (Kasten i Czeplak).
 */
import type { ClimateProfile } from './climate';
import { interpolateMonthly } from './climate';
import type { RadiationParams, SolarTerrain } from './radiation';
import { windowRadiation } from './radiation';
import type { SnowBalance, SnowDomain, SnowParams, SnowStepForcing } from './snow';
import { SnowState, computeShelter, emptyBalance, redistributeSnowByWind, snowStep } from './snow';
import type { TerrainGrid } from './terrainGrid';
import { addDays, daysInMonth, localToUtcMs } from './time';
import type { CalendarDate, DailyWeather, Location, WeatherParams } from './weather';
import { hourlyAt } from './weather';

/** Domena modelu śniegu z siatki terenu i pokrycia (udziały 0–1). */
export function createSnowDomain(grid: TerrainGrid, forest: Float32Array, shrub: Float32Array, p: SnowParams): SnowDomain {
  return {
    cellCount: grid.cellCount,
    widthCells: grid.widthCells,
    heightCells: grid.heightCells,
    cellSizeM: grid.cellSizeM,
    elevationM: grid.elevationM,
    forest,
    shrub,
    shelter: computeShelter(grid.elevationM, grid.widthCells, grid.heightCells, grid.cellSizeM, p.exposureDistanceM, Float32Array.from(forest, (f) => f * p.forestCanopyHeightM)),
  };
}

export interface SolarCache {
  startDate: CalendarDate;
  spacingDays: number;
  steps: number;
  references: number;
  zLowM: number;
  zHighM: number;
  /** direct[r · steps + w] – energia bezpośrednia [Wh/m²] dla każdej komórki. */
  direct: Float32Array[];
  /** flat[(r · steps + w) · 4 + …] = bezpośrednie poziome i rozproszone na zLow, to samo na zHigh [Wh/m²]. */
  flat: Float32Array;
  skyViewFactor: Float32Array;
}

/** Promieniowanie bezchmurnego nieba dla okien kroków co `spacingDays` dni od startDate przez `days` dni. */
export function buildSolarCache(
  st: SolarTerrain,
  startDate: CalendarDate,
  days: number,
  location: Location,
  rp: RadiationParams,
  sp: SnowParams,
  onProgress?: (fraction: number) => void,
): SolarCache {
  const it = solarCacheBuilder(st, startDate, days, location, rp, sp);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    onProgress?.(r.value);
  }
}

/**
 * To samo co buildSolarCache, ale krok po kroku (generator zwraca postęp 0–1 po każdej dacie
 * odniesienia) – żeby wątek obliczeń mógł w międzyczasie odpowiadać na inne pytania.
 */
export function* solarCacheBuilder(
  st: SolarTerrain,
  startDate: CalendarDate,
  days: number,
  location: Location,
  rp: RadiationParams,
  sp: SnowParams,
): Generator<number, SolarCache, void> {
  const steps = sp.stepsPerDay;
  const references = Math.floor(days / sp.solarReferenceSpacingDays) + 2;
  const { minM, maxM } = st.grid.elevationRangeM();
  const direct: Float32Array[] = [];
  const flat = new Float32Array(references * steps * 4);
  for (let r = 0; r < references; r++) {
    const date = addDays(startDate, r * sp.solarReferenceSpacingDays);
    for (let w = 0; w < steps; w++) {
      const h0 = (24 * w) / steps;
      const h1 = (24 * (w + 1)) / steps;
      const t0 = localToUtcMs({ ...date, hour: h0 }, location.timeZone);
      const t1 = localToUtcMs({ ...date, hour: h1 }, location.timeZone);
      const wr = windowRadiation(st, t0, t1, location.latDeg, location.lonDeg, minM, maxM, rp, sp.solarIntegrationStepMinutes);
      direct.push(wr.directWh);
      const o = (r * steps + w) * 4;
      flat[o] = wr.flatLow.directHorizWh;
      flat[o + 1] = wr.flatLow.diffuseWh;
      flat[o + 2] = wr.flatHigh.directHorizWh;
      flat[o + 3] = wr.flatHigh.diffuseWh;
    }
    yield (r + 1) / references;
  }
  return { startDate, spacingDays: sp.solarReferenceSpacingDays, steps, references, zLowM: minM, zHighM: maxM, direct, flat, skyViewFactor: st.horizon.skyViewFactor };
}

/** Pomocnicze: część okna [a, b) pokryta przez przedział [c, d). */
function overlap(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c));
}

export interface SnowSeasonOptions {
  domain: SnowDomain;
  solar: SolarCache;
  /** Pogoda od dnia startDate (indeks 0) – co najmniej o dzień dłuższa niż symulacja. */
  weather: DailyWeather[];
  profile: ClimateProfile;
  weatherParams: WeatherParams;
  snowParams: SnowParams;
  radiationParams: RadiationParams;
  location: Location;
  /** Przewiewanie śniegu przez wiatr (domyślnie włączone). */
  windRedistribution?: boolean;
}

/**
 * Symulacja sezonu dzień po dniu. `dayIndex` – liczba policzonych dni od startu pogody.
 */
export class SnowSeason {
  state: SnowState;
  balance: SnowBalance = emptyBalance();
  dayIndex = 0;
  private readonly sw: Float32Array;
  private readonly o: SnowSeasonOptions;

  constructor(options: SnowSeasonOptions) {
    this.o = options;
    this.state = new SnowState(options.domain.cellCount);
    this.sw = new Float32Array(options.domain.cellCount);
  }

  /** Data następnego dnia do policzenia. */
  get date(): CalendarDate {
    return addDays(this.o.weather[0].date, this.dayIndex);
  }

  /** Data ostatniego policzonego dnia (stan śniegu = koniec tego dnia). */
  dateOfLastDay(): CalendarDate {
    return addDays(this.o.weather[0].date, this.dayIndex - 1);
  }

  /** Warunki w krokach danego dnia (dla całej mapy). */
  forcingsForDay(index: number): SnowStepForcing[] {
    const { weather, profile, weatherParams: wp, snowParams: sp, location, solar } = this.o;
    const day = weather[index];
    const prev = weather[Math.max(0, index - 1)];
    const next = weather[Math.min(weather.length - 1, index + 1)];
    const steps = sp.stepsPerDay;
    const stepHours = 24 / steps;
    const zLow = solar.zLowM;
    const zHigh = solar.zHighM;
    const dim = daysInMonth(day.date.year, day.date.month);
    const growth = interpolateMonthly(profile.wind.growthPer1000m, day.date.month, day.date.day, dim);
    const precipGradientPerM = profile.precipitation.elevationGradientPercentPer100m / 100 / 100;
    // Indeks referencji promieniowania.
    const dayFromSolarStart =
      (Date.UTC(day.date.year, day.date.month - 1, day.date.day) - Date.UTC(solar.startDate.year, solar.startDate.month - 1, solar.startDate.day)) / 86_400_000;
    const rf = Math.min(Math.max(dayFromSolarStart / solar.spacingDays, 0), solar.references - 1.0001);
    const r0 = Math.floor(rf);
    const ft = rf - r0;
    const out: SnowStepForcing[] = [];
    for (let w = 0; w < steps; w++) {
      const h0 = w * stepHours;
      const h1 = h0 + stepHours;
      // Temperatura: średnia z trzech chwil kroku, na dole i na górze mapy.
      let tLow = 0;
      let tHigh = 0;
      let rh = 0;
      let wind = 0;
      const samples = 3;
      for (let s = 0; s < samples; s++) {
        const hour = h0 + ((s + 0.5) * stepHours) / samples;
        const lo = hourlyAt(prev, day, next, hour, zLow, profile, wp, location);
        const hi = hourlyAt(prev, day, next, hour, zHigh, profile, wp, location);
        tLow += lo.temperatureC / samples;
        tHigh += hi.temperatureC / samples;
        rh += lo.humidityPercent / samples;
        wind += lo.windMs / samples;
      }
      const windAtRef = wind * Math.exp((-growth * (zLow - profile.referenceElevationM)) / 1000);
      // Opad w oknie (na wysokości odniesienia opadu).
      const precipHours = day.wet ? overlap(h0, h1, day.precipitationStartHour, day.precipitationStartHour + day.precipitationDurationHours) : 0;
      const precipRefMm = day.wet && day.precipitationDurationHours > 0 ? (day.precipitationMm * precipHours) / day.precipitationDurationHours : 0;
      const cloud = precipHours > 0 ? Math.max(day.cloudFraction, (wp.precipitationCloudFraction * precipHours + day.cloudFraction * (stepHours - precipHours)) / stepHours) : day.cloudFraction;
      // Promieniowanie: interpolacja referencji, chmury, rozproszone z widokiem nieba.
      let shortwave: Float32Array | null = null;
      const fo0 = (r0 * steps + w) * 4;
      const fo1 = ((r0 + 1) * steps + w) * 4;
      const lerp = (a: number, b: number) => a + (b - a) * ft;
      const dhLow = lerp(solar.flat[fo0], solar.flat[fo1]);
      const dLow = lerp(solar.flat[fo0 + 1], solar.flat[fo1 + 1]);
      const dhHigh = lerp(solar.flat[fo0 + 2], solar.flat[fo1 + 2]);
      const dHigh = lerp(solar.flat[fo0 + 3], solar.flat[fo1 + 3]);
      if (dhLow + dLow + dhHigh + dHigh > 0) {
        const rp = this.o.radiationParams;
        const cloudGlobal = 1 - rp.kastenCzeplakA * Math.pow(Math.min(1, Math.max(0, cloud)), rp.kastenCzeplakB);
        const directFactor = 1 - cloud;
        const diffuseFactor = (gh: number, dh: number, d: number) => (d > 0 ? Math.max(0, gh * cloudGlobal - dh * directFactor) / d : 0);
        const fLow = diffuseFactor(dhLow + dLow, dhLow, dLow);
        const fHigh = diffuseFactor(dhHigh + dHigh, dhHigh, dHigh);
        const d0 = solar.direct[r0 * steps + w];
        const d1 = solar.direct[(r0 + 1) * steps + w];
        const svf = solar.skyViewFactor;
        const elev = this.o.domain.elevationM;
        const albedo = rp.groundAlbedo;
        const dz = zHigh - zLow || 1;
        const sw = this.sw.slice(); // nowa tablica: kroki mogą być użyte później
        for (let k = 0; k < sw.length; k++) {
          const z = elev[k];
          if (z !== z) continue;
          const a = (z - zLow) / dz;
          const dh = dhLow + (dhHigh - dhLow) * a;
          const d = dLow + (dHigh - dLow) * a;
          const fd = fLow + (fHigh - fLow) * a;
          const directWh = (d0[k] + (d1[k] - d0[k]) * ft) * directFactor;
          const diffuseWh = (d * svf[k] + albedo * (dh + d) * (1 - svf[k])) * fd;
          sw[k] = (directWh + diffuseWh) / stepHours;
        }
        shortwave = sw;
      }
      out.push({
        durationS: stepHours * 3600,
        tempAtRefC: tLow,
        tempGradientCPerM: (tHigh - tLow) / dz0(zHigh, zLow),
        refElevationM: zLow,
        humidityPercent: rh,
        windRefMs: windAtRef,
        windRefElevationM: profile.referenceElevationM,
        windGrowthPer1000m: growth,
        cloudFraction: cloud,
        precipRefMm,
        precipRefElevationM: profile.precipitation.referenceElevationM,
        precipGradientPerM,
        snowMaxTemperatureC: wp.snowMaxTemperatureC,
        rainMinTemperatureC: wp.rainMinTemperatureC,
        shortwaveWm2: shortwave,
      });
    }
    return out;
  }

  /** Liczy jeden dzień (kroki + przewiewanie). */
  stepDay(): void {
    const { domain, snowParams: sp, weather, profile } = this.o;
    const forcings = this.forcingsForDay(this.dayIndex);
    for (const f of forcings) snowStep(this.state, domain, f, sp, this.balance);
    if (this.o.windRedistribution !== false) {
      const day = weather[this.dayIndex];
      const dim = daysInMonth(day.date.year, day.date.month);
      const growth = interpolateMonthly(profile.wind.growthPer1000m, day.date.month, day.date.day, dim);
      redistributeSnowByWind(this.state, domain, day.windFromDeg, day.windMs, profile.referenceElevationM, growth, sp, this.balance);
    }
    this.dayIndex++;
  }
}

function dz0(a: number, b: number): number {
  return a - b || 1;
}
