/**
 * Etap 3D-3: powierzchnia śniegu = teren + grubość pokrywy z modelu (siatka 10 m, wartości w środkach
 * komórek, interpolacja dwuliniowa – bez schodków). Ta sama funkcja w TypeScript (ludzie, linie,
 * wskazywanie myszą, łata detalu przy kamerze, testy) i w GLSL (przesunięcie wierzchołków terenu,
 * czapy śniegu na drzewach i dachach) – wzór identyczny: środki komórek, indeksy przycięte do siatki,
 * „poza mapą” (NaN) = 0 m śniegu.
 */
import type { HeightField } from './terrainMesh';
import { sampleHeight } from './terrainMesh';

export interface DepthField {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  /** Grubość śniegu [m] w komórce (NaN / brak – 0). */
  depthM: Float32Array;
}

function depthCell(f: DepthField, i: number, j: number): number {
  const ii = Math.max(0, Math.min(f.widthCells - 1, i));
  const jj = Math.max(0, Math.min(f.heightCells - 1, j));
  const v = f.depthM[jj * f.widthCells + ii];
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Grubość śniegu [m] w punkcie (dwuliniowo ze środków komórek). */
export function snowDepthAt(f: DepthField | null, xM: number, zM: number): number {
  if (!f) return 0;
  const gx = xM / f.cellSizeM - 0.5;
  const gz = zM / f.cellSizeM - 0.5;
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const tx = gx - i;
  const tz = gz - j;
  const a = depthCell(f, i, j);
  const b = depthCell(f, i + 1, j);
  const c = depthCell(f, i, j + 1);
  const d = depthCell(f, i + 1, j + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** Wysokość powierzchni śniegu [m n.p.m.] = teren + przewyższenie · grubość (przewyższenie 1 – skala prawdziwa). */
export function snowSurfaceAt(hf: HeightField, f: DepthField | null, exaggeration: number, xM: number, zM: number): number {
  return sampleHeight(hf, xM, zM) + exaggeration * snowDepthAt(f, xM, zM);
}

/**
 * GLSL: ten sam wzór na karcie graficznej. Tekstura `uDepthTex` – jeden kanał float [m], wiersz 0 =
 * północ (z = 0), filtr najbliższy (interpolację liczymy sami – zgodnie z `snowDepthAt`).
 */
export const SNOW_DEPTH_GLSL = /* glsl */ `
uniform sampler2D uDepthTex;
uniform vec2 uDepthGrid;      // liczba komórek (szer., wys.)
uniform float uDepthCell;     // bok komórki [m]
uniform float uSnowExag;      // przewyższenie śniegu (1 – skala prawdziwa; tylko menu Dev)
uniform float uHasSnow;
float depthCell(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(uDepthGrid) - 1);
  float v = texelFetch(uDepthTex, c, 0).r;
  return (v > 0.0) ? v : 0.0;
}
float snowDepthAt(vec2 xz) {
  vec2 g = xz / uDepthCell - 0.5;
  vec2 i = floor(g);
  vec2 t = g - i;
  ivec2 c = ivec2(i);
  float a = depthCell(c);
  float b = depthCell(c + ivec2(1, 0));
  float cc = depthCell(c + ivec2(0, 1));
  float d = depthCell(c + ivec2(1, 1));
  return mix(mix(a, b, t.x), mix(cc, d, t.x), t.y) * uHasSnow;
}
`;
