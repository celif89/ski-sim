/**
 * Pogoda na mapie: padający śnieg (lub deszcz) jako lekka nakładka na ekranie i delikatne
 * przyciemnienie przy dużym zachmurzeniu. Tylko wygląd – opad podaje model pogody (etap 2).
 */
import { Container, Graphics, Particle, ParticleContainer, Texture } from 'pixi.js';

const MAX_FLAKES = 500;

function flakeTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  return Texture.from(c);
}

interface Flake {
  x: number;
  y: number;
  vy: number;
  size: number;
  sway: number;
}

export class WeatherFx {
  private readonly cloud = new Graphics();
  private readonly flakes: ParticleContainer;
  private readonly tex = flakeTexture();
  private state: Flake[] = [];
  private seed = 12345;

  constructor(screenLayer: Container) {
    this.flakes = new ParticleContainer({ dynamicProperties: { position: true, color: true, vertex: true } });
    screenLayer.addChildAt(this.cloud, 0);
    screenLayer.addChildAt(this.flakes, 1);
  }

  private rand(): number {
    // Prosty generator tylko dla efektu wizualnego (nie wpływa na symulację).
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /**
   * intensity 0–1 (opad teraz), rain – deszcz zamiast śniegu, cloud 0–1, wind [m/s] – znos płatków.
   */
  update(dtS: number, widthPx: number, heightPx: number, intensity: number, rain: boolean, cloud: number, windMs: number): void {
    this.cloud.clear();
    if (cloud > 0.5) this.cloud.rect(0, 0, widthPx, heightPx).fill({ color: 0x64748b, alpha: (cloud - 0.5) * 0.18 });
    const n = Math.round(MAX_FLAKES * Math.min(1, intensity));
    while (this.state.length < n) this.state.push({ x: this.rand() * widthPx, y: this.rand() * heightPx, vy: rain ? 600 + 300 * this.rand() : 30 + 50 * this.rand(), size: rain ? 1 : 2 + 4 * this.rand(), sway: this.rand() * 6.28 });
    if (this.state.length > n) this.state.length = n;
    const parts = this.flakes.particleChildren as Particle[];
    while (parts.length < n) parts.push(new Particle({ texture: this.tex, anchorX: 0.5, anchorY: 0.5 }));
    if (parts.length > n) parts.length = n;
    const dt = Math.min(dtS, 0.1);
    const drift = windMs * 6;
    for (let i = 0; i < n; i++) {
      const f = this.state[i];
      f.y += f.vy * dt;
      f.sway += dt * 1.5;
      f.x += (drift + Math.sin(f.sway) * 12) * dt;
      if (f.y > heightPx + 10) {
        f.y = -10;
        f.x = this.rand() * widthPx;
      }
      if (f.x > widthPx + 10) f.x -= widthPx + 20;
      if (f.x < -10) f.x += widthPx + 20;
      const p = parts[i];
      p.x = f.x;
      p.y = f.y;
      p.scaleX = (rain ? 0.12 : f.size / 16) * (rain ? 1 : 1);
      p.scaleY = rain ? 1.2 : f.size / 16;
      p.alpha = rain ? 0.35 : 0.85;
    }
    this.flakes.visible = n > 0;
    if (n > 0) this.flakes.update();
  }
}
