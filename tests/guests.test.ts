/**
 * Etap 5: goście (agenci) – kolejki, wybory tras, grupy, zamknięte trasy, zadowolenie, wpływ na
 * śnieg, determinizm. Ośrodek sztuczny (tests/guestFixture.ts) i prawdziwe Pilsko z OSM.
 */
import { describe, expect, it, vi } from 'vitest';
import osmJson from '../data/maps/pilsko/osm-resort.json';
import ctxJson from '../data/maps/pilsko/osm-context.json';
import snowJson from '../data/snow.json';
import type { GuestParams } from '../src/sim/guestParams';
import { buildGuestNet } from '../src/sim/guestNetwork';
import { DRAW_BOARD, DRAW_SKI, FRAME_STRIDE, G_LIFT, G_PISTE, G_QUEUE, GuestDay, satisfactionScore } from '../src/sim/guests';
import { designLift } from '../src/sim/lifts';
import type { OsmResort } from '../src/sim/resort';
import { analyzeResort, layoutFromOsm } from '../src/sim/resort';
import { SnowState, classifySnow, parseSnowParams } from '../src/sim/snow';
import { applySkierTraffic, decayMoguls, downhillNeighbors } from '../src/sim/skierTraffic';
import { loadMapFromDisk } from '../src/tools/loadMapFromDisk';
import { buildFixture, calmWeather, gp, lp, newDay, pp } from './guestFixture';

// Testy liczą całe dni z tysiącami gości – kilka do kilkunastu sekund każdy.
vi.setConfig({ testTimeout: 120_000 });

type Internals = { mstate: Uint8Array; rideT: Float64Array; gReason: Uint8Array };
const internals = (d: GuestDay) => d as unknown as Internals;

/** Przebieg dnia z podglądem co `everyS` sekund. */
function runDay(d: GuestDay, untilH: number, everyS: number, look: (d: GuestDay) => void): void {
  const dt = d.p.operation.stepS;
  let next = d.t + everyS;
  while (d.t < untilH * 3600) {
    d.step(dt);
    if (d.t >= next) {
      look(d);
      next += everyS;
    }
  }
}

describe('Wyciągi: kolejka i przejazd', () => {
  it('wjeżdżających w ciągu każdej godziny nigdy więcej niż przepustowość (tłum 3000 gości)', () => {
    const f = buildFixture();
    const d = newDay(f, 3000);
    const history: number[][] = f.net.lifts.map(() => []);
    runDay(d, 17, 60, (dd) => f.net.lifts.forEach((_, l) => history[l].push(dd.liftBoarded[l])));
    let maxQueue = 0;
    f.net.lifts.forEach((lift, l) => {
      const h = history[l];
      for (let i = 60; i < h.length; i++) {
        const perHour = h[i] - h[i - 60];
        expect(perHour).toBeLessThanOrEqual(lift.capacityPerHour + lift.seats);
      }
      maxQueue = Math.max(maxQueue, ...[d.queueLength(l)]);
    });
    // Tłum był: na zielonym wyciągu kolejka i pełne wykorzystanie.
    const rep = d.report();
    const w1 = rep.busiestLifts.find((x) => x.name === 'W1')!;
    expect(w1.maxQueue).toBeGreaterThan(100);
    expect(w1.utilization).toBeGreaterThan(0.85);
    expect(w1.utilization).toBeLessThanOrEqual(1);
  });

  it('czas przejazdu = długość liny / prędkość', () => {
    const f = buildFixture();
    for (const l of f.net.lifts) expect(l.rideS).toBeCloseTo(l.lengthM / l.speedMs, 6);
    const d = newDay(f, 300);
    const start = new Map<number, number>();
    const measured: number[] = [];
    const m = internals(d);
    const prev = new Uint8Array(d.n);
    runDay(d, 11, d.p.operation.stepS, (dd) => {
      for (let i = 0; i < dd.n; i++) {
        const st = m.mstate[i];
        if (st === 2 && prev[i] !== 2) start.set(i, m.rideT[i]);
        if (st === 3 && prev[i] === 2 && start.has(i)) measured.push(dd.t - start.get(i)!);
        prev[i] = st;
      }
    });
    expect(measured.length).toBeGreaterThan(50);
    const ride = f.net.lifts[0].rideS;
    // Wszystkie przejazdy trwają dokładnie tyle (± krok symulacji), na obu wyciągach podobnie długich.
    for (const t of measured) expect(Math.abs(t - ride)).toBeLessThan(Math.abs(f.net.lifts[1].rideS - ride) + 2 * d.p.operation.stepS);
  });
});

describe('Wybór tras według umiejętności', () => {
  it('początkujący nigdy nie wjeżdżają na czarną górę ani nie zjeżdżają czarną trasą', () => {
    const f = buildFixture();
    const d = newDay(f, 1500);
    const black = f.net.pistes.findIndex((p) => p.name === 'Czarna');
    expect(f.net.pistes[black].classIndex).toBe(3);
    const blackLift = f.net.lifts.findIndex((l) => l.name === 'W2');
    let beginnersSeen = 0;
    runDay(d, 17, 20, (dd) => {
      for (let g = 0; g < dd.g; g++) {
        if (dd.gSkill[g] !== 0) continue;
        const st = dd.gState[g];
        if (st === G_PISTE) {
          beginnersSeen++;
          expect(f.net.edges[dd.gEdge[g]].piste).not.toBe(black);
        }
        if (st === G_QUEUE || st === G_LIFT) expect(dd.gLift[g]).not.toBe(blackLift);
      }
    });
    expect(beginnersSeen).toBeGreaterThan(100);
  });

  it('eksperci wolą trudniejsze trasy, gdy są dostępne', () => {
    const f = buildFixture();
    const d = newDay(f, 1500);
    const black = f.net.pistes.findIndex((p) => p.name === 'Czarna');
    let onBlack = 0;
    let onGreen = 0;
    runDay(d, 17, 30, (dd) => {
      for (let g = 0; g < dd.g; g++) {
        if (dd.gSkill[g] !== 3 || dd.gState[g] !== G_PISTE) continue;
        if (f.net.edges[dd.gEdge[g]].piste === black) onBlack++;
        else onGreen++;
      }
    });
    expect(onBlack).toBeGreaterThan(2 * onGreen);
  });
});

describe('Kolejki a zadowolenie i wybory', () => {
  const base = { skiS: 3600, snowScore: 0.85, crowdScore: 0.9, weatherScore: 0.8, matchScore: 0.9, accident: false };

  it('dłuższy czas w kolejce – mniejsze zadowolenie (dla każdego czasu jazdy)', () => {
    for (const skiS of [600, 3600, 10800]) {
      let prev = Infinity;
      for (const q of [0, 600, 1800, 3600, 7200, 14400]) {
        const s = satisfactionScore({ ...base, skiS, queueS: q }, gp.satisfaction);
        expect(s).toBeLessThanOrEqual(prev + 1e-12);
        prev = s;
      }
    }
    expect(satisfactionScore({ ...base, queueS: 7200 }, gp.satisfaction)).toBeLessThan(satisfactionScore({ ...base, queueS: 300 }, gp.satisfaction) - 0.1);
  });

  it('wolniejsze wyciągi (dłuższe kolejki) – niższe oceny dnia', () => {
    const fast = newDay(buildFixture(), 1500);
    fast.advanceTo(17.5 * 3600);
    const slow = newDay(buildFixture({ liftTypes: ['talerzyk', 'talerzyk'] }), 1500);
    slow.advanceTo(17.5 * 3600);
    const rf = fast.report();
    const rs = slow.report();
    expect(rs.meanQueueMin).toBeGreaterThan(rf.meanQueueMin);
    expect(rs.meanRating).toBeLessThan(rf.meanRating);
  });

  it('przy długiej kolejce na jednym wyciągu goście przenoszą się na drugi', () => {
    // Dwa wyciągi na tę samą górę: W1 wolny (talerzyk 700 os./h), W2 szybki (kanapa 4d 2400 os./h).
    const f = buildFixture({ twinLifts: true, liftTypes: ['talerzyk', 'kanapa4d'] });
    const d = newDay(f, 2500);
    d.advanceTo(17.5 * 3600);
    const r = d.report();
    const w1 = r.busiestLifts.find((x) => x.name === 'W1')!;
    const w2 = r.busiestLifts.find((x) => x.name === 'W2')!;
    expect(d.queueSwitches).toBeGreaterThan(0); // większość wybiera krótszą kolejkę od razu, część rezygnuje w trakcie
    expect(w2.rides).toBeGreaterThan(1.5 * w1.rides);
    // Bez patrzenia na kolejki (kara 0, nieskończona cierpliwość) – na wolnym wyciągu czeka się znacznie dłużej.
    const blind: GuestParams = {
      ...gp,
      choice: { ...gp.choice, queuePenaltyPerMin: 0, overPatiencePenalty: 0 },
      traits: { ...gp.traits, patienceMeanMin: 1e6, patienceMinMin: 1e6, giveUpFactor: 1e6 },
    };
    const db = newDay(f, 2500, 12345, blind);
    db.advanceTo(17.5 * 3600);
    const b1 = db.report().busiestLifts.find((x) => x.name === 'W1')!;
    expect(b1.maxWaitMin).toBeGreaterThan(2 * w1.maxWaitMin);
  });
});

describe('Grupy, zamknięte trasy, las', () => {
  it('grupa trzyma się razem (członkowie jadą tą samą trasą, blisko siebie)', () => {
    const f = buildFixture();
    const d = newDay(f, 1500);
    const buf = new Float32Array(d.n * FRAME_STRIDE + 64 * FRAME_STRIDE);
    let checked = 0;
    runDay(d, 16, 120, (dd) => {
      const n = dd.writeFrame(buf);
      const pos = new Map<number, [number, number]>();
      for (let k = 0; k < n; k++) pos.set(buf[k * FRAME_STRIDE], [buf[k * FRAME_STRIDE + 1], buf[k * FRAME_STRIDE + 2]]);
      for (let g = 0; g < dd.g; g++) {
        if (dd.gState[g] !== G_PISTE || dd.gCount[g] < 3) continue;
        const pts = [...Array(dd.gCount[g]).keys()].map((k) => pos.get(dd.gStart[g] + k)!);
        let maxD = 0;
        for (const a of pts) for (const b of pts) maxD = Math.max(maxD, Math.hypot(a[0] - b[0], a[1] - b[1]));
        expect(maxD).toBeLessThan(dd.p.movement.groupGapM * dd.gCount[g] + 40);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(50);
  });

  it('nikt nie zjeżdża zamkniętą trasą, a eksperci jeżdżą wtedy otwartymi', () => {
    const f = buildFixture({ closeBlack: true });
    const d = newDay(f, 1000);
    const black = f.net.pistes.findIndex((p) => p.name === 'Czarna');
    let skiing = 0;
    runDay(d, 17, 30, (dd) => {
      for (let g = 0; g < dd.g; g++) {
        if (dd.gState[g] !== G_PISTE) continue;
        skiing++;
        expect(f.net.edges[dd.gEdge[g]].piste).not.toBe(black);
      }
    });
    expect(skiing).toBeGreaterThan(100);
  });

  it('jadący są zawsze w korytarzu trasy (nie w lesie)', () => {
    const f = buildFixture();
    const d = newDay(f, 1500);
    const buf = new Float32Array(d.n * FRAME_STRIDE + 64 * FRAME_STRIDE);
    let n0 = 0;
    // Odległość punktu od osi trasy (łamana) [m].
    const distToAxis = (pi: number, x: number, y: number) => {
      const p = f.net.pistes[pi];
      let best = Infinity;
      let w = 0;
      for (let i = 0; i < p.xM.length - 1; i++) {
        const dx = p.xM[i + 1] - p.xM[i];
        const dy = p.yM[i + 1] - p.yM[i];
        const t = Math.max(0, Math.min(1, ((x - p.xM[i]) * dx + (y - p.yM[i]) * dy) / (dx * dx + dy * dy || 1)));
        const dd = Math.hypot(x - p.xM[i] - t * dx, y - p.yM[i] - t * dy);
        if (dd < best) {
          best = dd;
          w = p.widthM[i];
        }
      }
      return { dist: best, half: w / 2 };
    };
    runDay(d, 16, 90, (dd) => {
      const n = dd.writeFrame(buf);
      for (let k = 0; k < n; k++) {
        const o = k * FRAME_STRIDE;
        const kind = buf[o + 6];
        if (kind !== DRAW_SKI && kind !== DRAW_BOARD) continue;
        const g = dd.grp[buf[o]];
        if (dd.gState[g] !== G_PISTE) continue;
        const r = distToAxis(f.net.edges[dd.gEdge[g]].piste, buf[o + 1], buf[o + 2]);
        expect(r.dist).toBeLessThanOrEqual(r.half + 0.5);
        n0++;
      }
    });
    expect(n0).toBeGreaterThan(500);
  });
});

describe('Wpływ narciarzy na śnieg', () => {
  const sp = parseSnowParams(snowJson);
  // Stok 40 % (z północy na południe), 20 × 20 komórek, 60 cm osiadłego śniegu.
  const w = 20;
  const h = 20;
  const elevationM = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) elevationM[j * w + i] = 1500 - 0.4 * j * 10;
  const dom = { elevationM, widthCells: w, heightCells: h, cellSizeM: 10 };
  const fresh = () => {
    const s = new SnowState(w * h);
    for (let k = 0; k < w * h; k++) {
      s.topSwe[k] = 120;
      s.topDensity[k] = 250;
      s.topTemp[k] = -3;
      s.botSwe[k] = 60;
      s.botDensity[k] = 350;
      s.botTemp[k] = -2;
      s.topAgeDays[k] = 1;
    }
    return s;
  };
  const down = downhillNeighbors(dom);

  it('przejazdy ubijają śnieg, tworzą muldy na stromym, zsuwają śnieg w dół (masa zachowana)', () => {
    const s = fresh();
    const passes = new Float32Array(w * h);
    const k = 10 * w + 10;
    passes[k] = 800;
    const totalBefore = [...Array(w * h).keys()].reduce((a, i) => a + s.totalWater(i), 0);
    const depthBefore = s.depthM(k);
    const r = applySkierTraffic(s, dom, down, passes, gp.snowImpact, sp);
    const totalAfter = [...Array(w * h).keys()].reduce((a, i) => a + s.totalWater(i), 0);
    expect(totalAfter).toBeCloseTo(totalBefore, 3);
    expect(r.movedMm).toBeGreaterThan(0);
    expect(s.topDensity[k]).toBeGreaterThan(400);
    expect(s.depthM(k)).toBeLessThan(depthBefore * 0.7);
    expect(s.moguls[k]).toBeGreaterThan(0.5);
    // Śnieg zsunięty niżej (komórka poniżej, na południe – większe j).
    expect(s.totalWater(down[k])).toBeGreaterThan(180);
    expect(Math.floor(down[k] / w)).toBe(11);
  });

  it('wiele przejazdów przez kolejne dni wyciera stromy odcinek do przetarć; łagodny zostaje', () => {
    const s = fresh();
    const passes = new Float32Array(w * h);
    const steep = 5 * w + 5;
    passes[steep] = 1500;
    for (let day = 0; day < 4; day++) applySkierTraffic(s, dom, down, passes, gp.snowImpact, sp);
    expect(['thin', 'none']).toContain(classifySnow(s, steep, sp));
    // Na płaskim (bez zsuwania) – tylko ubity, nie wytarty.
    const flatDom = { ...dom, elevationM: new Float32Array(w * h).fill(1000) };
    const s2 = fresh();
    applySkierTraffic(s2, flatDom, downhillNeighbors(flatDom), passes, gp.snowImpact, sp);
    expect(s2.totalWater(steep)).toBeCloseTo(180, 3);
    expect(s2.moguls[steep]).toBe(0);
  });

  it('świeży śnieg zasypuje muldy', () => {
    const s = fresh();
    const k = 3;
    s.moguls[k] = 1;
    const before = [s.totalWater(k)];
    s.topSwe[k] += 30;
    decayMoguls(s, [k], before, gp.snowImpact);
    expect(s.moguls[k]).toBeLessThan(0.2);
  });

  it('dzień gości zostawia przejazdy tylko na trasach, najwięcej na najczęściej uczęszczanych', () => {
    const f = buildFixture();
    const d = newDay(f, 1500);
    d.advanceTo(17.5 * 3600);
    const cells = new Set<number>();
    for (const p of f.net.pistes) {
      for (let i = 0; i < p.xM.length; i++) {
        const ci = Math.floor(p.xM[i] / 10);
        const cj = Math.floor(p.yM[i] / 10);
        const r = Math.ceil(p.widthM[i] / 20) + 1;
        for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) cells.add((cj + dj) * f.grid.widthCells + ci + di);
      }
    }
    let onPiste = 0;
    let off = 0;
    d.passes.forEach((v, k) => {
      if (v <= 0) return;
      if (cells.has(k)) onPiste += v;
      else off += v;
    });
    expect(onPiste).toBeGreaterThan(10000);
    expect(off).toBe(0);
  });
});

describe('Determinizm', () => {
  it('ten sam seed – ten sam dzień (ramka i raport); inny seed – inny', () => {
    const f = buildFixture();
    const a = newDay(f, 800, 7);
    const b = newDay(f, 800, 7);
    const c = newDay(f, 800, 8);
    for (const d of [a, b, c]) d.advanceTo(12 * 3600);
    const fa = new Float32Array(a.n * FRAME_STRIDE + 640);
    const fb = new Float32Array(b.n * FRAME_STRIDE + 640);
    const na = a.writeFrame(fa);
    const nb = b.writeFrame(fb);
    expect(nb).toBe(na);
    expect(Array.from(fb.subarray(0, nb * FRAME_STRIDE))).toEqual(Array.from(fa.subarray(0, na * FRAME_STRIDE)));
    expect(JSON.stringify(b.report())).toBe(JSON.stringify(a.report()));
    expect(JSON.stringify(c.report())).not.toBe(JSON.stringify(a.report()));
  });

  it('wynik nie zależy od tego, jak dzielimy czas (kroki co 1 s albo skoki do godziny)', () => {
    const f = buildFixture();
    const a = newDay(f, 600, 3);
    const b = newDay(f, 600, 3);
    a.advanceTo(13 * 3600);
    for (let t = b.t; t < 13 * 3600; t += 7 * 60) b.advanceTo(t);
    b.advanceTo(13 * 3600);
    expect(JSON.stringify(b.report())).toBe(JSON.stringify(a.report()));
  });
});

describe('Prawdziwy ośrodek Pilsko (OSM) z gośćmi', () => {
  it('układ z OSM: 12 wyciągów, trasy, bazy przy parkingach; dzień 2000 gości bez błędów', () => {
    const { grid } = loadMapFromDisk('pilsko');
    const parkings = (ctxJson as { parkings: { points: number[][] }[] }).parkings.map((pk) => {
      const pts = pk.points.map(([e, n]) => grid.puwg92ToLocal(e, n)!).filter(Boolean);
      return { xM: pts.reduce((s, q) => s + q.xM, 0) / pts.length, yM: pts.reduce((s, q) => s + q.yM, 0) / pts.length };
    });
    const layout = layoutFromOsm(osmJson as unknown as OsmResort, grid, lp, pp, (e, n) => grid.puwg92ToLocal(e, n), { snapToStationM: 150, parkings }, (id, t, name, b, top) => designLift(grid, lp, id, t, name, b, top));
    expect(layout.lifts).toHaveLength(12);
    expect(layout.pistes.length).toBeGreaterThan(10);
    expect(layout.bases.length).toBeGreaterThan(0);
    const a = analyzeResort(layout, { grid, lifts: lp, pistes: pp, clearing: { forestCostPlnPerM2: 0, shrubCostPlnPerM2: 0, daysPerHectare: 0 }, forest: null, shrub: null });
    const net = buildGuestNet({ layout, lifts: a.lifts, pistes: a.pistes, network: a.network, liftParams: lp, pisteParams: pp, stationWalkRadiusM: gp.operation.stationWalkRadiusM, foodPoints: [], grid });
    const d = new GuestDay(net, gp, { seed: 1, date: { year: 2027, month: 1, day: 16 }, guests: 2000, elevationM: grid.elevationM });
    d.setConditions({ ...calmWeather, bottomElevM: 650, topElevM: 1500 });
    const t0 = performance.now();
    d.advanceTo(17.5 * 3600);
    const ms = performance.now() - t0;
    const r = d.report();
    expect(r.counts.arrived).toBe(2000);
    expect(r.counts.gone).toBe(2000);
    expect(r.liftRides).toBeGreaterThan(10000);
    expect(Number.isFinite(r.meanRating)).toBe(true);
    expect(r.meanRating).toBeGreaterThan(2);
    // Wydajność: cały dzień 2000 gości (ok. 32 tys. kroków po 1 s) w wątku – kilka sekund.
    expect(ms).toBeLessThan(30000);
  });
});
