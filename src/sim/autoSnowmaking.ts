/**
 * Etap 7f: „Naśnież trasę” – propozycja instalacji naśnieżania dla zaznaczonych tras jednym kliknięciem.
 *
 * Dla każdej trasy:
 *  - rurociąg wzdłuż krawędzi trasy (oś przesunięta o pół szerokości + `edgeOffsetM`, strona i koniec
 *    bliżej sieci wodnej), uproszczony Douglasem–Peuckerem;
 *  - odcinek dojściowy od pompowni albo od istniejącej (lub właśnie proponowanej) rury połączonej
 *    z pompownią – najkrótsza droga po terenie (Dijkstra na siatce, długość 3D × kara za las
 *    i nachylenie), bez hydrantów (`hydrantsFromM`);
 *  - hydranty co `pipe.hydrantSpacingM` (pipelineHydrants), przy każdym armatka: śmigłowa na szerokich
 *    i niezbyt stromych odcinkach z dala od lasu, lanca na wąskich, stromych i przy lesie (reguła
 *    w data/snowmaking.json, sekcja autoPlan);
 *  - koszt = suma elementów (te same wzory co ekonomia: pipelineCost + cena armatek), wydajność przy
 *    temperaturze mokrej `designWetBulbC` (ograniczona pompownią), czas pierwszego zaśnieżenia
 *    (`firstCoverDepthM` ubitego śniegu na powierzchni tras, `hoursPerDay` pracy na dobę).
 * Moduł tylko proponuje – zatwierdzenie (dodanie do układu) robi widok.
 */
import type { PointM } from './lifts';
import type { PisteDesign } from './pistes';
import { resampleAxis } from './pistes';
import type { PipelineDesign, SnowGunDesign } from './snowmaking';
import { connectPipelines, gunProductionM3h, pipelineCost, pipelineHydrants, polylineLengthM, technicalDensity } from './snowmaking';
import type { SnowmakingParams } from './snowmakingParams';
import { gunTypeById } from './snowmakingParams';
import type { TerrainGrid } from './terrainGrid';

export interface AutoSnowInput {
  grid: TerrainGrid;
  /** Udział lasu w komórce 0–1 (pokrycie sprzed wycinki); null – bez lasu. */
  forest: Float32Array | null;
  /** Trasy do naśnieżenia. */
  pistes: PisteDesign[];
  /** Istniejące rurociągi (do podłączenia nowych). */
  pipelines: PipelineDesign[];
  /** Pompownia, do której podłączamy (null – brak: rury zaczną się przy trasie). */
  pump: PointM | null;
  /** Wydajność pompowni [m³/h] (ogranicza wydajność propozycji); brak – bez ograniczenia. */
  pumpCapacityM3h?: number;
  /** Nowy identyfikator obiektu (np. „R31”, „A40”). */
  newId(prefix: 'R' | 'A'): string;
}

export interface AutoSnowPiste {
  pisteId: string;
  pipelineId: string;
  /** Długość rury wzdłuż trasy [m]. */
  edgeM: number;
  /** Odcinek dojściowy od sieci [m] (0 – rura zaczyna się przy sieci). */
  connectorM: number;
  hydrants: number;
  fans: number;
  lances: number;
  /** Czy rura jest połączona z pompownią. */
  connected: boolean;
}

export interface AutoSnowPlan {
  pipelines: PipelineDesign[];
  guns: SnowGunDesign[];
  perPiste: AutoSnowPiste[];
  costPln: number;
  cost: { pipesPln: number; hydrantsPln: number; gunsPln: number };
  /** Wydajność przy temperaturze mokrej designWetBulbC [m³ śniegu/h] (po ograniczeniu pompownią). */
  snowM3h: number;
  /** Potrzebna woda [m³/h] (bez ograniczenia pompownią). */
  waterM3h: number;
  pumpLimited: boolean;
  areaM2: number;
  firstCoverHours: number;
  firstCoverDays: number;
  /** Najdłuższa budowa (obiekty budują się równolegle) [dni]. */
  buildDays: number;
  issues: string[];
}

// ------------------------------------------------------------------ geometria

/** Uproszczenie łamanej (Douglas–Peucker), końce zostają. */
export function simplifyPolyline(pts: PointM[], tolM: number): PointM[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a];
    const B = pts[b];
    const dx = B.xM - A.xM;
    const dy = B.yM - A.yM;
    const L2 = dx * dx + dy * dy;
    let worst = -1;
    let wd = 0;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i];
      let d: number;
      if (L2 < 1e-9) d = Math.hypot(P.xM - A.xM, P.yM - A.yM);
      else {
        const t = Math.max(0, Math.min(1, ((P.xM - A.xM) * dx + (P.yM - A.yM) * dy) / L2));
        d = Math.hypot(P.xM - (A.xM + t * dx), P.yM - (A.yM + t * dy));
      }
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst >= 0 && wd > tolM) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Krawędź trasy: oś przesunięta w bok o pół szerokości + odsunięcie (side = +1 w prawo od kierunku osi, −1 w lewo). */
export function pisteEdgeLine(piste: PisteDesign, side: 1 | -1, offsetM: number, stepM: number, grid: TerrainGrid): PointM[] {
  const s = resampleAxis(piste.points, stepM);
  const out: PointM[] = [];
  for (let i = 0; i < s.length; i++) {
    const a = s[Math.max(0, i - 1)];
    const b = s[Math.min(s.length - 1, i + 1)];
    let tx = b.xM - a.xM;
    let ty = b.yM - a.yM;
    const L = Math.hypot(tx, ty) || 1;
    tx /= L;
    ty /= L;
    // Prawa normalna (w układzie mapy y rośnie na południe): (−ty, tx).
    const nx = -ty * side;
    const ny = tx * side;
    const off = s[i].widthM / 2 + offsetM;
    const q = { xM: s[i].xM + nx * off, yM: s[i].yM + ny * off };
    out.push(Number.isFinite(grid.sampleElevationM(q.xM, q.yM)) ? q : { xM: s[i].xM, yM: s[i].yM });
  }
  return out;
}

/** Punkty sieci, do których można podłączyć nową rurę: pompownia i rury z nią połączone (co 10 m). */
function attachPoints(pipes: PipelineDesign[], pump: PointM | null, sp: SnowmakingParams): PointM[] {
  if (!pump) return [];
  const out: PointM[] = [pump];
  const conn = connectPipelines(pipes, pump, sp);
  for (const p of pipes) {
    if (!conn.has(p.id)) continue;
    const L = polylineLengthM(p.points);
    for (let d = 0; d <= L; d += 10) out.push(pointAtLine(p.points, d));
  }
  return out;
}

function pointAtLine(points: PointM[], d: number): PointM {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    if (acc + seg >= d || i === points.length - 1) {
      const t = seg > 0 ? Math.min(1, Math.max(0, (d - acc) / seg)) : 0;
      return { xM: a.xM + (b.xM - a.xM) * t, yM: a.yM + (b.yM - a.yM) * t };
    }
    acc += seg;
  }
  return points[points.length - 1];
}

/**
 * Najkrótsza droga rury po terenie (Dijkstra, 8 kierunków) z `from` do `to` w oknie wokół obu punktów.
 * Koszt kroku = długość 3D × (1 + forestCostFactor × las) × (1 + steepCostPerPercent × nachylenie %).
 * Zwraca łamaną od `from` do `to` (uproszczoną); null – brak drogi po mapie.
 */
export function terrainPath(grid: TerrainGrid, forest: Float32Array | null, from: PointM, to: PointM, sp: SnowmakingParams): PointM[] | null {
  const ap = sp.autoPlan;
  const cs = grid.cellSizeM;
  const W = grid.widthCells;
  const H = grid.heightCells;
  const ci = (x: number) => Math.max(0, Math.min(W - 1, Math.floor(x / cs)));
  const cj = (y: number) => Math.max(0, Math.min(H - 1, Math.floor(y / cs)));
  const si = ci(from.xM);
  const sj = cj(from.yM);
  const gi = ci(to.xM);
  const gj = cj(to.yM);
  if (si === gi && sj === gj) return [from, to];
  const m = Math.ceil(ap.searchMarginM / cs);
  const i0 = Math.max(0, Math.min(si, gi) - m);
  const i1 = Math.min(W - 1, Math.max(si, gi) + m);
  const j0 = Math.max(0, Math.min(sj, gj) - m);
  const j1 = Math.min(H - 1, Math.max(sj, gj) + m);
  const w = i1 - i0 + 1;
  const h = j1 - j0 + 1;
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const z = grid.elevationM;
  const local = (i: number, j: number) => (j - j0) * w + (i - i0);
  const start = local(si, sj);
  const goal = local(gi, gj);
  dist[start] = 0;
  // Kopiec binarny (indeksy z kosztem).
  const heapK: number[] = [start];
  const heapD: number[] = [0];
  const push = (k: number, d: number) => {
    heapK.push(k);
    heapD.push(d);
    let c = heapK.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapD[p] <= heapD[c]) break;
      [heapK[p], heapK[c]] = [heapK[c], heapK[p]];
      [heapD[p], heapD[c]] = [heapD[c], heapD[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heapK[0];
    const lk = heapK.pop()!;
    const ld = heapD.pop()!;
    if (heapK.length) {
      heapK[0] = lk;
      heapD[0] = ld;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1;
        const r = l + 1;
        let s = c;
        if (l < heapK.length && heapD[l] < heapD[s]) s = l;
        if (r < heapK.length && heapD[r] < heapD[s]) s = r;
        if (s === c) break;
        [heapK[s], heapK[c]] = [heapK[c], heapK[s]];
        [heapD[s], heapD[c]] = [heapD[c], heapD[s]];
        c = s;
      }
    }
    return top;
  };
  const DI = [1, -1, 0, 0, 1, 1, -1, -1];
  const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  while (heapK.length) {
    const k = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) break;
    const li = k % w;
    const lj = (k - li) / w;
    const gk = (lj + j0) * W + (li + i0);
    for (let d = 0; d < 8; d++) {
      const ni = li + DI[d];
      const nj = lj + DJ[d];
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nk = nj * w + ni;
      if (done[nk]) continue;
      const gn = (nj + j0) * W + (ni + i0);
      if (Number.isNaN(z[gn])) continue;
      const horiz = Math.hypot(DI[d], DJ[d]) * cs;
      const dz = z[gn] - z[gk];
      const len3 = Math.hypot(horiz, dz);
      const slope = (Math.abs(dz) / horiz) * 100;
      const f = forest ? 0.5 * (forest[gn] + forest[gk]) : 0;
      const c = len3 * (1 + ap.forestCostFactor * f) * (1 + ap.steepCostPerPercent * slope);
      const nd = dist[k] + c;
      if (nd < dist[nk]) {
        dist[nk] = nd;
        prev[nk] = k;
        push(nk, nd);
      }
    }
  }
  if (!Number.isFinite(dist[goal])) return null;
  const cells: number[] = [];
  for (let k = goal; k >= 0; k = prev[k]) cells.push(k);
  cells.reverse();
  const pts: PointM[] = [from];
  for (let q = 1; q < cells.length - 1; q++) {
    const li = cells[q] % w;
    const lj = (cells[q] - li) / w;
    pts.push({ xM: (li + i0 + 0.5) * cs, yM: (lj + j0 + 0.5) * cs });
  }
  pts.push(to);
  return simplifyPolyline(pts, ap.simplifyToleranceM);
}

// ------------------------------------------------------------------ dobór armatek

/** Typ armatki przy hydrancie: śmigłowa na szerokich, niezbyt stromych odcinkach z dala od lasu; inaczej lanca. */
export function chooseGunType(widthM: number, slopePercent: number, forestShare: number, sp: SnowmakingParams): string {
  const ap = sp.autoPlan;
  const fan = sp.guns.find((g) => g.movable)?.id ?? sp.guns[0].id;
  const lance = sp.guns.find((g) => !g.movable)?.id ?? fan;
  if (forestShare >= ap.lanceForestShare || widthM < ap.fanMinWidthM || slopePercent > ap.fanMaxSlopePercent) return lance;
  return fan;
}

function forestNear(grid: TerrainGrid, forest: Float32Array | null, x: number, y: number, r: number): number {
  if (!forest) return 0;
  const cs = grid.cellSizeM;
  const n = Math.ceil(r / cs);
  const i = Math.floor(x / cs);
  const j = Math.floor(y / cs);
  let s = 0;
  let c = 0;
  for (let dj = -n; dj <= n; dj++) {
    for (let di = -n; di <= n; di++) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= grid.widthCells || nj >= grid.heightCells) continue;
      if (Math.hypot((ni + 0.5) * cs - x, (nj + 0.5) * cs - y) > r) continue;
      s += forest[nj * grid.widthCells + ni];
      c++;
    }
  }
  return c ? s / c : 0;
}

// ------------------------------------------------------------------ propozycja

export function planPisteSnowmaking(input: AutoSnowInput, sp: SnowmakingParams): AutoSnowPlan {
  const ap = sp.autoPlan;
  const { grid } = input;
  const issues: string[] = [];
  const pipelines: PipelineDesign[] = [];
  const guns: SnowGunDesign[] = [];
  const perPiste: AutoSnowPiste[] = [];
  let areaM2 = 0;
  if (!input.pump) issues.push('brak pompowni – rurociągi zaczną się przy trasach; zbuduj pompownię i połącz je z nią');
  for (const piste of input.pistes) {
    if (piste.points.length < 2) continue;
    const axis = resampleAxis(piste.points, ap.sampleStepM);
    for (let i = 1; i < axis.length; i++) areaM2 += (axis[i].distanceM - axis[i - 1].distanceM) * 0.5 * (axis[i].widthM + axis[i - 1].widthM);
    const attach = attachPoints([...input.pipelines, ...pipelines], input.pump, sp);
    // Strona i koniec krawędzi najbliżej sieci (bez sieci – górny koniec, prawa strona).
    let best: { line: PointM[]; from: PointM | null; d: number } | null = null;
    for (const side of [1, -1] as const) {
      const edge = pisteEdgeLine(piste, side, ap.edgeOffsetM, ap.sampleStepM, grid);
      for (const line of [edge, [...edge].reverse()]) {
        if (!attach.length) {
          if (!best) best = { line, from: null, d: 0 };
          continue;
        }
        for (const a of attach) {
          const d = Math.hypot(a.xM - line[0].xM, a.yM - line[0].yM);
          if (!best || d < best.d) best = { line, from: a, d };
        }
      }
    }
    if (!best) continue;
    const edgeLine = simplifyPolyline(best.line, ap.simplifyToleranceM);
    let connector: PointM[] = [];
    if (best.from && best.d > 1e-6) {
      const path = terrainPath(grid, input.forest, best.from, edgeLine[0], sp);
      if (!path) issues.push(`${piste.name}: nie ma drogi dla rury od sieci do trasy`);
      else connector = path;
    } else if (best.from) connector = [best.from];
    const points = connector.length ? [...connector.slice(0, -1), ...edgeLine] : edgeLine;
    const connectorM = connector.length >= 2 ? polylineLengthM(connector) : 0;
    const pipe: PipelineDesign = {
      id: input.newId('R'),
      name: `Naśnieżanie: ${piste.name}`,
      points: points.map((q) => ({ xM: Math.round(q.xM * 10) / 10, yM: Math.round(q.yM * 10) / 10 })),
      ...(connectorM > 0 ? { hydrantsFromM: Math.round(connectorM * 10) / 10 } : {}),
    };
    pipelines.push(pipe);
    let fans = 0;
    let lances = 0;
    const hyd = pipelineHydrants(pipe, sp);
    for (const h of hyd) {
      // Najbliższa próbka osi: szerokość i nachylenie wzdłuż osi.
      let k = 0;
      let kd = Infinity;
      for (let i = 0; i < axis.length; i++) {
        const d = Math.hypot(axis[i].xM - h.xM, axis[i].yM - h.yM);
        if (d < kd) {
          kd = d;
          k = i;
        }
      }
      const a = axis[Math.max(0, k - 1)];
      const b = axis[Math.min(axis.length - 1, k + 1)];
      const run = b.distanceM - a.distanceM;
      const slope = run > 0 ? (Math.abs(grid.sampleElevationM(b.xM, b.yM) - grid.sampleElevationM(a.xM, a.yM)) / run) * 100 : 0;
      const typeId = chooseGunType(axis[k].widthM, Number.isFinite(slope) ? slope : 0, forestNear(grid, input.forest, h.xM, h.yM, ap.forestRadiusM), sp);
      if (gunTypeById(sp, typeId).movable) fans++;
      else lances++;
      guns.push({ id: input.newId('A'), typeId, pipelineId: pipe.id, hydrant: h.index });
    }
    perPiste.push({ pisteId: piste.id, pipelineId: pipe.id, edgeM: polylineLengthM(edgeLine), connectorM, hydrants: hyd.length, fans, lances, connected: false });
  }
  // Połączenie z pompownią (ten sam algorytm co gra).
  const conn = connectPipelines([...input.pipelines, ...pipelines], input.pump, sp);
  for (const pp of perPiste) {
    pp.connected = conn.has(pp.pipelineId);
    if (input.pump && !pp.connected) issues.push(`rura dla trasy ${pp.pisteId} nie łączy się z pompownią`);
  }
  // Koszt (te same wzory co ekonomia).
  let pipesPln = 0;
  let hydrantsPln = 0;
  let buildDays = 0;
  for (const p of pipelines) {
    const c = pipelineCost(p, sp);
    hydrantsPln += c.hydrants * sp.pipe.hydrantCostPln;
    pipesPln += c.costPln - c.hydrants * sp.pipe.hydrantCostPln;
    buildDays = Math.max(buildDays, c.buildDays);
  }
  let gunsPln = 0;
  let snow = 0;
  let water = 0;
  let densSum = 0;
  for (const g of guns) {
    const t = gunTypeById(sp, g.typeId);
    gunsPln += t.costPln;
    const q = gunProductionM3h(t.curveWetBulbC, t.curveSnowM3h, ap.designWetBulbC);
    const rho = technicalDensity(ap.designWetBulbC, t.curveWetBulbC[0], sp);
    snow += q;
    densSum += q * rho;
    water += ((q * rho) / 1000) * (1 + sp.snow.waterLossFraction);
  }
  if (guns.length) buildDays = Math.max(buildDays, 1);
  const cap = input.pumpCapacityM3h;
  const pumpLimited = cap !== undefined && water > cap;
  const snowM3h = pumpLimited && water > 0 ? (snow * cap!) / water : snow;
  const meanRho = snow > 0 ? densSum / snow : sp.snow.densityAtStartKgM3;
  // Pierwsze zaśnieżenie: warstwa ubitego śniegu firstCoverDepthM na całej powierzchni tras.
  const volumeM3 = (areaM2 * ap.firstCoverDepthM * sp.snow.groomedDensityHardKgM3) / meanRho;
  const firstCoverHours = snowM3h > 0 ? volumeM3 / snowM3h : Infinity;
  if (pumpLimited) issues.push(`pompownia (${Math.round(cap!)} m³/h) nie nadąży za wszystkimi armatkami (${Math.round(water)} m³/h)`);
  if (!guns.length) issues.push('trasy za krótkie – brak miejsca na hydrant');
  return {
    pipelines,
    guns,
    perPiste,
    costPln: pipesPln + hydrantsPln + gunsPln,
    cost: { pipesPln, hydrantsPln, gunsPln },
    snowM3h,
    waterM3h: water,
    pumpLimited,
    areaM2,
    firstCoverHours,
    firstCoverDays: firstCoverHours / ap.hoursPerDay,
    buildDays,
    issues,
  };
}
