/**
 * Etap 3D-1/3D-2: linie przyklejone do terenu, automatyczna płynność, zamiana ekran ↔ teren
 * w widoku 3D (punkt wskazany w 3D = ten sam punkt mapy ±0,5 m przy różnych kątach kamery,
 * także na stoku 40 %).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import render3dJson from '../data/render3d.json';
import { cameraPosition } from '../src/render3d/cameraRig';
import type { RigState } from '../src/render3d/cameraRig';
import { governStep } from '../src/render3d/governor';
import { drapePolyline } from '../src/render3d/lines3d';
import { parseRender3DParams } from '../src/render3d/params';
import { Camera3DAdapter } from '../src/render3d/picking';

const p3 = parseRender3DParams(render3dJson);

/** Stok o nachyleniu `slope` (np. 0,4 = 40 %) opadający na północ (wysokość rośnie z z) + łagodne fale. */
const slopeGround = (slope: number) => (x: number, z: number) => (x < -50 || z < -50 || x > 3000 || z > 3000 ? NaN : 800 + slope * z + 6 * Math.sin(x / 90) * Math.cos(z / 130));

describe('Linie po terenie', () => {
  it('punkty co najwyżej co krok, na wysokości terenu, odległość wzdłuż rośnie', () => {
    const g = slopeGround(0.4);
    const pieces = drapePolyline([{ xM: 100, yM: 100 }, { xM: 400, yM: 500 }, { xM: 700, yM: 450 }], g, 6);
    expect(pieces.length).toBe(1);
    const pts = pieces[0];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      expect(d).toBeLessThanOrEqual(6 + 1e-9);
      expect(pts[i].along).toBeGreaterThan(pts[i - 1].along);
      expect(pts[i].y).toBeCloseTo(g(pts[i].x, pts[i].z), 9);
    }
    expect(pts[pts.length - 1].along).toBeCloseTo(500 + Math.hypot(300, 50), 6);
  });

  it('odcinek poza mapą (NaN) przerywa linię', () => {
    const pieces = drapePolyline([{ xM: 100, yM: 100 }, { xM: -400, yM: 100 }, { xM: 100, yM: 300 }], slopeGround(0.1), 5);
    expect(pieces.length).toBe(2);
  });
});

describe('Automatyczna płynność', () => {
  const gp = p3.governor;
  it('za mało klatek: najpierw rozdzielczość, potem drzewa; nigdy poniżej minimów', () => {
    let st = { resolutionScale: 1, treeScale: 1 };
    st = governStep(st, 30, gp);
    expect(st.resolutionScale).toBeLessThan(1);
    expect(st.treeScale).toBe(1);
    for (let k = 0; k < 40; k++) st = governStep(st, 30, gp);
    expect(st.resolutionScale).toBeCloseTo(gp.minResolutionScale, 9);
    expect(st.treeScale).toBeCloseTo(gp.minTreeScale, 9);
  });
  it('zapas klatek: powrót do ustawień jakości (drzewa, potem rozdzielczość), nie powyżej', () => {
    let st = { resolutionScale: gp.minResolutionScale, treeScale: gp.minTreeScale };
    st = governStep(st, 60, gp);
    expect(st.treeScale).toBeGreaterThan(gp.minTreeScale);
    expect(st.resolutionScale).toBeCloseTo(gp.minResolutionScale, 9);
    for (let k = 0; k < 40; k++) st = governStep(st, 60, gp);
    expect(st).toEqual({ resolutionScale: 1, treeScale: 1 });
    // Między progami – bez zmian.
    expect(governStep(st, (gp.lowFps + gp.targetFps * 0.95) / 2, gp)).toEqual(st);
  });
});

describe('Zamiana ekran ↔ teren w widoku 3D', () => {
  const W = 1600;
  const H = 900;
  function view(rig: RigState, ground: (x: number, z: number) => number) {
    const cam = new THREE.PerspectiveCamera(p3.camera.fovDeg, W / H, 1, 60000);
    const c = cameraPosition(rig);
    cam.position.set(c.x, c.y, c.z);
    cam.lookAt(rig.tx, rig.ty, rig.tz);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return new Camera3DAdapter(() => ({ camera: cam, widthPx: W, heightPx: H, groundAt: ground, targetX: rig.tx, targetZ: rig.tz }), () => {});
  }

  for (const slope of [0, 0.4]) {
    it(`punkt mapy → ekran → punkt mapy: ±0,5 m (stok ${slope * 100} %, obroty co 30°, pochylenia 12–88°)`, () => {
      const g = slopeGround(slope);
      let checked = 0;
      let worst = 0;
      for (let yaw = 0; yaw < 360; yaw += 30) {
        for (const pitch of [12, 25, 45, 70, 88]) {
          for (const dist of [120, 600, 2000]) {
            const tx = 1500;
            const tz = 1500;
            const rig: RigState = { tx, ty: g(tx, tz), tz, distanceM: dist, yawRad: (yaw * Math.PI) / 180, pitchRad: (pitch * Math.PI) / 180 };
            const a = view(rig, g);
            for (let i = -3; i <= 3; i++) {
              for (let j = -3; j <= 3; j++) {
                const p = { xM: tx + i * dist * 0.08, yM: tz + j * dist * 0.08 };
                const s = a.worldToScreen(p.xM, p.yM);
                if (s.xPx < 0 || s.yPx < 0 || s.xPx > W || s.yPx > H) continue;
                // Punkt zasłonięty wzgórzem (promień trafia wcześniej) – pomijamy, jak w grze (widać przód).
                const hit = a.pick(s.xPx, s.yPx);
                if (!hit) continue;
                // Zasłonięty wzgórzem: promień trafia w teren wyraźnie bliżej kamery niż punkt (widać to, co z przodu).
                const c = cameraPosition(rig);
                const dHit = Math.hypot(hit.x - c.x, hit.y - c.y, hit.z - c.z);
                const dP = Math.hypot(p.xM - c.x, g(p.xM, p.yM) - c.y, p.yM - c.z);
                if (dHit < dP - 2) continue;
                const back = a.screenToWorld(s.xPx, s.yPx);
                const err = Math.hypot(back.xM - p.xM, back.yM - p.yM);
                worst = Math.max(worst, err);
                checked++;
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(500);
      expect(worst).toBeLessThan(0.5);
    });
  }

  it('piksel → punkt mapy → piksel wraca w to samo miejsce (stok 40 %)', () => {
    const g = slopeGround(0.4);
    const rig: RigState = { tx: 1200, ty: g(1200, 1500), tz: 1500, distanceM: 800, yawRad: 0.7, pitchRad: 0.5 };
    const a = view(rig, g);
    for (const [x, y] of [[800, 450], [200, 700], [1400, 300], [1000, 850]]) {
      const w = a.screenToWorld(x, y);
      const s = a.worldToScreen(w.xM, w.yM);
      expect(Math.hypot(s.xPx - x, s.yPx - y)).toBeLessThan(0.5);
    }
    // Metry na piksel – rosną z odległością (kursor dalej = więcej metrów na piksel).
    a.cursor = { xPx: 800, yPx: 850 };
    const near = a.metersPerPixel;
    a.cursor = { xPx: 800, yPx: 200 };
    expect(a.metersPerPixel).toBeGreaterThan(near);
  });
});

describe('Podgląd wyciągu w 3D – za mały prześwit', () => {
  it('na czerwono tylko odcinek z prześwitem poniżej minimum, poza strefą stacji', async () => {
    const { lp } = await import('./guestFixture');
    const { lowClearanceSpans } = await import('../src/render3d/liftPreview3d');
    const type = lp.types.find((t) => t.kind === 'aerial')!;
    const n = 101;
    const ground = Array.from({ length: n }, (_, i) => ({ distanceM: i * 5, xM: i * 5, yM: 0, elevationM: 1000 }));
    const cable = Float64Array.from(ground, (g) => 1000 + (g.distanceM >= 200 && g.distanceM <= 260 ? type.minClearanceM - 2 : type.minClearanceM + 4));
    // Przy samych stacjach lina nisko (strefa stacji – bez sprawdzania).
    cable[0] = cable[1] = cable[n - 1] = cable[n - 2] = 1000.5;
    const an = { type, ground, cableElevationM: cable, supports: [{ distanceM: 0, cableElevationM: 1000, groundElevationM: 1000, kind: 'station' }, { distanceM: 500, cableElevationM: 1000, groundElevationM: 1000, kind: 'station' }] } as never;
    const spans = lowClearanceSpans(an, lp);
    expect(spans).toEqual([{ fromM: 200, toM: 260 }]);
  });
});
