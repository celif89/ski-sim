import { describe, expect, it } from 'vitest';
import { generateTerrain } from '../src/sim/terrainGenerator';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { simSettings, terrainParams } from './helpers';

const map = simSettings.map;
const seed = simSettings.seed;
const terrain = generateTerrain(map, terrainParams, seed);

describe('Siatka terenu', () => {
  it('ma wymiary i rozmiar komórki z data/settings.json (start: 400 × 400 komórek po 10 m)', () => {
    expect(terrain.widthCells).toBe(map.widthCells);
    expect(terrain.heightCells).toBe(map.heightCells);
    expect(terrain.cellSizeM).toBe(map.cellSizeM);
    expect(terrain.elevationM).toBeInstanceOf(Float32Array);
    expect(terrain.elevationM.length).toBe(map.widthCells * map.heightCells);
    expect(terrain.widthM).toBe(map.widthCells * map.cellSizeM);
  });

  it('rozmiar siatki jest parametrem (np. 50 × 30 komórek po 5 m)', () => {
    const small = generateTerrain({ widthCells: 50, heightCells: 30, cellSizeM: 5 }, terrainParams, seed);
    expect(small.elevationM.length).toBe(1500);
    expect(small.widthM).toBe(250);
    expect(small.heightM).toBe(150);
  });

  it('odczyt wysokości w punkcie: w środku komórki zwraca wartość komórki, między – średnią ważoną', () => {
    const g = new TerrainGrid(2, 2, 10, Float32Array.from([100, 200, 300, 400]));
    expect(g.sampleElevationM(5, 5)).toBeCloseTo(100);
    expect(g.sampleElevationM(15, 5)).toBeCloseTo(200);
    expect(g.sampleElevationM(5, 15)).toBeCloseTo(300);
    expect(g.sampleElevationM(10, 10)).toBeCloseTo(250); // środek – średnia z czterech
    expect(g.sampleElevationM(10, 5)).toBeCloseTo(150);
    expect(g.sampleElevationM(0, 0)).toBeCloseTo(100); // róg mapy – wartość skrajnej komórki
    expect(Number.isNaN(g.sampleElevationM(-1, 5))).toBe(true); // poza mapą
    expect(Number.isNaN(g.sampleElevationM(5, 20.1))).toBe(true);
  });

  it('odrzuca nieprawidłowe wymiary', () => {
    expect(() => new TerrainGrid(0, 10, 10)).toThrow();
    expect(() => new TerrainGrid(10, 10, 0)).toThrow();
    expect(() => new TerrainGrid(2, 2, 10, new Float32Array(3))).toThrow();
  });
});

describe('Tymczasowy generator terenu', () => {
  it('ten sam seed daje identyczny teren', () => {
    const again = generateTerrain(map, terrainParams, seed);
    expect(again.elevationM).toEqual(terrain.elevationM);
  });

  it('inny seed daje inny teren', () => {
    const other = generateTerrain(map, terrainParams, seed + 1);
    let differentCells = 0;
    for (let k = 0; k < other.elevationM.length; k++) {
      if (Math.abs(other.elevationM[k] - terrain.elevationM[k]) > 1) differentCells++;
    }
    // Ponad połowa komórek różni się o więcej niż 1 m.
    expect(differentCells).toBeGreaterThan(other.elevationM.length / 2);
  });

  it('wysokości mieszczą się w zakresie z pliku danych (700–1500 m n.p.m.) i go wypełniają', () => {
    const { minM, maxM } = terrain.elevationRangeM();
    expect(minM).toBeGreaterThanOrEqual(terrainParams.minElevationM);
    expect(maxM).toBeLessThanOrEqual(terrainParams.maxElevationM);
    expect(minM).toBeCloseTo(terrainParams.minElevationM, 0);
    expect(maxM).toBeCloseTo(terrainParams.maxElevationM, 0);
    for (const h of terrain.elevationM) expect(Number.isFinite(h)).toBe(true);
  });

  it('zakres wysokości jest dotrzymany także dla wielu innych seedów', () => {
    for (let s = 1; s <= 10; s++) {
      const { minM, maxM } = generateTerrain(
        { widthCells: 100, heightCells: 100, cellSizeM: 40 },
        terrainParams,
        s * 7919,
      ).elevationRangeM();
      expect(minM).toBeGreaterThanOrEqual(terrainParams.minElevationM);
      expect(maxM).toBeLessThanOrEqual(terrainParams.maxElevationM);
    }
  });

  it('najwyżej jest w okolicy zadanego szczytu, a brzegi mapy leżą znacznie niżej', () => {
    const summitI = Math.floor(terrainParams.summitXFraction * map.widthCells);
    const summitJ = Math.floor(terrainParams.summitYFraction * map.heightCells);
    let maxK = 0;
    for (let k = 1; k < terrain.elevationM.length; k++) {
      if (terrain.elevationM[k] > terrain.elevationM[maxK]) maxK = k;
    }
    const maxI = maxK % map.widthCells;
    const maxJ = Math.floor(maxK / map.widthCells);
    const distanceM = Math.hypot(maxI - summitI, maxJ - summitJ) * map.cellSizeM;
    expect(distanceM).toBeLessThan(500);

    let edgeSum = 0;
    let edgeCount = 0;
    for (let i = 0; i < map.widthCells; i++) {
      edgeSum += terrain.getElevationM(i, 0) + terrain.getElevationM(i, map.heightCells - 1);
      edgeCount += 2;
    }
    const edgeMean = edgeSum / edgeCount;
    expect(terrain.elevationM[maxK] - edgeMean).toBeGreaterThan(400);
  });

  it('góra jest łagodna – nachylenia typowe dla stoków narciarskich, bez urwisk', () => {
    const cell = map.cellSizeM;
    const slopesDeg: number[] = [];
    for (let j = 1; j < map.heightCells - 1; j++) {
      for (let i = 1; i < map.widthCells - 1; i++) {
        const dzdx = (terrain.getElevationM(i + 1, j) - terrain.getElevationM(i - 1, j)) / (2 * cell);
        const dzdy = (terrain.getElevationM(i, j + 1) - terrain.getElevationM(i, j - 1)) / (2 * cell);
        slopesDeg.push((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI);
      }
    }
    slopesDeg.sort((a, b) => a - b);
    const median = slopesDeg[Math.floor(slopesDeg.length / 2)];
    const p99 = slopesDeg[Math.floor(slopesDeg.length * 0.99)];
    const max = slopesDeg[slopesDeg.length - 1];
    expect(median).toBeGreaterThan(5);
    expect(median).toBeLessThan(25);
    expect(p99).toBeLessThan(40);
    expect(max).toBeLessThan(50);
  });
});
