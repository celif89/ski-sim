import { describe, expect, it } from 'vitest';
import slopeClassesJson from '../data/slope-classes.json';
import { classifySlope, parseSlopeClasses } from '../src/sim/slopeClasses';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { computeSlopeAndAspect } from '../src/sim/terrainAnalysis';
import { describePoint } from '../src/render/hud';
import { compassName } from '../src/render/colors';
import { niceStep, niceTicks } from '../src/render/niceTicks';

const classes = parseSlopeClasses(slopeClassesJson);

describe('Klasy nachylenia (kolory tras)', () => {
  it('progi z pliku danych: zielona do 10 %, niebieska do 25 %, czerwona do 40 %, czarna powyżej', () => {
    expect(classes.map((c) => c.maxSlopePercent)).toEqual([10, 25, 40, Infinity]);
    const name = (s: number) => classes[classifySlope(s, classes)].name.split(' ')[0];
    expect(name(0)).toBe('zielona');
    expect(name(10)).toBe('zielona');
    expect(name(10.01)).toBe('niebieska');
    expect(name(25)).toBe('niebieska');
    expect(name(30)).toBe('czerwona');
    expect(name(40)).toBe('czerwona');
    expect(name(41)).toBe('czarna');
    expect(name(-30)).toBe('czerwona'); // w dół i w górę to samo nachylenie
    expect(classifySlope(Number.NaN, classes)).toBe(-1);
  });

  it('progi muszą rosnąć', () => {
    const bad = JSON.parse(JSON.stringify(slopeClassesJson));
    bad.classes[1].maxSlopePercent.value = 5;
    expect(() => parseSlopeClasses(bad)).toThrow(/rosnąć/);
  });
});

describe('Pasek stanu – opis punktu pod kursorem', () => {
  // Płaszczyzna 30 % opadająca na N, z georeferencją w okolicy Hali Miziowej.
  const w = 10;
  const e = new Float32Array(w * w);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) e[j * w + i] = 1000 + 0.3 * (j + 0.5) * 10;
  e[w * w - 1] = Number.NaN;
  const grid = new TerrainGrid(w, w, 10, e, { crs: 'EPSG:2180', westEastingM: 523000, northNorthingM: 186000 });
  computeSlopeAndAspect(grid);

  it('podaje PUWG 1992 (X = N, Y = E), stopnie, wysokość, nachylenie i ekspozycję', () => {
    const r = describePoint(grid, 50, 50, 3);
    expect(r.position.replace(/\s/g, ' ')).toBe('PUWG 1992: X 185 950  Y 523 050'.replace(/\s/g, ' '));
    expect(r.geographic).toMatch(/^49,54\d+° N {2}19,3\d+° E$/);
    expect(r.elevation).toBe('1015 m n.p.m.');
    expect(r.slope).toBe('nachylenie 30 % (16,7°)');
    expect(r.aspect).toBe('ekspozycja N (0°)');
  });

  it('poza mapą i na obszarze bez danych', () => {
    expect(describePoint(grid, -5, 50, 3).position).toBe('kursor poza mapą');
    expect(describePoint(grid, 95, 95, 3).elevation).toBe('poza mapą (Słowacja)');
  });

  it('nazwy kierunków', () => {
    expect([0, 44, 46, 90, 180, 225, 270, 315, 359].map(compassName)).toEqual(['N', 'NE', 'NE', 'E', 'S', 'SW', 'W', 'NW', 'N']);
  });
});

describe('Podziałka osi wykresu profilu', () => {
  it('daje kilka okrągłych wartości dla typowych zakresów wysokości', () => {
    expect(niceTicks(675, 1475, 4)).toEqual([800, 1000, 1200, 1400]);
    expect(niceTicks(611.6, 1494.4, 4)).toEqual([800, 1000, 1200, 1400]);
    expect(niceTicks(1270, 1290, 4)).toEqual([1270, 1275, 1280, 1285, 1290]);
    for (const range of [7, 33, 150, 880, 4093]) {
      const n = Math.floor(range / niceStep(range, 4)) + 1;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
});
