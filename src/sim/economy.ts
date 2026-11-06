/**
 * Ekonomia i sezon (etap 6): stan gry (saldo, kredyty, ceny, godziny, budowy w toku, reputacja,
 * rok gry z dniami i przepływami), popyt dnia, sprzedaż karnetów, koszty dnia, model zgrubny dnia
 * (dni przewijane bez symulacji gości), zamknięcie dnia, raport sezonu.
 *
 * Bez DOM i grafiki – ten sam kod w przeglądarce i w trybie bez grafiki (src/sim/headlessGame.ts).
 * Ratrakowanie jest TYMCZASOWE (do etapu 7): automatycznie co noc na otwartych trasach, koszt za hektar.
 */
import type { DayInfo } from './calendar';
import { dayInfo, seasonStartYear, yearPhase } from './calendar';
import type { CompetitorDay } from './competition';
import type { BuildingType, EconomyParams, OpeningHours, PassPrices } from './economyParams';
import { buildingTypeById } from './economyParams';
import { GROUND_FOREST } from './ground';
import type { GuestNet } from './guestNetwork';
import type { GuestParams } from './guestParams';
import type { GuestEconomySummary } from './guests';
import { satisfactionScore, weatherScoreFor } from './guests';
import type { LiftParams } from './lifts';
import { liftTypeById } from './lifts';
import type { ResortAnalysis, ResortLayout } from './resort';
import { Rng } from './rng';
import type { RidingParams } from './snowRiding';
import { minBaseCm, packedBaseCm, thinSeverity } from './snowRiding';
import { addDays, formatIsoDate, parseIsoDate } from './time';
import { pipelineCost } from './snowmaking';
import type { CalendarDate } from './weather';
import type { DayWeather, WeatherBook } from './weatherBook';

// ------------------------------------------------------------------ stan gry

export type GameMode = 'career' | 'sandbox';

export const REVENUE_KEYS = ['passes', 'parking', 'gastronomy', 'rental', 'school', 'shuttle'] as const;
export const COST_KEYS = [
  'energy', 'liftStaff', 'cashiers', 'patrol', 'seasonal', 'buildingsStaff', 'goods',
  'snowEnergy', 'water', 'groomFuel', 'groomStaff', 'groomService', 'leasing', 'repairs',
  'permanent', 'admin', 'roads', 'insurance', 'maintenance', 'inspections', 'interest',
] as const;
/** Inwestycje i finansowanie (nie są kosztem dnia, ale zmieniają saldo). */
export const CAPITAL_KEYS = ['construction', 'equipment', 'refunds', 'loanIn', 'loanPrincipal'] as const;
export type RevenueKey = (typeof REVENUE_KEYS)[number];
export type CostKey = (typeof COST_KEYS)[number];
export type CapitalKey = (typeof CAPITAL_KEYS)[number];
export type Flows = Record<RevenueKey | CostKey | CapitalKey, number>;

export const FLOW_NAMES: Record<keyof Flows, string> = {
  passes: 'karnety',
  parking: 'parking',
  gastronomy: 'gastronomia',
  rental: 'wypożyczalnia',
  school: 'szkółka',
  energy: 'energia wyciągów',
  liftStaff: 'obsługa wyciągów',
  cashiers: 'kasy',
  patrol: 'ratownicy',
  seasonal: 'personel sezonowy',
  buildingsStaff: 'personel budynków',
  goods: 'towar i serwis (budynki)',
  snowEnergy: 'energia naśnieżania (pompy, armatki)',
  water: 'opłata za pobór wody',
  groomFuel: 'paliwo ratraków',
  groomStaff: 'operatorzy ratraków (noc)',
  groomService: 'serwis ratraków',
  leasing: 'leasing ratraków',
  repairs: 'naprawy ratraków',
  permanent: 'stała załoga',
  admin: 'administracja, marketing, sprzedaż',
  roads: 'odśnieżanie dróg dojazdowych',
  shuttle: 'transport do schroniska',
  insurance: 'ubezpieczenie',
  maintenance: 'utrzymanie',
  inspections: 'przeglądy wyciągów',
  interest: 'odsetki',
  construction: 'budowa',
  equipment: 'zakup ratraków',
  refunds: 'zwroty za anulowane budowy',
  loanIn: 'kredyt (wypłata)',
  loanPrincipal: 'spłata kapitału kredytu',
};

export function zeroFlows(): Flows {
  const f = {} as Flows;
  for (const k of [...REVENUE_KEYS, ...COST_KEYS, ...CAPITAL_KEYS]) f[k] = 0;
  return f;
}

export const sumRevenue = (f: Flows) => REVENUE_KEYS.reduce((a, k) => a + f[k], 0);
export const sumCosts = (f: Flows) => COST_KEYS.reduce((a, k) => a + f[k], 0);
/** Zmiana salda z przepływów: przychody − koszty − budowa + zwroty + kredyt − spłata kapitału. */
export const balanceChange = (f: Flows) => sumRevenue(f) - sumCosts(f) - f.construction - f.equipment + f.refunds + f.loanIn - f.loanPrincipal;

function addFlows(a: Flows, b: Flows): void {
  for (const k of Object.keys(a) as (keyof Flows)[]) a[k] += b[k];
}

export interface Loan {
  id: number;
  principalPln: number;
  remainingPln: number;
  ratePerYear: number;
  monthlyPaymentPln: number;
  monthsLeft: number;
  takenOn: string;
}

export interface Construction {
  leftDays: number;
  totalDays: number;
  orderedOn: string;
  /** Wykop tylko latem (rurociąg, zbiornik) – zimą budowa stoi. */
  summerOnly?: boolean;
}

/** Ratrak we flocie (etap 7). */
export interface Groomer {
  id: string;
  typeId: string;
  leased: boolean;
  boughtOn: string;
  /** Wiek przy zakupie [lata] (używany sprzęt – później). */
  ageAtPurchase: number;
  /** Ile jeszcze nocy w naprawie. */
  brokenNights: number;
}

/** Stan naśnieżania i ratraków w grze (etap 7). */
export interface OpsState {
  reservoirM3: number;
  /** Plan naśnieżania tras: docelowa baza [cm], priorytet (1 najważniejszy), włączone. */
  snowPlan: Record<string, { targetCm: number; priority: number; enabled: boolean }>;
  /** Ręczne sterowanie armatek (brak – automat). */
  gunModes: Record<string, 'auto' | 'on' | 'off'>;
  groomers: Groomer[];
  nextGroomerId: number;
  /** Plan nocy: priorytet, włączone, ratrak (null – automat). */
  groomPlan: Record<string, { priority: number; enabled: boolean; groomerId: string | null }>;
  /** Trasy ratrakowane dziś w dzień (zamknięte dla gości). */
  dayGroom: string[];
  /** Ostatnia doba naśnieżania i noc ratraków – do paneli i mapy. */
  last: OpsSummary | null;
}

export interface OpsSummary {
  date: string;
  hourly: { hour: number; powerKw: number; gunKw: number; pumpKw: number; otherKw: number; waterM3: number; running: number; reservoirM3: number }[];
  gridLimitKw: number;
  reservoirCapacityM3: number;
  inflowM3: number;
  snowM3: number;
  waterM3: number;
  energyKWh: number;
  offPisteShare: number;
  /** Armatki pracujące w każdej godzinie: id → [godzina, wydajność m³/h, wiatr skąd °, m/s]. */
  gunHours: Record<string, [number, number, number, number][]>;
  jobs: { groomerId: string; pisteId: string; startH: number; endH: number; complete: boolean; steepDone: boolean; mode: number }[];
  unfinished: string[];
  steepSkipped: string[];
  finishH: number;
  fuelL: number;
  broken: string[];
}

export interface DayRecord {
  date: string;
  /** Sezon otwarty (gracz) i co najmniej jeden wyciąg pracował. */
  open: boolean;
  guests: number;
  demand: number;
  rating: number | null;
  revenuePln: number;
  costPln: number;
  capitalPln: number;
  balancePln: number;
  /** a – symulacja gości, q – model zgrubny, - – zamknięte. */
  src: 'a' | 'q' | '-';
  snowScore: number;
  kmOpen: number;
  compGuests: number[];
  compOpen: boolean[];
  label: string;
  /** Etap 7: śnieg z armatek [m³], woda [m³], energia naśnieżania [kWh], paliwo ratraków [l], trasy ratrakowane / niedokończone, dzień otwarty dzięki naśnieżaniu. */
  snowM3?: number;
  waterM3?: number;
  snowKWh?: number;
  fuelL?: number;
  groomed?: number;
  unfinished?: number;
  techOpen?: boolean;
}

export interface SeasonReport {
  startYear: number;
  from: string;
  to: string;
  flows: Flows;
  days: DayRecord[];
  openDays: number;
  guests: number;
  meanRating: number | null;
  reputationEnd: number;
  balanceStart: number;
  balanceEnd: number;
  debtEnd: number;
  competitors: { name: string; openDays: number; guests: number; dayPln: number }[];
  /** Etap 6b: zima na tle wielolecia (śnieg naturalny w punkcie odniesienia) – uzupełnia widok/raport. */
  winter?: { days: number; meanDays: number; cls: number; percentile: number; elevationM: number; thresholdCm: number } | null;
}

export interface GameState {
  version: 1;
  mode: GameMode;
  seed: number;
  /** Bieżący (jeszcze niezamknięty) dzień i godzina. */
  date: CalendarDate;
  hour: number;
  balancePln: number;
  loans: Loan[];
  nextLoanId: number;
  prices: PassPrices;
  hours: OpeningHours;
  seasonOpen: boolean;
  /** Reputacja: suma ważonych ocen i suma wag (bez oceny początkowej). */
  reputation: { sum: number; weight: number };
  construction: Record<string, Construction>;
  /** Naśnieżanie i ratraki (etap 7; w starszych zapisach brak – uzupełnia ensureOps). */
  ops?: OpsState;
  /** Zapłacony koszt i „podpis” geometrii obiektu (wykrywanie przebudowy). */
  paid: Record<string, { costPln: number; signature: string }>;
  negativeDays: number;
  bankrupt: boolean;
  /** Przepływy od początku dnia (budowa, kredyt) – dopisywane do rekordu dnia przy zamknięciu. */
  pending: Flows;
  /** Rok gry (od 1 maja): dni i przepływy. */
  year: { startYear: number; balanceStart: number; flows: Flows; days: DayRecord[] };
  history: SeasonReport[];
  /** Ostatnie komunikaty (budowy ukończone, przeglądy, raty…). */
  log: { date: string; text: string }[];
  lastDay: (DayRecord & { flows: Flows }) | null;
}

export function newGameState(o: { mode: GameMode; seed: number; date: CalendarDate; ep: EconomyParams }): GameState {
  const ep = o.ep;
  const startYear = o.date.month >= ep.calendar.summerStartMonth ? o.date.year : o.date.year - 1;
  const balance = o.mode === 'career' ? ep.career.startCapitalPln : 0;
  return {
    version: 1,
    mode: o.mode,
    seed: o.seed,
    date: { ...o.date },
    hour: 8,
    balancePln: balance,
    loans: [],
    nextLoanId: 1,
    prices: { dayPln: ep.passes.dayPln, fourHourPln: ep.passes.fourHourPln, twoHourPln: ep.passes.twoHourPln, pointPln: ep.passes.pointPln },
    hours: { openH: ep.hours.openH, closeH: ep.hours.closeH },
    seasonOpen: false,
    reputation: { sum: 0, weight: 0 },
    construction: {},
    paid: {},
    negativeDays: 0,
    bankrupt: false,
    pending: zeroFlows(),
    year: { startYear, balanceStart: balance, flows: zeroFlows(), days: [] },
    history: [],
    log: [],
    lastDay: null,
    ops: { reservoirM3: 0, snowPlan: {}, gunModes: {}, groomers: [], nextGroomerId: 1, groomPlan: {}, dayGroom: [], last: null },
  };
}

export function reputationOf(state: GameState, ep: EconomyParams): number {
  const r = ep.reputation;
  return (r.initial * r.priorWeight + state.reputation.sum) / (r.priorWeight + state.reputation.weight);
}

export function debtOf(state: GameState): number {
  return state.loans.reduce((a, l) => a + l.remainingPln, 0);
}

function log(state: GameState, text: string): void {
  state.log.push({ date: formatIsoDate(state.date), text });
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

// ------------------------------------------------------------------ obiekty: koszt, budowa

export interface ObjectCost {
  id: string;
  kind: 'lift' | 'piste' | 'building' | 'pipeline' | 'gun' | 'road';
  summerOnly?: boolean;
  name: string;
  costPln: number;
  buildDays: number;
  signature: string;
}

/** Koszt i czas budowy każdego obiektu układu (wyciągi i trasy z analizy, budynki z danych). */
export function objectCosts(layout: ResortLayout, analysis: ResortAnalysis, ep: EconomyParams): ObjectCost[] {
  const out: ObjectCost[] = [];
  const sig = (o: object) => {
    const { closed: _c, name: _n, ...rest } = o as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  for (const l of layout.lifts) {
    const a = analysis.lifts.get(l.id);
    if (a) out.push({ id: l.id, kind: 'lift', name: l.name, costPln: a.cost.totalPln, buildDays: Math.max(1, Math.round(a.buildDays)), signature: sig({ ...l, towers: undefined, manualTowers: undefined }) });
  }
  for (const p of layout.pistes) {
    const a = analysis.pistes.get(p.id);
    if (a) out.push({ id: p.id, kind: 'piste', name: p.name, costPln: a.cost.totalPln, buildDays: Math.max(1, Math.round(a.buildDays)), signature: sig(p) });
  }
  for (const b of [...layout.bases, ...(layout.buildings ?? [])]) {
    const t = buildingTypeById(ep, b.typeId);
    const infra = ep.snowmaking?.buildings.find((x) => x.id === b.typeId) ?? null;
    out.push({ id: b.id, kind: 'building', name: b.name, costPln: t?.costPln ?? infra?.costPln ?? 0, buildDays: Math.max(1, Math.round(t?.buildDays ?? infra?.buildDays ?? 1)), signature: sig(b), ...(infra?.summerOnly ? { summerOnly: true } : {}) });
  }
  for (const r of layout.roads ?? []) {
    const a = analysis.roads?.get(r.id);
    if (a) out.push({ id: r.id, kind: 'road', name: r.name, costPln: a.costPln, buildDays: a.buildDays, signature: sig(r) });
  }
  const sp = ep.snowmaking;
  if (sp) {
    for (const pipe of layout.pipelines ?? []) {
      const c = pipelineCost(pipe, sp);
      out.push({ id: pipe.id, kind: 'pipeline', name: pipe.name, costPln: c.costPln, buildDays: c.buildDays, signature: sig(pipe), summerOnly: true });
    }
    for (const g of layout.snowGuns ?? []) {
      const t = sp.guns.find((x) => x.id === g.typeId);
      out.push({ id: g.id, kind: 'gun', name: t?.name ?? g.typeId, costPln: t?.costPln ?? 0, buildDays: 1, signature: sig({ typeId: g.typeId }) });
    }
  }
  return out;
}

/** Stan naśnieżania (domyślny dla nowej gry i starszych zapisów). */
export function ensureOps(state: GameState): OpsState {
  if (!state.ops) state.ops = { reservoirM3: 0, snowPlan: {}, gunModes: {}, groomers: [], nextGroomerId: 1, groomPlan: {}, dayGroom: [], last: null };
  return state.ops;
}

const WINTER_MONTHS = (d: CalendarDate, ep: EconomyParams) => yearPhase(d, ep) === 'winter';

/** Ile kosztowałaby zmiana układu (dodatnie – wydatek, ujemne – zwrot). */
export function constructionChargePreview(state: GameState, objects: ObjectCost[], ep: EconomyParams): number {
  return reconcileInternal(state, objects, ep, true).netPln;
}

/**
 * Uzgodnienie budów ze zmienionym układem: nowe obiekty – zapłata i budowa; przebudowa – dopłata
 * różnicy + opłata, krótsza budowa; usunięte w budowie – częściowy zwrot. W piaskownicy wszystko
 * od razu gotowe i bez opłat.
 */
export function reconcileConstruction(state: GameState, objects: ObjectCost[], ep: EconomyParams): { netPln: number; messages: string[] } {
  return reconcileInternal(state, objects, ep, false);
}

function reconcileInternal(state: GameState, objects: ObjectCost[], ep: EconomyParams, dry: boolean): { netPln: number; messages: string[] } {
  const c = ep.costs;
  const today = formatIsoDate(state.date);
  const sandbox = state.mode === 'sandbox';
  const winter = WINTER_MONTHS(state.date, ep);
  const costFactor = winter ? c.winterBuildCostFactor : 1;
  let charge = 0;
  let refund = 0;
  const messages: string[] = [];
  const present = new Set(objects.map((o) => o.id));
  for (const o of objects) {
    const prev = state.paid[o.id];
    if (!prev) {
      const cost = sandbox ? 0 : o.costPln * costFactor;
      charge += cost;
      if (!dry) {
        state.paid[o.id] = { costPln: o.costPln, signature: o.signature };
        if (!sandbox) state.construction[o.id] = { leftDays: o.buildDays, totalDays: o.buildDays, orderedOn: today, ...(o.summerOnly ? { summerOnly: true } : {}) };
        if (!sandbox) messages.push(`Zamówiono budowę: ${o.name} (${fmtPln(cost)}, ok. ${o.buildDays} dni${winter ? ', zimą drożej i wolniej' : ''})`);
      }
    } else if (prev.signature !== o.signature) {
      const building = state.construction[o.id];
      const fee = building ? 0 : o.costPln * c.rebuildFeeShare;
      const cost = sandbox ? 0 : Math.max(0, o.costPln - prev.costPln) * costFactor + fee;
      charge += cost;
      if (!dry) {
        state.paid[o.id] = { costPln: Math.max(prev.costPln, o.costPln), signature: o.signature };
        if (!sandbox && !building) {
          const days = Math.max(1, Math.round(o.buildDays * c.rebuildDaysShare));
          state.construction[o.id] = { leftDays: days, totalDays: days, orderedOn: today, ...(o.summerOnly ? { summerOnly: true } : {}) };
          messages.push(`Przebudowa: ${o.name} (${fmtPln(cost)}, ok. ${days} dni)`);
        }
      }
    }
  }
  for (const id of Object.keys(state.paid)) {
    if (present.has(id)) continue;
    const b = state.construction[id];
    if (b && !sandbox) refund += state.paid[id].costPln * (b.orderedOn === today ? 1 : c.cancelRefundShare);
    if (!dry) {
      delete state.paid[id];
      delete state.construction[id];
    }
  }
  if (!dry) {
    state.balancePln += refund - charge;
    state.pending.construction += charge;
    state.pending.refunds += refund;
    for (const m of messages) log(state, m);
  }
  return { netPln: charge - refund, messages };
}

/** Uznanie całego układu za zbudowany i zapłacony (piaskownica, wczytanie prawdziwego ośrodka w piaskownicy). */
export function markAllBuilt(state: GameState, objects: ObjectCost[]): void {
  for (const o of objects) state.paid[o.id] = { costPln: o.costPln, signature: o.signature };
  state.construction = {};
}

/** Układ bez obiektów w budowie (do gości i sieci). */
export function operationalLayout(layout: ResortLayout, state: GameState, blocked: Set<string> | null = null): ResortLayout {
  const ok = (id: string) => !state.construction[id];
  return {
    ...layout,
    lifts: layout.lifts.filter((l) => ok(l.id)),
    // Trasy z pryzmami albo ratrakowane w dzień – zamknięte dla gości.
    pistes: layout.pistes.filter((p) => ok(p.id)).map((p) => (blocked?.has(p.id) ? { ...p, closed: true } : p)),
    bases: layout.bases.filter((b) => ok(b.id)),
    buildings: (layout.buildings ?? []).filter((b) => ok(b.id)),
    pipelines: (layout.pipelines ?? []).filter((p) => ok(p.id)),
    snowGuns: (layout.snowGuns ?? []).filter((g) => ok(g.id) && ok(g.pipelineId)),
  };
}

// ------------------------------------------------------------------ fakty o ośrodku

export interface LiftFact {
  id: string;
  name: string;
  aerial: boolean;
  gondola: boolean;
  capacityPerHour: number;
  powerKw: number;
  idleKw: number;
  midStations: number;
  /** Czas wjazdu [min] i długość liny [m] (z sieci gości; 0 – w budowie). */
  rideMin: number;
  lengthM: number;
  built: boolean;
  /** Zbudowany, nie zamknięty i ma otwartą trasę w dół (pracuje, gdy sezon otwarty). */
  operating: boolean;
}

export interface PisteFact {
  id: string;
  name: string;
  /** Klasa trudności (0 – zielona … 3 – czarna). */
  classIndex: number;
  lengthM: number;
  areaM2: number;
  built: boolean;
  open: boolean;
}

export interface BuildingFact {
  id: string;
  type: BuildingType;
  built: boolean;
  /** Etap 6b: parking z dojazdem (drogą publiczną albo zbudowaną). */
  accessible: boolean;
  xM: number;
  yM: number;
}

export interface ResortFacts {
  lifts: LiftFact[];
  pistes: PisteFact[];
  buildings: BuildingFact[];
  assetValuePln: number;
  assetLiftsPln: number;
  assetPistesPln: number;
  assetBuildingsPln: number;
  kmOpen: number;
  capacityPerHour: number;
  parkingCars: number;
  pointsPerRide: number;
  /** Etap 6b: długość zbudowanych dróg [km] i czy jest gastronomia z dala od parkingu (schronisko). */
  roadKm: number;
}

/** Etap 6b: pojemność parkingów [osób na dzień] – bazy z typem parkingu (auta × osoby na auto). */
export function parkingCapacityPersons(layout: ResortLayout, ep: EconomyParams): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of layout.bases) {
    const t = buildingTypeById(ep, b.typeId);
    if (t?.base && t.cars > 0) m.set(b.id, t.cars * ep.demand.personsPerCar);
  }
  return m;
}

/** Fakty dla ekonomii z układu, jego analizy, sieci gości (układ bez budów) i stanu budów. */
export function resortFacts(layout: ResortLayout, analysis: ResortAnalysis, net: GuestNet | null, state: GameState, lp: LiftParams, ep: EconomyParams, blocked: Set<string> | null = null): ResortFacts {
  const lifts: LiftFact[] = layout.lifts.map((l) => {
    const t = liftTypeById(lp, l.typeId);
    const a = analysis.lifts.get(l.id);
    const built = !state.construction[l.id];
    const ni = net ? net.lifts.findIndex((x) => x.id === l.id) : -1;
    let descent = false;
    if (net && ni >= 0) {
      const nl = net.lifts[ni];
      descent = nl.downhillRiding || nl.stops.slice(1).some((st) => net.hubs[net.nodes[st.node].hub].outEdges.some((e) => !net.pistes[net.edges[e].piste].closed));
    }
    const lengthM = net && ni >= 0 ? net.lifts[ni].lengthM : 0;
    const idleKw = t.baseLoadKw + (t.frictionKwPer100m * lengthM) / 100;
    return {
      id: l.id,
      name: l.name,
      aerial: t.kind === 'aerial',
      gondola: t.downhillRiding,
      capacityPerHour: t.capacityPerHour,
      powerKw: a?.powerKw ?? idleKw,
      idleKw,
      midStations: (l.bends ?? []).filter((b) => b.mid).length,
      rideMin: net && ni >= 0 ? net.lifts[ni].rideS / 60 : 0,
      lengthM,
      built,
      operating: built && !l.closed && descent && (a?.ok ?? false) && !(net && ni >= 0 && net.lifts[ni].unreachable),
    };
  });
  const anyLift = lifts.some((l) => l.operating);
  const pistes: PisteFact[] = layout.pistes.map((p) => {
    const a = analysis.pistes.get(p.id);
    const built = !state.construction[p.id];
    return { id: p.id, name: p.name, classIndex: a?.classIndex ?? 0, lengthM: a?.lengthM ?? 0, areaM2: a?.areaM2 ?? 0, built, open: built && !p.closed && anyLift && !blocked?.has(p.id) };
  });
  const buildings: BuildingFact[] = [];
  for (const b of [...layout.bases, ...(layout.buildings ?? [])]) {
    const t = buildingTypeById(ep, b.typeId);
    if (t) buildings.push({ id: b.id, type: t, built: !state.construction[b.id], accessible: !t.base || !analysis.accessibleBases || analysis.accessibleBases.has(b.id), xM: b.xM, yM: b.yM });
  }
  const paidOf = (id: string) => (state.construction[id] ? 0 : (state.paid[id]?.costPln ?? 0));
  const assetLiftsPln = layout.lifts.reduce((a, l) => a + paidOf(l.id), 0);
  const assetPistesPln = layout.pistes.reduce((a, p) => a + paidOf(p.id), 0);
  const assetBuildingsPln = buildings.reduce((a, b) => a + paidOf(b.id), 0);
  const op = lifts.filter((l) => l.operating);
  const cap = op.reduce((a, l) => a + l.capacityPerHour, 0);
  const pts = (l: LiftFact) => (l.gondola ? ep.passes.pointsGondolaRide : l.aerial ? ep.passes.pointsChairRide : ep.passes.pointsSurfaceRide);
  return {
    lifts,
    pistes,
    buildings,
    assetValuePln: assetLiftsPln + assetPistesPln + assetBuildingsPln,
    assetLiftsPln,
    assetPistesPln,
    assetBuildingsPln,
    kmOpen: pistes.filter((p) => p.open).reduce((a, p) => a + p.lengthM, 0) / 1000,
    capacityPerHour: cap,
    parkingCars: ep.demand.streetParkingCars + buildings.filter((b) => b.built && b.accessible).reduce((a, b) => a + b.type.cars, 0),
    roadKm: (layout.roads ?? []).reduce((a, r) => a + (state.construction[r.id] ? 0 : (analysis.roads?.get(r.id)?.lengthM ?? 0)), 0) / 1000,
    pointsPerRide: cap > 0 ? op.reduce((a, l) => a + pts(l) * l.capacityPerHour, 0) / cap : ep.passes.pointsSurfaceRide,
  };
}

// ------------------------------------------------------------------ śnieg na trasach

export interface ResortSnow {
  /** Ocena śniegu 0–1 na otwartych trasach (średnia po długości; zbyt cienka baza obniża). */
  score: number;
  /** Udział długości otwartych tras ze zbyt cienką bazą (skala ≥ 0,3). */
  thinShare: number;
  meanBaseCm: number;
  /** Etap 7: to samo na samym śniegu naturalnym (bez technicznego). */
  thinShareNatural?: number;
}

/** Śnieg na otwartych trasach z mapy śniegu (stan i zapas wody) i podłoża. */
export function resortSnow(
  analysis: ResortAnalysis,
  facts: ResortFacts,
  snow: { quality: Uint8Array; sweMm: Float32Array; techMm?: Float32Array } | null,
  cellAt: (xM: number, yM: number) => number,
  riding: RidingParams,
  gp: GuestParams,
): ResortSnow {
  if (!snow) return { score: 0, thinShare: 1, meanBaseCm: 0 };
  let len = 0;
  let scoreSum = 0;
  let thinLen = 0;
  let thinNatLen = 0;
  let baseSum = 0;
  const ground = analysis.ground;
  for (const pf of facts.pistes) {
    if (!pf.open) continue;
    const a = analysis.pistes.get(pf.id);
    if (!a) continue;
    const axis = a.axis.filter((s) => !Number.isNaN(s.elevationM));
    for (let i = 0; i < axis.length; i++) {
      const s = axis[i];
      const w = i + 1 < axis.length ? axis[i + 1].distanceM - s.distanceM : 0;
      if (w <= 0) continue;
      const k = cellAt(s.xM, s.yM);
      if (k < 0) continue;
      const q = snow.quality[k];
      const swe = Number.isNaN(snow.sweMm[k]) ? 0 : snow.sweMm[k];
      const base = packedBaseCm(swe, riding);
      const g = ground ? ground[k] : 2;
      const sev = thinSeverity(base, minBaseCm(g === GROUND_FOREST ? 4 : g, riding));
      const qs = gp.satisfaction.snowScoreByQuality[q] ?? 0;
      scoreSum += w * (qs * (1 - sev) + gp.thinBase.snowScore * sev);
      if (sev >= 0.3) thinLen += w;
      const tech = snow.techMm ? Math.min(swe, snow.techMm[k]) : 0;
      if (thinSeverity(packedBaseCm(swe - tech, riding), minBaseCm(g === GROUND_FOREST ? 4 : g, riding)) >= 0.3) thinNatLen += w;
      baseSum += w * base;
      len += w;
    }
  }
  if (len <= 0) return { score: 0, thinShare: 1, meanBaseCm: 0 };
  return { score: scoreSum / len, thinShare: thinLen / len, meanBaseCm: baseSum / len, thinShareNatural: thinNatLen / len };
}

// ------------------------------------------------------------------ popyt

export interface DayContext {
  date: CalendarDate;
  facts: ResortFacts;
  snow: ResortSnow;
  weather: DayWeather;
  forecast: ReturnType<WeatherBook['forecastFor']>;
  competitors: CompetitorDay[];
}

export interface DayPlan {
  date: CalendarDate;
  info: DayInfo;
  /** Sezon otwarty i pracuje co najmniej jeden wyciąg. */
  open: boolean;
  guests: number;
  /** Popyt przed ograniczeniem parkingu. */
  demand: number;
  parkingLimit: number;
  typeShares: number[];
  hours: OpeningHours;
  factors: { pool: number; day: number; month: number; forecast: number; noise: number; attractiveness: number; share: number; priceFactor: number; marketPricePln: number };
  compGuests: number[];
}

export function attractiveness(km: number, snowScore: number, reputation: number, pricePln: number, marketPricePln: number, ep: EconomyParams): number {
  const d = ep.demand;
  if (km <= 0 || snowScore < d.lowSnowLimit) return 0;
  return km ** d.offerExponent * snowScore ** d.snowExponent * (reputation / d.reputationRef) ** d.reputationExponent * (pricePln / Math.max(1, marketPricePln)) ** -d.priceElasticity;
}

/** Współczynnik dnia (dzień tygodnia, ferie, święta) i miesiąca. */
export function dayFactors(date: CalendarDate, info: DayInfo, ep: EconomyParams): { day: number; month: number } {
  const d = ep.demand;
  const publicHoliday = date.month === 1 && date.day === 6;
  const base = publicHoliday ? d.weekdayFactors[6] * d.publicHolidayFactor : d.weekdayFactors[info.weekday];
  const h = info.christmas ? 1 : info.feria.share;
  const boost = info.christmas ? d.christmasBoost : d.feriaBoost;
  let day = (1 - h) * base + h * d.holidayDayFactor * boost;
  if (date.month === 12 && date.day === 31) day *= d.newYearEveFactor;
  if (date.month === 1 && date.day === 1) day *= d.newYearDayFactor;
  return { day, month: d.monthFactors[date.month - 1] };
}

export function forecastFactor(f: DayContext['forecast'], ep: EconomyParams): number {
  if (!f) return 1;
  const d = ep.demand;
  let x = 1;
  const rainP = f.topTMeanC > 1 ? f.precipitationProbability : 0;
  x *= 1 - d.rainProbabilityPenalty * rainP;
  if (f.topTMeanC < d.coldLimitC) x *= d.coldFactor;
  if (f.topWindMs > d.windLimitMs) x *= d.windFactor;
  if (f.cloudFraction < d.sunnyCloudMax && f.precipitationProbability < 0.3) x *= d.sunnyFactor;
  return x;
}

/** Plan dnia: ilu gości przyjedzie, jaki skład, godziny. */
export function planDay(state: GameState, ctx: DayContext, ep: EconomyParams): DayPlan {
  const d = ep.demand;
  const info = dayInfo(ctx.date, ep);
  const f = dayFactors(ctx.date, info, ep);
  const fc = forecastFactor(ctx.forecast, ep);
  const rng = new Rng(state.seed).fork('popyt').fork(formatIsoDate(ctx.date));
  const noise = Math.exp(d.noiseSd * rng.normal() - (d.noiseSd * d.noiseSd) / 2);
  const pool = d.regionPoolPerDay * f.day * f.month * fc * noise;
  const market = ep.competitors.list.reduce((a, c) => a + c.dayPln, 0) / ep.competitors.list.length;
  const open = state.seasonOpen && !state.bankrupt && ctx.facts.lifts.some((l) => l.operating);
  const rep = reputationOf(state, ep);
  const aUs = open ? attractiveness(ctx.facts.kmOpen, ctx.snow.score, rep, state.prices.dayPln, market, ep) : 0;
  const aComp = ctx.competitors.map((c) => (c.open ? attractiveness(c.kmOpen, c.snowScore, c.reputation, c.dayPln, market, ep) : 0));
  const denom = aUs + aComp.reduce((a, b) => a + b, 0) + d.otherAttractiveness;
  const share = aUs / denom;
  const demand = pool * share;
  const typeShares = info.kind === 'holiday' ? ep.mix.holiday : info.kind === 'weekend' ? ep.mix.weekend : ep.mix.weekday;
  const totalShare = typeShares.reduce((a, b) => a + b, 0) || 1;
  const schoolShare = (typeShares[3] ?? 0) / totalShare;
  const carShare = Math.max(0.05, 1 - schoolShare * d.busShareSchool);
  const parkingLimit = (ctx.facts.parkingCars * d.personsPerCar) / carShare;
  const guests = Math.max(0, Math.round(Math.min(demand, parkingLimit)));
  return {
    date: ctx.date,
    info,
    open,
    guests: open ? guests : 0,
    demand: open ? demand : 0,
    parkingLimit,
    typeShares,
    hours: { ...state.hours },
    factors: { pool, day: f.day, month: f.month, forecast: fc, noise, attractiveness: aUs, share, priceFactor: (state.prices.dayPln / market) ** -d.priceElasticity, marketPricePln: market },
    compGuests: aComp.map((a) => (pool * a) / denom),
  };
}

// ------------------------------------------------------------------ wynik dnia

export interface DayOutcome {
  source: 'agents' | 'quick';
  guests: number;
  ratingSum: number;
  ratingCount: number;
  meanQueueMin: number;
  /** Goście (lub próbka): pobyt, przejazdy, dziecko, umiejętność; każdy rekord = `weight` osób. */
  stayH: ArrayLike<number>;
  rides: ArrayLike<number>;
  child: ArrayLike<number>;
  skill: ArrayLike<number>;
  weight: number;
  /** Wjazdy i godziny pracy wyciągów (kolejność jak facts.lifts). */
  liftRides: number[];
  liftHours: number[];
}

export function emptyOutcome(facts: ResortFacts): DayOutcome {
  return { source: 'quick', guests: 0, ratingSum: 0, ratingCount: 0, meanQueueMin: 0, stayH: [], rides: [], child: [], skill: [], weight: 1, liftRides: facts.lifts.map(() => 0), liftHours: facts.lifts.map(() => 0) };
}

/** Wynik dnia z symulacji gości (GuestDay.economySummary). */
export function agentOutcome(s: GuestEconomySummary, facts: ResortFacts): DayOutcome {
  const idx = new Map(s.liftIds.map((id, i) => [id, i]));
  return {
    source: 'agents',
    // Przyjechali (także ci, którzy od razu odjechali bez karnetu).
    guests: s.ratingCount,
    ratingSum: s.ratingSum,
    ratingCount: s.ratingCount,
    meanQueueMin: s.meanQueueMin,
    stayH: s.stayH,
    rides: s.rides,
    child: s.child,
    skill: s.skill,
    weight: 1,
    liftRides: facts.lifts.map((l) => (idx.has(l.id) ? s.liftBoarded[idx.get(l.id)!] : 0)),
    liftHours: facts.lifts.map((l) => (idx.has(l.id) ? s.liftHours[idx.get(l.id)!] : 0)),
  };
}

/** Model zgrubny dnia: przejazdy ograniczone przepustowością, kolejki, ocena z tych samych składników co u gości. */
export function quickDayOutcome(state: GameState, plan: DayPlan, ctx: DayContext, ep: EconomyParams, gp: GuestParams): DayOutcome {
  const facts = ctx.facts;
  if (!plan.open || plan.guests <= 0 || facts.capacityPerHour <= 0) return emptyOutcome(facts);
  const q = ep.quickDay;
  const H = Math.max(0.5, plan.hours.closeH - plan.hours.openH);
  const C = facts.capacityPerHour;
  // Cykl: wjazd + zjazd (średnio, ważone przepustowością) + dojście.
  let rideMin = 0;
  let descentMin = 0;
  for (const l of facts.lifts) {
    if (!l.operating) continue;
    rideMin += (l.rideMin * l.capacityPerHour) / C;
    descentMin += ((l.lengthM / q.descentSpeedMs / 60) * l.capacityPerHour) / C;
  }
  const cycleMin = rideMin + descentMin + q.cycleExtraMin;
  // Czekanie z bilansu przepustowości; przy kolejkach goście wyjeżdżają wcześniej (punkt stały).
  let wait = 0;
  let stay = Math.min(q.meanStayH, H);
  for (let it = 0; it < 30; it++) {
    stay = Math.min(q.meanStayH, H) * Math.exp(-wait / q.stayQueueTauMin);
    const onHill = (plan.guests * stay) / H;
    const w = Math.min(q.maxQueueMin, Math.max(0, (60 * onHill * q.activeShare) / C - cycleMin));
    wait = 0.5 * wait + 0.5 * w;
  }
  // Umiejętności bez trasy na swój poziom (np. początkujący przy samych czerwonych) – krótki pobyt.
  const easiest = facts.pistes.filter((p) => p.open).reduce((m, p) => Math.min(m, p.classIndex), 99);
  const canSki = gp.skills.map((sk) => sk.maxClass >= easiest);
  const onHill = (plan.guests * stay) / H;
  const ridesPerGuest = (stay * q.activeShare * 60) / (cycleMin + wait);
  const totalRides = Math.min(plan.guests * ridesPerGuest, C * H);
  const onPiste = onHill * q.onPisteShare;
  const crowdScore = 1 - Math.min(1, onPiste / Math.max(0.1, facts.kmOpen * 10) / gp.satisfaction.crowdFullPer100m);
  const c = ctx.weather.cond;
  const weatherScore = weatherScoreFor(c, (c.tempBottomC + c.tempTopC) / 2, (c.windBottomMs + c.windTopMs) / 2, gp.needs.comfortTempC);
  const s = satisfactionScore({ skiS: descentMin, queueS: wait, snowScore: ctx.snow.score, crowdScore, weatherScore, matchScore: q.matchScore, accident: false }, gp.satisfaction);
  // Goście bez trasy na swój poziom wyjeżdżają od razu (bez karnetu) i są rozczarowani – jak w symulacji gości.
  const unsuited = gp.skills.reduce((a, sk, i) => a + (canSki[i] ? 0 : sk.share), 0) / Math.max(1e-9, gp.skills.reduce((a, sk) => a + sk.share, 0));
  const rating = (1 - unsuited) * (1 + 4 * s) + unsuited * (1 + 4 * gp.satisfaction.noSkiSatisfaction);
  // Próbka gości do sprzedaży karnetów.
  const n = Math.max(1, Math.min(q.sampleGuests, plan.guests));
  const rng = new Rng(state.seed).fork('dzien-zgrubny').fork(formatIsoDate(plan.date));
  const stayH = new Float32Array(n);
  const rides = new Int32Array(n);
  const child = new Uint8Array(n);
  const skill = new Uint8Array(n);
  const sc = gp.scenario;
  const ts = plan.typeShares;
  const tsum = ts.reduce((a, b) => a + b, 0) || 1;
  const childShare = ((ts[2] ?? 0) * 0.45 + (ts[3] ?? 0) * 0.92) / tsum;
  const perHour = totalRides / (plan.guests * stay);
  for (let i = 0; i < n; i++) {
    const st = Math.min(H, Math.max(sc.stayMinH, (stay + sc.staySdH * rng.normal())));
    stayH[i] = st;
    child[i] = rng.next() < childShare ? 1 : 0;
    let r = rng.next();
    let k = 0;
    for (; k < gp.skills.length - 1; k++) {
      r -= gp.skills[k].share;
      if (r < 0) break;
    }
    skill[i] = k;
    if (!canSki[k]) stayH[i] = 0;
    rides[i] = stayH[i] > 0 ? Math.max(1, Math.round(perHour * stayH[i])) : 0;
  }
  const opCap = facts.lifts.map((l) => (l.operating ? l.capacityPerHour : 0));
  return {
    source: 'quick',
    guests: plan.guests,
    ratingSum: rating * plan.guests,
    ratingCount: plan.guests,
    meanQueueMin: wait,
    stayH,
    rides,
    child,
    skill,
    weight: plan.guests / n,
    liftRides: opCap.map((cap) => (totalRides * cap) / C),
    liftHours: opCap.map((cap) => (cap > 0 ? H : 0)),
  };
}

// ------------------------------------------------------------------ karnety

export interface PassSales {
  revenuePln: number;
  counts: { day: number; fourHour: number; twoHour: number; points: number };
}

/** Każdy gość wybiera najtańszy karnet, który mu wystarczy (część z przyzwyczajenia bierze dzienny). */
export function sellPasses(o: DayOutcome, prices: PassPrices, pointsPerRide: number, ep: EconomyParams): PassSales {
  const p = ep.passes;
  const counts = { day: 0, fourHour: 0, twoHour: 0, points: 0 };
  let revenue = 0;
  const n = o.stayH.length;
  for (let i = 0; i < n; i++) {
    const stay = o.stayH[i];
    if (!(stay > 0)) continue;
    const f = o.child[i] ? p.reducedFactor : 1;
    const habit = ((i * 2654435761) >>> 0) / 4294967296 < p.dayPassHabitShare;
    let best = prices.dayPln * f;
    let kind: keyof PassSales['counts'] = 'day';
    if (!habit) {
      if (stay <= 4.25 && prices.fourHourPln * f < best) {
        best = prices.fourHourPln * f;
        kind = 'fourHour';
      }
      if (stay <= 2.25 && prices.twoHourPln * f < best) {
        best = prices.twoHourPln * f;
        kind = 'twoHour';
      }
      const pts = Math.max(1, o.rides[i]) * pointsPerRide * prices.pointPln * f;
      if (pts < best) {
        best = pts;
        kind = 'points';
      }
    }
    revenue += best * o.weight;
    counts[kind] += o.weight;
  }
  return { revenuePln: revenue, counts };
}

// ------------------------------------------------------------------ zamknięcie dnia

export interface CloseDayResult {
  record: DayRecord;
  flows: Flows;
  passes: PassSales;
  finishedConstruction: string[];
  seasonReport: SeasonReport | null;
}

/** Koszty i przychody dnia, raty, przeglądy, budowy, reputacja; przejście do następnego dnia. */
export interface DayExtra {
  /** Koszty naśnieżania i ratraków tej doby (dodawane do kosztów dnia). */
  flows: Partial<Flows>;
  snowM3: number;
  waterM3: number;
  snowKWh: number;
  fuelL: number;
  groomed: number;
  unfinished: number;
}

export function closeDay(
  state: GameState,
  ctx: DayContext,
  plan: DayPlan,
  outcome: DayOutcome,
  ep: EconomyParams,
  names: { ids: string[]; names: string[] } | null = null,
  extra: DayExtra | null = null,
): CloseDayResult {
  const c = ep.costs;
  const flows = zeroFlows();
  if (extra) for (const [k, v] of Object.entries(extra.flows)) flows[k as keyof Flows] += v ?? 0;
  const facts = ctx.facts;
  const date = ctx.date;
  const wage = c.hourlyWagePln * c.employerCostFactor;
  const working = plan.open;
  const H = Math.max(0, plan.hours.closeH - plan.hours.openH);
  const staffH = H + c.staffExtraHours;
  let passes: PassSales = { revenuePln: 0, counts: { day: 0, fourHour: 0, twoHour: 0, points: 0 } };
  if (working) {
    // Wyciągi: energia (bieg jałowy + część mocy wg wykorzystania) i obsługa.
    facts.lifts.forEach((l, i) => {
      const hours = outcome.liftHours[i] ?? 0;
      if (!l.operating || hours <= 0) return;
      const u = Math.min(1, (outcome.liftRides[i] ?? 0) / Math.max(1, l.capacityPerHour * hours));
      flows.energy += hours * (l.idleKw + (l.powerKw - l.idleKw) * u) * c.energyPlnPerKWh;
      flows.liftStaff += ((l.aerial ? c.staffAerialLift : c.staffSurfaceLift) + l.midStations * c.staffMidStation) * staffH * wage;
    });
    const g = outcome.guests;
    flows.cashiers += Math.max(1, Math.ceil(g / c.guestsPerCashier)) * staffH * wage;
    flows.patrol += Math.max(c.patrolMin, Math.ceil(facts.kmOpen * c.patrolPerKm)) * staffH * c.patrolHourlyPln * c.employerCostFactor;
    flows.seasonal += Math.max(c.seasonalMin, Math.ceil((g / 1000) * c.seasonalPer1000Guests)) * staffH * wage;
    // Przychody: karnety, parking, budynki.
    passes = sellPasses(outcome, state.prices, facts.pointsPerRide, ep);
    flows.passes += passes.revenuePln;
    const ts = plan.typeShares;
    const tsum = ts.reduce((a, b) => a + b, 0) || 1;
    const carGuests = g * (1 - ((ts[3] ?? 0) / tsum) * ep.demand.busShareSchool);
    let cars = carGuests / ep.demand.personsPerCar;
    let beginners = 0;
    for (let i = 0; i < outcome.skill.length; i++) if (outcome.skill[i] === 0 && outcome.stayH[i] > 0) beginners += outcome.weight;
    for (const b of facts.buildings) {
      if (!b.built) continue;
      const t = b.type;
      if (t.base) {
        if (!b.accessible) continue; // parking bez dojazdu – nikt tam nie przyjedzie
        const here = Math.min(cars, t.cars);
        cars -= here;
        flows.parking += here * t.feePerCarPln;
        flows.buildingsStaff += t.staffPerDay * staffH * wage;
        continue;
      }
      if (t.id === 'shuttle') {
        // Transport do schroniska: tylko gdy jest gastronomia z dala od parkingów; goście gastronomii, nie narciarze.
        const parks = facts.buildings.filter((x) => x.type.base && x.built && x.accessible);
        const hut = facts.buildings.some((x) => x.built && x.type.id === 'gastronomy' && parks.every((pk) => Math.hypot(pk.xM - x.xM, pk.yM - x.yM) >= t.minDistanceFromParkingM));
        if (!hut) continue;
        const users = Math.min(t.capacityPerDay, g * t.useShare);
        flows.shuttle += users * t.revenuePerGuestPln;
        flows.goods += users * t.revenuePerGuestPln * t.costShare;
        flows.buildingsStaff += t.staffPerDay * staffH * wage;
        continue;
      }
      const users = Math.min(t.capacityPerDay, (t.id === 'school' ? beginners : g) * t.useShare);
      const rev = users * t.revenuePerGuestPln;
      if (t.id === 'gastronomy') flows.gastronomy += rev;
      else if (t.id === 'rental') flows.rental += rev;
      else flows.school += rev;
      flows.goods += rev * t.costShare;
      flows.buildingsStaff += t.staffPerDay * staffH * wage;
    }
  }
  // Etap 6b: odśnieżanie dróg dojazdowych zimą (codziennie w sezonie zimowego utrzymania).
  const rp = ep.roads;
  if (rp && facts.roadKm > 0) {
    const m = date.month;
    const winter = rp.plowingFromMonth > rp.plowingToMonth ? m >= rp.plowingFromMonth || m <= rp.plowingToMonth : m >= rp.plowingFromMonth && m <= rp.plowingToMonth;
    if (winter) flows.roads += facts.roadKm * rp.plowingPlnPerKmPerDay;
  }
  // Administracja, marketing i sprzedaż – część przychodów dnia (etap 6b, NSAA: G&A ok. 10 % przychodów).
  flows.admin += c.adminShareOfRevenue * REVENUE_KEYS.reduce((a, k) => a + flows[k], 0);
  // Koszty stałe: ubezpieczenie i utrzymanie codziennie (część roczna), stała załoga i raty co miesiąc, przeglądy raz w roku.
  flows.insurance += (facts.assetValuePln * c.insuranceRatePerYear) / 365;
  flows.maintenance += (facts.assetLiftsPln * c.maintenanceLiftsRatePerYear + facts.assetPistesPln * c.maintenancePistesRatePerYear + facts.assetBuildingsPln * c.maintenanceBuildingsRatePerYear) / 365;
  if (date.day === 1) {
    // Stała załoga: kierownictwo + mechanicy i elektrycy na zbudowane wyciągi (etap 6b – zależna od wielkości).
    flows.permanent += (c.permanentStaff + c.permanentStaffPerLift * facts.lifts.length) * c.permanentMonthlyPln;
    for (const loan of state.loans) {
      const interest = (loan.remainingPln * loan.ratePerYear) / 12;
      const principal = Math.min(loan.remainingPln, Math.max(0, loan.monthlyPaymentPln - interest));
      flows.interest += interest;
      flows.loanPrincipal += principal;
      loan.remainingPln -= principal;
      loan.monthsLeft--;
    }
    const before = state.loans.length;
    state.loans = state.loans.filter((l) => l.remainingPln > 0.5 && l.monthsLeft > 0);
    if (state.loans.length < before) log(state, 'Kredyt spłacony.');
  }
  if (date.day === 1 && date.month === ep.calendar.fixedChargesMonth) {
    const ins = facts.lifts.filter((l) => l.built).reduce((a, l) => a + (l.aerial ? c.inspectionAerialPln : c.inspectionSurfacePln), 0);
    flows.inspections += ins;
    if (ins > 0) log(state, `Przeglądy wyciągów przed sezonem: ${fmtPln(ins)}`);
  }
  // Budowy: postęp (zimą wolniej).
  const finished: string[] = [];
  const progress = WINTER_MONTHS(date, ep) ? c.winterBuildProgressFactor : 1;
  const trench = ep.snowmaking ? date.month >= ep.snowmaking.pipe.trenchFromMonth && date.month <= ep.snowmaking.pipe.trenchToMonth : true;
  for (const [id, b] of Object.entries(state.construction)) {
    b.leftDays -= b.summerOnly && !trench ? 0 : progress;
    if (b.leftDays <= 0) {
      delete state.construction[id];
      finished.push(id);
      const name = names ? names.names[names.ids.indexOf(id)] : id;
      log(state, `Gotowe: ${name ?? id}`);
    }
  }
  // Reputacja: stare oceny tracą wagę, dochodzą dzisiejsze.
  const rd = ep.reputation.dailyDecay;
  state.reputation.sum = state.reputation.sum * rd + (working ? outcome.ratingSum : 0);
  state.reputation.weight = state.reputation.weight * rd + (working ? outcome.ratingCount : 0);
  // Saldo.
  const dayFlows = zeroFlows();
  addFlows(dayFlows, flows);
  addFlows(dayFlows, state.pending);
  state.balancePln += sumRevenue(flows) - sumCosts(flows) - flows.loanPrincipal - flows.equipment;
  state.pending = zeroFlows();
  addFlows(state.year.flows, dayFlows);
  if (state.mode === 'career') {
    if (state.balancePln < 0) state.negativeDays++;
    else state.negativeDays = 0;
    if (!state.bankrupt && (state.balancePln < -ep.career.overdraftLimitPln || state.negativeDays > ep.career.bankruptcyDays)) {
      state.bankrupt = true;
      state.seasonOpen = false;
      log(state, 'BANKRUCTWO – saldo za długo ujemne albo przekroczony debet. Koniec kariery.');
    }
  }
  const record: DayRecord = {
    date: formatIsoDate(date),
    open: working,
    guests: working ? outcome.guests : 0,
    demand: plan.demand,
    rating: working && outcome.ratingCount > 0 ? outcome.ratingSum / outcome.ratingCount : null,
    revenuePln: sumRevenue(dayFlows),
    costPln: sumCosts(dayFlows),
    capitalPln: dayFlows.construction + dayFlows.equipment - dayFlows.refunds - dayFlows.loanIn + dayFlows.loanPrincipal,
    balancePln: state.balancePln,
    src: working ? (outcome.source === 'agents' ? 'a' : 'q') : '-',
    snowScore: ctx.snow.score,
    kmOpen: facts.kmOpen,
    compGuests: plan.compGuests.map((x) => Math.round(x)),
    compOpen: ctx.competitors.map((x) => x.open),
    label: plan.info.label,
    snowM3: extra?.snowM3 ?? 0,
    waterM3: extra?.waterM3 ?? 0,
    snowKWh: extra?.snowKWh ?? 0,
    fuelL: extra?.fuelL ?? 0,
    groomed: extra?.groomed ?? 0,
    unfinished: extra?.unfinished ?? 0,
    // Dzień otwarty dzięki naśnieżaniu: na samym śniegu naturalnym trasy byłyby za cienkie.
    techOpen: working && ctx.snow.thinShare < 0.5 && (ctx.snow.thinShareNatural ?? ctx.snow.thinShare) >= 0.5,
  };
  state.year.days.push(record);
  state.lastDay = { ...record, flows: dayFlows };
  // Następny dzień; 1 maja – koniec roku gry: raport sezonu, sezon zamknięty.
  const next = addDays(date, 1);
  let report: SeasonReport | null = null;
  if (next.month === ep.calendar.summerStartMonth && next.day === 1) {
    if (state.seasonOpen) log(state, 'Koniec kwietnia – sezon zamknięty.');
    state.seasonOpen = false;
    report = seasonReport(state, ep);
    state.history.push(report);
    state.year = { startYear: next.year, balanceStart: state.balancePln, flows: zeroFlows(), days: [] };
  }
  state.date = next;
  state.hour = 0;
  return { record, flows: dayFlows, passes, finishedConstruction: finished, seasonReport: report };
}

/** Raport roku gry (od 1 maja do teraz) – także w trakcie (podgląd). */
export function seasonReport(state: GameState, ep: EconomyParams): SeasonReport {
  const y = state.year;
  const days = y.days;
  let guests = 0;
  let rSum = 0;
  let rN = 0;
  for (const d of days) {
    guests += d.guests;
    if (d.rating !== null && d.guests > 0) {
      rSum += d.rating * d.guests;
      rN += d.guests;
    }
  }
  return {
    startYear: y.startYear,
    from: days[0]?.date ?? formatIsoDate(state.date),
    to: days[days.length - 1]?.date ?? formatIsoDate(state.date),
    flows: { ...y.flows },
    days: days.slice(),
    openDays: days.filter((d) => d.open).length,
    guests,
    meanRating: rN > 0 ? rSum / rN : null,
    reputationEnd: reputationOf(state, ep),
    balanceStart: y.balanceStart,
    balanceEnd: state.balancePln,
    debtEnd: debtOf(state),
    competitors: ep.competitors.list.map((c, i) => ({
      name: c.name,
      openDays: days.filter((d) => d.compOpen[i]).length,
      guests: days.reduce((a, d) => a + (d.compGuests[i] ?? 0), 0),
      dayPln: c.dayPln,
    })),
  };
}

// ------------------------------------------------------------------ decyzje gracza

/** Otwarcie / zamknięcie sezonu. Zwraca komunikat błędu albo null. */
export function setSeasonOpen(state: GameState, open: boolean, ep: EconomyParams): string | null {
  if (state.bankrupt) return 'Ośrodek zbankrutował.';
  if (open) {
    const m = state.date.month;
    const c = ep.calendar;
    const allowed = m >= c.earliestOpenMonth || m <= c.latestCloseMonth;
    if (!allowed) return `Sezon można otworzyć od ${MONTHS[c.earliestOpenMonth - 1]} do ${MONTHS[c.latestCloseMonth - 1]}.`;
  }
  if (state.seasonOpen !== open) log(state, open ? 'Sezon otwarty.' : 'Sezon zamknięty.');
  state.seasonOpen = open;
  return null;
}

const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

export function setPrices(state: GameState, prices: Partial<PassPrices>, ep: EconomyParams): void {
  const clamp = (v: number) => Math.min(ep.passes.maxPricePln, Math.max(ep.passes.minPricePln, Math.round(v * 100) / 100));
  for (const k of Object.keys(prices) as (keyof PassPrices)[]) {
    const v = prices[k];
    if (typeof v === 'number' && Number.isFinite(v)) state.prices[k] = clamp(v);
  }
}

export function setHours(state: GameState, hours: OpeningHours, ep: EconomyParams): void {
  const open = Math.max(ep.hours.minOpenH, Math.min(hours.openH, ep.hours.maxCloseH - 1));
  const close = Math.min(ep.hours.maxCloseH, Math.max(hours.closeH, open + 1));
  state.hours = { openH: open, closeH: close };
}

/** Największy możliwy nowy kredyt [zł]. */
export function loanLimit(state: GameState, facts: ResortFacts, ep: EconomyParams): number {
  return Math.max(0, ep.loan.maxLoanToAssets * (facts.assetValuePln + Math.max(0, state.balancePln)) - debtOf(state));
}

/** Kredyt inwestycyjny (rata annuitetowa co miesiąc). Zwraca komunikat błędu albo null. */
export function takeLoan(state: GameState, amountPln: number, years: number, facts: ResortFacts, ep: EconomyParams): string | null {
  if (state.mode !== 'career') return 'W piaskownicy pieniądze są bez limitu – kredyt niepotrzebny.';
  if (state.bankrupt) return 'Ośrodek zbankrutował.';
  const amount = Math.round(amountPln);
  if (!(amount > 0)) return 'Podaj kwotę kredytu.';
  const lim = loanLimit(state, facts, ep);
  if (amount > lim) return `Bank pożyczy najwyżej ${fmtPln(lim)} (70 % majątku i gotówki minus obecne kredyty).`;
  const n = Math.round(Math.min(ep.loan.maxTermYears, Math.max(ep.loan.minTermYears, years)) * 12);
  const r = ep.loan.interestRatePerYear / 12;
  const payment = r > 0 ? (amount * r) / (1 - (1 + r) ** -n) : amount / n;
  state.loans.push({ id: state.nextLoanId++, principalPln: amount, remainingPln: amount, ratePerYear: ep.loan.interestRatePerYear, monthlyPaymentPln: payment, monthsLeft: n, takenOn: formatIsoDate(state.date) });
  state.balancePln += amount;
  state.pending.loanIn += amount;
  log(state, `Kredyt ${fmtPln(amount)} na ${n / 12} lat, rata ${fmtPln(payment)}/mies.`);
  return null;
}

/** Wcześniejsza spłata kredytu (całość lub część). */
export function repayLoan(state: GameState, loanId: number, amountPln: number): string | null {
  const loan = state.loans.find((l) => l.id === loanId);
  if (!loan) return 'Nie ma takiego kredytu.';
  const amount = Math.min(loan.remainingPln, Math.max(0, amountPln), Math.max(0, state.balancePln));
  if (amount <= 0) return 'Brak środków na spłatę.';
  const ratio = (loan.remainingPln - amount) / loan.remainingPln;
  loan.remainingPln -= amount;
  loan.monthlyPaymentPln *= ratio;
  state.balancePln -= amount;
  state.pending.loanPrincipal += amount;
  if (loan.remainingPln < 0.5) state.loans = state.loans.filter((l) => l.id !== loanId);
  log(state, `Spłata kredytu: ${fmtPln(amount)}`);
  return null;
}

// ------------------------------------------------------------------ pomocnicze

export function fmtPln(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} mln zł`;
  if (a >= 1e4) return `${(v / 1e3).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} tys. zł`;
  return `${Math.round(v).toLocaleString('pl-PL')} zł`;
}

/** Rok początku sezonu narciarskiego (październik–kwiecień) dla daty. */
export function skiSeasonYear(date: CalendarDate): number {
  return seasonStartYear(date, 10);
}

/** Data startowa kariery z danych. */
export function careerStartDate(ep: EconomyParams): CalendarDate {
  return parseIsoDate(ep.career.startDate);
}
