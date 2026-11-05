import { describe, expect, it } from 'vitest';
import { computeContours, contourLevels, isMajorLevel, traceLevel } from '../src/sim/contours';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { flatGrid, planeGrid } from './terrainTestUtils';

const PARAMS = { intervalM: 10, majorIntervalM: 50 };

describe('Warstwice', () => {
  it('teren płaski nie ma warstwic – także gdy leży dokładnie na wysokości warstwicy', () => {
    expect(computeContours(flatGrid(1003), PARAMS)).toEqual([]);
    expect(computeContours(flatGrid(1000), PARAMS)).toEqual([]);
  });

  it('płaszczyzna opadająca na wschód: proste warstwice biegnące N–S, co 10 m wysokości', () => {
    // 20 % na 10-metrowej komórce = 2 m na komórkę → warstwica co 50 m w poziomie.
    const g = planeGrid(20, 90, { width: 40, height: 20, baseM: 1000 });
    const lines = computeContours(g, PARAMS);
    const levels = [...new Set(lines.map((l) => l.levelM))].sort((a, b) => a - b);
    expect(levels).toEqual(contourLevels(...Object.values(g.elevationRangeM()) as [number, number], 10));
    for (const line of lines) {
      expect(line.closed).toBe(false);
      // Każdy punkt: z(x) = 1000 − 0,2·x → x = (1000 − poziom) / 0,2.
      const expectedX = (1000 - line.levelM) / 0.2;
      for (let k = 0; k < line.points.length; k += 2) expect(line.points[k]).toBeCloseTo(expectedX, 2);
      // Linia przechodzi przez całą wysokość mapy (między środkami skrajnych komórek).
      const ys = Array.from(line.points.filter((_, k) => k % 2 === 1));
      expect(Math.min(...ys)).toBeCloseTo(5, 5);
      expect(Math.max(...ys)).toBeCloseTo(195, 5);
    }
  });

  it('pogrubione są tylko warstwice co 50 m', () => {
    const g = planeGrid(20, 90, { width: 40, height: 10, baseM: 1000 });
    for (const line of computeContours(g, PARAMS)) expect(line.major).toBe(line.levelM % 50 === 0);
    expect(isMajorLevel(1250, 50)).toBe(true);
    expect(isMajorLevel(1260, 50)).toBe(false);
  });

  it('pojedynczy pagórek na płaskim terenie: warstwice tylko wokół pagórka, zamknięte, na właściwej wysokości', () => {
    const w = 50;
    const cell = 10;
    const e = new Float32Array(w * w);
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) {
        const r = Math.hypot(i - 25, j - 25) * cell;
        e[j * w + i] = 1003 + Math.max(0, 45 - r * 0.3); // stożek 45 m wysokości, promień 150 m
      }
    }
    const g = new TerrainGrid(w, w, cell, e);
    const lines = computeContours(g, PARAMS);
    expect(lines.map((l) => l.levelM).sort((a, b) => a - b)).toEqual([1010, 1020, 1030, 1040]);
    for (const line of lines) {
      expect(line.closed).toBe(true);
      for (let k = 0; k < line.points.length; k += 2) {
        const x = line.points[k];
        const y = line.points[k + 1];
        // Wszystkie punkty w obrębie pagórka (promień 150 m od środka komórki 25,25).
        expect(Math.hypot(x - 255, y - 255)).toBeLessThan(150);
        // Na krawędziach kwadratów interpolacja liniowa = interpolacja dwuliniowa: punkt leży na poziomie.
        expect(g.sampleElevationM(x, y)).toBeCloseTo(line.levelM, 3);
      }
    }
  });

  it('kwadraty z komórką „poza mapą” są pomijane', () => {
    const g = planeGrid(20, 90, { width: 20, height: 20 });
    for (let j = 0; j < 20; j++) for (let i = 0; i < 20; i++) if (j >= 10) g.elevationM[g.index(i, j)] = Number.NaN;
    for (const line of computeContours(g, PARAMS)) {
      for (let k = 1; k < line.points.length; k += 2) expect(line.points[k]).toBeLessThanOrEqual(95 + 1e-6);
    }
  });

  it('siodło jest rozstrzygane bez rozrywania linii', () => {
    // 2 × 2 komórki w układzie szachownicy: wysoko–nisko / nisko–wysoko.
    const g = new TerrainGrid(2, 2, 10, Float32Array.from([20, 0, 0, 20]));
    const lines = traceLevel(g, 10);
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l.points.length).toBe(4);
  });

  it('poziomy warstwic: od pierwszej wielokrotności odstępu powyżej minimum do maksimum', () => {
    expect(contourLevels(617.2, 652, 10)).toEqual([620, 630, 640, 650]);
    expect(contourLevels(620, 620, 10)).toEqual([620]);
  });
});
