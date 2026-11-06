/**
 * Etap 4: wyciągi, trasy, sieć ośrodka, wycinka, zapis, porównanie z prawdziwymi trasami Pilska.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import climateJson from '../data/climate/pilsko.json';
import constructionJson from '../data/construction.json';
import liftsJson from '../data/lifts.json';
import pistesJson from '../data/pistes.json';
import radiationJson from '../data/radiation.json';
import snowJson from '../data/snow.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import { computeHorizon, parseHorizonParams } from '../src/sim/horizon';
import type { LiftDesign } from '../src/sim/lifts';
import { analyzeLift, designLift, liftTypeById, parseLiftParams } from '../src/sim/lifts';
import type { PisteDesign } from '../src/sim/pistes';
import { analyzePiste, hardestSegment, parsePisteParams } from '../src/sim/pistes';
import { parseRadiationParams, prepareSolarTerrain } from '../src/sim/radiation';
import type { OsmResort, ResortLayout } from '../src/sim/resort';
import { LayoutHistory, analyzeResort, applyClearing, compareRealPistes, emptyLayout, parseConstructionParams, parseLayout, serializeLayout } from '../src/sim/resort';
import { Rng } from '../src/sim/rng';
import { parseSnowParams } from '../src/sim/snow';
import { SnowSeason, buildSolarCache, createSnowDomain } from '../src/sim/snowSeason';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { computeSlopeAndAspect } from '../src/sim/terrainAnalysis';
import { generateSeason, parseWeatherParams } from '../src/sim/weather';
import { loadMapFromDisk } from '../src/tools/loadMapFromDisk';
import { planeGrid } from './terrainTestUtils';

const lp = parseLiftParams(liftsJson);
const pp = parsePisteParams(pistesJson);
const clearing = parseConstructionParams(constructionJson).clearing;
const noCost = { forestCostPlnPerM2: 0, shrubCostPlnPerM2: 0, daysPerHectare: 0 };

/** Siatka z wysokością zależną tylko od y (oś N–S): h(y) [m]. */
function gridFromProfile(heightFn: (yM: number) => number, width = 30, height = 150, cell = 10): TerrainGrid {
  const z = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) z[j * width + i] = heightFn((j + 0.5) * cell);
  const g = new TerrainGrid(width, height, cell, z);
  computeSlopeAndAspect(g);
  return g;
}

function piste(points: [number, number][], widthM = 30, id = 'T1', name = '1'): PisteDesign {
  return { id, name, points: points.map(([xM, yM]) => ({ xM, yM, widthM })) };
}

const pisteCtx = (grid: TerrainGrid) => ({ grid, params: pp, forest: null, shrub: null, clearingCost: noCost });
const liftCtx = (grid: TerrainGrid, others: LiftDesign[] = []) => ({ grid, params: lp, forest: null, shrub: null, clearingCost: noCost, otherLifts: others });

describe('Klasyfikacja tras', () => {
  it('stoki o znanym nachyleniu: 8 % zielona, 20 % niebieska, 35 % czerwona, 50 % czarna', () => {
    for (const [slope, cls] of [
      [8, 'green'],
      [20, 'blue'],
      [35, 'red'],
      [50, 'black'],
    ] as const) {
      const g = planeGrid(slope, 180, { width: 30, height: 80 });
      // Oś z północy (góra) na południe (dół), rysowana od dołu – program sam ją odwróci.
      const a = analyzePiste(piste([[150, 700], [150, 100]]), pisteCtx(g));
      expect(a.reversed).toBe(true);
      expect(a.maxSlopePercent).toBeCloseTo(slope, 0);
      expect(pp.classes[a.classIndex].id).toBe(cls);
      expect(a.meanSlopePercent).toBeCloseTo(slope, 0);
    }
  });

  it('krótki stromy fragment (30 m, 45 %) na stoku 15 % nie zmienia koloru; 100 m – zmienia', () => {
    const profile = (steepM: number) => (y: number) => {
      // od y = 300 m stromy odcinek o długości steepM
      const before = Math.min(y, 300);
      const steep = Math.min(Math.max(y - 300, 0), steepM);
      const after = Math.max(y - 300 - steepM, 0);
      return 1500 - 0.15 * before - 0.45 * steep - 0.15 * after;
    };
    const short = analyzePiste(piste([[150, 50], [150, 1400]]), pisteCtx(gridFromProfile(profile(30))));
    expect(short.maxLocalSlopePercent).toBeGreaterThan(30); // stromy fragment widać na profilu
    expect(pp.classes[short.classIndex].id).toBe('blue');
    const long = analyzePiste(piste([[150, 50], [150, 1400]]), pisteCtx(gridFromProfile(profile(100))));
    expect(pp.classes[long.classIndex].id).toBe('black');
  });

  it('najtrudniejszy odcinek liczony na długości 50 m (z danych)', () => {
    expect(pp.segmentLengthM).toBe(50);
    // 100 m po 10 %, potem 100 m po 30 %: najtrudniejszy odcinek 50 m ma 30 %.
    const axis = Array.from({ length: 41 }, (_, i) => ({ distanceM: i * 5, elevationM: 1000 - (i * 5 <= 100 ? 0.1 * i * 5 : 10 + 0.3 * (i * 5 - 100)) }));
    expect(hardestSegment(axis, 50).slopePercent).toBeCloseTo(30, 5);
    // 40 m po 50 % w środku stoku 10 % – za krótko, wynik zostaje przy 10 %.
    const spike = Array.from({ length: 41 }, (_, i) => {
      const d = i * 5;
      const steep = Math.min(Math.max(d - 80, 0), 40);
      return { distanceM: d, elevationM: 1000 - 0.1 * (d - steep) - 0.5 * steep };
    });
    expect(hardestSegment(spike, 50).slopePercent).toBeCloseTo(10, 5);
  });

  it('trawers: duży spadek poprzeczny daje osobne ostrzeżenie', () => {
    const g = planeGrid(40, 90, { width: 80, height: 40 }); // stok opada na wschód
    // Oś z północy na południe – w poprzek stoku: wzdłuż płasko, w poprzek 40 %.
    const a = analyzePiste(piste([[400, 50], [400, 350]]), pisteCtx(g));
    expect(a.maxCrossSlopePercent).toBeGreaterThan(30);
    expect(a.issues.some((i) => /spadek poprzeczny/.test(i.message))).toBe(true);
  });

  it('statystyki: długość, przewyższenie, szerokość min./średnia', () => {
    const g = planeGrid(20, 180, { width: 30, height: 80 });
    const a = analyzePiste({ id: 'T', name: 'T', points: [{ xM: 150, yM: 100, widthM: 20 }, { xM: 150, yM: 600, widthM: 40 }] }, pisteCtx(g));
    expect(a.lengthM).toBeCloseTo(500, 0);
    expect(a.dropM).toBeCloseTo(100, 0);
    expect(a.minWidthM).toBe(20);
    expect(a.meanWidthM).toBe(30);
    expect(a.areaM2).toBeGreaterThan(500 * 20);
  });
});

describe('Wyciągi', () => {
  it('orczyk na stoku 60 % zostaje odrzucony z czytelnym komunikatem', () => {
    const g = planeGrid(60, 180, { width: 30, height: 60 });
    const lift = designLift(g, lp, 'W1', 'orczyk', 'W1', { xM: 150, yM: 550 }, { xM: 150, yM: 100 });
    const a = analyzeLift(lift, liftCtx(g));
    expect(a.ok).toBe(false);
    const msg = a.issues.find((i) => /za stromo/.test(i.message));
    expect(msg?.message).toMatch(/za stromo na wyciąg orczykowy: 60 % na \d+ m od dolnej stacji, dopuszczalne 45 %/);
    expect(msg?.distanceM).not.toBeNull();
    // Ten sam stok dla kanapy – bez ograniczenia nachylenia toru.
    const chair = analyzeLift(designLift(g, lp, 'W2', 'kanapa4d', 'W2', { xM: 150, yM: 550 }, { xM: 150, yM: 100 }), liftCtx(g));
    expect(chair.ok).toBe(true);
  });

  it('podpory zawsze zapewniają minimalny prześwit (losowe garby i doliny), przęsła nie dłuższe niż dopuszczalne', () => {
    const rng = new Rng(42);
    for (let trial = 0; trial < 12; trial++) {
      const bumps = Array.from({ length: 6 }, () => ({ y: rng.range(100, 1400), a: rng.range(-25, 25), w: rng.range(30, 200) }));
      const g = gridFromProfile((y) => 1500 - 0.3 * y + bumps.reduce((s, b) => s + b.a * Math.exp(-(((y - b.y) / b.w) ** 2)), 0));
      for (const typeId of ['kanapa2s', 'kanapa4d', 'gondola', 'orczyk']) {
        const type = liftTypeById(lp, typeId);
        const lift = designLift(g, lp, 'W', typeId, 'W', { xM: 150, yM: 1450 }, { xM: 150, yM: 50 });
        const a = analyzeLift(lift, liftCtx(g));
        expect(a.minClearanceM, `${typeId}, próba ${trial}`).toBeGreaterThanOrEqual(type.minClearanceM - 0.05);
        for (let i = 0; i < a.supports.length - 1; i++) expect(a.supports[i + 1].distanceM - a.supports[i].distanceM).toBeLessThanOrEqual(type.maxSpanM + 1e-6);
        for (const t of lift.towers) expect(t.heightM).toBeLessThanOrEqual(type.towerMaxHeightM + 1e-6);
      }
    }
  });

  it('czas przejazdu = długość / prędkość; liczby wyciągu', () => {
    const g = planeGrid(30, 180, { width: 30, height: 120 });
    const lift = designLift(g, lp, 'W1', 'kanapa4d', 'Kanapa', { xM: 150, yM: 1100 }, { xM: 150, yM: 100 });
    const a = analyzeLift(lift, liftCtx(g));
    const type = liftTypeById(lp, 'kanapa4d');
    expect(a.rideTimeS).toBeCloseTo(a.slopeLengthM / type.speedMs, 6);
    expect(a.horizontalLengthM).toBeCloseTo(1000, 0);
    expect(a.riseM).toBeCloseTo(300, 0);
    expect(a.slopeLengthM).toBeGreaterThan(Math.hypot(1000, 300) - 1);
    expect(a.slopeLengthM).toBeLessThan(Math.hypot(1000, 300) * 1.01);
    expect(a.capacityPerHour).toBe(2400);
    expect(a.powerKw).toBeGreaterThan(200);
    expect(a.cost.totalPln).toBeGreaterThan(type.stationCostPln);
    expect(a.buildDays).toBeGreaterThan(type.buildDaysBase);
  });

  it('nie da się postawić wyciągu przez granicę (poza mapę) ani przez inny wyciąg', () => {
    const g = planeGrid(25, 180, { width: 40, height: 60 });
    for (let j = 0; j < 10; j++) for (let i = 0; i < 40; i++) g.elevationM[g.index(i, j)] = Number.NaN; // „Słowacja” na północy
    const border = analyzeLift(designLift(g, lp, 'W1', 'kanapa2s', 'W1', { xM: 200, yM: 550 }, { xM: 200, yM: 30 }), liftCtx(g));
    expect(border.ok).toBe(false);
    expect(border.issues.some((i) => /poza mapę/.test(i.message))).toBe(true);
    const first = designLift(g, lp, 'W1', 'kanapa2s', 'Pierwszy', { xM: 100, yM: 550 }, { xM: 300, yM: 150 });
    const second = designLift(g, lp, 'W2', 'kanapa2s', 'Drugi', { xM: 300, yM: 550 }, { xM: 100, yM: 150 });
    const crossing = analyzeLift(second, liftCtx(g, [first]));
    expect(crossing.issues.some((i) => /krzyżuje się z wyciągiem „Pierwszy”/.test(i.message))).toBe(true);
    expect(crossing.ok).toBe(false);
  });

  it('wyciąg rysowany z góry na dół – błąd z wyjaśnieniem', () => {
    const g = planeGrid(25, 180, { width: 30, height: 60 });
    const a = analyzeLift(designLift(g, lp, 'W1', 'kanapa2s', 'W1', { xM: 150, yM: 100 }, { xM: 150, yM: 500 }), liftCtx(g));
    expect(a.issues.some((i) => /górna stacja leży/.test(i.message))).toBe(true);
  });
});

describe('Sieć ośrodka', () => {
  const g = planeGrid(25, 180, { width: 60, height: 120 });
  const ctx = { grid: g, lifts: lp, pistes: pp, clearing, forest: null, shrub: null };
  const lift = designLift(g, lp, 'W1', 'kanapa4d', 'W1', { xM: 300, yM: 1100 }, { xM: 300, yM: 100 });
  const goodPiste = piste([[330, 110], [330, 1090]], 30, 'T1', '1');

  it('trasa od górnej do dolnej stacji – sieć bez ostrzeżeń, graf: wyciąg w górę, trasa w dół', () => {
    const layout: ResortLayout = { ...emptyLayout(), lifts: [lift], pistes: [goodPiste] };
    const a = analyzeResort(layout, ctx);
    expect(a.network.issues).toEqual([]);
    expect(a.network.edges).toContainEqual(expect.objectContaining({ kind: 'lift', from: 'W1:dół', to: 'W1:góra' }));
    expect(a.network.edges).toContainEqual(expect.objectContaining({ kind: 'piste', from: 'W1:góra', to: 'W1:dół', objectId: 'T1' }));
  });

  it('wykrywa trasę bez połączenia i wyciąg bez zjazdu', () => {
    const lonely = piste([[550, 300], [550, 700]], 30, 'T2', '2');
    const a = analyzeResort({ ...emptyLayout(), lifts: [lift], pistes: [lonely] }, ctx);
    const msgs = a.network.issues.map((i) => i.message);
    expect(msgs.some((m) => /„2” zaczyna się donikąd/.test(m))).toBe(true);
    expect(msgs.some((m) => /„2” prowadzi donikąd/.test(m))).toBe(true);
    expect(msgs.some((m) => /wyciąg „W1” nie ma zjazdu/.test(m))).toBe(true);
  });

  it('trasa zaczynająca się na innej trasie i kończąca w bazie jest połączona', () => {
    const branch = piste([[340, 500], [500, 900]], 25, 'T2', '2');
    const layout: ResortLayout = { ...emptyLayout(), lifts: [lift], pistes: [goodPiste, branch], bases: [{ id: 'B1', name: 'Baza', xM: 500, yM: 920 }] };
    const a = analyzeResort(layout, ctx);
    // Połączenia tras bez ostrzeżeń; wyciąg (dolna stacja daleko od bazy) jest niedostępny z parkingu (etap 6b).
    expect(a.network.issues.filter((i) => !i.message.includes('niedostępn'))).toEqual([]);
    const fromJunction = a.network.edges.find((e) => e.objectId === 'T2');
    expect(fromJunction?.from).toMatch(/^T1@/);
    expect(fromJunction?.to).toBe('B1');
  });
});

describe('Wycinka i śnieg', () => {
  it('wycinka zmienia pokrycie, a model śniegu daje inny wynik na przecince niż w lesie', () => {
    const g = planeGrid(20, 0, { width: 20, height: 30, baseM: 1100 });
    const n = g.cellCount;
    const forest = new Float32Array(n).fill(1);
    const shrub = new Float32Array(n);
    const layout: ResortLayout = { ...emptyLayout(), pistes: [piste([[100, 20], [100, 280]], 40)] };
    const a = analyzeResort(layout, { grid: g, lifts: lp, pistes: pp, clearing, forest, shrub });
    const cleared = applyClearing(forest, shrub, a.clearedMask);
    const inside = g.index(10, 15);
    const outside = g.index(1, 15);
    expect(a.clearedMask[inside]).toBe(1);
    expect(cleared.forest[inside]).toBe(0);
    expect(cleared.forest[outside]).toBe(1);
    expect(a.totals.clearedForestM2).toBeGreaterThan(0);
    // Model śniegu na tym samym terenie i tej samej pogodzie: przecinka a las.
    const sp = parseSnowParams(snowJson);
    const profile = parseClimateProfile(climateJson);
    const wp = parseWeatherParams(wxJson);
    const rp = parseRadiationParams(radiationJson);
    const st = prepareSolarTerrain(g, computeHorizon(g, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 200 }));
    const location = { latDeg: 49.54, lonDeg: 19.32, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } };
    const weather = generateSeason(profile, wp, 2026, 2026, 160);
    const solar = buildSolarCache(st, weather[0].date, 155, location, rp, sp);
    const season = new SnowSeason({ domain: createSnowDomain(g, cleared.forest, cleared.shrub, sp), solar, weather, profile, weatherParams: wp, snowParams: sp, radiationParams: rp, location });
    let diff = 0;
    for (let d = 0; d < 150; d++) {
      season.stepDay();
      diff += Math.abs(season.state.totalWater(inside) - season.state.totalWater(outside));
    }
    expect(diff / 150).toBeGreaterThan(2); // średnio wyraźna różnica ilości wody w śniegu [mm]
  });
});

describe('Zapis i historia', () => {
  it('układ ośrodka: zapis do JSON i odczyt dają to samo; cofnij i ponów', () => {
    const g = planeGrid(25, 180, { width: 30, height: 60 });
    const before = emptyLayout();
    const after: ResortLayout = { ...emptyLayout(), lifts: [designLift(g, lp, 'W1', 'orczyk', 'W1', { xM: 150, yM: 550 }, { xM: 150, yM: 100 })], nextId: 2 };
    expect(parseLayout(JSON.parse(serializeLayout(after)))).toEqual(after);
    const h = new LayoutHistory();
    h.push(before);
    const undone = h.undo(after)!;
    expect(undone.lifts).toHaveLength(0);
    const redone = h.redo(undone)!;
    expect(redone.lifts).toHaveLength(1);
    expect(() => parseLayout({ version: 7 })).toThrow(/wersja/);
  });
});

describe('Prawdziwy ośrodek Pilsko (OpenStreetMap)', () => {
  const { grid } = loadMapFromDisk('pilsko');
  const osm = JSON.parse(readFileSync(new URL('../data/maps/pilsko/osm-resort.json', import.meta.url), 'utf8')) as OsmResort;
  it('dane OSM: wyciągi i trasy w obszarze mapy', () => {
    expect(osm.lifts.length).toBeGreaterThanOrEqual(5);
    expect(osm.pistes.length).toBeGreaterThanOrEqual(10);
  });
  it('nasza klasyfikacja prawdziwych tras zgadza się w większości z oficjalnymi kolorami, reszta różni się najwyżej o jedną klasę', () => {
    const rows = compareRealPistes(osm, grid, pp, (e, n) => grid.puwg92ToLocal(e, n));
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const agree = rows.filter((r) => r.agree).length;
    expect(agree / rows.length).toBeGreaterThan(0.5);
    const idx = (id: string | null) => pp.classes.findIndex((c) => c.id === id);
    for (const r of rows) expect(Math.abs(idx(r.ourClass) - idx(r.officialClass))).toBeLessThanOrEqual(1);
  });
});
