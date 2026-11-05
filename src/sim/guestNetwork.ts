/**
 * Sieć ośrodka w postaci dla gości: wyciągi (z kolejką, krzesełkami, czasem przejazdu), trasy
 * (oś z szerokością i nachyleniem – korytarz, po którym jadą), odcinki tras między węzłami oraz
 * „miejsca” (huby): stacje, bazy i węzły tras bliżej siebie niż stationWalkRadiusM – gość może
 * między nimi podejść pieszo. Same liczby i tablice – da się przesłać do wątku obliczeń.
 */
import type { LiftAnalysis, LiftParams, PointM } from './lifts';
import { liftTypeById } from './lifts';
import type { PisteAnalysis, PisteParams } from './pistes';
import type { NetworkNode, ResortLayout, ResortNetwork } from './resort';

export interface NetPiste {
  id: string;
  name: string;
  classIndex: number;
  closed: boolean;
  /** Próbki osi (od góry): odległość [m], położenie, szerokość, wysokość, nachylenie w dół do następnej próbki [%]. */
  distM: number[];
  xM: number[];
  yM: number[];
  widthM: number[];
  elevM: number[];
  slopePercent: number[];
  lengthM: number;
}

export interface NetEdge {
  piste: number;
  /** Węzły (indeksy w nodes). */
  from: number;
  to: number;
  fromM: number;
  toM: number;
  lengthM: number;
  classIndex: number;
}

export interface NetLift {
  id: string;
  name: string;
  typeName: string;
  aerial: boolean;
  closed: boolean;
  bottom: number;
  top: number;
  bottomX: number;
  bottomY: number;
  topX: number;
  topY: number;
  /** Długość liny po skosie [m], przejazd [s], prędkość [m/s]. */
  lengthM: number;
  rideS: number;
  speedMs: number;
  /** Miejsca na krzesełku (co najmniej 1) i odstęp czasu między krzesełkami [s]. */
  seats: number;
  intervalS: number;
  capacityPerHour: number;
  windLimitMs: number;
  topElevM: number;
}

export interface NetNode {
  id: string;
  kind: NetworkNode['kind'];
  xM: number;
  yM: number;
  hub: number;
}

export interface NetHub {
  nodes: number[];
  xM: number;
  yM: number;
  /** Wyciągi z dolną stacją w tym miejscu. */
  lifts: number[];
  /** Odcinki tras wychodzące z tego miejsca. */
  outEdges: number[];
  /** Jest tu jedzenie (baza, schronisko). */
  food: boolean;
  /** Stąd goście przyjeżdżają i tu kończą dzień (baza – parking; bez baz – najniższa dolna stacja). */
  exit: boolean;
  name: string;
}

export interface GuestNet {
  nodes: NetNode[];
  hubs: NetHub[];
  pistes: NetPiste[];
  edges: NetEdge[];
  lifts: NetLift[];
  /** Miejsca przyjazdu (bazy lub najniższa dolna stacja). */
  entryHubs: number[];
  cellSizeM: number;
  widthCells: number;
  heightCells: number;
}

export interface GuestNetInput {
  layout: ResortLayout;
  lifts: Map<string, LiftAnalysis>;
  pistes: Map<string, PisteAnalysis>;
  network: ResortNetwork;
  liftParams: LiftParams;
  pisteParams: PisteParams;
  stationWalkRadiusM: number;
  /** Punkty z jedzeniem poza bazami (np. schronisko) – węzeł bliżej niż stationWalkRadiusM dostaje jedzenie. */
  foodPoints: (PointM & { name: string })[];
  grid: { cellSizeM: number; widthCells: number; heightCells: number };
}

/** Buduje sieć dla gości z układu ośrodka i jego analizy (etap 4). */
export function buildGuestNet(input: GuestNetInput): GuestNet {
  const { layout, network } = input;
  const nodeIndex = new Map<string, number>();
  const nodes: NetNode[] = network.nodes.map((n, i) => {
    nodeIndex.set(n.id, i);
    return { id: n.id, kind: n.kind, xM: n.xM, yM: n.yM, hub: -1 };
  });
  // Huby: węzły bliżej niż promień (łączenie przechodnie).
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const r = input.stationWalkRadiusM;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (Math.hypot(nodes[i].xM - nodes[j].xM, nodes[i].yM - nodes[j].yM) <= r) parent[find(i)] = find(j);
    }
  }
  const hubOf = new Map<number, number>();
  const hubs: NetHub[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const root = find(i);
    let h = hubOf.get(root);
    if (h === undefined) {
      h = hubs.length;
      hubOf.set(root, h);
      hubs.push({ nodes: [], xM: 0, yM: 0, lifts: [], outEdges: [], food: false, exit: false, name: '' });
    }
    nodes[i].hub = h;
    hubs[h].nodes.push(i);
  }
  for (const h of hubs) {
    h.xM = h.nodes.reduce((s, i) => s + nodes[i].xM, 0) / h.nodes.length;
    h.yM = h.nodes.reduce((s, i) => s + nodes[i].yM, 0) / h.nodes.length;
  }

  // Trasy.
  const pisteIndex = new Map<string, number>();
  const pistes: NetPiste[] = [];
  for (const p of layout.pistes) {
    const a = input.pistes.get(p.id);
    if (!a) continue;
    const ax = a.axis.filter((s) => !Number.isNaN(s.elevationM));
    if (ax.length < 2) continue;
    const slope: number[] = [];
    for (let i = 0; i < ax.length; i++) {
      const j = Math.min(ax.length - 1, i + 1);
      const k = j === i ? i - 1 : i;
      const dl = ax[j].distanceM - ax[k].distanceM || 1;
      slope.push((100 * (ax[k].elevationM - ax[j].elevationM)) / dl);
    }
    pisteIndex.set(p.id, pistes.length);
    pistes.push({
      id: p.id,
      name: p.name,
      classIndex: a.classIndex,
      closed: p.closed === true,
      distM: ax.map((s) => s.distanceM),
      xM: ax.map((s) => s.xM),
      yM: ax.map((s) => s.yM),
      widthM: ax.map((s) => s.widthM),
      elevM: ax.map((s) => s.elevationM),
      slopePercent: slope,
      lengthM: ax[ax.length - 1].distanceM,
    });
  }

  // Odcinki tras.
  const edges: NetEdge[] = [];
  for (const e of network.edges) {
    if (e.kind !== 'piste') continue;
    const pi = pisteIndex.get(e.objectId);
    const from = nodeIndex.get(e.from);
    const to = nodeIndex.get(e.to);
    if (pi === undefined || from === undefined || to === undefined) continue;
    const fromM = e.fromM ?? 0;
    const toM = e.toM ?? pistes[pi].lengthM;
    if (toM - fromM < 1) continue;
    edges.push({ piste: pi, from, to, fromM, toM, lengthM: toM - fromM, classIndex: pistes[pi].classIndex });
    if (nodes[from].hub !== nodes[to].hub) hubs[nodes[from].hub].outEdges.push(edges.length - 1);
  }

  // Wyciągi.
  const lifts: NetLift[] = [];
  for (const l of layout.lifts) {
    const a = input.lifts.get(l.id);
    const bottom = nodeIndex.get(`${l.id}:dół`);
    const top = nodeIndex.get(`${l.id}:góra`);
    if (!a || bottom === undefined || top === undefined) continue;
    const type = liftTypeById(input.liftParams, l.typeId);
    const seats = Math.max(1, type.carrierSeats);
    const intervalS = (3600 * seats) / type.capacityPerHour;
    const lengthM = a.slopeLengthM;
    lifts.push({
      id: l.id,
      name: l.name,
      typeName: type.name,
      aerial: type.kind === 'aerial',
      closed: l.closed === true,
      bottom,
      top,
      bottomX: l.bottom.xM,
      bottomY: l.bottom.yM,
      topX: l.top.xM,
      topY: l.top.yM,
      lengthM,
      rideS: lengthM / type.speedMs,
      speedMs: type.speedMs,
      seats,
      intervalS,
      capacityPerHour: type.capacityPerHour,
      windLimitMs: type.windLimitMs,
      topElevM: a.ground.length ? a.ground[a.ground.length - 1].elevationM : 0,
    });
    hubs[nodes[bottom].hub].lifts.push(lifts.length - 1);
  }

  // Bazy: wyjście i jedzenie; bez baz – najniższa dolna stacja.
  const baseHubs = [...new Set(nodes.filter((n) => n.kind === 'base').map((n) => n.hub))];
  for (const h of baseHubs) {
    hubs[h].exit = true;
    hubs[h].food = true;
  }
  let entryHubs = baseHubs;
  if (entryHubs.length === 0 && lifts.length > 0) {
    // Najniższa dolna stacja (wysokość z analizy wyciągu).
    let best = 0;
    let bestZ = Infinity;
    lifts.forEach((l, i) => {
      const a = input.lifts.get(l.id)!;
      const z = a.ground.length ? a.ground[0].elevationM : Infinity;
      if (z < bestZ) {
        bestZ = z;
        best = i;
      }
    });
    const h = nodes[lifts[best].bottom].hub;
    hubs[h].exit = true;
    entryHubs = [h];
  }
  for (const fp of input.foodPoints) {
    for (const h of hubs) if (Math.hypot(h.xM - fp.xM, h.yM - fp.yM) <= r * 1.5) h.food = true;
  }
  // Nazwy miejsc (do kart i raportu).
  for (const h of hubs) {
    const names: string[] = [];
    for (const i of h.nodes) {
      const n = nodes[i];
      if (n.kind === 'base') names.push(layout.bases.find((b) => b.id === n.id)?.name ?? 'baza');
      else if (n.kind === 'liftBottom' || n.kind === 'liftTop') {
        const lid = n.id.split(':')[0];
        const lname = layout.lifts.find((l) => l.id === lid)?.name ?? lid;
        names.push(`${lname} – ${n.kind === 'liftBottom' ? 'dolna' : 'górna'} stacja`);
      }
    }
    h.name = names[0] ?? (h.nodes.some((i) => nodes[i].kind === 'junction') ? 'skrzyżowanie tras' : 'na trasie');
  }
  return { nodes, hubs, pistes, edges, lifts, entryHubs, cellSizeM: input.grid.cellSizeM, widthCells: input.grid.widthCells, heightCells: input.grid.heightCells };
}
