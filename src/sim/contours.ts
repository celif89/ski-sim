/**
 * Warstwice (poziomice) metodą „marching squares”.
 *
 * Wierzchołkami kwadratów są środki komórek. Dla każdego poziomu sprawdza się, które wierzchołki
 * leżą na poziomie lub wyżej, i na krawędziach kwadratu wyznacza (interpolacją liniową) punkty
 * przecięcia z płaszczyzną poziomu. Odcinki łączone są w ciągłe linie.
 *
 * Teren płaski nie daje warstwic (żaden kwadrat nie ma wierzchołków po obu stronach poziomu).
 * Kwadraty z komórką „poza mapą” są pomijane.
 */
import type { TerrainGrid } from './terrainGrid';

export interface ContourLine {
  levelM: number;
  /** Warstwica pogrubiona (wielokrotność majorIntervalM). */
  major: boolean;
  /** Czy linia jest zamknięta (pętla). */
  closed: boolean;
  /** Punkty linii w metrach lokalnych: x0, y0, x1, y1, … */
  points: Float32Array;
}

export interface ContourParams {
  intervalM: number;
  majorIntervalM: number;
}

/** Poziomy warstwic mieszczące się w zakresie wysokości. */
export function contourLevels(minM: number, maxM: number, intervalM: number): number[] {
  const levels: number[] = [];
  if (!(intervalM > 0) || !Number.isFinite(minM) || !Number.isFinite(maxM)) return levels;
  for (let level = Math.ceil(minM / intervalM) * intervalM; level <= maxM; level += intervalM) {
    levels.push(Math.round(level * 1e6) / 1e6);
  }
  return levels;
}

export function isMajorLevel(levelM: number, majorIntervalM: number): boolean {
  const r = levelM / majorIntervalM;
  return Math.abs(r - Math.round(r)) < 1e-9;
}

export function computeContours(grid: TerrainGrid, params: ContourParams): ContourLine[] {
  const { minM, maxM } = grid.elevationRangeM();
  const lines: ContourLine[] = [];
  for (const level of contourLevels(minM, maxM, params.intervalM)) {
    for (const line of traceLevel(grid, level)) {
      lines.push({ levelM: level, major: isMajorLevel(level, params.majorIntervalM), ...line });
    }
  }
  return lines;
}

/**
 * Odcinki dla jednego poziomu, połączone w linie. Krawędzie siatki mają numery:
 * pozioma (i,j)–(i+1,j): 2·(j·W + i); pionowa (i,j)–(i,j+1): 2·(j·W + i) + 1.
 */
export function traceLevel(grid: TerrainGrid, level: number): { closed: boolean; points: Float32Array }[] {
  const w = grid.widthCells;
  const h = grid.heightCells;
  const e = grid.elevationM;
  const c = grid.cellSizeM;
  const pointX = new Map<number, number>();
  const pointY = new Map<number, number>();
  const segA: number[] = [];
  const segB: number[] = [];

  const edgePoint = (edgeId: number): void => {
    if (pointX.has(edgeId)) return;
    const base = edgeId >> 1;
    const i = base % w;
    const j = (base - i) / w;
    const vertical = (edgeId & 1) === 1;
    const v0 = e[j * w + i];
    const v1 = vertical ? e[(j + 1) * w + i] : e[j * w + i + 1];
    const t = (level - v0) / (v1 - v0);
    const x0 = (i + 0.5) * c;
    const y0 = (j + 0.5) * c;
    pointX.set(edgeId, vertical ? x0 : x0 + t * c);
    pointY.set(edgeId, vertical ? y0 + t * c : y0);
  };
  const addSegment = (a: number, b: number): void => {
    edgePoint(a);
    edgePoint(b);
    segA.push(a);
    segB.push(b);
  };

  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const tl = e[j * w + i];
      const tr = e[j * w + i + 1];
      const bl = e[(j + 1) * w + i];
      const br = e[(j + 1) * w + i + 1];
      if (Number.isNaN(tl) || Number.isNaN(tr) || Number.isNaN(bl) || Number.isNaN(br)) continue;
      const code = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = 2 * (j * w + i);
      const bottom = 2 * ((j + 1) * w + i);
      const left = 2 * (j * w + i) + 1;
      const right = 2 * (j * w + i + 1) + 1;
      switch (code) {
        case 1: case 14: addSegment(left, bottom); break;
        case 2: case 13: addSegment(bottom, right); break;
        case 3: case 12: addSegment(left, right); break;
        case 4: case 11: addSegment(top, right); break;
        case 6: case 9: addSegment(top, bottom); break;
        case 7: case 8: addSegment(left, top); break;
        case 5: case 10: {
          // Siodło: rozstrzygnięcie średnią z czterech wierzchołków.
          const centerAbove = (tl + tr + bl + br) / 4 >= level;
          if ((code === 5) === centerAbove) {
            // Środek łączy wierzchołki „powyżej” (tr, bl dla 5; tl, br dla 10).
            if (code === 5) { addSegment(left, top); addSegment(bottom, right); }
            else { addSegment(top, right); addSegment(left, bottom); }
          } else if (code === 5) { addSegment(top, right); addSegment(left, bottom); }
          else { addSegment(left, top); addSegment(bottom, right); }
          break;
        }
      }
    }
  }

  // Łączenie odcinków w linie: każda krawędź należy do co najwyżej dwóch odcinków.
  const edgeToSegs = new Map<number, number[]>();
  for (let s = 0; s < segA.length; s++) {
    for (const edge of [segA[s], segB[s]]) {
      const list = edgeToSegs.get(edge);
      if (list) list.push(s);
      else edgeToSegs.set(edge, [s]);
    }
  }
  const used = new Uint8Array(segA.length);
  const nextFrom = (edge: number, fromSeg: number): number => {
    const list = edgeToSegs.get(edge)!;
    for (const s of list) if (s !== fromSeg && !used[s]) return s;
    return -1;
  };
  const result: { closed: boolean; points: Float32Array }[] = [];
  for (let start = 0; start < segA.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    // Idziemy w przód od końca B, potem wstecz od końca A.
    const forward: number[] = [segA[start], segB[start]];
    let edge = segB[start];
    let seg = start;
    for (let s = nextFrom(edge, seg); s >= 0; s = nextFrom(edge, seg)) {
      used[s] = 1;
      edge = segA[s] === edge ? segB[s] : segA[s];
      seg = s;
      forward.push(edge);
    }
    const closed = forward.length > 2 && forward[forward.length - 1] === forward[0];
    const backward: number[] = [];
    if (!closed) {
      edge = segA[start];
      seg = start;
      for (let s = nextFrom(edge, seg); s >= 0; s = nextFrom(edge, seg)) {
        used[s] = 1;
        edge = segA[s] === edge ? segB[s] : segA[s];
        seg = s;
        backward.push(edge);
      }
    }
    const edges = [...backward.reverse(), ...forward];
    const points = new Float32Array(edges.length * 2);
    edges.forEach((id, n) => {
      points[2 * n] = pointX.get(id)!;
      points[2 * n + 1] = pointY.get(id)!;
    });
    result.push({ closed, points });
  }
  return result;
}
