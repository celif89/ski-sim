/**
 * Etap 3D-3: oprawa 3D – śnieg z grubością i światło. Sprawdzamy:
 *  – powierzchnia śniegu = teren + grubość z modelu (±1 cm) w punktach kontrolnych, bez schodków
 *    (dwuliniowo między środkami komórek), bez śniegu = sam teren;
 *  – łata gęstej siatki przy kamerze: brzeg dokładnie na powierzchni terenu bazowego (bez szczeliny),
 *    rzeźba detalu (pryzmy, muldy) tylko w środku i bez zmiany średniej (masa zachowana);
 *  – kierunek Słońca w scenie zgodny z sim/sun.ts;
 *  – ustawienia jakości nie zmieniają wyników symulacji (ten sam seed = ten sam sezon), a rysowanie
 *    nie zmienia danych modelu śniegu.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import climateJson from '../data/climate/pilsko.json';
import mapStyleJson from '../data/map-style.json';
import radiationJson from '../data/radiation.json';
import render3dJson from '../data/render3d.json';
import snowJson from '../data/snow.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import { Environment } from '../src/sim/environment';
import { computeHorizon, parseHorizonParams } from '../src/sim/horizon';
import { parseRadiationParams } from '../src/sim/radiation';
import { parseSnowParams } from '../src/sim/snow';
import { SnowWorld } from '../src/sim/snowWorld';
import { sunPosition } from '../src/sim/sun';
import { localToUtcMs } from '../src/sim/time';
import { parseWeatherParams } from '../src/sim/weather';
import { LOOK_KEYS, LOOK_SLIDERS, lookToJson, parseLook, sunDirection } from '../src/render3d/look';
import { parseRender3DParams } from '../src/render3d/params';
import type { DetailRelief } from '../src/render3d/snowPatch';
import { buildPatch, detailHeightAt, patchOrigin, reliefFrom } from '../src/render3d/snowPatch';
import type { DepthField } from '../src/render3d/snowSurface';
import { snowDepthAt, snowSurfaceAt } from '../src/render3d/snowSurface';
import { Terrain3D } from '../src/render3d/terrain3d';
import type { HeightField } from '../src/render3d/terrainMesh';
import { sampleHeight } from '../src/render3d/terrainMesh';
import { planeGrid } from './terrainTestUtils';

vi.setConfig({ testTimeout: 120_000 });

const p3 = parseRender3DParams(render3dJson);
const W = 40;
const H = 36;
const CS = 10;

/** Stok 30 % z falami (wysokość w środkach komórek). */
function hill(): HeightField {
  const el = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) el[j * W + i] = 900 + 0.3 * (j + 0.5) * CS + 4 * Math.sin(i * 0.7) * Math.cos(j * 0.4);
  return { widthCells: W, heightCells: H, cellSizeM: CS, elevationM: el };
}

/** Grubość z zaspami i wywianym grzbietem [cm] (deterministycznie). */
function depthCm(): Float32Array {
  const d = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) d[j * W + i] = Math.max(0, 60 + 45 * Math.sin(i * 0.9 + j * 0.3) + (i === 20 ? -80 : 0));
  return d;
}

const depthField = (cm: Float32Array): DepthField => ({ widthCells: W, heightCells: H, cellSizeM: CS, depthM: Float32Array.from(cm, (v) => v / 100) });

function terrain(hf: HeightField): Terrain3D {
  return new Terrain3D({ hf, forest: null, shrub: null, built: null, dem: null, mapWestE: 0, mapNorthN: 0 }, p3);
}

describe('Powierzchnia śniegu = teren + grubość', () => {
  const hf = hill();
  const cm = depthCm();

  it('w środkach komórek (punkty kontrolne) dokładnie teren + grubość z modelu (±1 cm)', () => {
    const t = terrain(hf);
    t.setSnow({ depthCm: cm, quality: new Uint8Array(W * H).fill(3) });
    let checked = 0;
    for (let j = 1; j < H - 1; j += 3) {
      for (let i = 1; i < W - 1; i += 3) {
        const x = (i + 0.5) * CS;
        const z = (j + 0.5) * CS;
        const surf = t.surfaceAt(x, z);
        expect(Math.abs(surf - (hf.elevationM[j * W + i] + cm[j * W + i] / 100))).toBeLessThan(0.01);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('między komórkami dwuliniowo – bez schodków (ciągła, różnica sąsiednich punktów co 5 cm < 1 cm grubości)', () => {
    const f = depthField(cm);
    let worst = 0;
    for (let x = 15; x < (W - 2) * CS; x += 0.05) {
      const a = snowDepthAt(f, x, 123.4);
      const b = snowDepthAt(f, x + 0.05, 123.4);
      worst = Math.max(worst, Math.abs(a - b));
    }
    // Największy spadek grubości między komórkami (wywiany grzbiet) to ok. 1,3 m na 10 m → 0,65 cm na 5 cm.
    expect(worst).toBeLessThan(0.01);
  });

  it('bez śniegu (lato albo grubość 0) – sam teren', () => {
    const t = terrain(hf);
    t.setSnow(null);
    for (const [x, z] of [[55, 70], [203.3, 101.7], [333, 222]]) expect(t.surfaceAt(x, z)).toBeCloseTo(sampleHeight(hf, x, z), 9);
    t.setSnow({ depthCm: new Float32Array(W * H), quality: new Uint8Array(W * H) });
    for (const [x, z] of [[55, 70], [203.3, 101.7], [333, 222]]) expect(t.surfaceAt(x, z)).toBeCloseTo(sampleHeight(hf, x, z), 9);
    // Lato po zimie: grubość wyzerowana.
    t.setSnow({ depthCm: cm, quality: new Uint8Array(W * H).fill(3) });
    t.setSnow(null);
    expect(t.surfaceAt(205, 155)).toBeCloseTo(sampleHeight(hf, 205, 155), 9);
  });

  it('przewyższenie (menu Dev) skaluje tylko grubość; 1 = skala prawdziwa', () => {
    const f = depthField(cm);
    const x = 187.3;
    const z = 141.9;
    const g = sampleHeight(hf, x, z);
    expect(snowSurfaceAt(hf, f, 1, x, z) - g).toBeCloseTo(snowDepthAt(f, x, z), 9);
    expect(snowSurfaceAt(hf, f, 4, x, z) - g).toBeCloseTo(4 * snowDepthAt(f, x, z), 9);
  });
});

describe('Łata gęstej siatki przy kamerze (warstwa detalu 1 m)', () => {
  const hf = hill();
  const f = depthField(depthCm());
  const sub = 10;
  const per = sub * sub;
  // Dwa bloki w korytarzu trasy: pryzma armatki i muldy (garby co 5 m).
  const blockOf = new Int32Array(W * H).fill(-1);
  const cells = Int32Array.from([15 * W + 18, 15 * W + 19]);
  blockOf[cells[0]] = 0;
  blockOf[cells[1]] = 1;
  const mogul = new Float32Array(2 * per);
  const pile = new Float32Array(2 * per);
  for (let r = 0; r < per; r++) {
    const a = r % sub;
    const b = Math.floor(r / sub);
    pile[r] = 400 * Math.exp(-((a - 4.5) ** 2 + (b - 4.5) ** 2) / 6);
    mogul[per + r] = 0.4 * (0.5 + 0.5 * Math.cos((2 * Math.PI * a) / 5) * Math.cos((2 * Math.PI * b) / 5));
  }
  const relief: DetailRelief = reliefFrom({ sub, per, blockOf, cells, mogul, pile }, 500);

  it('brzeg łaty leży dokładnie na powierzchni terenu bazowego (bez szczeliny), środek – z rzeźbą detalu', () => {
    const o = patchOrigin(190, 155, 64, CS);
    // Brzeg na liniach przez środki komórek.
    expect(((o.x0 / CS - 0.5) % 1 + 1) % 1).toBeCloseTo(0, 9);
    expect(((o.z0 / CS - 0.5) % 1 + 1) % 1).toBeCloseTo(0, 9);
    const pg = buildPatch(hf, f, 1, relief, o.x0, o.z0, 64, 1, 8);
    const n = pg.n;
    let edgeWorst = 0;
    let reliefMax = 0;
    for (let r = 0; r <= n; r++) {
      for (let c = 0; c <= n; c++) {
        const k = (r * (n + 1) + c) * 3;
        const x = pg.positions[k];
        const z = pg.positions[k + 2];
        const base = snowSurfaceAt(hf, f, 1, x, z);
        if (r === 0 || c === 0 || r === n || c === n) edgeWorst = Math.max(edgeWorst, Math.abs(pg.positions[k + 1] - base));
        else reliefMax = Math.max(reliefMax, Math.abs(pg.positions[k + 1] - base));
      }
    }
    expect(edgeWorst).toBeLessThan(1e-4);
    // Pryzma (szczyt 400 mm wody / 500 kg/m³ = 0,8 m, rozmyta na ok. 2 m) i muldy ±0,2 m.
    expect(reliefMax).toBeGreaterThan(0.15);
    expect(pg.indices.length).toBe(n * n * 6);
  });

  it('rzeźba detalu nie zmienia średniej grubości komórki 10 m (siatka 10 m już ją zawiera)', () => {
    for (const k of cells) {
      const i = k % W;
      const j = Math.floor(k / W);
      let s = 0;
      for (let b = 0; b < sub; b++) for (let a = 0; a < sub; a++) s += detailHeightAt(relief, hf, i * CS + a + 0.5, j * CS + b + 0.5);
      expect(Math.abs(s / per)).toBeLessThan(1e-4);
    }
    // Poza korytarzem tras – brak rzeźby.
    expect(detailHeightAt(relief, hf, 55, 55)).toBe(0);
  });

  it('w Terrain3D łata powstaje tylko przy śniegu i włączonej jakości (bok > 0)', () => {
    const t = terrain(hf);
    t.setPatchQuality(p3.quality.snowPatchM[1], p3.quality.snowPatchStepM[1], 8);
    t.updatePatch(200, 180, 0);
    expect(t.uniforms.uPatchOn.value).toBe(0);
    t.setSnow({ depthCm: depthCm(), quality: new Uint8Array(W * H).fill(3) });
    t.updatePatch(200, 180, 0);
    expect(t.uniforms.uPatchOn.value).toBe(1);
    t.setPatchQuality(p3.quality.snowPatchM[0], p3.quality.snowPatchStepM[0], 8);
    t.updatePatch(200, 180, 10_000);
    expect(t.uniforms.uPatchOn.value).toBe(p3.quality.snowPatchM[0] > 0 ? 1 : 0);
  });
});

describe('Słońce w scenie', () => {
  const loc = { latDeg: 49.55, lonDeg: 19.33, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } };
  it('kierunek do Słońca zgodny z sim/sun.ts (azymut, wysokość) – rano wschód, w południe południe', () => {
    for (const [h, side] of [[9, 'E'], [12.2, 'S'], [15, 'W']] as const) {
      const utc = localToUtcMs({ year: 2027, month: 1, day: 15, hour: h }, loc.timeZone);
      const sp = sunPosition(utc, loc.latDeg, loc.lonDeg);
      const d = sunDirection(sp.azimuthDeg, sp.elevationDeg);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
      // Wysokość nad horyzontem: kąt wektora z płaszczyzną poziomą.
      expect((Math.asin(d.y) * 180) / Math.PI).toBeCloseTo(sp.elevationDeg, 6);
      // Azymut od północy (−z) w stronę wschodu (+x).
      const az = ((Math.atan2(d.x, -d.z) * 180) / Math.PI + 360) % 360;
      expect(az).toBeCloseTo(sp.azimuthDeg, 6);
      if (side === 'E') expect(d.x).toBeGreaterThan(0.3);
      if (side === 'W') expect(d.x).toBeLessThan(-0.3);
      if (side === 'S') expect(d.z).toBeGreaterThan(0.85);
    }
  });
});

describe('Parametry oprawy i jakość', () => {
  it('każdy parametr w map-style.json ma wartość, jednostkę i opis; suwak dla każdego; kopiowanie odtwarza wartości', () => {
    const sec = (mapStyleJson as unknown as { render3d: Record<string, { value: number; unit: string; source: string }> }).render3d;
    for (const k of LOOK_KEYS) {
      expect(typeof sec[k].value).toBe('number');
      expect(sec[k].unit.length).toBeGreaterThan(0);
      expect(sec[k].source.length).toBeGreaterThan(10);
      expect(LOOK_SLIDERS.some((s) => s.path === k)).toBe(true);
    }
    const look = parseLook(mapStyleJson);
    expect(look.snowExaggeration).toBe(1);
    expect(JSON.parse(lookToJson(look))).toEqual(look);
    // Trzy ustawienia jakości z łatą śniegu i miękkimi cieniami.
    expect(p3.quality.snowPatchM.length).toBe(3);
    expect(p3.quality.snowPatchM[2]).toBeGreaterThanOrEqual(p3.quality.snowPatchM[1]);
  });

  it('ustawienia jakości nie zmieniają wyników symulacji (ten sam seed = ten sam sezon), rysowanie nie zmienia danych śniegu', () => {
    const grid = planeGrid(30, 0, { width: 12, height: 12, baseM: 1150 });
    const run = () => {
      const env = new Environment(
        grid,
        computeHorizon(grid, null, { ...parseHorizonParams(radiationJson), maxDistanceM: 400 }),
        parseClimateProfile(climateJson),
        parseWeatherParams(wxJson),
        parseRadiationParams(radiationJson),
        20261105,
        { latDeg: 49.55, lonDeg: 19.33, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } },
      );
      const n = grid.cellCount;
      const world = new SnowWorld(env, new Float32Array(n), new Float32Array(n), parseSnowParams(snowJson));
      for (const _ of world.advanceTo({ year: 2027, month: 1, day: 20 })) void _;
      return world.snapshot();
    };
    const a = run();
    const before = Float32Array.from(a.depthCm);
    // Rysowanie w trzech jakościach na danych pierwszego przebiegu.
    const hf: HeightField = { widthCells: grid.widthCells, heightCells: grid.heightCells, cellSizeM: grid.cellSizeM, elevationM: grid.elevationM };
    for (const q of [0, 1, 2]) {
      const t = terrain(hf);
      t.setPatchQuality(p3.quality.snowPatchM[q], p3.quality.snowPatchStepM[q], 8);
      t.setSnow({ depthCm: a.depthCm, quality: a.quality });
      t.updatePatch(60, 60, q * 10_000);
      t.surfaceAt(55, 61);
    }
    expect(Array.from(a.depthCm)).toEqual(Array.from(before));
    const b = run();
    expect(Array.from(b.depthCm)).toEqual(Array.from(a.depthCm));
    expect(Array.from(b.sweMm)).toEqual(Array.from(a.sweMm));
    expect(Array.from(b.quality)).toEqual(Array.from(a.quality));
  });

  it('symulacja i wątki obliczeń nie sięgają do rysowania 3D ani do parametrów oprawy', () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
    for (const f of [...files('src/sim'), ...files('src/worker')]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/render3d|map-style\.json|from 'three'/);
    }
  });
});
