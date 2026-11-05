/**
 * Małe obiekty ruchome na mapie (widok z góry): narciarze, ratraki (z wyciągarką i światłami),
 * w przyszłości także inni. Wszystkie w jednym kontenerze cząstek (jedno wywołanie rysowania na
 * warstwę) – cień, obiekt, światła. Obrazki rysowane raz do jednej tekstury (atlas).
 *
 * To tylko rysowanie: położenie, kierunek i stan podaje logika (etap 5 – goście, etap 7 –
 * ratraki; teraz – scena demonstracyjna).
 */
import { Container, Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js';
import type { Camera } from './camera';

export type MoverKind = 'skier' | 'groomer';

export interface MoverState {
  kind: MoverKind;
  xM: number;
  yM: number;
  /** Kierunek jazdy (kąt w układzie mapy: 0 – na wschód, π/2 – na południe). */
  headingRad: number;
  /** Wariant wyglądu (kolor kurtki). */
  variant: number;
  /** Faza animacji 0–1 (np. skręt w lewo/prawo). */
  phase: number;
  lightsOn?: boolean;
}

/** Rozmiary obiektów w terenie [m]. */
const SKIER_LENGTH_M = 1.9;
const GROOMER_LENGTH_M = 8.5;
const LIGHT_LENGTH_M = 26;
const SHADOW_OFFSET_M = 0.8;
/** Najmniejszy rozmiar na ekranie [px] – przy oddaleniu obiekty powiększone jak na mapie ilustrowanej. */
const MIN_SKIER_PX = 7;
const MIN_GROOMER_PX = 14;

const JACKETS = ['#d92b2b', '#1c64d8', '#f59e0b', '#2f9e44', '#7b3fbf', '#0f9fb0', '#e64980', '#212529'];
const CELL = 64;

interface Frames {
  skier: Texture[][];
  shadowSkier: Texture;
  groomer: Texture;
  shadowGroomer: Texture;
  light: Texture;
}

/** Atlas: narciarze (kolory × 3 pozy), cienie, ratrak, smuga światła. */
function buildAtlas(): Frames {
  const cols = JACKETS.length;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * cols;
  canvas.height = CELL * 5;
  const ctx = canvas.getContext('2d')!;
  // Narciarz skierowany „w górę” tekstury (−y): narty, nogi, kurtka, głowa w kasku.
  JACKETS.forEach((jacket, i) => {
    for (let pose = 0; pose < 3; pose++) {
      const cx = i * CELL + CELL / 2;
      const cy = pose * CELL + CELL / 2;
      const lean = (pose - 1) * 0.35;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(lean * 0.4);
      ctx.fillStyle = '#334155';
      for (const sx of [-5, 5]) ctx.fillRect(sx - 1.6, -26, 3.2, 52); // narty
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-7, -4, 14, 10); // spodnie
      ctx.fillStyle = jacket;
      ctx.beginPath();
      ctx.ellipse(lean * 6, -2, 9, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(lean * 6, -8, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // kijki
      ctx.strokeStyle = '#475569';
      ctx.beginPath();
      ctx.moveTo(-9, -2);
      ctx.lineTo(-13, 10);
      ctx.moveTo(9, -2);
      ctx.lineTo(13, 10);
      ctx.stroke();
      ctx.restore();
    }
  });
  const row3 = 3 * CELL;
  const soft = (x: number, y: number, rx: number, ry: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
    g.addColorStop(0, 'rgba(30,41,59,0.55)');
    g.addColorStop(1, 'rgba(30,41,59,0)');
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  soft(CELL / 2, row3 + CELL / 2, 14, 26); // cień narciarza
  soft(CELL + CELL / 2, row3 + CELL / 2, 26, 30); // cień ratraka
  // Ratrak (skierowany w górę): gąsienice, nadwozie, kabina, pług z przodu, wyciągarka z tyłu.
  {
    const cx = 2 * CELL + CELL / 2;
    const cy = row3 + CELL / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#334155';
    ctx.fillRect(-19, -22, 9, 46);
    ctx.fillRect(10, -22, 9, 46);
    ctx.fillStyle = '#d9480f';
    ctx.fillRect(-12, -18, 24, 38);
    ctx.fillStyle = '#93c5fd';
    ctx.fillRect(-9, -15, 18, 10); // szyba kabiny
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(-24, -29, 48, 6); // pług
    ctx.fillStyle = '#475569';
    ctx.fillRect(-4, 20, 8, 7); // wyciągarka
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-11, 24, 22, 4); // frez (sztruks)
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(-10, -19, 4, 3);
    ctx.fillRect(6, -19, 4, 3);
    ctx.restore();
  }
  // Smuga światła reflektorów (do przodu, czyli w górę tekstury).
  {
    const x0 = 3 * CELL;
    const g = ctx.createLinearGradient(0, row3 + CELL, 0, row3);
    g.addColorStop(0, 'rgba(255,236,170,0.85)');
    g.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 + CELL / 2 - 6, row3 + CELL);
    ctx.lineTo(x0 + CELL / 2 + 6, row3 + CELL);
    ctx.lineTo(x0 + CELL - 2, row3);
    ctx.lineTo(x0 + 2, row3);
    ctx.closePath();
    ctx.fill();
  }
  const base = Texture.from(canvas);
  const frame = (x: number, y: number) => new Texture({ source: base.source, frame: new Rectangle(x * CELL, y * CELL, CELL, CELL) });
  return {
    skier: JACKETS.map((_, i) => [0, 1, 2].map((pose) => frame(i, pose))),
    shadowSkier: frame(0, 3),
    shadowGroomer: frame(1, 3),
    groomer: frame(2, 3),
    light: frame(3, 3),
  };
}

export class MoverLayer {
  private readonly frames: Frames;
  private readonly shadows: ParticleContainer;
  private readonly bodies: ParticleContainer;
  private readonly lights: ParticleContainer;
  private movers: MoverState[] = [];
  /** Liczba obiektów narysowanych w ostatniej klatce (widocznych na ekranie). */
  visibleCount = 0;

  constructor(world: Container) {
    this.frames = buildAtlas();
    const dyn = { position: true, rotation: true, uvs: true, color: true, vertex: true };
    this.shadows = new ParticleContainer({ dynamicProperties: dyn });
    this.bodies = new ParticleContainer({ dynamicProperties: dyn });
    this.lights = new ParticleContainer({ dynamicProperties: dyn });
    this.lights.blendMode = 'add';
    world.addChild(this.shadows, this.bodies, this.lights);
  }

  /** Nowy zestaw obiektów (liczba może się zmieniać). */
  setMovers(list: MoverState[]): void {
    this.movers = list;
  }

  private sync(pc: ParticleContainer, n: number, texture: Texture): Particle[] {
    const arr = pc.particleChildren as Particle[];
    while (arr.length < n) arr.push(new Particle({ texture, anchorX: 0.5, anchorY: 0.5 }));
    if (arr.length > n) arr.length = n;
    return arr;
  }

  /** Co klatkę: położenia, obroty, widoczność (tylko na ekranie), cienie, światła nocą. */
  update(camera: Camera, night: number): void {
    const list = this.movers;
    const mpp = camera.metersPerPixel;
    const show = mpp < 4 && list.length > 0;
    this.shadows.visible = show;
    this.bodies.visible = show;
    this.lights.visible = show && night > 0.05;
    if (!show) {
      this.visibleCount = 0;
      return;
    }
    const corners = [camera.screenToWorld(0, 0), camera.screenToWorld(camera.viewportWidthPx, camera.viewportHeightPx)];
    const margin = 30;
    const x0 = Math.min(corners[0].xM, corners[1].xM) - margin;
    const x1 = Math.max(corners[0].xM, corners[1].xM) + margin;
    const y0 = Math.min(corners[0].yM, corners[1].yM) - margin;
    const y1 = Math.max(corners[0].yM, corners[1].yM) + margin;
    const visible = list.filter((m) => m.xM >= x0 && m.xM <= x1 && m.yM >= y0 && m.yM <= y1);
    this.visibleCount = visible.length;
    const lightsList = visible.filter((m) => m.kind === 'groomer' && m.lightsOn);
    const sh = this.sync(this.shadows, visible.length, this.frames.shadowSkier);
    const bo = this.sync(this.bodies, visible.length, this.frames.skier[0][1]);
    const li = this.sync(this.lights, lightsList.length, this.frames.light);
    // Cień w prawo w dół ekranu (jak drzewa i budynki).
    const s = camera.sign;
    const offX = s * SHADOW_OFFSET_M;
    const offY = s * SHADOW_OFFSET_M;
    // Obrazki rysowane „w górę” (−y) – obrót = kierunek + π/2.
    for (let i = 0; i < visible.length; i++) {
      const m = visible[i];
      const groomer = m.kind === 'groomer';
      const lengthM = groomer ? Math.max(GROOMER_LENGTH_M, MIN_GROOMER_PX * mpp) : Math.max(SKIER_LENGTH_M, MIN_SKIER_PX * mpp);
      const scale = lengthM / CELL / (groomer ? 0.92 : 0.82);
      const rot = m.headingRad + Math.PI / 2;
      const b = bo[i];
      b.texture = groomer ? this.frames.groomer : this.frames.skier[m.variant % this.frames.skier.length][m.phase < 0.33 ? 0 : m.phase < 0.66 ? 1 : 2];
      b.x = m.xM;
      b.y = m.yM;
      b.rotation = rot;
      b.scaleX = scale;
      b.scaleY = scale;
      b.tint = night > 0.3 ? 0x8899aa : 0xffffff;
      const d = sh[i];
      d.texture = groomer ? this.frames.shadowGroomer : this.frames.shadowSkier;
      const shadowK = (groomer ? 2 : 1) * (lengthM / (groomer ? GROOMER_LENGTH_M : SKIER_LENGTH_M));
      d.x = m.xM + offX * shadowK;
      d.y = m.yM + offY * shadowK;
      d.rotation = rot;
      d.scaleX = scale;
      d.scaleY = scale;
      d.tint = 0xffffff;
    }
    for (let i = 0; i < lightsList.length; i++) {
      const m = lightsList[i];
      const l = li[i];
      const scale = LIGHT_LENGTH_M / CELL;
      l.x = m.xM + Math.cos(m.headingRad) * LIGHT_LENGTH_M * 0.5;
      l.y = m.yM + Math.sin(m.headingRad) * LIGHT_LENGTH_M * 0.5;
      l.rotation = m.headingRad + Math.PI / 2;
      l.scaleX = scale * 0.8;
      l.scaleY = scale;
      l.tint = 0xffffff;
      l.alpha = Math.min(1, night * 1.2);
    }
    this.shadows.update();
    this.bodies.update();
    this.lights.update();
  }
}
