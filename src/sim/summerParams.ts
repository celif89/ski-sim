/**
 * Parametry sezonu letniego (data/summer.json, etap 7b): kalendarz lata, przeglądy wyciągów, burze
 * i upał, wyciągi latem, ceny, bike park, ścieżki, tor saneczkowy, odblokowania, koszenie, popyt,
 * reputacja letnia, typy gości, budynki letnie. Same wartości – jednostki i źródła są w pliku.
 */
import { readNumber, readNumberArray, readSection } from './params';

const FILE = 'data/summer.json';
type Sec = Record<string, unknown>;

export const SUMMER_TYPE_IDS = ['hiker', 'family', 'cyclist', 'school'] as const;
export type SummerTypeId = (typeof SUMMER_TYPE_IDS)[number];
export const T_HIKER = 0;
export const T_FAMILY = 1;
export const T_CYCLIST = 2;
export const T_SCHOOL = 3;

export interface SummerType {
  id: SummerTypeId;
  name: string;
  groupMin: number;
  groupMax: number;
  childShare: number;
  /** Udział w puli: [dzień powszedni, weekend, wakacje]. */
  share: number[];
  base: number;
  wLift: number;
  wBike: number;
  wToboggan: number;
  wPlay: number;
  wFood: number;
  wView: number;
  other: number;
  walkSpeedFactor: number;
  maxWalkH: number;
  liftUseShare: number;
  roundTripShare: number;
  foodShare: number;
  stayMeanH: number;
  tobogganRides: number;
  rentalShare: number;
  schoolMonths: number[];
}

export interface SummerBuildingType {
  id: string;
  name: string;
  costPln: number;
  buildDays: number;
  capacity: number;
  maintenanceRatePerYear: number;
}

export interface SummerParams {
  season: {
    earliestOpenMonth: number;
    latestCloseMonth: number;
    holidayStartMonth: number;
    holidayStartDay: number;
    holidayEndMonth: number;
    holidayEndDay: number;
    fixedHolidays: string[];
    corpusChristiDaysAfterEaster: number;
    holidayDayFactor: number;
    bridgeDayFactor: number;
    openH: number;
    closeH: number;
  };
  inspections: { aerialDays: number; surfaceDays: number; validityDays: number; defaultMonth: number; defaultDay: number };
  weather: {
    stormPIfWet: number[];
    stormPIfDry: number[];
    stormMeanHours: number[];
    stormTempFactorPerC: number;
    stormStartMinH: number;
    stormStartMaxH: number;
    heatTmaxC: number;
    rainHeavyMmPerH: number;
  };
  lifts: { bikeRackCarrierShare: number; bikesPerRackSeat: number; pedestrianSpeedFactor: number };
  prices: { liftUpPln: number; liftRoundTripPln: number; bikeDayPln: number; tobogganRidePln: number; bikeRentalDayPln: number; reducedFactor: number; schoolGroupFactor: number; minPricePln: number; maxPricePln: number };
  bike: { classMaxAvgSlopePercent: number[]; maxSlopePercent: number; widthM: number; buildPlnPerM: number; maintenancePlnPerMYear: number; buildMetersPerDay: number; speedMs: number[]; lapsMax: number };
  walk: { buildPlnPerM: number; maintenancePlnPerMYear: number; buildMetersPerDay: number; toblerMaxKmh: number; toblerSlope: number; toblerOffset: number; connectRadiusM: number; hutNamePattern: string };
  toboggan: {
    fixedCostPln: number;
    costPlnPerM: number;
    minSlopePercent: number;
    maxSlopePercent: number;
    maxLengthM: number;
    capacityPerHour: number;
    speedMs: number;
    returnSpeedMs: number;
    energyKWhPerRide: number;
    staffPerDay: number;
    buildDays: number;
    maintenanceRatePerYear: number;
    windStopMs: number;
  };
  unlocks: Record<'bike' | 'walk' | 'toboggan' | 'playground' | 'viewpoint', { reputation: number; capitalPln: number }>;
  mowing: { plnPerHa: number; month: number };
  demand: {
    regionPoolPerDay: number;
    monthFactors: number[];
    weekdayFactors: number[];
    holidayWeekdayFactor: number;
    rainProbabilityPenalty: number;
    stormProbabilityPenalty: number;
    sunnyFactor: number;
    heatFactor: number;
    offerExponent: number;
    reputationRef: number;
    reputationExponent: number;
    priceElasticity: number;
    noiseSd: number;
    marketLiftRoundTripPln: number;
  };
  reputation: { initial: number; priorWeight: number; dailyDecay: number };
  types: SummerType[];
  guests: {
    arrivalMeanH: number;
    arrivalSdH: number;
    arrivalMinH: number;
    arrivalMaxH: number;
    stayMinH: number;
    staySdH: number;
    mealMin: number;
    summitStayMin: number;
    playMin: number;
    fatiguePerWalkH: number;
    heatFatigueFactor: number;
    rainLeaveProbabilityPerH: number;
    queuePatienceMin: number;
    ratingQueueRefMin: number;
    ratingWeights: number[];
    mealSpendPln: number;
    summerFoodSeatsPerBuilding: number;
  };
  buildings: SummerBuildingType[];
  quickModel: { mealFactor: number; tobogganFactor: number; liftFactor: number; bikeFactor: number };
}

function all<K extends string>(sec: Sec, keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = readNumber(sec, k, FILE, { min: 0 });
  return out;
}

function strings(sec: Sec, key: string): string[] {
  const e = sec[key] as { value?: unknown } | undefined;
  if (!e || !Array.isArray(e.value) || e.value.some((v) => typeof v !== 'string')) throw new Error(`${FILE}: „${key}” – oczekiwano listy napisów`);
  return e.value as string[];
}

export function parseSummerParams(raw: unknown): SummerParams {
  const r = raw as Sec;
  const se = readSection(raw, 'season', FILE);
  const ins = readSection(raw, 'inspections', FILE);
  const we = readSection(raw, 'weather', FILE);
  const li = readSection(raw, 'lifts', FILE);
  const pr = readSection(raw, 'prices', FILE);
  const bi = readSection(raw, 'bike', FILE);
  const wa = readSection(raw, 'walk', FILE);
  const to = readSection(raw, 'toboggan', FILE);
  const un = readSection(raw, 'unlocks', FILE);
  const mo = readSection(raw, 'mowing', FILE);
  const de = readSection(raw, 'demand', FILE);
  const re = readSection(raw, 'reputation', FILE);
  const gu = readSection(raw, 'guests', FILE);
  const pattern = (wa.hutNamePattern as { value?: unknown } | undefined)?.value;
  if (typeof pattern !== 'string') throw new Error(`${FILE}: walk.hutNamePattern – oczekiwano napisu`);
  const typesRaw = r.types;
  if (!Array.isArray(typesRaw) || typesRaw.length !== SUMMER_TYPE_IDS.length) throw new Error(`${FILE}: „types” – oczekiwano ${SUMMER_TYPE_IDS.length} typów`);
  const types = (typesRaw as Sec[]).map((t, i): SummerType => {
    if (t.id !== SUMMER_TYPE_IDS[i] || typeof t.name !== 'string') throw new Error(`${FILE}: typ ${i} – oczekiwano id „${SUMMER_TYPE_IDS[i]}”`);
    const opt = (k: string, d: number) => (t[k] ? readNumber(t, k, FILE, { min: 0 }) : d);
    return {
      id: t.id as SummerTypeId,
      name: t.name,
      ...all(t, ['groupMin', 'groupMax', 'childShare', 'base', 'wLift', 'wBike', 'wToboggan', 'wPlay', 'wFood', 'wView', 'other', 'walkSpeedFactor', 'maxWalkH', 'liftUseShare', 'roundTripShare', 'foodShare', 'stayMeanH'] as const),
      share: readNumberArray(t, 'share', FILE, { length: 3, min: 0 }),
      tobogganRides: opt('tobogganRides', 1),
      rentalShare: opt('rentalShare', 0),
      schoolMonths: t.schoolMonths ? readNumberArray(t, 'schoolMonths', FILE) : [],
    };
  });
  const unlock = (k: string) => {
    const s = readSection(un, k, FILE);
    return { reputation: readNumber(s, 'reputation', FILE, { min: 0 }), capitalPln: readNumber(s, 'capitalPln', FILE, { min: 0 }) };
  };
  const bRaw = r.buildings;
  if (!Array.isArray(bRaw)) throw new Error(`${FILE}: brak listy „buildings”`);
  return {
    season: {
      ...all(se, ['earliestOpenMonth', 'latestCloseMonth', 'holidayStartMonth', 'holidayStartDay', 'holidayEndMonth', 'holidayEndDay', 'corpusChristiDaysAfterEaster', 'holidayDayFactor', 'bridgeDayFactor', 'openH', 'closeH'] as const),
      fixedHolidays: strings(se, 'fixedHolidays'),
    },
    inspections: all(ins, ['aerialDays', 'surfaceDays', 'validityDays', 'defaultMonth', 'defaultDay'] as const),
    weather: {
      stormPIfWet: readNumberArray(we, 'stormPIfWet', FILE, { length: 12, min: 0, max: 1 }),
      stormPIfDry: readNumberArray(we, 'stormPIfDry', FILE, { length: 12, min: 0, max: 1 }),
      stormMeanHours: readNumberArray(we, 'stormMeanHours', FILE, { length: 12, min: 0 }),
      ...all(we, ['stormTempFactorPerC', 'stormStartMinH', 'stormStartMaxH', 'heatTmaxC', 'rainHeavyMmPerH'] as const),
    },
    lifts: all(li, ['bikeRackCarrierShare', 'bikesPerRackSeat', 'pedestrianSpeedFactor'] as const),
    prices: all(pr, ['liftUpPln', 'liftRoundTripPln', 'bikeDayPln', 'tobogganRidePln', 'bikeRentalDayPln', 'reducedFactor', 'schoolGroupFactor', 'minPricePln', 'maxPricePln'] as const),
    bike: {
      classMaxAvgSlopePercent: readNumberArray(bi, 'classMaxAvgSlopePercent', FILE, { length: 3, min: 0 }),
      speedMs: readNumberArray(bi, 'speedMs', FILE, { length: 4, min: 0.1 }),
      ...all(bi, ['maxSlopePercent', 'widthM', 'buildPlnPerM', 'maintenancePlnPerMYear', 'buildMetersPerDay', 'lapsMax'] as const),
    },
    walk: { ...all(wa, ['buildPlnPerM', 'maintenancePlnPerMYear', 'buildMetersPerDay', 'toblerMaxKmh', 'toblerSlope', 'toblerOffset', 'connectRadiusM'] as const), hutNamePattern: pattern },
    toboggan: all(to, ['fixedCostPln', 'costPlnPerM', 'minSlopePercent', 'maxSlopePercent', 'maxLengthM', 'capacityPerHour', 'speedMs', 'returnSpeedMs', 'energyKWhPerRide', 'staffPerDay', 'buildDays', 'maintenanceRatePerYear', 'windStopMs'] as const),
    unlocks: { bike: unlock('bike'), walk: unlock('walk'), toboggan: unlock('toboggan'), playground: unlock('playground'), viewpoint: unlock('viewpoint') },
    mowing: all(mo, ['plnPerHa', 'month'] as const),
    demand: {
      ...all(de, ['regionPoolPerDay', 'holidayWeekdayFactor', 'rainProbabilityPenalty', 'stormProbabilityPenalty', 'sunnyFactor', 'heatFactor', 'offerExponent', 'reputationRef', 'reputationExponent', 'priceElasticity', 'noiseSd', 'marketLiftRoundTripPln'] as const),
      monthFactors: readNumberArray(de, 'monthFactors', FILE, { length: 12, min: 0 }),
      weekdayFactors: readNumberArray(de, 'weekdayFactors', FILE, { length: 7, min: 0 }),
    },
    reputation: all(re, ['initial', 'priorWeight', 'dailyDecay'] as const),
    types,
    guests: {
      ...all(gu, ['arrivalMeanH', 'arrivalSdH', 'arrivalMinH', 'arrivalMaxH', 'stayMinH', 'staySdH', 'mealMin', 'summitStayMin', 'playMin', 'fatiguePerWalkH', 'heatFatigueFactor', 'rainLeaveProbabilityPerH', 'queuePatienceMin', 'ratingQueueRefMin', 'mealSpendPln', 'summerFoodSeatsPerBuilding'] as const),
      ratingWeights: readNumberArray(gu, 'ratingWeights', FILE, { length: 4, min: 0 }),
    },
    quickModel: all(readSection(raw, 'quickModel', FILE), ['mealFactor', 'tobogganFactor', 'liftFactor', 'bikeFactor'] as const),
    buildings: (bRaw as Sec[]).map((b, i): SummerBuildingType => {
      if (typeof b.id !== 'string' || typeof b.name !== 'string') throw new Error(`${FILE}: budynek ${i} bez id/nazwy`);
      return { id: b.id, name: b.name, ...all(b, ['costPln', 'buildDays', 'capacity', 'maintenanceRatePerYear'] as const) };
    }),
  };
}
