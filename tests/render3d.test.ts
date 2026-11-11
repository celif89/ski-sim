/**
 * Etap 3D-0: czyste obliczenia widoku 3D (bez karty graficznej) – siatka terenu w kawałkach,
 * poziomy szczegółowości, kamera nie wchodzi pod teren, krzesełka na linie jak w 2D, obrysy budynków.
 */
import { describe, expect, it } from 'vitest';
import render3dJson from '../data/render3d.json';
import { analyzeLift, cableElevationAt, carrierSpacingM, designLift } from '../src/sim/lifts';
import { buildingHeights, convexHull, minAreaRect } from '../src/render3d/buildingShapes';
import { cameraPosition, clampRig, groundAxes, keepAboveTerrain, zoomToward } from '../src/render3d/cameraRig';
import type { RigState } from '../src/render3d/cameraRig';
import { carrierPositions, liftFrame, ROPE_HALF_M } from '../src/render3d/liftGeometry';
import { parseRender3DParams } from '../src/render3d/params';
import { buildChunk, chunkGrid, lodLevel, sampleHeight } from '../src/render3d/terrainMesh';
import type { HeightField } from '../src/render3d/terrainMesh';
import { fixtureGrid, lp } from './guestFixture';

const p3 = parseRender3DParams(render3dJson);

/** Płaszczyzna: z = 1000 + 0,3·y (stok 30 % w kierunku południowym). */
function plane(w = 120, h = 90, cell = 10, nanCols = 0): HeightField {
  const z = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) z[j * w + i] = i < nanCols ? NaN : 1000 + 0.3 * (j + 0.5) * cell;
  return { widthCells: w, heightCells: h, cellSizeM: cell, elevationM: z };
}

describe('Teren 3D – kawałki i szczegółowość', () => {
  it('kawałki pokrywają całą siatkę i dzielą brzegi', () => {
    const hf = plane();
    const ch = chunkGrid(hf, 50);
    expect(ch.length).toBe(3 * 2);
    const cover = new Uint8Array(hf.widthCells * hf.heightCells);
    for (const c of ch) for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) cover[j * hf.widthCells + i] = 1;
    expect(cover.every((v) => v === 1)).toBe(true);
    // Sąsiad po prawej zaczyna się tam, gdzie kończy się lewy (wspólny brzeg – bez szczelin).
    const a = ch.find((c) => c.ci === 0 && c.cj === 0)!;
    const b = ch.find((c) => c.ci === 1 && c.cj === 0)!;
    expect(b.i0).toBe(a.i1);
  });

  it('poziom szczegółowości rośnie z odległością', () => {
    const d = p3.terrain.lodDistancesM;
    expect(lodLevel(0, d)).toBe(0);
    expect(lodLevel(d[0] + 1, d)).toBe(1);
    expect(lodLevel(d[d.length - 1] + 1, d)).toBe(d.length);
    let prev = 0;
    for (let x = 0; x < 10000; x += 100) {
      const l = lodLevel(x, d);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('wysokości wierzchołków równe siatce gry, mniej trójkątów przy grubszym kroku', () => {
    const hf = plane();
    const c = chunkGrid(hf, 50)[0];
    const g1 = buildChunk(hf, c, 1, 15);
    const g4 = buildChunk(hf, c, 4, 15);
    expect(g4.surfaceTriangles).toBeLessThan(g1.surfaceTriangles / 10);
    // Każdy wierzchołek powierzchni (nie fartuch) leży na płaszczyźnie.
    let checked = 0;
    for (let k = 0; k < g1.positions.length / 3; k++) {
      const x = g1.positions[k * 3];
      const y = g1.positions[k * 3 + 1];
      const z = g1.positions[k * 3 + 2];
      const ref = sampleHeight(hf, x, z);
      if (Math.abs(y - ref) < 1e-3) checked++;
      else expect(y).toBeLessThan(ref); // fartuch – w dół
    }
    expect(checked).toBeGreaterThan(50 * 50);
    // Normalna stoku 30 % (wysokość rośnie z z) – także w narożniku mapy (różnica jednostronna).
    expect(g1.normals[1]).toBeCloseTo(1 / Math.hypot(1, 0.3), 3);
    expect(g1.normals[2]).toBeCloseTo(-0.3 / Math.hypot(1, 0.3), 3);
  });

  it('komórki poza mapą (NaN) nie dają trójkątów', () => {
    const full = buildChunk(plane(), chunkGrid(plane(), 50)[0], 1, 0);
    const cut = buildChunk(plane(120, 90, 10, 20), chunkGrid(plane(120, 90, 10, 20), 50)[0], 1, 0);
    expect(cut.surfaceTriangles).toBeLessThan(full.surfaceTriangles * 0.65);
    for (let k = 0; k < cut.positions.length; k++) expect(Number.isFinite(cut.positions[k])).toBe(true);
  });
});

describe('Kamera jak w Cities: Skylines', () => {
  const lim = { ...p3.camera };
  const hf = plane();
  const ground = (x: number, z: number) => sampleHeight(hf, x, z);

  it('nigdy nie wchodzi pod teren (cały zakres obrotu i pochylenia, stok 30 %)', () => {
    for (let yaw = 0; yaw < 360; yaw += 15) {
      for (let pitch = -20; pitch <= 90; pitch += 5) {
        for (const dist of [25, 80, 300, 2000]) {
          const s: RigState = { tx: 600, ty: ground(600, 450), tz: 450, distanceM: dist, yawRad: (yaw * Math.PI) / 180, pitchRad: (pitch * Math.PI) / 180 };
          const r = keepAboveTerrain(s, lim, ground);
          const c = cameraPosition(r);
          const g = ground(c.x, c.z);
          if (Number.isFinite(g)) expect(c.y).toBeGreaterThanOrEqual(g + lim.minClearanceM - 1e-6);
          expect((r.pitchRad * 180) / Math.PI).toBeLessThanOrEqual(lim.maxPitchDeg + 1e-9);
          expect(r.distanceM).toBeGreaterThanOrEqual(lim.minDistanceM);
        }
      }
    }
  });

  it('widok z góry: kamera nad celem; obrót 0 – od północy (z Korbielowa)', () => {
    const top = clampRig({ tx: 100, ty: 0, tz: 100, distanceM: 500, yawRad: 0, pitchRad: Math.PI / 2 }, lim);
    const c = cameraPosition(top);
    expect(Math.hypot(c.x - 100, c.z - 100)).toBeLessThan(500 * Math.cos((lim.maxPitchDeg * Math.PI) / 180) + 1e-6);
    const side = cameraPosition({ tx: 0, ty: 0, tz: 0, distanceM: 100, yawRad: 0, pitchRad: 0.3 });
    expect(side.z).toBeLessThan(0); // północ = −z
    // Kierunek „do przodu” przy obrocie 0 – na południe (+z).
    expect(groundAxes(0).fz).toBeGreaterThan(0.99);
  });

  it('zbliżenie kółkiem przybliża do punktu pod kursorem', () => {
    const s: RigState = { tx: 0, ty: 0, tz: 0, distanceM: 1000, yawRad: 0, pitchRad: 0.6 };
    const r = zoomToward(s, 0.5, 400, 0, 200, lim);
    expect(r.distanceM).toBeCloseTo(500, 6);
    expect(Math.hypot(r.tx - 400, r.tz - 200)).toBeLessThan(Math.hypot(400, 200));
  });
});

describe('Wyciąg 3D – lina i krzesełka', () => {
  const grid = fixtureGrid();
  const design = designLift(grid, lp, 'W1', 'kanapa4s', 'W1', { xM: 380, yM: 1300 }, { xM: 150, yM: 110 });
  const an = analyzeLift(design, { grid, params: lp, forest: null, shrub: null, clearingCost: () => ({ costPln: 0, areaM2: 0 }) as never, otherLifts: [] } as never);
  const sag = lp.common.cableSagRatio;
  const f = liftFrame(design, an, sag);

  it('krzesełka wiszą na linie (wysokość z krzywej zwisu), w stałym odstępie', () => {
    const cs = carrierPositions(design, an, f, 1234.5);
    expect(cs.length).toBeGreaterThan(10);
    const up = cs.filter((c) => c.dir === 1);
    for (const c of cs) {
      expect(Number.isFinite(c.y)).toBe(true);
      // Od linii (osi) w bok dokładnie o pół rozstawu lin.
      const p = f.path;
      const ax = p[p.length - 1].xM - p[0].xM;
      const az = p[p.length - 1].yM - p[0].yM;
      const L = Math.hypot(ax, az);
      const off = Math.abs(((c.x - p[0].xM) * az - (c.z - p[0].yM) * ax) / L);
      expect(off).toBeCloseTo(ROPE_HALF_M, 3);
    }
    for (let k = 1; k < up.length; k++) {
      const d = Math.hypot(up[k].x - up[k - 1].x, up[k].y - up[k - 1].y, up[k].z - up[k - 1].z);
      expect(d).toBeGreaterThan(carrierSpacingM(an.type) * 0.85);
      expect(d).toBeLessThan(carrierSpacingM(an.type) * 1.15);
    }
    // Lina w 3D = ta sama krzywa zwisu co w symulacji (cableElevationAt).
    expect(f.cableAt(an.horizontalLengthM / 3)).toBeCloseTo(cableElevationAt(an.supports, an.horizontalLengthM / 3, sag), 6);
  });

  it('ta sama pozycja co w 2D: przesunięcie o jeden odstęp w czasie daje ten sam układ', () => {
    const spacing = carrierSpacingM(an.type);
    const t = 500;
    const a = carrierPositions(design, an, f, t);
    const b = carrierPositions(design, an, f, t + spacing / an.type.speedMs);
    expect(b.length).toBe(a.length);
    for (let k = 0; k < a.length; k++) {
      expect(b[k].x).toBeCloseTo(a[k].x, 4);
      expect(b[k].z).toBeCloseTo(a[k].z, 4);
    }
    // Zamknięty wyciąg stoi bez krzesełek w ruchu.
    expect(carrierPositions({ ...design, closed: true }, an, f, t).length).toBe(0);
  });
});

describe('Budynki z obrysów OSM', () => {
  it('prostokąt o najmniejszym polu – obrócony dom 12 × 8 m', () => {
    const a = (25 * Math.PI) / 180;
    const pts = [
      [-6, -4],
      [6, -4],
      [6, 4],
      [-6, 4],
      [0, 4.1],
      [0, -4.1],
    ].map(([x, y]) => ({ xM: 100 + x * Math.cos(a) - y * Math.sin(a), yM: 50 + x * Math.sin(a) + y * Math.cos(a) }));
    expect(convexHull(pts).length).toBeGreaterThanOrEqual(4);
    const r = minAreaRect(pts);
    expect(r.cx).toBeCloseTo(100, 0);
    expect(r.cy).toBeCloseTo(50, 0);
    expect(r.lengthM).toBeCloseTo(12, 0);
    expect(r.widthM).toBeCloseTo(8.2, 0);
    const h = buildingHeights(r);
    expect(h.wallM).toBeGreaterThanOrEqual(3);
    // Dach ok. 40°: wysokość kalenicy nad ścianą = pół szerokości · tg 40°.
    expect(h.ridgeM).toBeCloseTo((r.widthM / 2) * Math.tan((40 * Math.PI) / 180), 6);
  });
});
