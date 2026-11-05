/**
 * Scena demonstracyjna – tylko do oceny wyglądu (bez logiki gości): kilkudziesięciu narciarzy
 * zjeżdża po trasach slalomem po prostych torach, jeden ratrak jeździ w górę i w dół trasy pasami
 * i zostawia sztruks; narciarze zostawiają ślady na puchu. Trasy: zbudowane w grze, a gdy ich nie
 * ma – prawdziwe trasy Pilska z OpenStreetMap.
 *
 * Losowość (kolory, prędkości, rozstawienie) z generatora z ziarnem – ten sam seed, ta sama scena.
 */
import { Rng } from '../sim/rng';
import type { MoverState } from './movers';
import type { TrackBuffer } from './terrainRenderer';

export interface DemoPath {
  /** Oś trasy od góry do dołu (lokalne metry) z szerokością. */
  points: { xM: number; yM: number; widthM: number }[];
}

interface Walker {
  path: number;
  s: number;
  speed: number;
  phaseOffset: number;
  turnM: number;
  ampFrac: number;
  variant: number;
  lastX: number;
  lastY: number;
}

interface PathGeom {
  cum: number[];
  length: number;
  points: { xM: number; yM: number; widthM: number }[];
}

function geom(p: DemoPath): PathGeom {
  const cum = [0];
  for (let i = 1; i < p.points.length; i++) cum.push(cum[i - 1] + Math.hypot(p.points[i].xM - p.points[i - 1].xM, p.points[i].yM - p.points[i - 1].yM));
  return { cum, length: cum[cum.length - 1], points: p.points };
}

/** Punkt osi w odległości s: położenie, kierunek, szerokość. */
function along(g: PathGeom, s: number): { x: number; y: number; dx: number; dy: number; w: number } {
  const d = Math.min(Math.max(s, 0), g.length);
  let i = 0;
  while (i < g.cum.length - 2 && g.cum[i + 1] < d) i++;
  const a = g.points[i];
  const b = g.points[i + 1];
  const len = g.cum[i + 1] - g.cum[i] || 1;
  const t = (d - g.cum[i]) / len;
  return { x: a.xM + t * (b.xM - a.xM), y: a.yM + t * (b.yM - a.yM), dx: (b.xM - a.xM) / len, dy: (b.yM - a.yM) / len, w: a.widthM + t * (b.widthM - a.widthM) };
}

export class DemoScene {
  private paths: PathGeom[] = [];
  private walkers: Walker[] = [];
  private groomer = { path: 0, s: 0, dir: 1, lane: 0, lastX: 0, lastY: 0 };
  private readonly out: MoverState[] = [];

  constructor(
    private readonly seed: number,
    private readonly groom: TrackBuffer,
    private readonly ski: TrackBuffer,
    /** Szerokość pasa ratraka [m] (map-style.json: surface.groomerWidthM). */
    private readonly laneWidthM: number,
  ) {}

  /** Trasy i liczba narciarzy (rozstawienie od nowa). */
  setup(paths: DemoPath[], skiers: number): void {
    this.paths = paths.filter((p) => p.points.length >= 2).map(geom).filter((g) => g.length > 50);
    const rng = new Rng(this.seed).fork('scena-demo');
    this.walkers = [];
    this.out.length = 0;
    if (this.paths.length === 0) return;
    const totalLen = this.paths.reduce((s, g) => s + g.length, 0);
    for (let i = 0; i < skiers; i++) {
      // Trasa losowana proporcjonalnie do długości (gęstość narciarzy podobna na każdej).
      let r = rng.next() * totalLen;
      let path = 0;
      while (path < this.paths.length - 1 && r > this.paths[path].length) r -= this.paths[path++].length;
      this.walkers.push({
        path,
        s: rng.next() * this.paths[path].length,
        speed: rng.range(5, 13),
        phaseOffset: rng.next() * Math.PI * 2,
        turnM: rng.range(14, 30),
        ampFrac: rng.range(0.15, 0.38),
        variant: rng.int(0, 8),
        lastX: Number.NaN,
        lastY: Number.NaN,
      });
    }
    const longest = this.paths.reduce((best, g, i) => (g.length > this.paths[best].length ? i : best), 0);
    this.groomer = { path: longest, s: 0, dir: 1, lane: 0, lastX: Number.NaN, lastY: Number.NaN };
  }

  get count(): number {
    return this.walkers.length + (this.paths.length ? 1 : 0);
  }

  /** Krok sceny (czas rzeczywisty) – zwraca obiekty do narysowania. */
  step(dtS: number, night: number): MoverState[] {
    const out = this.out;
    out.length = 0;
    if (this.paths.length === 0) return out;
    const dt = Math.min(dtS, 0.1);
    for (const w of this.walkers) {
      const g = this.paths[w.path];
      w.s += w.speed * dt;
      if (w.s >= g.length) {
        w.s -= g.length;
        w.lastX = Number.NaN;
      }
      const a = along(g, w.s);
      // Slalom: przesunięcie w poprzek osi (sinus), kierunek z pochodnej.
      const ph = (w.s / w.turnM) * Math.PI * 2 + w.phaseOffset;
      const amp = a.w * w.ampFrac;
      const lat = Math.sin(ph) * amp;
      const dLat = (Math.cos(ph) * amp * Math.PI * 2) / w.turnM;
      const nx = -a.dy;
      const ny = a.dx;
      const x = a.x + nx * lat;
      const y = a.y + ny * lat;
      const hx = a.dx + nx * dLat;
      const hy = a.dy + ny * dLat;
      if (!Number.isNaN(w.lastX)) this.ski.stamp(w.lastX, w.lastY, x, y, 0.6, 0.12);
      w.lastX = x;
      w.lastY = y;
      out.push({ kind: 'skier', xM: x, yM: y, headingRad: Math.atan2(hy, hx), variant: w.variant, phase: 0.5 + 0.5 * Math.cos(ph) });
    }
    // Ratrak: pasami w górę i w dół trasy, 2,5 m/s, zostawia sztruks.
    const gm = this.groomer;
    const g = this.paths[gm.path];
    gm.s += gm.dir * 2.5 * dt;
    const a0 = along(g, gm.s);
    const laneW = this.laneWidthM;
    const lanes = Math.max(1, Math.floor(a0.w / laneW));
    if (gm.s >= g.length || gm.s <= 0) {
      gm.dir *= -1;
      gm.s = Math.min(Math.max(gm.s, 0), g.length);
      gm.lane = (gm.lane + 1) % lanes;
      gm.lastX = Number.NaN;
    }
    const a = along(g, gm.s);
    const off = -a.w / 2 + laneW / 2 + (gm.lane % lanes) * laneW;
    const x = a.x - a.dy * off;
    const y = a.y + a.dx * off;
    if (!Number.isNaN(gm.lastX)) this.groom.stamp(gm.lastX, gm.lastY, x, y, laneW, 1);
    gm.lastX = x;
    gm.lastY = y;
    out.push({ kind: 'groomer', xM: x, yM: y, headingRad: Math.atan2(a.dy * gm.dir, a.dx * gm.dir), variant: 0, phase: 0, lightsOn: night > 0.3 });
    return out;
  }
}
