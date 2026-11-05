import { describe, expect, it } from 'vitest';
import radiationJson from '../data/radiation.json';
import { computeHorizon, horizonAngleAt, parseHorizonParams } from '../src/sim/horizon';
import type { HorizonDem } from '../src/sim/horizon';
import { airMass, dailyRadiationSum, instantRadiation, parseRadiationParams, prepareSolarTerrain, skyRadiation } from '../src/sim/radiation';
import { sunDay, sunPosition } from '../src/sim/sun';
import { localToUtcMs } from '../src/sim/time';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { computeSlopeAndAspect } from '../src/sim/terrainAnalysis';
import { flatGrid, planeGrid } from './terrainTestUtils';

const HP = { ...parseHorizonParams(radiationJson), maxDistanceM: 3000 };
const RP = parseRadiationParams(radiationJson);
const LAT = 49.54;
const LON = 19.32;
const TZ = { standardOffsetHours: 1, euDaylightSaving: true };
const DEC21 = { year: 2026, month: 12, day: 21 };
const MAR21 = { year: 2026, month: 3, day: 21 };
const JUN21 = { year: 2026, month: 6, day: 21 };

/** Płaski teren 1000 m z wysoką ścianą (grzbietem) biegnącą W–E w wierszach j ≥ wallRow. */
function wallGrid(wallHeightM: number, wallRow: number, size = 60): TerrainGrid {
  const e = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) e[j * size + i] = j >= wallRow ? 1000 + wallHeightM : 1000;
  const g = new TerrainGrid(size, size, 10, e);
  computeSlopeAndAspect(g);
  return g;
}

describe('Horyzont', () => {
  it('teren płaski: horyzont 0° we wszystkich kierunkach, widok nieba = 1', () => {
    const g = flatGrid(1000, 30, 30);
    const hf = computeHorizon(g, null, HP);
    for (const a of hf.angleDeg) expect(a).toBeCloseTo(0, 6);
    for (const s of hf.skyViewFactor) expect(s).toBeCloseTo(1, 6);
  });

  it('ściana od południa: kąt horyzontu na południu = atan(wysokość / odległość)', () => {
    const g = wallGrid(100, 40); // ściana 100 m od wiersza 40 (y ≥ 400 m)
    const hf = computeHorizon(g, null, HP);
    const k = g.index(30, 19); // komórka 205 m na północ od podnóża ściany (y = 195 m)
    const expectedDeg = (Math.atan(100 / 205) * 180) / Math.PI;
    expect(horizonAngleAt(hf, k, 180)).toBeGreaterThan(expectedDeg - 1.5);
    expect(horizonAngleAt(hf, k, 180)).toBeLessThan(expectedDeg + 1.5);
    expect(horizonAngleAt(hf, k, 0)).toBeCloseTo(0, 6); // na północy otwarta przestrzeń
  });

  it('stok nachylony: horyzont pod górę = kąt nachylenia, widok nieba = (1 + cos β)/2', () => {
    const g = planeGrid(30, 0, { width: 60, height: 60 }); // stok opada na północ → pod górę na południe
    const hf = computeHorizon(g, null, HP);
    const k = g.index(30, 10);
    const slopeDeg = (Math.atan(0.3) * 180) / Math.PI;
    expect(horizonAngleAt(hf, k, 180)).toBeCloseTo(slopeDeg, 1);
    expect(hf.skyViewFactor[k]).toBeCloseTo((1 + Math.cos(Math.atan(0.3))) / 2, 2);
  });

  it('model terenu okolicy: góra poza mapą zasłania horyzont', () => {
    const g = flatGrid(1000, 20, 20); // mapa 200 × 200 m
    g.elevationM.fill(1000);
    // Okolica: 3 × 3 km, góra 1500 m 1 km na południe od mapy.
    const size = 100;
    const e = new Float32Array(size * size).fill(1000);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) if (j >= 70) e[j * size + i] = 1500;
    const geoGrid = new TerrainGrid(20, 20, 10, g.elevationM, { crs: 'EPSG:2180', westEastingM: 501400, northNorthingM: 201600 });
    computeSlopeAndAspect(geoGrid);
    const dem: HorizonDem = { westEastingM: 500000, northNorthingM: 203000, cellSizeM: 30, widthCells: size, heightCells: size, elevationM: e };
    // Góra zaczyna się na N = 203000 − 70·30 = 200900, mapa kończy się na N = 201400 → 500 m.
    const hf = computeHorizon(geoGrid, dem, HP);
    const k = geoGrid.index(10, 19); // przy południowej krawędzi mapy, N ≈ 201405
    const expectedDeg = (Math.atan(500 / 505) * 180) / Math.PI;
    expect(Math.abs(horizonAngleAt(hf, k, 180) - expectedDeg)).toBeLessThan(2);
  });
});

describe('Cienie i promieniowanie', () => {
  it('ściana od południa rzuca cień: w grudniowe południe komórki tuż za ścianą są w cieniu, dalsze w słońcu', () => {
    const g = wallGrid(100, 40);
    const st = prepareSolarTerrain(g, computeHorizon(g, null, HP));
    const noon = sunDay(DEC21, LAT, LON, TZ).solarNoonUtcMs;
    const rad = instantRadiation(st, noon, LAT, LON, 0, RP);
    // Słońce ok. 17° → cień sięga ok. 100 / tan 17° ≈ 330 m za ścianę.
    const near = rad[g.index(30, 30)]; // 105 m od ściany
    const far = rad[g.index(30, 2)]; // 375 m od ściany
    const sky = skyRadiation(sunPosition(noon, LAT, LON).elevationDeg, 1000, 0, 1, RP);
    expect(near).toBeLessThan(sky.directNormalWm2 * 0.1 + sky.diffuseHorizontalWm2 * 1.2); // tylko rozproszone
    expect(far).toBeGreaterThan(near * 2);
  });

  it('teren płaski nie ma cieni: każda komórka dostaje tyle samo', () => {
    const g = flatGrid(1000, 20, 20);
    const st = prepareSolarTerrain(g, computeHorizon(g, null, HP));
    const t = localToUtcMs({ ...DEC21, hour: 9 }, TZ);
    const rad = instantRadiation(st, t, LAT, LON, 0, RP);
    for (const v of rad) expect(v).toBeCloseTo(rad[0], 4);
    expect(rad[0]).toBeGreaterThan(0);
  });

  it('w grudniu stok północny 30 % dostaje wielokrotnie mniej energii niż południowy', () => {
    const north = planeGrid(30, 0, { width: 40, height: 40 });
    const south = planeGrid(30, 180, { width: 40, height: 40 });
    const sum = (g: TerrainGrid) => dailyRadiationSum(prepareSolarTerrain(g, computeHorizon(g, null, HP)), DEC21, LAT, LON, TZ, RP)[g.index(20, 20)];
    const n = sum(north);
    const s = sum(south);
    expect(s / n).toBeGreaterThan(3);
    // W czerwcu różnica jest dużo mniejsza.
    const sumJun = (g: TerrainGrid) => dailyRadiationSum(prepareSolarTerrain(g, computeHorizon(g, null, HP)), JUN21, LAT, LON, TZ, RP)[g.index(20, 20)];
    expect(sumJun(south) / sumJun(north)).toBeLessThan(1.6);
  });

  it('suma dobowa na płaskim terenie przy bezchmurnym niebie w realnym zakresie (grudzień ok. 1, marzec ok. 4–5, czerwiec ok. 8 kWh/m²)', () => {
    const g = flatGrid(1000, 10, 10);
    const st = prepareSolarTerrain(g, computeHorizon(g, null, HP));
    const dec = dailyRadiationSum(st, DEC21, LAT, LON, TZ, RP)[0];
    const mar = dailyRadiationSum(st, MAR21, LAT, LON, TZ, RP)[0];
    const jun = dailyRadiationSum(st, JUN21, LAT, LON, TZ, RP)[0];
    expect(dec).toBeGreaterThan(0.7);
    expect(dec).toBeLessThan(1.6);
    expect(mar).toBeGreaterThan(3.5);
    expect(mar).toBeLessThan(5.5);
    expect(jun).toBeGreaterThan(7);
    expect(jun).toBeLessThan(9.5);
  });

  it('zachmurzenie osłabia promieniowanie: pełne zachmurzenie daje ok. 25 % bezchmurnego', () => {
    const clear = skyRadiation(30, 1000, 0, 1, RP).globalHorizontalWm2;
    const cloudy = skyRadiation(30, 1000, 1, 1, RP).globalHorizontalWm2;
    expect(cloudy / clear).toBeCloseTo(0.25, 2);
    expect(skyRadiation(30, 1000, 1, 1, RP).directNormalWm2).toBe(0);
    expect(skyRadiation(30, 1000, 0.5, 1, RP).globalHorizontalWm2).toBeLessThan(clear);
  });

  it('wyżej w górach promieniowanie bezpośrednie jest silniejsze (cieńsza atmosfera)', () => {
    expect(skyRadiation(20, 1500, 0, 1, RP).directNormalWm2).toBeGreaterThan(skyRadiation(20, 600, 0, 1, RP).directNormalWm2);
    expect(airMass(90)).toBeCloseTo(1, 2);
    expect(airMass(30)).toBeCloseTo(2, 1);
  });
});
