/**
 * Goście ośrodka w ciągu jednego dnia (etap 5): przyjazd, kolejki do wyciągów, przejazdy, zjazdy
 * po trasach, przerwy, wyjazd; zmęczenie, głód, zimno, zadowolenie; wypadki; ocena na koniec dnia.
 *
 * Wszystko w tablicach liczb (bez obiektów na gościa). Krok czasu stały (stepS) – ten sam seed
 * i ten sam dzień dają identyczny przebieg niezależnie od prędkości zegara gry. Rodziny i grupy
 * są jedną jednostką ruchu (wspólne decyzje, prędkość najsłabszego) – trzymają się razem.
 * Liczba gości to na razie parametr scenariusza (popyt – etap 6).
 */
import type { GuestParams } from './guestParams';
import type { GuestNet, NetLift, NetPiste } from './guestNetwork';
import { Rng } from './rng';
import type { CalendarDate } from './weather';

// ---------------------------------------------------------------- stany

/** Stan grupy. */
export const G_NOT_ARRIVED = 0;
export const G_WALK = 1;
export const G_QUEUE = 2;
export const G_LIFT = 3;
export const G_PISTE = 4;
export const G_BREAK = 5;
export const G_REST = 6;
export const G_GONE = 7;

/** Stan osoby przy wyciągu. */
const M_NONE = 0;
const M_QUEUE = 1;
const M_RIDE = 2;
const M_TOP = 3;

/** Rodzaj postaci w ramce do rysowania. */
export const DRAW_SKI = 0;
export const DRAW_BOARD = 1;
export const DRAW_STAND = 2;
export const DRAW_SEATED = 3;
export const DRAW_WALK = 4;
/** Liczb na osobę w ramce: id, x, y, vx, vy, kierunek, rodzaj, wariant, faza. */
export const FRAME_STRIDE = 9;
/** Liczb na wyciąg: kolejka [os.], czekanie [min], wykorzystanie 0–1, zamknięty 0/1, na linie [os.], przewiezieni [os.]. */
export const LIFT_STRIDE = 6;

export const LEAVE_REASONS = ['koniec planowanego pobytu', 'zmęczenie', 'zimno', 'pogoda', 'zły śnieg', 'wypadek', 'zamknięcie wyciągów', 'brak tras na jego poziom', 'za długie kolejki'] as const;
const R_PLAN = 0;
const R_FATIGUE = 1;
const R_COLD = 2;
const R_WEATHER = 3;
const R_SNOW = 4;
const R_ACCIDENT = 5;
const R_CLOSE = 6;
const R_NOTHING = 7;
const R_QUEUES = 8;

const BREAK_LUNCH = 0;
const BREAK_REST = 1;
const BREAK_WARM = 2;

/** Indeksy stanów śniegu (jak SNOW_QUALITY_CODES w snow.ts). */
const Q_NONE = 0;
const Q_POWDER = 1;
const Q_SLUSH = 5;
const Q_ICY = 6;
const Q_THIN = 7;

/** Okno do liczenia wykorzystania przepustowości [s] i stała zaniku natężenia ruchu [s]. */
const UTIL_WINDOW_S = 1800;
const RECENT_TRAFFIC_TAU_S = 1800;
/** Co ile sekund gry liczyć potrzeby gości (zmieniają się w skali minut). */
const NEEDS_STEP_S = 10;
/** Okno tłoku wzdłuż trasy (± [m]). */
const CROWD_HALF_WINDOW_M = 50;

export interface GuestConditions {
  bottomElevM: number;
  topElevM: number;
  tempBottomC: number;
  tempTopC: number;
  windBottomMs: number;
  windTopMs: number;
  /** Opad teraz [mm/h] i czy to deszcz. */
  precipMmH: number;
  rain: boolean;
  cloud: number;
}

export interface GuestSnow {
  /** Kod stanu (SNOW_QUALITY_CODES) i grubość [cm] w komórkach. */
  quality: Uint8Array;
  depthCm: Float32Array;
  /** Muldy z poprzednich dni 0–1 (null – brak). */
  moguls: Float32Array | null;
  /** Za cienka baza 0–1 (snowRiding.thinField; null – brak danych = baza wystarcza). */
  thin?: Float32Array | null;
}

export interface GuestEvent {
  kind: 'accident' | 'damage';
  timeS: number;
  guest: number;
  xM: number;
  yM: number;
  place: string;
  cause: string;
}

export interface GuestDayOptions {
  seed: number;
  date: CalendarDate;
  guests: number;
  /** Wysokość terenu w komórkach (do temperatury w miejscu gościa). */
  elevationM: Float32Array;
}

export interface GuestCounts {
  planned: number;
  arrived: number;
  onHill: number;
  inQueue: number;
  onLift: number;
  onPiste: number;
  inBreak: number;
  gone: number;
}

export interface GuestDayReport {
  date: CalendarDate;
  timeS: number;
  counts: GuestCounts;
  liftRides: number;
  descents: number;
  meanQueueMin: number;
  meanRating: number;
  ratings: number[];
  accidents: GuestEvent[];
  /** Uszkodzenia sprzętu na zbyt cienkiej bazie. */
  equipmentDamage: number;
  leaveReasons: number[];
  crowdedPistes: { name: string; peakPer100m: number; personHours: number }[];
  busiestLifts: { name: string; maxQueue: number; maxWaitMin: number; rides: number; utilization: number }[];
  hourly: { hour: number; onHill: number; inQueue: number; meanWaitMin: number }[];
}

export interface GuestCard {
  id: number;
  typeName: string;
  skillName: string;
  snowboard: boolean;
  child: boolean;
  groupSize: number;
  patienceMin: number;
  prefs: { long: number; powder: number; quiet: number };
  arriveH: number;
  departH: number;
  hunger: number;
  fatigue: number;
  cold: number;
  satisfaction: number;
  ratingNow: number;
  runs: number;
  liftRides: number;
  distanceKm: number;
  verticalM: number;
  queueMin: number;
  skiMin: number;
  /** Uszkodzenia sprzętu (za cienka baza). */
  damage: number;
  doing: string;
  plan: string;
}

// ---------------------------------------------------------------- pomocnicze

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const fmtH = (s: number) => {
  const m = Math.round(s / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Temperatura odczuwalna (wind chill, wzór kanadyjski; wiatr w km/h). */
export function apparentTempC(tC: number, windMs: number): number {
  const v = windMs * 3.6;
  if (v < 4.8 || tC > 10) return tC;
  const p = v ** 0.16;
  return 13.12 + 0.6215 * tC - 11.37 * p + 0.3965 * tC * p;
}

export interface SatisfactionInputs {
  skiS: number;
  queueS: number;
  snowScore: number;
  crowdScore: number;
  weatherScore: number;
  matchScore: number;
  accident: boolean;
}

/** Zadowolenie 0–1 z części (wagi z data/guests.json). Dłuższe kolejki – mniej zadowolenia. */
export function satisfactionScore(i: SatisfactionInputs, p: GuestParams['satisfaction']): number {
  const total = i.skiS + i.queueS;
  const ratio = total > 0 ? i.skiS / total : 1;
  const sRatio = clamp01((ratio - p.rideRatioZero) / Math.max(1e-6, p.rideRatioFull - p.rideRatioZero));
  const s = p.rideRatioWeight * sRatio + p.snowWeight * i.snowScore + p.crowdWeight * i.crowdScore + p.weatherWeight * i.weatherScore + p.matchWeight * i.matchScore;
  return clamp01(s - (i.accident ? p.accidentPenalty : 0));
}

/** Ocena 1–5 z zadowolenia. */
export function ratingFromSatisfaction(s: number): number {
  return Math.min(5, Math.max(1, Math.round(1 + 4 * s)));
}

/** Wartość trasy danej klasy dla umiejętności (1 – ulubiona, 0 – za trudna). */
export function classMatch(classIndex: number, skill: { maxClass: number; preferredClass: number }, c: GuestParams['choice']): number {
  if (classIndex > skill.maxClass) return 0;
  if (classIndex === skill.preferredClass) return 1;
  return classIndex < skill.preferredClass ? c.easierClassValue ** (skill.preferredClass - classIndex) : c.harderClassValue ** (classIndex - skill.preferredClass);
}

/** Punkt osi trasy w odległości s: indeks próbki i ułamek. */
function axisIndex(p: NetPiste, s: number): number {
  const d = p.distM;
  let lo = 0;
  let hi = d.length - 1;
  if (s <= d[0]) return 0;
  if (s >= d[hi]) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Punkt na linii wyciągu w odległości d (po linii) od dolnej stacji: położenie, kierunek, rzut poziomy / po linii. */
function liftPoint(lift: NetLift, d: number): { x: number; y: number; ux: number; uy: number; horizontalPerSlope: number } {
  const p = lift.path;
  let i = 0;
  while (i < p.length - 2 && p[i + 1].slopeM < d) i++;
  const a = p[i];
  const b = p[i + 1];
  const seg = b.slopeM - a.slopeM || 1;
  const f = Math.min(1, Math.max(0, (d - a.slopeM) / seg));
  const dx = b.xM - a.xM;
  const dy = b.yM - a.yM;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.xM + f * dx, y: a.yM + f * dy, ux: dx / len, uy: dy / len, horizontalPerSlope: Math.min(1, len / seg) };
}

// ---------------------------------------------------------------- dzień

export class GuestDay {
  readonly net: GuestNet;
  readonly p: GuestParams;
  readonly date: CalendarDate;
  /** Czas [s od północy]. */
  t: number;
  readonly openS: number;
  readonly closeS: number;
  private readonly rng: Rng;
  private readonly elev: Float32Array;
  private readonly cell: number;
  private readonly wCells: number;
  private readonly hCells: number;

  // osoby
  readonly n: number;
  readonly grp: Int32Array;
  readonly skill: Uint8Array;
  readonly board: Uint8Array;
  readonly child: Uint8Array;
  readonly jacket: Uint8Array;
  readonly patienceS: Float32Array;
  readonly prefLong: Float32Array;
  readonly prefPowder: Float32Array;
  readonly prefQuiet: Float32Array;
  readonly hunger: Float32Array;
  readonly fatigue: Float32Array;
  readonly cold: Float32Array;
  private readonly mstate: Uint8Array;
  private readonly joinT: Float64Array;
  private readonly rideT: Float64Array;
  readonly skiS: Float64Array;
  readonly queueS: Float64Array;
  private readonly snowAcc: Float64Array;
  private readonly snowTime: Float64Array;
  private readonly crowdAcc: Float64Array;
  private readonly crowdTime: Float64Array;
  private readonly weatherAcc: Float64Array;
  private readonly weatherTime: Float64Array;
  private readonly matchAcc: Float64Array;
  private readonly matchLen: Float64Array;
  readonly runs: Int32Array;
  readonly liftRides: Int32Array;
  readonly distanceM: Float64Array;
  readonly verticalM: Float64Array;
  readonly accident: Uint8Array;
  /** Uszkodzenia sprzętu na zbyt cienkiej bazie. */
  readonly damage: Uint8Array;
  readonly rating: Uint8Array;

  // grupy
  readonly g: number;
  readonly gStart: Int32Array;
  readonly gCount: Int32Array;
  readonly gType: Uint8Array;
  readonly gSkill: Uint8Array;
  readonly gState: Uint8Array;
  readonly gHub: Int32Array;
  readonly gEdge: Int32Array;
  readonly gS: Float64Array;
  private readonly gV: Float32Array;
  private readonly gLane: Float32Array;
  private readonly gTurn: Float32Array;
  private readonly gPhi: Float32Array;
  readonly gLift: Int32Array;
  private readonly gQueueT: Float64Array;
  private readonly gRiders: Int32Array;
  private readonly gUntil: Float64Array;
  private readonly gWalk: Float32Array;
  private readonly gWalkT0: Float64Array;
  private readonly gWalkHub: Int32Array;
  /** Przejście: 0 – pieszo, 1 – zjazd wyciągiem w dół (gondola). */
  private readonly gWalkKind: Uint8Array;
  readonly gArrive: Float64Array;
  readonly gDepart: Float64Array;
  readonly gLeaving: Uint8Array;
  private readonly gReason: Uint8Array;
  private readonly gGoneT: Float64Array;
  private readonly gAvoidLift: Int32Array;
  private readonly gBreakKind: Uint8Array;
  private readonly gCrowd: Float32Array;
  private readonly gZ: Float32Array;

  // wyciągi
  /** Kolejki w punktach wsiadania (wyciąg + przystanek). */
  private readonly queues: number[][];
  private readonly qHead: Int32Array;
  /** Jadący na każdym wyciągu (dowolny przystanek → cel). */
  private readonly riders: number[][];
  private readonly rideFrom: Int16Array;
  private readonly rideTo: Int16Array;
  /** Cel jazdy grupy (indeks przystanku). */
  private readonly gDest: Int16Array;
  /** Punkty wsiadania każdego wyciągu (kolejno od dołu). */
  private readonly liftBoardings: number[][];
  /** Zajętość krzesełek na odcinkach między przystankami (tylko wyciągi ze stacją pośrednią). */
  private readonly chairOcc: (Map<number, Int16Array> | null)[];
  /** Wyciąg ma z któregoś przystanku otwartą trasę w dół (albo da się zjechać nim w dół – gondola). */
  readonly liftHasDescent: Uint8Array;
  private readonly liftNextK: Float64Array;
  readonly liftOpen: Uint8Array;
  private readonly liftRunning: Uint8Array;
  readonly liftBoarded: Int32Array;
  private readonly liftBoardLog: number[][];
  private readonly liftMaxQueue: Int32Array;
  private readonly liftMaxWaitS: Float64Array;
  private readonly liftWaitSum: Float64Array;

  // trasy i sieć
  private readonly pisteGroups: number[][];
  readonly edgeCount: Int32Array;
  private readonly edgePeak: Float32Array;
  private readonly edgePersonS: Float64Array;
  private readonly edgeSnow: Float32Array;
  private readonly edgePowder: Float32Array;
  private readonly edgeBad: Float32Array;
  /** Udział próbek odcinka ze zbyt cienką bazą (skala ≥ 0,3). */
  private readonly edgeThin: Float32Array;
  private readonly best: Float64Array;
  private readonly exitDist: Float64Array;
  private readonly foodReach: Uint8Array;
  private readonly sk: number;

  // śnieg, pogoda, ruch
  private snow: GuestSnow | null = null;
  private cond: GuestConditions | null = null;
  /** Przejazdy przez komórki dziś (≈ liczba narciarzy przecinających komórkę). */
  readonly passes: Float32Array;
  /** Natężenie ruchu teraz (zanikające, do nakładki) [przejazdy/h]. */
  readonly recentTraffic: Float32Array;
  private readonly touched: Int32Array;
  private touchedCount = 0;
  private readonly touchedFlag: Uint8Array;
  private nextDecayT: number;

  readonly events: GuestEvent[] = [];
  /** Ile razy grupa zrezygnowała z kolejki na rzecz innego wyciągu (statystyka, testy). */
  queueSwitches = 0;
  /** Uszkodzenia sprzętu na zbyt cienkiej bazie (suma dnia). */
  damageCount = 0;
  private needsAccS = 0;
  private eventsSent = 0;
  private readonly hourly: GuestDayReport['hourly'] = [];
  private nextHourT: number;

  constructor(net: GuestNet, p: GuestParams, o: GuestDayOptions) {
    this.net = net;
    this.p = p;
    this.date = o.date;
    this.elev = o.elevationM;
    this.cell = net.cellSizeM;
    this.wCells = net.widthCells;
    this.hCells = net.heightCells;
    this.openS = p.operation.liftsOpenH * 3600;
    this.closeS = p.operation.liftsCloseH * 3600;
    this.t = Math.min(p.scenario.arrivalMinH * 3600, this.openS);
    this.nextDecayT = this.t + 60;
    this.nextHourT = Math.ceil(this.t / 3600) * 3600;
    this.rng = new Rng(o.seed).fork(`goscie-${o.date.year}-${o.date.month}-${o.date.day}`);
    const cells = net.widthCells * net.heightCells;
    this.passes = new Float32Array(cells);
    this.recentTraffic = new Float32Array(cells);
    this.touched = new Int32Array(cells);
    this.touchedFlag = new Uint8Array(cells);

    // ---- skład gości i grup
    const groups: { type: number; members: { skill: number; child: boolean }[] }[] = [];
    const typeShares = p.types.map((t) => t.share);
    const skillShares = p.skills.map((s) => s.share);
    const pick = (w: number[]) => {
      const total = w.reduce((a, b) => a + b, 0);
      let r = this.rng.next() * total;
      for (let i = 0; i < w.length; i++) {
        r -= w[i];
        if (r < 0) return i;
      }
      return w.length - 1;
    };
    const target = net.lifts.length > 0 && net.entryHubs.length > 0 ? Math.max(0, Math.round(o.guests)) : 0;
    let total = 0;
    while (total < target) {
      const ti = pick(typeShares);
      const t = p.types[ti];
      const size = Math.min(target - total, this.rng.int(t.groupMin, t.groupMax + 1));
      const members: { skill: number; child: boolean }[] = [];
      if (t.id === 'family') {
        const parent = pick(skillShares);
        for (let k = 0; k < size; k++) {
          const isChild = k >= (size >= 4 ? 2 : 1);
          members.push({ skill: isChild ? Math.max(0, parent - p.traits.childSkillDrop) : k === 1 ? pick(skillShares) : parent, child: isChild });
        }
      } else if (t.id === 'school') {
        const limited = skillShares.map((s, i) => (i <= p.traits.schoolMaxSkill ? s : 0));
        for (let k = 0; k < size; k++) members.push(k === 0 ? { skill: p.skills.length - 2, child: false } : { skill: pick(limited), child: true });
      } else {
        for (let k = 0; k < size; k++) members.push({ skill: pick(skillShares), child: false });
      }
      groups.push({ type: ti, members });
      total += size;
    }
    this.n = total;
    this.g = groups.length;
    const N = this.n;
    const G = this.g;
    this.grp = new Int32Array(N);
    this.skill = new Uint8Array(N);
    this.board = new Uint8Array(N);
    this.child = new Uint8Array(N);
    this.jacket = new Uint8Array(N);
    this.patienceS = new Float32Array(N);
    this.prefLong = new Float32Array(N);
    this.prefPowder = new Float32Array(N);
    this.prefQuiet = new Float32Array(N);
    this.hunger = new Float32Array(N);
    this.fatigue = new Float32Array(N);
    this.cold = new Float32Array(N);
    this.mstate = new Uint8Array(N);
    this.joinT = new Float64Array(N);
    this.rideT = new Float64Array(N);
    this.rideFrom = new Int16Array(N);
    this.rideTo = new Int16Array(N);
    this.skiS = new Float64Array(N);
    this.queueS = new Float64Array(N);
    this.snowAcc = new Float64Array(N);
    this.snowTime = new Float64Array(N);
    this.crowdAcc = new Float64Array(N);
    this.crowdTime = new Float64Array(N);
    this.weatherAcc = new Float64Array(N);
    this.weatherTime = new Float64Array(N);
    this.matchAcc = new Float64Array(N);
    this.matchLen = new Float64Array(N);
    this.runs = new Int32Array(N);
    this.liftRides = new Int32Array(N);
    this.distanceM = new Float64Array(N);
    this.verticalM = new Float64Array(N);
    this.accident = new Uint8Array(N);
    this.damage = new Uint8Array(N);
    this.rating = new Uint8Array(N);
    this.gStart = new Int32Array(G);
    this.gCount = new Int32Array(G);
    this.gType = new Uint8Array(G);
    this.gSkill = new Uint8Array(G);
    this.gState = new Uint8Array(G);
    this.gHub = new Int32Array(G).fill(-1);
    this.gEdge = new Int32Array(G).fill(-1);
    this.gS = new Float64Array(G);
    this.gV = new Float32Array(G);
    this.gLane = new Float32Array(G);
    this.gTurn = new Float32Array(G);
    this.gPhi = new Float32Array(G);
    this.gLift = new Int32Array(G).fill(-1);
    this.gDest = new Int16Array(G);
    this.gQueueT = new Float64Array(G);
    this.gRiders = new Int32Array(G);
    this.gUntil = new Float64Array(G);
    this.gWalk = new Float32Array(G * 4);
    this.gWalkT0 = new Float64Array(G);
    this.gWalkHub = new Int32Array(G).fill(-1);
    this.gWalkKind = new Uint8Array(G);
    this.gArrive = new Float64Array(G);
    this.gDepart = new Float64Array(G);
    this.gLeaving = new Uint8Array(G);
    this.gReason = new Uint8Array(G);
    this.gGoneT = new Float64Array(G);
    this.gAvoidLift = new Int32Array(G).fill(-1);
    this.gBreakKind = new Uint8Array(G);
    this.gCrowd = new Float32Array(G);
    this.gZ = new Float32Array(G);
    const sc = p.scenario;
    let idx = 0;
    groups.forEach((gr, gi) => {
      this.gStart[gi] = idx;
      this.gCount[gi] = gr.members.length;
      this.gType[gi] = gr.type;
      const arrive = Math.min(sc.arrivalMaxH, Math.max(sc.arrivalMinH, this.rng.normal(sc.arrivalMeanH, sc.arrivalSdH)));
      const stay = Math.max(sc.stayMinH, this.rng.normal(sc.stayMeanH, sc.staySdH));
      this.gArrive[gi] = arrive * 3600;
      this.gDepart[gi] = (arrive + stay) * 3600;
      this.gHub[gi] = -1;
      const boardType = p.types[gr.type].snowboard;
      let minSkill = 99;
      for (const m of gr.members) {
        this.grp[idx] = gi;
        this.skill[idx] = m.skill;
        this.child[idx] = m.child ? 1 : 0;
        this.board[idx] = boardType ? 1 : 0;
        this.jacket[idx] = this.rng.int(0, 8);
        this.patienceS[idx] = 60 * Math.max(p.traits.patienceMinMin, this.rng.normal(p.traits.patienceMeanMin, p.traits.patienceSdMin));
        this.prefLong[idx] = this.rng.next();
        this.prefPowder[idx] = this.rng.next();
        this.prefQuiet[idx] = this.rng.next();
        minSkill = Math.min(minSkill, m.skill);
        idx++;
      }
      this.gSkill[gi] = minSkill;
    });

    // ---- wyciągi
    const L = net.lifts.length;
    this.queues = net.boardings.map(() => []);
    this.qHead = new Int32Array(net.boardings.length);
    this.riders = net.lifts.map(() => []);
    this.liftBoardings = net.lifts.map(() => []);
    net.boardings.forEach((b, i) => this.liftBoardings[b.lift].push(i));
    this.chairOcc = net.lifts.map((l) => (l.stops.length > 2 ? new Map<number, Int16Array>() : null));
    this.liftHasDescent = new Uint8Array(L);
    net.lifts.forEach((l, i) => {
      const open = l.stops.slice(1).some((st) => net.hubs[net.nodes[st.node].hub].outEdges.some((e) => !net.pistes[net.edges[e].piste].closed));
      this.liftHasDescent[i] = open || l.downhillRiding ? 1 : 0;
    });
    this.liftNextK = new Float64Array(L);
    for (let l = 0; l < L; l++) this.liftNextK[l] = Math.floor(this.t / net.lifts[l].intervalS) + 1;
    this.liftOpen = new Uint8Array(L);
    this.liftRunning = new Uint8Array(L);
    this.liftBoarded = new Int32Array(L);
    this.liftBoardLog = net.lifts.map(() => []);
    this.liftMaxQueue = new Int32Array(L);
    this.liftMaxWaitS = new Float64Array(L);
    this.liftWaitSum = new Float64Array(L);

    // ---- trasy
    this.pisteGroups = net.pistes.map(() => []);
    const E = net.edges.length;
    this.edgeCount = new Int32Array(E);
    this.edgePeak = new Float32Array(E);
    this.edgePersonS = new Float64Array(E);
    this.edgeSnow = new Float32Array(E).fill(0.8);
    this.edgePowder = new Float32Array(E);
    this.edgeBad = new Float32Array(E);
    this.edgeThin = new Float32Array(E);
    this.sk = p.skills.length;
    const H = net.hubs.length;
    this.best = new Float64Array(H * this.sk);
    this.exitDist = new Float64Array(H * this.sk);
    this.foodReach = new Uint8Array(H * this.sk);
    this.computeRouting();
    // Parking (miejsce przyjazdu): taki, z którego grupa dojdzie do wyciągu na swój poziom.
    for (let gi = 0; gi < G; gi++) {
      const s = this.gSkill[gi];
      const ok = net.entryHubs.filter((h) => this.walkTarget(h, s) >= 0);
      const list = ok.length ? ok : net.entryHubs;
      this.gHub[gi] = list[this.rng.int(0, list.length)];
    }
  }

  /** Najbliższe miejsce (to samo lub w zasięgu spaceru) z wyciągiem, którym grupa może wjechać; −1 – brak. */
  walkTarget(h: number, s: number, onlyOpen = false): number {
    const hubs = this.net.hubs;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < hubs.length; i++) {
      if (!hubs[i].boardings.some((b) => this.liftHasDescent[this.liftOf(b)] === 1 && !this.net.lifts[this.liftOf(b)].closed && this.liftAllowed(b, s) && (!onlyOpen || this.liftOpen[this.liftOf(b)]))) continue;
      const d = Math.hypot(hubs[i].xM - hubs[h].xM, hubs[i].yM - hubs[h].yM);
      if (d < bestD && (i === h || d <= this.p.operation.maxWalkM)) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // ------------------------------------------------------------ trasowanie (stałe w ciągu dnia)

  private edgeAllowed(e: number, s: number): boolean {
    const edge = this.net.edges[e];
    return !this.net.pistes[edge.piste].closed && edge.classIndex <= this.p.skills[s].maxClass;
  }

  /**
   * Programowanie dynamiczne po zjazdach: najlepsza wartość zjazdu z miejsca, odległość do wyjścia,
   * dostęp do jedzenia. Zjazd może się kończyć w bazie albo przy wyciągu, którym grupa może wjechać
   * (a z jego góry ma zjazd na swój poziom) – liczone do ustalenia się wyniku.
   */
  private computeRouting(): void {
    const { hubs, edges, nodes, lifts } = this.net;
    const H = hubs.length;
    const S = this.sk;
    const c = this.p.choice;
    for (let s = 0; s < S; s++) {
      const stopOk = hubs.map((h) => h.exit || h.boardings.length > 0);
      for (let iter = 0; iter < H + 2; iter++) {
        const done = new Uint8Array(H);
        const visiting = new Uint8Array(H);
        const best = (h: number): number => {
          if (done[h]) return this.best[h * S + s];
          visiting[h] = 1;
          let v = stopOk[h] ? 0 : -Infinity;
          let ed = hubs[h].exit ? 0 : Infinity;
          let food = hubs[h].food ? 1 : 0;
          for (const e of hubs[h].outEdges) {
            if (!this.edgeAllowed(e, s)) continue;
            const th = nodes[edges[e].to].hub;
            if (visiting[th]) continue;
            const r = best(th);
            const val = (edges[e].lengthM / c.lengthRefM) * classMatch(edges[e].classIndex, this.p.skills[s], c);
            if (r > -Infinity) v = Math.max(v, val + r);
            ed = Math.min(ed, edges[e].lengthM + this.exitDist[th * S + s]);
            if (this.foodReach[th * S + s]) food = 1;
          }
          visiting[h] = 0;
          done[h] = 1;
          this.best[h * S + s] = v;
          this.exitDist[h * S + s] = ed;
          this.foodReach[h * S + s] = food;
          return v;
        };
        for (let h = 0; h < H; h++) best(h);
        let changed = false;
        for (let h = 0; h < H; h++) {
          const ok = hubs[h].exit || hubs[h].boardings.some((b) => {
            const bd = this.net.boardings[b];
            const lift = lifts[bd.lift];
            return !lift.closed && lift.stops.some((st, d) => d > bd.stop && this.best[nodes[st.node].hub * S + s] > -Infinity);
          });
          if (ok !== stopOk[h]) {
            stopOk[h] = ok;
            changed = true;
          }
        }
        if (!changed) break;
      }
    }
  }

  /** Czy gość o umiejętności s może wsiąść w punkcie b (z któregoś wyższego przystanku jest zjazd w jego zasięgu). */
  liftAllowed(b: number, s: number): boolean {
    const bd = this.net.boardings[b];
    const lift = this.net.lifts[bd.lift];
    for (let d = bd.stop + 1; d < lift.stops.length; d++) if (this.best[this.net.nodes[lift.stops[d].node].hub * this.sk + s] > -Infinity) return true;
    return false;
  }

  // ------------------------------------------------------------ wejście

  setConditions(c: GuestConditions): void {
    this.cond = c;
  }

  setSnow(s: GuestSnow): void {
    this.snow = s;
    // Stan śniegu na odcinkach tras (do wyborów): średnia ocena, udział puchu i złego śniegu.
    const { edges, pistes } = this.net;
    const scores = this.p.satisfaction.snowScoreByQuality;
    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e];
      const pp = pistes[edge.piste];
      let n = 0;
      let sum = 0;
      let powder = 0;
      let bad = 0;
      let thin = 0;
      for (let i = 0; i < pp.distM.length; i++) {
        if (pp.distM[i] < edge.fromM || pp.distM[i] > edge.toM) continue;
        const ck = this.cellAt(pp.xM[i], pp.yM[i]);
        const q = s.quality[ck] ?? 0;
        if (s.thin && s.thin[ck] >= 0.3) thin++;
        sum += scores[q];
        if (q === Q_POWDER) powder++;
        if (q === Q_ICY || q === Q_SLUSH || q === Q_THIN || q === Q_NONE) bad++;
        n++;
      }
      this.edgeSnow[e] = n ? sum / n : 0.8;
      this.edgePowder[e] = n ? powder / n : 0;
      this.edgeBad[e] = n ? bad / n : 0;
      this.edgeThin[e] = n ? thin / n : 0;
    }
  }

  private cellAt(x: number, y: number): number {
    const i = Math.min(this.wCells - 1, Math.max(0, Math.floor(x / this.cell)));
    const j = Math.min(this.hCells - 1, Math.max(0, Math.floor(y / this.cell)));
    return j * this.wCells + i;
  }

  private tempAt(z: number): number {
    const c = this.cond;
    if (!c) return -3;
    const span = c.topElevM - c.bottomElevM || 1;
    return c.tempBottomC + ((z - c.bottomElevM) / span) * (c.tempTopC - c.tempBottomC);
  }

  private windAt(z: number): number {
    const c = this.cond;
    if (!c) return 3;
    const span = c.topElevM - c.bottomElevM || 1;
    return Math.max(0, c.windBottomMs + ((z - c.bottomElevM) / span) * (c.windTopMs - c.windBottomMs));
  }

  // ------------------------------------------------------------ krok

  get done(): boolean {
    if (this.t < this.closeS) return false;
    for (let g = 0; g < this.g; g++) if (this.gState[g] !== G_GONE && this.gState[g] !== G_NOT_ARRIVED) return false;
    return true;
  }

  /** Symulacja do chwili timeS (kroki o stałej długości). */
  advanceTo(timeS: number, maxSteps = Infinity): void {
    const dt = this.p.operation.stepS;
    let k = 0;
    while (this.t + dt <= timeS + 1e-9 && k < maxSteps) {
      this.step(dt);
      k++;
    }
  }

  step(dt: number): void {
    const t0 = this.t;
    const t1 = t0 + dt;
    this.t = t1;
    this.updateLifts(t0, t1);
    // Kolejność stała (indeksy) – determinizm.
    for (let g = 0; g < this.g; g++) {
      const st = this.gState[g];
      if (st === G_GONE) continue;
      if (st === G_NOT_ARRIVED) {
        if (this.gArrive[g] <= t1) this.arrive(g);
        continue;
      }
      if (st === G_WALK) {
        if (t1 >= this.gUntil[g]) {
          const h = this.gWalkHub[g];
          if (h < 0) this.goHome(g, this.gReason[g]);
          else {
            this.gHub[g] = h;
            this.decide(g, h);
          }
        }
      } else if (st === G_QUEUE) {
        this.checkQueue(g, t1);
      } else if (st === G_BREAK || st === G_REST) {
        if (t1 >= this.gUntil[g]) {
          if (this.gBreakKind[g] === BREAK_LUNCH) for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) this.hunger[i] = 0;
          this.decide(g, this.gHub[g]);
        }
      }
    }
    // Ruch po trasach (z unikaniem innych): listy grup na trasach posortowane wzdłuż osi.
    for (const list of this.pisteGroups) list.length = 0;
    for (let g = 0; g < this.g; g++) if (this.gState[g] === G_PISTE) this.pisteGroups[this.net.edges[this.gEdge[g]].piste].push(g);
    for (const list of this.pisteGroups) if (list.length > 1) list.sort((a, b) => this.gS[a] - this.gS[b] || a - b);
    for (let pi = 0; pi < this.pisteGroups.length; pi++) {
      const list = this.pisteGroups[pi];
      for (let k = list.length - 1; k >= 0; k--) this.moveOnPiste(list[k], list, k, dt);
    }
    // Potrzeby (głód, zmęczenie, zimno, pogoda) zmieniają się powoli – liczone co NEEDS_STEP_S.
    this.needsAccS += dt;
    if (this.needsAccS >= NEEDS_STEP_S - 1e-9) {
      this.updateNeeds(this.needsAccS);
      this.needsAccS = 0;
    }
    if (t1 >= this.nextDecayT) this.decayTraffic();
    if (t1 >= this.nextHourT) {
      const c = this.counts();
      let wait = 0;
      let nl = 0;
      for (let l = 0; l < this.net.lifts.length; l++) if (this.liftOpen[l]) {
        wait += this.waitEstimateS(this.liftBoardings[l][0]);
        nl++;
      }
      this.hourly.push({ hour: Math.round(this.nextHourT / 3600), onHill: c.onHill, inQueue: c.inQueue, meanWaitMin: nl ? wait / nl / 60 : 0 });
      this.nextHourT += 3600;
    }
  }

  // ------------------------------------------------------------ wyciągi

  /** Wyciąg punktu wsiadania b. */
  private liftOf(b: number): number {
    return this.net.boardings[b].lift;
  }

  /** Przewidywany czas czekania w kolejce w punkcie wsiadania b [s]. */
  waitEstimateS(b: number): number {
    const lift = this.net.lifts[this.liftOf(b)];
    const len = this.queues[b].length - this.qHead[b];
    return Math.ceil(len / lift.seats) * lift.intervalS;
  }

  /** Długość kolejki do wyciągu l (wszystkie przystanki) [os.]. */
  queueLength(l: number): number {
    let n = 0;
    for (const b of this.liftBoardings[l]) n += this.queues[b].length - this.qHead[b];
    return n;
  }

  /** Wyciąg może pracować: nie zamknięty przez gracza, wiatr poniżej progu typu, jest otwarta trasa w dół (albo zjazd gondolą). */
  private liftWindOk(l: number): boolean {
    const lift = this.net.lifts[l];
    return !lift.closed && this.liftHasDescent[l] === 1 && this.windAt(lift.topElevM) <= lift.windLimitMs + this.p.operation.windHoldMarginMs;
  }

  /** Wyciąg przyjmuje nowych gości do kolejki (godziny pracy, wiatr, otwarte trasy). */
  private liftIsOpen(l: number, t: number): boolean {
    return t >= this.openS && t < this.closeS && this.liftWindOk(l);
  }

  /** Czy wyciąg stoi, bo z żadnego przystanku nie ma otwartej trasy w dół (i nie da się zjechać wyciągiem). */
  liftWithoutDescent(l: number): boolean {
    return this.liftHasDescent[l] === 0;
  }

  /** Wsiadanie z kolejki punktu b na krzesełko k (odjazd z dolnej stacji w chwili k·odstęp) w chwili t. */
  private boardChair(l: number, b: number, k: number, t: number, seatsFree: Int16Array | null): void {
    const lift = this.net.lifts[l];
    const q = this.queues[b];
    const from = this.net.boardings[b].stop;
    const nSeg = lift.stops.length - 1;
    let used = 0;
    while (this.qHead[b] < q.length) {
      const i = q[this.qHead[b]];
      const g = this.grp[i];
      const to = this.gDest[g];
      // Wolne miejsce na całej drodze do celu (na stacjach pośrednich jadą już ludzie z dołu).
      let ok = used < lift.seats;
      if (ok && seatsFree) for (let m = from; m < to && ok; m++) if (seatsFree[m] >= lift.seats) ok = false;
      if (!ok) break;
      this.qHead[b]++;
      used++;
      if (seatsFree) for (let m = from; m < to; m++) seatsFree[m]++;
      this.mstate[i] = M_RIDE;
      this.rideT[i] = t;
      this.rideFrom[i] = from;
      this.rideTo[i] = to;
      const waited = t - this.joinT[i];
      this.queueS[i] += waited;
      this.liftWaitSum[l] += waited;
      if (waited > this.liftMaxWaitS[l]) this.liftMaxWaitS[l] = waited;
      this.liftBoarded[l]++;
      this.liftBoardLog[l].push(t);
      this.riders[l].push(i);
      if (this.gState[g] === G_QUEUE) this.gState[g] = G_LIFT;
    }
    void nSeg;
    if (this.qHead[b] > 256 && this.qHead[b] * 2 > q.length) {
      q.splice(0, this.qHead[b]);
      this.qHead[b] = 0;
    }
    void k;
  }

  private updateLifts(t0: number, t1: number): void {
    const lifts = this.net.lifts;
    for (let l = 0; l < lifts.length; l++) {
      const lift = lifts[l];
      const bs = this.liftBoardings[l];
      const waiting = bs.some((b) => this.qHead[b] < this.queues[b].length);
      const windOk = this.liftWindOk(l);
      // Po zamknięciu (16:00) kolejka nie przyjmuje nowych, ale stojący wjeżdżają na górę.
      const open = windOk && t1 >= this.openS && (t1 < this.closeS || waiting);
      if (this.liftRunning[l] && !windOk) for (const b of bs) this.flushQueue(b, t1);
      this.liftRunning[l] = open ? 1 : 0;
      this.liftOpen[l] = this.liftIsOpen(l, t1) ? 1 : 0;
      const multi = lift.stops.length > 2;
      const occ = this.chairOcc[l];
      // Odjazdy krzesełek z dolnej stacji w stałym rytmie (co intervalS) – przepustowość nie do przekroczenia.
      while (this.liftNextK[l] * lift.intervalS <= t1) {
        const k = this.liftNextK[l];
        const depT = k * lift.intervalS;
        this.liftNextK[l]++;
        if (!open || depT <= t0 - lift.intervalS) continue;
        let seatsFree: Int16Array | null = null;
        if (multi && occ) {
          seatsFree = new Int16Array(lift.stops.length - 1);
          occ.set(k, seatsFree);
        }
        this.boardChair(l, bs[0], k, depT, seatsFree);
      }
      // Stacje pośrednie: krzesełka przejeżdżają w chwili k·odstęp + droga/prędkość – wsiadanie na wolne miejsca.
      if (multi && occ && open) {
        for (let j = 1; j < bs.length; j++) {
          const b = bs[j];
          const st = this.net.boardings[b].stop;
          const offS = lift.stops[st].slopeM / lift.speedMs;
          let k = Math.floor((t0 - offS) / lift.intervalS) + 1;
          for (; k * lift.intervalS + offS <= t1; k++) {
            if (this.qHead[b] >= this.queues[b].length) break;
            let seatsFree = occ.get(k);
            if (!seatsFree) {
              seatsFree = new Int16Array(lift.stops.length - 1);
              occ.set(k, seatsFree);
            }
            this.boardChair(l, b, k, k * lift.intervalS + offS, seatsFree);
          }
        }
        // Zapominamy krzesełka, które już dojechały na górę.
        const doneK = Math.floor((t1 - lift.rideS) / lift.intervalS);
        for (const key of occ.keys()) if (key < doneK) occ.delete(key);
      }
      // Przyjazdy na przystanek docelowy.
      const r = this.riders[l];
      let w = 0;
      for (let x = 0; x < r.length; x++) {
        const i = r[x];
        const arrive = this.rideT[i] + (lift.stops[this.rideTo[i]].slopeM - lift.stops[this.rideFrom[i]].slopeM) / lift.speedMs;
        if (arrive > t1) {
          r[w++] = i;
          continue;
        }
        this.mstate[i] = M_TOP;
        this.liftRides[i]++;
        const g = this.grp[i];
        if (--this.gRiders[g] === 0) {
          for (let m = this.gStart[g]; m < this.gStart[g] + this.gCount[g]; m++) this.mstate[m] = M_NONE;
          const dest = this.net.nodes[lift.stops[this.gDest[g]].node].hub;
          this.gHub[g] = dest;
          this.gLift[g] = -1;
          this.decide(g, dest);
        }
      }
      r.length = w;
      const ql = this.queueLength(l);
      if (ql > this.liftMaxQueue[l]) this.liftMaxQueue[l] = ql;
      const log = this.liftBoardLog[l];
      let cut = 0;
      while (cut < log.length && log[cut] < t1 - UTIL_WINDOW_S) cut++;
      if (cut > 0) log.splice(0, cut);
    }
  }

  /**
   * Wyciąg stanął (wiatr, zamknięcie przez gracza) – kolejka się rozchodzi. Grupy, których część
   * już jedzie, dosiadają się do ostatnich krzesełek przed zatrzymaniem (grupa się nie rozdziela).
   */
  private flushQueue(b: number, t: number): void {
    const l = this.liftOf(b);
    const q = this.queues[b];
    const groups = new Set<number>();
    for (let k = this.qHead[b]; k < q.length; k++) groups.add(this.grp[q[k]]);
    for (const g of groups) {
      if (this.gState[g] === G_QUEUE) {
        this.leaveQueue(g);
        this.gAvoidLift[g] = b;
        this.decide(g, this.gHub[g]);
        continue;
      }
      const from = this.gStart[g];
      const to = from + this.gCount[g];
      let w = this.qHead[b];
      for (let k = this.qHead[b]; k < q.length; k++) {
        const i = q[k];
        if (i >= from && i < to) {
          this.mstate[i] = M_RIDE;
          this.rideT[i] = t;
          this.rideFrom[i] = this.net.boardings[b].stop;
          this.rideTo[i] = this.gDest[g];
          this.queueS[i] += t - this.joinT[i];
          this.riders[l].push(i);
        } else q[w++] = i;
      }
      q.length = w;
    }
  }

  private joinQueue(g: number, b: number, dest: number): void {
    const q = this.queues[b];
    for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) {
      q.push(i);
      this.joinT[i] = this.t;
      this.mstate[i] = M_QUEUE;
    }
    this.gState[g] = G_QUEUE;
    this.gLift[g] = b;
    this.gDest[g] = dest;
    this.gQueueT[g] = this.t;
    this.gRiders[g] = this.gCount[g];
  }

  private leaveQueue(g: number): void {
    const b = this.gLift[g];
    const q = this.queues[b];
    const from = this.gStart[g];
    const to = from + this.gCount[g];
    let w = this.qHead[b];
    for (let k = this.qHead[b]; k < q.length; k++) {
      const i = q[k];
      if (i >= from && i < to) {
        this.queueS[i] += this.t - this.joinT[i];
        this.mstate[i] = M_NONE;
      } else q[w++] = i;
    }
    q.length = w;
    this.gLift[g] = -1;
    this.gState[g] = G_REST; // stan przejściowy – zaraz decyzja
  }

  /** Punkt wsiadania otwarty i z celem w zasięgu grupy. */
  private boardingUsable(b: number, s: number): boolean {
    return this.liftOpen[this.liftOf(b)] === 1 && this.liftAllowed(b, s);
  }

  /** Cierpliwość: zbyt długie czekanie – grupa idzie do innego wyciągu (jeśli jest). */
  private checkQueue(g: number, t: number): void {
    let patience = Infinity;
    for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) patience = Math.min(patience, this.patienceS[i]);
    if (t - this.gQueueT[g] <= patience) return;
    const b = this.gLift[g];
    const h = this.gHub[g];
    // Inny otwarty wyciąg w tym miejscu z krótszą kolejką?
    const other = this.net.hubs[h].boardings.some((o) => o !== b && this.boardingUsable(o, this.gSkill[g]) && this.waitEstimateS(o) < this.waitEstimateS(b) * 0.6);
    if (!other) {
      // Brak innego wyciągu tutaj: czeka dalej, ale do czasu – potem inne miejsce albo do domu.
      if (t - this.gQueueT[g] <= patience * this.p.traits.giveUpFactor) return;
      this.leaveQueue(g);
      const hub = this.net.hubs[h];
      let walk = -1;
      let walkD = Infinity;
      this.net.hubs.forEach((o, i) => {
        if (i === h || !o.boardings.some((x) => this.boardingUsable(x, this.gSkill[g]) && this.waitEstimateS(x) < this.waitEstimateS(b) * 0.5)) return;
        const d = Math.hypot(o.xM - hub.xM, o.yM - hub.yM);
        if (d <= this.p.operation.maxWalkM && d < walkD) {
          walkD = d;
          walk = i;
        }
      });
      if (walk >= 0) this.startWalk(g, hub.xM, hub.yM, this.net.hubs[walk].xM, this.net.hubs[walk].yM, walk);
      else {
        this.gLeaving[g] = 1;
        this.gReason[g] = R_QUEUES;
        this.headHome(g, h);
      }
      return;
    }
    this.leaveQueue(g);
    this.gAvoidLift[g] = b;
    this.queueSwitches++;
    this.decide(g, h);
  }

  // ------------------------------------------------------------ decyzje

  private arrive(g: number): void {
    const h = this.gHub[g];
    const hub = this.net.hubs[h];
    // Z parkingu do wyciągu na poziom grupy (ten sam lub w zasięgu spaceru).
    const target = this.walkTarget(h, this.gSkill[g]);
    if (target < 0 || target === h) {
      this.decide(g, h);
      return;
    }
    this.startWalk(g, hub.xM, hub.yM, this.net.hubs[target].xM, this.net.hubs[target].yM, target);
  }

  private startWalk(g: number, x0: number, y0: number, x1: number, y1: number, toHub: number): void {
    this.gState[g] = G_WALK;
    const w = this.gWalk;
    w[g * 4] = x0;
    w[g * 4 + 1] = y0;
    w[g * 4 + 2] = x1;
    w[g * 4 + 3] = y1;
    this.gWalkT0[g] = this.t;
    this.gUntil[g] = this.t + Math.hypot(x1 - x0, y1 - y0) / Math.max(0.1, this.p.operation.walkSpeedMs);
    this.gWalkHub[g] = toHub;
    this.gWalkKind[g] = 0;
  }

  /** Zjazd wyciągiem w dół (gondola) z przystanku tutaj do dolnej stacji; false – nie ma takiej możliwości. */
  private rideDown(g: number, h: number): boolean {
    for (const dh of this.net.hubs[h].downhill) {
      const lift = this.net.lifts[dh.lift];
      if (!this.liftOpen[dh.lift] && !(this.t >= this.closeS && this.liftHasDescent[dh.lift])) continue;
      const from = lift.stops[dh.stop];
      const to = lift.stops[0];
      this.gState[g] = G_WALK;
      const w = this.gWalk;
      w[g * 4] = from.xM;
      w[g * 4 + 1] = from.yM;
      w[g * 4 + 2] = to.xM;
      w[g * 4 + 3] = to.yM;
      this.gWalkT0[g] = this.t;
      this.gUntil[g] = this.t + (from.slopeM - to.slopeM) / lift.speedMs;
      this.gWalkHub[g] = this.net.nodes[to.node].hub;
      this.gWalkKind[g] = 1;
      return true;
    }
    return false;
  }

  private goHome(g: number, reason: number): void {
    if (this.gState[g] === G_QUEUE && this.gLift[g] >= 0) this.leaveQueue(g);
    if (this.gState[g] === G_PISTE && this.gEdge[g] >= 0) this.edgeCount[this.gEdge[g]] -= this.gCount[g];
    this.gState[g] = G_GONE;
    this.gReason[g] = reason;
    this.gGoneT[g] = this.t;
    for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) this.rating[i] = ratingFromSatisfaction(this.satisfaction(i));
  }

  private wantsToLeave(g: number): number {
    if (this.gLeaving[g]) return this.gReason[g];
    if (this.t >= this.closeS) return R_CLOSE;
    if (this.t >= this.gDepart[g]) return R_PLAN;
    for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) {
      if (this.fatigue[i] >= this.p.needs.fatigueLeave) return R_FATIGUE;
      if (this.cold[i] >= this.p.needs.coldLeave) return R_COLD;
    }
    return -1;
  }

  /** Decyzja w miejscu h: przerwa, wyjazd, wyciąg albo zjazd (softmax z oceną opcji). */
  private decide(g: number, h: number): void {
    this.gHub[g] = h;
    const hub = this.net.hubs[h];
    const s = this.gSkill[g];
    const n = this.p.needs;
    const leave = this.wantsToLeave(g);
    if (leave >= 0) {
      this.gLeaving[g] = 1;
      this.gReason[g] = leave;
      this.headHome(g, h);
      return;
    }
    let hungry = false;
    let cold = false;
    let tired = false;
    for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) {
      if (this.hunger[i] >= n.lunchThreshold) hungry = true;
      if (this.cold[i] >= n.coldBreakThreshold) cold = true;
      if (this.fatigue[i] >= n.restThreshold) tired = true;
    }
    if ((hungry || cold) && hub.food) {
      this.startBreak(g, hungry ? BREAK_LUNCH : BREAK_WARM, hungry ? n.lunchMin : n.restMin);
      return;
    }
    if (tired) {
      if (hub.food) this.startBreak(g, BREAK_REST, n.restMin);
      else {
        this.gState[g] = G_REST;
        this.gBreakKind[g] = BREAK_REST;
        this.gUntil[g] = this.t + n.restMin * 60;
      }
      return;
    }
    const c = this.p.choice;
    const S = this.sk;
    const leader = this.gStart[g];
    let patience = Infinity;
    for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) patience = Math.min(patience, this.patienceS[i]);
    const opts: { kind: 0 | 1; id: number; score: number; dest?: number }[] = [];
    for (const b of hub.boardings) {
      const bd = this.net.boardings[b];
      const lift = this.net.lifts[bd.lift];
      if (!this.liftOpen[bd.lift] || b === this.gAvoidLift[g]) continue;
      const waitMin = this.waitEstimateS(b) / 60;
      // Cel: każdy wyższy przystanek (stacja pośrednia albo górna), z którego jest zjazd na poziom grupy.
      for (let d = bd.stop + 1; d < lift.stops.length; d++) {
        const top = this.net.nodes[lift.stops[d].node].hub;
        if (this.best[top * S + s] === -Infinity) continue;
        let score = this.best[top * S + s] - c.queuePenaltyPerMin * waitMin - (waitMin * 60 > patience ? c.overPatiencePenalty : 0);
        if ((hungry || cold) && (this.net.hubs[top].food || this.foodReach[top * S + s])) score += c.foodBonus;
        opts.push({ kind: 0, id: b, score, dest: d });
      }
    }
    for (const e of hub.outEdges) {
      if (!this.edgeAllowed(e, s)) continue;
      const th = this.net.nodes[this.net.edges[e].to].hub;
      const rest = this.best[th * S + s];
      if (rest === -Infinity) continue;
      let score = this.edgeValue(e, s, leader) + rest;
      if ((hungry || cold) && this.foodReach[th * S + s]) score += c.foodBonus;
      opts.push({ kind: 1, id: e, score });
    }
    this.gAvoidLift[g] = -1;
    if (opts.length === 0) {
      // Przed otwarciem albo gdy wyciąg stoi przez wiatr – czekamy na miejscu.
      const waitable = hub.boardings.some((b) => !this.net.lifts[this.liftOf(b)].closed && this.liftHasDescent[this.liftOf(b)] === 1 && this.liftAllowed(b, s));
      if (waitable && this.t < this.closeS) {
        this.gState[g] = G_REST;
        this.gBreakKind[g] = BREAK_REST;
        this.gUntil[g] = this.t < this.openS ? this.openS : this.t + 600;
        return;
      }
      // Na górze gondoli bez zjazdu na poziom grupy – zjazd gondolą w dół.
      if (this.rideDown(g, h)) return;
      // Nic tu dla grupy – podejście do innego wyciągu na jej poziom (jeśli blisko).
      const walk = this.t < this.closeS ? this.walkTarget(h, s, true) : -1;
      if (walk >= 0 && walk !== h) {
        this.startWalk(g, hub.xM, hub.yM, this.net.hubs[walk].xM, this.net.hubs[walk].yM, walk);
        return;
      }
      // Nic w zasięgu – zjazd do bazy albo koniec dnia.
      this.gLeaving[g] = 1;
      this.gReason[g] = this.net.lifts.some((_, l) => this.liftOpen[l]) ? (waitable ? R_PLAN : R_NOTHING) : R_WEATHER;
      this.headHome(g, h);
      return;
    }
    const choice = this.softmax(opts);
    if (choice.kind === 0) this.joinQueue(g, choice.id, choice.dest ?? this.net.lifts[this.liftOf(choice.id)].stops.length - 1);
    else this.startEdge(g, choice.id);
  }

  private softmax<T extends { score: number }>(opts: T[]): T {
    const T = Math.max(1e-3, this.p.choice.temperature);
    let max = -Infinity;
    for (const o of opts) max = Math.max(max, o.score);
    let total = 0;
    const w = opts.map((o) => {
      const x = Math.exp((o.score - max) / T);
      total += x;
      return x;
    });
    let r = this.rng.next() * total;
    for (let i = 0; i < opts.length; i++) {
      r -= w[i];
      if (r < 0) return opts[i];
    }
    return opts[opts.length - 1];
  }

  /** Ocena odcinka trasy dla grupy (umiejętność, preferencje lidera, tłok, śnieg). */
  edgeValue(e: number, s: number, leader: number): number {
    const c = this.p.choice;
    const edge = this.net.edges[e];
    const lenR = edge.lengthM / c.lengthRefM;
    const crowd = Math.min(1, (this.edgeCount[e] / Math.max(1, edge.lengthM)) * 100 / this.p.satisfaction.crowdFullPer100m);
    return (
      lenR * classMatch(edge.classIndex, this.p.skills[s], c) * (1 + c.longPreferenceWeight * (this.prefLong[leader] - 0.5)) +
      c.powderWeight * this.prefPowder[leader] * this.edgePowder[e] -
      c.quietWeight * this.prefQuiet[leader] * crowd -
      c.badSnowWeight * this.edgeBad[e] -
      this.p.thinBase.avoidWeight * this.edgeThin[e]
    );
  }

  /** Kończenie dnia: zjazd w stronę wyjścia (najkrótszą drogą w zasięgu umiejętności). */
  private headHome(g: number, h: number): void {
    const hub = this.net.hubs[h];
    if (hub.exit) {
      this.goHome(g, this.gReason[g]);
      return;
    }
    const s = this.gSkill[g];
    let bestE = -1;
    let bestD = Infinity;
    for (const e of hub.outEdges) {
      const edge = this.net.edges[e];
      if (this.net.pistes[edge.piste].closed) continue;
      const th = this.net.nodes[edge.to].hub;
      // Najpierw trasy w zasięgu umiejętności; gdy brak – każda otwarta (zjazd jakkolwiek).
      const ok = edge.classIndex <= this.p.skills[s].maxClass;
      const d = edge.lengthM + this.exitDist[th * this.sk + s] + (ok ? 0 : 1e6);
      if (d < bestD) {
        bestD = d;
        bestE = e;
      }
    }
    if (bestE >= 0 && bestD < Infinity) {
      this.startEdge(g, bestE);
      return;
    }
    // Brak zjazdu do bazy: wyciągiem w dół (gondola) lub pieszo (poza mapą gości – znika).
    if (this.rideDown(g, h)) return;
    let ex = -1;
    let exD = Infinity;
    this.net.hubs.forEach((o, i) => {
      if (!o.exit) return;
      const d = Math.hypot(o.xM - hub.xM, o.yM - hub.yM);
      if (d < exD) {
        exD = d;
        ex = i;
      }
    });
    if (ex < 0 || exD > this.p.operation.maxWalkM) {
      this.goHome(g, this.gReason[g]);
      return;
    }
    this.startWalk(g, hub.xM, hub.yM, this.net.hubs[ex].xM, this.net.hubs[ex].yM, -1);
  }

  private startBreak(g: number, kind: number, minutes: number): void {
    this.gState[g] = G_BREAK;
    this.gBreakKind[g] = kind;
    this.gUntil[g] = this.t + minutes * 60;
  }

  private startEdge(g: number, e: number): void {
    const edge = this.net.edges[e];
    const p = this.net.pistes[edge.piste];
    const m = this.p.movement;
    this.gState[g] = G_PISTE;
    this.gEdge[g] = e;
    this.gS[g] = edge.fromM;
    this.gV[g] = Math.max(this.gV[g], m.minSpeedMs);
    const w = p.widthM[axisIndex(p, edge.fromM)];
    const free = Math.max(0, w / 2 - m.lateralMarginM - m.turnAmplitudeM);
    this.gLane[g] = (this.rng.next() * 2 - 1) * free;
    this.gTurn[g] = this.rng.range(m.turnLengthMinM, m.turnLengthMaxM);
    this.gPhi[g] = this.rng.next() * Math.PI * 2;
    this.edgeCount[e] += this.gCount[g];
  }

  // ------------------------------------------------------------ ruch po trasie

  private speedTarget(g: number, p: NetPiste, idx: number, x: number, y: number): { v: number; snowScore: number; icy: boolean; thin: number } {
    const sk = this.p.skills[this.gSkill[g]];
    const m = this.p.movement;
    const slope = p.slopePercent[idx];
    let v: number;
    if (slope < m.flatSlopePercent) v = Math.max(m.minSpeedMs, sk.cruiseMs * 0.35 * Math.max(0, slope) / Math.max(1e-6, m.flatSlopePercent) + m.minSpeedMs);
    else {
      const k = slope / sk.comfortSlopePercent;
      v = sk.cruiseMs * (k < 1 ? 0.45 + 0.55 * k : Math.max(0.5, 1.2 - 0.25 * (k - 1)));
    }
    let snowScore = 0.8;
    let icy = false;
    let thin = 0;
    const sn = this.snow;
    if (sn) {
      const c = this.cellAt(x, y);
      thin = sn.thin ? sn.thin[c] : 0;
      const q = sn.quality[c];
      const sa = this.p.satisfaction;
      snowScore = sa.snowScoreByQuality[q];
      if (q === Q_ICY) {
        v *= sk.icyFactor;
        icy = true;
      } else if (q === Q_POWDER && sn.depthCm[c] > 20) v *= sk.powderFactor;
      else if (q === Q_SLUSH) v *= 0.85;
      else if (q === Q_THIN) v *= 0.75;
      else if (q === Q_NONE) v *= 0.5;
      const mog = this.mogulsAt(c, slope);
      if (mog > 0) {
        v *= 1 - (1 - sk.mogulFactor) * mog;
        const skill = this.gSkill[g];
        snowScore -= sa.mogulPenaltyBeginner * mog * (skill === 0 ? 1 : skill === 1 ? 0.5 : 0);
      }
    }
    if (thin > 0) {
      // Za cienka baza: przetarcia i kamienie – wolniej, gorsza ocena śniegu.
      const tb = this.p.thinBase;
      v *= 1 - (1 - tb.speedFactor) * thin;
      snowScore += (tb.snowScore - snowScore) * thin;
    }
    return { v: Math.max(m.minSpeedMs, v), snowScore: clamp01(snowScore), icy, thin };
  }

  /** Muldy w komórce: z poprzednich dni + rosnące od dzisiejszych przejazdów (na stromych odcinkach). */
  mogulsAt(c: number, slopePercent: number): number {
    const si = this.p.snowImpact;
    const base = this.snow?.moguls ? this.snow.moguls[c] : 0;
    const steep = slopePercent > si.mogulMinSlopePercent ? Math.min(1, (slopePercent - si.mogulMinSlopePercent) / si.mogulMinSlopePercent) : 0;
    return Math.min(1, base + (this.passes[c] / Math.max(1, si.passesToMoguls)) * steep);
  }

  /** Położenie na trasie: punkt osi w odległości s + przesunięcie w poprzek (lateral). */
  private pistePoint(p: NetPiste, s: number, lateral: number): { x: number; y: number; dx: number; dy: number; w: number; idx: number } {
    const i = axisIndex(p, s);
    const j = Math.min(p.distM.length - 1, i + 1);
    const seg = p.distM[j] - p.distM[i] || 1;
    const f = Math.min(1, Math.max(0, (s - p.distM[i]) / seg));
    const dx = (p.xM[j] - p.xM[i]) / seg;
    const dy = (p.yM[j] - p.yM[i]) / seg;
    const w = p.widthM[i] + f * (p.widthM[j] - p.widthM[i]);
    const half = Math.max(0, w / 2 - this.p.movement.lateralMarginM);
    const u = Math.max(-half, Math.min(half, lateral));
    return { x: p.xM[i] + f * (p.xM[j] - p.xM[i]) - dy * u, y: p.yM[i] + f * (p.yM[j] - p.yM[i]) + dx * u, dx, dy, w, idx: i };
  }

  /** Przesunięcie w poprzek wynikające ze slalomu. */
  private slalom(g: number, s: number): number {
    return this.p.movement.turnAmplitudeM * Math.sin((s / this.gTurn[g]) * Math.PI + this.gPhi[g]);
  }

  private moveOnPiste(g: number, list: number[], k: number, dt: number): void {
    const e = this.gEdge[g];
    const edge = this.net.edges[e];
    const p = this.net.pistes[edge.piste];
    const m = this.p.movement;
    const s = this.gS[g];
    const pt = this.pistePoint(p, s, this.gLane[g] + this.slalom(g, s));
    let { v: target, snowScore, icy, thin } = this.speedTarget(g, p, pt.idx, pt.x, pt.y);
    // Unikanie: najbliżsi przed nami na tym samym pasie – zwalniamy i odbijamy w bok.
    const lane = this.gLane[g];
    const half = Math.max(0, pt.w / 2 - m.lateralMarginM - m.turnAmplitudeM);
    for (let j = k + 1; j < list.length; j++) {
      const o = list[j];
      const ds = this.gS[o] - s;
      if (ds > m.lookAheadM) break;
      if (ds <= 0) continue;
      const du = this.gLane[o] - lane;
      if (Math.abs(du) < m.minGapM) {
        target = Math.min(target, Math.max(m.minSpeedMs, this.gV[o]));
        let dir = du >= 0 ? -1 : 1;
        if (lane + dir * m.minGapM > half || lane + dir * m.minGapM < -half) dir = -dir;
        this.gLane[g] = Math.max(-half, Math.min(half, lane + dir * Math.min(m.minGapM, 2 * dt)));
        break;
      }
    }
    // Tłok: liczba narciarzy w oknie ±50 m.
    let crowd = 0;
    for (let j = k - 1; j >= 0 && s - this.gS[list[j]] <= CROWD_HALF_WINDOW_M; j--) crowd += this.gCount[list[j]];
    for (let j = k + 1; j < list.length && this.gS[list[j]] - s <= CROWD_HALF_WINDOW_M; j++) crowd += this.gCount[list[j]];
    const per100 = (crowd / (2 * CROWD_HALF_WINDOW_M)) * 100;
    const crowdLevel = Math.min(1, per100 / this.p.satisfaction.crowdFullPer100m);
    this.gCrowd[g] = crowdLevel;
    if (per100 + this.gCount[g] > this.edgePeak[e]) this.edgePeak[e] = per100 + this.gCount[g];
    this.edgePersonS[e] += this.gCount[g] * dt;

    let v = this.gV[g] + (target - this.gV[g]) * Math.min(1, dt / 2.5);
    if (!(v > 0)) v = m.minSpeedMs;
    this.gV[g] = v;
    const ds = Math.min(v * dt, edge.toM - s + 1e-6);
    const dz = (p.slopePercent[pt.idx] / 100) * ds;
    this.gS[g] = s + ds;
    this.gZ[g] = p.elevM[pt.idx];
    // Ślad na śniegu: przejazdy przez komórkę (ułamek komórki × liczba osób).
    const c = this.cellAt(pt.x, pt.y);
    const add = (ds / this.cell) * this.gCount[g];
    this.passes[c] += add;
    this.recentTraffic[c] += add;
    if (!this.touchedFlag[c]) {
      this.touchedFlag[c] = 1;
      this.touched[this.touchedCount++] = c;
    }
    const sk = this.p.skills;
    const acc = this.p.accidents;
    const tooHard = edge.classIndex > sk[this.gSkill[g]].preferredClass;
    for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) {
      this.skiS[i] += dt;
      this.distanceM[i] += ds;
      if (dz > 0) this.verticalM[i] += dz;
      this.fatigue[i] = Math.min(1, this.fatigue[i] + (sk[this.skill[i]].fatiguePerKm * ds) / 1000);
      this.snowAcc[i] += snowScore * dt;
      this.snowTime[i] += dt;
      this.crowdAcc[i] += (1 - crowdLevel) * dt;
      this.crowdTime[i] += dt;
      // Wypadek: ryzyko na kilometr × czynniki (tłok, lód, zmęczenie, trasa za trudna).
      const risk =
        acc.basePerKm *
        (ds / 1000) *
        sk[this.skill[i]].accidentFactor *
        (1 + acc.crowdFactor * crowdLevel) *
        (icy ? acc.icyFactor : 1) *
        (1 + acc.fatigueFactor * this.fatigue[i]) *
        (tooHard ? acc.tooHardFactor : 1) *
        (1 + this.p.thinBase.accidentFactor * thin);
      // Uszkodzenie sprzętu na kamieniach (za cienka baza).
      if (thin > 0 && this.rng.next() < this.p.thinBase.damagePerKm * thin * (ds / 1000)) {
        if (this.damage[i] < 255) this.damage[i]++;
        this.damageCount++;
      }
      if (this.rng.next() < risk) {
        this.accident[i] = 1;
        const causes = [icy ? 'lód' : '', thin > 0.3 ? 'za mało śniegu (kamienie)' : '', crowdLevel > 0.5 ? 'tłok' : '', this.fatigue[i] > 0.6 ? 'zmęczenie' : '', tooHard ? 'trasa za trudna' : ''].filter(Boolean);
        this.events.push({ kind: 'accident', timeS: this.t, guest: i, xM: pt.x, yM: pt.y, place: `trasa ${p.name}`, cause: causes.join(', ') || 'upadek' });
        this.goHome(g, R_ACCIDENT);
        return;
      }
    }
    if (this.gS[g] >= edge.toM - 1e-3) {
      this.edgeCount[e] -= this.gCount[g];
      this.gEdge[g] = -1;
      const match = classMatch(edge.classIndex, sk[this.gSkill[g]], this.p.choice);
      for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) {
        this.matchAcc[i] += match * edge.lengthM;
        this.matchLen[i] += edge.lengthM;
        if (this.net.hubs[this.net.nodes[edge.to].hub].boardings.length > 0 || this.net.hubs[this.net.nodes[edge.to].hub].exit) this.runs[i]++;
      }
      this.decide(g, this.net.nodes[edge.to].hub);
    }
  }

  // ------------------------------------------------------------ potrzeby

  private weatherScore(z: number): number {
    const c = this.cond;
    if (!c) return 0.8;
    const ta = apparentTempC(this.tempAt(z), this.windAt(z));
    let s = 1;
    if (c.precipMmH > 0) s -= (c.rain ? 0.35 : 0.15) + Math.min(0.3, c.precipMmH * 0.1);
    s -= 0.3 * clamp01((this.windAt(z) - 8) / 12);
    s -= 0.25 * clamp01((this.p.needs.comfortTempC - ta) / 15);
    s -= 0.1 * c.cloud;
    return clamp01(s + 0.1);
  }

  private groupElevation(g: number): number {
    const st = this.gState[g];
    if (st === G_PISTE) return this.gZ[g];
    if (st === G_LIFT && this.gLift[g] >= 0) return this.net.lifts[this.liftOf(this.gLift[g])].topElevM;
    const h = this.gHub[g];
    if (h < 0) return this.cond?.bottomElevM ?? 0;
    const hub = this.net.hubs[h];
    const z = this.elev[this.cellAt(hub.xM, hub.yM)];
    return Number.isNaN(z) ? (this.cond?.bottomElevM ?? 0) : z;
  }

  private updateNeeds(dt: number): void {
    const n = this.p.needs;
    const c = this.cond;
    const badWeather = c ? c.rain && c.precipMmH > 0.2 || c.windTopMs > 15 : false;
    const leaveRiskWeather = (this.p.choice.badWeatherLeavePerH * dt) / 3600;
    const leaveRiskSnow = (this.p.choice.badSnowLeavePerH * dt) / 3600;
    for (let g = 0; g < this.g; g++) {
      const st = this.gState[g];
      if (st === G_GONE || st === G_NOT_ARRIVED) continue;
      const z = this.groupElevation(g);
      const inside = st === G_BREAK;
      const ta = apparentTempC(this.tempAt(z), this.windAt(z));
      const wsc = this.weatherScore(z);
      const onAerial = st === G_LIFT && this.gLift[g] >= 0 && this.net.lifts[this.liftOf(this.gLift[g])].aerial;
      for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) {
        this.hunger[i] = Math.min(1, this.hunger[i] + (n.hungerPerH * dt) / 3600);
        if (inside || st === G_REST) this.fatigue[i] = Math.max(0, this.fatigue[i] - (n.restRecoveryPerH * dt) / 3600);
        else this.fatigue[i] = Math.min(1, this.fatigue[i] + (n.fatiguePerH * dt) / 3600);
        if (inside) this.cold[i] = Math.max(0, this.cold[i] - (n.warmRecoveryPerH * dt) / 3600);
        else if (ta < n.comfortTempC) {
          const factor = onAerial && this.mstate[i] === M_RIDE ? n.liftColdFactor : 1;
          this.cold[i] = Math.min(1, this.cold[i] + (n.coldPerHPerC * (n.comfortTempC - ta) * factor * dt) / 3600);
        } else this.cold[i] = Math.max(0, this.cold[i] - (0.3 * n.warmRecoveryPerH * dt) / 3600);
        if (!inside) {
          this.weatherAcc[i] += wsc * dt;
          this.weatherTime[i] += dt;
        }
      }
      // Wcześniejszy wyjazd: zła pogoda albo zły śnieg pod nartami.
      if (!this.gLeaving[g] && st !== G_BREAK) {
        const leader = this.gStart[g];
        if (badWeather && this.rng.next() < leaveRiskWeather) {
          this.gLeaving[g] = 1;
          this.gReason[g] = R_WEATHER;
        } else if (this.snowTime[leader] > 600 && this.snowAcc[leader] / this.snowTime[leader] < 0.4 && this.rng.next() < leaveRiskSnow) {
          this.gLeaving[g] = 1;
          this.gReason[g] = R_SNOW;
        }
      }
    }
  }

  private decayTraffic(): void {
    const f = Math.exp(-(this.t - (this.nextDecayT - 60)) / RECENT_TRAFFIC_TAU_S);
    let w = 0;
    for (let k = 0; k < this.touchedCount; k++) {
      const c = this.touched[k];
      this.recentTraffic[c] *= f;
      if (this.recentTraffic[c] < 0.01) {
        this.recentTraffic[c] = 0;
        this.touchedFlag[c] = 0;
      } else this.touched[w++] = c;
    }
    this.touchedCount = w;
    this.nextDecayT = this.t + 60;
  }

  /** Natężenie ruchu [przejazdy/h] w komórkach (do nakładki). */
  trafficPerHour(): Float32Array {
    const out = new Float32Array(this.recentTraffic.length);
    const k = 3600 / RECENT_TRAFFIC_TAU_S;
    for (let i = 0; i < this.touchedCount; i++) {
      const c = this.touched[i];
      out[c] = this.recentTraffic[c] * k;
    }
    return out;
  }

  // ------------------------------------------------------------ zadowolenie

  satisfaction(i: number): number {
    const p = this.p.satisfaction;
    const base = satisfactionScore(
      {
        skiS: this.skiS[i],
        queueS: this.queueS[i] + (this.mstate[i] === M_QUEUE ? this.t - this.joinT[i] : 0),
        snowScore: this.snowTime[i] > 0 ? this.snowAcc[i] / this.snowTime[i] : 0.8,
        crowdScore: this.crowdTime[i] > 0 ? this.crowdAcc[i] / this.crowdTime[i] : 1,
        weatherScore: this.weatherTime[i] > 0 ? this.weatherAcc[i] / this.weatherTime[i] : 0.8,
        matchScore: this.matchLen[i] > 0 ? this.matchAcc[i] / this.matchLen[i] : 0.8,
        accident: this.accident[i] === 1,
      },
      p,
    );
    return Math.max(0, base - this.p.thinBase.damagePenalty * Math.min(2, this.damage[i]));
  }

  // ------------------------------------------------------------ wyjście do widoku

  counts(): GuestCounts {
    const c: GuestCounts = { planned: this.n, arrived: 0, onHill: 0, inQueue: 0, onLift: 0, onPiste: 0, inBreak: 0, gone: 0 };
    for (let g = 0; g < this.g; g++) {
      const st = this.gState[g];
      const k = this.gCount[g];
      if (st === G_NOT_ARRIVED) continue;
      c.arrived += k;
      if (st === G_GONE) c.gone += k;
      else {
        c.onHill += k;
        if (st === G_QUEUE) c.inQueue += k;
        else if (st === G_LIFT) c.onLift += k;
        else if (st === G_PISTE) c.onPiste += k;
        else if (st === G_BREAK) c.inBreak += k;
      }
    }
    return c;
  }

  /** Położenia wszystkich widocznych osób: FRAME_STRIDE liczb na osobę. Zwraca liczbę osób. */
  writeFrame(out: Float32Array): number {
    const m = this.p.movement;
    let n = 0;
    const put = (i: number, x: number, y: number, vx: number, vy: number, heading: number, kind: number, phase: number) => {
      if ((n + 1) * FRAME_STRIDE > out.length) return;
      const o = n * FRAME_STRIDE;
      out[o] = i;
      out[o + 1] = x;
      out[o + 2] = y;
      out[o + 3] = vx;
      out[o + 4] = vy;
      out[o + 5] = heading;
      out[o + 6] = kind;
      out[o + 7] = this.jacket[i] + (this.child[i] ? 16 : 0);
      out[o + 8] = phase;
      n++;
    };
    for (let g = 0; g < this.g; g++) {
      const st = this.gState[g];
      if (st === G_NOT_ARRIVED || st === G_GONE || st === G_BREAK) continue;
      if (st === G_PISTE) {
        const edge = this.net.edges[this.gEdge[g]];
        const p = this.net.pistes[edge.piste];
        const v = this.gV[g];
        for (let k = 0; k < this.gCount[g]; k++) {
          const i = this.gStart[g] + k;
          const s = Math.max(edge.fromM, this.gS[g] - k * m.groupGapM);
          const side = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2.5;
          const lat = this.gLane[g] + this.slalom(g, s) + side;
          const pt = this.pistePoint(p, s, lat);
          // Kierunek: wzdłuż osi + pochodna slalomu.
          const dl = (this.p.movement.turnAmplitudeM * Math.PI * Math.cos((s / this.gTurn[g]) * Math.PI + this.gPhi[g])) / this.gTurn[g];
          const hx = pt.dx - pt.dy * dl;
          const hy = pt.dy + pt.dx * dl;
          const hl = Math.hypot(hx, hy) || 1;
          put(i, pt.x, pt.y, (hx / hl) * v, (hy / hl) * v, Math.atan2(hy, hx), this.board[i] ? DRAW_BOARD : DRAW_SKI, 0.5 + 0.5 * Math.cos((s / this.gTurn[g]) * Math.PI + this.gPhi[g]));
        }
      } else if (st === G_WALK) {
        const w = this.gWalk;
        const dur = Math.max(1, this.gUntil[g] - this.gWalkT0[g]);
        const f = Math.min(1, (this.t - this.gWalkT0[g]) / dur);
        const dx = w[g * 4 + 2] - w[g * 4];
        const dy = w[g * 4 + 3] - w[g * 4 + 1];
        const len = Math.hypot(dx, dy) || 1;
        for (let k = 0; k < this.gCount[g]; k++) {
          const i = this.gStart[g] + k;
          const back = k * 1.5;
          const kind = this.gWalkKind[g] === 1 ? DRAW_SEATED : DRAW_WALK;
          put(i, w[g * 4] + f * dx - (dx / len) * back, w[g * 4 + 1] + f * dy - (dy / len) * back, dx / dur, dy / dur, Math.atan2(dy, dx), kind, (this.t * 0.8 + k) % 1);
        }
      } else if (st === G_QUEUE || st === G_LIFT) {
        const bq = this.gLift[g];
        if (bq < 0) continue;
        const lift = this.net.lifts[this.liftOf(bq)];
        for (let k = 0; k < this.gCount[g]; k++) {
          const i = this.gStart[g] + k;
          const ms = this.mstate[i];
          if (ms === M_RIDE) {
            const d = Math.min(lift.stops[this.rideTo[i]].slopeM, lift.stops[this.rideFrom[i]].slopeM + (this.t - this.rideT[i]) * lift.speedMs);
            const q = liftPoint(lift, d);
            const vx = q.ux * q.horizontalPerSlope * lift.speedMs;
            const vy = q.uy * q.horizontalPerSlope * lift.speedMs;
            put(i, q.x, q.y, vx, vy, Math.atan2(q.uy, q.ux), lift.aerial ? DRAW_SEATED : this.board[i] ? DRAW_BOARD : DRAW_STAND, 0);
          } else if (ms === M_TOP) {
            const dst = lift.stops[this.gDest[g]];
            const q = liftPoint(lift, dst.slopeM);
            put(i, dst.xM + q.ux * 6 - q.uy * (k - this.gCount[g] / 2) * 1.5, dst.yM + q.uy * 6 + q.ux * (k - this.gCount[g] / 2) * 1.5, 0, 0, Math.atan2(q.uy, q.ux), DRAW_STAND, 0);
          }
        }
      } else if (st === G_REST) {
        const hub = this.net.hubs[this.gHub[g]];
        for (let k = 0; k < this.gCount[g]; k++) put(this.gStart[g] + k, hub.xM + 8 + k * 1.4, hub.yM + 6, 0, 0, 0, DRAW_STAND, 0);
      }
    }
    // Kolejki: rzędy za stacją wsiadania (kolejność przybycia).
    for (let bq = 0; bq < this.net.boardings.length; bq++) {
      const bd = this.net.boardings[bq];
      const lift = this.net.lifts[bd.lift];
      const st = lift.stops[bd.stop];
      const dir = liftPoint(lift, st.slopeM + 1);
      const ux = dir.ux;
      const uy = dir.uy;
      const q = this.queues[bq];
      const row = Math.max(1, m.queueRowSize);
      // Na stacji pośredniej kolejka z boku linii (żeby nie stała pod liną).
      const side = bd.stop > 0 ? 8 : 0;
      for (let k = this.qHead[bq]; k < q.length; k++) {
        const pos = k - this.qHead[bq];
        const r = Math.floor(pos / row);
        const c = (pos % row) - (row - 1) / 2;
        const back = 4 + r * m.queueSpacingM;
        put(q[k], st.xM - ux * back - uy * (c * m.queueSpacingM + side), st.yM - uy * back + ux * (c * m.queueSpacingM + side), 0, 0, Math.atan2(uy, ux), DRAW_STAND, 0);
      }
    }
    return n;
  }

  /** Stan wyciągów: LIFT_STRIDE liczb na wyciąg. */
  writeLifts(out: Float32Array): void {
    for (let l = 0; l < this.net.lifts.length; l++) {
      const lift = this.net.lifts[l];
      const o = l * LIFT_STRIDE;
      out[o] = this.queueLength(l);
      out[o + 1] = this.waitEstimateS(this.liftBoardings[l][0]) / 60;
      const windowS = Math.min(UTIL_WINDOW_S, Math.max(1, this.t - this.openS));
      out[o + 2] = this.liftOpen[l] ? Math.min(1, this.liftBoardLog[l].length / ((lift.capacityPerHour * windowS) / 3600)) : 0;
      // 0 – pracuje, 1 – stoi (godziny, wiatr, zamknięty), 2 – stoi: brak otwartej trasy w dół.
      out[o + 3] = this.liftOpen[l] ? 0 : this.liftHasDescent[l] ? 1 : 2;
      out[o + 4] = this.riders[l].length;
      out[o + 5] = this.liftBoarded[l];
    }
  }

  /** Nowe zdarzenia od ostatniego wywołania. */
  takeEvents(): GuestEvent[] {
    const out = this.events.slice(this.eventsSent);
    this.eventsSent = this.events.length;
    return out;
  }

  report(): GuestDayReport {
    const counts = this.counts();
    let rides = 0;
    let descents = 0;
    let qSum = 0;
    let qN = 0;
    const ratings = [0, 0, 0, 0, 0];
    let rSum = 0;
    let rN = 0;
    const leaveReasons = LEAVE_REASONS.map(() => 0);
    for (let g = 0; g < this.g; g++) {
      if (this.gState[g] === G_NOT_ARRIVED) continue;
      if (this.gState[g] === G_GONE) leaveReasons[this.gReason[g]] += this.gCount[g];
      for (let i = this.gStart[g]; i < this.gStart[g] + this.gCount[g]; i++) {
        rides += this.liftRides[i];
        descents += this.runs[i];
        if (this.liftRides[i] > 0) {
          qSum += this.queueS[i] / this.liftRides[i];
          qN++;
        }
        const r = this.gState[g] === G_GONE ? this.rating[i] : ratingFromSatisfaction(this.satisfaction(i));
        ratings[r - 1]++;
        rSum += r;
        rN++;
      }
    }
    const crowdedPistes = this.net.pistes
      .map((p, pi) => {
        let peak = 0;
        let ps = 0;
        this.net.edges.forEach((e, ei) => {
          if (e.piste !== pi) return;
          peak = Math.max(peak, this.edgePeak[ei]);
          ps += this.edgePersonS[ei];
        });
        return { name: p.name, peakPer100m: peak, personHours: ps / 3600 };
      })
      .filter((x) => x.personHours > 0)
      .sort((a, b) => b.peakPer100m - a.peakPer100m)
      .slice(0, 5);
    const busiestLifts = this.net.lifts
      .map((l, i) => {
        const hours = Math.max(1 / 60, (Math.min(this.t, this.closeS) - this.openS) / 3600);
        return { name: l.name, maxQueue: this.liftMaxQueue[i], maxWaitMin: this.liftMaxWaitS[i] / 60, rides: this.liftBoarded[i], utilization: Math.min(1, this.liftBoarded[i] / (l.capacityPerHour * hours)) };
      })
      .sort((a, b) => b.maxWaitMin - a.maxWaitMin);
    return {
      date: this.date,
      timeS: this.t,
      counts,
      liftRides: rides,
      descents,
      meanQueueMin: qN ? qSum / qN / 60 : 0,
      meanRating: rN ? rSum / rN : 0,
      ratings,
      accidents: this.events.filter((e) => e.kind === 'accident'),
      equipmentDamage: this.damageCount,
      leaveReasons,
      crowdedPistes,
      busiestLifts,
      hourly: [...this.hourly],
    };
  }

  /** Karta gościa (kliknięcie na mapie). */
  card(i: number): GuestCard | null {
    if (i < 0 || i >= this.n) return null;
    const g = this.grp[i];
    const st = this.gState[g];
    const sk = this.p.skills[this.skill[i]];
    const type = this.p.types[this.gType[g]];
    const sat = this.satisfaction(i);
    let doing = '';
    let plan = '';
    const hubName = (h: number) => (h >= 0 ? this.net.hubs[h].name : '');
    if (st === G_NOT_ARRIVED) doing = `przyjedzie o ${fmtH(this.gArrive[g])}`;
    else if (st === G_GONE) doing = `wyjechał o ${fmtH(this.gGoneT[g])} – ${LEAVE_REASONS[this.gReason[g]]}`;
    else if (st === G_WALK) doing = `idzie pieszo${this.gWalkHub[g] >= 0 ? ` do: ${hubName(this.gWalkHub[g])}` : ' na parking'}`;
    else if (st === G_QUEUE) {
      const b = this.gLift[g];
      const lift = this.net.lifts[this.liftOf(b)];
      const q = this.queues[b];
      const pos = q.indexOf(i, this.qHead[b]) - this.qHead[b];
      const where = this.net.boardings[b].stop > 0 ? ' (stacja pośrednia)' : '';
      doing = `czeka w kolejce do wyciągu ${lift.name}${where} (przed nim ${Math.max(0, pos)} os., ok. ${Math.round((Math.ceil((pos + 1) / lift.seats) * lift.intervalS) / 60)} min)`;
    } else if (st === G_LIFT) {
      const lift = this.net.lifts[this.liftOf(this.gLift[g])];
      const ms = this.mstate[i];
      const dest = this.gDest[g] < lift.stops.length - 1 ? 'do stacji pośredniej' : 'na górę';
      doing = ms === M_RIDE ? `jedzie wyciągiem ${lift.name} ${dest}` : ms === M_TOP ? 'czeka na przystanku na resztę grupy' : `czeka w kolejce do wyciągu ${lift.name}`;
    } else if (st === G_PISTE) {
      const edge = this.net.edges[this.gEdge[g]];
      doing = `zjeżdża trasą ${this.net.pistes[edge.piste].name} (${Math.round(this.gV[g] * 3.6)} km/h) do: ${hubName(this.net.nodes[edge.to].hub)}`;
    } else if (st === G_BREAK) doing = `${['posiłek', 'odpoczynek', 'ogrzewa się'][this.gBreakKind[g]]} – ${hubName(this.gHub[g])}, do ${fmtH(this.gUntil[g])}`;
    else if (st === G_REST) doing = `odpoczywa na stoku do ${fmtH(this.gUntil[g])}`;
    if (st !== G_GONE && st !== G_NOT_ARRIVED) {
      if (this.gLeaving[g]) plan = `kończy dzień (${LEAVE_REASONS[this.gReason[g]]}) – zjeżdża do bazy`;
      else if (this.hunger[i] >= this.p.needs.lunchThreshold) plan = 'głodny – szuka miejsca na posiłek';
      else if (this.cold[i] >= this.p.needs.coldBreakThreshold) plan = 'zmarznięty – chce się ogrzać';
      else if (this.fatigue[i] >= this.p.needs.restThreshold) plan = 'zmęczony – zaraz odpocznie';
      else plan = `jeździ dalej; wyjazd ok. ${fmtH(this.gDepart[g])}`;
    }
    return {
      id: i,
      typeName: type.name,
      skillName: sk.name,
      snowboard: this.board[i] === 1,
      child: this.child[i] === 1,
      groupSize: this.gCount[g],
      patienceMin: this.patienceS[i] / 60,
      prefs: { long: this.prefLong[i], powder: this.prefPowder[i], quiet: this.prefQuiet[i] },
      arriveH: this.gArrive[g] / 3600,
      departH: this.gDepart[g] / 3600,
      hunger: this.hunger[i],
      fatigue: this.fatigue[i],
      cold: this.cold[i],
      satisfaction: sat,
      ratingNow: st === G_GONE ? this.rating[i] : ratingFromSatisfaction(sat),
      runs: this.runs[i],
      liftRides: this.liftRides[i],
      distanceKm: this.distanceM[i] / 1000,
      verticalM: this.verticalM[i],
      queueMin: (this.queueS[i] + (this.mstate[i] === M_QUEUE ? this.t - this.joinT[i] : 0)) / 60,
      skiMin: this.skiS[i] / 60,
      damage: this.damage[i],
      doing,
      plan,
    };
  }
}
