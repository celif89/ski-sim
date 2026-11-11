/**
 * Etap 3D-0: siatka terenu 3D z NMT (siatka gry 10 m). Wierzchołki w środkach komórek; mapa podzielona
 * na kawałki z poziomami szczegółowości (krok 1, 2, 4, 8 komórek wg odległości kamery), na brzegach
 * kawałków fartuchy w dół – zasłaniają szczeliny między różnymi poziomami. Komórki „poza mapą” (NaN,
 * strona słowacka) pomijane – tam widać teren okolicy (model Copernicus) jako tło gór.
 * Czyste funkcje (bez WebGL) – testy i budowa geometrii. Układ: x = wschód [m], z = południe [m]
 * (jak współrzędne lokalne mapy xM, yM), y = wysokość n.p.m. [m].
 */

export interface HeightField {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  elevationM: Float32Array;
}

export interface ChunkDef {
  ci: number;
  cj: number;
  /** Zakres wierzchołków (komórek) [i0, i1] × [j0, j1] włącznie – sąsiednie kawałki dzielą brzeg. */
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  /** Środek i promień w poziomie [m] (do wyboru szczegółowości). */
  cx: number;
  cz: number;
  radiusM: number;
}

export interface ChunkGeometry {
  positions: Float32Array;
  normals: Float32Array;
  /** Współrzędne tekstur danych (0–1 w całej mapie, środki komórek). */
  uvs: Float32Array;
  indices: Uint32Array;
  /** Liczba trójkątów bez fartuchów. */
  surfaceTriangles: number;
}

export function chunkGrid(hf: HeightField, chunkCells: number): ChunkDef[] {
  const out: ChunkDef[] = [];
  const cs = hf.cellSizeM;
  const nI = Math.ceil((hf.widthCells - 1) / chunkCells);
  const nJ = Math.ceil((hf.heightCells - 1) / chunkCells);
  for (let cj = 0; cj < nJ; cj++) {
    for (let ci = 0; ci < nI; ci++) {
      const i0 = ci * chunkCells;
      const j0 = cj * chunkCells;
      const i1 = Math.min(hf.widthCells - 1, i0 + chunkCells);
      const j1 = Math.min(hf.heightCells - 1, j0 + chunkCells);
      const cx = ((i0 + i1) / 2 + 0.5) * cs;
      const cz = ((j0 + j1) / 2 + 0.5) * cs;
      out.push({ ci, cj, i0, j0, i1, j1, cx, cz, radiusM: (Math.hypot(i1 - i0, j1 - j0) / 2) * cs });
    }
  }
  return out;
}

/** Poziom szczegółowości dla odległości kamery od kawałka (0 – pełny, krok 2^poziom). */
export function lodLevel(distanceM: number, lodDistancesM: number[]): number {
  let k = 0;
  while (k < lodDistancesM.length && distanceM > lodDistancesM[k]) k++;
  return k;
}

export function heightAt(hf: HeightField, i: number, j: number): number {
  const ii = Math.max(0, Math.min(hf.widthCells - 1, i));
  const jj = Math.max(0, Math.min(hf.heightCells - 1, j));
  return hf.elevationM[jj * hf.widthCells + ii];
}

/** Wysokość terenu w punkcie (dwuliniowo ze środków komórek; NaN poza mapą). */
export function sampleHeight(hf: HeightField, xM: number, zM: number): number {
  const gx = xM / hf.cellSizeM - 0.5;
  const gz = zM / hf.cellSizeM - 0.5;
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const tx = gx - i;
  const tz = gz - j;
  const a = heightAt(hf, i, j);
  const b = heightAt(hf, i + 1, j);
  const c = heightAt(hf, i, j + 1);
  const d = heightAt(hf, i + 1, j + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** Normalna z różnic środkowych (krok `step` komórek), odporna na brzeg i NaN. */
function normalAt(hf: HeightField, i: number, j: number, step: number): [number, number, number] {
  const cs = hf.cellSizeM;
  const h0 = heightAt(hf, i, j);
  // Różnica środkowa; na brzegu mapy i przy NaN – jednostronna (dzielona przez rzeczywistą rozpiętość).
  const diff = (a: number, b: number, span: number) => {
    const fa = Number.isFinite(a);
    const fb = Number.isFinite(b);
    if (fa && fb) return (a - b) / (2 * span);
    if (fa) return (a - h0) / span;
    if (fb) return (h0 - b) / span;
    return 0;
  };
  const at = (ii: number, jj: number) => (ii < 0 || jj < 0 || ii >= hf.widthCells || jj >= hf.heightCells ? NaN : heightAt(hf, ii, jj));
  const dx = diff(at(i + step, j), at(i - step, j), step * cs);
  const dz = diff(at(i, j + step), at(i, j - step), step * cs);
  const L = Math.hypot(dx, 1, dz);
  return [-dx / L, 1 / L, -dz / L];
}

/**
 * Geometria kawałka z krokiem `step` komórek. Trójkąty z wierzchołkiem NaN pomijane; fartuchy
 * (skirtM w dół) na czterech brzegach kawałka.
 */
export function buildChunk(hf: HeightField, c: ChunkDef, step: number, skirtM: number): ChunkGeometry {
  const cs = hf.cellSizeM;
  const W = hf.widthCells;
  const H = hf.heightCells;
  const is: number[] = [];
  for (let i = c.i0; i < c.i1; i += step) is.push(i);
  is.push(c.i1);
  const js: number[] = [];
  for (let j = c.j0; j < c.j1; j += step) js.push(j);
  js.push(c.j1);
  const nx = is.length;
  const nz = js.length;
  const surf = nx * nz;
  // Fartuchy: kopia wierzchołków brzegu obniżona o skirtM.
  const border: number[] = [];
  for (let a = 0; a < nx; a++) border.push(a);
  for (let b = 1; b < nz; b++) border.push(b * nx + nx - 1);
  for (let a = nx - 2; a >= 0; a--) border.push((nz - 1) * nx + a);
  for (let b = nz - 2; b >= 1; b--) border.push(b * nx);
  const total = surf + border.length;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const uvs = new Float32Array(total * 2);
  const valid = new Uint8Array(total);
  for (let b = 0; b < nz; b++) {
    for (let a = 0; a < nx; a++) {
      const v = b * nx + a;
      const i = is[a];
      const j = js[b];
      const h = heightAt(hf, i, j);
      positions[v * 3] = (i + 0.5) * cs;
      positions[v * 3 + 1] = Number.isFinite(h) ? h : 0;
      positions[v * 3 + 2] = (j + 0.5) * cs;
      const n = normalAt(hf, i, j, step);
      normals.set(n, v * 3);
      uvs[v * 2] = (i + 0.5) / W;
      uvs[v * 2 + 1] = (j + 0.5) / H;
      valid[v] = Number.isFinite(h) ? 1 : 0;
    }
  }
  border.forEach((src, k) => {
    const v = surf + k;
    positions[v * 3] = positions[src * 3];
    positions[v * 3 + 1] = positions[src * 3 + 1] - skirtM;
    positions[v * 3 + 2] = positions[src * 3 + 2];
    normals.set([normals[src * 3], normals[src * 3 + 1], normals[src * 3 + 2]], v * 3);
    uvs[v * 2] = uvs[src * 2];
    uvs[v * 2 + 1] = uvs[src * 2 + 1];
    valid[v] = valid[src];
  });
  const idx: number[] = [];
  for (let b = 0; b < nz - 1; b++) {
    for (let a = 0; a < nx - 1; a++) {
      const v00 = b * nx + a;
      const v10 = v00 + 1;
      const v01 = v00 + nx;
      const v11 = v01 + 1;
      // Przekątna na zmianę – mniej „schodków” na stokach.
      if ((a + b) % 2 === 0) {
        if (valid[v00] && valid[v01] && valid[v11]) idx.push(v00, v01, v11);
        if (valid[v00] && valid[v11] && valid[v10]) idx.push(v00, v11, v10);
      } else {
        if (valid[v00] && valid[v01] && valid[v10]) idx.push(v00, v01, v10);
        if (valid[v10] && valid[v01] && valid[v11]) idx.push(v10, v01, v11);
      }
    }
  }
  const surfaceTriangles = idx.length / 3;
  for (let k = 0; k < border.length; k++) {
    const a0 = border[k];
    const a1 = border[(k + 1) % border.length];
    const s0 = surf + k;
    const s1 = surf + ((k + 1) % border.length);
    if (!valid[a0] || !valid[a1]) continue;
    idx.push(a0, s0, a1, a1, s0, s1);
  }
  return { positions, normals, uvs, indices: Uint32Array.from(idx), surfaceTriangles };
}
