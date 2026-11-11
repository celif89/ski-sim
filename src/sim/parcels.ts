/**
 * Etap 7g: działki do dokupienia (wzór: Cities: Skylines).
 *
 * Mapa podzielona na kwadraty `parcelSizeM` (ok. 1 × 1 km); działka częściowo poza Polską / poza mapą –
 * liczy się tylko część polska (komórki siatki z wysokością), skrawki mniejsze niż `minAreaHa` pomijamy.
 * Cena = łąka × cena łąki + zabudowa × cena gruntu budowlanego + las × wartość gruntu leśnego; działka
 * w większości leśna – tylko dzierżawa (Lasy Państwowe nie sprzedają). Dzierżawa: roczny czynsz jako
 * udział wartości gruntu. Budować można tylko na swoich działkach: wyciąg, trasa, droga, rurociąg, rów
 * i budynek muszą w całości leżeć na swoich działkach.
 */
import type { GameState } from './economy';
import type { PointM } from './lifts';
import { liftPath } from './lifts';
import { readNumber } from './params';
import type { ResortAnalysis, ResortLayout } from './resort';
import { formatIsoDate } from './time';

const FILE = 'data/land.json';

export interface LandParams {
  parcelSizeM: number;
  minAreaHa: number;
  roadTouchM: number;
  meadowPlnPerHa: number;
  forestValuePlnPerHa: number;
  builtPlnPerHa: number;
  forestLeaseOnlyShare: number;
  leaseSharePerYear: number;
  forestLeaseSharePerYear: number;
  leaseDueMonth: number;
}

export function parseLandParams(raw: unknown): LandParams {
  const r = raw as Record<string, unknown>;
  return {
    ...(Object.fromEntries((['parcelSizeM', 'minAreaHa', 'roadTouchM', 'meadowPlnPerHa', 'forestValuePlnPerHa', 'builtPlnPerHa', 'leaseSharePerYear', 'forestLeaseSharePerYear'] as const).map((k) => [k, readNumber(r, k, FILE, { min: 0 })])) as Record<'parcelSizeM' | 'minAreaHa' | 'roadTouchM' | 'meadowPlnPerHa' | 'forestValuePlnPerHa' | 'builtPlnPerHa' | 'leaseSharePerYear' | 'forestLeaseSharePerYear', number>),
    forestLeaseOnlyShare: readNumber(r, 'forestLeaseOnlyShare', FILE, { min: 0, max: 1 }),
    leaseDueMonth: readNumber(r, 'leaseDueMonth', FILE, { min: 1, max: 12, integer: true }),
  };
}

export interface Parcel {
  /** Nazwa: litera kolumny (od zachodu) i numer wiersza (od północy), np. „C4”. */
  id: string;
  i: number;
  j: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Środek części polskiej [m]. */
  cx: number;
  cy: number;
  areaHa: number;
  forestShare: number;
  builtShare: number;
  zMinM: number;
  zMaxM: number;
  meanSlopePercent: number;
  /** Nachylenie, którego nie przekracza 90 % powierzchni [%]. */
  p90SlopePercent: number;
  streamKm: number;
  touchesRoad: boolean;
  leaseOnly: boolean;
  /** Cena zakupu [zł] (null – tylko dzierżawa). */
  pricePln: number | null;
  leasePlnPerYear: number;
}

export interface ParcelGrid {
  sizeM: number;
  cols: number;
  rows: number;
  parcels: Parcel[];
  /** Indeks działki w `parcels` dla kwadratu (j · cols + i); −1 – brak (skrawek, poza mapą). */
  index: Int32Array;
}

export interface ParcelGridInput {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  elevationM: Float32Array;
  slopePercent?: Float32Array | null;
}

export function parcelName(i: number, j: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${s}${j + 1}`;
}

/** Odległość punktu od prostokąta (0 w środku). */
function rectDist(x: number, y: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dy = Math.max(y0 - y, 0, y - y1);
  return Math.hypot(dx, dy);
}

/** Podział mapy na działki z cechami (wysokości, nachylenia, las, zabudowa, potoki, drogi) i ceną. */
export function buildParcels(
  grid: ParcelGridInput,
  forest: Float32Array | null,
  built: Float32Array | null,
  publicRoads: PointM[][],
  streams: PointM[][],
  lp: LandParams,
): ParcelGrid {
  const cs = grid.cellSizeM;
  const W = grid.widthCells;
  const H = grid.heightCells;
  const size = lp.parcelSizeM;
  const cols = Math.ceil((W * cs) / size);
  const rows = Math.ceil((H * cs) / size);
  const index = new Int32Array(cols * rows).fill(-1);
  const parcels: Parcel[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x0 = i * size;
      const y0 = j * size;
      const x1 = Math.min(W * cs, x0 + size);
      const y1 = Math.min(H * cs, y0 + size);
      const ci0 = Math.floor(x0 / cs);
      const ci1 = Math.ceil(x1 / cs);
      const cj0 = Math.floor(y0 / cs);
      const cj1 = Math.ceil(y1 / cs);
      let n = 0;
      let f = 0;
      let b = 0;
      let zMin = Infinity;
      let zMax = -Infinity;
      let sx = 0;
      let sy = 0;
      let sSum = 0;
      const slopes: number[] = [];
      for (let cj = cj0; cj < cj1; cj++) {
        for (let ci = ci0; ci < ci1; ci++) {
          const k = cj * W + ci;
          const z = grid.elevationM[k];
          if (!Number.isFinite(z)) continue;
          n++;
          f += forest ? forest[k] : 0;
          b += built ? built[k] : 0;
          zMin = Math.min(zMin, z);
          zMax = Math.max(zMax, z);
          sx += (ci + 0.5) * cs;
          sy += (cj + 0.5) * cs;
          const sl = grid.slopePercent?.[k];
          if (sl !== undefined && Number.isFinite(sl)) {
            sSum += sl;
            slopes.push(sl);
          }
        }
      }
      const areaHa = (n * cs * cs) / 1e4;
      if (areaHa < lp.minAreaHa) continue;
      const forestShare = f / n;
      const builtShare = Math.min(1 - forestShare, b / n);
      slopes.sort((a, c) => a - c);
      let streamM = 0;
      for (const line of streams) {
        for (let q = 1; q < line.length; q++) {
          const mx = (line[q - 1].xM + line[q].xM) / 2;
          const my = (line[q - 1].yM + line[q].yM) / 2;
          if (mx >= x0 && mx < x1 && my >= y0 && my < y1) streamM += Math.hypot(line[q].xM - line[q - 1].xM, line[q].yM - line[q - 1].yM);
        }
      }
      let touchesRoad = false;
      for (const r of publicRoads) {
        for (let q = 1; q < r.length && !touchesRoad; q++) {
          // Odcinek drogi w działce albo blisko jej granicy.
          const a = r[q - 1];
          const c = r[q];
          const L = Math.hypot(c.xM - a.xM, c.yM - a.yM);
          const steps = Math.max(1, Math.ceil(L / 10));
          for (let s = 0; s <= steps; s++) {
            const px = a.xM + ((c.xM - a.xM) * s) / steps;
            const py = a.yM + ((c.yM - a.yM) * s) / steps;
            if (rectDist(px, py, x0, y0, x1, y1) <= lp.roadTouchM) {
              touchesRoad = true;
              break;
            }
          }
        }
        if (touchesRoad) break;
      }
      const meadowHa = areaHa * Math.max(0, 1 - forestShare - builtShare);
      const value = meadowHa * lp.meadowPlnPerHa + areaHa * builtShare * lp.builtPlnPerHa + areaHa * forestShare * lp.forestValuePlnPerHa;
      const leaseOnly = forestShare >= lp.forestLeaseOnlyShare;
      const leasePlnPerYear =
        (meadowHa * lp.meadowPlnPerHa + areaHa * builtShare * lp.builtPlnPerHa) * lp.leaseSharePerYear + areaHa * forestShare * lp.forestValuePlnPerHa * lp.forestLeaseSharePerYear;
      index[j * cols + i] = parcels.length;
      parcels.push({
        id: parcelName(i, j),
        i,
        j,
        x0,
        y0,
        x1,
        y1,
        cx: sx / n,
        cy: sy / n,
        areaHa,
        forestShare,
        builtShare,
        zMinM: zMin,
        zMaxM: zMax,
        meanSlopePercent: slopes.length ? sSum / slopes.length : 0,
        p90SlopePercent: slopes.length ? slopes[Math.min(slopes.length - 1, Math.floor(0.9 * slopes.length))] : 0,
        streamKm: streamM / 1000,
        touchesRoad,
        leaseOnly,
        pricePln: leaseOnly ? null : Math.round(value / 1000) * 1000,
        leasePlnPerYear: Math.round(leasePlnPerYear / 100) * 100,
      });
    }
  }
  return { sizeM: size, cols, rows, parcels, index };
}

/** Działka w punkcie (null – poza mapą albo w skrawku bez działki). */
export function parcelAt(pg: ParcelGrid, xM: number, yM: number): Parcel | null {
  const i = Math.floor(xM / pg.sizeM);
  const j = Math.floor(yM / pg.sizeM);
  if (i < 0 || j < 0 || i >= pg.cols || j >= pg.rows) return null;
  const k = pg.index[j * pg.cols + i];
  return k >= 0 ? pg.parcels[k] : null;
}

export function parcelById(pg: ParcelGrid, id: string): Parcel | null {
  return pg.parcels.find((p) => p.id === id) ?? null;
}

/** Działki pod łamaną (próbki co stepM); poza działkami – „?”. */
export function parcelsAlong(pg: ParcelGrid, pts: PointM[], stepM = 5): Set<string> {
  const out = new Set<string>();
  const add = (x: number, y: number) => out.add(parcelAt(pg, x, y)?.id ?? '?');
  if (pts.length === 1) add(pts[0].xM, pts[0].yM);
  for (let q = 1; q < pts.length; q++) {
    const a = pts[q - 1];
    const b = pts[q];
    const L = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    const n = Math.max(1, Math.ceil(L / stepM));
    for (let s = 0; s <= n; s++) add(a.xM + ((b.xM - a.xM) * s) / n, a.yM + ((b.yM - a.yM) * s) / n);
  }
  return out;
}

export interface ObjectParcels {
  id: string;
  name: string;
  parcels: Set<string>;
}

/** Działki zajęte przez każdy obiekt układu (trasa – cały obrys z analizy, linie – przebieg, budynek – punkt). */
export function objectParcels(layout: ResortLayout, analysis: ResortAnalysis | null, pg: ParcelGrid, cellSizeM: number, widthCells: number): ObjectParcels[] {
  const out: ObjectParcels[] = [];
  for (const l of layout.lifts) out.push({ id: l.id, name: l.name, parcels: parcelsAlong(pg, liftPath(l)) });
  for (const p of layout.pistes) {
    const cells = analysis?.pistes.get(p.id)?.cells;
    const set = cells && cells.length ? new Set<string>() : parcelsAlong(pg, p.points);
    if (cells) for (const k of cells) set.add(parcelAt(pg, ((k % widthCells) + 0.5) * cellSizeM, (Math.floor(k / widthCells) + 0.5) * cellSizeM)?.id ?? '?');
    out.push({ id: p.id, name: `trasa ${p.name}`, parcels: set });
  }
  for (const r of layout.roads ?? []) out.push({ id: r.id, name: r.name, parcels: parcelsAlong(pg, r.points) });
  for (const p of layout.pipelines ?? []) out.push({ id: p.id, name: p.name, parcels: parcelsAlong(pg, p.points) });
  for (const d of layout.ditches ?? []) out.push({ id: d.id, name: d.name, parcels: parcelsAlong(pg, d.points) });
  for (const t of layout.trails ?? []) out.push({ id: t.id, name: t.name, parcels: parcelsAlong(pg, t.points) });
  for (const b of [...layout.bases, ...(layout.buildings ?? [])]) out.push({ id: b.id, name: b.name, parcels: parcelsAlong(pg, [{ xM: b.xM, yM: b.yM }]) });
  return out;
}

// ------------------------------------------------------------------ stan: działki gracza

export interface LandState {
  owned: Record<string, { mode: 'buy' | 'lease'; since: string; pricePln: number; leasePlnPerYear: number }>;
}

/** Działki gracza (null – piaskownica: wszystkie). */
export function ownedParcels(state: GameState | null): Set<string> | null {
  if (!state || state.mode !== 'career') return null;
  return new Set(Object.keys(state.land?.owned ?? {}));
}

/** Brakujące działki obiektów (tylko obiekty z listy `ids`, gdy podana). */
export function missingParcels(objs: ObjectParcels[], owned: Set<string> | null, ids: Set<string> | null = null): { id: string; name: string; missing: string[] }[] {
  if (!owned) return [];
  const out: { id: string; name: string; missing: string[] }[] = [];
  for (const o of objs) {
    if (ids && !ids.has(o.id)) continue;
    const miss = [...o.parcels].filter((p) => !owned.has(p)).sort();
    if (miss.length) out.push({ id: o.id, name: o.name, missing: miss });
  }
  return out;
}

/** Komunikat o brakujących działkach (null – wszystko na swoim). */
export function missingParcelsMessage(miss: { name: string; missing: string[] }[]): string | null {
  if (!miss.length) return null;
  const all = [...new Set(miss.flatMap((m) => m.missing))].sort();
  const outside = all.includes('?');
  const named = all.filter((x) => x !== '?');
  const who = miss.slice(0, 2).map((m) => m.name).join(', ');
  return `${who}${miss.length > 2 ? ' i inne' : ''} wychodzi poza Twoje działki${named.length ? ` – dokup: ${named.join(', ')}` : ''}${outside ? (named.length ? '; część leży poza mapą' : ' – poza mapą') : ''} (widok danych „Działki”).`;
}

/**
 * Zakup albo dzierżawa działki. Zwraca komunikat błędu albo null. `limit` – ile działek wolno mieć
 * (kamienie milowe); `first` – działka startowa (bez sprawdzania drogi i limitu).
 */
export function acquireParcel(state: GameState, parcel: Parcel, mode: 'buy' | 'lease', limit: number): string | null {
  if (state.mode !== 'career') return 'W piaskownicy wszystkie działki są Twoje.';
  const land = (state.land ??= { owned: {} });
  if (land.owned[parcel.id]) return `Działka ${parcel.id} jest już Twoja.`;
  const count = Object.keys(land.owned).length;
  if (count >= limit) return `Limit działek: ${limit}. Następne odblokujesz kolejnym kamieniem milowym.`;
  if (mode === 'buy' && parcel.pricePln === null) return `Działka ${parcel.id} to głównie las (Lasy Państwowe) – tylko dzierżawa.`;
  const price = mode === 'buy' ? parcel.pricePln! : parcel.leasePlnPerYear;
  if (state.balancePln < price) return `Brak pieniędzy: ${mode === 'buy' ? 'zakup' : 'czynsz za pierwszy rok'} kosztuje ${Math.round(price).toLocaleString('pl-PL')} zł.`;
  state.balancePln -= price;
  if (mode === 'buy') state.pending.land = (state.pending.land ?? 0) + price;
  else state.pending.landLease = (state.pending.landLease ?? 0) + price;
  land.owned[parcel.id] = { mode, since: formatIsoDate(state.date), pricePln: parcel.pricePln ?? 0, leasePlnPerYear: parcel.leasePlnPerYear };
  state.log.push({ date: formatIsoDate(state.date), text: `${mode === 'buy' ? 'Zakup' : 'Dzierżawa'} działki ${parcel.id} (${Math.round(price).toLocaleString('pl-PL')} zł${mode === 'lease' ? ' rocznie' : ''})` });
  return null;
}

/** Roczny czynsz dzierżawy wszystkich działek (bez umów zawartych dziś – zapłacone przy podpisaniu). */
export function annualLeasePln(state: GameState): number {
  const today = formatIsoDate(state.date);
  let sum = 0;
  for (const o of Object.values(state.land?.owned ?? {})) if (o.mode === 'lease' && o.since !== today) sum += o.leasePlnPerYear;
  return sum;
}
