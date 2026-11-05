import { describe, expect, it } from 'vitest';
import { createGridFromMap, parseMapDefinition } from '../src/sim/mapFile';
import { parseAsciiGrid } from '../src/tools/asciiGrid';

const num = (value: number) => ({ value, unit: 'm', source: 'test' });
const MINI = {
  name: 'test',
  crs: 'EPSG:2180',
  bounds: { westEastingM: num(500000), eastEastingM: num(500030), southNorthingM: num(200000), northNorthingM: num(200020) },
  cellSizeM: num(10),
  elevationFile: 'e.f32',
};

describe('Plik mapy', () => {
  it('wymiary siatki wynikają z granic i rozmiaru komórki', () => {
    const def = parseMapDefinition(MINI);
    expect(def.widthCells).toBe(3);
    expect(def.heightCells).toBe(2);
  });

  it('wysokości czytane wierszami od północy; NaN = poza mapą; georeferencja PUWG 1992', () => {
    const def = parseMapDefinition(MINI);
    const buf = new ArrayBuffer(6 * 4);
    const view = new DataView(buf);
    [100, 101, 102, 200, 201, Number.NaN].forEach((v, k) => view.setFloat32(k * 4, v, true));
    const grid = createGridFromMap(def, buf);
    expect(grid.getElevationM(0, 0)).toBe(100); // NW
    expect(grid.getElevationM(2, 0)).toBe(102); // NE
    expect(grid.getElevationM(0, 1)).toBe(200); // SW
    expect(grid.isCellValid(2, 1)).toBe(false);
    expect(grid.localToPuwg92(0, 0)).toEqual({ eastingM: 500000, northingM: 200020 });
    expect(grid.localToPuwg92(30, 20)).toEqual({ eastingM: 500030, northingM: 200000 });
    expect(grid.puwg92ToLocal(500015, 200005)).toEqual({ xM: 15, yM: 15 });
  });

  it('odrzuca zły rozmiar pliku wysokości i granice niepasujące do siatki', () => {
    const def = parseMapDefinition(MINI);
    expect(() => createGridFromMap(def, new ArrayBuffer(20))).toThrow(/oczekiwano/);
    expect(() => parseMapDefinition({ ...MINI, cellSizeM: num(7) })).toThrow(/wielokrotnością/);
    expect(() => parseMapDefinition({ ...MINI, crs: 'EPSG:4326' })).toThrow(/2180/);
  });
});

describe('Odczyt odpowiedzi WCS (Arc/Info ASCII Grid)', () => {
  it('czyta nagłówek i wartości z odpowiedzi wieloczęściowej', () => {
    const text = [
      '--wcs',
      'Content-Type: image/x-aaigrid',
      '',
      'ncols        3',
      'nrows        2',
      'xllcorner    523000.000000',
      'yllcorner    185000.000000',
      'cellsize     1.000000',
      'NODATA_value -9999',
      ' 1275.5 1275.4 1275.3',
      ' 1270 -9999 1269.5',
      '--wcs--',
    ].join('\r\n');
    const g = parseAsciiGrid(text);
    expect(g.ncols).toBe(3);
    expect(g.nrows).toBe(2);
    expect(g.nodata).toBe(-9999);
    expect(Array.from(g.values)).toEqual([1275.5, 1275.4000244140625, 1275.300048828125, 1270, -9999, 1269.5]);
  });

  it('niekompletna siatka daje błąd', () => {
    expect(() => parseAsciiGrid('ncols 2\nnrows 2\ncellsize 1\n1 2 3\n')).toThrow(/niekompletna/);
  });
});
