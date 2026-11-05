/**
 * Oprawa graficzna „ilustrowana mapa narciarska” (styl A) – część obliczeniowa wspólna dla
 * shadera terenu i testów (bez PixiJS i bez przeglądarki):
 *  – poziomy szczegółowości (LOD) dla danej skali z płynnymi przejściami,
 *  – deterministyczne rozmieszczenie drzew (ten sam seed = te same drzewa); shader terenu liczy
 *    dokładnie ten sam skrót (hash PCG) w GLSL,
 *  – rodzaj faktury śniegu z modelu śniegu i warstwy śladów,
 *  – barwa światła wg położenia Słońca (poranek chłodny, zmierzch ciepły, noc ciemna).
 */

// ------------------------------------------------------------------ poziomy szczegółowości

export interface LodThresholds {
  /** Powyżej – poziom 1 (cały ośrodek) [m/px]. */
  level1AboveMpp: number;
  /** Poniżej – poziom 3 (detal) [m/px]. */
  level3BelowMpp: number;
  /** Szerokość przejścia (w skali logarytmicznej, ułamek oktawy po obu stronach progu). */
  blendOctaves: number;
}

export interface LodWeights {
  /** Wagi 0–1 poziomów 1, 2, 3 (suma = 1). */
  w1: number;
  w2: number;
  w3: number;
  /** Poziom dominujący (1, 2, 3). */
  level: 1 | 2 | 3;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Wagi poziomów szczegółowości dla skali mpp [m/px] – przejścia płynne (bez przeskoków). */
export function lodWeights(mpp: number, t: LodThresholds): LodWeights {
  const l = Math.log2(mpp);
  const up1 = Math.log2(t.level1AboveMpp);
  const up3 = Math.log2(t.level3BelowMpp);
  const b = t.blendOctaves;
  const w1 = smooth(up1 - b, up1 + b, l);
  const w3 = 1 - smooth(up3 - b, up3 + b, l);
  const w2 = Math.max(0, 1 - w1 - w3);
  const level: 1 | 2 | 3 = w1 >= w2 && w1 >= w3 ? 1 : w3 >= w2 ? 3 : 2;
  return { w1, w2, w3, level };
}

// ------------------------------------------------------------------ skrót (hash) – jak w GLSL

/** PCG hash (32 bity) – identyczny jak w shaderze terenu. */
export function pcgHash(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const shift = ((state >>> 28) + 4) >>> 0;
  const word = Math.imul(((state >>> shift) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

/** Skrót komórki siatki drzew (ix, iy) z ziarnem i numerem warstwy. */
export function cellHash(ix: number, iy: number, seed: number, layer: number): number {
  return pcgHash((Math.imul(ix >>> 0, 73856093) ^ pcgHash((Math.imul(iy >>> 0, 19349663) ^ pcgHash((seed + layer * 1013904223) >>> 0)) >>> 0)) >>> 0);
}

/** Liczba 0–1 z kolejnych bitów skrótu (k = 0, 1, 2, 3). */
export function hashUnit(h: number, k: number): number {
  return ((pcgHash((h + Math.imul(k, 0x9e3779b9)) >>> 0) & 0xffffff) / 16777216);
}

// ------------------------------------------------------------------ drzewa

export interface TreeLayerParams {
  /** Odstęp siatki drzew [m]. */
  spacingM: number;
  /** Wysokość drzewa (z jitterem 0,75–1,25×) [m]. */
  heightM: number;
  /** Numer warstwy (osobne skróty dla poziomu 1 i 2). */
  layer: number;
}

export interface Tree {
  xM: number;
  yM: number;
  heightM: number;
  /** Odcień 0–1 (losowy). */
  tone: number;
}

/**
 * Drzewa w prostokącie [x0, x1) × [y0, y1): w każdej komórce siatki co spacingM co najwyżej jedno
 * drzewo, z położeniem losowanym ze skrótu; drzewo istnieje, gdy los < udział lasu w komórce
 * siatki terenu pod nim (density(xM, yM) 0–1). Ten sam seed = te same drzewa.
 */
export function treesInRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  density: (xM: number, yM: number) => number,
  seed: number,
  p: TreeLayerParams,
): Tree[] {
  const out: Tree[] = [];
  const i0 = Math.floor(x0 / p.spacingM);
  const i1 = Math.ceil(x1 / p.spacingM);
  const j0 = Math.floor(y0 / p.spacingM);
  const j1 = Math.ceil(y1 / p.spacingM);
  for (let j = Math.max(0, j0); j < j1; j++) {
    for (let i = Math.max(0, i0); i < i1; i++) {
      const h = cellHash(i, j, seed, p.layer);
      const x = (i + 0.15 + 0.7 * hashUnit(h, 0)) * p.spacingM;
      const y = (j + 0.15 + 0.7 * hashUnit(h, 1)) * p.spacingM;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
      if (hashUnit(h, 2) >= density(x, y)) continue;
      out.push({ xM: x, yM: y, heightM: p.heightM * (0.75 + 0.5 * hashUnit(h, 3)), tone: hashUnit(h, 4) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ faktura śniegu

/** Rodzaje faktury powierzchni (kolejność = kody w teksturze shadera). */
export const SURFACE_KINDS = ['grass', 'thin', 'powder', 'windPacked', 'settled', 'firn', 'slush', 'icy', 'corduroy', 'moguls', 'tracked'] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export interface SurfaceInput {
  /** Stan śniegu z modelu (SNOW_QUALITY_CODES: none, powder, windPacked, settled, firn, slush, icy, thin). */
  quality: string;
  depthCm: number;
  /** Ślad ratraka 0–1 (warstwa śladów). */
  groomed: number;
  /** Ślady nart 0–1. */
  skied: number;
}

/** Progi faktury (z data/map-style.json). */
export interface SurfaceThresholds {
  /** Ślad ratraka mocniejszy niż – sztruks. */
  groomedMin: number;
  /** Ślady nart mocniejsze niż – na trasie bez ratraka muldy, na puchu ślady. */
  skiedMin: number;
  /** Ślady nart mocniejsze niż – muldy (rozjeżdżony śnieg). */
  mogulsMin: number;
}

/**
 * Rodzaj faktury z modelu śniegu i warstwy śladów: brak śniegu – trawa; przetarty – cienki śnieg
 * z prześwitami; ślad ratraka – sztruks (lód i breja zostają, bo ratrak ich nie usuwa całkiem);
 * dużo przejazdów bez ratraka – muldy; ślady na puchu – „rozjeżdżony puch”; reszta – stan z modelu.
 */
export function surfaceKind(s: SurfaceInput, t: SurfaceThresholds): SurfaceKind {
  if (s.quality === 'none' || s.depthCm <= 0) return 'grass';
  if (s.quality === 'thin') return 'thin';
  if (s.quality === 'icy') return 'icy';
  if (s.quality === 'slush') return 'slush';
  if (s.groomed >= t.groomedMin) return 'corduroy';
  if (s.skied >= t.mogulsMin) return 'moguls';
  if (s.quality === 'powder' && s.skied >= t.skiedMin) return 'tracked';
  if (s.quality === 'powder' || s.quality === 'windPacked' || s.quality === 'settled' || s.quality === 'firn') return s.quality;
  return 'settled';
}

// ------------------------------------------------------------------ światło

export interface Lighting {
  /** Mnożnik barwy (r, g, b) 0–1. */
  tint: [number, number, number];
  /** 0 – dzień, 1 – noc (oświetlenie tras, światła ratraków). */
  night: number;
}

/**
 * Barwa światła z położenia Słońca: wysoko – neutralnie; nisko rano – chłodno (niebieskawo),
 * nisko wieczorem – ciepło (pomarańczowo); pod horyzontem – zmierzch, potem noc (ciemny granat).
 */
export function lightingForSun(elevationDeg: number, azimuthDeg: number): Lighting {
  const day = smooth(-6, 6, elevationDeg); // 0 noc … 1 dzień
  const low = 1 - smooth(0, 12, elevationDeg); // Słońce tuż nad horyzontem
  const side = Math.max(-1, Math.min(1, (azimuthDeg - 180) / 60)); // −1 rano, +1 wieczorem
  const warm: [number, number, number] = [1.0, 0.86, 0.72];
  const cool: [number, number, number] = [0.86, 0.92, 1.0];
  const nightC: [number, number, number] = [0.2, 0.24, 0.38];
  const tint = [0, 1, 2].map((i) => {
    const edge = side < 0 ? 1 + (cool[i] - 1) * -side : 1 + (warm[i] - 1) * side;
    const lit = 1 + (edge - 1) * low;
    return nightC[i] * (1 - day) + lit * day;
  }) as [number, number, number];
  return { tint, night: 1 - day };
}
