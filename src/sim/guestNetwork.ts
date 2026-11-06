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
  /** Przystanki od dołu: węzeł, odległość po linii od dolnej stacji [m], położenie, wysokość. */
  stops: { node: number; slopeM: number; xM: number; yM: number; elevM: number }[];
  /** Wierzchołki linii (dół, załamania, góra) z odległością po linii – do rysowania jadących. */
  path: { xM: number; yM: number; slopeM: number }[];
  /** Można zjechać wyciągiem w dół (gondola albo opcja przy kanapie – etap 6b). */
  downhillRiding: boolean;
  /** Część miejsc dla jadących w dół (1 – gondola; kanapa – limit z lifts.json). */
  downhillSeatShare: number;
  /** Etap 6b: z żadnego parkingu nie da się dojść do stacji – wyciąg nie pracuje. */
  unreachable: boolean;
}

/** Punkt wsiadania: wyciąg i przystanek (dolna lub pośrednia stacja). */
export interface NetBoarding {
  lift: number;
  stop: number;
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
  /** Punkty wsiadania w tym miejscu (indeksy w GuestNet.boardings): dolne i pośrednie stacje. */
  boardings: number[];
  /** Wyciągi z górną lub pośrednią stacją tutaj, którymi można zjechać w dół (gondola): [wyciąg, przystanek]. */
  downhill: { lift: number; stop: number }[];
  /** Odcinki tras wychodzące z tego miejsca. */
  outEdges: number[];
  /** Jest tu jedzenie (baza, schronisko). */
  food: boolean;
  /** Stąd goście przyjeżdżają i tu kończą dzień (baza – parking; bez baz – najniższa dolna stacja). */
  exit: boolean;
  name: string;
  /** Etap 6b: pojemność parkingu w tym miejscu [osób na dzień] (Infinity – bez limitu). */
  capacityPersons: number;
}

export interface GuestNet {
  nodes: NetNode[];
  hubs: NetHub[];
  pistes: NetPiste[];
  edges: NetEdge[];
  lifts: NetLift[];
  boardings: NetBoarding[];
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
  /** Etap 6b: bazy z dojazdem (brak – wszystkie) i pojemność parkingów [osób] (brak – bez limitu). */
  accessibleBases?: Set<string> | null;
  baseCapacityPersons?: Map<string, number> | null;
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
      hubs.push({ nodes: [], xM: 0, yM: 0, boardings: [], downhill: [], outEdges: [], food: false, exit: false, name: '', capacityPersons: Infinity });
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
  const boardings: NetBoarding[] = [];
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
      stops: [],
      path: [l.bottom, ...(l.bends ?? []), l.top].map((q, i) => ({ xM: q.xM, yM: q.yM, slopeM: a.pathSlopeM[i] ?? 0 })),
      downhillRiding: type.downhillRiding || (l.downhill === true && type.downhillMaxSeatShare > 0),
      downhillSeatShare: type.downhillRiding ? 1 : l.downhill === true ? type.downhillMaxSeatShare : 0,
      unreachable: false,
    });
    const li = lifts.length - 1;
    // Przystanki: dolna, pośrednie (węzły „pośrN”), górna.
    let midNo = 0;
    for (const st of a.stops) {
      const id = st.kind === 'bottom' ? `${l.id}:dół` : st.kind === 'top' ? `${l.id}:góra` : `${l.id}:pośr${++midNo}`;
      const node = nodeIndex.get(id);
      if (node === undefined) continue;
      lifts[li].stops.push({ node, slopeM: st.slopeDistanceM, xM: st.xM, yM: st.yM, elevM: st.elevationM });
    }
    const stops = lifts[li].stops;
    stops.forEach((st, si) => {
      const h = nodes[st.node].hub;
      if (si < stops.length - 1) {
        boardings.push({ lift: li, stop: si });
        hubs[h].boardings.push(boardings.length - 1);
      }
      if (si > 0 && lifts[li].downhillRiding) hubs[h].downhill.push({ lift: li, stop: si });
    });
  }

  // Bazy: wyjście i jedzenie; bez baz – najniższa dolna stacja. Etap 6b: tylko bazy z dojazdem;
  // pojemność parkingów sumowana w miejscu.
  const acc = input.accessibleBases ?? null;
  const baseNodes = nodes.filter((n) => n.kind === 'base' && (!acc || acc.has(n.id)));
  const baseHubs = [...new Set(baseNodes.map((n) => n.hub))];
  for (const h of baseHubs) {
    hubs[h].exit = true;
    hubs[h].food = true;
    if (input.baseCapacityPersons) {
      let cap = 0;
      let limited = false;
      for (const n of baseNodes) {
        if (n.hub !== h) continue;
        const c = input.baseCapacityPersons.get(n.id);
        if (c !== undefined) {
          cap += c;
          limited = true;
        } else cap = Infinity;
      }
      hubs[h].capacityPersons = limited ? cap : Infinity;
    }
  }
  const anyBase = nodes.some((n) => n.kind === 'base');
  let entryHubs = baseHubs;
  if (entryHubs.length === 0 && lifts.length > 0 && !anyBase) {
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
  // Etap 6b: dostępność z parkingu – wyciąg, do którego stacji nie da się dojść, nie pracuje.
  if (entryHubs.length > 0 || anyBase) {
    const seen = new Uint8Array(hubs.length);
    const queue = [...entryHubs];
    for (const h of queue) seen[h] = 1;
    while (queue.length) {
      const h = queue.pop()!;
      const visit = (x: number) => {
        if (!seen[x]) {
          seen[x] = 1;
          queue.push(x);
        }
      };
      for (const b of hubs[h].boardings) {
        const bd = boardings[b];
        const l = lifts[bd.lift];
        if (l.closed) continue;
        for (let si = bd.stop + 1; si < l.stops.length; si++) visit(nodes[l.stops[si].node].hub);
      }
      for (const d of hubs[h].downhill) {
        const l = lifts[d.lift];
        if (l.closed) continue;
        for (let si = 0; si < d.stop; si++) visit(nodes[l.stops[si].node].hub);
      }
      for (const e of hubs[h].outEdges) if (!pistes[edges[e].piste].closed) visit(nodes[edges[e].to].hub);
      for (let o = 0; o < hubs.length; o++) if (!seen[o] && Math.hypot(hubs[o].xM - hubs[h].xM, hubs[o].yM - hubs[h].yM) <= r * 1.5) visit(o);
    }
    lifts.forEach((l) => {
      if (!l.stops.slice(0, -1).some((st) => seen[nodes[st.node].hub])) {
        l.unreachable = true;
        l.closed = true;
      }
    });
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
  return { nodes, hubs, pistes, edges, lifts, boardings, entryHubs, cellSizeM: input.grid.cellSizeM, widthCells: input.grid.widthCells, heightCells: input.grid.heightCells };
}
