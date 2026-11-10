/**
 * Etap 7e: czytelność rzeźby terenu – część obliczeniowa wspólna dla shadera terenu, menu
 * deweloperskiego i testów (bez PixiJS i bez przeglądarki). Shader terenu (terrainShader.ts) liczy
 * dokładnie te same wzory w GLSL:
 *  – cieniowanie z kilku kierunków światła naraz (kierunki związane z ekranem – po obrocie mapy
 *    światło dalej pada z lewej góry),
 *  – cieniowanie nachyleniem: płasko jasno, stromo ciemniej i chłodniej – niezależnie od kierunku
 *    stoku (progi jak klasy tras: niebieska do 25 %, czerwona do 40 %),
 *  – przyciemnienie wklęsłości (doliny, żleby – mniej nieba),
 *  – kreski spadku: krótkie kreski wzdłuż linii największego spadku, zwężone w dół stoku,
 *    rozmieszczone na stałe (ziarno),
 *  – warstwice: odstęp zależny od przybliżenia, pogrubione co 100 m.
 * Parametry: data/map-style.json, sekcja „relief”.
 */
import { readNumber, readSection } from '../sim/params';
import { cellHash, hashUnit } from './illustration';

const FILE = 'data/map-style.json';

export interface ReliefLight {
  /** Kierunek, z którego pada światło, na ekranie: 0° = z góry ekranu, 90° = z prawej, zgodnie z ruchem wskazówek. */
  azimuthDeg: number;
  weight: number;
}

export interface ReliefParams {
  shading: { altitudeDeg: number; strength: number; zFactor: number; lights: ReliefLight[] };
  slope: { lightAtBlue: number; lightAtRed: number; lightAtSteep: number; steepPercent: number; coolStrength: number; strength: number };
  concavity: { radiusM: number; depthForFullM: number; strength: number };
  hachures: {
    minSlopePercent: number;
    fullSlopePercent: number;
    maxSlopePercent: number;
    spacingPx: number;
    spacingMinM: number;
    spacingMaxM: number;
    lengthMin: number;
    lengthMax: number;
    widthMinPx: number;
    widthMaxPx: number;
    densityMin: number;
    strength: number;
    farFadeStartMpp: number;
    farFadeEndMpp: number;
    nearFadeStartMpp: number;
    nearFadeEndMpp: number;
    seedSalt: number;
  };
  contours: {
    intervalNearM: number;
    intervalFarM: number;
    majorIntervalM: number;
    nearBelowMpp: number;
    farAboveMpp: number;
    minorWidthPx: number;
    majorWidthPx: number;
    minorStrength: number;
    majorStrength: number;
    labelSpacingM: number;
    labelMinLineLengthM: number;
    labelFontPx: number;
    labelMaxMpp: number;
  };
  forest: { treeShadeStrength: number; iconDensity: number };
  buildRing: { radiusPx: number; arrowPx: number };
}

export function parseReliefParams(raw: unknown): ReliefParams {
  const sec = readSection(raw, 'relief', FILE);
  const sub = (k: string) => readSection(sec, k, FILE);
  const n = (o: Record<string, unknown>, k: string, opt: { min?: number; max?: number } = { min: 0 }) => readNumber(o, k, FILE, opt);
  const sh = sub('shading');
  const sl = sub('slope');
  const cc = sub('concavity');
  const hc = sub('hachures');
  const ct = sub('contours');
  const fo = sub('forest');
  const br = sub('buildRing');
  const lights: ReliefLight[] = [1, 2, 3, 4].map((i) => ({ azimuthDeg: n(sh, `light${i}AzimuthDeg`, { min: 0, max: 360 }), weight: n(sh, `light${i}Weight`, { min: 0, max: 1 }) }));
  const p: ReliefParams = {
    shading: { altitudeDeg: n(sh, 'altitudeDeg', { min: 5, max: 85 }), strength: n(sh, 'strength', { min: 0, max: 2 }), zFactor: n(sh, 'zFactor', { min: 0.2, max: 8 }), lights },
    slope: {
      lightAtBlue: n(sl, 'lightAtBlue', { min: 0.3, max: 1 }),
      lightAtRed: n(sl, 'lightAtRed', { min: 0.3, max: 1 }),
      lightAtSteep: n(sl, 'lightAtSteep', { min: 0.3, max: 1 }),
      steepPercent: n(sl, 'steepPercent', { min: 41, max: 200 }),
      coolStrength: n(sl, 'coolStrength', { min: 0, max: 1 }),
      strength: n(sl, 'strength', { min: 0, max: 2 }),
    },
    concavity: { radiusM: n(cc, 'radiusM', { min: 10, max: 300 }), depthForFullM: n(cc, 'depthForFullM', { min: 0.5, max: 100 }), strength: n(cc, 'strength', { min: 0, max: 1 }) },
    hachures: {
      minSlopePercent: n(hc, 'minSlopePercent'),
      fullSlopePercent: n(hc, 'fullSlopePercent'),
      maxSlopePercent: n(hc, 'maxSlopePercent'),
      spacingPx: n(hc, 'spacingPx', { min: 3 }),
      spacingMinM: n(hc, 'spacingMinM', { min: 1 }),
      spacingMaxM: n(hc, 'spacingMaxM', { min: 1 }),
      lengthMin: n(hc, 'lengthMin', { min: 0.05, max: 2 }),
      lengthMax: n(hc, 'lengthMax', { min: 0.05, max: 2 }),
      widthMinPx: n(hc, 'widthMinPx', { min: 0.1 }),
      widthMaxPx: n(hc, 'widthMaxPx', { min: 0.1 }),
      densityMin: n(hc, 'densityMin', { min: 0, max: 1 }),
      strength: n(hc, 'strength', { min: 0, max: 1 }),
      farFadeStartMpp: n(hc, 'farFadeStartMpp', { min: 0.01 }),
      farFadeEndMpp: n(hc, 'farFadeEndMpp', { min: 0.01 }),
      nearFadeStartMpp: n(hc, 'nearFadeStartMpp', { min: 0.01 }),
      nearFadeEndMpp: n(hc, 'nearFadeEndMpp', { min: 0.01 }),
      seedSalt: n(hc, 'seedSalt'),
    },
    contours: {
      intervalNearM: n(ct, 'intervalNearM', { min: 1 }),
      intervalFarM: n(ct, 'intervalFarM', { min: 1 }),
      majorIntervalM: n(ct, 'majorIntervalM', { min: 1 }),
      nearBelowMpp: n(ct, 'nearBelowMpp', { min: 0.01 }),
      farAboveMpp: n(ct, 'farAboveMpp', { min: 0.01 }),
      minorWidthPx: n(ct, 'minorWidthPx', { min: 0.1 }),
      majorWidthPx: n(ct, 'majorWidthPx', { min: 0.1 }),
      minorStrength: n(ct, 'minorStrength', { min: 0, max: 1 }),
      majorStrength: n(ct, 'majorStrength', { min: 0, max: 1 }),
      labelSpacingM: n(ct, 'labelSpacingM', { min: 50 }),
      labelMinLineLengthM: n(ct, 'labelMinLineLengthM'),
      labelFontPx: n(ct, 'labelFontPx', { min: 6 }),
      labelMaxMpp: n(ct, 'labelMaxMpp', { min: 0.01 }),
    },
    forest: { treeShadeStrength: n(fo, 'treeShadeStrength', { min: 0, max: 2 }), iconDensity: n(fo, 'iconDensity', { min: 0.05, max: 1 }) },
    buildRing: { radiusPx: n(br, 'radiusPx', { min: 8 }), arrowPx: n(br, 'arrowPx', { min: 4 }) },
  };
  const h = p.hachures;
  if (!(h.minSlopePercent < h.fullSlopePercent && h.fullSlopePercent < h.maxSlopePercent)) throw new Error(`${FILE}: relief.hachures – wymagane minSlopePercent < fullSlopePercent < maxSlopePercent`);
  if (!(h.nearFadeEndMpp < h.nearFadeStartMpp && h.farFadeStartMpp < h.farFadeEndMpp)) throw new Error(`${FILE}: relief.hachures – progi zanikania w złej kolejności`);
  if (p.contours.majorIntervalM % p.contours.intervalFarM !== 0 || p.contours.intervalFarM % p.contours.intervalNearM !== 0) {
    throw new Error(`${FILE}: relief.contours – odstępy warstwic muszą być swoimi wielokrotnościami (10 / 50 / 100 m)`);
  }
  return p;
}

const sstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ------------------------------------------------------------------ światło (kierunki ekranu)

/**
 * Wektory kierunku do światła w układzie mapy (x na wschód, y na południe, z w górę) dla mapy
 * obróconej o 180° (rotated) albo nie. Na ekranie „góra” to −y mapy (bez obrotu) albo +y (obrót).
 */
export function lightVectors(p: ReliefParams['shading'], rotated: boolean): { x: number; y: number; z: number; w: number }[] {
  const s = rotated ? -1 : 1;
  const alt = (p.altitudeDeg * Math.PI) / 180;
  return p.lights.map((l) => {
    const a = (l.azimuthDeg * Math.PI) / 180;
    // Na ekranie: kierunek do światła = (sin a, −cos a) (x w prawo, y w dół ekranu); na mapie × s.
    return { x: s * Math.sin(a) * Math.cos(alt), y: -s * Math.cos(a) * Math.cos(alt), z: Math.sin(alt), w: l.weight };
  });
}

/**
 * Cieniowanie z kilku kierunków dla gradientu terenu (gx, gy) = (∂z/∂x, ∂z/∂y) [m/m],
 * z przewyższeniem; 1 = płasko, > 1 – stok zwrócony do światła, < 1 – w cieniu.
 */
export function multiShade(gx: number, gy: number, p: ReliefParams['shading'], rotated: boolean): number {
  const zf = p.zFactor;
  const nx = -gx * zf;
  const ny = -gy * zf;
  const len = Math.hypot(nx, ny, 1);
  let sum = 0;
  let flat = 0;
  for (const L of lightVectors(p, rotated)) {
    sum += L.w * Math.max(0, (nx * L.x + ny * L.y + L.z) / len);
    flat += L.w * L.z;
  }
  const s = flat > 1e-6 ? sum / flat : 1;
  return 1 + (s - 1) * p.strength;
}

// ------------------------------------------------------------------ cieniowanie nachyleniem

/**
 * Jasność od samego nachylenia (niezależna od kierunku stoku): 1 płasko, lightAtBlue przy granicy
 * tras niebieskich (25 %), lightAtRed przy granicy czerwonych (40 %), lightAtSteep od steepPercent.
 * Zwraca jasność i udział chłodnej (niebieskoszarej) barwy 0–1.
 */
export function slopeTone(slopePercent: number, p: ReliefParams['slope'], blueMaxPercent: number, redMaxPercent: number): { light: number; cool: number } {
  const s = Math.max(0, slopePercent);
  let v: number;
  if (s <= blueMaxPercent) v = lerp(1, p.lightAtBlue, s / blueMaxPercent);
  else if (s <= redMaxPercent) v = lerp(p.lightAtBlue, p.lightAtRed, (s - blueMaxPercent) / (redMaxPercent - blueMaxPercent));
  else v = lerp(p.lightAtRed, p.lightAtSteep, Math.min(1, (s - redMaxPercent) / (p.steepPercent - redMaxPercent)));
  const light = 1 - (1 - v) * p.strength;
  return { light, cool: Math.min(1, (1 - light) * p.coolStrength * 3) };
}

/** Jasność z gradientu (gx, gy) – nachylenie = |gradient| × 100 %; kierunek nie ma znaczenia. */
export function slopeToneFromGradient(gx: number, gy: number, p: ReliefParams['slope'], blueMaxPercent: number, redMaxPercent: number) {
  return slopeTone(Math.hypot(gx, gy) * 100, p, blueMaxPercent, redMaxPercent);
}

// ------------------------------------------------------------------ wklęsłości

/**
 * Wklęsłość (0–1) w komórkach: o ile komórka leży niżej niż średnia otoczenia w promieniu radiusM
 * (suma prefiksowa – kwadrat o boku 2R), względem depthForFullM. Komórki poza mapą (NaN) – 0.
 */
export function concavityField(elevationM: Float32Array, widthCells: number, heightCells: number, cellSizeM: number, p: ReliefParams['concavity']): Float32Array {
  const W = widthCells;
  const H = heightCells;
  const sat = new Float64Array((W + 1) * (H + 1));
  const cnt = new Float64Array((W + 1) * (H + 1));
  for (let j = 0; j < H; j++) {
    let rs = 0;
    let rc = 0;
    for (let i = 0; i < W; i++) {
      const v = elevationM[j * W + i];
      if (!Number.isNaN(v)) {
        rs += v;
        rc += 1;
      }
      sat[(j + 1) * (W + 1) + i + 1] = sat[j * (W + 1) + i + 1] + rs;
      cnt[(j + 1) * (W + 1) + i + 1] = cnt[j * (W + 1) + i + 1] + rc;
    }
  }
  const r = Math.max(1, Math.round(p.radiusM / cellSizeM));
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const j0 = Math.max(0, j - r);
    const j1 = Math.min(H, j + r + 1);
    for (let i = 0; i < W; i++) {
      const h = elevationM[j * W + i];
      if (Number.isNaN(h)) continue;
      const i0 = Math.max(0, i - r);
      const i1 = Math.min(W, i + r + 1);
      const s = sat[j1 * (W + 1) + i1] - sat[j0 * (W + 1) + i1] - sat[j1 * (W + 1) + i0] + sat[j0 * (W + 1) + i0];
      const c = cnt[j1 * (W + 1) + i1] - cnt[j0 * (W + 1) + i1] - cnt[j1 * (W + 1) + i0] + cnt[j0 * (W + 1) + i0];
      if (c <= 0) continue;
      out[j * W + i] = Math.min(1, Math.max(0, (s / c - h) / p.depthForFullM));
    }
  }
  return out;
}

// ------------------------------------------------------------------ jasność terenu (bez barw)

/**
 * Łączna jasność rzeźby w punkcie (bez barwy śniegu/trawy): cieniowanie wielokierunkowe ×
 * cieniowanie nachyleniem × przyciemnienie wklęsłości. Płasko i bez wklęsłości = 1.
 */
export function reliefBrightness(gx: number, gy: number, concavity: number, p: ReliefParams, blueMaxPercent: number, redMaxPercent: number, rotated = false): number {
  const md = multiShade(gx, gy, p.shading, rotated);
  const st = slopeToneFromGradient(gx, gy, p.slope, blueMaxPercent, redMaxPercent);
  return md * st.light * (1 - p.concavity.strength * concavity);
}

// ------------------------------------------------------------------ kreski spadku

export interface Hachure {
  /** Koniec górny (szerszy) i dolny (zwężony) kreski [m mapy]. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Szerokość przy górnym końcu [m mapy]. */
  widthM: number;
  /** Krycie 0–1 (zanik przy progu nachylenia i przybliżenia). */
  alpha: number;
}

/** Odstęp kresek [m] dla skali mpp – stały na ekranie (spacingPx), w granicach spacingMin–MaxM. */
export function hachureSpacingM(mpp: number, h: ReliefParams['hachures']): number {
  return Math.min(h.spacingMaxM, Math.max(h.spacingMinM, h.spacingPx * mpp));
}

/** Zanik kresek z przybliżeniem (0–1): brak przy dużym oddaleniu i przy dużym zbliżeniu (faktury 7d). */
export function hachureZoomFade(mpp: number, h: ReliefParams['hachures']): number {
  return (1 - sstep(h.farFadeStartMpp, h.farFadeEndMpp, mpp)) * sstep(h.nearFadeEndMpp, h.nearFadeStartMpp, mpp);
}

/**
 * Kreski spadku w prostokącie [x0, x1] × [y0, y1] dla skali mpp. gradAt(x, y) – gradient terenu
 * [m/m] (∂z/∂x, ∂z/∂y), openAt(x, y) – udział terenu otwartego 0–1 (las = 0; kreski tylko na
 * terenie otwartym i trasach). Rozmieszczenie: siatka o odstępie hachureSpacingM, w każdym oczku
 * punkt losowany ze skrótu (ziarno) – zawsze te same kreski, bez migania przy przesuwaniu.
 * Ten sam algorytm liczy shader terenu.
 */
export function hachures(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mpp: number,
  gradAt: (x: number, y: number) => [number, number],
  openAt: (x: number, y: number) => number,
  h: ReliefParams['hachures'],
  seed: number,
): Hachure[] {
  const out: Hachure[] = [];
  const zoom = hachureZoomFade(mpp, h);
  if (zoom <= 0) return out;
  const S = hachureSpacingM(mpp, h);
  for (let cy = Math.floor(y0 / S); cy <= Math.floor(y1 / S); cy++) {
    for (let cx = Math.floor(x0 / S); cx <= Math.floor(x1 / S); cx++) {
      const s = hachureAt(cx, cy, S, mpp, gradAt, openAt, h, seed, zoom);
      if (s) out.push(s);
    }
  }
  return out;
}

/** Kreska w oczku (cx, cy) siatki o odstępie S (albo null) – wspólne z shaderem. */
export function hachureAt(
  cx: number,
  cy: number,
  S: number,
  mpp: number,
  gradAt: (x: number, y: number) => [number, number],
  openAt: (x: number, y: number) => number,
  h: ReliefParams['hachures'],
  seed: number,
  zoom: number,
): Hachure | null {
  if (cx < 0 || cy < 0) return null;
  const hs = cellHash(cx, cy, seed, h.seedSalt);
  const px = (cx + 0.2 + 0.6 * hashUnit(hs, 0)) * S;
  const py = (cy + 0.2 + 0.6 * hashUnit(hs, 1)) * S;
  const [gx, gy] = gradAt(px, py);
  const g = Math.hypot(gx, gy);
  const slope = g * 100;
  const vis = sstep(h.minSlopePercent, h.fullSlopePercent, slope);
  if (vis <= 0) return null;
  const t = Math.min(1, Math.max(0, (slope - h.fullSlopePercent) / (h.maxSlopePercent - h.fullSlopePercent)));
  // Gęstość rośnie z nachyleniem: przy łagodnym stoku część oczek pusta.
  if (hashUnit(hs, 2) >= lerp(h.densityMin, 1, t)) return null;
  const open = openAt(px, py);
  if (open <= 0.02) return null;
  const dx = -gx / g;
  const dy = -gy / g;
  const len = S * lerp(h.lengthMin, h.lengthMax, t);
  return {
    ax: px - (dx * len) / 2,
    ay: py - (dy * len) / 2,
    bx: px + (dx * len) / 2,
    by: py + (dy * len) / 2,
    widthM: lerp(h.widthMinPx, h.widthMaxPx, t) * mpp,
    alpha: vis * zoom * open,
  };
}

// ------------------------------------------------------------------ warstwice

/** Odstęp cienkich warstwic [m] i udział gęstszych (10 m) przy skali mpp (0 – tylko co 50 m). */
export function contourIntervals(mpp: number, c: ReliefParams['contours']): { nearWeight: number } {
  return { nearWeight: 1 - sstep(c.nearBelowMpp, c.farAboveMpp, mpp) };
}

/** Kąt opisu warstwicy [rad, w układzie mapy] tak, by góra napisu wskazywała pod górę (konwencja map). */
export function contourLabelAngle(gx: number, gy: number): number {
  // Góra napisu = kierunek pod górę (gx, gy); oś napisu prostopadle. W PixiJS góra tekstu = −y lokalne.
  return Math.atan2(gy, gx) + Math.PI / 2;
}

// ------------------------------------------------------------------ pierścień nachylenia (budowa)

export interface RingClass {
  color: string;
  maxSlopePercent: number;
}

/** Klasa (indeks) nachylenia [%] – jak pisteClassIndex (kolor pierścienia przy budowie). */
export function ringClass(slopePercent: number, classes: RingClass[]): number {
  for (let i = 0; i < classes.length; i++) if (slopePercent <= classes[i].maxSlopePercent) return i;
  return classes.length - 1;
}

/** Kierunek spadku na ekranie (jednostkowy) z ekspozycji [° od północy, kierunek spadku] i obrotu mapy. */
export function downhillScreen(aspectDeg: number, rotated: boolean): { x: number; y: number } {
  const a = (aspectDeg * Math.PI) / 180;
  const s = rotated ? -1 : 1;
  // Na mapie: wschód = +x, południe = +y; stok o ekspozycji a opada w tę stronę.
  return { x: s * Math.sin(a), y: -s * Math.cos(a) };
}

// ------------------------------------------------------------------ menu deweloperskie

export interface ReliefSlider {
  /** Ścieżka w ReliefParams, np. „shading.zFactor” albo „shading.lights.0.weight”. */
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Suwaki w menu deweloperskim (zmiana od razu przelicza kafle terenu). */
export const RELIEF_SLIDERS: ReliefSlider[] = [
  { path: 'shading.zFactor', label: 'Przewyższenie cieniowania', min: 0.5, max: 5, step: 0.1 },
  { path: 'shading.strength', label: 'Siła cieniowania', min: 0, max: 1.5, step: 0.05 },
  { path: 'shading.altitudeDeg', label: 'Wysokość światła [°]', min: 10, max: 80, step: 1 },
  { path: 'shading.lights.0.weight', label: 'Światło 1 (lewa góra) – waga', min: 0, max: 1, step: 0.05 },
  { path: 'shading.lights.1.weight', label: 'Światło 2 – waga', min: 0, max: 1, step: 0.05 },
  { path: 'shading.lights.2.weight', label: 'Światło 3 – waga', min: 0, max: 1, step: 0.05 },
  { path: 'shading.lights.3.weight', label: 'Światło 4 – waga', min: 0, max: 1, step: 0.05 },
  { path: 'slope.strength', label: 'Cieniowanie nachyleniem – siła', min: 0, max: 2, step: 0.05 },
  { path: 'slope.lightAtBlue', label: 'Jasność przy 25 %', min: 0.4, max: 1, step: 0.01 },
  { path: 'slope.lightAtRed', label: 'Jasność przy 40 %', min: 0.4, max: 1, step: 0.01 },
  { path: 'slope.lightAtSteep', label: 'Jasność stromo', min: 0.4, max: 1, step: 0.01 },
  { path: 'slope.coolStrength', label: 'Chłodny odcień stromizn', min: 0, max: 1, step: 0.05 },
  { path: 'concavity.strength', label: 'Wklęsłości – przyciemnienie', min: 0, max: 0.6, step: 0.01 },
  { path: 'concavity.radiusM', label: 'Wklęsłości – promień [m]', min: 20, max: 200, step: 10 },
  { path: 'hachures.strength', label: 'Kreski – siła', min: 0, max: 1, step: 0.05 },
  { path: 'hachures.minSlopePercent', label: 'Kreski od nachylenia [%]', min: 5, max: 30, step: 1 },
  { path: 'hachures.spacingPx', label: 'Kreski – odstęp [px]', min: 5, max: 30, step: 1 },
  { path: 'hachures.widthMaxPx', label: 'Kreski – grubość max [px]', min: 0.5, max: 4, step: 0.1 },
  { path: 'contours.minorStrength', label: 'Warstwice – siła', min: 0, max: 1, step: 0.02 },
  { path: 'contours.majorStrength', label: 'Warstwice 100 m – siła', min: 0, max: 1, step: 0.02 },
  { path: 'forest.treeShadeStrength', label: 'Las – cieniowanie drzew', min: 0, max: 2, step: 0.05 },
  { path: 'forest.iconDensity', label: 'Las – gęstość ikon z daleka', min: 0.1, max: 1, step: 0.05 },
];

export function getPath(obj: unknown, path: string): number {
  let o = obj as Record<string, unknown>;
  const parts = path.split('.');
  for (const k of parts.slice(0, -1)) o = o[k] as Record<string, unknown>;
  return o[parts[parts.length - 1]] as number;
}

export function setPath(obj: unknown, path: string, v: number): void {
  let o = obj as Record<string, unknown>;
  const parts = path.split('.');
  for (const k of parts.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[parts[parts.length - 1]] = v;
}
