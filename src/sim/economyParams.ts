/**
 * Parametry ekonomii (data/economy.json): kalendarz roku, karnety, godziny, popyt, skład gości,
 * ferie, koszty, kredyt, reputacja, model zgrubny dnia, konkurencja, budynki.
 * Same wartości – jednostki i źródła są w pliku.
 */
import type { RoadParams } from './resort';
import type { SummerParams } from './summerParams';
import { readNumber, readNumberArray, readSection } from './params';
import type { SnowmakingParams } from './snowmakingParams';

const FILE = 'data/economy.json';
type Sec = Record<string, unknown>;

export interface PassPrices {
  dayPln: number;
  fourHourPln: number;
  twoHourPln: number;
  pointPln: number;
}

export interface OpeningHours {
  openH: number;
  closeH: number;
}

export interface FeriaTurn {
  /** Data początku w roku wzorcowym (poniedziałek) – w innych latach ten sam tydzień ISO. */
  start: string;
  regions: string[];
}

export interface CompetitorDef {
  name: string;
  bottomM: number;
  topM: number;
  pisteKm: number;
  snowmakingShare: number;
  dayPln: number;
  reputation: number;
}

export interface BuildingType {
  id: string;
  name: string;
  /** Parking – baza (tu przyjeżdżają goście). */
  base: boolean;
  costPln: number;
  cars: number;
  feePerCarPln: number;
  buildDays: number;
  staffPerDay: number;
  revenuePerGuestPln: number;
  costShare: number;
  useShare: number;
  capacityPerDay: number;
  /** Etap 6b: działa tylko do gastronomii położonej co najmniej tak daleko od parkingu (transport do schroniska). */
  minDistanceFromParkingM: number;
}

export interface EconomyParams {
  calendar: {
    summerStartMonth: number;
    autumnStartMonth: number;
    winterStartMonth: number;
    springStartMonth: number;
    earliestOpenMonth: number;
    latestCloseMonth: number;
    summerWeekDays: number;
    fixedChargesMonth: number;
  };
  career: { startDate: string; startCapitalPln: number; overdraftLimitPln: number; bankruptcyDays: number };
  loan: { interestRatePerYear: number; maxTermYears: number; minTermYears: number; maxLoanToAssets: number };
  passes: PassPrices & {
    pointsSurfaceRide: number;
    pointsChairRide: number;
    pointsGondolaRide: number;
    reducedFactor: number;
    dayPassHabitShare: number;
    minPricePln: number;
    maxPricePln: number;
  };
  hours: OpeningHours & { minOpenH: number; maxCloseH: number };
  demand: {
    regionPoolPerDay: number;
    weekdayFactors: number[];
    monthFactors: number[];
    holidayDayFactor: number;
    feriaBoost: number;
    christmasBoost: number;
    christmasStartDay: number;
    newYearEveFactor: number;
    newYearDayFactor: number;
    publicHolidayFactor: number;
    offerExponent: number;
    snowExponent: number;
    reputationRef: number;
    reputationExponent: number;
    priceElasticity: number;
    otherAttractiveness: number;
    rainProbabilityPenalty: number;
    coldLimitC: number;
    coldFactor: number;
    windLimitMs: number;
    windFactor: number;
    sunnyCloudMax: number;
    sunnyFactor: number;
    personsPerCar: number;
    busShareSchool: number;
    streetParkingCars: number;
    lowSnowLimit: number;
    noiseSd: number;
  };
  mix: { weekday: number[]; weekend: number[]; holiday: number[] };
  ferie: { turns: FeriaTurn[]; durationDays: number; regionWeights: Record<string, number> };
  costs: {
    energyPlnPerKWh: number;
    hourlyWagePln: number;
    employerCostFactor: number;
    staffExtraHours: number;
    staffSurfaceLift: number;
    staffAerialLift: number;
    staffMidStation: number;
    guestsPerCashier: number;
    patrolPerKm: number;
    patrolMin: number;
    patrolHourlyPln: number;
    seasonalPer1000Guests: number;
    seasonalMin: number;
    permanentStaff: number;
    permanentStaffPerLift: number;
    adminShareOfRevenue: number;
    permanentMonthlyPln: number;
    inspectionSurfacePln: number;
    inspectionAerialPln: number;
    insuranceRatePerYear: number;
    maintenanceLiftsRatePerYear: number;
    maintenancePistesRatePerYear: number;
    maintenanceBuildingsRatePerYear: number;
    winterBuildProgressFactor: number;
    winterBuildCostFactor: number;
    rebuildFeeShare: number;
    rebuildDaysShare: number;
    cancelRefundShare: number;
    /** Etap 7f: zwrot przy rozbiórce gotowego obiektu (udział kosztu). */
    demolishRefundShare: number;
  };
  reputation: { initial: number; priorWeight: number; dailyDecay: number };
  quickDay: {
    meanStayH: number;
    activeShare: number;
    descentSpeedMs: number;
    cycleExtraMin: number;
    stayQueueTauMin: number;
    matchScore: number;
    sampleGuests: number;
    maxQueueMin: number;
    onPisteShare: number;
  };
  competitors: {
    snowmakingMmPerDay: number;
    snowmakingMaxTempC: number;
    openBaseCm: number;
    seasonStartDay: number;
    seasonEndMonth: number;
    meltMmPerDegreeDay: number;
    list: CompetitorDef[];
  };
  buildings: BuildingType[];
  /** Etap 7: parametry naśnieżania i ratraków (data/snowmaking.json) – dołączane przez withSnowmaking. */
  snowmaking?: SnowmakingParams | null;
  /** Etap 6b: drogi (odśnieżanie zimą) – dołączane przez withRoads. */
  roads?: RoadParams | null;
  /** Etap 7b: sezon letni, przeglądy wyciągów (data/summer.json) – dołączane przez withSummer. */
  summer?: SummerParams | null;
}

/** Ekonomia z sezonem letnim i przeglądami wyciągów (etap 7b). */
export function withSummer(ep: EconomyParams, sp: SummerParams): EconomyParams {
  return { ...ep, summer: sp };
}

/** Ekonomia z parametrami naśnieżania (koszty rurociągów, armatek, infrastruktury). */
export function withSnowmaking(ep: EconomyParams, sp: SnowmakingParams): EconomyParams {
  return { ...ep, snowmaking: sp };
}

/** Ekonomia z parametrami dróg (etap 6b: odśnieżanie, data/construction.json – sekcja roads). */
export function withRoads(ep: EconomyParams, rp: RoadParams): EconomyParams {
  return { ...ep, roads: rp };
}

function readAll<K extends string>(sec: Sec, keys: readonly K[], opts: { min?: number; max?: number } = {}): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = readNumber(sec, k, FILE, opts);
  return out;
}

function list(sec: Sec, key: string): Sec[] {
  const v = sec[key];
  if (!Array.isArray(v) || v.length === 0) throw new Error(`${FILE}: brak listy „${key}”`);
  return v as Sec[];
}

export function parseEconomyParams(raw: unknown): EconomyParams {
  const cal = readSection(raw, 'calendar', FILE);
  const car = readSection(raw, 'career', FILE);
  const lo = readSection(raw, 'loan', FILE);
  const pa = readSection(raw, 'passes', FILE);
  const ho = readSection(raw, 'hours', FILE);
  const de = readSection(raw, 'demand', FILE);
  const mi = readSection(raw, 'mix', FILE);
  const fe = readSection(raw, 'ferie', FILE);
  const co = readSection(raw, 'costs', FILE);
  const re = readSection(raw, 'reputation', FILE);
  const qd = readSection(raw, 'quickDay', FILE);
  const cp = readSection(raw, 'competitors', FILE);
  const bu = readSection(raw, 'buildings', FILE);
  if (typeof car.startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(car.startDate)) throw new Error(`${FILE}: career.startDate – oczekiwano RRRR-MM-DD`);
  const weightsSec = fe.regionWeights as Sec;
  const regionWeights: Record<string, number> = {};
  for (const k of Object.keys(weightsSec ?? {})) if (!k.startsWith('_')) regionWeights[k] = readNumber(weightsSec, k, FILE, { min: 0, max: 1 });
  const turns = list(fe, 'turns').map((t, i): FeriaTurn => {
    if (typeof t.start !== 'string' || !Array.isArray(t.regions)) throw new Error(`${FILE}: tura ferii ${i} – brak daty lub regionów`);
    return { start: t.start, regions: t.regions.map(String) };
  });
  const mixArr = (k: string) => readNumberArray(mi, k, FILE, { length: 4, min: 0 });
  return {
    calendar: readAll(cal, ['summerStartMonth', 'autumnStartMonth', 'winterStartMonth', 'springStartMonth', 'earliestOpenMonth', 'latestCloseMonth', 'summerWeekDays', 'fixedChargesMonth'] as const, { min: 1 }),
    career: { startDate: car.startDate, ...readAll(car, ['startCapitalPln', 'overdraftLimitPln', 'bankruptcyDays'] as const, { min: 0 }) },
    loan: readAll(lo, ['interestRatePerYear', 'maxTermYears', 'minTermYears', 'maxLoanToAssets'] as const, { min: 0 }),
    passes: readAll(pa, ['dayPln', 'fourHourPln', 'twoHourPln', 'pointPln', 'pointsSurfaceRide', 'pointsChairRide', 'pointsGondolaRide', 'reducedFactor', 'dayPassHabitShare', 'minPricePln', 'maxPricePln'] as const, { min: 0 }),
    hours: readAll(ho, ['openH', 'closeH', 'minOpenH', 'maxCloseH'] as const, { min: 0, max: 24 }),
    demand: {
      ...readAll(de, [
        'regionPoolPerDay', 'holidayDayFactor', 'feriaBoost', 'christmasBoost', 'christmasStartDay', 'newYearEveFactor', 'newYearDayFactor', 'publicHolidayFactor',
        'offerExponent', 'snowExponent', 'reputationRef', 'reputationExponent', 'priceElasticity', 'otherAttractiveness', 'rainProbabilityPenalty',
        'windLimitMs', 'windFactor', 'sunnyCloudMax', 'sunnyFactor', 'personsPerCar', 'busShareSchool', 'streetParkingCars', 'lowSnowLimit', 'coldFactor', 'noiseSd',
      ] as const, { min: 0 }),
      coldLimitC: readNumber(de, 'coldLimitC', FILE),
      weekdayFactors: readNumberArray(de, 'weekdayFactors', FILE, { length: 7, min: 0 }),
      monthFactors: readNumberArray(de, 'monthFactors', FILE, { length: 12, min: 0 }),
    },
    mix: { weekday: mixArr('weekday'), weekend: mixArr('weekend'), holiday: mixArr('holiday') },
    ferie: { turns, durationDays: readNumber(fe, 'durationDays', FILE, { integer: true, min: 1 }), regionWeights },
    costs: readAll(co, [
      'energyPlnPerKWh', 'hourlyWagePln', 'employerCostFactor', 'staffExtraHours', 'staffSurfaceLift', 'staffAerialLift', 'staffMidStation', 'guestsPerCashier',
      'patrolPerKm', 'patrolMin', 'patrolHourlyPln', 'seasonalPer1000Guests', 'seasonalMin', 'permanentStaff', 'permanentStaffPerLift', 'adminShareOfRevenue', 'permanentMonthlyPln', 'inspectionSurfacePln',
      'inspectionAerialPln', 'insuranceRatePerYear', 'maintenanceLiftsRatePerYear', 'maintenancePistesRatePerYear', 'maintenanceBuildingsRatePerYear',
      'winterBuildProgressFactor', 'winterBuildCostFactor', 'rebuildFeeShare', 'rebuildDaysShare', 'cancelRefundShare', 'demolishRefundShare',
    ] as const, { min: 0 }),
    reputation: readAll(re, ['initial', 'priorWeight', 'dailyDecay'] as const, { min: 0 }),
    quickDay: readAll(qd, ['meanStayH', 'activeShare', 'descentSpeedMs', 'cycleExtraMin', 'stayQueueTauMin', 'matchScore', 'sampleGuests', 'maxQueueMin', 'onPisteShare'] as const, { min: 0 }),
    competitors: {
      ...readAll(cp, ['snowmakingMmPerDay', 'openBaseCm', 'seasonStartDay', 'seasonEndMonth', 'meltMmPerDegreeDay'] as const, { min: 0 }),
      snowmakingMaxTempC: readNumber(cp, 'snowmakingMaxTempC', FILE),
      list: list(cp, 'list').map((c, i): CompetitorDef => {
        if (typeof c.name !== 'string') throw new Error(`${FILE}: konkurent ${i} bez nazwy`);
        return { name: c.name, ...readAll(c, ['bottomM', 'topM', 'pisteKm', 'snowmakingShare', 'dayPln', 'reputation'] as const, { min: 0 }) };
      }),
    },
    buildings: list(bu, 'types').map((b, i): BuildingType => {
      if (typeof b.id !== 'string' || typeof b.name !== 'string') throw new Error(`${FILE}: budynek ${i} bez id/nazwy`);
      return {
        id: b.id,
        name: b.name,
        base: b.base === true,
        ...readAll(b, ['costPln', 'cars', 'feePerCarPln', 'buildDays', 'staffPerDay', 'revenuePerGuestPln', 'costShare', 'useShare', 'capacityPerDay', 'minDistanceFromParkingM'] as const, { min: 0 }),
      };
    }),
  };
}

export function buildingTypeById(p: EconomyParams, id: string | undefined): BuildingType | null {
  return p.buildings.find((b) => b.id === id) ?? null;
}
