/**
 * Goście latem (etap 7b): grupy turystów pieszych, rodzin, rowerzystów i wycieczek szkolnych.
 * Sieć pieszych: szlaki PTTK z OSM i ścieżki gracza (czas przejścia z funkcji Toblera, osobno w górę
 * i w dół), połączone z miejscami: parkingi, stacje kolei, schroniska i szczyty, gastronomia, plac
 * zabaw, tor saneczkowy, końce tras rowerowych. Grupa decyduje w każdym miejscu: kolej w górę, spacer
 * do celu, jedzenie, tor, plac zabaw, zjazd rowerem, powrót koleją lub pieszo, wyjazd (czas, zmęczenie,
 * upał, deszcz). Kolej wozi pieszych w górę i w dół, rowery na wieszakach; burza i silny wiatr
 * zatrzymują kolej i tor. Parkingi – zajęte miejsca w każdej chwili (do pojemności). Krok 1 s,
 * deterministycznie (ziarno). Wynik dnia jak model zgrubny (SummerOutcome) + statystyki do kart.
 */
import type { PointM } from './lifts';
import { Rng } from './rng';
import type { SummerFacts, SummerOutcome, SummerPlan, SummerWeather } from './summer';
import { stormAt } from './summer';
import type { SummerParams } from './summerParams';
import { T_CYCLIST, T_FAMILY, T_HIKER, T_SCHOOL } from './summerParams';
import { formatIsoDate } from './time';
import type { CalendarDate } from './weather';

export type PoiKind = 'parking' | 'liftBottom' | 'liftTop' | 'hut' | 'peak' | 'view' | 'food' | 'play' | 'toboggan' | 'bikeEnd';

export interface SummerPoi {
  kind: PoiKind;
  id: string;
  name: string;
  xM: number;
  yM: number;
  /** Indeks: wyciągu (stacje), restauracji, parkingu, trasy rowerowej. */
  ref: number;
}

export interface SummerNetLift {
  id: string;
  bottom: number;
  top: number;
  lengthM: number;
  rideS: number;
  pedCapPerH: number;
  bikeCapPerH: number;
  operating: boolean;
  windLimitMs: number;
  /** Linia (dolna → górna stacja) do rysowania. */
  line: PointM[];
}

export interface SummerNet {
  pois: SummerPoi[];
  /** Czas przejścia [s] między miejscami (szybkość ×1); Infinity – brak drogi. */
  walkS: Float64Array;
  /** Ścieżka między miejscami (x, y na przemian); null – brak. */
  paths: (Float32Array | null)[];
  lifts: SummerNetLift[];
  bikeTrails: { id: string; lift: number; start: number; end: number; line: Float32Array; lengthM: number; classIndex: number }[];
  toboggan: { id: string; poi: number; line: Float32Array; lengthM: number; capPerH: number; rideS: number } | null;
  foods: { id: string; poi: number; seats: number }[];
  parkings: { id: string; poi: number; capCars: number }[];
}

export interface SummerNetInput {
  sf: SummerFacts;
  /** Szlaki (OSM) i ścieżki spacerowe gracza – łamane w lokalnych współrzędnych. */
  walkLines: PointM[][];
  /** Cele wycieczek z mapy: schroniska, szczyty. */
  destinations: { kind: 'hut' | 'peak'; name: string; xM: number; yM: number }[];
  /** Budynki gracza: gastronomia, plac zabaw, punkt widokowy. */
  buildings: { id: string; typeId: string; name: string; xM: number; yM: number }[];
  parkings: { id: string; name: string; xM: number; yM: number; capCars: number }[];
  /** Trasy rowerowe i tor (oś od góry w dół). */
  bikeLines: Map<string, PointM[]>;
  tobogganLine: PointM[] | null;
  liftLines: Map<string, PointM[]>;
  elevationAt(xM: number, yM: number): number;
  sp: SummerParams;
}

const NODE_SNAP_M = 20;
const STEP_M = 40;
const OFFTRAIL_FACTOR = 1.3;

/** Prędkość marszu z funkcji Toblera [m/s] przy nachyleniu s (dz/dx). */
export function toblerMs(s: number, sp: SummerParams): number {
  const w = sp.walk;
  return (w.toblerMaxKmh * Math.exp(-w.toblerSlope * Math.abs(s + w.toblerOffset))) / 3.6;
}

export function buildSummerNet(i: SummerNetInput): SummerNet {
  const sp = i.sp;
  // ---- miejsca
  const pois: SummerPoi[] = [];
  const addPoi = (p: SummerPoi) => pois.push(p) - 1;
  const parkings = i.parkings.map((p, k) => ({ id: p.id, poi: addPoi({ kind: 'parking', id: p.id, name: p.name, xM: p.xM, yM: p.yM, ref: k }), capCars: p.capCars }));
  const lifts: SummerNetLift[] = [];
  i.sf.lifts.forEach((l) => {
    const line = i.liftLines.get(l.id) ?? [l.bottom, l.top];
    const li = lifts.length;
    const bottom = addPoi({ kind: 'liftBottom', id: l.id, name: `${l.name} – dolna stacja`, xM: l.bottom.xM, yM: l.bottom.yM, ref: li });
    const top = addPoi({ kind: 'liftTop', id: l.id, name: `${l.name} – górna stacja`, xM: l.top.xM, yM: l.top.yM, ref: li });
    lifts.push({ id: l.id, bottom, top, lengthM: l.lengthM, rideS: l.rideMin * 60, pedCapPerH: l.pedCapacityPerHour, bikeCapPerH: l.bikeCapacityPerHour, operating: l.operating, windLimitMs: l.windLimitMs, line });
  });
  for (const d of i.destinations) addPoi({ kind: d.kind, id: d.name, name: d.name, xM: d.xM, yM: d.yM, ref: -1 });
  const foods: SummerNet['foods'] = [];
  for (const b of i.buildings) {
    if (b.typeId === 'gastronomy') foods.push({ id: b.id, poi: addPoi({ kind: 'food', id: b.id, name: b.name, xM: b.xM, yM: b.yM, ref: foods.length }), seats: sp.guests.summerFoodSeatsPerBuilding });
    else if (b.typeId === 'playground') addPoi({ kind: 'play', id: b.id, name: b.name, xM: b.xM, yM: b.yM, ref: -1 });
    else if (b.typeId === 'viewpoint') addPoi({ kind: 'view', id: b.id, name: b.name, xM: b.xM, yM: b.yM, ref: -1 });
  }
  const flat = (pts: PointM[]) => Float32Array.from(pts.flatMap((p) => [p.xM, p.yM]));
  const bikeTrails: SummerNet['bikeTrails'] = [];
  for (const bt of i.sf.bikeTrails) {
    const line = i.bikeLines.get(bt.id);
    const li = lifts.findIndex((l) => l.id === bt.liftId);
    if (!line || li < 0) continue;
    const end = line[line.length - 1];
    const e = addPoi({ kind: 'bikeEnd', id: bt.id, name: 'koniec trasy rowerowej', xM: end.xM, yM: end.yM, ref: bikeTrails.length });
    bikeTrails.push({ id: bt.id, lift: li, start: lifts[li].top, end: e, line: flat(line), lengthM: bt.lengthM, classIndex: bt.classIndex });
  }
  let toboggan: SummerNet['toboggan'] = null;
  if (i.sf.toboggan && i.tobogganLine && i.tobogganLine.length >= 2) {
    const line = i.tobogganLine;
    const bottom = line[line.length - 1]; // stacja startowa na dole (sanki wyciągane w górę)
    toboggan = { id: i.sf.toboggan.id, poi: addPoi({ kind: 'toboggan', id: i.sf.toboggan.id, name: 'tor saneczkowy', xM: bottom.xM, yM: bottom.yM, ref: 0 }), line: flat(line), lengthM: i.sf.toboggan.lengthM, capPerH: i.sf.toboggan.capacityPerHour, rideS: i.sf.toboggan.rideMin * 60 };
  }

  // ---- graf pieszych: węzły ze szlaków (co ~40 m, sklejane w promieniu 20 m) + miejsca
  const nodeX: number[] = [];
  const nodeY: number[] = [];
  const hash = new Map<string, number>();
  const nodeAt = (x: number, y: number): number => {
    const kx = Math.round(x / NODE_SNAP_M);
    const ky = Math.round(y / NODE_SNAP_M);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const n = hash.get(`${kx + dx},${ky + dy}`);
        if (n !== undefined && Math.hypot(nodeX[n] - x, nodeY[n] - y) <= NODE_SNAP_M) return n;
      }
    }
    const id = nodeX.length;
    nodeX.push(x);
    nodeY.push(y);
    hash.set(`${kx},${ky}`, id);
    return id;
  };
  const adj: { to: number; s: number }[][] = [];
  const nz: number[] = [];
  const ensure = (n: number) => {
    while (adj.length <= n) adj.push([]);
    while (nz.length <= n) nz.push(Number.NaN);
  };
  const zOf = (n: number) => {
    ensure(n);
    if (Number.isNaN(nz[n])) nz[n] = i.elevationAt(nodeX[n], nodeY[n]);
    return nz[n];
  };
  const link = (a: number, b: number, factor: number) => {
    if (a === b) return;
    ensure(Math.max(a, b));
    const d = Math.hypot(nodeX[b] - nodeX[a], nodeY[b] - nodeY[a]);
    if (d <= 0) return;
    const za = zOf(a);
    const zb = zOf(b);
    if (Number.isNaN(za) || Number.isNaN(zb)) return;
    const s = (zb - za) / d;
    adj[a].push({ to: b, s: (d / toblerMs(s, sp)) * factor });
    adj[b].push({ to: a, s: (d / toblerMs(-s, sp)) * factor });
  };
  for (const line of i.walkLines) {
    let prev = -1;
    for (let k = 0; k < line.length; k++) {
      const p = line[k];
      if (k > 0) {
        const q = line[k - 1];
        const L = Math.hypot(p.xM - q.xM, p.yM - q.yM);
        const n = Math.max(1, Math.ceil(L / STEP_M));
        for (let s = 1; s < n; s++) {
          const node = nodeAt(q.xM + ((p.xM - q.xM) * s) / n, q.yM + ((p.yM - q.yM) * s) / n);
          if (prev >= 0) link(prev, node, 1);
          prev = node;
        }
      }
      const node = nodeAt(p.xM, p.yM);
      if (prev >= 0) link(prev, node, 1);
      prev = node;
    }
  }
  const trailNodes = nodeX.length;
  // Miejsca jako osobne węzły; dojście do najbliższych punktów szlaku (do connectRadiusM) i do siebie nawzajem.
  const poiNode = pois.map((p) => {
    const id = nodeX.length;
    nodeX.push(p.xM);
    nodeY.push(p.yM);
    ensure(id);
    return id;
  });
  const R = sp.walk.connectRadiusM;
  for (let a = 0; a < pois.length; a++) {
    const na = poiNode[a];
    const near: { n: number; d: number }[] = [];
    for (let n = 0; n < trailNodes; n++) {
      const d = Math.hypot(nodeX[n] - pois[a].xM, nodeY[n] - pois[a].yM);
      if (d <= R) near.push({ n, d });
    }
    near.sort((x, y) => x.d - y.d);
    for (const x of near.slice(0, 2)) link(na, x.n, OFFTRAIL_FACTOR);
    for (let b = a + 1; b < pois.length; b++) if (Math.hypot(pois[b].xM - pois[a].xM, pois[b].yM - pois[a].yM) <= R) link(na, poiNode[b], OFFTRAIL_FACTOR);
  }
  ensure(nodeX.length - 1);
  // ---- najkrótsze drogi z każdego miejsca (Dijkstra)
  const P = pois.length;
  const N = nodeX.length;
  const walkS = new Float64Array(P * P).fill(Infinity);
  const paths: (Float32Array | null)[] = new Array(P * P).fill(null);
  const dist = new Float64Array(N);
  const prevN = new Int32Array(N);
  const done = new Uint8Array(N);
  for (let a = 0; a < P; a++) {
    dist.fill(Infinity);
    prevN.fill(-1);
    done.fill(0);
    const src = poiNode[a];
    dist[src] = 0;
    // Prosta kolejka priorytetowa na tablicy (sieć ma kilkaset–kilka tysięcy węzłów).
    const heap: number[] = [src];
    while (heap.length) {
      let bi = 0;
      for (let k = 1; k < heap.length; k++) if (dist[heap[k]] < dist[heap[bi]]) bi = k;
      const u = heap[bi];
      heap[bi] = heap[heap.length - 1];
      heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      for (const e of adj[u]) {
        const nd = dist[u] + e.s;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prevN[e.to] = u;
          heap.push(e.to);
        }
      }
    }
    for (let b = 0; b < P; b++) {
      const t = poiNode[b];
      if (!Number.isFinite(dist[t])) continue;
      walkS[a * P + b] = dist[t];
      const seq: number[] = [];
      for (let n = t; n >= 0; n = prevN[n]) seq.push(n);
      seq.reverse();
      paths[a * P + b] = Float32Array.from(seq.flatMap((n) => [nodeX[n], nodeY[n]]));
    }
  }
  return { pois, walkS, paths, lifts, bikeTrails, toboggan, foods, parkings };
}

// ------------------------------------------------------------------ dzień

const S_WAIT = 0; // jeszcze nie przyjechali
const S_ACTIVE = 1;
const S_GONE = 2;

const L_WALK = 0;
const L_QUEUE = 1;
const L_RIDE = 2;
const L_STAY = 3;
const L_TOB_QUEUE = 4;
const L_TOB_RIDE = 5;
const L_BIKE = 6;
const L_FOOD_QUEUE = 7;
const L_EAT = 8;

/** Kierunek przejazdu koleją: 0 – w górę piesi, 1 – w dół piesi, 2 – w górę rower. */
const DIR_UP = 0;
const DIR_DOWN = 1;
const DIR_BIKE = 2;

export const DRAW_BIKE = 5;
export const DRAW_SLED = 6;
const DRAW_WALK = 4;
const DRAW_SEATED = 3;
const DRAW_STAND = 2;
export const SUMMER_FRAME_STRIDE = 9;

/** Statystyki co 15 min (96 przedziałów) – dane do kart obiektów. */
export const SLOTS = 96;
export const SLOT_S = 900;

export interface SummerStats {
  parkingCars: Float32Array[];
  parkingTurnedAway: number[];
  foodOccupied: Float32Array[];
  foodQueue: Float32Array[];
  foodServed: number[];
  liftQueueUp: Float32Array[];
  liftQueueDown: Float32Array[];
  liftWaitMin: Float32Array[];
  liftUp: number[];
  liftDown: number[];
  liftBikes: number[];
  liftBoardedSlots: Float32Array[];
  tobQueue: Float32Array;
  tobRides: number;
  bikeLaps: number[];
  onMap: Float32Array;
}

export interface SummerDayOptions {
  seed: number;
  date: CalendarDate;
  plan: SummerPlan;
  personsPerCar: number;
}

export class SummerDay {
  readonly net: SummerNet;
  readonly sp: SummerParams;
  readonly g: number;
  t = 0;
  readonly gType: Uint8Array;
  readonly gSize: Uint8Array;
  readonly gKids: Uint8Array;
  readonly gState: Uint8Array;
  readonly gArrive: Float64Array;
  readonly gLeaveBy: Float64Array;
  readonly gPoi: Int32Array;
  readonly gPark: Int32Array;
  readonly gCars: Uint8Array;
  readonly gLeg: Uint8Array;
  readonly gT0: Float64Array;
  readonly gT1: Float64Array;
  readonly gFrom: Int32Array;
  readonly gTo: Int32Array;
  readonly gLift: Int32Array;
  readonly gDir: Uint8Array;
  readonly gDest: Int32Array;
  readonly gDestDone: Uint8Array;
  readonly gWantTop: Uint8Array;
  readonly gRound: Uint8Array;
  readonly gRodeUp: Uint8Array;
  readonly gRodeDown: Uint8Array;
  readonly gHungry: Uint8Array;
  readonly gAte: Uint8Array;
  readonly gFoodWaitS: Float64Array;
  readonly gTobLeft: Uint8Array;
  readonly gTobRides: Uint8Array;
  readonly gPlay: Uint8Array;
  readonly gLaps: Uint8Array;
  readonly gLapsDone: Uint8Array;
  readonly gWalkS: Float64Array;
  readonly gQueueS: Float64Array;
  readonly gLeaving: Uint8Array;
  readonly gRating: Float32Array;
  readonly gBikeTrail: Int32Array;
  private readonly rng: Rng;
  private readonly weather: SummerWeather;
  private readonly openS: number;
  private readonly closeS: number;
  private readonly queues: number[][];
  private readonly qTokens: Float64Array;
  private readonly tobQueue: number[] = [];
  private tobTokens = 0;
  private readonly foodQueues: number[][];
  private readonly foodOcc: Int32Array;
  private readonly parkCars: Int32Array;
  readonly stats: SummerStats;
  private readonly personsPerCar: number;
  private nextSlot = 0;
  turnedAway = 0;
  private readonly heat: boolean;

  constructor(net: SummerNet, sp: SummerParams, o: SummerDayOptions) {
    this.net = net;
    this.sp = sp;
    this.rng = new Rng(o.seed).fork('goscie-lato').fork(formatIsoDate(o.date));
    this.weather = o.plan.weather;
    this.heat = o.plan.weather.heat;
    this.personsPerCar = o.personsPerCar;
    this.openS = o.plan.hours.openH * 3600;
    this.closeS = o.plan.hours.closeH * 3600;
    // Grupy wg typu.
    const types = sp.types;
    const groups: { type: number; size: number; kids: number }[] = [];
    o.plan.byType.forEach((n, ti) => {
      let left = Math.round(n);
      const t = types[ti];
      while (left > 0) {
        const size = Math.min(left, Math.max(1, Math.round(t.groupMin + this.rng.next() * (t.groupMax - t.groupMin))));
        let kids = 0;
        for (let k = 0; k < size; k++) if (this.rng.next() < t.childShare) kids++;
        groups.push({ type: ti, size, kids });
        left -= size;
      }
    });
    const G = groups.length;
    this.g = G;
    this.gType = Uint8Array.from(groups.map((x) => x.type));
    this.gSize = Uint8Array.from(groups.map((x) => Math.min(255, x.size)));
    this.gKids = Uint8Array.from(groups.map((x) => Math.min(255, x.kids)));
    this.gState = new Uint8Array(G);
    this.gArrive = new Float64Array(G);
    this.gLeaveBy = new Float64Array(G);
    this.gPoi = new Int32Array(G).fill(-1);
    this.gPark = new Int32Array(G).fill(-1);
    this.gCars = new Uint8Array(G);
    this.gLeg = new Uint8Array(G);
    this.gT0 = new Float64Array(G);
    this.gT1 = new Float64Array(G);
    this.gFrom = new Int32Array(G);
    this.gTo = new Int32Array(G);
    this.gLift = new Int32Array(G).fill(-1);
    this.gDir = new Uint8Array(G);
    this.gDest = new Int32Array(G).fill(-1);
    this.gDestDone = new Uint8Array(G);
    this.gWantTop = new Uint8Array(G);
    this.gRound = new Uint8Array(G);
    this.gRodeUp = new Uint8Array(G);
    this.gRodeDown = new Uint8Array(G);
    this.gHungry = new Uint8Array(G);
    this.gAte = new Uint8Array(G);
    this.gFoodWaitS = new Float64Array(G);
    this.gTobLeft = new Uint8Array(G);
    this.gTobRides = new Uint8Array(G);
    this.gPlay = new Uint8Array(G);
    this.gLaps = new Uint8Array(G);
    this.gLapsDone = new Uint8Array(G);
    this.gWalkS = new Float64Array(G);
    this.gQueueS = new Float64Array(G);
    this.gLeaving = new Uint8Array(G);
    this.gRating = new Float32Array(G);
    this.gBikeTrail = new Int32Array(G).fill(-1);
    const gu = sp.guests;
    const anyLift = net.lifts.some((l) => l.operating && l.pedCapPerH > 0);
    for (let g = 0; g < G; g++) {
      const t = types[this.gType[g]];
      const arrive = Math.min(gu.arrivalMaxH, Math.max(gu.arrivalMinH, this.rng.normal(gu.arrivalMeanH, gu.arrivalSdH)));
      const stay = Math.max(gu.stayMinH, this.rng.normal(t.stayMeanH, gu.staySdH));
      this.gArrive[g] = arrive * 3600;
      this.gLeaveBy[g] = (arrive + stay) * 3600;
      this.gCars[g] = this.gType[g] === T_SCHOOL ? 1 : Math.max(1, Math.ceil(this.gSize[g] / o.personsPerCar));
      this.gWantTop[g] = anyLift && this.gType[g] !== T_CYCLIST && this.rng.next() < t.liftUseShare ? 1 : 0;
      this.gRound[g] = this.gWantTop[g] && this.rng.next() < t.roundTripShare ? 1 : 0;
      this.gHungry[g] = this.rng.next() < t.foodShare ? 1 : 0;
      this.gTobLeft[g] = net.toboggan ? Math.round(t.wToboggan * t.tobogganRides * (this.rng.next() < Math.min(1, t.wToboggan) ? 1 : 0)) : 0;
      this.gPlay[g] = this.gKids[g] > 0 && this.gType[g] === T_FAMILY ? 1 : 0;
      this.gLaps[g] = this.gType[g] === T_CYCLIST && net.bikeTrails.length ? Math.max(1, Math.round(sp.bike.lapsMax * (0.4 + 0.6 * this.rng.next()))) : 0;
      if (this.gLaps[g]) this.gBikeTrail[g] = Math.floor(this.rng.next() * net.bikeTrails.length);
    }
    const L = net.lifts.length;
    this.queues = Array.from({ length: L * 3 }, () => []);
    this.qTokens = new Float64Array(L * 3);
    this.foodQueues = net.foods.map(() => []);
    this.foodOcc = new Int32Array(net.foods.length);
    this.parkCars = new Int32Array(net.parkings.length);
    const z = () => new Float32Array(SLOTS);
    this.stats = {
      parkingCars: net.parkings.map(z),
      parkingTurnedAway: net.parkings.map(() => 0),
      foodOccupied: net.foods.map(z),
      foodQueue: net.foods.map(z),
      foodServed: net.foods.map(() => 0),
      liftQueueUp: net.lifts.map(z),
      liftQueueDown: net.lifts.map(z),
      liftWaitMin: net.lifts.map(z),
      liftUp: net.lifts.map(() => 0),
      liftDown: net.lifts.map(() => 0),
      liftBikes: net.lifts.map(() => 0),
      liftBoardedSlots: net.lifts.map(z),
      tobQueue: z(),
      tobRides: 0,
      bikeLaps: net.bikeTrails.map(() => 0),
      onMap: z(),
    };
  }

  private P(): number {
    return this.net.pois.length;
  }

  private walkTime(a: number, b: number, g: number): number {
    const s = this.net.walkS[a * this.P() + b];
    const f = this.sp.types[this.gType[g]].walkSpeedFactor;
    return s / Math.max(0.2, f);
  }

  /** Najbliższe miejsce danego rodzaju (czas dojścia) osiągalne z `from`. */
  private nearest(from: number, kinds: PoiKind[], g: number, maxS = Infinity): number {
    let best = -1;
    let bd = maxS;
    this.net.pois.forEach((p, i) => {
      if (!kinds.includes(p.kind)) return;
      // Stacje kolei, która latem nie kursuje (albo bez miejsc dla pieszych), pomijamy.
      if ((p.kind === 'liftBottom' || p.kind === 'liftTop') && (!this.net.lifts[p.ref].operating || this.net.lifts[p.ref].pedCapPerH <= 0)) return;
      const d = this.walkTime(from, i, g);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private liftRunning(l: number): boolean {
    const lift = this.net.lifts[l];
    const h = this.t / 3600;
    return lift.operating && this.t >= this.openS && this.t < this.closeS && !stormAt(this.weather, h) && this.weather.windTopMs <= lift.windLimitMs;
  }

  private tobRunning(): boolean {
    const h = this.t / 3600;
    return !!this.net.toboggan && this.t >= this.openS && this.t < this.closeS && !stormAt(this.weather, h) && this.weather.windTopMs <= this.sp.toboggan.windStopMs;
  }

  private startLeg(g: number, kind: number, from: number, to: number, durS: number): void {
    this.gLeg[g] = kind;
    this.gFrom[g] = from;
    this.gTo[g] = to;
    this.gT0[g] = this.t;
    this.gT1[g] = this.t + Math.max(1, durS);
  }

  private walk(g: number, to: number): boolean {
    const from = this.gPoi[g];
    if (from === to) return false;
    const s = this.walkTime(from, to, g);
    if (!Number.isFinite(s)) return false;
    this.gWalkS[g] += s;
    this.startLeg(g, this.gLaps[g] && this.gType[g] === T_CYCLIST ? L_BIKE : L_WALK, from, to, s);
    if (this.gLeg[g] === L_BIKE) this.gLift[g] = -2; // dojazd rowerem po ścieżce (nie po trasie)
    return true;
  }

  private queueLift(g: number, l: number, dir: number): void {
    this.gLift[g] = l;
    this.gDir[g] = dir;
    this.gLeg[g] = L_QUEUE;
    this.gT0[g] = this.t;
    this.queues[l * 3 + dir].push(g);
  }

  private leave(g: number): void {
    // Do parkingu: z górnej stacji koleją w dół (bilet w obie strony, zmęczenie, burza nie pozwala – czekają),
    // inaczej pieszo; z dołu pieszo.
    const here = this.gPoi[g];
    const park = this.net.parkings[this.gPark[g]]?.poi ?? -1;
    this.gLeaving[g] = 1;
    if (here === park || park < 0) {
      this.depart(g);
      return;
    }
    const p = this.net.pois[here];
    // Na górze (po wjeździe koleją): bilet w obie strony, upał albo długie zejście – najpierw do górnej stacji.
    if (p.kind !== 'liftTop' && this.gRodeUp[g] && !this.gRodeDown[g]) {
      const top = this.nearest(here, ['liftTop'], g);
      if (top >= 0) {
        const down = this.walkTime(here, park, g);
        const viaTop = this.walkTime(here, top, g);
        const l = this.net.lifts[this.net.pois[top].ref];
        if (l.operating && (this.gRound[g] || this.heat || !Number.isFinite(down) || down > viaTop + 1800) && this.walk(g, top)) return;
      }
    }
    if (p.kind === 'liftTop') {
      const l = p.ref;
      const walkDown = this.walkTime(here, park, g);
      const preferLift = this.gRound[g] || this.heat || walkDown > 3600 || !Number.isFinite(walkDown);
      if (preferLift && this.net.lifts[l].operating) {
        this.queueLift(g, l, DIR_DOWN);
        return;
      }
    }
    if (!this.walk(g, park)) {
      // Brak drogi pieszej – kolejka w dół, gdy stoimy przy górnej stacji; inaczej koniec.
      if (p.kind === 'liftTop') this.queueLift(g, p.ref, DIR_DOWN);
      else this.depart(g);
    }
  }

  private depart(g: number): void {
    this.gState[g] = S_GONE;
    this.gLeg[g] = L_STAY;
    const pk = this.gPark[g];
    if (pk >= 0) this.parkCars[pk] -= this.gCars[g];
    this.rate(g);
  }

  private rate(g: number): void {
    const gu = this.sp.guests;
    const rw = gu.ratingWeights;
    const q = 1 / (1 + this.gQueueS[g] / 60 / gu.ratingQueueRefMin);
    const w = this.weather;
    const rainy = w.precipMm > 2;
    const ws = (w.storm ? 0.45 : 1) * (rainy ? 0.5 : 1) * (this.heat ? 0.8 : 1);
    let goal = 0.6;
    const t = this.gType[g];
    if (t === T_CYCLIST) goal = this.gLaps[g] ? Math.min(1, 0.4 + (0.6 * this.gLapsDone[g]) / this.gLaps[g]) : 0.3;
    else {
      if (this.gDestDone[g]) goal += 0.3;
      if (this.gWantTop[g] && this.gRodeUp[g]) goal += 0.1;
      if (this.gTobRides[g] > 0) goal += 0.1;
    }
    const food = this.gHungry[g] ? (this.gAte[g] ? 1 / (1 + this.gFoodWaitS[g] / 60 / gu.ratingQueueRefMin) : 0.5) : 0.9;
    const s = (rw[0] * q + rw[1] * ws + rw[2] * Math.min(1, goal) + rw[3] * food) / (rw[0] + rw[1] + rw[2] + rw[3]);
    this.gRating[g] = 1 + 4 * s;
  }

  private arrive(g: number): void {
    // Parking z wolnymi miejscami najbliżej pierwszego celu (dolna stacja kolei / tor / plac zabaw).
    const net = this.net;
    let best = -1;
    let bd = Infinity;
    net.parkings.forEach((pk, k) => {
      if (this.parkCars[k] + this.gCars[g] > pk.capCars) return;
      const target = this.firstTarget(pk.poi, g);
      const d = target >= 0 ? this.walkTime(pk.poi, target, g) : 0;
      const score = d + this.rng.next();
      if (score < bd) {
        bd = score;
        best = k;
      }
    });
    if (best < 0) {
      this.gState[g] = S_GONE;
      this.turnedAway += this.gSize[g];
      // Odjechali sprzed parkingu najbliższego ich celowi.
      let near = 0;
      let nd = Infinity;
      net.parkings.forEach((pk, k) => {
        const target = this.firstTarget(pk.poi, g);
        const d = target >= 0 ? this.walkTime(pk.poi, target, g) : k;
        if (d < nd) {
          nd = d;
          near = k;
        }
      });
      if (net.parkings.length) this.stats.parkingTurnedAway[near] += this.gSize[g];
      this.gRating[g] = 0;
      return;
    }
    this.gState[g] = S_ACTIVE;
    this.gPark[g] = best;
    this.parkCars[best] += this.gCars[g];
    this.gPoi[g] = net.parkings[best].poi;
    this.decide(g);
  }

  private firstTarget(from: number, g: number): number {
    const t = this.gType[g];
    if (t === T_CYCLIST && this.gLaps[g]) return this.net.lifts[this.net.bikeTrails[Math.max(0, this.gBikeTrail[g])].lift].bottom;
    if (this.gWantTop[g]) return this.nearest(from, ['liftBottom'], g);
    return -1;
  }

  /** Decyzja w miejscu `gPoi[g]`. */
  private decide(g: number): void {
    const net = this.net;
    const here = this.gPoi[g];
    const p = net.pois[here];
    const t = this.gType[g];
    const gu = this.sp.guests;
    const h = this.t / 3600;
    // Wyjazd: plan, zamknięcie, deszcz (część grup), burza.
    const raining = this.weather.precipMm > 0 && h >= this.weather.rainFromH && h < this.weather.rainToH && this.weather.precipMm / Math.max(1, this.weather.rainToH - this.weather.rainFromH) >= this.sp.weather.rainHeavyMmPerH;
    const fatigue = (this.gWalkS[g] / 3600) * gu.fatiguePerWalkH * (this.heat ? gu.heatFatigueFactor : 1);
    if (this.gLeaving[g] || this.t >= this.gLeaveBy[g] || this.t >= this.closeS || fatigue >= 1 || (raining && this.rng.next() < 0.5)) {
      if (this.gHungry[g] && !this.gAte[g] && p.kind === 'food' && this.t < this.closeS) return this.eat(g, p.ref);
      return this.leave(g);
    }
    // Rowerzysta: zjazdy.
    if (t === T_CYCLIST) {
      if (this.gLapsDone[g] < this.gLaps[g] && net.bikeTrails.length) {
        const bt = net.bikeTrails[this.gBikeTrail[g]];
        const lift = net.lifts[bt.lift];
        if (here === lift.top) {
          const v = this.sp.bike.speedMs[bt.classIndex];
          this.startLeg(g, L_BIKE, here, bt.end, bt.lengthM / v);
          this.gLift[g] = -1;
          return;
        }
        if (here === lift.bottom) {
          if (!lift.operating || lift.bikeCapPerH <= 0) return this.leave(g);
          return this.queueLift(g, bt.lift, DIR_BIKE);
        }
        if (this.walk(g, lift.bottom)) return;
        return this.leave(g);
      }
      if (this.gHungry[g] && !this.gAte[g] && net.foods.length) {
        const f = this.nearest(here, ['food'], g, 900);
        if (f >= 0) return here === f ? this.eat(g, net.pois[f].ref) : void this.walk(g, f);
      }
      return this.leave(g);
    }
    // Głód po kilku godzinach albo na celu ze schroniskiem.
    // Głodni po ok. 1,5 h albo od razu, gdy restauracja jest przy górnej stacji, na którą wjechali.
    const hungryNow = this.gHungry[g] && !this.gAte[g] && (this.t - this.gArrive[g] > 1.5 * 3600 || (p.kind === 'liftTop' && this.nearest(here, ['food'], g, 300) >= 0));
    if (hungryNow) {
      const f = this.nearest(here, ['food'], g, 1200);
      if (f >= 0) return here === f ? this.eat(g, net.pois[f].ref) : void this.walk(g, f);
      if (p.kind === 'hut') {
        this.gAte[g] = 1; // zjedli w schronisku (nie u nas)
        this.startLeg(g, L_STAY, here, here, gu.mealMin * 60);
        return;
      }
    }
    // Rodziny: tor saneczkowy na początek, gdy stacja toru jest blisko (do 10 min).
    if ((t === T_FAMILY || t === T_SCHOOL) && this.gTobRides[g] === 0 && this.gTobLeft[g] > 0 && net.toboggan && this.tobRunning()) {
      const tp = net.toboggan.poi;
      if (here === tp) {
        this.gLeg[g] = L_TOB_QUEUE;
        this.gT0[g] = this.t;
        this.tobQueue.push(g);
        return;
      }
      if (this.walkTime(here, tp, g) < 600 && this.walk(g, tp)) return;
    }
    // Cel wycieczki: kolej w górę, potem spacer do schroniska / szczytu / punktu widokowego.
    if (!this.gDestDone[g] && (t === T_HIKER || t === T_SCHOOL || t === T_FAMILY)) {
      if (this.gWantTop[g] && !this.gRodeUp[g]) {
        if (p.kind === 'liftBottom' && net.lifts[p.ref].operating) return this.queueLift(g, p.ref, DIR_UP);
        const b = this.nearest(here, ['liftBottom'], g);
        if (b >= 0 && this.walk(g, b)) return;
        this.gWantTop[g] = 0;
      }
      if (this.gDest[g] < 0) this.gDest[g] = this.pickDest(g, here);
      const d = this.gDest[g];
      if (d >= 0 && d !== here) {
        if (this.walk(g, d)) return;
      }
      this.gDestDone[g] = 1;
      if (d >= 0 && d === here) {
        const k = net.pois[d].kind;
        if (k === 'hut' && this.gHungry[g] && !this.gAte[g]) {
          this.gAte[g] = 1;
          this.startLeg(g, L_STAY, here, here, gu.mealMin * 60);
          return;
        }
        if (k === 'food' && this.gHungry[g] && !this.gAte[g]) return this.eat(g, net.pois[d].ref);
        this.startLeg(g, L_STAY, here, here, gu.summitStayMin * 60);
        return;
      }
    }
    // Tor saneczkowy, plac zabaw (rodziny, szkoły).
    if (this.gTobLeft[g] > 0 && net.toboggan && this.tobRunning()) {
      const tp = net.toboggan.poi;
      if (here === tp) {
        this.gLeg[g] = L_TOB_QUEUE;
        this.gT0[g] = this.t;
        this.tobQueue.push(g);
        return;
      }
      if (this.walkTime(here, tp, g) < 1800 && this.walk(g, tp)) return;
      if (net.pois[here].kind === 'liftTop' && this.gRodeUp[g] && net.lifts[net.pois[here].ref].operating) return this.queueLift(g, net.pois[here].ref, DIR_DOWN);
      this.gTobLeft[g] = 0;
    }
    if (this.gPlay[g]) {
      const pl = this.nearest(here, ['play'], g, 1200);
      if (pl >= 0) {
        if (pl === here) {
          this.gPlay[g] = 0;
          this.startLeg(g, L_STAY, here, here, gu.playMin * 60);
          return;
        }
        if (this.walk(g, pl)) return;
      }
      this.gPlay[g] = 0;
    }
    if (this.gHungry[g] && !this.gAte[g]) {
      const f = this.nearest(here, ['food'], g, 900);
      if (f >= 0) return here === f ? this.eat(g, net.pois[f].ref) : void this.walk(g, f);
    }
    return this.leave(g);
  }

  private pickDest(g: number, from: number): number {
    const net = this.net;
    const t = this.sp.types[this.gType[g]];
    const maxS = (t.maxWalkH * 3600) / 2;
    const cands: { i: number; w: number }[] = [];
    net.pois.forEach((p, i) => {
      if (p.kind !== 'hut' && p.kind !== 'peak' && p.kind !== 'view' && !(p.kind === 'food' && this.gType[g] !== T_HIKER)) return;
      const s = this.walkTime(from, i, g);
      if (!Number.isFinite(s) || s > maxS) return;
      const base = p.kind === 'hut' ? 1.2 : p.kind === 'view' ? 1.0 : p.kind === 'food' ? 0.8 : 0.9;
      cands.push({ i, w: base * Math.exp(-s / maxS) });
    });
    if (!cands.length) return -1;
    let r = this.rng.next() * cands.reduce((a, c) => a + c.w, 0);
    for (const c of cands) {
      r -= c.w;
      if (r <= 0) return c.i;
    }
    return cands[cands.length - 1].i;
  }

  private eat(g: number, f: number): void {
    this.gLeg[g] = L_FOOD_QUEUE;
    this.gT0[g] = this.t;
    this.foodQueues[f].push(g);
    this.gTo[g] = f;
  }

  /** Krok symulacji (dt ≤ 5 s). */
  step(dt: number): void {
    const t1 = this.t + dt;
    this.t = t1;
    const net = this.net;
    // Przyjazdy.
    for (let g = 0; g < this.g; g++) if (this.gState[g] === S_WAIT && this.gArrive[g] <= t1) this.arrive(g);
    // Kolej: żetony miejsc (piesi w górę i w dół, rowery) – grupy wsiadają w kolejności przyjścia.
    net.lifts.forEach((l, li) => {
      const running = this.liftRunning(li);
      // Po zamknięciu kolej zwozi jeszcze do godziny osoby z góry (w dół).
      const late = !running && l.operating && this.t >= this.closeS && this.t < this.closeS + 3600 && !stormAt(this.weather, this.t / 3600) && this.weather.windTopMs <= l.windLimitMs;
      if (!running && !late) return;
      const caps = [l.pedCapPerH, l.pedCapPerH, l.bikeCapPerH];
      for (let dir = 0; dir < 3; dir++) {
        if (!running && dir !== DIR_DOWN) continue;
        const q = this.queues[li * 3 + dir];
        const k = li * 3 + dir;
        if (!q.length) {
          this.qTokens[k] = 0;
          continue;
        }
        this.qTokens[k] += (caps[dir] / 3600) * dt;
        while (q.length && this.qTokens[k] >= this.gSize[q[0]]) {
          const g = q.shift()!;
          this.qTokens[k] -= this.gSize[g];
          this.gQueueS[g] += this.t - this.gT0[g];
          const slot = Math.min(SLOTS - 1, Math.floor(this.t / SLOT_S));
          this.stats.liftBoardedSlots[li][slot] += this.gSize[g];
          if (dir === DIR_UP) {
            this.gRodeUp[g] = 1;
            this.stats.liftUp[li] += this.gSize[g];
          } else if (dir === DIR_DOWN) {
            this.gRodeDown[g] = 1;
            this.stats.liftDown[li] += this.gSize[g];
          } else this.stats.liftBikes[li] += this.gSize[g];
          this.startLeg(g, L_RIDE, dir === DIR_DOWN ? l.top : l.bottom, dir === DIR_DOWN ? l.bottom : l.top, l.rideS);
          this.gLift[g] = li;
          this.gDir[g] = dir;
        }
      }
    });
    // Tor saneczkowy.
    if (this.tobRunning() && net.toboggan) {
      this.tobTokens += (net.toboggan.capPerH / 3600) * dt;
      while (this.tobQueue.length && this.tobTokens >= this.gSize[this.tobQueue[0]]) {
        const g = this.tobQueue.shift()!;
        this.tobTokens -= this.gSize[g];
        this.gQueueS[g] += this.t - this.gT0[g];
        this.startLeg(g, L_TOB_RIDE, net.toboggan.poi, net.toboggan.poi, net.toboggan.rideS);
        this.stats.tobRides += this.gSize[g];
      }
      if (!this.tobQueue.length) this.tobTokens = Math.min(this.tobTokens, 2);
    }
    // Restauracje: wolne miejsca dla grup z kolejki.
    net.foods.forEach((f, fi) => {
      const q = this.foodQueues[fi];
      while (q.length && this.foodOcc[fi] + this.gSize[q[0]] <= f.seats) {
        const g = q.shift()!;
        this.foodOcc[fi] += this.gSize[g];
        this.gFoodWaitS[g] += this.t - this.gT0[g];
        this.stats.foodServed[fi] += this.gSize[g];
        this.gAte[g] = 1;
        this.startLeg(g, L_EAT, f.poi, f.poi, this.sp.guests.mealMin * 60);
        this.gTo[g] = fi;
      }
    });
    // Grupy: koniec odcinka → decyzja; kolejki ponad cierpliwość.
    const patienceS = this.sp.guests.queuePatienceMin * 60;
    for (let g = 0; g < this.g; g++) {
      if (this.gState[g] !== S_ACTIVE) continue;
      const leg = this.gLeg[g];
      if (leg === L_QUEUE || leg === L_TOB_QUEUE || leg === L_FOOD_QUEUE) {
        const waited = this.t - this.gT0[g];
        const stuck = leg === L_QUEUE && !this.liftRunning(this.gLift[g]) && this.t >= this.closeS;
        if (waited > patienceS * (this.gLeaving[g] ? 4 : 1) || stuck) {
          this.removeFromQueue(g);
          this.gQueueS[g] += waited;
          if (leg === L_TOB_QUEUE) this.gTobLeft[g] = 0;
          if (leg === L_FOOD_QUEUE) {
            this.gFoodWaitS[g] += waited;
            this.gHungry[g] = 0;
          }
          if (leg === L_QUEUE) {
            if (this.gDir[g] === DIR_UP) this.gWantTop[g] = 0;
            if (this.gDir[g] === DIR_BIKE) this.gLaps[g] = this.gLapsDone[g];
            if (this.gDir[g] === DIR_DOWN) {
              // Z góry pieszo, jeśli jest droga; inaczej czekają dalej.
              const park = net.parkings[this.gPark[g]]?.poi ?? -1;
              if (park >= 0 && this.walk(g, park)) continue;
              this.queues[this.gLift[g] * 3 + DIR_DOWN].push(g);
              this.gT0[g] = this.t;
              continue;
            }
          }
          this.decide(g);
        }
        continue;
      }
      if (t1 < this.gT1[g]) continue;
      if (leg === L_RIDE) {
        this.gPoi[g] = this.gTo[g];
        this.gLift[g] = -1;
      } else if (leg === L_WALK) this.gPoi[g] = this.gTo[g];
      else if (leg === L_BIKE) {
        this.gPoi[g] = this.gTo[g];
        if (net.pois[this.gTo[g]].kind === 'bikeEnd') {
          this.gLapsDone[g]++;
          this.stats.bikeLaps[net.pois[this.gTo[g]].ref]++;
        }
        this.gLift[g] = -1;
      } else if (leg === L_TOB_RIDE) {
        this.gTobLeft[g] = Math.max(0, this.gTobLeft[g] - 1);
        this.gTobRides[g]++;
      } else if (leg === L_EAT) {
        this.foodOcc[this.gTo[g]] -= this.gSize[g];
        this.gPoi[g] = net.foods[this.gTo[g]].poi;
      }
      if (this.gLeaving[g] && net.parkings[this.gPark[g]]?.poi === this.gPoi[g]) {
        this.depart(g);
        continue;
      }
      this.decide(g);
    }
    // Statystyki co 15 min.
    while (this.nextSlot < SLOTS && this.t >= this.nextSlot * SLOT_S) this.sample(this.nextSlot++);
  }

  private removeFromQueue(g: number): void {
    const leg = this.gLeg[g];
    let q: number[] | null = null;
    if (leg === L_QUEUE) q = this.queues[this.gLift[g] * 3 + this.gDir[g]];
    else if (leg === L_TOB_QUEUE) q = this.tobQueue;
    else if (leg === L_FOOD_QUEUE) q = this.foodQueues[this.gTo[g]];
    if (!q) return;
    const k = q.indexOf(g);
    if (k >= 0) q.splice(k, 1);
  }

  private sample(slot: number): void {
    const s = this.stats;
    this.parkCars.forEach((c, k) => (s.parkingCars[k][slot] = c));
    this.foodOcc.forEach((c, k) => (s.foodOccupied[k][slot] = c));
    this.foodQueues.forEach((q, k) => (s.foodQueue[k][slot] = q.reduce((a, g) => a + this.gSize[g], 0)));
    this.net.lifts.forEach((l, li) => {
      const up = this.queues[li * 3 + DIR_UP].reduce((a, g) => a + this.gSize[g], 0) + this.queues[li * 3 + DIR_BIKE].reduce((a, g) => a + this.gSize[g], 0);
      const down = this.queues[li * 3 + DIR_DOWN].reduce((a, g) => a + this.gSize[g], 0);
      s.liftQueueUp[li][slot] = up;
      s.liftQueueDown[li][slot] = down;
      s.liftWaitMin[li][slot] = l.pedCapPerH > 0 ? (up / l.pedCapPerH) * 60 : 0;
    });
    s.tobQueue[slot] = this.tobQueue.reduce((a, g) => a + this.gSize[g], 0);
    let on = 0;
    for (let g = 0; g < this.g; g++) if (this.gState[g] === S_ACTIVE) on += this.gSize[g];
    s.onMap[slot] = on;
  }

  advanceTo(tS: number, dt = 2): void {
    while (this.t < tS) this.step(Math.min(dt, tS - this.t));
  }

  /** Zajęte miejsca na parkingach teraz (auta). */
  parkingCarsNow(): number[] {
    return Array.from(this.parkCars);
  }

  /** Samochody gości obecnych teraz (wg grup). */
  carsOfGuestsNow(): number {
    let c = 0;
    for (let g = 0; g < this.g; g++) if (this.gState[g] === S_ACTIVE) c += this.gCars[g];
    return c;
  }

  /** Wynik dnia w tej samej postaci co model zgrubny (grupy jeszcze obecne – kończą dzień). */
  outcome(sf: SummerFacts): SummerOutcome {
    for (let g = 0; g < this.g; g++) if (this.gState[g] === S_ACTIVE) this.depart(g);
    const L = sf.lifts.length;
    const idx = new Map(this.net.lifts.map((l, i) => [l.id, i]));
    let up = 0;
    let round = 0;
    let downOnly = 0;
    let school = 0;
    let kids = 0;
    let riders = 0;
    let bikePasses = 0;
    let ratingSum = 0;
    let ratingCount = 0;
    let qSum = 0;
    let arrived = 0;
    const byType = [0, 0, 0, 0];
    let tob = 0;
    for (let g = 0; g < this.g; g++) {
      if (this.gState[g] === S_WAIT || this.gRating[g] === 0) continue;
      const n = this.gSize[g];
      arrived += n;
      byType[this.gType[g]] += n;
      if (this.gRodeUp[g] && this.gRodeDown[g]) round += n;
      else if (this.gRodeUp[g]) up += n;
      else if (this.gRodeDown[g]) downOnly += n;
      if ((this.gRodeUp[g] || this.gRodeDown[g]) && this.gType[g] === T_SCHOOL) school += n;
      if (this.gRodeUp[g] || this.gRodeDown[g]) {
        riders += n;
        kids += this.gKids[g];
      }
      if (this.gType[g] === T_CYCLIST && this.gLapsDone[g] > 0) bikePasses += n;
      tob += this.gTobRides[g] * n;
      ratingSum += this.gRating[g] * n;
      ratingCount += n;
      qSum += (this.gQueueS[g] / 60) * n;
    }
    const lift = (arr: number[]) => sf.lifts.map((l) => (idx.has(l.id) ? arr[idx.get(l.id)!] : 0));
    const hours = sf.lifts.map((l) => (idx.has(l.id) && l.operating ? (this.closeS - this.openS) / 3600 : 0));
    const meals = this.stats.foodServed.reduce((a, b) => a + b, 0);
    return {
      source: 'agents',
      guests: arrived,
      byType,
      liftUp: lift(this.stats.liftUp),
      liftDown: lift(this.stats.liftDown),
      liftBikes: lift(this.stats.liftBikes),
      liftHours: L ? hours : [],
      ticketsUp: up + downOnly,
      ticketsRound: round,
      ticketsReducedShare: riders > 0 ? kids / riders : 0,
      schoolTickets: school,
      bikePasses,
      bikeRentals: sf.rental ? bikePasses * this.sp.types[T_CYCLIST].rentalShare : 0,
      bikeLaps: this.stats.bikeLaps.reduce((a, b) => a + b, 0),
      tobogganRides: tob,
      meals,
      playgroundVisits: 0,
      cars: (arrived - byType[T_SCHOOL]) / this.personsPerCar,
      meanQueueMin: ratingCount > 0 ? qSum / ratingCount : 0,
      ratingSum,
      ratingCount,
    };
  }

  /** Położenia osób do rysowania: SUMMER_FRAME_STRIDE liczb na osobę. */
  writeFrame(out: Float32Array): number {
    let n = 0;
    const net = this.net;
    const put = (id: number, x: number, y: number, vx: number, vy: number, kind: number, variant: number, phase: number) => {
      if ((n + 1) * SUMMER_FRAME_STRIDE > out.length) return;
      const o = n * SUMMER_FRAME_STRIDE;
      out[o] = id;
      out[o + 1] = x;
      out[o + 2] = y;
      out[o + 3] = vx;
      out[o + 4] = vy;
      out[o + 5] = Math.atan2(vy, vx);
      out[o + 6] = kind;
      out[o + 7] = variant;
      out[o + 8] = phase;
      n++;
    };
    const along = (line: ArrayLike<number>, f: number): { x: number; y: number; dx: number; dy: number } => {
      const m = line.length / 2;
      if (m < 2) return { x: line[0] ?? 0, y: line[1] ?? 0, dx: 0, dy: 0 };
      let L = 0;
      for (let k = 1; k < m; k++) L += Math.hypot(line[2 * k] - line[2 * k - 2], line[2 * k + 1] - line[2 * k - 1]);
      let d = Math.max(0, Math.min(1, f)) * L;
      for (let k = 1; k < m; k++) {
        const sx = line[2 * k] - line[2 * k - 2];
        const sy = line[2 * k + 1] - line[2 * k - 1];
        const s = Math.hypot(sx, sy);
        if (d <= s || k === m - 1) {
          const u = s > 0 ? Math.min(1, d / s) : 0;
          return { x: line[2 * k - 2] + sx * u, y: line[2 * k - 1] + sy * u, dx: s > 0 ? sx / s : 0, dy: s > 0 ? sy / s : 0 };
        }
        d -= s;
      }
      return { x: line[line.length - 2], y: line[line.length - 1], dx: 0, dy: 0 };
    };
    const P = net.pois.length;
    for (let g = 0; g < this.g; g++) {
      if (this.gState[g] !== S_ACTIVE) continue;
      const leg = this.gLeg[g];
      const f = (this.t - this.gT0[g]) / Math.max(1, this.gT1[g] - this.gT0[g]);
      const size = this.gSize[g];
      const id0 = g * 64;
      const variant = (g * 7) % 8;
      if (leg === L_WALK || (leg === L_BIKE && this.gLift[g] === -2)) {
        const path = net.paths[this.gFrom[g] * P + this.gTo[g]];
        if (!path) continue;
        const q = along(path, f);
        const v = 1.2;
        for (let k = 0; k < Math.min(size, 12); k++) put(id0 + k, q.x - q.dx * k * 1.5 + ((k % 2) * 2 - 1) * q.dy * (k > 0 ? 0.8 : 0), q.y - q.dy * k * 1.5 - ((k % 2) * 2 - 1) * q.dx * (k > 0 ? 0.8 : 0), q.dx * v, q.dy * v, leg === L_BIKE ? DRAW_BIKE : DRAW_WALK, variant + (k < this.gKids[g] ? 16 : 0), (this.t * 0.8 + k) % 1);
      } else if (leg === L_BIKE) {
        const bt = net.bikeTrails.find((b) => b.end === this.gTo[g]);
        if (!bt) continue;
        const q = along(bt.line, f);
        for (let k = 0; k < size; k++) put(id0 + k, q.x - q.dx * k * 4, q.y - q.dy * k * 4, q.dx * 5, q.dy * 5, DRAW_BIKE, variant, 0);
      } else if (leg === L_RIDE) {
        const l = net.lifts[this.gLift[g]];
        const pts = Float32Array.from(l.line.flatMap((p) => [p.xM, p.yM]));
        const q = along(pts, this.gDir[g] === DIR_DOWN ? 1 - f : f);
        for (let k = 0; k < Math.min(size, 4); k++) put(id0 + k, q.x + k * 0.6, q.y, 0, 0, this.gDir[g] === DIR_BIKE ? DRAW_BIKE : DRAW_SEATED, variant, 0);
      } else if (leg === L_TOB_RIDE && net.toboggan) {
        const line = net.toboggan.line;
        // Najpierw wyciąganie w górę (od dołu), potem zjazd.
        const up = 0.55;
        const q = f < up ? along(line, 1 - f / up) : along(line, (f - up) / (1 - up));
        for (let k = 0; k < Math.min(size, 6); k++) put(id0 + k, q.x - q.dx * k * 6, q.y - q.dy * k * 6, q.dx * 6, q.dy * 6, DRAW_SLED, variant + (k < this.gKids[g] ? 16 : 0), 0);
      } else if (leg === L_QUEUE || leg === L_TOB_QUEUE || leg === L_STAY || leg === L_FOOD_QUEUE) {
        const poi = leg === L_QUEUE ? (this.gDir[g] === DIR_DOWN ? net.lifts[this.gLift[g]].top : net.lifts[this.gLift[g]].bottom) : leg === L_TOB_QUEUE && net.toboggan ? net.toboggan.poi : leg === L_FOOD_QUEUE ? net.foods[this.gTo[g]].poi : this.gPoi[g];
        const p = net.pois[poi];
        if (leg === L_STAY && p.kind === 'hut') continue; // w środku
        const ring = 4 + (g % 9) * 1.3;
        const a = g * 2.399;
        for (let k = 0; k < Math.min(size, 12); k++) put(id0 + k, p.xM + Math.cos(a + k * 0.5) * (ring + k * 0.8), p.yM + Math.sin(a + k * 0.5) * (ring + k * 0.8), 0, 0, this.gType[g] === T_CYCLIST ? DRAW_BIKE : DRAW_STAND, variant + (k < this.gKids[g] ? 16 : 0), 0);
      }
    }
    return n;
  }
}

/** Cele wycieczek z otoczenia OSM: szczyty i schroniska (nazwy wg wzoru z danych). */
export function osmDestinations(
  places: { name: string; kind: string; point: number[] }[],
  buildings: { name: string; points: number[][] }[],
  toLocal: (e: number, n: number) => PointM | null,
  onMap: (p: PointM) => boolean,
  sp: SummerParams,
): { kind: 'hut' | 'peak'; name: string; xM: number; yM: number }[] {
  const out: { kind: 'hut' | 'peak'; name: string; xM: number; yM: number }[] = [];
  const re = new RegExp(sp.walk.hutNamePattern, 'i');
  for (const p of places) {
    if (p.kind !== 'peak' && p.kind !== 'alpine_hut') continue;
    const q = toLocal(p.point[0], p.point[1]);
    if (q && onMap(q) && !out.some((o) => o.name === p.name)) out.push({ kind: p.kind === 'peak' ? 'peak' : 'hut', name: p.name, ...q });
  }
  for (const b of buildings) {
    if (!b.name || !re.test(b.name)) continue;
    const pts = b.points.map(([e, n]) => toLocal(e, n)).filter((q): q is PointM => q !== null);
    if (!pts.length) continue;
    const q = { xM: pts.reduce((a, p) => a + p.xM, 0) / pts.length, yM: pts.reduce((a, p) => a + p.yM, 0) / pts.length };
    if (onMap(q) && !out.some((o) => o.name === b.name)) out.push({ kind: 'hut', name: b.name, ...q });
  }
  return out;
}

void T_HIKER;

/** Sieć dla gości letnich z układu ośrodka, faktów i otoczenia (szlaki OSM, cele wycieczek). */
export function summerNetFor(
  layout: { lifts: { id: string; bottom: PointM; top: PointM; bends?: PointM[] }[]; trails?: { id: string; kind: string; points: PointM[]; closed?: boolean }[]; bases: { id: string; name: string }[]; buildings?: { id: string; name: string; typeId: string; xM: number; yM: number }[] },
  trails: Map<string, { axis: { xM: number; yM: number }[]; ok: boolean }>,
  sf: SummerFacts,
  facts: { buildings: { id: string; type: { id: string; base: boolean; cars: number }; built: boolean; accessible: boolean; xM: number; yM: number }[] },
  built: (id: string) => boolean,
  env: { walkLines: PointM[][]; destinations: { kind: 'hut' | 'peak'; name: string; xM: number; yM: number }[] },
  elevationAt: (xM: number, yM: number) => number,
  sp: SummerParams,
): SummerNet {
  const walkLines = [...env.walkLines];
  const bikeLines = new Map<string, PointM[]>();
  let tobogganLine: PointM[] | null = null;
  for (const t of layout.trails ?? []) {
    const a = trails.get(t.id);
    if (!a || !built(t.id) || t.closed) continue;
    if (t.kind === 'walk') walkLines.push(t.points);
    else if (t.kind === 'bike') bikeLines.set(t.id, a.axis.map((q) => ({ xM: q.xM, yM: q.yM })));
    else if (t.kind === 'toboggan' && sf.toboggan?.id === t.id) tobogganLine = a.axis.map((q) => ({ xM: q.xM, yM: q.yM }));
  }
  const names = new Map([...layout.bases, ...(layout.buildings ?? [])].map((b) => [b.id, b.name]));
  const parkings = facts.buildings.filter((b) => b.built && b.type.base && b.accessible).map((b) => ({ id: b.id, name: names.get(b.id) ?? b.id, xM: b.xM, yM: b.yM, capCars: b.type.cars }));
  const buildings = [
    ...facts.buildings.filter((b) => b.built && !b.type.base).map((b) => ({ id: b.id, typeId: b.type.id, name: names.get(b.id) ?? b.id, xM: b.xM, yM: b.yM })),
    ...(layout.buildings ?? []).filter((b) => built(b.id) && (b.typeId === 'playground' || b.typeId === 'viewpoint')),
  ];
  const liftLines = new Map(layout.lifts.map((l) => [l.id, [l.bottom, ...(l.bends ?? []), l.top]]));
  return buildSummerNet({ sf, walkLines, destinations: env.destinations, buildings, parkings, bikeLines, tobogganLine, liftLines, elevationAt, sp });
}
