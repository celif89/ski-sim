/**
 * Etap 7d: warstwa detalu co 1 m – tylko w korytarzach tras (i tras rowerowych latem).
 *
 * Zapisuje w każdej komórce 1 m: kierunek i czas ostatniego ratrakowania (sztruks), intensywność
 * śladów nart, świeży śnieg na sztruksie, wysokość muld, lód, pryzmy z armatek i przetarcia.
 * Zasilają ją istniejące procesy: ratrak „pisze” sztruks wzdłuż swojej drogi (te same pasy co na
 * mapie), narciarze ślady i muldy (więcej na stromych odcinkach i na zakrętach trasy), armatki
 * pryzmy przesunięte z wiatrem, świeży śnieg i odwilż je zacierają.
 *
 * Bilans masy śniegu liczy siatka 10 m (snow.ts) – tu tylko jego rozkład w przestrzeni:
 * `syncTo10m` ustawia średnie w każdej komórce 10 m (muldy, pryzmy, lód, przetarcia) dokładnie
 * na wartości z siatki 10 m. Parametry w data/detail.json. Bez DOM i PixiJS.
 */
import { readNumber, readSection } from './params';

export interface DetailParams {
  cellM: number;
  corridorRingCells: number;
  trackCoverPerPass: number;
  trackDecayFreshMm: number;
  mogulSpacingM: number;
  mogulMaxHeightM: number;
  mogulTurnBoost: number;
  pileRadiusM: number;
  wornFromThin: number;
  wornThinThreshold: number;
  wornPatchM: number;
  seedSalt: number;
}

const FILE = 'data/detail.json';

export function parseDetailParams(json: unknown): DetailParams {
  const s = readSection(json as Record<string, unknown>, 'layer', FILE);
  const n = (k: string, o: { min?: number; max?: number; integer?: boolean } = { min: 0 }) => readNumber(s, k, FILE, o);
  return {
    cellM: n('cellM', { min: 0.25 }),
    corridorRingCells: n('corridorRingCells', { min: 0, integer: true }),
    trackCoverPerPass: n('trackCoverPerPass'),
    trackDecayFreshMm: n('trackDecayFreshMm', { min: 0.1 }),
    mogulSpacingM: n('mogulSpacingM', { min: 1 }),
    mogulMaxHeightM: n('mogulMaxHeightM'),
    mogulTurnBoost: n('mogulTurnBoost'),
    pileRadiusM: n('pileRadiusM', { min: 1 }),
    wornFromThin: n('wornFromThin', { min: 0, max: 1 }),
    wornThinThreshold: n('wornThinThreshold', { min: 0, max: 0.99 }),
    wornPatchM: n('wornPatchM', { min: 0.5 }),
    seedSalt: n('seedSalt', { integer: true }),
  };
}

/** Siatka terenu potrzebna warstwie (podzbiór TerrainGrid). */
export interface DetailGrid {
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  elevationM: Float32Array;
}

/** Muldy: progi z data/guests.json (te same co w modelu 10 m – skierTraffic.ts). */
export interface MogulRule {
  mogulMinSlopePercent: number;
  passesToMoguls: number;
}

/** Hash 2D → 0–1 (deterministyczny, bez Math.random). */
function hash01(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Gładki szum 2D (wartości w węzłach co 1, interpolacja smoothstep) → 0–1. */
function smoothNoise(x: number, y: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash01(i, j, seed);
  const b = hash01(i + 1, j, seed);
  const c = hash01(i, j + 1, seed);
  const d = hash01(i + 1, j + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * Udział powierzchni z przebijającą trawą / kamieniami (0–1) przy danej „za cienkiej bazie” (0–1):
 * przy bazie trochę za cienkiej śnieg jeszcze kryje podłoże – przetarcia dopiero ponad progiem.
 */
export function wornFraction(thin: number, p: Pick<DetailParams, 'wornFromThin' | 'wornThinThreshold'>): number {
  const t = thin * p.wornFromThin;
  return Math.max(0, Math.min(1, (t - p.wornThinThreshold) / (1 - p.wornThinThreshold)));
}

/** Kąt kierunku (oś bez zwrotu: 0–π) zapisany w bajcie 0–255. */
export function encodeAxial(dx: number, dy: number): number {
  let a = Math.atan2(dy, dx);
  if (a < 0) a += Math.PI;
  if (a >= Math.PI) a -= Math.PI;
  return Math.round((a / Math.PI) * 255) & 255;
}

export function decodeAxial(b: number): number {
  return (b / 255) * Math.PI;
}

/** Najmniejsza różnica kątów osiowych (0–π/2). */
export function axialDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

export class DetailLayer {
  /** Indeks bloku dla komórki 10 m (−1 – poza korytarzem). */
  blockOf: Int32Array;
  /** Komórki 10 m w korytarzu (kolejność bloków). */
  cells: Int32Array = new Int32Array(0);
  /** Komórek 1 m na bok komórki 10 m. */
  readonly sub: number;
  readonly per: number;
  groomDir: Uint8Array = new Uint8Array(0);
  /** Godzina gry (od początku epoki gry) ostatniego ratrakowania; −1e9 – nigdy. */
  groomT: Float32Array = new Float32Array(0);
  tracks: Uint8Array = new Uint8Array(0);
  /** Świeży śnieg na sztruksie i śladach 0–255. */
  fresh: Uint8Array = new Uint8Array(0);
  /** Wysokość muld [m] w komórce 1 m. */
  mogul: Float32Array = new Float32Array(0);
  ice: Uint8Array = new Uint8Array(0);
  /** Pryzmy z armatek [mm wody]. */
  pile: Float32Array = new Float32Array(0);
  /** Przetarcia (trawa, kamienie) 0–255. */
  worn: Uint8Array = new Uint8Array(0);
  /** Komórki 10 m samych tras (bez pierścienia) – tylko tam przetarcia (tam się jeździ i ubija). */
  core: Set<number> = new Set();
  /** Udział powierzchni trasy w komórce 1 m (0–255) – z osi i szerokości; brzeg przetarć łagodny. */
  onPiste: Uint8Array = new Uint8Array(0);
  /** Stan powierzchni z siatki 10 m (kod SNOW_QUALITY_CODES) na blok. */
  surface: Uint8Array = new Uint8Array(0);
  /** Rozwinięcie muld w bloku 0–1 (jak SnowState.moguls). */
  mogulIndex: Float32Array = new Float32Array(0);
  /** Kierunek spadku stoku (jednostkowy) w komórkach 10 m. */
  private readonly fallX: Float32Array;
  private readonly fallY: Float32Array;
  /** Nachylenie [%] w komórkach 10 m. */
  readonly slopePercent: Float32Array;
  /** Wersja danych (rośnie przy każdej zmianie) – rysowanie odświeża okno tekstury. */
  version = 0;

  constructor(
    readonly grid: DetailGrid,
    readonly p: DetailParams,
    readonly seed: number,
  ) {
    this.sub = Math.max(1, Math.round(grid.cellSizeM / p.cellM));
    this.per = this.sub * this.sub;
    const n = grid.widthCells * grid.heightCells;
    this.blockOf = new Int32Array(n).fill(-1);
    this.fallX = new Float32Array(n);
    this.fallY = new Float32Array(n);
    this.slopePercent = new Float32Array(n);
    const W = grid.widthCells;
    const H = grid.heightCells;
    const z = grid.elevationM;
    const cs = grid.cellSizeM;
    const at = (i: number, j: number, f: number) => {
      const v = z[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
      return Number.isNaN(v) ? f : v;
    };
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const h = z[k];
        if (Number.isNaN(h)) continue;
        const gx = (at(i + 1, j, h) - at(i - 1, j, h)) / (2 * cs);
        const gy = (at(i, j + 1, h) - at(i, j - 1, h)) / (2 * cs);
        const g = Math.hypot(gx, gy);
        this.slopePercent[k] = 100 * g;
        // Spadek: przeciwnie do gradientu wysokości.
        this.fallX[k] = g > 1e-6 ? -gx / g : 0;
        this.fallY[k] = g > 1e-6 ? -gy / g : 1;
      }
    }
  }

  get blockCount(): number {
    return this.cells.length;
  }

  /**
   * Nowe korytarze (komórki 10 m tras) – dokładane pierścienie sąsiadów; dane bloków, które zostają,
   * są przenoszone, nowe bloki – świeże (bez sztruksu, śladów, muld).
   */
  setCorridors(cells: Iterable<number>, shapes?: { xM: number; yM: number; widthM: number }[][]): void {
    const W = this.grid.widthCells;
    const H = this.grid.heightCells;
    const set = new Set<number>();
    const ring = this.p.corridorRingCells;
    this.core = new Set(cells);
    for (const k of this.core) {
      const i0 = k % W;
      const j0 = Math.floor(k / W);
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= W || j >= H) continue;
          const kk = j * W + i;
          if (!Number.isNaN(this.grid.elevationM[kk])) set.add(kk);
        }
      }
    }
    const list = Int32Array.from([...set].sort((a, b) => a - b));
    const per = this.per;
    const nb = list.length;
    const old = { blockOf: this.blockOf, groomDir: this.groomDir, groomT: this.groomT, tracks: this.tracks, fresh: this.fresh, mogul: this.mogul, ice: this.ice, pile: this.pile, worn: this.worn, surface: this.surface, mogulIndex: this.mogulIndex };
    this.blockOf = new Int32Array(this.blockOf.length).fill(-1);
    this.groomDir = new Uint8Array(nb * per);
    this.groomT = new Float32Array(nb * per).fill(-1e9);
    this.tracks = new Uint8Array(nb * per);
    this.fresh = new Uint8Array(nb * per);
    this.mogul = new Float32Array(nb * per);
    this.ice = new Uint8Array(nb * per);
    this.pile = new Float32Array(nb * per);
    this.worn = new Uint8Array(nb * per);
    this.surface = new Uint8Array(nb).fill(3);
    this.mogulIndex = new Float32Array(nb);
    list.forEach((k, b) => {
      this.blockOf[k] = b;
      const ob = old.blockOf[k];
      if (ob < 0) return;
      const o = ob * per;
      const d = b * per;
      this.groomDir.set(old.groomDir.subarray(o, o + per), d);
      this.groomT.set(old.groomT.subarray(o, o + per), d);
      this.tracks.set(old.tracks.subarray(o, o + per), d);
      this.fresh.set(old.fresh.subarray(o, o + per), d);
      this.mogul.set(old.mogul.subarray(o, o + per), d);
      this.ice.set(old.ice.subarray(o, o + per), d);
      this.pile.set(old.pile.subarray(o, o + per), d);
      this.worn.set(old.worn.subarray(o, o + per), d);
      this.surface[b] = old.surface[ob];
      this.mogulIndex[b] = old.mogulIndex[ob];
    });
    this.cells = list;
    this.onPiste = new Uint8Array(nb * per);
    if (shapes && shapes.length) this.rasterPistes(shapes);
    else for (const k of this.core) { const b = this.blockOf[k]; if (b >= 0) this.onPiste.fill(255, b * per, (b + 1) * per); }
    this.version++;
  }

  /** Obrys tras na siatce 1 m: odległość od osi wobec połowy szerokości, brzeg łagodny (±1,5 m). */
  private rasterPistes(shapes: { xM: number; yM: number; widthM: number }[][]): void {
    const cm = this.p.cellM;
    const edge = 1.5;
    for (const ax of shapes) {
      for (let s = 1; s < ax.length; s++) {
        const a = ax[s - 1];
        const b = ax[s];
        if (![a.xM, a.yM, b.xM, b.yM].every(Number.isFinite)) continue;
        const r = Math.max(a.widthM, b.widthM) / 2 + edge;
        const x0 = Math.floor((Math.min(a.xM, b.xM) - r) / cm);
        const x1 = Math.ceil((Math.max(a.xM, b.xM) + r) / cm);
        const y0 = Math.floor((Math.min(a.yM, b.yM) - r) / cm);
        const y1 = Math.ceil((Math.max(a.yM, b.yM) + r) / cm);
        const dx = b.xM - a.xM;
        const dy = b.yM - a.yM;
        const L2 = dx * dx + dy * dy || 1;
        for (let yi = y0; yi <= y1; yi++) {
          for (let xi = x0; xi <= x1; xi++) {
            const x = (xi + 0.5) * cm;
            const y = (yi + 0.5) * cm;
            const idx = this.indexAt(x, y);
            if (idx < 0) continue;
            const t = Math.max(0, Math.min(1, ((x - a.xM) * dx + (y - a.yM) * dy) / L2));
            const d = Math.hypot(x - a.xM - t * dx, y - a.yM - t * dy);
            const half = (a.widthM + t * (b.widthM - a.widthM)) / 2;
            const u = Math.max(0, Math.min(1, (half + edge - d) / (2 * edge)));
            const w = Math.round(255 * u * u * (3 - 2 * u));
            if (w > this.onPiste[idx]) this.onPiste[idx] = w;
          }
        }
      }
    }
  }

  /** Indeks komórki 1 m w punkcie (−1 – poza korytarzem). */
  indexAt(xM: number, yM: number): number {
    const cs = this.grid.cellSizeM;
    const i = Math.floor(xM / cs);
    const j = Math.floor(yM / cs);
    if (i < 0 || j < 0 || i >= this.grid.widthCells || j >= this.grid.heightCells) return -1;
    const b = this.blockOf[j * this.grid.widthCells + i];
    if (b < 0) return -1;
    const u = Math.min(this.sub - 1, Math.floor((xM - i * cs) / this.p.cellM));
    const v = Math.min(this.sub - 1, Math.floor((yM - j * cs) / this.p.cellM));
    return b * this.per + v * this.sub + u;
  }

  /** Środek komórki 1 m o indeksie idx (w metrach mapy). */
  centerOf(idx: number): { xM: number; yM: number } {
    const b = Math.floor(idx / this.per);
    const r = idx - b * this.per;
    const k = this.cells[b];
    const W = this.grid.widthCells;
    const cs = this.grid.cellSizeM;
    return { xM: (k % W) * cs + ((r % this.sub) + 0.5) * this.p.cellM, yM: Math.floor(k / W) * cs + (Math.floor(r / this.sub) + 0.5) * this.p.cellM };
  }

  /** Średnia pola w bloku komórki 10 m k (NaN – poza korytarzem). */
  blockMean(field: ArrayLike<number>, k: number): number {
    const b = this.blockOf[k];
    if (b < 0) return NaN;
    let s = 0;
    for (let i = b * this.per; i < (b + 1) * this.per; i++) s += field[i];
    return s / this.per;
  }

  /** Komórki 1 m w pasie o szerokości widthM wzdłuż odcinka a–b (z miarą pokrycia 0–1). */
  private forStrip(ax: number, ay: number, bx: number, by: number, widthM: number, f: (idx: number, cover: number) => void): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len;
    const uy = dy / len;
    const half = widthM / 2;
    const c = this.p.cellM;
    const x0 = Math.floor((Math.min(ax, bx) - half) / c);
    const x1 = Math.floor((Math.max(ax, bx) + half) / c);
    const y0 = Math.floor((Math.min(ay, by) - half) / c);
    const y1 = Math.floor((Math.max(ay, by) + half) / c);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const px = (gx + 0.5) * c - ax;
        const py = (gy + 0.5) * c - ay;
        const along = px * ux + py * uy;
        if (along < -c * 0.5 || along > len + c * 0.5) continue;
        const across = Math.abs(-px * uy + py * ux);
        const cover = Math.min(1, Math.max(0, (half - across) / c + 0.5));
        if (cover <= 0) continue;
        const idx = this.indexAt((gx + 0.5) * c, (gy + 0.5) * c);
        if (idx >= 0) f(idx, cover);
      }
    }
  }

  /**
   * Ratrak na odcinku a–b (szerokość frezu widthM) w godzinie gry timeH: nowy sztruks w kierunku
   * przejazdu, ślady i świeży śnieg zatarte, muldy zrównane (pryzmy rozepchnięte – masa w siatce 10 m).
   */
  groomSegment(ax: number, ay: number, bx: number, by: number, widthM: number, timeH: number): void {
    const dir = encodeAxial(bx - ax, by - ay);
    this.forStrip(ax, ay, bx, by, widthM, (idx, cover) => {
      if (cover < 0.5) return;
      this.groomDir[idx] = dir;
      this.groomT[idx] = timeH;
      this.tracks[idx] = 0;
      this.fresh[idx] = 0;
      this.mogul[idx] = 0;
      this.pile[idx] = 0;
    });
    this.version++;
  }

  /** Ślad nart jednego narciarza na odcinku a–b (wąski pas – ok. szerokości nart). */
  skiSegment(ax: number, ay: number, bx: number, by: number, strength = 0.12): void {
    this.forStrip(ax, ay, bx, by, 0.8, (idx, cover) => {
      const t = this.tracks[idx];
      this.tracks[idx] = Math.min(255, t + Math.round((255 - t) * strength * cover));
      if (this.fresh[idx] > 0) this.fresh[idx] = Math.max(0, this.fresh[idx] - Math.round(80 * cover));
    });
    this.version++;
  }

  /**
   * Przejazdy jednego dnia (passes – na komórkę 10 m, jak w skierTraffic.ts): ślady zacierają sztruks,
   * muldy rosną na stromych odcinkach (szybciej na zakrętach trasy – turn 0–1 na komórkę 10 m).
   */
  applyPasses(passes: ArrayLike<number>, rule: MogulRule, turn: ArrayLike<number> | null): void {
    const p = this.p;
    for (let b = 0; b < this.cells.length; b++) {
      const k = this.cells[b];
      const n = passes[k];
      if (!(n > 0)) continue;
      const cover = 1 - Math.exp(-n * p.trackCoverPerPass);
      const base = b * this.per;
      for (let r = 0; r < this.per; r++) {
        const idx = base + r;
        // Nierówno w komórce: niektóre miejsca jeżdżone częściej (ziarno).
        const w = 0.6 + 0.8 * hash01(k * 131 + r, b, this.seed + p.seedSalt);
        const c = Math.min(1, cover * w);
        const t = this.tracks[idx];
        this.tracks[idx] = Math.max(t, Math.round(255 * c));
        this.fresh[idx] = Math.round(this.fresh[idx] * (1 - c));
      }
      const slope = this.slopePercent[k];
      if (slope > rule.mogulMinSlopePercent && !this.ice[base]) {
        const steep = Math.min(1, (slope - rule.mogulMinSlopePercent) / rule.mogulMinSlopePercent);
        const boost = 1 + p.mogulTurnBoost * Math.max(0, Math.min(1, turn ? turn[k] : 0));
        this.mogulIndex[b] = Math.min(1, this.mogulIndex[b] + (n / Math.max(1, rule.passesToMoguls)) * steep * boost);
        this.shapeMoguls(b);
      }
    }
    this.version++;
  }

  /**
   * Kształt muld w bloku: garby na przemian (pole cos · cos w układzie mapy, odstęp mogulSpacingM);
   * ten sam wzór rysuje shader (detailRenderer). Średnia wysokość w bloku = indeks · maks. wysokość / 2.
   * (Wzór wzdłuż linii spadku liczony z dalekich współrzędnych dawał w shaderze prążki fazy.)
   */
  private shapeMoguls(b: number): void {
    const k = this.cells[b];
    const W = this.grid.widthCells;
    const cs = this.grid.cellSizeM;
    const i = k % W;
    const j = Math.floor(k / W);
    const lam = this.p.mogulSpacingM;
    const target = this.mogulIndex[b] * this.p.mogulMaxHeightM * 0.5;
    const base = b * this.per;
    if (target <= 0) {
      this.mogul.fill(0, base, base + this.per);
      return;
    }
    let sum = 0;
    for (let r = 0; r < this.per; r++) {
      const x = i * cs + ((r % this.sub) + 0.5) * this.p.cellM;
      const y = j * cs + (Math.floor(r / this.sub) + 0.5) * this.p.cellM;
      const h = 0.5 + 0.5 * Math.cos((2 * Math.PI * x) / lam) * Math.cos((2 * Math.PI * y) / lam);
      this.mogul[base + r] = h;
      sum += h;
    }
    const scale = sum > 1e-6 ? (target * this.per) / sum : 0;
    if (scale === 0) {
      this.mogul.fill(target, base, base + this.per);
      return;
    }
    for (let r = 0; r < this.per; r++) this.mogul[base + r] *= scale;
  }

  /** Pryzma pod armatką: stożek o promieniu pileRadiusM wokół punktu (x, y), w środku sweMm. */
  addPile(xM: number, yM: number, sweMm: number): void {
    const R = this.p.pileRadiusM;
    const c = this.p.cellM;
    for (let gy = Math.floor((yM - R) / c); gy <= Math.floor((yM + R) / c); gy++) {
      for (let gx = Math.floor((xM - R) / c); gx <= Math.floor((xM + R) / c); gx++) {
        const px = (gx + 0.5) * c;
        const py = (gy + 0.5) * c;
        const r2 = ((px - xM) ** 2 + (py - yM) ** 2) / (R * R);
        if (r2 >= 1) continue;
        const idx = this.indexAt(px, py);
        if (idx >= 0) this.pile[idx] += sweMm * (1 - r2);
      }
    }
    this.version++;
  }

  /** Doba (albo godzina) pogody: świeży śnieg zasypuje sztruks i ślady. */
  weather(freshSnowMm: number): void {
    if (!(freshSnowMm > 0)) return;
    const keep = Math.exp(-freshSnowMm / this.p.trackDecayFreshMm);
    for (let i = 0; i < this.tracks.length; i++) {
      this.tracks[i] = Math.round(this.tracks[i] * keep);
      this.fresh[i] = 255 - Math.round((255 - this.fresh[i]) * keep);
    }
    this.version++;
  }

  /**
   * Uzgodnienie z siatką 10 m (po każdym kroku modelu śniegu): średnia wysokość muld = indeks ·
   * maks./2, średnia pryzm = pryzmy 10 m, lód i przetarcia ze stanu powierzchni i za cienkiej bazy.
   */
  syncTo10m(moguls10: ArrayLike<number>, pile10: ArrayLike<number>, quality10: ArrayLike<number>, thin10: ArrayLike<number> | null): void {
    const per = this.per;
    const W = this.grid.widthCells;
    const H = this.grid.heightCells;
    const cs = this.grid.cellSizeM;
    const cm = this.p.cellM;
    const sub = this.sub;
    const patch = this.p.wornPatchM;
    const wornAt = (k: number) => (quality10[k] === 7 ? 1 : wornFraction(thin10 ? thin10[k] : 0, this.p));
    const cellOr = (i: number, j: number, own: number) => (i < 0 || j < 0 || i >= W || j >= H ? own : j * W + i);
    for (let b = 0; b < this.cells.length; b++) {
      const k = this.cells[b];
      const base = b * per;
      this.surface[b] = quality10[k];
      // Muldy.
      const m = Math.max(0, Math.min(1, moguls10[k]));
      this.mogulIndex[b] = m;
      this.shapeMoguls(b);
      // Pryzmy: kształt z armatek, średnia z siatki 10 m.
      const target = Math.max(0, pile10[k]);
      let sum = 0;
      for (let r = 0; r < per; r++) sum += this.pile[base + r];
      if (target <= 0) this.pile.fill(0, base, base + per);
      else if (sum > 1e-9) {
        const s = (target * per) / sum;
        for (let r = 0; r < per; r++) this.pile[base + r] *= s;
      } else {
        // Pryzmy bez kształtu (dzień przewinięty) – rozłożone nierówno, średnia jak w siatce 10 m.
        let w = 0;
        for (let r = 0; r < per; r++) {
          const v = 0.3 + hash01(k, r, this.seed + 17);
          this.pile[base + r] = v;
          w += v;
        }
        for (let r = 0; r < per; r++) this.pile[base + r] *= (target * per) / w;
      }
      // Lód: stan „zlodzony” w komórce 10 m.
      this.ice.fill(quality10[k] === 6 ? 255 : 0, base, base + per);
      // Przetarcia (tylko na trasie; pierścień – 0): stan „przetarty” albo za cienka baza – plamy (gładki szum, wartość płynnie
      // przechodząca między sąsiednimi komórkami 10 m – bez kwadratów), średnia jak w siatce 10 m.
      // Przetarcia tylko na powierzchni trasy (obrys z osi i szerokości): średnia = udział × trasa.
      let share = 0;
      for (let r = 0; r < per; r++) share += this.onPiste[base + r];
      share /= 255 * per;
      const wornTarget = wornAt(k) * share;
      if (wornTarget <= 0) this.worn.fill(0, base, base + per);
      else {
        const i0 = k % W;
        const j0 = Math.floor(k / W);
        const tmp = new Float32Array(per);
        for (let r = 0; r < per; r++) {
          const xM = i0 * cs + ((r % sub) + 0.5) * cm;
          const yM = j0 * cs + (Math.floor(r / sub) + 0.5) * cm;
          // Wartość docelowa interpolowana dwuliniowo ze środków komórek 10 m.
          const gx = xM / cs - 0.5;
          const gy = yM / cs - 0.5;
          const ia = Math.floor(gx);
          const ja = Math.floor(gy);
          const tx = gx - ia;
          const ty = gy - ja;
          const v00 = wornAt(cellOr(ia, ja, k));
          const v10 = wornAt(cellOr(ia + 1, ja, k));
          const v01 = wornAt(cellOr(ia, ja + 1, k));
          const v11 = wornAt(cellOr(ia + 1, ja + 1, k));
          const t = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
          // Najpierw wychodzą wypukłości (szum) i miejsca najczęściej jeżdżone.
          const nz = 0.65 * smoothNoise(xM / patch, yM / patch, this.seed + 29) + 0.35 * smoothNoise(xM / (patch * 0.4), yM / (patch * 0.4), this.seed + 31);
          tmp[r] = Math.max(0, Math.min(1, (t + (nz - 0.5) * 1.2 + 0.15 * (this.tracks[base + r] / 255) - 0.5) * 3 + 0.5));
        }
        // Średnia jak w komórce 10 m: przesunięcie progu c (bisekcja) – średnia z clamp(v + c) rośnie z c.
        let lo = -2;
        let hi = 2;
        const meanAt = (c: number) => {
          let sum = 0;
          for (let r = 0; r < per; r++) sum += Math.max(0, Math.min(1, tmp[r] + c)) * (this.onPiste[base + r] / 255);
          return sum / per;
        };
        for (let it = 0; it < 30; it++) {
          const mid = (lo + hi) / 2;
          if (meanAt(mid) < wornTarget) lo = mid;
          else hi = mid;
        }
        const shift = (lo + hi) / 2;
        for (let r = 0; r < per; r++) tmp[r] = Math.max(0, Math.min(1, tmp[r] + shift)) * (this.onPiste[base + r] / 255);
        for (let r = 0; r < per; r++) this.worn[base + r] = Math.round(255 * tmp[r]);
      }
    }
    this.version++;
  }
}

/** Ratrak na trasie: położenie w ułamku f (0–1) zadania – przejazdy pasami w górę i w dół na zmianę. */
export function groomerOnAxis(axis: { xM: number; yM: number; distanceM: number; widthM: number }[], groomerWidthM: number, f: number): { xM: number; yM: number; headingRad: number; lane: number } {
  const len = axis[axis.length - 1].distanceM;
  const meanW = axis.reduce((a, x) => a + x.widthM, 0) / axis.length;
  const passes = Math.max(1, Math.round(meanW / groomerWidthM));
  const total = Math.max(0, Math.min(1, f)) * passes;
  const lane = Math.min(passes - 1, Math.floor(total));
  const along = total - lane;
  const d = lane % 2 === 0 ? along * len : (1 - along) * len;
  let i = 1;
  while (i < axis.length - 1 && axis[i].distanceM < d) i++;
  const a = axis[i - 1];
  const b = axis[i];
  const L = Math.max(1e-6, b.distanceM - a.distanceM);
  const t = Math.max(0, Math.min(1, (d - a.distanceM) / L));
  const dx = b.xM - a.xM;
  const dy = b.yM - a.yM;
  const n = Math.hypot(dx, dy) || 1;
  const off = (lane - (passes - 1) / 2) * groomerWidthM;
  const sgn = lane % 2 === 0 ? 1 : -1;
  return { xM: a.xM + dx * t - (dy / n) * off, yM: a.yM + dy * t + (dx / n) * off, headingRad: Math.atan2((dy / n) * sgn, (dx / n) * sgn), lane };
}

/** Całe zadanie ratraka (noc przewinięta): sztruks na całej trasie, czasy rosnące od startH do endH. */
export function groomWholeJob(layer: DetailLayer, axis: { xM: number; yM: number; distanceM: number; widthM: number }[], groomerWidthM: number, startH: number, endH: number): void {
  if (axis.length < 2) return;
  const len = axis[axis.length - 1].distanceM;
  const meanW = axis.reduce((a, x) => a + x.widthM, 0) / axis.length;
  const passes = Math.max(1, Math.round(meanW / groomerWidthM));
  const steps = Math.max(2, Math.ceil((passes * len) / 4));
  let prev = groomerOnAxis(axis, groomerWidthM, 0);
  for (let s = 1; s <= steps; s++) {
    const f = s / steps;
    const q = groomerOnAxis(axis, groomerWidthM, f);
    if (q.lane === prev.lane) layer.groomSegment(prev.xM, prev.yM, q.xM, q.yM, groomerWidthM, startH + (endH - startH) * f);
    prev = q;
  }
}

/** Zakręty tras (0–1 na komórkę 10 m): zmiana kierunku osi na ok. 30 m (45° → 1). */
export function turnField(cellCount: number, gridW: number, cellSizeM: number, axes: { xM: number; yM: number; distanceM: number }[][], cellsOf: number[][]): Float32Array {
  const out = new Float32Array(cellCount);
  axes.forEach((axis, pi) => {
    if (axis.length < 3) return;
    const turnAt = (q: number) => {
      const a = axis[Math.max(0, q - 3)];
      const m = axis[q];
      const b = axis[Math.min(axis.length - 1, q + 3)];
      const h1 = Math.atan2(m.yM - a.yM, m.xM - a.xM);
      const h2 = Math.atan2(b.yM - m.yM, b.xM - m.xM);
      let d = Math.abs(h2 - h1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      return Math.min(1, d / (Math.PI / 4));
    };
    for (const k of cellsOf[pi]) {
      const x = ((k % gridW) + 0.5) * cellSizeM;
      const y = (Math.floor(k / gridW) + 0.5) * cellSizeM;
      let best = 0;
      let bd = Infinity;
      axis.forEach((q, i) => {
        const d = (q.xM - x) ** 2 + (q.yM - y) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      out[k] = Math.max(out[k], turnAt(best));
    }
  });
  return out;
}
