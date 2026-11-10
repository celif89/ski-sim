/**
 * Etap 7e: czytelność rzeźby – cieniowanie wielokierunkowe, cieniowanie nachyleniem, wklęsłości,
 * kreski spadku (te same wzory liczy shader terenu).
 */
import { describe, expect, it } from 'vitest';
import mapStyleJson from '../data/map-style.json';
import pistesJson from '../data/pistes.json';
import {
  concavityField,
  contourLabelAngle,
  downhillScreen,
  ringClass,
  hachures,
  hachureZoomFade,
  lightVectors,
  multiShade,
  parseReliefParams,
  reliefBrightness,
  slopeTone,
  slopeToneFromGradient,
} from '../src/render/relief';

const p = parseReliefParams(mapStyleJson);
const classes = (pistesJson as { classes: { id: string; maxSlopePercent?: { value: number } }[] }).classes;
const blue = classes.find((c) => c.id === 'blue')!.maxSlopePercent!.value;
const red = classes.find((c) => c.id === 'red')!.maxSlopePercent!.value;
const open = () => 1;
const mpp = 2;

describe('Rzeźba terenu (etap 7e)', () => {
  it('płaska powierzchnia: jednolita jasność i zero kresek', () => {
    const flat = () => [0, 0] as [number, number];
    const values = new Set<number>();
    for (const rotated of [false, true]) values.add(Number(reliefBrightness(0, 0, 0, p, blue, red, rotated).toFixed(9)));
    expect(values.size).toBe(1);
    expect(reliefBrightness(0, 0, 0, p, blue, red)).toBeCloseTo(1, 9);
    expect(hachures(0, 0, 2000, 2000, mpp, flat, open, p.hachures, 12345)).toHaveLength(0);
    // Łagodny stok poniżej progu (10 %) – też bez kresek.
    expect(hachures(0, 0, 2000, 2000, mpp, () => [0, 0.1], open, p.hachures, 12345)).toHaveLength(0);
  });

  it('płaszczyzna 30 % na północ: kreski równoległe, skierowane w dół stoku', () => {
    // z = 0,3·y: wyżej na południe (y rośnie na południe), stok opada na północ.
    const z = (_x: number, y: number) => 0.3 * y;
    const strokes = hachures(0, 0, 1000, 1000, mpp, () => [0, 0.3], open, p.hachures, 12345);
    expect(strokes.length).toBeGreaterThan(50);
    for (const s of strokes) {
      const dx = s.bx - s.ax;
      const dy = s.by - s.ay;
      const len = Math.hypot(dx, dy);
      // Równoległe do linii spadku (północ = −y).
      expect(Math.abs(dx) / len).toBeLessThan(1e-9);
      expect(dy / len).toBeCloseTo(-1, 9);
      // Koniec „b” (zwężony) niżej niż „a”.
      expect(z(s.bx, s.by)).toBeLessThan(z(s.ax, s.ay));
    }
  });

  it('cieniowanie nachyleniem nie zależy od kierunku stoku (4 ekspozycje, ten sam spadek)', () => {
    for (const slope of [0.15, 0.3, 0.5]) {
      const tones = [
        [0, slope],
        [slope, 0],
        [0, -slope],
        [-slope, 0],
      ].map(([gx, gy]) => slopeToneFromGradient(gx, gy, p.slope, blue, red));
      for (const t of tones) {
        expect(t.light).toBeCloseTo(tones[0].light, 12);
        expect(t.cool).toBeCloseTo(tones[0].cool, 12);
      }
    }
  });

  it('stromiej – ciemniej i chłodniej; progi zgodne z klasami tras', () => {
    let prev = slopeTone(0, p.slope, blue, red);
    expect(prev.light).toBe(1);
    expect(prev.cool).toBe(0);
    for (let s = 5; s <= 100; s += 5) {
      const t = slopeTone(s, p.slope, blue, red);
      expect(t.light).toBeLessThanOrEqual(prev.light + 1e-12);
      expect(t.cool).toBeGreaterThanOrEqual(prev.cool - 1e-12);
      prev = t;
    }
    expect(slopeTone(blue, p.slope, blue, red).light).toBeCloseTo(1 - (1 - p.slope.lightAtBlue) * p.slope.strength, 9);
    expect(slopeTone(red, p.slope, blue, red).light).toBeCloseTo(1 - (1 - p.slope.lightAtRed) * p.slope.strength, 9);
  });

  it('światło związane z ekranem: główne z lewej góry, po obrocie mapy też', () => {
    const main = p.shading.lights.reduce((a, b) => (b.weight > a.weight ? b : a));
    expect(main.azimuthDeg).toBe(315);
    const iMain = p.shading.lights.indexOf(main);
    const l0 = lightVectors(p.shading, false)[iMain];
    // Bez obrotu: góra ekranu = północ (−y), lewo = zachód (−x).
    expect(l0.x).toBeLessThan(0);
    expect(l0.y).toBeLessThan(0);
    const l1 = lightVectors(p.shading, true)[iMain];
    // Mapa obrócona o 180°: lewa góra ekranu to południowy wschód mapy.
    expect(l1.x).toBeGreaterThan(0);
    expect(l1.y).toBeGreaterThan(0);
    // Stok zwrócony do lewej góry ekranu jaśniejszy niż odwrócony – w obu ustawieniach mapy.
    expect(multiShade(0.3, 0.3, p.shading, false)).toBeGreaterThan(multiShade(-0.3, -0.3, p.shading, false));
    expect(multiShade(-0.3, -0.3, p.shading, true)).toBeGreaterThan(multiShade(0.3, 0.3, p.shading, true));
    expect(multiShade(0, 0, p.shading, false)).toBeCloseTo(1, 12);
  });

  it('wklęsłości: dno doliny ciemniejsze, grzbiet i płaszczyzna bez zmian', () => {
    const W = 60;
    const H = 40;
    const z = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) z[j * W + i] = 0.4 * Math.abs(i - 30) * 10; // dolina wzdłuż i = 30
    const c = concavityField(z, W, H, 10, p.concavity);
    expect(c[20 * W + 30]).toBeGreaterThan(0.5);
    expect(c[20 * W + 5]).toBe(0);
    const plane = new Float32Array(W * H).map((_, k) => 0.3 * Math.floor(k / W) * 10);
    const cp = concavityField(plane, W, H, 10, p.concavity);
    expect(Math.max(...cp.subarray(10 * W, 30 * W))).toBeLessThan(1e-3);
    expect(reliefBrightness(0, 0, 1, p, blue, red)).toBeCloseTo(1 - p.concavity.strength, 9);
  });

  it('kreski: tylko na terenie otwartym, stałe położenie (ziarno), zanik przy oddaleniu i zbliżeniu', () => {
    const g = () => [0, 0.45] as [number, number];
    const a = hachures(0, 0, 800, 800, mpp, g, open, p.hachures, 7);
    const b = hachures(0, 0, 800, 800, mpp, g, open, p.hachures, 7);
    expect(b).toEqual(a);
    // Fragment okna daje te same kreski co całe okno (bez migania przy przesuwaniu).
    const part = hachures(200, 200, 400, 400, mpp, g, open, p.hachures, 7);
    for (const s of part) expect(a).toContainEqual(s);
    expect(hachures(0, 0, 800, 800, mpp, g, () => 0, p.hachures, 7)).toHaveLength(0);
    expect(hachureZoomFade(20, p.hachures)).toBe(0);
    expect(hachureZoomFade(0.2, p.hachures)).toBe(0);
    expect(hachureZoomFade(2, p.hachures)).toBe(1);
    // Stromiej – kreski dłuższe i grubsze.
    const gentle = hachures(0, 0, 800, 800, mpp, () => [0, 0.22], open, p.hachures, 7);
    const steep = hachures(0, 0, 800, 800, mpp, () => [0, 0.65], open, p.hachures, 7);
    const avg = (l: typeof a, f: (s: (typeof a)[number]) => number) => l.reduce((s, x) => s + f(x), 0) / l.length;
    expect(avg(steep, (s) => Math.hypot(s.bx - s.ax, s.by - s.ay))).toBeGreaterThan(avg(gentle, (s) => Math.hypot(s.bx - s.ax, s.by - s.ay)));
    expect(avg(steep, (s) => s.widthM)).toBeGreaterThan(avg(gentle, (s) => s.widthM));
    expect(steep.length).toBeGreaterThan(gentle.length);
  });

  it('opis warstwicy: góra napisu pod górę stoku', () => {
    // Stok wznosi się na południe (gradient +y): góra napisu (−y lokalne po obrocie) ma wskazywać +y.
    const a = contourLabelAngle(0, 0.3);
    const upX = Math.sin(a); // obrót wektora (0, −1) o kąt a
    const upY = -Math.cos(a);
    expect(upX).toBeCloseTo(0, 9);
    expect(upY).toBeCloseTo(1, 9);
  });

  it('pierścień przy budowie: kolor klasy trasy i strzałka w dół stoku (także po obrocie mapy)', () => {
    const cl = (pistesJson as { classes: { color: string; maxSlopePercent?: { value: number } }[] }).classes.map((c) => ({ color: c.color, maxSlopePercent: c.maxSlopePercent?.value ?? Infinity }));
    expect(ringClass(8, cl)).toBe(0);
    expect(ringClass(20, cl)).toBe(1);
    expect(ringClass(33, cl)).toBe(2);
    expect(ringClass(55, cl)).toBe(3);
    // Stok opadający na północ (ekspozycja 0°): bez obrotu strzałka w górę ekranu, po obrocie w dół.
    const n0 = downhillScreen(0, false);
    expect(n0.x).toBeCloseTo(0, 9);
    expect(n0.y).toBeCloseTo(-1, 9);
    const n1 = downhillScreen(0, true);
    expect(n1.y).toBeCloseTo(1, 9);
    const e0 = downhillScreen(90, false);
    expect(e0.x).toBeCloseTo(1, 9);
  });
});
