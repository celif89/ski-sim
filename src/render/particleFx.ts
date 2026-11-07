/**
 * Etap 7d: cząsteczki z bliska – chmura śniegu armatki (z dyszy w stronę trasy, znoszona wiatrem
 * z modelu pogody) i pył spod nart w puchu. Bez stanu: położenie każdej cząstki liczone z czasu
 * (stała liczba cząstek, tanio co klatkę). Pokazywane tylko przy dużym przybliżeniu.
 */
import { Particle, ParticleContainer, Texture } from 'pixi.js';
import { readNumber, readSection } from '../sim/params';
import type { Camera } from './camera';

export interface ParticleParams {
  powderPerSkier: number;
  plumeParticles: number;
  plumeLengthPerWindM: number;
}

export function parseParticleParams(json: unknown): ParticleParams {
  const s = readSection(json as Record<string, unknown>, 'particles', 'data/detail.json');
  return {
    powderPerSkier: readNumber(s, 'powderPerSkier', 'data/detail.json', { min: 0 }),
    plumeParticles: readNumber(s, 'plumeParticles', 'data/detail.json', { min: 0, integer: true }),
    plumeLengthPerWindM: readNumber(s, 'plumeLengthPerWindM', 'data/detail.json', { min: 0 }),
  };
}

export interface PlumeSource {
  xM: number;
  yM: number;
  aimXM: number;
  aimYM: number;
  rateM3h: number;
  windFromDeg: number;
  windMs: number;
}

export interface PowderSource {
  xM: number;
  yM: number;
  vx: number;
  vy: number;
  seed: number;
}

const h01 = (n: number) => {
  let x = Math.imul(n | 0, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  return (x >>> 0) / 4294967296;
};

function softDot(): Texture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return Texture.from(c);
}

export class ParticleFx {
  readonly container: ParticleContainer;
  private readonly tex = softDot();
  static readonly SHOW_MPP = 1.2;
  count = 0;

  constructor(private readonly p: ParticleParams) {
    this.container = new ParticleContainer({ dynamicProperties: { position: true, vertex: true, color: true } });
  }

  update(camera: Camera, timeS: number, plumes: PlumeSource[], powder: PowderSource[]): void {
    const mpp = camera.metersPerPixel;
    const show = mpp <= ParticleFx.SHOW_MPP;
    this.container.visible = show;
    if (!show) {
      this.count = 0;
      return;
    }
    const list: { x: number; y: number; r: number; a: number }[] = [];
    const n = this.p.plumeParticles;
    for (let gi = 0; gi < plumes.length; gi++) {
      const pl = plumes[gi];
      const ax = pl.aimXM - pl.xM;
      const ay = pl.aimYM - pl.yM;
      const al = Math.hypot(ax, ay) || 1;
      const throwM = Math.min(40, Math.max(15, al));
      // Wiatr „z kierunku” → znoszenie w przeciwną stronę (północ = −y na mapie).
      const az = ((pl.windFromDeg + 180) * Math.PI) / 180;
      const wx = Math.sin(az) * pl.windMs * this.p.plumeLengthPerWindM;
      const wy = -Math.cos(az) * pl.windMs * this.p.plumeLengthPerWindM;
      const strength = Math.min(1, pl.rateM3h / 60);
      for (let i = 0; i < n; i++) {
        const f = (timeS * 0.35 + h01(gi * 977 + i)) % 1;
        const j1 = h01(i * 31 + gi) - 0.5;
        const j2 = h01(i * 17 + gi * 7) - 0.5;
        const x = pl.xM + (ax / al) * throwM * f + wx * f * f + j1 * (1 + 6 * f);
        const y = pl.yM + (ay / al) * throwM * f + wy * f * f + j2 * (1 + 6 * f);
        list.push({ x, y, r: 0.5 + 3.5 * f, a: (0.85 - 0.75 * f) * (0.4 + 0.6 * strength) });
      }
    }
    for (const s of powder) {
      const v = Math.hypot(s.vx, s.vy);
      if (v < 2) continue;
      const k = Math.max(1, Math.round(this.p.powderPerSkier));
      for (let i = 0; i < k; i++) {
        const f = (timeS * 1.4 + h01(s.seed * 13 + i)) % 1;
        const back = 0.4 + 1.6 * f;
        const side = (h01(s.seed + i * 5) - 0.5) * 1.2;
        list.push({ x: s.xM - (s.vx / v) * back - (s.vy / v) * side, y: s.yM - (s.vy / v) * back + (s.vx / v) * side, r: 0.25 + 0.6 * f, a: 0.7 * (1 - f) });
      }
    }
    const arr = this.container.particleChildren as Particle[];
    while (arr.length < list.length) arr.push(new Particle({ texture: this.tex, anchorX: 0.5, anchorY: 0.5 }));
    if (arr.length > list.length) arr.length = list.length;
    list.forEach((q, i) => {
      const p = arr[i];
      p.x = q.x;
      p.y = q.y;
      const sc = (2 * q.r) / 32;
      p.scaleX = sc;
      p.scaleY = sc;
      p.alpha = q.a;
    });
    this.count = list.length;
    this.container.update();
  }
}
