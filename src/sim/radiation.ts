/**
 * Promieniowanie słoneczne docierające do stoku [W/m²] i jego suma dobowa [kWh/m²].
 *
 * Model (przy bezchmurnym niebie):
 *  – bezpośrednie na płaszczyznę prostopadłą do promieni (DNI): Meinel z poprawką Laue na wysokość
 *      DNI = I0 · [(1 − a·h) · 0,7^(AM^0,678) + a·h]      (h – wysokość n.p.m. [km], AM – masa optyczna),
 *    masa optyczna atmosfery: Kasten i Young 1989;
 *  – na stok: DNI · cos(kąta padania), tylko gdy Słońce jest nad horyzontem komórki (cienie terenu);
 *  – rozproszone: izotropowe, DHI · współczynnik widoku nieba (doliny i stoki widzą mniej nieba);
 *  – odbite od otoczenia: albedo · GHI · (1 − współczynnik widoku nieba).
 * Zachmurzenie C (0–1) z generatora pogody: całkowite G = G_bezchm · (1 − 0,75·C^3,4)
 * (Kasten i Czeplak 1980), bezpośrednie osłabione o (1 − C), resztę stanowi rozproszone.
 */
import type { HorizonField } from './horizon';
import { horizonAngleAt } from './horizon';
import { readNumber, readSection } from './params';
import { sunDay, sunPosition } from './sun';
import type { TimeZoneRule } from './time';
import { MS_PER_DAY } from './time';
import type { TerrainGrid } from './terrainGrid';

const DEG = Math.PI / 180;

export interface RadiationParams {
  solarConstantWm2: number;
  meinelTransmittanceBase: number;
  meinelAirMassExponent: number;
  laueAltitudeCoefficientPerKm: number;
  diffuseFractionOfDirect: number;
  groundAlbedo: number;
  kastenCzeplakA: number;
  kastenCzeplakB: number;
  integrationStepMinutes: number;
}

const FILE = 'data/radiation.json';

export function parseRadiationParams(raw: unknown): RadiationParams {
  const cs = readSection(raw, 'clearSky', FILE);
  const cl = readSection(raw, 'clouds', FILE);
  const ds = readSection(raw, 'dailySum', FILE);
  return {
    solarConstantWm2: readNumber(cs, 'solarConstantWm2', FILE, { min: 1000, max: 1500 }),
    meinelTransmittanceBase: readNumber(cs, 'meinelTransmittanceBase', FILE, { min: 0, max: 1 }),
    meinelAirMassExponent: readNumber(cs, 'meinelAirMassExponent', FILE, { min: 0, max: 2 }),
    laueAltitudeCoefficientPerKm: readNumber(cs, 'laueAltitudeCoefficientPerKm', FILE, { min: 0, max: 1 }),
    diffuseFractionOfDirect: readNumber(cs, 'diffuseFractionOfDirect', FILE, { min: 0, max: 1 }),
    groundAlbedo: readNumber(cs, 'groundAlbedo', FILE, { min: 0, max: 1 }),
    kastenCzeplakA: readNumber(cl, 'kastenCzeplakA', FILE, { min: 0, max: 1 }),
    kastenCzeplakB: readNumber(cl, 'kastenCzeplakB', FILE, { min: 0 }),
    integrationStepMinutes: readNumber(ds, 'integrationStepMinutes', FILE, { min: 0.5, max: 60 }),
  };
}

/** Masa optyczna atmosfery (Kasten i Young 1989) dla wysokości Słońca [°]. */
export function airMass(elevationDeg: number): number {
  if (elevationDeg <= 0) return Number.POSITIVE_INFINITY;
  return 1 / (Math.sin(elevationDeg * DEG) + 0.50572 * (elevationDeg + 6.07995) ** -1.6364);
}

export interface SkyRadiation {
  /** Bezpośrednie na płaszczyznę prostopadłą do promieni [W/m²]. */
  directNormalWm2: number;
  /** Rozproszone na płaszczyznę poziomą [W/m²]. */
  diffuseHorizontalWm2: number;
  /** Całkowite na płaszczyznę poziomą bez przesłonięć [W/m²]. */
  globalHorizontalWm2: number;
}

/**
 * Promieniowanie nieba dla wysokości Słońca, wysokości terenu n.p.m. i zachmurzenia (0–1).
 * `sunDistanceAu` – odległość Ziemia–Słońce (zmienia natężenie o ±3,4 % w ciągu roku).
 */
export function skyRadiation(
  sunElevationDeg: number,
  altitudeM: number,
  cloudFraction: number,
  sunDistanceAu: number,
  p: RadiationParams,
): SkyRadiation {
  if (sunElevationDeg <= 0) return { directNormalWm2: 0, diffuseHorizontalWm2: 0, globalHorizontalWm2: 0 };
  const i0 = p.solarConstantWm2 / (sunDistanceAu * sunDistanceAu);
  const am = airMass(sunElevationDeg);
  const ah = Math.min(Math.max(p.laueAltitudeCoefficientPerKm * (altitudeM / 1000), 0), 1);
  const dniClear = i0 * ((1 - ah) * p.meinelTransmittanceBase ** (am ** p.meinelAirMassExponent) + ah);
  const sinE = Math.sin(sunElevationDeg * DEG);
  const dhiClear = p.diffuseFractionOfDirect * dniClear;
  const ghiClear = dniClear * sinE + dhiClear;
  const c = Math.min(Math.max(cloudFraction, 0), 1);
  const ghi = ghiClear * (1 - p.kastenCzeplakA * c ** p.kastenCzeplakB);
  const dni = dniClear * (1 - c);
  const dhi = Math.max(0, ghi - dni * sinE);
  return { directNormalWm2: dni, diffuseHorizontalWm2: dhi, globalHorizontalWm2: dni * sinE + dhi };
}

/** Dane stałe dla komórek (liczone raz): nachylenie, ekspozycja, widok nieba. */
export interface SolarTerrain {
  grid: TerrainGrid;
  horizon: HorizonField;
  sinSlope: Float32Array;
  cosSlope: Float32Array;
  aspectRad: Float32Array;
}

export function prepareSolarTerrain(grid: TerrainGrid, horizon: HorizonField): SolarTerrain {
  const n = grid.cellCount;
  const sinSlope = new Float32Array(n);
  const cosSlope = new Float32Array(n);
  const aspectRad = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const beta = Math.atan((grid.slopePercent[k] || 0) / 100);
    sinSlope[k] = Math.sin(beta);
    cosSlope[k] = Math.cos(beta);
    const a = grid.aspectDeg[k];
    aspectRad[k] = Number.isNaN(a) ? 0 : a * DEG;
  }
  return { grid, horizon, sinSlope, cosSlope, aspectRad };
}

/** Wysokość n.p.m., dla której liczymy atmosferę jednej komórki (NaN → brak). */
function cellAltitude(grid: TerrainGrid, k: number): number {
  return grid.elevationM[k];
}

/**
 * Promieniowanie całkowite na powierzchnię stoku [W/m²] w danej chwili, dla każdej komórki.
 * `cloudFraction` – zachmurzenie 0–1 (jedno dla całej mapy). NaN poza mapą.
 * `out` – opcjonalna tablica wynikowa (żeby nie tworzyć nowej przy animacji).
 */
export function instantRadiation(
  st: SolarTerrain,
  utcMs: number,
  latDeg: number,
  lonDeg: number,
  cloudFraction: number,
  p: RadiationParams,
  out?: Float32Array,
): Float32Array {
  const { grid } = st;
  const result = out ?? new Float32Array(grid.cellCount);
  const sun = sunPosition(utcMs, latDeg, lonDeg);
  accumulateRadiation(st, sun.elevationDeg, sun.azimuthDeg, sun.sunDistanceAu, cloudFraction, p, result, 1, true);
  for (let k = 0; k < grid.cellCount; k++) if (Number.isNaN(grid.elevationM[k])) result[k] = Number.NaN;
  return result;
}

/**
 * Dodaje (lub wpisuje, gdy `overwrite`) do `target` promieniowanie × waga dla położenia Słońca.
 */
function accumulateRadiation(
  st: SolarTerrain,
  sunElevationDeg: number,
  sunAzimuthDeg: number,
  sunDistanceAu: number,
  cloudFraction: number,
  p: RadiationParams,
  target: Float32Array,
  weight: number,
  overwrite: boolean,
): void {
  const { grid, horizon, sinSlope, cosSlope, aspectRad } = st;
  const n = grid.cellCount;
  if (sunElevationDeg <= 0) {
    if (overwrite) target.fill(0);
    return;
  }
  const sinE = Math.sin(sunElevationDeg * DEG);
  const cosE = Math.cos(sunElevationDeg * DEG);
  const az = sunAzimuthDeg * DEG;
  // Atmosfera zależy od wysokości n.p.m. – liczymy ją co 50 m wysokości (pamięć podręczna).
  const cache = new Map<number, SkyRadiation>();
  for (let k = 0; k < n; k++) {
    const z = cellAltitude(grid, k);
    if (Number.isNaN(z)) {
      if (overwrite) target[k] = 0;
      continue;
    }
    const zKey = Math.round(z / 50);
    let sky = cache.get(zKey);
    if (!sky) {
      sky = skyRadiation(sunElevationDeg, zKey * 50, cloudFraction, sunDistanceAu, p);
      cache.set(zKey, sky);
    }
    const svf = horizon.skyViewFactor[k];
    let direct = 0;
    const cosInc = cosSlope[k] * sinE + sinSlope[k] * cosE * Math.cos(az - aspectRad[k]);
    if (cosInc > 0 && sunElevationDeg > horizonAngleAt(horizon, k, sunAzimuthDeg)) direct = sky.directNormalWm2 * cosInc;
    const value = direct + sky.diffuseHorizontalWm2 * svf + p.groundAlbedo * sky.globalHorizontalWm2 * (1 - svf);
    if (overwrite) target[k] = value * weight;
    else target[k] += value * weight;
  }
}

/**
 * Suma dobowa promieniowania [kWh/m²] dla każdej komórki, dla dnia kalendarzowego (czasu lokalnego).
 * `cloudAt(utcMs)` – zachmurzenie 0–1 w danej chwili (np. z generatora pogody); domyślnie bezchmurnie.
 */
export function dailyRadiationSum(
  st: SolarTerrain,
  date: { year: number; month: number; day: number },
  latDeg: number,
  lonDeg: number,
  tz: TimeZoneRule,
  p: RadiationParams,
  cloudAt: (utcMs: number) => number = () => 0,
): Float32Array {
  const { grid } = st;
  const sumWh = new Float32Array(grid.cellCount);
  const day = sunDay(date, latDeg, lonDeg, tz);
  const stepMs = p.integrationStepMinutes * 60000;
  const start = day.sunriseUtcMs ?? day.solarNoonUtcMs - MS_PER_DAY / 2;
  const end = day.sunsetUtcMs ?? day.solarNoonUtcMs + MS_PER_DAY / 2;
  const hoursPerStep = stepMs / 3_600_000;
  // Metoda punktu środkowego.
  for (let t = start + stepMs / 2; t < end; t += stepMs) {
    const sun = sunPosition(t, latDeg, lonDeg);
    if (sun.elevationDeg <= 0) continue;
    const portion = Math.min(stepMs, end - (t - stepMs / 2)) / stepMs;
    accumulateRadiation(st, sun.elevationDeg, sun.azimuthDeg, sun.sunDistanceAu, cloudAt(t), p, sumWh, hoursPerStep * portion, false);
  }
  for (let k = 0; k < grid.cellCount; k++) sumWh[k] = Number.isNaN(grid.elevationM[k]) ? Number.NaN : sumWh[k] / 1000;
  return sumWh;
}
