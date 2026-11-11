/**
 * Parametry naśnieżania i ratraków (data/snowmaking.json): woda (ujęcie, zbiornik), pompowanie,
 * taryfa nocna, rurociąg i hydranty, śnieg techniczny, armatki (krzywe wydajności od temperatury
 * mokrej), budynki infrastruktury, ratraki, dane do kalibracji. Same wartości – jednostki i źródła
 * są w pliku.
 */
import { readNumber, readNumberArray, readSection } from './params';

const FILE = 'data/snowmaking.json';
type Sec = Record<string, unknown>;

export interface GunType {
  id: string;
  name: string;
  movable: boolean;
  costPln: number;
  curveWetBulbC: number[];
  curveSnowM3h: number[];
  energyKWhPerM3: number;
  nozzleHeadM: number;
  throwM: number;
}

/**
 * Rodzaje budynków; `capacity` znaczy: ujęcie, wodociąg, pompownia – m³/h; zbiornik – m³; przyłącze – kW;
 * garaż – miejsca; kotwa – długość liny m; studnia – głębokość m; rowy – największa zlewnia m².
 */
export type InfraKind = 'intake' | 'mains' | 'well' | 'catchment' | 'reservoir' | 'pump' | 'grid' | 'garage' | 'anchor';

export interface InfraType {
  id: string;
  name: string;
  kind: InfraKind;
  costPln: number;
  capacity: number;
  buildDays: number;
  summerOnly: boolean;
}

export interface GroomerType {
  id: string;
  name: string;
  winch: boolean;
  pricePln: number;
  widthM: number;
  speedKmh: number;
  fuelLph: number;
  powerKw: number;
}

export interface SnowmakingParams {
  water: {
    intakeSummerM3h: number;
    intakeWinterFactor: number;
    intakeDryFactorMin: number;
    normalPrecipMmPerDay: number;
    precipWindowDays: number;
    waterFeePlnPerM3: number;
    fillMonthsFrom: number;
    fillMonthsTo: number;
  };
  pumping: { efficiency: number; pipeLossMPerKm: number; waterDensityKgM3: number; gravityMs2: number };
  energy: { nightTariffFactor: number; nightStartH: number; nightEndH: number };
  pipe: { costPlnPerM: number; supplyCostPlnPerM: number; metersPerDay: number; hydrantSpacingM: number; hydrantCostPln: number; trenchFromMonth: number; trenchToMonth: number; connectRadiusM: number };
  snow: {
    densityAtStartKgM3: number;
    densityColdKgM3: number;
    densityColdWetBulbC: number;
    liquidFractionAtStart: number;
    waterLossFraction: number;
    pileThresholdMm: number;
    groomedDensityHardKgM3: number;
    groomedDensityWetKgM3: number;
    groomFrostC: number;
    groomThawC: number;
    wetSnowLiquidFraction: number;
    iceFrostC: number;
    throwSpreadM: number;
    driftPerMs: number;
    autoFromMonth: number;
    autoToMonth: number;
  };
  guns: GunType[];
  buildings: InfraType[];
  groomers: {
    fuelPlnPerL: number;
    nightBonus: number;
    windowStartH: number;
    windowEndH: number;
    maxShiftH: number;
    transferMin: number;
    slopeFactorPerPercent: number;
    slopeFactorFromPercent: number;
    winchSlopePercent: number;
    freshFactorPerCm: number;
    freshThresholdCm: number;
    pilePushM3h: number;
    breakdownBasePerNight: number;
    breakdownAgeFactor: number;
    repairCostPln: number;
    repairNights: number;
    servicePlnPerHour: number;
    leaseMonthlyShare: number;
    types: GroomerType[];
    /** Etap 7f: ratrak pod chmurką (bez miejsca w garażu). */
    outdoor: { warmupMin: number; frostThresholdC: number; frostBreakdownFactor: number; serviceFactor: number; agingFactor: number };
    /** Etap 7f: rynek ratraków używanych. */
    used: { offersPerSeason: number; ageMinYears: number; ageMaxYears: number; priceShareOfNew: number; priceConditionSpread: number; conditionBreakdownFactor: number };
  };
  /** Etap 7f: rowy zbierające wodę – koszt. */
  ditch: { costPlnPerM: number; metersPerDay: number };
  calibration: { waterM3PerHa: number; energyKWhPerHa: number; energyKWhPerVisit: number; costEurPerM3: number; plnPerEur: number };
}

function readAll<K extends string>(sec: Sec, keys: readonly K[], opts: { min?: number; max?: number } = {}): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = readNumber(sec, k, FILE, opts);
  return out;
}

function list(raw: Sec, key: string): Sec[] {
  const v = raw[key];
  if (!Array.isArray(v) || v.length === 0) throw new Error(`${FILE}: brak listy „${key}”`);
  return v as Sec[];
}

const KINDS: InfraKind[] = ['intake', 'mains', 'well', 'catchment', 'reservoir', 'pump', 'grid', 'garage', 'anchor'];

export function parseSnowmakingParams(raw: unknown): SnowmakingParams {
  const r = raw as Sec;
  const wa = readSection(raw, 'water', FILE);
  const pu = readSection(raw, 'pumping', FILE);
  const en = readSection(raw, 'energy', FILE);
  const pi = readSection(raw, 'pipe', FILE);
  const sn = readSection(raw, 'snow', FILE);
  const gr = readSection(raw, 'groomers', FILE);
  const ca = readSection(raw, 'calibration', FILE);
  const guns = list(r, 'guns').map((g, i): GunType => {
    if (typeof g.id !== 'string' || typeof g.name !== 'string') throw new Error(`${FILE}: armatka ${i} bez id/nazwy`);
    const t = readNumberArray(g, 'curveWetBulbC', FILE);
    const q = readNumberArray(g, 'curveSnowM3h', FILE, { min: 0 });
    if (t.length !== q.length || t.length < 2) throw new Error(`${FILE}: armatka ${g.id} – krzywa wydajności o różnej długości`);
    for (let k = 1; k < t.length; k++) if (!(t[k] < t[k - 1])) throw new Error(`${FILE}: armatka ${g.id} – temperatury krzywej muszą maleć`);
    return { id: g.id, name: g.name, movable: g.movable === 1, curveWetBulbC: t, curveSnowM3h: q, ...readAll(g, ['costPln', 'energyKWhPerM3', 'nozzleHeadM', 'throwM'] as const, { min: 0 }) };
  });
  const buildings = list(r, 'buildings').map((b, i): InfraType => {
    if (typeof b.id !== 'string' || typeof b.name !== 'string' || !KINDS.includes(b.kind as InfraKind)) throw new Error(`${FILE}: budynek ${i} – brak id/nazwy/rodzaju`);
    return { id: b.id, name: b.name, kind: b.kind as InfraKind, summerOnly: b.summerOnly === 1, ...readAll(b, ['costPln', 'capacity', 'buildDays'] as const, { min: 0 }) };
  });
  const types = list(gr, 'types').map((t, i): GroomerType => {
    if (typeof t.id !== 'string' || typeof t.name !== 'string') throw new Error(`${FILE}: ratrak ${i} bez id/nazwy`);
    return { id: t.id, name: t.name, winch: t.winch === 1, ...readAll(t, ['pricePln', 'widthM', 'speedKmh', 'fuelLph', 'powerKw'] as const, { min: 0 }) };
  });
  return {
    water: readAll(wa, ['intakeSummerM3h', 'intakeWinterFactor', 'intakeDryFactorMin', 'normalPrecipMmPerDay', 'precipWindowDays', 'waterFeePlnPerM3', 'fillMonthsFrom', 'fillMonthsTo'] as const, { min: 0 }),
    pumping: readAll(pu, ['efficiency', 'pipeLossMPerKm', 'waterDensityKgM3', 'gravityMs2'] as const, { min: 0 }),
    energy: readAll(en, ['nightTariffFactor', 'nightStartH', 'nightEndH'] as const, { min: 0 }),
    pipe: readAll(pi, ['costPlnPerM', 'supplyCostPlnPerM', 'metersPerDay', 'hydrantSpacingM', 'hydrantCostPln', 'trenchFromMonth', 'trenchToMonth', 'connectRadiusM'] as const, { min: 0 }),
    snow: {
      ...readAll(sn, ['densityAtStartKgM3', 'densityColdKgM3', 'liquidFractionAtStart', 'waterLossFraction', 'pileThresholdMm', 'groomedDensityHardKgM3', 'groomedDensityWetKgM3', 'wetSnowLiquidFraction', 'throwSpreadM', 'driftPerMs', 'autoFromMonth', 'autoToMonth'] as const, { min: 0 }),
      densityColdWetBulbC: readNumber(sn, 'densityColdWetBulbC', FILE),
      groomFrostC: readNumber(sn, 'groomFrostC', FILE),
      groomThawC: readNumber(sn, 'groomThawC', FILE),
      iceFrostC: readNumber(sn, 'iceFrostC', FILE),
    },
    guns,
    buildings,
    groomers: {
      ...readAll(gr, [
        'fuelPlnPerL', 'nightBonus', 'windowStartH', 'windowEndH', 'maxShiftH', 'transferMin', 'slopeFactorPerPercent', 'slopeFactorFromPercent', 'winchSlopePercent',
        'freshFactorPerCm', 'freshThresholdCm', 'pilePushM3h', 'breakdownBasePerNight', 'breakdownAgeFactor', 'repairCostPln', 'repairNights', 'servicePlnPerHour', 'leaseMonthlyShare',
      ] as const, { min: 0 }),
      types,
      outdoor: (() => {
        const o = readSection(gr, 'outdoor', FILE);
        return { ...readAll(o, ['warmupMin', 'frostBreakdownFactor', 'serviceFactor', 'agingFactor'] as const, { min: 0 }), frostThresholdC: readNumber(o, 'frostThresholdC', FILE) };
      })(),
      used: readAll(readSection(gr, 'used', FILE), ['offersPerSeason', 'ageMinYears', 'ageMaxYears', 'priceShareOfNew', 'priceConditionSpread', 'conditionBreakdownFactor'] as const, { min: 0 }),
    },
    ditch: readAll(readSection(raw, 'ditch', FILE), ['costPlnPerM', 'metersPerDay'] as const, { min: 0.01 }),
    calibration: readAll(ca, ['waterM3PerHa', 'energyKWhPerHa', 'energyKWhPerVisit', 'costEurPerM3', 'plnPerEur'] as const, { min: 0 }),
  };
}

export function gunTypeById(p: SnowmakingParams, id: string): GunType {
  const t = p.guns.find((g) => g.id === id);
  if (!t) throw new Error(`Nieznany typ armatki: ${id}`);
  return t;
}

export function groomerTypeById(p: SnowmakingParams, id: string): GroomerType {
  const t = p.groomers.types.find((g) => g.id === id);
  if (!t) throw new Error(`Nieznany typ ratraka: ${id}`);
  return t;
}
