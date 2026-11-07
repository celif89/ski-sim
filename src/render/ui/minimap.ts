/**
 * Etap 7c: minimapa w prawym dolnym rogu (makieta ui-1-mapa): cały teren w małej skali (cieniowanie
 * rzeźby, las, śnieg, trasy i wyciągi), pomarańczowy prostokąt aktualnego widoku. Kliknięcie lub
 * przeciągnięcie przesuwa kamerę. W rogu: obrót mapy (N↓ – widok od Korbielowa) i zoom.
 */
import type { TerrainGrid } from '../../sim';
import type { ResortLayout } from '../../sim/resort';
import type { Camera } from '../camera';
import { icon } from './icons';
import { tipAttrs } from './shell';

const W = 252;
const H = 168;

export interface MinimapHandlers {
  onRotate(): void;
  onZoom(factor: number): void;
}

export class Minimap {
  private readonly el: HTMLElement;
  private readonly base: HTMLCanvasElement;
  private readonly over: HTMLCanvasElement;
  private readonly north: HTMLElement;
  private readonly scale: number;
  private readonly offX: number;
  private readonly offY: number;
  private baseKey = '';
  private viewKey = '';
  private dragging = false;
  private layout: ResortLayout | null = null;
  private pisteColors: string[] = [];

  constructor(
    parent: HTMLElement,
    private readonly grid: TerrainGrid,
    private readonly hillshade: Float32Array,
    private readonly forest: Float32Array | null,
    private readonly camera: Camera,
    h: MinimapHandlers,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'u-panel u-minimap';
    this.el.innerHTML = `<div class="u-mm-frame"><canvas class="u-mm-base" width="${W}" height="${H}"></canvas><canvas class="u-mm-over" width="${W}" height="${H}" role="img" aria-label="Minimapa całego ośrodka – kliknij, żeby przesunąć widok"></canvas>
      <button type="button" class="u-mm-north" ${tipAttrs('Północ. Kliknij – obróć mapę o 180° (widok od Korbielowa ↔ od Słowacji)')}>N↓</button>
      <div class="u-mm-zoom"><button type="button" data-z="in" ${tipAttrs('Przybliż (kółko myszy)')}>${icon('plus', 14, 2)}</button><button type="button" data-z="out" ${tipAttrs('Oddal (kółko myszy)')}>${icon('minus', 14, 2)}</button></div></div>`;
    parent.appendChild(this.el);
    this.base = this.el.querySelector('.u-mm-base')!;
    this.over = this.el.querySelector('.u-mm-over')!;
    this.north = this.el.querySelector('.u-mm-north')!;
    this.scale = Math.min(W / grid.widthM, H / grid.heightM);
    this.offX = (W - grid.widthM * this.scale) / 2;
    this.offY = (H - grid.heightM * this.scale) / 2;
    this.north.addEventListener('click', () => h.onRotate());
    this.el.querySelector('[data-z="in"]')!.addEventListener('click', () => h.onZoom(1.6));
    this.el.querySelector('[data-z="out"]')!.addEventListener('click', () => h.onZoom(1 / 1.6));
    const go = (e: PointerEvent) => {
      const r = this.over.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      let px = fx * W;
      let py = fy * H;
      if (this.camera.rotated) {
        px = W - px;
        py = H - py;
      }
      this.camera.centerOn((px - this.offX) / this.scale, (py - this.offY) / this.scale);
    };
    this.over.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.over.setPointerCapture(e.pointerId);
      go(e);
    });
    this.over.addEventListener('pointermove', (e) => this.dragging && go(e));
    this.over.addEventListener('pointerup', () => (this.dragging = false));
  }

  setPisteColors(c: string[]): void {
    this.pisteColors = c;
  }

  setLayout(layout: ResortLayout, pisteClass: (id: string) => number): void {
    this.layout = layout;
    this.pisteClass = pisteClass;
    this.baseKey = '';
  }

  private pisteClass: (id: string) => number = () => 1;
  private snow: Float32Array | null = null;
  private summer = false;

  setSnow(depthCm: Float32Array | null, summer: boolean): void {
    this.snow = depthCm;
    this.summer = summer;
    this.baseKey = '';
  }

  /** Teren (rzadko – po zmianie śniegu lub układu) i prostokąt widoku (co klatkę, gdy się zmienił). */
  update(): void {
    if (!this.baseKey) {
      this.drawBase();
      this.baseKey = 'ok';
      this.viewKey = '';
    }
    const c = this.camera;
    const key = `${c.centerXM.toFixed(0)} ${c.centerYM.toFixed(0)} ${c.metersPerPixel.toFixed(3)} ${c.viewportWidthPx} ${c.viewportHeightPx} ${c.rotated}`;
    if (key === this.viewKey) return;
    this.viewKey = key;
    this.base.style.transform = c.rotated ? 'rotate(180deg)' : '';
    this.north.textContent = c.rotated ? 'N↓' : 'N↑';
    const ctx = this.over.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    const halfW = (c.viewportWidthPx * c.metersPerPixel) / 2;
    const halfH = (c.viewportHeightPx * c.metersPerPixel) / 2;
    let x0 = this.offX + (c.centerXM - halfW) * this.scale;
    let y0 = this.offY + (c.centerYM - halfH) * this.scale;
    const w = 2 * halfW * this.scale;
    const hh = 2 * halfH * this.scale;
    if (c.rotated) {
      x0 = W - x0 - w;
      y0 = H - y0 - hh;
    }
    ctx.strokeStyle = '#FF7A1A';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.max(1, x0), Math.max(1, y0), Math.min(W - 2, w), Math.min(H - 2, hh));
  }

  private drawBase(): void {
    const g = this.grid;
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const xM = (px + 0.5 - this.offX) / this.scale;
        const yM = (py + 0.5 - this.offY) / this.scale;
        const o = (py * W + px) * 4;
        const cell = g.cellAt(xM, yM);
        const z = cell ? g.elevationM[g.index(cell.i, cell.j)] : NaN;
        if (!cell || Number.isNaN(z)) {
          d[o] = 52;
          d[o + 1] = 62;
          d[o + 2] = 74;
          d[o + 3] = 255;
          continue;
        }
        const k = g.index(cell.i, cell.j);
        const shade = Math.max(0, Math.min(1, this.hillshade[k] ?? 0.7));
        const f = this.forest ? Math.min(1, this.forest[k]) : 0;
        const snowCm = this.snow ? this.snow[k] : this.summer ? 0 : 30;
        const white = this.summer ? 0 : Math.max(0, Math.min(1, snowCm / 15));
        // łąka/śnieg – las (ciemna zieleń z białym nalotem zimą)
        const open = white > 0 ? [235 * white + 150 * (1 - white), 240 * white + 170 * (1 - white), 246 * white + 120 * (1 - white)] : [150, 172, 118];
        const tree = [44 + 60 * white, 84 + 50 * white, 64 + 60 * white];
        const s = 0.55 + 0.45 * shade;
        d[o] = (open[0] * (1 - f) + tree[0] * f) * s;
        d[o + 1] = (open[1] * (1 - f) + tree[1] * f) * s;
        d[o + 2] = (open[2] * (1 - f) + tree[2] * f) * s;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const l = this.layout;
    if (!l) return;
    const tx = (x: number) => this.offX + x * this.scale;
    const ty = (y: number) => this.offY + y * this.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of l.pistes) {
      if (p.points.length < 2) continue;
      ctx.beginPath();
      p.points.forEach((q, i) => (i ? ctx.lineTo(tx(q.xM), ty(q.yM)) : ctx.moveTo(tx(q.xM), ty(q.yM))));
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = this.pisteColors[this.pisteClass(p.id)] ?? '#2563EB';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1.2;
    for (const lift of l.lifts) {
      ctx.beginPath();
      ctx.moveTo(tx(lift.bottom.xM), ty(lift.bottom.yM));
      for (const b of lift.bends ?? []) ctx.lineTo(tx(b.xM), ty(b.yM));
      ctx.lineTo(tx(lift.top.xM), ty(lift.top.yM));
      ctx.stroke();
    }
  }
}
