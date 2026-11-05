import { describe, expect, it } from 'vitest';
import {
  aspectFromGradient,
  computeHillshade,
  computeSlopeAndAspect,
  slopeDegToPercent,
  slopePercentToDeg,
} from '../src/sim/terrainAnalysis';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { flatGrid, planeGrid } from './terrainTestUtils';

function everyCell(grid: TerrainGrid, check: (k: number) => void): void {
  for (let k = 0; k < grid.cellCount; k++) check(k);
}

describe('Nachylenie i ekspozycja (metoda Horna)', () => {
  it('płaszczyzna 30 % opadająca na południe: nachylenie 30 % (16,7°), ekspozycja 180° – w każdej komórce, także na brzegach', () => {
    const g = planeGrid(30, 180);
    everyCell(g, (k) => {
      expect(g.slopePercent[k]).toBeCloseTo(30, 3);
      expect(g.aspectDeg[k]).toBeCloseTo(180, 3);
    });
    expect(slopePercentToDeg(30)).toBeCloseTo(16.7, 1);
  });

  it('płaszczyzna opadająca na wschód: ekspozycja 90°', () => {
    const g = planeGrid(30, 90);
    everyCell(g, (k) => {
      expect(g.slopePercent[k]).toBeCloseTo(30, 3);
      expect(g.aspectDeg[k]).toBeCloseTo(90, 3);
    });
  });

  it.each([
    [0, 'N'],
    [45, 'NE'],
    [135, 'SE'],
    [225, 'SW'],
    [270, 'W'],
    [315, 'NW'],
  ])('płaszczyzna opadająca w kierunku %i° (%s): ekspozycja zgodna', (az) => {
    const g = planeGrid(20, az);
    const a = g.aspectDeg[g.index(10, 10)];
    // 0° i 360° to ten sam kierunek.
    const diff = Math.abs(((a - az + 540) % 360) - 180);
    expect(diff).toBeLessThan(1e-3);
    expect(g.slopePercent[g.index(10, 10)]).toBeCloseTo(20, 3);
  });

  it('nachylenie nie zależy od rozmiaru komórki', () => {
    expect(planeGrid(45, 200, { cellSizeM: 1 }).slopePercent[50]).toBeCloseTo(45, 2);
    expect(planeGrid(45, 200, { cellSizeM: 25 }).slopePercent[50]).toBeCloseTo(45, 2);
  });

  it('teren płaski: nachylenie 0, ekspozycja nieokreślona', () => {
    const g = flatGrid(1234);
    everyCell(g, (k) => {
      expect(g.slopePercent[k]).toBe(0);
      expect(Number.isNaN(g.aspectDeg[k])).toBe(true);
    });
  });

  it('przeliczenie % ↔ stopnie: 100 % = 45°', () => {
    expect(slopePercentToDeg(100)).toBeCloseTo(45, 10);
    expect(slopeDegToPercent(45)).toBeCloseTo(100, 10);
    expect(slopeDegToPercent(slopePercentToDeg(37))).toBeCloseTo(37, 10);
  });

  it('kierunek spadku: dz/dx < 0 (teren obniża się na wschód) → 90°; dz/dy > 0 (wznosi się na południe) → 0°', () => {
    expect(aspectFromGradient(-1, 0)).toBeCloseTo(90);
    expect(aspectFromGradient(0, 1)).toBeCloseTo(0);
    expect(aspectFromGradient(0, -1)).toBeCloseTo(180);
    expect(aspectFromGradient(1, 0)).toBeCloseTo(270);
  });

  it('komórki „poza mapą” mają NaN, a ich sąsiedzi poprawne nachylenie (bez skoku na krawędzi)', () => {
    const g = planeGrid(25, 0, { width: 20, height: 20 });
    // Połowa mapy (południowa) poza mapą.
    for (let j = 10; j < 20; j++) for (let i = 0; i < 20; i++) g.elevationM[g.index(i, j)] = Number.NaN;
    computeSlopeAndAspect(g);
    expect(Number.isNaN(g.slopePercent[g.index(5, 15)])).toBe(true);
    for (let i = 0; i < 20; i++) {
      expect(g.slopePercent[g.index(i, 9)]).toBeCloseTo(25, 3); // tuż przy granicy
      expect(g.aspectDeg[g.index(i, 9)]).toBeCloseTo(0, 3);
    }
  });
});

describe('Cieniowanie rzeźby (światło z północnego zachodu)', () => {
  const params = { lightAzimuthDeg: 315, lightAltitudeDeg: 45, zFactor: 1 };

  it('stok zwrócony na NW jest jaśniejszy od płaskiego, a zwrócony na SE – ciemniejszy', () => {
    const flat = computeHillshade(flatGrid(1000), params)[50];
    const nw = computeHillshade(planeGrid(40, 315), params)[50];
    const se = computeHillshade(planeGrid(40, 135), params)[50];
    expect(flat).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(nw).toBeGreaterThan(flat);
    expect(se).toBeLessThan(flat);
  });

  it('stok prostopadły do światła dostaje pełne oświetlenie (1,0)', () => {
    // Światło 45° nad horyzontem z NW: stok 100 % (45°) opadający na NW jest do niego prostopadły.
    expect(computeHillshade(planeGrid(100, 315), params)[50]).toBeCloseTo(1, 5);
  });

  it('wartości w zakresie 0–1, NaN poza mapą', () => {
    const g = planeGrid(80, 135);
    g.elevationM[0] = Number.NaN;
    const hs = computeHillshade(g, params);
    expect(Number.isNaN(hs[0])).toBe(true);
    for (let k = 1; k < hs.length; k++) {
      expect(hs[k]).toBeGreaterThanOrEqual(0);
      expect(hs[k]).toBeLessThanOrEqual(1);
    }
  });
});
