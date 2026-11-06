/**
 * Parametry gości (data/guests.json): scenariusz dnia, umiejętności, typy grup, potrzeby, wybory,
 * ruch, zadowolenie, wypadki i wpływ na śnieg. Same wartości – jednostki i źródła są w pliku.
 */
import { readNumber, readSection } from './params';

const FILE = 'data/guests.json';

export interface SkillLevel {
  id: string;
  name: string;
  share: number;
  maxClass: number;
  preferredClass: number;
  cruiseMs: number;
  comfortSlopePercent: number;
  icyFactor: number;
  mogulFactor: number;
  powderFactor: number;
  accidentFactor: number;
  fatiguePerKm: number;
}

export interface GroupType {
  id: string;
  name: string;
  share: number;
  groupMin: number;
  groupMax: number;
  snowboard: boolean;
}

export interface SnowImpactParams {
  packedDensityKgM3: number;
  passesToPack: number;
  scrapeMmPerPass: number;
  scrapeRefSlopePercent: number;
  scrapeMinSlopePercent: number;
  mogulMinSlopePercent: number;
  passesToMoguls: number;
  mogulFillMm: number;
  mogulMeltDecayPerDay: number;
}

export interface GuestParams {
  scenario: { guestsPerDay: number; arrivalMeanH: number; arrivalSdH: number; arrivalMinH: number; arrivalMaxH: number; stayMeanH: number; staySdH: number; stayMinH: number };
  operation: { liftsOpenH: number; liftsCloseH: number; stepS: number; stationWalkRadiusM: number; walkSpeedMs: number; maxWalkM: number; windHoldMarginMs: number };
  skills: SkillLevel[];
  types: GroupType[];
  traits: { patienceMeanMin: number; patienceSdMin: number; patienceMinMin: number; giveUpFactor: number; childSkillDrop: number; schoolMaxSkill: number };
  needs: {
    hungerPerH: number;
    lunchThreshold: number;
    lunchMin: number;
    fatiguePerH: number;
    restThreshold: number;
    restMin: number;
    restRecoveryPerH: number;
    fatigueLeave: number;
    comfortTempC: number;
    coldPerHPerC: number;
    liftColdFactor: number;
    warmRecoveryPerH: number;
    coldLeave: number;
    coldBreakThreshold: number;
  };
  choice: {
    temperature: number;
    queuePenaltyPerMin: number;
    overPatiencePenalty: number;
    easierClassValue: number;
    harderClassValue: number;
    lengthRefM: number;
    longPreferenceWeight: number;
    powderWeight: number;
    quietWeight: number;
    badSnowWeight: number;
    foodBonus: number;
    homeBonus: number;
    badWeatherLeavePerH: number;
    badSnowLeavePerH: number;
  };
  movement: {
    lateralMarginM: number;
    minGapM: number;
    lookAheadM: number;
    turnLengthMinM: number;
    turnLengthMaxM: number;
    turnAmplitudeM: number;
    flatSlopePercent: number;
    minSpeedMs: number;
    groupGapM: number;
    queueRowSize: number;
    queueSpacingM: number;
  };
  satisfaction: {
    rideRatioWeight: number;
    rideRatioZero: number;
    rideRatioFull: number;
    snowWeight: number;
    crowdWeight: number;
    crowdFullPer100m: number;
    weatherWeight: number;
    matchWeight: number;
    accidentPenalty: number;
    /** Ocena śniegu wg kodu stanu (SNOW_QUALITY_CODES: none, powder, windPacked, settled, firn, slush, icy, thin). */
    snowScoreByQuality: number[];
    mogulPenaltyBeginner: number;
  };
  accidents: { basePerKm: number; crowdFactor: number; icyFactor: number; fatigueFactor: number; tooHardFactor: number; iconHours: number };
  snowImpact: SnowImpactParams;
  thinBase: { speedFactor: number; snowScore: number; accidentFactor: number; damagePerKm: number; damagePenalty: number; avoidWeight: number };
}

type Sec = Record<string, unknown>;

function readAll<K extends string>(sec: Sec, keys: readonly K[], opts: { min?: number; max?: number } = {}): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = readNumber(sec, k, FILE, opts);
  return out;
}

function list(raw: unknown, key: string): Sec[] {
  const v = (raw as Sec)[key];
  if (!Array.isArray(v) || v.length === 0) throw new Error(`${FILE}: brak listy „${key}”`);
  return v as Sec[];
}

export function parseGuestParams(raw: unknown): GuestParams {
  const sc = readSection(raw, 'scenario', FILE);
  const op = readSection(raw, 'operation', FILE);
  const tr = readSection(raw, 'traits', FILE);
  const ne = readSection(raw, 'needs', FILE);
  const ch = readSection(raw, 'choice', FILE);
  const mo = readSection(raw, 'movement', FILE);
  const sa = readSection(raw, 'satisfaction', FILE);
  const ac = readSection(raw, 'accidents', FILE);
  const si = readSection(raw, 'snowImpact', FILE);
  const tb = readSection(raw, 'thinBase', FILE);
  const skills = list(raw, 'skills').map((s, i): SkillLevel => {
    if (typeof s.id !== 'string' || typeof s.name !== 'string') throw new Error(`${FILE}: umiejętność ${i} bez id/nazwy`);
    return {
      id: s.id,
      name: s.name,
      ...readAll(s, ['share', 'cruiseMs', 'comfortSlopePercent', 'icyFactor', 'mogulFactor', 'powderFactor', 'accidentFactor', 'fatiguePerKm'] as const, { min: 0 }),
      maxClass: readNumber(s, 'maxClass', FILE, { integer: true, min: 0 }),
      preferredClass: readNumber(s, 'preferredClass', FILE, { integer: true, min: 0 }),
    };
  });
  const types = list(raw, 'types').map((t, i): GroupType => {
    if (typeof t.id !== 'string' || typeof t.name !== 'string') throw new Error(`${FILE}: typ ${i} bez id/nazwy`);
    return {
      id: t.id,
      name: t.name,
      share: readNumber(t, 'share', FILE, { min: 0 }),
      groupMin: readNumber(t, 'groupMin', FILE, { integer: true, min: 1 }),
      groupMax: readNumber(t, 'groupMax', FILE, { integer: true, min: 1 }),
      snowboard: readNumber(t, 'snowboard', FILE, { min: 0, max: 1 }) === 1,
    };
  });
  const sat = readAll(sa, ['rideRatioWeight', 'rideRatioZero', 'rideRatioFull', 'snowWeight', 'crowdWeight', 'crowdFullPer100m', 'weatherWeight', 'matchWeight', 'accidentPenalty', 'mogulPenaltyBeginner'] as const, { min: 0 });
  const q = (k: string) => readNumber(sa, k, FILE, { min: 0, max: 1 });
  const weights = sat.rideRatioWeight + sat.snowWeight + sat.crowdWeight + sat.weatherWeight + sat.matchWeight;
  if (Math.abs(weights - 1) > 1e-6) throw new Error(`${FILE}: wagi zadowolenia muszą sumować się do 1 (jest ${weights})`);
  return {
    scenario: readAll(sc, ['guestsPerDay', 'arrivalMeanH', 'arrivalSdH', 'arrivalMinH', 'arrivalMaxH', 'stayMeanH', 'staySdH', 'stayMinH'] as const, { min: 0 }),
    operation: readAll(op, ['liftsOpenH', 'liftsCloseH', 'stepS', 'stationWalkRadiusM', 'walkSpeedMs', 'maxWalkM', 'windHoldMarginMs'] as const, { min: 0 }),
    skills,
    types,
    traits: readAll(tr, ['patienceMeanMin', 'patienceSdMin', 'patienceMinMin', 'giveUpFactor', 'childSkillDrop', 'schoolMaxSkill'] as const, { min: 0 }),
    needs: {
      ...readAll(ne, ['hungerPerH', 'lunchThreshold', 'lunchMin', 'fatiguePerH', 'restThreshold', 'restMin', 'restRecoveryPerH', 'fatigueLeave', 'coldPerHPerC', 'liftColdFactor', 'warmRecoveryPerH', 'coldLeave', 'coldBreakThreshold'] as const, { min: 0 }),
      comfortTempC: readNumber(ne, 'comfortTempC', FILE),
    },
    choice: readAll(ch, ['temperature', 'queuePenaltyPerMin', 'overPatiencePenalty', 'easierClassValue', 'harderClassValue', 'lengthRefM', 'longPreferenceWeight', 'powderWeight', 'quietWeight', 'badSnowWeight', 'foodBonus', 'homeBonus', 'badWeatherLeavePerH', 'badSnowLeavePerH'] as const, { min: 0 }),
    movement: readAll(mo, ['lateralMarginM', 'minGapM', 'lookAheadM', 'turnLengthMinM', 'turnLengthMaxM', 'turnAmplitudeM', 'flatSlopePercent', 'minSpeedMs', 'groupGapM', 'queueRowSize', 'queueSpacingM'] as const, { min: 0 }),
    satisfaction: {
      ...sat,
      snowScoreByQuality: [q('snowScoreNone'), q('snowScorePowder'), q('snowScoreWindPacked'), q('snowScoreSettled'), q('snowScoreFirn'), q('snowScoreSlush'), q('snowScoreIcy'), q('snowScoreThin')],
    },
    accidents: readAll(ac, ['basePerKm', 'crowdFactor', 'icyFactor', 'fatigueFactor', 'tooHardFactor', 'iconHours'] as const, { min: 0 }),
    thinBase: readAll(tb, ['speedFactor', 'snowScore', 'accidentFactor', 'damagePerKm', 'damagePenalty', 'avoidWeight'] as const, { min: 0 }),
    snowImpact: readAll(si, ['packedDensityKgM3', 'passesToPack', 'scrapeMmPerPass', 'scrapeRefSlopePercent', 'scrapeMinSlopePercent', 'mogulMinSlopePercent', 'passesToMoguls', 'mogulFillMm', 'mogulMeltDecayPerDay'] as const, { min: 0 }),
  };
}
