/**
 * Etap 3D-3: łata gęstej siatki przy kamerze (1 m) – powierzchnia śniegu z prawdziwą rzeźbą warstwy
 * detalu 1 m (muldy, pryzmy armatek). Dalej od kamery teren ma siatkę 10 m (a drobne ślady – tylko
 * w cieniowaniu). Brzeg łaty leży na liniach przez środki komórek 10 m, a rzeźba wygasa w pasie
 * `fadeM` – na brzegu łata ma dokładnie wysokość terenu bazowego (bez szczeliny).
 */
import type { DepthField } from './snowSurface';
import { snowSurfaceAt } from './snowSurface';
import type { HeightField } from './terrainMesh';

/** Dane warstwy detalu 1 m potrzebne do rzeźby (podzbiór `DetailLayer`). */
export interface DetailRelief {
  /** Komórek 1 m na bok komórki 10 m. */
  sub: number;
  per: number;
  /** Blok (komórka 10 m w korytarzu trasy) → indeks; −1 poza korytarzem. */
  blockOf: Int32Array;
  /** Wysokość muld [m] w komórce 1 m. */
  mogul: Float32Array;
  /** Pryzmy z armatek [mm wody] w komórce 1 m. */
  pile: Float32Array;
  /** Gęstość śniegu technicznego w pryzmie [kg/m³] – przeliczenie mm wody → m. */
  pileDensityKgM3: number;
  /** Średnie w bloku (komórce 10 m): śnieg z siatki 10 m już je zawiera – rzeźba to odchylenie od średniej (masa zachowana). */
  mogulMean: Float32Array;
  pileMean: Float32Array;
}

/** Dane rzeźby z warstwy detalu (średnie bloków liczone raz na wersję warstwy). */
export function reliefFrom(layer: { sub: number; per: number; blockOf: Int32Array; mogul: Float32Array; pile: Float32Array; cells: Int32Array }, pileDensityKgM3: number): DetailRelief {
  const nb = layer.cells.length;
  const mogulMean = new Float32Array(nb);
  const pileMean = new Float32Array(nb);
  for (let b = 0; b < nb; b++) {
    let sm = 0;
    let sp = 0;
    for (let r = 0; r < layer.per; r++) {
      sm += layer.mogul[b * layer.per + r];
      sp += layer.pile[b * layer.per + r];
    }
    mogulMean[b] = sm / layer.per;
    pileMean[b] = sp / layer.per;
  }
  return { sub: layer.sub, per: layer.per, blockOf: layer.blockOf, mogul: layer.mogul, pile: layer.pile, pileDensityKgM3, mogulMean, pileMean };
}

/** Wysokość rzeźby detalu [m] w punkcie (muldy + pryzmy, odchylenie od średniej komórki 10 m) – 0 poza korytarzami tras. */
export function detailHeightAt(d: DetailRelief | null, hf: HeightField, xM: number, zM: number): number {
  const q = detailPartsAt(d, hf, xM, zM);
  return q.mogulM + q.pileM;
}

const NO_PARTS = { mogulM: 0, pileM: 0 };

/** Muldy i pryzmy osobno [m] (odchylenie od średniej komórki 10 m). */
export function detailPartsAt(d: DetailRelief | null, hf: HeightField, xM: number, zM: number): { mogulM: number; pileM: number } {
  if (!d) return NO_PARTS;
  const cs = hf.cellSizeM;
  const i = Math.floor(xM / cs);
  const j = Math.floor(zM / cs);
  if (i < 0 || j < 0 || i >= hf.widthCells || j >= hf.heightCells) return NO_PARTS;
  const b = d.blockOf[j * hf.widthCells + i];
  if (b < 0) return NO_PARTS;
  const sm = cs / d.sub;
  const si = Math.min(d.sub - 1, Math.max(0, Math.floor((xM - i * cs) / sm)));
  const sj = Math.min(d.sub - 1, Math.max(0, Math.floor((zM - j * cs) / sm)));
  const idx = b * d.per + sj * d.sub + si;
  return { mogulM: d.mogul[idx] - d.mogulMean[b], pileM: (d.pile[idx] - d.pileMean[b]) / d.pileDensityKgM3 };
}

/**
 * Rozmycie pudełkowe w miejscu (dwa przebiegi, osobno wiersze i kolumny) – pryzma z komórek 1 m staje
 * się łagodnym wałem zamiast igieł; suma (masa) zachowana poza brzegiem siatki.
 */
export function boxBlur(a: Float32Array, side: number, radius: number, passes: number): void {
  if (radius < 1) return;
  const tmp = new Float32Array(side);
  for (let pass = 0; pass < passes; pass++) {
    for (const rows of [true, false]) {
      for (let l = 0; l < side; l++) {
        for (let k = 0; k < side; k++) tmp[k] = a[rows ? l * side + k : k * side + l];
        for (let k = 0; k < side; k++) {
          let s = 0;
          let n = 0;
          for (let o = -radius; o <= radius; o++) {
            const m = k + o;
            if (m < 0 || m >= side) continue;
            s += tmp[m];
            n++;
          }
          a[rows ? l * side + k : k * side + l] = s / n;
        }
      }
    }
  }
}

export interface PatchGeometry {
  x0: number;
  z0: number;
  sizeM: number;
  n: number;
  positions: Float32Array;
  indices: Uint32Array;
}

/** Narożnik łaty wyrównany do linii przez środki komórek (x = (k + 0,5)·bok). */
export function patchOrigin(cx: number, cz: number, sizeM: number, cellSizeM: number): { x0: number; z0: number } {
  const snap = (c: number) => (Math.round((c - sizeM / 2) / cellSizeM - 0.5) + 0.5) * cellSizeM;
  return { x0: snap(cx), z0: snap(cz) };
}

/**
 * Siatka łaty: (n+1)² wierzchołków co `stepM`; wysokość = teren + śnieg + rzeźba detalu × wygaszanie
 * przy brzegu (pas `fadeM`); rzeźba tylko tam, gdzie leży śnieg.
 */
export function buildPatch(
  hf: HeightField,
  depth: DepthField | null,
  exaggeration: number,
  detail: DetailRelief | null,
  x0: number,
  z0: number,
  sizeM: number,
  stepM: number,
  fadeM: number,
): PatchGeometry {
  const n = Math.max(1, Math.round(sizeM / stepM));
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  // Rzeźba: muldy wprost, pryzmy rozmyte (ok. 2 m) – kształt wału, nie pojedynczych komórek.
  const side = n + 1;
  const mog = new Float32Array(side * side);
  const pil = new Float32Array(side * side);
  if (detail && depth) {
    for (let r = 0; r <= n; r++) {
      for (let c = 0; c <= n; c++) {
        const q = detailPartsAt(detail, hf, x0 + (c * sizeM) / n, z0 + (r * sizeM) / n);
        mog[r * side + c] = q.mogulM;
        pil[r * side + c] = q.pileM;
      }
    }
    boxBlur(pil, side, Math.max(1, Math.round(1.5 / (sizeM / n))), 2);
  }
  const valid = new Uint8Array((n + 1) * (n + 1));
  for (let r = 0; r <= n; r++) {
    for (let c = 0; c <= n; c++) {
      const x = x0 + (c * sizeM) / n;
      const z = z0 + (r * sizeM) / n;
      let y = snowSurfaceAt(hf, depth, exaggeration, x, z);
      valid[r * (n + 1) + c] = Number.isFinite(y) ? 1 : 0;
      if (!Number.isFinite(y)) y = 0;
      const edge = Math.min(x - x0, x0 + sizeM - x, z - z0, z0 + sizeM - z);
      const fade = fadeM > 0 ? Math.max(0, Math.min(1, edge / fadeM)) : 1;
      if (fade > 0 && detail && depth) y += fade * fade * (3 - 2 * fade) * exaggeration * (mog[r * side + c] + pil[r * side + c]);
      const o = (r * (n + 1) + c) * 3;
      positions[o] = x;
      positions[o + 1] = y;
      positions[o + 2] = z;
    }
  }
  const all = new Uint32Array(n * n * 6);
  let k = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = r * (n + 1) + c;
      const b = a + 1;
      const d = a + n + 1;
      const e = d + 1;
      // Poza mapą (NaN) – bez trójkątów.
      if (!(valid[a] && valid[b] && valid[d] && valid[e])) continue;
      all[k++] = a;
      all[k++] = d;
      all[k++] = b;
      all[k++] = b;
      all[k++] = d;
      all[k++] = e;
    }
  }
  return { x0, z0, sizeM, n, positions, indices: all.slice(0, k) };
}
