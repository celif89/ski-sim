import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import { computeScaleBar } from '../src/render/scaleBar';
import { parseViewSettings } from '../src/render/viewSettings';
import { settingsJson } from './helpers';

const MAP_M = 4000; // mapa 400 × 400 komórek po 10 m
const VIEW_W = 1200;
const VIEW_H = 800;
const MIN_MPP = 2;

function newCamera(): Camera {
  return new Camera(MAP_M, MAP_M, MIN_MPP, VIEW_W, VIEW_H);
}

describe('Przeliczanie piksel ↔ metry', () => {
  it('na starcie widać całą mapę (najbardziej ograniczający jest wymiar pionowy okna)', () => {
    const cam = newCamera();
    expect(cam.metersPerPixel).toBeCloseTo(MAP_M / VIEW_H); // 5 m/px
    expect(cam.screenToWorld(VIEW_W / 2, VIEW_H / 2)).toEqual({ xM: 2000, yM: 2000 });
    // Górna i dolna krawędź okna to północna i południowa krawędź mapy.
    expect(cam.screenToWorld(VIEW_W / 2, 0).yM).toBeCloseTo(0);
    expect(cam.screenToWorld(VIEW_W / 2, VIEW_H).yM).toBeCloseTo(MAP_M);
  });

  it('przy różnych poziomach zoomu: 1 piksel = metersPerPixel metrów, a przeliczenie tam i z powrotem się zgadza', () => {
    const cam = newCamera();
    const zoomSteps = [1, 1.5, 2, 2.5]; // kolejne przybliżenia: 5 → 3,33 → 1,67 (ogr. do 2) …
    for (const factor of zoomSteps) {
      cam.zoomAt(VIEW_W / 2, VIEW_H / 2, factor);
      const mpp = cam.metersPerPixel;
      const a = cam.screenToWorld(100, 200);
      const b = cam.screenToWorld(110, 200);
      expect(b.xM - a.xM).toBeCloseTo(10 * mpp, 9);
      for (const [x, y] of [
        [0, 0],
        [123.4, 567.8],
        [VIEW_W, VIEW_H],
      ]) {
        const w = cam.screenToWorld(x, y);
        const s = cam.worldToScreen(w.xM, w.yM);
        expect(s.xPx).toBeCloseTo(x, 9);
        expect(s.yPx).toBeCloseTo(y, 9);
      }
      expect(cam.pixelsPerMeter).toBeCloseTo(1 / mpp, 12);
    }
  });

  it('konkretne wartości: przy 2 m/px punkt 100 px na prawo od środka leży 200 m na wschód', () => {
    const cam = newCamera();
    cam.zoomAt(VIEW_W / 2, VIEW_H / 2, 100); // maksymalne przybliżenie
    expect(cam.metersPerPixel).toBe(MIN_MPP);
    const c = cam.screenToWorld(VIEW_W / 2, VIEW_H / 2);
    const p = cam.screenToWorld(VIEW_W / 2 + 100, VIEW_H / 2 - 50);
    expect(p.xM - c.xM).toBeCloseTo(200);
    expect(p.yM - c.yM).toBeCloseTo(-100); // w górę ekranu = na północ
  });
});

describe('Zoom', () => {
  it('jest wycentrowany na kursorze: punkt terenu pod kursorem zostaje pod kursorem', () => {
    const cam = newCamera();
    cam.zoomAt(VIEW_W / 2, VIEW_H / 2, 2); // najpierw przybliżamy, żeby było miejsce na ruch
    const cursorX = 300;
    const cursorY = 250;
    for (const factor of [1.2, 1.2, 1.5, 0.8, 1.1]) {
      const before = cam.screenToWorld(cursorX, cursorY);
      cam.zoomAt(cursorX, cursorY, factor);
      const after = cam.screenToWorld(cursorX, cursorY);
      expect(after.xM).toBeCloseTo(before.xM, 6);
      expect(after.yM).toBeCloseTo(before.yM, 6);
    }
  });

  it('nie da się przybliżyć bardziej niż do 2 m/px', () => {
    const cam = newCamera();
    for (let k = 0; k < 50; k++) cam.zoomAt(400, 300, 1.5);
    expect(cam.metersPerPixel).toBe(MIN_MPP);
  });

  it('nie da się oddalić dalej niż do widoku całej mapy', () => {
    const cam = newCamera();
    cam.zoomAt(400, 300, 3);
    for (let k = 0; k < 50; k++) cam.zoomAt(400, 300, 0.5);
    expect(cam.metersPerPixel).toBeCloseTo(MAP_M / VIEW_H);
    // Cała mapa na ekranie: oba narożniki mapy w granicach okna.
    const nw = cam.worldToScreen(0, 0);
    const se = cam.worldToScreen(MAP_M, MAP_M);
    expect(nw.xPx).toBeGreaterThanOrEqual(-1e-6);
    expect(nw.yPx).toBeGreaterThanOrEqual(-1e-6);
    expect(se.xPx).toBeLessThanOrEqual(VIEW_W + 1e-6);
    expect(se.yPx).toBeLessThanOrEqual(VIEW_H + 1e-6);
  });

  it('ograniczenie oddalenia przelicza się po zmianie rozmiaru okna', () => {
    const cam = newCamera();
    cam.setViewport(400, 1000); // wąskie, wysokie okno – ogranicza szerokość
    cam.fitWholeMap();
    expect(cam.metersPerPixel).toBeCloseTo(MAP_M / 400);
  });
});

describe('Przesuwanie', () => {
  it('przeciągnięcie o 100 px w prawo przesuwa widok o 100 px × skala na zachód', () => {
    const cam = newCamera();
    cam.zoomAt(VIEW_W / 2, VIEW_H / 2, 2.5); // 2 m/px
    const before = cam.centerXM;
    cam.panByPixels(100, 0);
    expect(cam.centerXM).toBeCloseTo(before - 100 * cam.metersPerPixel);
  });

  it('mapy nie da się „zgubić” – krawędź mapy nie wjeżdża w głąb ekranu', () => {
    const cam = newCamera();
    cam.zoomAt(VIEW_W / 2, VIEW_H / 2, 2.5);
    cam.panByPixels(1e6, 1e6); // ogromne przeciągnięcie w prawo i w dół
    const nw = cam.worldToScreen(0, 0);
    expect(nw.xPx).toBeCloseTo(0);
    expect(nw.yPx).toBeCloseTo(0);
    cam.panByPixels(-1e7, -1e7);
    const se = cam.worldToScreen(MAP_M, MAP_M);
    expect(se.xPx).toBeCloseTo(VIEW_W);
    expect(se.yPx).toBeCloseTo(VIEW_H);
  });
});

describe('Podziałka liniowa', () => {
  it('dobiera okrągłą długość (1, 2, 5 × 10ⁿ m) mieszczącą się w zadanej szerokości', () => {
    expect(computeScaleBar(2, 160)).toMatchObject({ lengthM: 200, widthPx: 100, label: '200 m' });
    expect(computeScaleBar(5, 160)).toMatchObject({ lengthM: 500, widthPx: 100, label: '500 m' });
    expect(computeScaleBar(10, 160)).toMatchObject({ lengthM: 1000, widthPx: 100, label: '1 km' });
    expect(computeScaleBar(3.2, 160)).toMatchObject({ lengthM: 500 });
    expect(computeScaleBar(0.1, 160)).toMatchObject({ lengthM: 10, label: '10 m' });
    expect(computeScaleBar(25, 160)).toMatchObject({ lengthM: 2000, label: '2 km' });
  });

  it('przy każdym zoomie podziałka jest nie dłuższa niż limit i nie krótsza niż jego 40%', () => {
    for (let mpp = 0.5; mpp < 50; mpp *= 1.07) {
      const bar = computeScaleBar(mpp, 160);
      expect(bar.widthPx).toBeLessThanOrEqual(160 + 1e-9);
      expect(bar.widthPx).toBeGreaterThanOrEqual(160 * 0.4);
      expect(bar.widthPx * mpp).toBeCloseTo(bar.lengthM, 9);
    }
  });
});

describe('Ustawienia widoku', () => {
  it('największe przybliżenie w data/settings.json to ok. 0,25 m/px (etap 4b), domyślnie mapa obrócona', () => {
    expect(parseViewSettings(settingsJson).minMetersPerPixel).toBe(0.25);
    expect(parseViewSettings(settingsJson).rotatedByDefault).toBe(true);
  });
});

describe('Obrót mapy o 180°', () => {
  it('północ na dole: punkt na północ od środka jest niżej na ekranie; przeliczenia są odwrotne', () => {
    const cam = new Camera(4000, 4500, 0.25, 1000, 800);
    cam.rotated = true;
    const c = cam.worldToScreen(cam.centerXM, cam.centerYM - 100); // 100 m na północ
    expect(c.yPx).toBeGreaterThan(400);
    const e = cam.worldToScreen(cam.centerXM + 100, cam.centerYM); // 100 m na wschód
    expect(e.xPx).toBeLessThan(500);
    const w = cam.screenToWorld(123, 456);
    const back = cam.worldToScreen(w.xM, w.yM);
    expect(back.xPx).toBeCloseTo(123, 9);
    expect(back.yPx).toBeCloseTo(456, 9);
  });
  it('zoom przy obrocie trzyma punkt pod kursorem, przeciąganie przesuwa mapę za myszą', () => {
    const cam = new Camera(4000, 4500, 0.25, 1000, 800);
    cam.rotated = true;
    const before = cam.screenToWorld(300, 200);
    cam.zoomAt(300, 200, 3);
    const after = cam.screenToWorld(300, 200);
    expect(after.xM).toBeCloseTo(before.xM, 6);
    expect(after.yM).toBeCloseTo(before.yM, 6);
    const p0 = cam.worldToScreen(2000, 2000);
    cam.panByPixels(20, 10);
    const p1 = cam.worldToScreen(2000, 2000);
    expect(p1.xPx - p0.xPx).toBeCloseTo(20, 6);
    expect(p1.yPx - p0.yPx).toBeCloseTo(10, 6);
  });
});
