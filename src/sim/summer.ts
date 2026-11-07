/**
 * Sezon letni (etap 7b): kalendarz lata (wakacje, długie weekendy, Boże Ciało), pogoda letnia
 * (burze z IMGW, upał, deszcz), trasy letnie (bike park, ścieżki spacerowe, tor saneczkowy) z analizą
 * terenu, fakty o ośrodku latem (kolej dla pieszych, wieszaki na rowery), popyt dnia osobno dla każdego
 * typu gości, model zgrubny dnia letniego i przepływy pieniędzy dnia. Bez DOM – ten sam kod w grze,
 * testach i bez grafiki.
 */
import type { EconomyParams } from './economyParams';
import * as inspectionsApi from './inspections';
import type { Flows, GameState, ResortFacts } from './economy';
import type { LiftParams, PointM } from './lifts';
import { liftPath, liftTypeById } from './lifts';
import type { ResortLayout } from './resort';
import { Rng } from './rng';
import type { SummerParams } from './summerParams';
import { T_CYCLIST, T_FAMILY, T_SCHOOL } from './summerParams';
import { addDays, daysBetween, formatIsoDate } from './time';
import type { CalendarDate } from './weather';
import { dailyAtElevation } from './weather';
import type { WeatherBook } from './weatherBook';

// ------------------------------------------------------------------ kalendarz lata

/** Niedziela Wielkanocna (algorytm Meeusa–Jonesa–Butchera, kalendarz gregoriański). */
export function easterSunday(year: number): CalendarDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

const weekday = (d: CalendarDate) => (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;
const DAY_NAMES = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];

export interface SummerDayInfo {
  weekday: number;
  /** Święto (1, 3 maja, Boże Ciało, 15 sierpnia). */
  holiday: boolean;
  /** Piątek po czwartkowym święcie (długi weekend). */
  bridge: boolean;
  /** Wakacje szkolne. */
  schoolHolidays: boolean;
  /** Kolumna udziałów typów gości: 0 – dzień powszedni, 1 – weekend/święto, 2 – wakacje. */
  mixIndex: number;
  /** Współczynnik dnia (jak sobota = 1). */
  dayFactor: number;
  label: string;
}

export function summerDayInfo(d: CalendarDate, sp: SummerParams): SummerDayInfo {
  const s = sp.season;
  const wd = weekday(d);
  const mmdd = `${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  const cc = addDays(easterSunday(d.year), s.corpusChristiDaysAfterEaster);
  const isCc = cc.month === d.month && cc.day === d.day;
  const holiday = s.fixedHolidays.includes(mmdd) || isCc;
  const yesterday = addDays(d, -1);
  const yHoliday = s.fixedHolidays.includes(`${String(yesterday.month).padStart(2, '0')}-${String(yesterday.day).padStart(2, '0')}`) || (cc.month === yesterday.month && cc.day === yesterday.day);
  const bridge = wd === 4 && yHoliday;
  const from = { year: d.year, month: s.holidayStartMonth, day: s.holidayStartDay };
  const to = { year: d.year, month: s.holidayEndMonth, day: s.holidayEndDay };
  const schoolHolidays = daysBetween(from, d) >= 0 && daysBetween(d, to) >= 0;
  const wf = sp.demand.weekdayFactors;
  let dayFactor = wf[wd];
  if (holiday) dayFactor = Math.max(dayFactor, s.holidayDayFactor * wf[5]);
  else if (bridge) dayFactor = Math.max(dayFactor, s.bridgeDayFactor * wf[5]);
  else if (schoolHolidays && wd < 5) dayFactor = Math.max(dayFactor, sp.demand.holidayWeekdayFactor * wf[5]);
  const weekendLike = wd >= 5 || holiday || bridge;
  const mixIndex = schoolHolidays ? 2 : weekendLike ? 1 : 0;
  const parts = [DAY_NAMES[wd]];
  if (isCc) parts.push('Boże Ciało');
  else if (holiday) parts.push('święto');
  if (bridge) parts.push('długi weekend');
  if (schoolHolidays) parts.push('wakacje');
  return { weekday: wd, holiday, bridge, schoolHolidays, mixIndex, dayFactor, label: parts.join(', ') };
}

/** Czy w tym miesiącu można mieć otwarty sezon letni. */
export function summerSeasonAllowed(d: CalendarDate, sp: SummerParams): boolean {
  return d.month >= sp.season.earliestOpenMonth && d.month <= sp.season.latestCloseMonth;
}

// ------------------------------------------------------------------ pogoda letnia

export interface SummerWeather {
  /** Prawdopodobieństwo burzy w tym dniu (z pogody dnia – do prognozy). */
  stormProbability: number;
  storm: boolean;
  stormFromH: number;
  stormToH: number;
  /** Temperatura maksymalna przy dolnej stacji [°C] i upał. */
  tmaxBottomC: number;
  heat: boolean;
  /** Opad dnia przy dolnej stacji [mm], godziny opadu (początek i koniec). */
  precipMm: number;
  rainFromH: number;
  rainToH: number;
  windTopMs: number;
}

/**
 * Pogoda letnia dnia: burza losowana z ziarnem gry (prawdopodobieństwo z IMGW – inne w dniu z opadem
 * i bez; cieplej od normy – częściej), godziny burzy po południu; upał z temperatury maksymalnej.
 */
export function summerWeather(book: WeatherBook, date: CalendarDate, sp: SummerParams, seed: number): SummerWeather {
  const w = sp.weather;
  const day = book.daily(date);
  const bottom = dailyAtElevation(day, book.bottomElevationM, book.profile, book.weatherParams);
  const top = dailyAtElevation(day, book.topElevationM, book.profile, book.weatherParams);
  const m = date.month - 1;
  const tmax = bottom.tMeanC + day.diurnalRangeC / 2;
  const base = day.wet ? w.stormPIfWet[m] : w.stormPIfDry[m];
  const p = Math.min(0.95, Math.max(0, base * Math.exp(w.stormTempFactorPerC * day.anomalyC)));
  const rng = new Rng(seed).fork('burza').fork(formatIsoDate(date));
  const storm = rng.next() < p;
  const from = w.stormStartMinH + rng.next() * Math.max(0, w.stormStartMaxH - w.stormStartMinH);
  const dur = Math.max(1, w.stormMeanHours[m] * (0.5 + rng.next()));
  return {
    stormProbability: p,
    storm,
    stormFromH: storm ? from : 0,
    stormToH: storm ? from + dur : 0,
    tmaxBottomC: tmax,
    heat: tmax >= w.heatTmaxC,
    precipMm: day.wet ? bottom.precipitationMm : 0,
    rainFromH: day.wet ? day.precipitationStartHour : 0,
    rainToH: day.wet ? day.precipitationStartHour + day.precipitationDurationHours : 0,
    windTopMs: top.windMs,
  };
}

export function stormAt(w: SummerWeather, hour: number): boolean {
  return w.storm && hour >= w.stormFromH && hour < w.stormToH;
}

/** Godziny burzy w przedziale [a, b). */
export function stormHoursIn(w: SummerWeather, a: number, b: number): number {
  return w.storm ? Math.max(0, Math.min(b, w.stormToH) - Math.max(a, w.stormFromH)) : 0;
}

// ------------------------------------------------------------------ trasy letnie

export type TrailKind = 'bike' | 'walk' | 'toboggan';

export interface TrailDesign {
  id: string;
  name: string;
  kind: TrailKind;
  /** Oś od początku do końca (rower i tor – od góry w dół; dowolnie, analiza ustawi kierunek). */
  points: PointM[];
  closed?: boolean;
  /** Etap 7c (edycja, tylko widok): punkty kontrolne linii i gładkość łuku (0 – łamana, 1 – łuk); `points` to gęsty przebieg z nich liczony. */
  ctrl?: PointM[];
  smooth?: number;
}

export interface TrailAnalysis {
  lengthM: number;
  dropM: number;
  meanSlopePercent: number;
  maxSlopePercent: number;
  /** Bike park: 0 – zielona … 3 – czarna; inne −1. */
  classIndex: number;
  ok: boolean;
  issues: string[];
  costPln: number;
  buildDays: number;
  maintenancePlnPerYear: number;
  /** Oś od góry w dół (rower, tor) z wysokością i odległością. */
  axis: { xM: number; yM: number; zM: number; distM: number }[];
}

export const BIKE_CLASS_NAMES = ['zielona', 'niebieska', 'czerwona', 'czarna'];
export const TRAIL_KIND_NAMES: Record<TrailKind, string> = { bike: 'trasa rowerowa', walk: 'ścieżka spacerowa', toboggan: 'tor saneczkowy' };

export function analyzeTrail(t: TrailDesign, grid: { sampleElevationM(x: number, y: number): number }, sp: SummerParams): TrailAnalysis {
  const step = 10;
  let axis: TrailAnalysis['axis'] = [];
  let dist = 0;
  for (let i = 0; i < t.points.length; i++) {
    const a = t.points[i];
    if (i === 0) {
      axis.push({ xM: a.xM, yM: a.yM, zM: grid.sampleElevationM(a.xM, a.yM), distM: 0 });
      continue;
    }
    const p = t.points[i - 1];
    const L = Math.hypot(a.xM - p.xM, a.yM - p.yM);
    const n = Math.max(1, Math.ceil(L / step));
    for (let s = 1; s <= n; s++) {
      const x = p.xM + ((a.xM - p.xM) * s) / n;
      const y = p.yM + ((a.yM - p.yM) * s) / n;
      dist += L / n;
      axis.push({ xM: x, yM: y, zM: grid.sampleElevationM(x, y), distM: dist });
    }
  }
  const issues: string[] = [];
  const off = axis.some((q) => Number.isNaN(q.zM));
  if (off) issues.push('poza mapą');
  if (t.kind !== 'walk' && axis.length > 1 && axis[0].zM < axis[axis.length - 1].zM) {
    // Rower i tor – od góry w dół.
    const L = dist;
    axis = axis.reverse().map((q) => ({ ...q, distM: L - q.distM }));
  }
  const lengthM = dist;
  const dropM = axis.length > 1 ? axis[0].zM - axis[axis.length - 1].zM : 0;
  const meanSlopePercent = lengthM > 0 ? (Math.abs(dropM) / lengthM) * 100 : 0;
  // Nachylenie na odcinkach 20 m (spadek > 0 w dół trasy).
  let maxSlopePercent = 0;
  let minSlopePercent = Infinity;
  let rising = 0;
  for (let i = 2; i < axis.length; i += 2) {
    const dz = axis[i - 2].zM - axis[i].zM;
    const dd = axis[i].distM - axis[i - 2].distM;
    if (dd <= 0) continue;
    const s = (dz / dd) * 100;
    maxSlopePercent = Math.max(maxSlopePercent, Math.abs(s));
    minSlopePercent = Math.min(minSlopePercent, s);
    if (s < -2) rising += dd;
  }
  let classIndex = -1;
  let costPln = 0;
  let buildDays = 1;
  let maintenancePlnPerYear = 0;
  if (t.kind === 'bike') {
    const th = sp.bike.classMaxAvgSlopePercent;
    classIndex = meanSlopePercent <= th[0] ? 0 : meanSlopePercent <= th[1] ? 1 : meanSlopePercent <= th[2] ? 2 : 3;
    if (maxSlopePercent > sp.bike.maxSlopePercent) issues.push(`odcinek ${Math.round(maxSlopePercent)} % – za stromy na rower (do ${sp.bike.maxSlopePercent} %)`);
    if (rising > 50) issues.push(`${Math.round(rising)} m pod górę`);
    costPln = lengthM * sp.bike.buildPlnPerM;
    buildDays = Math.max(1, Math.ceil(lengthM / sp.bike.buildMetersPerDay));
    maintenancePlnPerYear = lengthM * sp.bike.maintenancePlnPerMYear;
  } else if (t.kind === 'walk') {
    costPln = lengthM * sp.walk.buildPlnPerM;
    buildDays = Math.max(1, Math.ceil(lengthM / sp.walk.buildMetersPerDay));
    maintenancePlnPerYear = lengthM * sp.walk.maintenancePlnPerMYear;
  } else {
    const tb = sp.toboggan;
    if (lengthM > tb.maxLengthM) issues.push(`za długi: ${Math.round(lengthM)} m (do ${tb.maxLengthM} m)`);
    if (maxSlopePercent > tb.maxSlopePercent) issues.push(`za stromo: ${Math.round(maxSlopePercent)} % (do ${tb.maxSlopePercent} %)`);
    if (minSlopePercent < tb.minSlopePercent && Number.isFinite(minSlopePercent)) issues.push(`za płasko lub pod górę: ${Math.round(minSlopePercent)} % (co najmniej ${tb.minSlopePercent} %)`);
    costPln = tb.fixedCostPln + lengthM * tb.costPlnPerM;
    buildDays = tb.buildDays;
    maintenancePlnPerYear = costPln * tb.maintenanceRatePerYear;
  }
  const ok = !off && (t.kind !== 'toboggan' || issues.length === 0) && lengthM >= 30;
  if (lengthM < 30) issues.push('za krótka');
  return { lengthM, dropM, meanSlopePercent, maxSlopePercent, classIndex, ok, issues, costPln, buildDays, maintenancePlnPerYear, axis };
}

export function analyzeTrails(layout: ResortLayout, grid: { sampleElevationM(x: number, y: number): number }, sp: SummerParams): Map<string, TrailAnalysis> {
  const m = new Map<string, TrailAnalysis>();
  for (const t of layout.trails ?? []) m.set(t.id, analyzeTrail(t, grid, sp));
  return m;
}

// ------------------------------------------------------------------ fakty o ośrodku latem

export interface SummerLiftFact {
  id: string;
  name: string;
  /** Indeks w ResortFacts.lifts. */
  index: number;
  /** Kolej linowa zbudowana, z ważnym przeglądem, nie w przeglądzie, kursuje latem. */
  operating: boolean;
  bikeRacks: boolean;
  /** Przepustowość dla pieszych (bez miejsc z wieszakami) i rowerów [na godzinę w jedną stronę]. */
  pedCapacityPerHour: number;
  bikeCapacityPerHour: number;
  rideMin: number;
  lengthM: number;
  bottom: PointM;
  top: PointM;
  windLimitMs: number;
}

export interface SummerFacts {
  lifts: SummerLiftFact[];
  /** Trasy rowerowe dostępne z koleją z wieszakami (początek przy górnej stacji). */
  bikeTrails: { id: string; classIndex: number; lengthM: number; descentMin: number; liftId: string }[];
  bikeKm: number;
  toboggan: { id: string; lengthM: number; capacityPerHour: number; rideMin: number } | null;
  playgrounds: number;
  viewpoints: number;
  /** Gastronomia ośrodka na górze (daleko od parkingów) i na dole; miejsca razem. */
  foodTop: number;
  foodBase: number;
  foodSeats: number;
  rental: boolean;
  parkingCars: number;
  walkKm: number;
}

const STATION_RADIUS_M = 150;

/**
 * Co latem działa: koleje linowe (kanapy, gondole) zbudowane, nie zamknięte, kursujące latem
 * (`summerOff` – gracz wyłączył), z ważnym przeglądem i nie w przeglądzie; wyciągi powierzchniowe stoją.
 */
export function summerFacts(
  layout: ResortLayout,
  trails: Map<string, TrailAnalysis>,
  facts: ResortFacts,
  state: GameState,
  lp: LiftParams,
  sp: SummerParams,
  ep: EconomyParams,
  liftAvailable: (id: string) => boolean,
): SummerFacts {
  const lifts: SummerLiftFact[] = [];
  layout.lifts.forEach((l, i) => {
    const t = liftTypeById(lp, l.typeId);
    const f = facts.lifts[i];
    if (!f || t.kind !== 'aerial') return;
    const racks = l.bikeRacks === true;
    const path = liftPath(l);
    let pathM = 0;
    for (let k = 1; k < path.length; k++) pathM += Math.hypot(path[k].xM - path[k - 1].xM, path[k].yM - path[k - 1].yM);
    const lengthM = f.lengthM > 0 ? f.lengthM : pathM;
    const cap = t.capacityPerHour;
    const rackShare = racks ? sp.lifts.bikeRackCarrierShare : 0;
    lifts.push({
      id: l.id,
      name: l.name,
      index: i,
      operating: f.built && !l.closed && !l.summerOff && liftAvailable(l.id),
      bikeRacks: racks,
      pedCapacityPerHour: cap * (1 - rackShare),
      bikeCapacityPerHour: cap * rackShare * sp.lifts.bikesPerRackSeat,
      rideMin: f.rideMin > 0 ? f.rideMin : lengthM / Math.max(0.5, t.speedMs) / 60,
      lengthM,
      bottom: l.bottom,
      top: l.top,
      windLimitMs: t.windLimitMs,
    });
  });
  const built = (id: string) => !state.construction[id];
  const bikeTrails: SummerFacts['bikeTrails'] = [];
  let toboggan: SummerFacts['toboggan'] = null;
  let walkKm = 0;
  for (const tr of layout.trails ?? []) {
    const a = trails.get(tr.id);
    if (!a || !built(tr.id) || tr.closed || !a.ok) continue;
    if (tr.kind === 'walk') walkKm += a.lengthM / 1000;
    else if (tr.kind === 'bike') {
      const start = a.axis[0];
      const lift = lifts.find((l) => l.operating && l.bikeRacks && Math.hypot(l.top.xM - start.xM, l.top.yM - start.yM) <= STATION_RADIUS_M);
      if (lift) bikeTrails.push({ id: tr.id, classIndex: a.classIndex, lengthM: a.lengthM, descentMin: a.lengthM / sp.bike.speedMs[a.classIndex] / 60, liftId: lift.id });
    } else if (tr.kind === 'toboggan' && !toboggan) {
      toboggan = { id: tr.id, lengthM: a.lengthM, capacityPerHour: sp.toboggan.capacityPerHour, rideMin: (a.lengthM / sp.toboggan.speedMs + a.lengthM / sp.toboggan.returnSpeedMs) / 60 };
    }
  }
  let foodTop = 0;
  let foodBase = 0;
  let playgrounds = 0;
  let viewpoints = 0;
  let rental = false;
  const parks = facts.buildings.filter((b) => b.type.base && b.built && b.accessible);
  for (const b of facts.buildings) {
    if (!b.built) continue;
    if (b.type.id === 'gastronomy') {
      const far = parks.length > 0 && parks.every((p) => Math.hypot(p.xM - b.xM, p.yM - b.yM) >= STATION_RADIUS_M * 2);
      if (far) foodTop++;
      else foodBase++;
    } else if (b.type.id === 'rental') rental = true;
  }
  for (const b of layout.buildings ?? []) {
    if (!built(b.id)) continue;
    if (b.typeId === 'playground') playgrounds++;
    else if (b.typeId === 'viewpoint') viewpoints++;
  }
  void ep;
  return {
    lifts,
    bikeTrails,
    bikeKm: bikeTrails.reduce((a, b) => a + b.lengthM, 0) / 1000,
    toboggan,
    playgrounds,
    viewpoints,
    foodTop,
    foodBase,
    foodSeats: (foodTop + foodBase) * sp.guests.summerFoodSeatsPerBuilding,
    rental,
    parkingCars: facts.parkingCars,
    walkKm,
  };
}

// ------------------------------------------------------------------ stan lata w grze

export interface SummerPrices {
  liftUpPln: number;
  liftRoundTripPln: number;
  bikeDayPln: number;
  tobogganRidePln: number;
}

export interface SummerState {
  open: boolean;
  prices: SummerPrices;
  reputation: { sum: number; weight: number };
  /** Koszenie tras w lipcu (gracz może wyłączyć). */
  mowing: boolean;
}

export function newSummerState(sp: SummerParams): SummerState {
  return {
    open: false,
    prices: { liftUpPln: sp.prices.liftUpPln, liftRoundTripPln: sp.prices.liftRoundTripPln, bikeDayPln: sp.prices.bikeDayPln, tobogganRidePln: sp.prices.tobogganRidePln },
    reputation: { sum: 0, weight: 0 },
    mowing: true,
  };
}

export function ensureSummer(state: GameState, sp: SummerParams): SummerState {
  if (!state.summer) state.summer = newSummerState(sp);
  return state.summer;
}

export function summerReputationOf(state: GameState, sp: SummerParams): number {
  const r = sp.reputation;
  const s = state.summer?.reputation ?? { sum: 0, weight: 0 };
  return (r.initial * r.priorWeight + s.sum) / (r.priorWeight + s.weight);
}

// ------------------------------------------------------------------ popyt

export interface SummerOffer {
  lift: number;
  bike: number;
  toboggan: number;
  play: number;
  food: number;
  view: number;
}

export function summerOffer(sf: SummerFacts): SummerOffer {
  const lift = sf.lifts.some((l) => l.operating) ? 1 : 0;
  return {
    lift,
    bike: sf.bikeKm,
    toboggan: sf.toboggan ? 1 : 0,
    play: Math.min(1, sf.playgrounds),
    food: sf.foodTop > 0 ? 1 : sf.foodBase > 0 ? 0.5 : 0,
    view: Math.min(1, sf.viewpoints),
  };
}

export interface SummerPlan {
  date: CalendarDate;
  open: boolean;
  info: SummerDayInfo;
  weather: SummerWeather;
  /** Goście wg typu (turysta, rodzina, rowerzysta, szkoła). */
  byType: number[];
  guests: number;
  demand: number;
  parkingLimit: number;
  factors: { pool: number; day: number; month: number; forecast: number; noise: number };
  hours: { openH: number; closeH: number };
}

/** Prognoza dla gości latem: deszcz mocno odstrasza, burze trochę, słońce przyciąga, upał trochę zniechęca. */
export function summerForecastFactor(book: WeatherBook, date: CalendarDate, w: SummerWeather, sp: SummerParams): number {
  const d = sp.demand;
  const f = book.forecastFor(date);
  let x = 1;
  if (f) {
    x *= 1 - d.rainProbabilityPenalty * f.precipitationProbability;
    if (f.cloudFraction < 0.3 && f.precipitationProbability < 0.3) x *= d.sunnyFactor;
  }
  x *= 1 - d.stormProbabilityPenalty * w.stormProbability;
  if (w.heat) x *= d.heatFactor;
  return Math.max(0.02, x);
}

export function summerPlan(state: GameState, date: CalendarDate, sf: SummerFacts, book: WeatherBook, sp: SummerParams, ep: EconomyParams): SummerPlan {
  const d = sp.demand;
  const info = summerDayInfo(date, sp);
  const weather = summerWeather(book, date, sp, state.seed);
  const s = ensureSummer(state, sp);
  const open = s.open && !state.bankrupt && summerSeasonAllowed(date, sp);
  const fc = summerForecastFactor(book, date, weather, sp);
  const rng = new Rng(state.seed).fork('popyt-lato').fork(formatIsoDate(date));
  const noise = Math.exp(d.noiseSd * rng.normal() - (d.noiseSd * d.noiseSd) / 2);
  const month = d.monthFactors[date.month - 1];
  const pool = d.regionPoolPerDay * info.dayFactor * month * fc * noise;
  const offer = summerOffer(sf);
  const rep = summerReputationOf(state, sp);
  const priceF = (s.prices.liftRoundTripPln / Math.max(1, d.marketLiftRoundTripPln)) ** -d.priceElasticity;
  const byType = sp.types.map((t, i) => {
    if (!open) return 0;
    if (i === T_SCHOOL && !t.schoolMonths.includes(date.month)) return 0;
    const share = t.share[info.mixIndex];
    const o = t.base + t.wLift * offer.lift + t.wBike * offer.bike * (i === T_CYCLIST ? 1 : 0) + t.wToboggan * offer.toboggan + t.wPlay * offer.play + t.wFood * offer.food + t.wView * offer.view;
    if (o <= 0) return 0;
    const A = o ** d.offerExponent * (rep / d.reputationRef) ** d.reputationExponent * (offer.lift > 0 ? priceF : 1);
    return pool * share * (A / (A + t.other));
  });
  const demand = byType.reduce((a, b) => a + b, 0);
  // Parking: ilu gości zmieszczą parkingi (szkoły autokarem), rotacja w ciągu dnia ok. 1,5 ×.
  const school = byType[T_SCHOOL];
  const cars = sf.parkingCars * ep.demand.personsPerCar * 1.5;
  const limit = school + cars;
  const scale = demand > limit ? Math.max(0, (limit - school) / Math.max(1, demand - school)) : 1;
  const final = byType.map((g, i) => Math.round(i === T_SCHOOL ? g : g * scale));
  return {
    date,
    open,
    info,
    weather,
    byType: final,
    guests: final.reduce((a, b) => a + b, 0),
    demand,
    parkingLimit: limit,
    factors: { pool, day: info.dayFactor, month, forecast: fc, noise },
    hours: { openH: sp.season.openH, closeH: sp.season.closeH },
  };
}

// ------------------------------------------------------------------ wynik dnia

export interface SummerOutcome {
  source: 'agents' | 'quick';
  guests: number;
  byType: number[];
  /** Na lift w kolejności SummerFacts.lifts: wjazdy w górę i zjazdy w dół (piesi), wjazdy rowerów, godziny pracy. */
  liftUp: number[];
  liftDown: number[];
  liftBikes: number[];
  liftHours: number[];
  /** Bilety: w górę, góra-dół (osoby ważone, dzieci po cenie ulgowej osobno). */
  ticketsUp: number;
  ticketsRound: number;
  ticketsReducedShare: number;
  schoolTickets: number;
  bikePasses: number;
  bikeRentals: number;
  bikeLaps: number;
  tobogganRides: number;
  meals: number;
  playgroundVisits: number;
  cars: number;
  meanQueueMin: number;
  ratingSum: number;
  ratingCount: number;
}

/** Model zgrubny dnia letniego: przepustowość kolei, toru i restauracji, kolejki, ocena. */
export function quickSummerDay(plan: SummerPlan, sf: SummerFacts, sp: SummerParams, ep: EconomyParams): SummerOutcome {
  const L = sf.lifts.length;
  const out: SummerOutcome = {
    source: 'quick',
    guests: 0,
    byType: plan.byType.map(() => 0),
    liftUp: new Array(L).fill(0),
    liftDown: new Array(L).fill(0),
    liftBikes: new Array(L).fill(0),
    liftHours: new Array(L).fill(0),
    ticketsUp: 0,
    ticketsRound: 0,
    ticketsReducedShare: 0,
    schoolTickets: 0,
    bikePasses: 0,
    bikeRentals: 0,
    bikeLaps: 0,
    tobogganRides: 0,
    meals: 0,
    playgroundVisits: 0,
    cars: 0,
    meanQueueMin: 0,
    ratingSum: 0,
    ratingCount: 0,
  };
  if (!plan.open || plan.guests <= 0) return out;
  const w = plan.weather;
  const H = Math.max(0.5, plan.hours.closeH - plan.hours.openH);
  const stormH = stormHoursIn(w, plan.hours.openH, plan.hours.closeH);
  const Heff = Math.max(0, H - stormH);
  const types = sp.types;
  const g = plan.byType;
  out.byType = g.slice();
  out.guests = plan.guests;
  // Kolej: piesi w górę (część z biletem w obie strony), szkoły grupowo; rowerzyści – wieszaki.
  const op = sf.lifts.map((l, i) => ({ l, i })).filter((x) => x.l.operating && w.windTopMs <= x.l.windLimitMs);
  const pedCap = op.reduce((a, x) => a + x.l.pedCapacityPerHour, 0);
  const bikeCap = op.reduce((a, x) => a + x.l.bikeCapacityPerHour, 0);
  let wantUp = 0;
  let wantRound = 0;
  let school = 0;
  let children = 0;
  for (let t = 0; t < types.length; t++) {
    if (t === T_CYCLIST) continue;
    const up = pedCap > 0 ? g[t] * types[t].liftUseShare : 0;
    if (t === T_SCHOOL) school += up;
    wantUp += up;
    wantRound += up * types[t].roundTripShare;
    children += up * types[t].childShare;
  }
  // Przyjazdy rano: ok. połowa wjazdów w 3 szczytowych godzinach.
  const peakUp = (wantUp * 0.5) / 3;
  const wait = pedCap > 0 ? Math.min(90, Math.max(0, ((peakUp - pedCap) / pedCap) * 60 * 1.5)) : 0;
  const servedShare = pedCap > 0 ? sp.quickModel.liftFactor * Math.min(1, (pedCap * Heff * 0.85) / Math.max(1, wantUp)) * Math.exp(-wait / 60) : 0;
  const up = wantUp * servedShare;
  const round = wantRound * servedShare;
  out.ticketsUp = up - round;
  out.ticketsRound = round;
  out.schoolTickets = school * servedShare;
  out.ticketsReducedShare = up > 0 ? children / Math.max(1, wantUp) : 0;
  op.forEach((x) => {
    const share = pedCap > 0 ? x.l.pedCapacityPerHour / pedCap : 0;
    out.liftUp[x.i] = up * share;
    out.liftDown[x.i] = round * share;
    out.liftHours[x.i] = Heff;
  });
  // Rowerzyści: karnet dzienny, zjazdy ograniczone wieszakami.
  if (sf.bikeTrails.length && bikeCap > 0) {
    const riders = g[T_CYCLIST];
    const lapMin = sf.bikeTrails.reduce((a, b) => a + b.descentMin, 0) / sf.bikeTrails.length + op.reduce((a, x) => a + x.l.rideMin, 0) / Math.max(1, op.length) + 5;
    const wantLaps = riders * Math.min(sp.bike.lapsMax, ((types[T_CYCLIST].stayMeanH * 0.7) * 60) / lapMin);
    const laps = Math.min(wantLaps, bikeCap * Heff);
    out.bikePasses = riders * sp.quickModel.bikeFactor * (wantLaps > 0 ? Math.min(1, laps / wantLaps + 0.3) : 0);
    out.bikeLaps = laps;
    out.bikeRentals = sf.rental ? out.bikePasses * types[T_CYCLIST].rentalShare : 0;
    op.forEach((x) => {
      if (bikeCap > 0) out.liftBikes[x.i] = (laps * x.l.bikeCapacityPerHour) / bikeCap;
    });
  }
  // Tor saneczkowy.
  if (sf.toboggan && w.windTopMs < sp.toboggan.windStopMs) {
    let want = 0;
    for (let t = 0; t < types.length; t++) want += g[t] * types[t].wToboggan * types[t].tobogganRides;
    out.tobogganRides = Math.min(want * sp.quickModel.tobogganFactor, sf.toboggan.capacityPerHour * Heff);
  }
  // Gastronomia: miejsca × rotacja.
  // Gastronomia ośrodka: na górze jedzą ci, którzy wjechali koleją; na dole – rodziny i szkoły
  // (piesi turyści jedzą w schroniskach na szlaku, nie u nas). Limit: miejsca × rotacja.
  if (sf.foodSeats > 0) {
    let want = 0;
    if (sf.foodTop > 0) for (let t = 0; t < types.length; t++) if (t !== T_CYCLIST) want += g[t] * types[t].liftUseShare * servedShare * types[t].foodShare;
    if (sf.foodBase > 0) want += (g[T_FAMILY] * types[T_FAMILY].foodShare + g[T_SCHOOL] * types[T_SCHOOL].foodShare + g[T_CYCLIST] * types[T_CYCLIST].foodShare) * 0.5;
    out.meals = Math.min(want * sp.quickModel.mealFactor, sf.foodSeats * H * (60 / sp.guests.mealMin) * 0.6);
  }
  if (sf.playgrounds > 0) out.playgroundVisits = Math.min(g[T_FAMILY] * types[T_FAMILY].childShare, sf.playgrounds * 60 * H);
  const school2 = g[T_SCHOOL];
  out.cars = (plan.guests - school2) / ep.demand.personsPerCar;
  out.meanQueueMin = wait;
  // Ocena: kolejki, pogoda, cel wycieczki, jedzenie.
  const rw = sp.guests.ratingWeights;
  const qScore = 1 / (1 + wait / sp.guests.ratingQueueRefMin);
  const rainy = w.precipMm > 2;
  const wScore = (w.storm ? 0.45 : 1) * (rainy ? 0.5 : 1) * (w.heat ? 0.8 : 1);
  const goal = Math.min(1, 0.5 + 0.5 * (pedCap > 0 ? servedShare : 0.6) + (sf.toboggan ? 0.05 : 0) + (sf.viewpoints ? 0.05 : 0));
  const foodScore = sf.foodSeats > 0 ? 0.9 : 0.6;
  const s = (rw[0] * qScore + rw[1] * wScore + rw[2] * goal + rw[3] * foodScore) / (rw[0] + rw[1] + rw[2] + rw[3]);
  out.ratingSum = (1 + 4 * s) * plan.guests;
  out.ratingCount = plan.guests;
  return out;
}

// ------------------------------------------------------------------ przepływy pieniędzy dnia

/**
 * Przychody i koszty dnia letniego (bez kosztów stałych – te liczy closeDay): bilety kolei, karnety
 * rowerowe, wypożyczenia, tor, gastronomia, parking; energia i obsługa kolei, toru, budynków.
 */
export function summerDayFlows(o: SummerOutcome, plan: SummerPlan, sf: SummerFacts, facts: ResortFacts, state: GameState, sp: SummerParams, ep: EconomyParams): Partial<Flows> {
  const f: Partial<Flows> = {};
  const add = (k: keyof Flows, v: number) => (f[k] = (f[k] ?? 0) + v);
  if (!plan.open) return f;
  const s = ensureSummer(state, sp);
  const c = ep.costs;
  const wage = c.hourlyWagePln * c.employerCostFactor;
  const H = Math.max(0, plan.hours.closeH - plan.hours.openH);
  const staffH = H + c.staffExtraHours;
  const red = sp.prices.reducedFactor;
  const priceMix = (full: number) => full * (1 - o.ticketsReducedShare) + full * red * o.ticketsReducedShare;
  const schoolF = sp.prices.schoolGroupFactor;
  const nonSchoolUp = Math.max(0, o.ticketsUp + o.ticketsRound - o.schoolTickets);
  const roundShare = o.ticketsUp + o.ticketsRound > 0 ? o.ticketsRound / (o.ticketsUp + o.ticketsRound) : 0;
  add('liftTickets', nonSchoolUp * (roundShare * priceMix(s.prices.liftRoundTripPln) + (1 - roundShare) * priceMix(s.prices.liftUpPln)));
  add('liftTickets', o.schoolTickets * s.prices.liftRoundTripPln * schoolF);
  add('bikePasses', o.bikePasses * s.prices.bikeDayPln);
  add('rental', o.bikeRentals * sp.prices.bikeRentalDayPln);
  add('toboggan', o.tobogganRides * s.prices.tobogganRidePln);
  // Kolej latem: energia (bieg jałowy + część mocy) i obsługa.
  sf.lifts.forEach((l, i) => {
    const hours = o.liftHours[i] ?? 0;
    if (!l.operating || hours <= 0) return;
    const lf = facts.lifts[l.index];
    const cap = l.pedCapacityPerHour + l.bikeCapacityPerHour;
    const u = Math.min(1, ((o.liftUp[i] ?? 0) + (o.liftBikes[i] ?? 0)) / Math.max(1, cap * hours));
    add('energy', hours * (lf.idleKw + (lf.powerKw - lf.idleKw) * u) * c.energyPlnPerKWh);
    add('liftStaff', (c.staffAerialLift + lf.midStations * c.staffMidStation) * staffH * wage);
  });
  if (sf.toboggan && o.tobogganRides > 0) {
    add('energy', o.tobogganRides * sp.toboggan.energyKWhPerRide * c.energyPlnPerKWh);
    add('seasonal', sp.toboggan.staffPerDay * staffH * wage);
  }
  // Kasy i personel sezonowy.
  if (o.guests > 0) {
    add('cashiers', Math.max(1, Math.ceil(o.guests / c.guestsPerCashier)) * staffH * wage);
    add('seasonal', Math.max(c.seasonalMin, Math.ceil((o.guests / 1000) * c.seasonalPer1000Guests)) * staffH * wage);
  }
  // Gastronomia, wypożyczalnia, parking.
  const food = facts.buildings.find((b) => b.built && b.type.id === 'gastronomy')?.type;
  if (food && o.meals > 0) {
    const rev = o.meals * sp.guests.mealSpendPln;
    add('gastronomy', rev);
    add('goods', rev * food.costShare);
  }
  for (const b of facts.buildings) {
    if (!b.built) continue;
    if (b.type.id === 'gastronomy' || (b.type.id === 'rental' && o.bikeRentals > 0)) add('buildingsStaff', b.type.staffPerDay * staffH * wage);
  }
  const rent = facts.buildings.find((b) => b.built && b.type.id === 'rental')?.type;
  if (rent && o.bikeRentals > 0) add('goods', o.bikeRentals * sp.prices.bikeRentalDayPln * rent.costShare);
  let cars = o.cars;
  for (const b of facts.buildings) {
    if (!b.built || !b.type.base || !b.accessible) continue;
    const here = Math.min(cars, b.type.cars);
    cars -= here;
    add('parking', here * b.type.feePerCarPln);
    add('buildingsStaff', b.type.staffPerDay * staffH * wage);
  }
  return f;
}

/** Utrzymanie tras letnich, toru, placów zabaw i punktów widokowych (część roczna na dzień) i koszenie w lipcu. */
export function summerFixedFlows(layout: ResortLayout, trails: Map<string, TrailAnalysis>, pisteAreaM2: number, state: GameState, date: CalendarDate, sp: SummerParams): Partial<Flows> {
  const f: Partial<Flows> = {};
  let upkeep = 0;
  for (const t of layout.trails ?? []) {
    if (state.construction[t.id]) continue;
    upkeep += trails.get(t.id)?.maintenancePlnPerYear ?? 0;
  }
  for (const b of layout.buildings ?? []) {
    if (state.construction[b.id]) continue;
    const st = sp.buildings.find((x) => x.id === b.typeId);
    if (st) upkeep += st.costPln * st.maintenanceRatePerYear;
  }
  if (upkeep > 0) f.trails = upkeep / 365;
  const mow = state.summer?.mowing ?? true;
  if (mow && date.month === sp.mowing.month && date.day === 1 && pisteAreaM2 > 0) f.mowing = (pisteAreaM2 / 10000) * sp.mowing.plnPerHa;
  return f;
}

/** Tor saneczkowy zimą: część gości zimowych korzysta z toru (rodziny, dzieci). */
export function tobogganWinterFlows(guests: number, familyShare: number, sf: SummerFacts, state: GameState, sp: SummerParams, ep: EconomyParams, hours: number): Partial<Flows> {
  if (!sf.toboggan || guests <= 0) return {};
  const fam = sp.types[T_FAMILY];
  const rides = Math.min(sf.toboggan.capacityPerHour * hours, guests * familyShare * fam.wToboggan * fam.tobogganRides * 0.5);
  const price = state.summer?.prices.tobogganRidePln ?? sp.prices.tobogganRidePln;
  const c = ep.costs;
  return {
    toboggan: rides * price,
    energy: rides * sp.toboggan.energyKWhPerRide * c.energyPlnPerKWh,
    seasonal: sp.toboggan.staffPerDay * (hours + c.staffExtraHours) * c.hourlyWagePln * c.employerCostFactor,
  };
}

/** Atrakcja odblokowana w karierze (reputacja – lepsza z zimowej i letniej – i saldo). */
export function attractionUnlocked(kind: keyof SummerParams['unlocks'], state: GameState, winterReputation: number, sp: SummerParams): { ok: boolean; why: string } {
  if (state.mode !== 'career') return { ok: true, why: '' };
  const u = sp.unlocks[kind];
  const rep = Math.max(winterReputation, summerReputationOf(state, sp));
  if (rep < u.reputation) return { ok: false, why: `potrzebna reputacja ${u.reputation.toLocaleString('pl-PL')} (jest ${rep.toLocaleString('pl-PL', { maximumFractionDigits: 2 })})` };
  if (state.balancePln < u.capitalPln) return { ok: false, why: `potrzebne saldo co najmniej ${Math.round(u.capitalPln / 1000)} tys. zł` };
  return { ok: true, why: '' };
}

// ------------------------------------------------------------------ dzień w grze: lato, tor zimą, koszty stałe lata

export interface SeasonExtrasInput {
  state: GameState;
  layout: ResortLayout;
  trails: Map<string, TrailAnalysis>;
  facts: ResortFacts;
  lp: LiftParams;
  ep: EconomyParams;
  book: WeatherBook;
  date: CalendarDate;
  /** Zima: goście dnia i godziny pracy (tor saneczkowy zimą). */
  winterGuests: number;
  winterHours: number;
  /** Wynik dnia letniego z symulacji gości (null – model zgrubny). */
  agents?: ((plan: SummerPlan, sf: SummerFacts) => SummerOutcome) | null;
}

export interface SeasonExtras {
  flows: Partial<Flows>;
  summer: { plan: SummerPlan; outcome: SummerOutcome } | null;
  sf: SummerFacts;
  objectRevenue: Record<string, number>;
}

/** Wszystko, co lato dokłada do dnia: dzień letni (gdy sezon otwarty), tor zimą, utrzymanie tras, koszenie. */
export function seasonExtras(i: SeasonExtrasInput): SeasonExtras {
  const sp = i.ep.summer!;
  const { inspectionStatus } = inspectionsApi;
  const sf = summerFacts(i.layout, i.trails, i.facts, i.state, i.lp, sp, i.ep, (id) => inspectionStatus(i.state, id, i.date) === 'ok');
  const flows: Partial<Flows> = {};
  const add = (p: Partial<Flows>) => {
    for (const [k, v] of Object.entries(p)) flows[k as keyof Flows] = (flows[k as keyof Flows] ?? 0) + (v ?? 0);
  };
  const objectRevenue: Record<string, number> = {};
  let summer: SeasonExtras['summer'] = null;
  if (i.state.summer?.open && summerSeasonAllowed(i.date, sp)) {
    const plan = summerPlan(i.state, i.date, sf, i.book, sp, i.ep);
    const outcome = plan.open && plan.guests > 0 && i.agents ? i.agents(plan, sf) : quickSummerDay(plan, sf, sp, i.ep);
    const f = summerDayFlows(outcome, plan, sf, i.facts, i.state, sp, i.ep);
    add(f);
    summer = { plan, outcome };
    const prices = ensureSummer(i.state, sp).prices;
    sf.lifts.forEach((l, k) => {
      const v = (outcome.liftUp[k] ?? 0) * prices.liftUpPln + (outcome.liftDown[k] ?? 0) * (prices.liftRoundTripPln - prices.liftUpPln);
      if (v > 0) objectRevenue[l.id] = v;
    });
    if (sf.toboggan) objectRevenue[sf.toboggan.id] = outcome.tobogganRides * prices.tobogganRidePln;
    for (const bt of sf.bikeTrails) objectRevenue[bt.id] = ((f.bikePasses ?? 0) * bt.lengthM) / Math.max(1, sf.bikeKm * 1000);
    const food = i.facts.buildings.filter((b) => b.built && b.type.id === 'gastronomy');
    for (const b of food) objectRevenue[b.id] = (f.gastronomy ?? 0) / food.length;
    const parks = i.facts.buildings.filter((b) => b.built && b.type.base && b.accessible);
    let cars = outcome.cars;
    for (const b of parks) {
      const here = Math.min(cars, b.type.cars);
      cars -= here;
      objectRevenue[b.id] = here * b.type.feePerCarPln;
    }
  } else if (i.winterGuests > 0 && sf.toboggan) {
    const fam = i.ep.mix.weekend[2] / Math.max(1e-9, i.ep.mix.weekend.reduce((a, b) => a + b, 0));
    const f = tobogganWinterFlows(i.winterGuests, fam, sf, i.state, sp, i.ep, i.winterHours);
    add(f);
    objectRevenue[sf.toboggan.id] = f.toboggan ?? 0;
  }
  const pisteArea = i.facts.pistes.filter((p) => p.built).reduce((a, p) => a + p.areaM2, 0);
  add(summerFixedFlows(i.layout, i.trails, pisteArea, i.state, i.date, sp));
  return { flows, summer, sf, objectRevenue };
}
