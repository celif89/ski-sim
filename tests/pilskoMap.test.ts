import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGridFromMap, parseMapDefinition } from '../src/sim/mapFile';
import { computeSlopeAndAspect } from '../src/sim/terrainAnalysis';
import { latLonToPuwg92 } from '../src/sim/geo';

const MAP_DIR = join(__dirname, '..', 'data', 'maps', 'pilsko');
const mapJson = JSON.parse(readFileSync(join(MAP_DIR, 'map.json'), 'utf8'));
const def = parseMapDefinition(mapJson);
const buffer = readFileSync(join(MAP_DIR, def.elevationFile));
const grid = createGridFromMap(def, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
computeSlopeAndAspect(grid);

/** Wysokość w punkcie o współrzędnych PUWG 1992. */
function elevationAt(eastingM: number, northingM: number): number {
  const p = grid.puwg92ToLocal(eastingM, northingM)!;
  return grid.sampleElevationM(p.xM, p.yM);
}

describe('Mapa Pilska (NMT z Geoportalu)', () => {
  it('siatka 10 m, ok. 4 × 4,5 km, w układzie PUWG 1992', () => {
    expect(grid.cellSizeM).toBe(10);
    expect(grid.widthM).toBe(4000);
    expect(grid.heightM).toBe(4500);
    expect(grid.georef?.crs).toBe('EPSG:2180');
  });

  it('Hala Miziowa (ok. 49,54° N, 19,32° E) leży na mapie', () => {
    const p = latLonToPuwg92(49.54, 19.32);
    const local = grid.puwg92ToLocal(p.eastingM, p.northingM)!;
    expect(grid.containsPointM(local.xM, local.yM)).toBe(true);
    expect(Number.isNaN(elevationAt(p.eastingM, p.northingM))).toBe(false);
  });

  it('wysokości w realnym zakresie (ok. 600–1550 m n.p.m.)', () => {
    const { minM, maxM } = grid.elevationRangeM();
    expect(minM).toBeGreaterThan(600);
    expect(minM).toBeLessThan(720);
    expect(maxM).toBeGreaterThan(1450);
    expect(maxM).toBeLessThan(1560);
  });

  it('najwyżej jest przy granicy (południe), najniżej w stronę Korbielowa (północ)', () => {
    let maxK = -1;
    let minK = -1;
    for (let k = 0; k < grid.cellCount; k++) {
      const h = grid.elevationM[k];
      if (Number.isNaN(h)) continue;
      if (maxK < 0 || h > grid.elevationM[maxK]) maxK = k;
      if (minK < 0 || h < grid.elevationM[minK]) minK = k;
    }
    const rowOf = (k: number) => Math.floor(k / grid.widthCells);
    // Najwyższa komórka w południowych 500 m mapy, najniższa w północnych 500 m.
    expect(rowOf(maxK)).toBeGreaterThan(grid.heightCells - 50);
    expect(rowOf(minK)).toBeLessThan(50);
    // Najwyższa komórka sąsiaduje z obszarem poza mapą (granicą) w promieniu 100 m.
    const i0 = maxK % grid.widthCells;
    const j0 = rowOf(maxK);
    let nearBorder = false;
    for (let dj = -10; dj <= 10; dj++) for (let di = -10; di <= 10; di++) {
      const i = i0 + di;
      const j = j0 + dj;
      if (i >= 0 && j >= 0 && i < grid.widthCells && j < grid.heightCells && !grid.isCellValid(i, j)) nearBorder = true;
    }
    expect(nearBorder).toBe(true);
  });

  it('średnio teren wznosi się z północy na południe (pasy po 1 km)', () => {
    const bandMean = (fromRow: number, toRow: number) => {
      let sum = 0;
      let n = 0;
      for (let j = fromRow; j < toRow; j++) for (let i = 0; i < grid.widthCells; i++) {
        const h = grid.getElevationM(i, j);
        if (!Number.isNaN(h)) { sum += h; n++; }
      }
      return sum / n;
    };
    const bands = [0, 100, 200, 300, 400].map((r) => bandMean(r, r + 50));
    for (let b = 1; b < bands.length; b++) expect(bands[b]).toBeGreaterThan(bands[b - 1]);
    expect(bands[4] - bands[0]).toBeGreaterThan(400);
  });

  it('strona słowacka jest „poza mapą”, a polska nie ma dziur w danych', () => {
    // Punkt na południe od granicy (Słowacja) i punkt na Hali Miziowej (Polska).
    expect(Number.isNaN(elevationAt(521600, 184900))).toBe(true);
    expect(Number.isNaN(elevationAt(525400, 184900))).toBe(true);
    expect(Number.isNaN(elevationAt(523000, 185950))).toBe(false);
    // Cała północna połowa mapy (daleko od granicy) ma dane.
    for (let j = 0; j < 225; j++) for (let i = 0; i < grid.widthCells; i++) expect(grid.isCellValid(i, j)).toBe(true);
    // Poza mapą ok. 9% komórek (pas przy granicy).
    const outside = grid.elevationM.filter((h) => Number.isNaN(h)).length / grid.cellCount;
    expect(outside).toBeGreaterThan(0.03);
    expect(outside).toBeLessThan(0.2);
  });

  it('wysokości punktów kontrolnych zgadzają się z usługą Geoportalu (±3 m)', () => {
    expect(def.controlPoints.length).toBeGreaterThanOrEqual(3);
    for (const p of def.controlPoints) {
      expect(p.geoportalElevationM, p.name).toBeTypeOf('number');
      expect(Math.abs(elevationAt(p.eastingM, p.northingM) - p.geoportalElevationM!), p.name).toBeLessThan(3);
    }
  });

  it('Hala Miziowa to wypłaszczenie (średnie nachylenie w kwadracie 50 × 50 m przy schronisku poniżej 10 %), a cała mapa jest dużo bardziej stroma', () => {
    const p = grid.puwg92ToLocal(522980, 185950)!;
    const cell = grid.cellAt(p.xM, p.yM)!;
    let local = 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) local += grid.slopePercent[grid.index(cell.i + di, cell.j + dj)];
    expect(local / 25).toBeLessThan(10);
    let sum = 0;
    let n = 0;
    for (const s of grid.slopePercent) if (!Number.isNaN(s)) { sum += s; n++; }
    expect(sum / n).toBeGreaterThan(20); // średnie nachylenie mapy – teren górski
  });
});
