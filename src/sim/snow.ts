/**
 * Model śniegu naturalnego – dwie warstwy w każdej komórce mapy (powierzchniowa i spodnia).
 *
 * Stan warstwy: zapas wody w lodzie (SWE) [kg/m² = mm], woda ciekła [mm], gęstość [kg/m³],
 * temperatura [°C ≤ 0]. Do tego: albedo, wiek powierzchni, skorupa lodowa, cykle topnienia
 * i zamarzania, śnieg przewiany. Grubość = SWE / gęstość.
 *
 * W każdym kroku (domyślnie 6 h):
 *  1. opad: część śniegu zatrzymują korony drzew; świeży śnieg o gęstości zależnej od temperatury
 *     (Hedstrom i Pomeroy 1998) i wiatru; deszcz wsiąka w śnieg (albo spływa z gołego gruntu);
 *  2. bilans energii powierzchni: promieniowanie słoneczne (z cieniami terenu i lasem) × (1 − albedo),
 *     promieniowanie długofalowe nieba (Brutsaert, chmury Unsworth–Monteith), wymiana ciepła jawnego
 *     i utajonego z powietrzem (sublimacja), ciepło deszczu; nadwyżka ogrzewa śnieg do 0 °C i topi,
 *     niedobór zamraża wodę ciekłą (skorupa) i schładza warstwę – nie poniżej temperatury równowagi;
 *  3. woda ciekła: zatrzymana do 5 % masy, nadmiar spływa do warstwy spodniej i do gruntu;
 *  4. strumień ciepła z gruntu topi śnieg od spodu; przewodzenie wyrównuje temperatury warstw;
 *  5. osiadanie: gęstość dąży do granicznej (Verseghy 1991), szybciej dla mokrego śniegu;
 *  6. albedo maleje z wiekiem śniegu, odnawia się przy opadzie.
 * Raz na dobę: przewiewanie – wiatr zabiera suchy, lekki śnieg z miejsc odsłoniętych i odkłada
 * w zawietrznych, w zagłębieniach i na skraju lasu (redistributeSnowByWind).
 *
 * Gotowe na kolejne etapy: dodatkowe źródła i straty śniegu (naśnieżanie, ratraki, narciarze) to
 * wywołania addSnow / removeSnow na wybranych komórkach między krokami.
 *
 * Bilans masy prowadzony jest w SnowBalance: opad = przyrost śniegu + odpływ + sublimacja
 * (z koronami drzew i zawiewaniem) + wywianie poza mapę.
 */
import { readNumber, readSection } from './params';

// Stałe fizyczne (nie parametry modelu).
const STEFAN_BOLTZMANN = 5.670374e-8; // W/(m²·K⁴)
const LATENT_FUSION = 334_000; // J/kg
const LATENT_SUBLIMATION = 2_834_000; // J/kg
const SPECIFIC_HEAT_ICE = 2_100; // J/(kg·K)
const SPECIFIC_HEAT_WATER = 4_186; // J/(kg·K)
const SPECIFIC_HEAT_AIR = 1_005; // J/(kg·K)
const GAS_CONSTANT_DRY_AIR = 287.05; // J/(kg·K)
const KELVIN = 273.15;
const SEA_LEVEL_PRESSURE_PA = 101_325;
const PRESSURE_SCALE_HEIGHT_M = 8_434.5;
/** Iteracje Newtona przy temperaturze równowagi powierzchni. */
const NEWTON_ITERATIONS = 3;

export type SnowQuality = 'none' | 'powder' | 'windPacked' | 'settled' | 'firn' | 'slush' | 'icy' | 'thin';
export const SNOW_QUALITY_CODES: SnowQuality[] = ['none', 'powder', 'windPacked', 'settled', 'firn', 'slush', 'icy', 'thin'];
export const SNOW_QUALITY_NAMES: Record<SnowQuality, string> = {
  none: 'brak śniegu',
  powder: 'puch',
  windPacked: 'przewiany',
  settled: 'osiadły',
  firn: 'firn (wiosenny)',
  slush: 'breja',
  icy: 'zlodzony',
  thin: 'przetarty (prześwity trawy)',
};

export interface SnowParams {
  stepsPerDay: number;
  hedstromA: number;
  hedstromB: number;
  hedstromC: number;
  freshMaxDensity: number;
  snowfallCatchCorrection: number;
  windDensityPerMs: number;
  windDensityThresholdMs: number;
  topMaxSweMm: number;
  newLayerSnowfallMm: number;
  minSweMm: number;
  maxDensityCold: number;
  maxDensityWet: number;
  depthTermA: number;
  depthTermB: number;
  rateColdPerHour: number;
  rateWetPerHour: number;
  albedoFresh: number;
  albedoMin: number;
  albedoColdDecayPerDay: number;
  albedoMeltDecayPerDay: number;
  albedoRefreshSnowfallMm: number;
  snowEmissivity: number;
  brutsaertCoefficient: number;
  unsworthCloudCoefficient: number;
  turbulentExchangeCoefficient: number;
  stableExchangeFactor: number;
  minWindForExchangeMs: number;
  groundHeatFluxWm2: number;
  interLayerTimeConstantHours: number;
  minSnowTemperatureC: number;
  holdingCapacityFraction: number;
  canopySnowLossFraction: number;
  canopyShortwaveTransmission: number;
  canopyWindFactor: number;
  shrubSnowLossFraction: number;
  shrubWindFactor: number;
  transportThresholdMs: number;
  erosionMmPerDayPerMs: number;
  transportableMaxDensity: number;
  exposureDistanceM: number;
  exposureSpeedUpPerTan: number;
  depositBaseFraction: number;
  depositShelterCoeff: number;
  depositForestFraction: number;
  blowingSublimationPerCell: number;
  windPackDensity: number;
  dailyMaxWindFactor: number;
  solarReferenceSpacingDays: number;
  solarIntegrationStepMinutes: number;
  thinCoverDepthM: number;
  powderMaxAgeDays: number;
  powderMaxDensity: number;
  slushLiquidFraction: number;
  iceRefreezeMm: number;
  firnMinCycles: number;
  firnMinDensity: number;
  windPackedMinDensity: number;
  coverDepthM: number;
}

const FILE = 'data/snow.json';

export function parseSnowParams(raw: unknown): SnowParams {
  const s = (k: string) => readSection(raw, k, FILE);
  const t = s('time');
  const f = s('freshSnow');
  const l = s('layers');
  const d = s('densification');
  const a = s('albedo');
  const e = s('energy');
  const w = s('water');
  const fo = s('forest');
  const wi = s('wind');
  const q = s('quality');
  const so = s('solar');
  const n = (sec: Record<string, unknown>, k: string, o: { min?: number; max?: number; integer?: boolean } = {}) => readNumber(sec, k, FILE, o);
  return {
    stepsPerDay: n(t, 'stepsPerDay', { integer: true, min: 1, max: 24 }),
    hedstromA: n(f, 'hedstromA'),
    hedstromB: n(f, 'hedstromB'),
    hedstromC: n(f, 'hedstromC', { min: 0.01 }),
    freshMaxDensity: n(f, 'maxDensity', { min: 30 }),
    snowfallCatchCorrection: n(f, 'snowfallCatchCorrection', { min: 0.5, max: 2 }),
    windDensityPerMs: n(f, 'windDensityPerMs', { min: 0 }),
    windDensityThresholdMs: n(f, 'windDensityThresholdMs', { min: 0 }),
    topMaxSweMm: n(l, 'topMaxSweMm', { min: 1 }),
    newLayerSnowfallMm: n(l, 'newLayerSnowfallMm', { min: 0 }),
    minSweMm: n(l, 'minSweMm', { min: 0 }),
    maxDensityCold: n(d, 'maxDensityColdKgM3', { min: 100, max: 917 }),
    maxDensityWet: n(d, 'maxDensityWetKgM3', { min: 100, max: 917 }),
    depthTermA: n(d, 'depthTermA', { min: 0 }),
    depthTermB: n(d, 'depthTermB', { min: 0.001 }),
    rateColdPerHour: n(d, 'rateColdPerHour', { min: 0 }),
    rateWetPerHour: n(d, 'rateWetPerHour', { min: 0 }),
    albedoFresh: n(a, 'fresh', { min: 0, max: 1 }),
    albedoMin: n(a, 'min', { min: 0, max: 1 }),
    albedoColdDecayPerDay: n(a, 'coldDecayPerDay', { min: 0 }),
    albedoMeltDecayPerDay: n(a, 'meltDecayPerDay', { min: 0 }),
    albedoRefreshSnowfallMm: n(a, 'refreshSnowfallMm', { min: 0.1 }),
    snowEmissivity: n(e, 'snowEmissivity', { min: 0, max: 1 }),
    brutsaertCoefficient: n(e, 'brutsaertCoefficient', { min: 0 }),
    unsworthCloudCoefficient: n(e, 'unsworthCloudCoefficient', { min: 0, max: 1 }),
    turbulentExchangeCoefficient: n(e, 'turbulentExchangeCoefficient', { min: 0 }),
    stableExchangeFactor: n(e, 'stableExchangeFactor', { min: 0, max: 1 }),
    minWindForExchangeMs: n(e, 'minWindForExchangeMs', { min: 0 }),
    groundHeatFluxWm2: n(e, 'groundHeatFluxWm2', { min: 0 }),
    interLayerTimeConstantHours: n(e, 'interLayerTimeConstantHours', { min: 0.1 }),
    minSnowTemperatureC: n(e, 'minSnowTemperatureC', { max: 0 }),
    holdingCapacityFraction: n(w, 'holdingCapacityFraction', { min: 0, max: 0.5 }),
    canopySnowLossFraction: n(fo, 'canopySnowLossFraction', { min: 0, max: 1 }),
    canopyShortwaveTransmission: n(fo, 'canopyShortwaveTransmission', { min: 0, max: 1 }),
    canopyWindFactor: n(fo, 'canopyWindFactor', { min: 0, max: 1 }),
    shrubSnowLossFraction: n(fo, 'shrubSnowLossFraction', { min: 0, max: 1 }),
    shrubWindFactor: n(fo, 'shrubWindFactor', { min: 0, max: 1 }),
    transportThresholdMs: n(wi, 'transportThresholdMs', { min: 0 }),
    erosionMmPerDayPerMs: n(wi, 'erosionMmPerDayPerMs', { min: 0 }),
    transportableMaxDensity: n(wi, 'transportableMaxDensity', { min: 0 }),
    exposureDistanceM: n(wi, 'exposureDistanceM', { min: 0 }),
    exposureSpeedUpPerTan: n(wi, 'exposureSpeedUpPerTan', { min: 0 }),
    depositBaseFraction: n(wi, 'depositBaseFraction', { min: 0, max: 1 }),
    depositShelterCoeff: n(wi, 'depositShelterCoeff', { min: 0 }),
    depositForestFraction: n(wi, 'depositForestFraction', { min: 0, max: 1 }),
    blowingSublimationPerCell: n(wi, 'blowingSublimationPerCell', { min: 0, max: 1 }),
    windPackDensity: n(wi, 'windPackDensity', { min: 50, max: 917 }),
    dailyMaxWindFactor: n(wi, 'dailyMaxWindFactor', { min: 1 }),
    solarReferenceSpacingDays: n(so, 'referenceSpacingDays', { integer: true, min: 1 }),
    solarIntegrationStepMinutes: n(so, 'integrationStepMinutes', { min: 1, max: 120 }),
    thinCoverDepthM: n(q, 'thinCoverDepthM', { min: 0 }),
    powderMaxAgeDays: n(q, 'powderMaxAgeDays', { min: 0 }),
    powderMaxDensity: n(q, 'powderMaxDensity', { min: 0 }),
    slushLiquidFraction: n(q, 'slushLiquidFraction', { min: 0 }),
    iceRefreezeMm: n(q, 'iceRefreezeMm', { min: 0 }),
    firnMinCycles: n(q, 'firnMinCycles', { integer: true, min: 0 }),
    firnMinDensity: n(q, 'firnMinDensity', { min: 0 }),
    windPackedMinDensity: n(q, 'windPackedMinDensity', { min: 0 }),
    coverDepthM: n(q, 'coverDepthM', { min: 0 }),
  };
}

/** Dane stałe komórek (nie zmieniają się w sezonie). */
export interface SnowDomain {
  cellCount: number;
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  /** Wysokość n.p.m. [m]; NaN = poza mapą (komórka pomijana). */
  elevationM: Float32Array;
  /** Udział lasu 0–1. */
  forest: Float32Array;
  /** Udział kosodrzewiny/zarośli 0–1. */
  shrub: Float32Array;
  /**
   * Wskaźnik osłonięcia od wiatru (Winstral Sx – tangens największego kąta wzniesienia terenu
   * pod wiatr) dla 8 kierunków, z których wieje wiatr (N, NE, …, NW): shelter[s · n + k].
   * > 0 – miejsce osłonięte (zawietrzne, zagłębienie), < 0 – odsłonięte (grzbiet, stok nawietrzny).
   */
  shelter: Float32Array;
}

/** Warunki atmosferyczne w kroku czasowym – wspólne dla mapy, przeliczane na każdą komórkę. */
export interface SnowStepForcing {
  durationS: number;
  /** Temperatura powietrza liniowa względem wysokości: T(z) = tempAtRefC + tempGradientCPerM · (z − refElevationM). */
  tempAtRefC: number;
  tempGradientCPerM: number;
  refElevationM: number;
  humidityPercent: number;
  /** Prędkość wiatru na wysokości windRefElevationM [m/s] i jej przyrost z wysokością. */
  windRefMs: number;
  windRefElevationM: number;
  windGrowthPer1000m: number;
  cloudFraction: number;
  /** Opad w kroku na wysokości precipRefElevationM [mm] i przyrost względny [1/m]. */
  precipRefMm: number;
  precipRefElevationM: number;
  precipGradientPerM: number;
  /** Progi rodzaju opadu [°C]: poniżej snowMax – śnieg, powyżej rainMin – deszcz, pomiędzy – mieszany. */
  snowMaxTemperatureC: number;
  rainMinTemperatureC: number;
  /** Średnie promieniowanie słoneczne na powierzchnię terenu w kroku [W/m²] dla każdej komórki (przed lasem), null = noc. */
  shortwaveWm2: Float32Array | null;
}

/** Bilans masy (sumy po komórkach) [mm·komórka]. */
export interface SnowBalance {
  precipitationMm: number;
  runoffMm: number;
  sublimationMm: number;
  windOutMm: number;
}

export function emptyBalance(): SnowBalance {
  return { precipitationMm: 0, runoffMm: 0, sublimationMm: 0, windOutMm: 0 };
}

export class SnowState {
  readonly n: number;
  readonly topSwe: Float32Array;
  readonly topLiquid: Float32Array;
  readonly topDensity: Float32Array;
  readonly topTemp: Float32Array;
  readonly botSwe: Float32Array;
  readonly botLiquid: Float32Array;
  readonly botDensity: Float32Array;
  readonly botTemp: Float32Array;
  readonly albedo: Float32Array;
  /** Wiek powierzchni (czas od ostatniego opadu) [dni]. */
  readonly topAgeDays: Float32Array;
  /** Skorupa lodowa na powierzchni (1) i zalodzenie warstwy spodniej (1). */
  readonly topIce: Uint8Array;
  readonly botIce: Uint8Array;
  /** Cykle topnienia i zamarzania powierzchni. */
  readonly cycles: Uint8Array;
  /** Czy powierzchnia była mokra (do liczenia cykli). */
  readonly wasWet: Uint8Array;
  /** Śnieg nawiany / zbity wiatrem na powierzchni. */
  readonly windPacked: Uint8Array;
  /** Powierzchnia zmoczona deszczem od ostatniego opadu śniegu (1) – warunek powstania lodu. */
  readonly topRain: Uint8Array;
  /** Woda zamarznięta w warstwie powierzchniowej od ostatniego opadu śniegu [mm]. */
  readonly topRefrozenMm: Float32Array;
  /** Muldy od narciarzy 0–1 (etap 5; ratraki je wyrównają – etap 7). */
  readonly moguls: Float32Array;
  /** Śnieg z armatek w pryzmach – jeszcze nie rozepchnięty ratrakiem [mm wody] (etap 7). */
  readonly pileMm: Float32Array;
  /** Śnieg techniczny w pokrywie [mm wody] – do liczenia dni otwartych dzięki naśnieżaniu (etap 7). */
  readonly techMm: Float32Array;

  constructor(n: number) {
    this.n = n;
    this.topSwe = new Float32Array(n);
    this.topLiquid = new Float32Array(n);
    this.topDensity = new Float32Array(n);
    this.topTemp = new Float32Array(n);
    this.botSwe = new Float32Array(n);
    this.botLiquid = new Float32Array(n);
    this.botDensity = new Float32Array(n);
    this.botTemp = new Float32Array(n);
    this.albedo = new Float32Array(n);
    this.topAgeDays = new Float32Array(n);
    this.topIce = new Uint8Array(n);
    this.botIce = new Uint8Array(n);
    this.cycles = new Uint8Array(n);
    this.wasWet = new Uint8Array(n);
    this.windPacked = new Uint8Array(n);
    this.topRain = new Uint8Array(n);
    this.topRefrozenMm = new Float32Array(n);
    this.moguls = new Float32Array(n);
    this.pileMm = new Float32Array(n);
    this.techMm = new Float32Array(n);
  }

  /** Całkowity zapas wody w śniegu (lód + woda ciekła) [mm]. */
  totalWater(k: number): number {
    return this.topSwe[k] + this.topLiquid[k] + this.botSwe[k] + this.botLiquid[k];
  }

  /** Grubość pokrywy [m]. */
  depthM(k: number): number {
    let d = 0;
    if (this.topSwe[k] > 0) d += (this.topSwe[k] + this.topLiquid[k]) / this.topDensity[k];
    if (this.botSwe[k] > 0) d += (this.botSwe[k] + this.botLiquid[k]) / this.botDensity[k];
    return d;
  }

  /** Średnia gęstość pokrywy [kg/m³] (0 bez śniegu). */
  bulkDensity(k: number): number {
    const d = this.depthM(k);
    return d > 0 ? this.totalWater(k) / d : 0;
  }

  clearCell(k: number): void {
    this.topSwe[k] = 0;
    this.topLiquid[k] = 0;
    this.topDensity[k] = 0;
    this.topTemp[k] = 0;
    this.botSwe[k] = 0;
    this.botLiquid[k] = 0;
    this.botDensity[k] = 0;
    this.botTemp[k] = 0;
    this.albedo[k] = 0;
    this.topAgeDays[k] = 0;
    this.topIce[k] = 0;
    this.botIce[k] = 0;
    this.cycles[k] = 0;
    this.wasWet[k] = 0;
    this.windPacked[k] = 0;
    this.topRain[k] = 0;
    this.topRefrozenMm[k] = 0;
    this.moguls[k] = 0;
    this.pileMm[k] = 0;
    this.techMm[k] = 0;
  }

  /** Kopia stanu (do zapamiętywania punktów kontrolnych przewijania). */
  clone(): SnowState {
    const c = new SnowState(this.n);
    for (const key of Object.keys(this) as (keyof SnowState)[]) {
      const v = this[key];
      if (ArrayBuffer.isView(v)) (c[key] as unknown as Float32Array).set(v as unknown as Float32Array);
    }
    return c;
  }
}

/** Nasycenie parą nad lodem [Pa] (wzór Magnusa, WMO). */
function saturationVaporPressureIcePaExact(tC: number): number {
  return 611.2 * Math.exp((22.46 * tC) / (272.62 + tC));
}
/** Tablica ciśnienia nasycenia nad lodem co 0,05 °C od −60 do 0 °C (szybkie liczenie). */
const ES_TABLE_MIN_C = -60;
const ES_TABLE_STEP_C = 0.05;
const ES_TABLE = (() => {
  const n = Math.round(-ES_TABLE_MIN_C / ES_TABLE_STEP_C) + 2;
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = saturationVaporPressureIcePaExact(ES_TABLE_MIN_C + i * ES_TABLE_STEP_C);
  return t;
})();
function saturationVaporPressureIcePa(tC: number): number {
  const x = (Math.min(0, Math.max(ES_TABLE_MIN_C, tC)) - ES_TABLE_MIN_C) / ES_TABLE_STEP_C;
  const i = x | 0;
  const f = x - i;
  return ES_TABLE[i] + (ES_TABLE[i + 1] - ES_TABLE[i]) * f;
}
/** Nasycenie parą nad wodą [Pa]. */
function saturationVaporPressureWaterPa(tC: number): number {
  return 611.2 * Math.exp((17.62 * tC) / (243.12 + tC));
}

/** Bilans energii powierzchni śniegu o temperaturze tC [W/m²] (dodatni – energia do śniegu). */
function surfaceFlux(tC: number, radIn: number, ta: number, hCoef: number, leCoef: number, pressure: number, qa: number, stableFactor: number, eps: number): number {
  const tK = tC + KELVIN;
  const stable = ta > tC ? stableFactor : 1;
  const qs = (0.622 * saturationVaporPressureIcePa(tC)) / pressure;
  return radIn - eps * STEFAN_BOLTZMANN * tK * tK * tK * tK + stable * (hCoef * (ta - tC) + leCoef * (qa - qs));
}

/** Szerokość przedziału wysokości do wielkości liczonych raz na krok [m]. */
const ELEVATION_BIN_M = 5;
const binCache = new WeakMap<Float32Array, { minM: number; count: number }>();
function elevationBins(dom: SnowDomain): { minM: number; count: number } {
  let c = binCache.get(dom.elevationM);
  if (!c) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const z of dom.elevationM) {
      if (z < lo) lo = z;
      if (z > hi) hi = z;
    }
    if (lo === Infinity) {
      lo = 0;
      hi = 0;
    }
    c = { minM: lo - ELEVATION_BIN_M / 2, count: Math.floor((hi - lo) / ELEVATION_BIN_M) + 2 };
    binCache.set(dom.elevationM, c);
  }
  return c;
}

/** Gęstość świeżego śniegu [kg/m³] dla temperatury [°C] i wiatru [m/s]. */
export function freshSnowDensity(tC: number, windMs: number, p: SnowParams): number {
  const base = tC <= 0 ? p.hedstromA + p.hedstromB * Math.exp(tC / p.hedstromC) : p.freshMaxDensity;
  return Math.min(p.freshMaxDensity, base) + p.windDensityPerMs * Math.max(0, windMs - p.windDensityThresholdMs);
}

/** Udział śniegu w opadzie (0–1) przy temperaturze [°C]. */
export function snowFraction(tC: number, snowMaxC: number, rainMinC: number): number {
  if (tC <= snowMaxC) return 1;
  if (tC >= rainMinC) return 0;
  return (rainMinC - tC) / (rainMinC - snowMaxC);
}

/** Dodaje śnieg do warstwy powierzchniowej (np. opad, nawiany, w przyszłości – naśnieżanie). */
export function addSnow(s: SnowState, k: number, sweMm: number, density: number, tempC: number, p: SnowParams, startsNewLayer: boolean): void {
  if (sweMm <= 0) return;
  if (startsNewLayer && s.topSwe[k] > 0) pushTopToBottom(s, k);
  const old = s.topSwe[k];
  const total = old + sweMm;
  const oldVolume = old > 0 ? old / s.topDensity[k] : 0;
  s.topDensity[k] = total / (oldVolume + sweMm / density);
  s.topTemp[k] = old > 0 ? (s.topTemp[k] * old + Math.min(0, tempC) * sweMm) / total : Math.min(0, tempC);
  s.topSwe[k] = total;
  if (old <= 0 && s.botSwe[k] <= 0) s.albedo[k] = p.albedoFresh;
  if (total > p.topMaxSweMm) moveExcessToBottom(s, k, total - p.topMaxSweMm);
}

/** Zabiera śnieg z powierzchni (do przyszłych strat: wywiewanie, ratraki); zwraca zabraną ilość [mm]. */
export function removeSnow(s: SnowState, k: number, sweMm: number): number {
  let left = sweMm;
  const fromTop = Math.min(left, s.topSwe[k]);
  s.topSwe[k] -= fromTop;
  left -= fromTop;
  const fromBot = Math.min(left, s.botSwe[k]);
  s.botSwe[k] -= fromBot;
  left -= fromBot;
  return sweMm - left;
}

function mergeIntoBottom(s: SnowState, k: number, swe: number, liquid: number, density: number, tempC: number, ice: number): void {
  const old = s.botSwe[k];
  const total = old + swe;
  if (total <= 0) return;
  const oldVolume = old > 0 ? old / s.botDensity[k] : 0;
  s.botDensity[k] = total / (oldVolume + swe / density);
  s.botTemp[k] = old > 0 ? (s.botTemp[k] * old + tempC * swe) / total : tempC;
  s.botSwe[k] = total;
  s.botLiquid[k] += liquid;
  if (ice) s.botIce[k] = 1;
}

function pushTopToBottom(s: SnowState, k: number): void {
  mergeIntoBottom(s, k, s.topSwe[k], s.topLiquid[k], s.topDensity[k], s.topTemp[k], s.topIce[k]);
  s.topSwe[k] = 0;
  s.topLiquid[k] = 0;
  s.topIce[k] = 0;
  s.cycles[k] = 0;
  s.wasWet[k] = 0;
  s.windPacked[k] = 0;
  s.topRain[k] = 0;
  s.topRefrozenMm[k] = 0;
}

function moveExcessToBottom(s: SnowState, k: number, excess: number): void {
  const frac = excess / s.topSwe[k];
  const liquid = s.topLiquid[k] * frac;
  mergeIntoBottom(s, k, excess, liquid, s.topDensity[k], s.topTemp[k], 0);
  s.topSwe[k] -= excess;
  s.topLiquid[k] -= liquid;
}

/** Gęstość graniczna dla grubości [m] (Verseghy 1991). */
function maxDensity(depthM: number, wet: boolean, p: SnowParams): number {
  const base = wet ? p.maxDensityWet : p.maxDensityCold;
  if (depthM <= 0) return base;
  return base - (p.depthTermA / depthM) * (1 - Math.exp(-depthM / p.depthTermB));
}

/**
 * Jeden krok czasowy modelu śniegu dla wszystkich komórek.
 */
/** Diagnostyka jednej komórki (raport, testy): składowe bilansu energii w ostatnim kroku [W/m²]. */
export interface SnowDiagnostics {
  cell: number;
  swNet: number;
  lwNet: number;
  sensible: number;
  latent: number;
  rainHeat: number;
  meltMm: number;
}

export function snowStep(s: SnowState, dom: SnowDomain, f: SnowStepForcing, p: SnowParams, bal: SnowBalance, diag?: SnowDiagnostics): void {
  const dt = f.durationS;
  const { topSwe, topLiquid, topDensity, topTemp, botSwe, botLiquid, botDensity, botTemp, albedo, topAgeDays, topIce, botIce, cycles, wasWet, windPacked, topRain, topRefrozenMm } = s;
  const dtHours = dt / 3600;
  const dtDays = dt / 86400;
  const sigma = STEFAN_BOLTZMANN;
  const eps = p.snowEmissivity;
  const rhFrac = f.humidityPercent / 100;
  const relaxLayers = 1 - Math.exp(-dtHours / p.interLayerTimeConstantHours);
  const groundEnergy = p.groundHeatFluxWm2 * dt;
  const coldFactor = 1 - Math.exp(-p.rateColdPerHour * dtHours);
  const wetFactor = 1 - Math.exp(-p.rateWetPerHour * dtHours);
  const meltAlbedoFactor = Math.exp(-p.albedoMeltDecayPerDay * dtDays);

  // Wielkości zależne tylko od wysokości – raz na krok, w przedziałach co ELEVATION_BIN_M.
  const bins = elevationBins(dom);
  const nb = bins.count;
  const binTa = new Float64Array(nb);
  const binPressure = new Float64Array(nb);
  const binAirDensity = new Float64Array(nb);
  const binQa = new Float64Array(nb);
  const binLwSky = new Float64Array(nb);
  const binLwAir = new Float64Array(nb);
  const binPrecip = new Float64Array(nb);
  const binSnowFrac = new Float64Array(nb);
  const binWindElev = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    const z = bins.minM + (b + 0.5) * ELEVATION_BIN_M;
    const ta = f.tempAtRefC + f.tempGradientCPerM * (z - f.refElevationM);
    const pressure = SEA_LEVEL_PRESSURE_PA * Math.exp(-z / PRESSURE_SCALE_HEIGHT_M);
    const taK = ta + KELVIN;
    const ea = rhFrac * saturationVaporPressureWaterPa(ta);
    const epsClear = p.brutsaertCoefficient * Math.pow(ea / 100 / taK, 1 / 7);
    const epsSky = (1 - p.unsworthCloudCoefficient * f.cloudFraction) * epsClear + p.unsworthCloudCoefficient * f.cloudFraction;
    const lwAir = sigma * taK * taK * taK * taK;
    binTa[b] = ta;
    binPressure[b] = pressure;
    binAirDensity[b] = pressure / (GAS_CONSTANT_DRY_AIR * taK);
    binQa[b] = (0.622 * ea) / pressure;
    binLwSky[b] = epsSky * lwAir;
    binLwAir[b] = lwAir;
    binPrecip[b] = f.precipRefMm > 0 ? f.precipRefMm * Math.max(0, 1 + f.precipGradientPerM * (z - f.precipRefElevationM)) : 0;
    binSnowFrac[b] = snowFraction(ta, f.snowMaxTemperatureC, f.rainMinTemperatureC);
    binWindElev[b] = f.windRefMs * Math.exp((f.windGrowthPer1000m * (z - f.windRefElevationM)) / 1000);
  }

  for (let k = 0; k < dom.cellCount; k++) {
    const z = dom.elevationM[k];
    if (z !== z) continue; // NaN – poza mapą
    const b = ((z - bins.minM) / ELEVATION_BIN_M) | 0;
    const precip = binPrecip[b];
    if (precip <= 0 && topSwe[k] <= 0 && botSwe[k] <= 0 && topLiquid[k] <= 0 && botLiquid[k] <= 0) continue; // brak śniegu i opadu
    const ta = binTa[b];
    const forest = dom.forest[k];
    const shrub = dom.shrub[k];

    // ---- opad
    bal.precipitationMm += precip;
    let snowfall = precip * binSnowFrac[b];
    const rain = precip - snowfall;
    // Deszczomierz łapie tylko część padającego śniegu – rzeczywisty opad śniegu jest większy.
    if (snowfall > 0 && p.snowfallCatchCorrection !== 1) {
      const extra = snowfall * (p.snowfallCatchCorrection - 1);
      snowfall += extra;
      bal.precipitationMm += extra;
    }
    if (snowfall > 0) {
      const lost = snowfall * (forest * p.canopySnowLossFraction + shrub * p.shrubSnowLossFraction);
      bal.sublimationMm += lost;
      snowfall -= lost;
    }
    const windFactor = 1 - forest * (1 - p.canopyWindFactor) - shrub * (1 - p.shrubWindFactor);
    const wind = binWindElev[b] * windFactor;
    if (snowfall > 0) {
      const startsNew = snowfall >= p.newLayerSnowfallMm && (topAgeDays[k] > 1 || topIce[k] === 1);
      addSnow(s, k, snowfall, freshSnowDensity(ta, wind, p), ta, p, startsNew);
      const refresh = Math.min(1, snowfall / p.albedoRefreshSnowfallMm);
      albedo[k] += (p.albedoFresh - albedo[k]) * refresh;
      if (snowfall >= p.newLayerSnowfallMm || topAgeDays[k] > 1) topAgeDays[k] = 0;
      if (startsNew) windPacked[k] = 0;
      if (snowfall >= p.newLayerSnowfallMm) {
        topRain[k] = 0;
        topRefrozenMm[k] = 0;
      }
    }
    let total = topSwe[k] + topLiquid[k] + botSwe[k] + botLiquid[k];
    if (total < p.minSweMm) {
      // Brak śniegu: deszcz i resztki spływają.
      bal.runoffMm += rain + total;
      if (total > 0 || albedo[k] > 0) s.clearCell(k);
      continue;
    }
    if (rain > 0) {
      if (topSwe[k] > 0) {
        topLiquid[k] += rain;
        if (rain >= p.iceRefreezeMm) topRain[k] = 1;
      } else botLiquid[k] += rain;
    }

    // ---- bilans energii powierzchni
    if (topSwe[k] <= 0 && botSwe[k] > 0) {
      // Cała pokrywa w warstwie spodniej – przenosimy ją na powierzchnię.
      topSwe[k] = botSwe[k];
      topLiquid[k] += botLiquid[k];
      topDensity[k] = botDensity[k];
      topTemp[k] = botTemp[k];
      topIce[k] = botIce[k];
      botSwe[k] = 0;
      botLiquid[k] = 0;
      botIce[k] = 0;
    }
    const pressure = binPressure[b];
    const airDensity = binAirDensity[b];
    const qa = binQa[b];
    const lwAir = binLwAir[b];
    // Las: korony zasłaniają niebo i same promieniują w temperaturze powietrza.
    const skyView = 1 - forest * (1 - p.canopyShortwaveTransmission);
    const lwIn = skyView * binLwSky[b] + (1 - skyView) * lwAir;
    const sw = f.shortwaveWm2 ? f.shortwaveWm2[k] * skyView : 0;
    const swNet = (1 - albedo[k]) * sw;
    const exch = p.turbulentExchangeCoefficient * Math.max(wind, p.minWindForExchangeMs);
    const hCoef = airDensity * SPECIFIC_HEAT_AIR * exch;
    const leCoef = airDensity * LATENT_SUBLIMATION * exch;
    const stableF = p.stableExchangeFactor;
    const radIn = swNet + lwIn;
    const rainHeat = rain * SPECIFIC_HEAT_WATER * Math.max(0, ta);
    const ts0 = topTemp[k];
    if (diag && diag.cell === k) {
      const tK = ts0 + KELVIN;
      const stable = ta > ts0 ? p.stableExchangeFactor : 1;
      diag.swNet = swNet;
      diag.lwNet = lwIn - eps * sigma * tK * tK * tK * tK;
      diag.sensible = stable * hCoef * (ta - ts0);
      diag.latent = stable * leCoef * (qa - (0.622 * saturationVaporPressureIcePa(ts0)) / pressure);
      diag.rainHeat = rainHeat / dt;
      diag.meltMm = topSwe[k] + botSwe[k];
    }
    let energy = surfaceFlux(ts0, radIn, ta, hCoef, leCoef, pressure, qa, stableF, eps) * dt + rainHeat;
    let tsFinal = ts0;
    if (energy > 0) {
      // Ogrzewanie do 0 °C, potem topnienie warstwy powierzchniowej (nadmiar – spodniej).
      const cc = SPECIFIC_HEAT_ICE * topSwe[k] * -ts0;
      if (energy <= cc) {
        topTemp[k] = ts0 + energy / (SPECIFIC_HEAT_ICE * topSwe[k]);
      } else {
        energy -= cc;
        topTemp[k] = 0;
        const melt = Math.min(topSwe[k], energy / LATENT_FUSION);
        topSwe[k] -= melt;
        topLiquid[k] += melt;
        energy -= melt * LATENT_FUSION;
        if (energy > 0 && botSwe[k] > 0) {
          const ccb = SPECIFIC_HEAT_ICE * botSwe[k] * -botTemp[k];
          if (energy <= ccb) botTemp[k] += energy / (SPECIFIC_HEAT_ICE * botSwe[k]);
          else {
            botTemp[k] = 0;
            const meltB = Math.min(botSwe[k], (energy - ccb) / LATENT_FUSION);
            botSwe[k] -= meltB;
            botLiquid[k] += meltB;
          }
        }
      }
      tsFinal = topTemp[k];
    } else {
      // Niedobór energii: najpierw zamarza woda ciekła (skorupa), potem warstwa się schładza –
      // nie poniżej temperatury równowagi powierzchni.
      let deficit = -energy;
      const refreeze = Math.min(topLiquid[k], deficit / LATENT_FUSION);
      if (refreeze > 0) {
        topLiquid[k] -= refreeze;
        topSwe[k] += refreeze;
        deficit -= refreeze * LATENT_FUSION;
        // Lód powstaje, gdy zamarza woda z deszczu (przy topnieniu i zamarzaniu – firn).
        topRefrozenMm[k] += refreeze;
        if (topRain[k] && topRefrozenMm[k] >= p.iceRefreezeMm) topIce[k] = 1;
      }
      if (deficit > 0 && topSwe[k] > 0) {
        let teq = Math.min(0, ta);
        for (let it = 0; it < NEWTON_ITERATIONS; it++) {
          const fv = surfaceFlux(teq, radIn, ta, hCoef, leCoef, pressure, qa, stableF, eps);
          const tK = teq + KELVIN;
          const stable = ta > teq ? p.stableExchangeFactor : 1;
          const dqs = (0.622 * (saturationVaporPressureIcePa(teq + 0.05) - saturationVaporPressureIcePa(teq - 0.05))) / 0.1 / pressure;
          const df = -4 * eps * sigma * tK * tK * tK - stable * (hCoef + leCoef * dqs);
          teq = Math.min(0, Math.max(p.minSnowTemperatureC, teq - fv / df));
          if (Math.abs(fv / df) < 0.01) break;
        }
        const cooled = ts0 - deficit / (SPECIFIC_HEAT_ICE * topSwe[k]);
        topTemp[k] = Math.max(cooled, teq, p.minSnowTemperatureC);
      }
      tsFinal = topTemp[k];
    }

    // ---- sublimacja / szadź (masa); energia była już w bilansie
    {
      const stable = ta > tsFinal ? p.stableExchangeFactor : 1;
      const qs = (0.622 * saturationVaporPressureIcePa(tsFinal)) / pressure;
      const massFlux = (stable * airDensity * exch * (qa - qs)) * dt; // kg/m², + = osadzanie
      if (massFlux < 0) {
        const removed = removeSnow(s, k, -massFlux);
        bal.sublimationMm += removed;
      } else if (massFlux > 0) {
        topSwe[k] += massFlux;
        bal.sublimationMm -= massFlux;
      }
    }

    // ---- cykle topnienia i zamarzania
    if (topLiquid[k] > 0) wasWet[k] = 1;
    else if (wasWet[k] && topTemp[k] < 0) {
      wasWet[k] = 0;
      if (cycles[k] < 255) cycles[k]++;
    }

    // ---- woda ciekła: zatrzymanie i spływ
    const capTop = p.holdingCapacityFraction * topSwe[k];
    if (topLiquid[k] > capTop) {
      const excess = topLiquid[k] - capTop;
      topLiquid[k] = capTop;
      if (botSwe[k] > 0) botLiquid[k] += excess;
      else bal.runoffMm += excess;
    }
    if (botSwe[k] > 0 && botTemp[k] < 0 && botLiquid[k] > 0) {
      const cc = SPECIFIC_HEAT_ICE * botSwe[k] * -botTemp[k];
      const fr = Math.min(botLiquid[k], cc / LATENT_FUSION);
      botLiquid[k] -= fr;
      botSwe[k] += fr;
      botTemp[k] = Math.min(0, botTemp[k] + (fr * LATENT_FUSION) / (SPECIFIC_HEAT_ICE * botSwe[k]));
      if (fr >= p.iceRefreezeMm) botIce[k] = 1;
    }
    const capBot = p.holdingCapacityFraction * botSwe[k];
    if (botLiquid[k] > capBot) {
      bal.runoffMm += botLiquid[k] - capBot;
      botLiquid[k] = capBot;
    }

    // ---- ciepło z gruntu (od spodu) i przewodzenie między warstwami
    {
      const hasBot = botSwe[k] > 0;
      const swe = hasBot ? botSwe[k] : topSwe[k];
      let e = groundEnergy;
      if (swe > 0) {
        const temp = hasBot ? botTemp[k] : topTemp[k];
        const cc = SPECIFIC_HEAT_ICE * swe * -temp;
        let newTemp = temp;
        let melt = 0;
        if (e <= cc) newTemp = temp + e / (SPECIFIC_HEAT_ICE * swe);
        else {
          e -= cc;
          newTemp = 0;
          melt = Math.min(swe, e / LATENT_FUSION);
        }
        if (hasBot) {
          botTemp[k] = newTemp;
          botSwe[k] -= melt;
          bal.runoffMm += melt; // woda roztopiona przy gruncie wsiąka
        } else {
          topTemp[k] = newTemp;
          topSwe[k] -= melt;
          bal.runoffMm += melt;
        }
      }
      if (botSwe[k] > 0 && topSwe[k] > 0) {
        const cTop = topSwe[k];
        const cBot = botSwe[k];
        const diff = topTemp[k] - botTemp[k];
        const move = relaxLayers * diff;
        topTemp[k] -= (move * cBot) / (cTop + cBot);
        botTemp[k] += (move * cTop) / (cTop + cBot);
      }
    }

    // ---- porządki: znikome ilości, puste warstwy
    if (botSwe[k] <= 0) {
      if (botLiquid[k] > 0) bal.runoffMm += botLiquid[k];
      botSwe[k] = 0;
      botLiquid[k] = 0;
      botIce[k] = 0;
    }
    total = topSwe[k] + topLiquid[k] + botSwe[k] + botLiquid[k];
    if (total < p.minSweMm) {
      bal.runoffMm += total;
      s.clearCell(k);
      continue;
    }
    if (topSwe[k] <= 0) {
      if (topLiquid[k] > 0) {
        if (botSwe[k] > 0) botLiquid[k] += topLiquid[k];
        else bal.runoffMm += topLiquid[k];
      }
      topSwe[k] = 0;
      topLiquid[k] = 0;
    }

    // ---- osiadanie
    const depthTop = topSwe[k] > 0 ? (topSwe[k] + topLiquid[k]) / topDensity[k] : 0;
    const depthBot = botSwe[k] > 0 ? (botSwe[k] + botLiquid[k]) / botDensity[k] : 0;
    if (topSwe[k] > 0) {
      const wet = topLiquid[k] > 0 || topTemp[k] >= 0;
      const target = maxDensity(depthTop, wet, p);
      if (target > topDensity[k]) topDensity[k] += (target - topDensity[k]) * (wet ? wetFactor : coldFactor);
    }
    if (botSwe[k] > 0) {
      const wet = botLiquid[k] > 0 || botTemp[k] >= 0;
      const target = maxDensity(depthTop + depthBot, wet, p);
      if (target > botDensity[k]) botDensity[k] += (target - botDensity[k]) * (wet ? wetFactor : coldFactor);
    }

    // ---- albedo i wiek
    if (topLiquid[k] > 0 || topTemp[k] >= 0) {
      albedo[k] = p.albedoMin + (albedo[k] - p.albedoMin) * meltAlbedoFactor;
    } else {
      albedo[k] = Math.max(p.albedoMin, albedo[k] - p.albedoColdDecayPerDay * dtDays);
    }
    topAgeDays[k] += dtDays;
  }
}

// ------------------------------------------------------------------ przewiewanie

/** Przesunięcia do sąsiedniej komórki z wiatrem dla 8 kierunków wiatru (z którego wieje: N, NE, …). */
const DOWNWIND_OFFSETS: [number, number][] = [
  [0, 1], // wiatr z N → śnieg niesiony na południe (y rośnie)
  [-1, 1], // z NE → na SW
  [-1, 0], // z E → na W
  [-1, -1], // z SE → na NW
  [0, -1], // z S → na N
  [1, -1], // z SW → na NE
  [1, 0], // z W → na E
  [1, 1], // z NW → na SE
];

/** Sektor (0–7) kierunku, z którego wieje wiatr [°]. */
export function windSector(windFromDeg: number): number {
  return Math.round((((windFromDeg % 360) + 360) % 360) / 45) % 8;
}

/**
 * Wskaźnik osłonięcia od wiatru (Winstral i in. 2002) dla 8 kierunków: tangens największego kąta
 * wzniesienia terenu w stronę, z której wieje wiatr, w zasięgu `distanceM`.
 */
export function computeShelter(elevationM: Float32Array, widthCells: number, heightCells: number, cellSizeM: number, distanceM: number): Float32Array {
  const n = widthCells * heightCells;
  const out = new Float32Array(8 * n);
  const steps = Math.max(1, Math.round(distanceM / cellSizeM));
  for (let s = 0; s < 8; s++) {
    // Kierunek pod wiatr = przeciwny do przesunięcia z wiatrem.
    const [dx, dy] = DOWNWIND_OFFSETS[s];
    const ux = -dx;
    const uy = -dy;
    const stepLen = Math.hypot(ux, uy) * cellSizeM;
    for (let j = 0; j < heightCells; j++) {
      for (let i = 0; i < widthCells; i++) {
        const k = j * widthCells + i;
        const z0 = elevationM[k];
        if (z0 !== z0) {
          out[s * n + k] = 0;
          continue;
        }
        let maxTan = -Infinity;
        for (let m = 1; m <= steps; m++) {
          const ii = i + ux * m;
          const jj = j + uy * m;
          if (ii < 0 || jj < 0 || ii >= widthCells || jj >= heightCells) break;
          const z = elevationM[jj * widthCells + ii];
          if (z !== z) break;
          const t = (z - z0) / (m * stepLen);
          if (t > maxTan) maxTan = t;
        }
        out[s * n + k] = maxTan === -Infinity ? 0 : maxTan;
      }
    }
  }
  return out;
}

/**
 * Przewiewanie śniegu przez jedną dobę. Wiatr niesie suchy, lekki śnieg z wiatrem: w każdej komórce
 * część niesionego śniegu opada (więcej w miejscach osłoniętych i na skraju lasu), a w miejscach
 * odsłoniętych wiatr dobiera śnieg z powierzchni. To, co wyleci poza mapę, liczone jest w bilansie.
 */
export function redistributeSnowByWind(
  s: SnowState,
  dom: SnowDomain,
  windFromDeg: number,
  windRefMs: number,
  windRefElevationM: number,
  windGrowthPer1000m: number,
  p: SnowParams,
  bal: SnowBalance,
): void {
  const sector = windSector(windFromDeg);
  const [dx, dy] = DOWNWIND_OFFSETS[sector];
  const w = dom.widthCells;
  const h = dom.heightCells;
  const n = dom.cellCount;
  const shelterBase = sector * n;
  const flux = new Float32Array(n);
  const iStart = dx >= 0 ? 0 : w - 1;
  const iEnd = dx >= 0 ? w : -1;
  const iStep = dx >= 0 ? 1 : -1;
  const jStart = dy >= 0 ? 0 : h - 1;
  const jEnd = dy >= 0 ? h : -1;
  const jStep = dy >= 0 ? 1 : -1;
  let anyTransport = false;
  for (let j = jStart; j !== jEnd; j += jStep) {
    for (let i = iStart; i !== iEnd; i += iStep) {
      const k = j * w + i;
      const z = dom.elevationM[k];
      let carried = flux[k];
      if (z !== z) {
        bal.windOutMm += carried;
        continue;
      }
      const forest = dom.forest[k];
      const shrub = dom.shrub[k];
      const sx = dom.shelter[shelterBase + k];
      // Odkładanie niesionego śniegu.
      if (carried > 0) {
        const deposit = carried * Math.min(1, p.depositBaseFraction + p.depositShelterCoeff * Math.max(0, sx) + p.depositForestFraction * (forest + shrub));
        if (deposit > 0) {
          addSnow(s, k, deposit, p.windPackDensity, Math.min(0, s.topTemp[k]), p, false);
          if (s.albedo[k] <= 0) s.albedo[k] = p.albedoFresh;
          if (deposit > p.minSweMm * 10) s.windPacked[k] = 1;
          carried -= deposit;
        }
      }
      // Wywiewanie z powierzchni.
      const windFactor = 1 - forest * (1 - p.canopyWindFactor) - shrub * (1 - p.shrubWindFactor);
      const wind = windRefMs * p.dailyMaxWindFactor * Math.exp((windGrowthPer1000m * (z - windRefElevationM)) / 1000) * windFactor;
      if (wind > p.transportThresholdMs && s.topSwe[k] > 0 && s.topLiquid[k] <= 0 && s.topTemp[k] < 0 && s.topIce[k] === 0 && s.topDensity[k] < p.transportableMaxDensity) {
        const exposure = Math.max(0, 1 - p.exposureSpeedUpPerTan * sx);
        const erode = Math.min(s.topSwe[k], p.erosionMmPerDayPerMs * (wind - p.transportThresholdMs) * exposure * (1 - forest));
        if (erode > 0) {
          s.topSwe[k] -= erode;
          carried += erode;
          anyTransport = true;
          if (s.topSwe[k] > 0) s.windPacked[k] = 1;
        }
      }
      if (carried <= 0) continue;
      const lost = carried * p.blowingSublimationPerCell;
      bal.sublimationMm += lost;
      carried -= lost;
      const ni = i + dx;
      const nj = j + dy;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) bal.windOutMm += carried;
      else flux[nj * w + ni] += carried;
    }
  }
  void anyTransport;
}

/** Stan (jakość) śniegu w komórce. */
export function classifySnow(s: SnowState, k: number, p: SnowParams): SnowQuality {
  if (s.totalWater(k) < p.minSweMm) return 'none';
  const depth = s.depthM(k);
  if (depth < p.thinCoverDepthM) return 'thin';
  if (s.topSwe[k] > 0 && s.topLiquid[k] >= p.slushLiquidFraction * s.topSwe[k] && s.topTemp[k] >= 0) return 'slush';
  if (s.topIce[k]) return 'icy';
  if (s.cycles[k] >= p.firnMinCycles && s.topDensity[k] >= p.firnMinDensity) return 'firn';
  if (s.topAgeDays[k] <= p.powderMaxAgeDays && s.topDensity[k] <= p.powderMaxDensity && !s.windPacked[k]) return 'powder';
  if (s.windPacked[k] && s.topDensity[k] >= p.windPackedMinDensity) return 'windPacked';
  return 'settled';
}
