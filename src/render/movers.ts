/**
 * Małe postacie na mapie (widok z góry): narciarze, snowboardziści, stojący w kolejce, siedzący na
 * krzesełkach, idący pieszo; w przyszłości ratraki (etap 7). Wszystkie w kontenerach cząstek
 * (jedno wywołanie rysowania na warstwę) – cień, postać, światła. Obrazki narysowane raz do jednej
 * tekstury (atlas). Kolor kurtki – z ziarna (symulacja), dzieci mniejsze.
 *
 * Dane: ramka z wątku gości (FRAME_STRIDE liczb na osobę), między ramkami położenie przesuwane
 * z prędkością (płynny ruch przy rzadszych ramkach).
 */
import { Container, Particle, ParticleContainer, Rectangle, Texture } from 'pixi.js';
import type { Camera } from './camera';
import type { SpriteAtlas } from './atlasTexture';
import { directionIndex } from './atlasGen';

/** Układ ramki (jak FRAME_STRIDE w src/sim/guests.ts). */
const STRIDE = 9;
export const KIND_SKI = 0;
export const KIND_BOARD = 1;
export const KIND_STAND = 2;
export const KIND_SEATED = 3;
export const KIND_WALK = 4;
export const KIND_GROOMER = 5;
/** Etap 7b (lato): rowerzysta i sanki toru (rodzaje w ramce z SummerDay). */
export const KIND_BIKE = 5;
export const KIND_SLED = 6;

/** Rozmiary w terenie [m]. */
const PERSON_LENGTH_M = 1.9;
const GROOMER_LENGTH_M = 8.5;
const LIGHT_LENGTH_M = 26;
const SHADOW_OFFSET_M = 0.8;
const CHILD_SCALE = 0.7;
/** Najmniejszy rozmiar na ekranie [px] – przy oddaleniu postacie powiększone jak na mapie ilustrowanej. */
const MIN_PERSON_PX = 14;
const MIN_GROOMER_PX = 22;
/** Najdłuższe przesunięcie między ramkami [s czasu gry]. */
const MAX_EXTRAPOLATION_S = 3;

const JACKETS = ['#d92b2b', '#1c64d8', '#f59e0b', '#2f9e44', '#7b3fbf', '#0f9fb0', '#e64980', '#212529'];
const CELL = 64;

interface Frames {
  /** [kurtka][poza] – narciarz (pozy 0–2: skręt), deska (3), stojący (4), siedzący (5), idący (6, 7). */
  person: Texture[][];
  shadow: Texture;
  groomer: Texture;
  shadowGroomer: Texture;
  light: Texture;
}

function buildAtlas(): Frames {
  const cols = JACKETS.length;
  const rows = 13;
  const canvas = document.createElement('canvas');
  canvas.width = CELL * cols;
  canvas.height = CELL * rows;
  const ctx = canvas.getContext('2d')!;
  const body = (cx: number, cy: number, jacket: string, lean: number) => {
    ctx.fillStyle = jacket;
    ctx.beginPath();
    ctx.ellipse(cx + lean * 6, cy - 2, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(cx + lean * 6, cy - 8, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  JACKETS.forEach((jacket, i) => {
    const cx = i * CELL + CELL / 2;
    // Narciarz – 3 pozy skrętu (postać skierowana „w górę” tekstury).
    for (let pose = 0; pose < 3; pose++) {
      const cy = pose * CELL + CELL / 2;
      const lean = (pose - 1) * 0.35;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(lean * 0.4);
      ctx.fillStyle = '#334155';
      for (const sx of [-5, 5]) ctx.fillRect(sx - 1.6, -26, 3.2, 52);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-7, -4, 14, 10);
      ctx.translate(-cx, -cy);
      body(cx, cy, jacket, lean);
      ctx.strokeStyle = '#475569';
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy - 2);
      ctx.lineTo(cx - 13, cy + 10);
      ctx.moveTo(cx + 9, cy - 2);
      ctx.lineTo(cx + 13, cy + 10);
      ctx.stroke();
      ctx.restore();
    }
    // Snowboardzista: deska wzdłuż kierunku jazdy, postać bokiem.
    {
      const cy = 3 * CELL + CELL / 2;
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(cx - 5.5, cy - 24, 11, 48, 5.5);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(cx - 4, cy - 2, 8, 2);
      ctx.fillStyle = jacket;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 7, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(cx + 2, cy - 1, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Stojący (kolejka): narty równolegle, bez kijków w ruchu.
    {
      const cy = 4 * CELL + CELL / 2;
      ctx.fillStyle = '#334155';
      for (const sx of [-4, 4]) ctx.fillRect(cx + sx - 1.6, cy - 22, 3.2, 44);
      body(cx, cy, jacket, 0);
    }
    // Siedzący na krzesełku (od góry: ramiona i kask, nogi do przodu).
    {
      const cy = 5 * CELL + CELL / 2;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(cx - 6, cy - 14, 4, 12);
      ctx.fillRect(cx + 2, cy - 14, 4, 12);
      body(cx, cy + 4, jacket, 0);
    }
    // Idący pieszo z nartami na ramieniu (2 pozy).
    for (let k = 0; k < 2; k++) {
      const cy = (6 + k) * CELL + CELL / 2;
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(cx - 5 + (k ? 2 : -2), cy - 6, 4, 12);
      ctx.fillRect(cx + 1 + (k ? -2 : 2), cy - 6, 4, 12);
      ctx.fillStyle = '#334155';
      ctx.fillRect(cx + 6, cy - 22, 3, 40);
      body(cx, cy, jacket, 0);
    }
  });
  // Etap 7b – lato: piechur bez nart (2 pozy, wiersze 9–10), rowerzysta (11), sanki toru (12).
  JACKETS.forEach((jacket, i) => {
    const cx = i * CELL + CELL / 2;
    for (let k = 0; k < 2; k++) {
      const cy = (9 + k) * CELL + CELL / 2;
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(cx - 5 + (k ? 2 : -2), cy - 4, 4, 12);
      ctx.fillRect(cx + 1 + (k ? -2 : 2), cy - 4, 4, 12);
      ctx.fillStyle = '#a16207';
      ctx.fillRect(cx - 6, cy + 1, 12, 6); // plecak
      body(cx, cy - 2, jacket, 0);
    }
    {
      const cy = 11 * CELL + CELL / 2;
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 24);
      ctx.lineTo(cx, cy + 24);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy - 16);
      ctx.lineTo(cx + 9, cy - 16);
      ctx.stroke();
      body(cx, cy + 2, jacket, 0);
    }
    {
      const cy = 12 * CELL + CELL / 2;
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.roundRect(cx - 9, cy - 18, 18, 36, 6);
      ctx.fill();
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      body(cx, cy + 2, jacket, 0);
    }
  });
  const row = 8 * CELL;
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
  soft(CELL / 2, row + CELL / 2, 14, 26);
  soft(CELL + CELL / 2, row + CELL / 2, 26, 30);
  // Ratrak (skierowany w górę): gąsienice, nadwozie, kabina, pług z przodu, frez z tyłu.
  {
    const cx = 2 * CELL + CELL / 2;
    const cy = row + CELL / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#334155';
    ctx.fillRect(-19, -22, 9, 46);
    ctx.fillRect(10, -22, 9, 46);
    ctx.fillStyle = '#d9480f';
    ctx.fillRect(-12, -18, 24, 38);
    ctx.fillStyle = '#93c5fd';
    ctx.fillRect(-9, -15, 18, 10);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(-24, -29, 48, 6);
    ctx.fillStyle = '#475569';
    ctx.fillRect(-4, 20, 8, 7);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(-11, 24, 22, 4);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(-10, -19, 4, 3);
    ctx.fillRect(6, -19, 4, 3);
    ctx.restore();
  }
  {
    const x0 = 3 * CELL;
    const g = ctx.createLinearGradient(0, row + CELL, 0, row);
    g.addColorStop(0, 'rgba(255,236,170,0.85)');
    g.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 + CELL / 2 - 6, row + CELL);
    ctx.lineTo(x0 + CELL / 2 + 6, row + CELL);
    ctx.lineTo(x0 + CELL - 2, row);
    ctx.lineTo(x0 + 2, row);
    ctx.closePath();
    ctx.fill();
  }
  const base = Texture.from(canvas);
  const frame = (x: number, y: number) => new Texture({ source: base.source, frame: new Rectangle(x * CELL, y * CELL, CELL, CELL) });
  return {
    person: JACKETS.map((_, i) => Array.from({ length: 12 }, (_, pose) => frame(i, pose < 8 ? pose : pose + 1))),
    shadow: frame(0, 8),
    shadowGroomer: frame(1, 8),
    groomer: frame(2, 8),
    light: frame(3, 8),
  };
}

export class MoverLayer {
  private readonly frames: Frames;
  private readonly shadows: ParticleContainer;
  private readonly bodies: ParticleContainer;
  private readonly lights: ParticleContainer;
  /** Etap 7d: kurtki (biała klatka atlasu barwiona kolorem z ziarna). */
  private readonly jackets: ParticleContainer;
  private atlas: SpriteAtlas | null = null;
  private readonly jacketTints = JACKETS.map((c) => parseInt(c.slice(1), 16));
  /** Rozstaw lin kolei (połowa) [m] – siedzący na krzesełkach po stronie jazdy w górę. */
  static readonly ROPE_HALF_M = 2;
  private data: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private count = 0;
  private frameTimeS = 0;
  /** Ratraki (etap 7) – osobna lista: x, y, kierunek, światła. */
  groomers: { id?: string; xM: number; yM: number; headingRad: number; lightsOn: boolean }[] = [];
  /** Liczba postaci narysowanych w ostatniej klatce (widocznych na ekranie). */
  visibleCount = 0;
  /** Etap 7b: ramka z gości letnich (piesi bez nart, rowerzyści, sanki). */
  summer = false;

  constructor(world: Container) {
    this.frames = buildAtlas();
    const dyn = { position: true, rotation: true, uvs: true, color: true, vertex: true };
    this.shadows = new ParticleContainer({ dynamicProperties: dyn });
    this.bodies = new ParticleContainer({ dynamicProperties: dyn });
    this.lights = new ParticleContainer({ dynamicProperties: dyn });
    this.lights.blendMode = 'add';
    this.jackets = new ParticleContainer({ dynamicProperties: dyn });
    world.addChild(this.shadows, this.bodies, this.jackets, this.lights);
  }

  /** Etap 7d: atlas z opisu data/atlas.json (8 kierunków, fazy, 3 poziomy szczegółowości). */
  setAtlas(a: SpriteAtlas): void {
    this.atlas = a;
  }

  /** Nowa ramka z wątku gości (dane i czas gry, którego dotyczą). */
  setFrame(data: Float32Array, count: number, timeS: number): void {
    this.data = data;
    this.count = count;
    this.frameTimeS = timeS;
  }

  /** Położenie osoby k w ramce w chwili renderTimeS (z przesunięciem o prędkość). */
  positionOf(k: number, renderTimeS: number): { id: number; xM: number; yM: number; kind: number } {
    const o = k * STRIDE;
    const dt = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, renderTimeS - this.frameTimeS));
    return { id: this.data[o], xM: this.data[o + 1] + this.data[o + 3] * dt, yM: this.data[o + 2] + this.data[o + 4] * dt, kind: this.data[o + 6] };
  }

  /** Etap 7d: narciarze i snowboardziści w widoku (pył spod nart w puchu). */
  skiersInView(camera: Camera, renderTimeS: number, max: number): { xM: number; yM: number; vx: number; vy: number; seed: number }[] {
    const a = camera.screenToWorld(0, 0);
    const b = camera.screenToWorld(camera.viewportWidthPx, camera.viewportHeightPx);
    const x0 = Math.min(a.xM, b.xM);
    const x1 = Math.max(a.xM, b.xM);
    const y0 = Math.min(a.yM, b.yM);
    const y1 = Math.max(a.yM, b.yM);
    const dt = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, renderTimeS - this.frameTimeS));
    const out: { xM: number; yM: number; vx: number; vy: number; seed: number }[] = [];
    for (let k = 0; k < this.count && out.length < max; k++) {
      const o = k * STRIDE;
      const kind = this.data[o + 6];
      if (this.summer || (kind !== KIND_SKI && kind !== KIND_BOARD)) continue;
      const x = this.data[o + 1] + this.data[o + 3] * dt;
      const y = this.data[o + 2] + this.data[o + 4] * dt;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push({ xM: x, yM: y, vx: this.data[o + 3], vy: this.data[o + 4], seed: this.data[o] });
    }
    return out;
  }

  get personCount(): number {
    return this.count;
  }

  /** Etap 3D-0: ostatnia ramka z wątku gości (tylko odczyt – widok 3D rysuje te same osoby). */
  get frame(): { data: Float32Array<ArrayBufferLike>; count: number; timeS: number; summer: boolean } {
    return { data: this.data, count: this.count, timeS: this.frameTimeS, summer: this.summer };
  }

  private sync(pc: ParticleContainer, n: number, texture: Texture): Particle[] {
    const arr = pc.particleChildren as Particle[];
    while (arr.length < n) arr.push(new Particle({ texture, anchorX: 0.5, anchorY: 0.5 }));
    if (arr.length > n) arr.length = n;
    return arr;
  }

  /** Co klatkę: położenia, obroty, widoczność (tylko na ekranie), cienie, światła nocą. */
  update(camera: Camera, night: number, renderTimeS: number): void {
    if (this.atlas?.ready) {
      this.updateAtlas(camera, night, renderTimeS, this.atlas);
      return;
    }
    this.jackets.visible = false;
    const mpp = camera.metersPerPixel;
    const show = mpp < 6 && (this.count > 0 || this.groomers.length > 0);
    this.shadows.visible = show;
    this.bodies.visible = show;
    this.lights.visible = show && night > 0.05;
    if (!show) {
      this.visibleCount = 0;
      return;
    }
    const a = camera.screenToWorld(0, 0);
    const b = camera.screenToWorld(camera.viewportWidthPx, camera.viewportHeightPx);
    const margin = 30;
    const x0 = Math.min(a.xM, b.xM) - margin;
    const x1 = Math.max(a.xM, b.xM) + margin;
    const y0 = Math.min(a.yM, b.yM) - margin;
    const y1 = Math.max(a.yM, b.yM) + margin;
    const d = this.data;
    const dt = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, renderTimeS - this.frameTimeS));
    // Najpierw policz widocznych (żeby nie tworzyć cząstek na zapas).
    let n = 0;
    for (let k = 0; k < this.count; k++) {
      const o = k * STRIDE;
      const x = d[o + 1] + d[o + 3] * dt;
      const y = d[o + 2] + d[o + 4] * dt;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) n++;
    }
    const gVisible = this.groomers.filter((g) => g.xM >= x0 && g.xM <= x1 && g.yM >= y0 && g.yM <= y1);
    const total = n + gVisible.length;
    this.visibleCount = total;
    const sh = this.sync(this.shadows, total, this.frames.shadow);
    const bo = this.sync(this.bodies, total, this.frames.person[0][1]);
    const s = camera.sign;
    const personLen = Math.max(PERSON_LENGTH_M, MIN_PERSON_PX * mpp);
    const tint = night > 0.3 ? 0x8899aa : 0xffffff;
    let i = 0;
    for (let k = 0; k < this.count; k++) {
      const o = k * STRIDE;
      const x = d[o + 1] + d[o + 3] * dt;
      const y = d[o + 2] + d[o + 4] * dt;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const kind = d[o + 6];
      const variant = d[o + 7];
      const child = variant >= 16;
      const jacket = this.frames.person[(variant % 16) % JACKETS.length];
      const phase = d[o + 8];
      const pose = this.summer
        ? kind === KIND_BIKE
          ? 10
          : kind === KIND_SLED
            ? 11
            : kind === KIND_SEATED
              ? 5
              : kind === KIND_STAND
                ? 8
                : phase < 0.5
                  ? 8
                  : 9
        : kind === KIND_SKI
          ? phase < 0.33
            ? 0
            : phase < 0.66
              ? 1
              : 2
          : kind === KIND_BOARD
            ? 3
            : kind === KIND_STAND
              ? 4
              : kind === KIND_SEATED
                ? 5
                : phase < 0.5
                  ? 6
                  : 7;
      const scale = (personLen / CELL / 0.82) * (child ? CHILD_SCALE : 1);
      const rot = d[o + 5] + Math.PI / 2;
      const p = bo[i];
      p.texture = jacket[pose];
      p.x = x;
      p.y = y;
      p.rotation = rot;
      p.scaleX = scale;
      p.scaleY = scale;
      p.tint = tint;
      const q = sh[i];
      q.texture = this.frames.shadow;
      // Siedzący na krzesełku: cień daleko w dół (lina kilka metrów nad ziemią).
      const off = (kind === KIND_SEATED ? 6 : 1) * SHADOW_OFFSET_M * (personLen / PERSON_LENGTH_M);
      q.x = x + s * off;
      q.y = y + s * off;
      q.rotation = rot;
      q.scaleX = scale;
      q.scaleY = scale;
      q.tint = 0xffffff;
      i++;
    }
    const lightsList = gVisible.filter((g) => g.lightsOn);
    const li = this.sync(this.lights, lightsList.length, this.frames.light);
    for (const g of gVisible) {
      const len = Math.max(GROOMER_LENGTH_M, MIN_GROOMER_PX * mpp);
      const scale = len / CELL / 0.92;
      const rot = g.headingRad + Math.PI / 2;
      const p = bo[i];
      p.texture = this.frames.groomer;
      p.x = g.xM;
      p.y = g.yM;
      p.rotation = rot;
      p.scaleX = scale;
      p.scaleY = scale;
      p.tint = tint;
      const q = sh[i];
      q.texture = this.frames.shadowGroomer;
      q.x = g.xM + s * 2 * SHADOW_OFFSET_M * (len / GROOMER_LENGTH_M);
      q.y = g.yM + s * 2 * SHADOW_OFFSET_M * (len / GROOMER_LENGTH_M);
      q.rotation = rot;
      q.scaleX = scale;
      q.scaleY = scale;
      q.tint = 0xffffff;
      i++;
    }
    lightsList.forEach((g, k) => {
      const l = li[k];
      const scale = LIGHT_LENGTH_M / CELL;
      l.x = g.xM + Math.cos(g.headingRad) * LIGHT_LENGTH_M * 0.5;
      l.y = g.yM + Math.sin(g.headingRad) * LIGHT_LENGTH_M * 0.5;
      l.rotation = g.headingRad + Math.PI / 2;
      l.scaleX = scale * 0.8;
      l.scaleY = scale;
      l.tint = 0xffffff;
      l.alpha = Math.min(1, night * 1.2);
    });
    this.shadows.update();
    this.bodies.update();
    this.lights.update();
  }

  /**
   * Etap 7d: postacie i ratraki z atlasu – klatka wg kierunku na ekranie (8), fazy (skręt, krok)
   * i poziomu szczegółowości (wielkość na ekranie); kurtka barwiona osobno; cień jako sylwetka
   * przesunięta w prawo w dół ekranu (także przy obróconej mapie).
   */
  private updateAtlas(camera: Camera, night: number, renderTimeS: number, at: SpriteAtlas): void {
    const mpp = camera.metersPerPixel;
    const show = mpp < 6 && (this.count > 0 || this.groomers.length > 0);
    this.shadows.visible = show;
    this.bodies.visible = show;
    this.jackets.visible = show;
    this.lights.visible = show && night > 0.05;
    if (!show) {
      this.visibleCount = 0;
      return;
    }
    const a = camera.screenToWorld(0, 0);
    const b = camera.screenToWorld(camera.viewportWidthPx, camera.viewportHeightPx);
    const margin = 30;
    const x0 = Math.min(a.xM, b.xM) - margin;
    const x1 = Math.max(a.xM, b.xM) + margin;
    const y0 = Math.min(a.yM, b.yM) - margin;
    const y1 = Math.max(a.yM, b.yM) + margin;
    const d = this.data;
    const dt = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, renderTimeS - this.frameTimeS));
    const vis: number[] = [];
    // Siedzący na tym samym krzesełku – kolejne miejsca w poprzek.
    const seats = new Map<string, number>();
    for (let k = 0; k < this.count; k++) {
      const o = k * STRIDE;
      const x = d[o + 1] + d[o + 3] * dt;
      const y = d[o + 2] + d[o + 4] * dt;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) vis.push(k);
    }
    const gVisible = this.groomers.filter((g) => g.xM >= x0 && g.xM <= x1 && g.yM >= y0 && g.yM <= y1);
    const total = vis.length + gVisible.length;
    this.visibleCount = total;
    const sh = this.sync(this.shadows, total, Texture.EMPTY);
    const bo = this.sync(this.bodies, total, Texture.EMPTY);
    const ja = this.sync(this.jackets, total, Texture.EMPTY);
    const s = camera.sign;
    const counterRot = camera.rotated ? Math.PI : 0;
    const tint = night > 0.3 ? 0x8899aa : 0xffffff;
    let i = 0;
    const place = (id: string, phase: number, x: number, y: number, headingRad: number, lengthM: number, jacket: number | null, shadowScale = 1) => {
      const m = at.meta(id);
      const lod = at.lodFor(lengthM / mpp);
      const dir = directionIndex(headingRad + counterRot);
      const sc = at.scaleFor(id, lengthM, lod);
      const ph = Math.min(m.phases - 1, phase);
      const p = bo[i];
      p.texture = at.frame(id, 'b', ph, dir, lod);
      p.x = x;
      p.y = y;
      p.rotation = counterRot;
      p.scaleX = sc;
      p.scaleY = sc;
      p.tint = tint;
      const q = sh[i];
      q.texture = at.frame(id, 's', ph, dir, lod);
      const off = m.shadowM * shadowScale * (lengthM / m.sizeM);
      q.x = x + s * off;
      q.y = y + s * off;
      q.rotation = counterRot;
      q.scaleX = sc;
      q.scaleY = sc;
      q.tint = 0x0f172a;
      q.alpha = 0.32;
      const jj = ja[i];
      if (m.hasJacket && jacket !== null) {
        jj.texture = at.frame(id, 'j', ph, dir, lod);
        jj.x = x;
        jj.y = y;
        jj.rotation = counterRot;
        jj.scaleX = sc;
        jj.scaleY = sc;
        jj.tint = night > 0.3 ? mixTint(jacket, 0x8899aa) : jacket;
        jj.alpha = 1;
      } else {
        jj.texture = Texture.EMPTY;
        jj.alpha = 0;
      }
      i++;
    };
    for (const k of vis) {
      const o = k * STRIDE;
      let x = d[o + 1] + d[o + 3] * dt;
      let y = d[o + 2] + d[o + 4] * dt;
      const kind = d[o + 6];
      const variant = d[o + 7];
      const child = variant >= 16;
      const jacket = this.jacketTints[(variant % 16) % JACKETS.length];
      const phase = d[o + 8];
      const h = d[o + 5];
      let id: string;
      let ph = 0;
      if (this.summer) {
        if (kind === KIND_BIKE) id = 'bike';
        else if (kind === KIND_SLED) id = 'sled';
        else if (kind === KIND_SEATED) id = 'seated';
        else {
          id = 'hiker';
          ph = kind === KIND_STAND ? 0 : phase < 0.5 ? 0 : 1;
        }
      } else if (kind === KIND_SKI) {
        id = 'ski';
        ph = phase < 0.33 ? 0 : phase < 0.66 ? 1 : 2;
      } else if (kind === KIND_BOARD) {
        id = 'board';
        ph = phase < 0.5 ? 0 : 1;
      } else if (kind === KIND_STAND) id = 'stand';
      else if (kind === KIND_SEATED) id = 'seated';
      else {
        id = 'walk';
        ph = phase < 0.5 ? 0 : 1;
      }
      if (id === 'seated') {
        // Krzesełko po stronie jazdy (w poprzek od osi linii) i kolejne miejsca na siedzisku.
        const key = `${Math.round(x * 2)}|${Math.round(y * 2)}`;
        const seat = seats.get(key) ?? 0;
        seats.set(key, seat + 1);
        const nx = -Math.sin(h);
        const ny = Math.cos(h);
        const across = MoverLayer.ROPE_HALF_M + (seat % 4) * 0.65 - 0.95;
        x += nx * across;
        y += ny * across;
      }
      const m = at.meta(id);
      const lengthM = Math.max(m.sizeM, MIN_PERSON_PX * mpp) * (child ? CHILD_SCALE : 1);
      place(id, ph, x, y, h, lengthM, jacket);
    }
    const lightsList = gVisible.filter((g) => g.lightsOn);
    const li = this.sync(this.lights, lightsList.length, this.frames.light);
    for (const g of gVisible) place('groomer', 0, g.xM, g.yM, g.headingRad, Math.max(GROOMER_LENGTH_M, MIN_GROOMER_PX * mpp), null);
    lightsList.forEach((g, k) => {
      const l = li[k];
      const scale = LIGHT_LENGTH_M / CELL;
      l.x = g.xM + Math.cos(g.headingRad) * LIGHT_LENGTH_M * 0.5;
      l.y = g.yM + Math.sin(g.headingRad) * LIGHT_LENGTH_M * 0.5;
      l.rotation = g.headingRad + Math.PI / 2;
      l.scaleX = scale * 0.8;
      l.scaleY = scale;
      l.tint = 0xffffff;
      l.alpha = Math.min(1, night * 1.2);
    });
    this.shadows.update();
    this.bodies.update();
    this.jackets.update();
    this.lights.update();
  }
}

/** Mieszanie dwóch kolorów 0xRRGGBB (mnożenie – kurtka nocą). */
function mixTint(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
