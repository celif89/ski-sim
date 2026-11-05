/**
 * Teren w stylu A – jedna siatka (prostokąt mapy) z shaderem terenu. GPU rysuje tylko widoczny
 * wycinek ekranu; szczegóły (faktury, drzewa) liczone są na bieżąco, więc przejścia między
 * poziomami szczegółowości są płynne.
 *
 * Dane dla shadera:
 *  – normalne terenu (siatka 10 m, filtrowane liniowo; mipmapy = piramida rozdzielczości),
 *  – komórki: grubość śniegu, stan śniegu, las, kosodrzewina (10 m),
 *  – maska: przecinki i powierzchnia tras (rysowane wektorowo co 2 m – ostre krawędzie lasu),
 *  – ślady: ratrak (sztruks) i narty – bufor co 2 m, zanikający z czasem i z opadem.
 */
import { BufferImageSource, CanvasSource, Container, Geometry, Matrix, Mesh, RenderTexture, Shader, Sprite } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import type { LiftParams } from '../sim/lifts';
import { liftTypeById } from '../sim/lifts';
import type { ResortLayout } from '../sim/resort';
import type { TerrainGrid } from '../sim/terrainGrid';
import type { Camera } from './camera';
import type { LodThresholds } from './illustration';
import { lightingForSun, lodWeights } from './illustration';
import { GLOW_FRAGMENT, TERRAIN_FRAGMENT, TERRAIN_VERTEX, TRACKS_FRAGMENT } from './terrainShader';

export interface IllustrationStyle {
  lod: LodThresholds;
  /** Drzewa poziomu 1 (ikonki): odstęp, wysokość [m], szerokość/wysokość. */
  treeIcons: { spacingM: number; heightM: number; widthRatio: number };
  /** Drzewa poziomu 2–3 (pojedyncze świerki). */
  trees: { spacingM: number; heightM: number; widthRatio: number };
  /** Kosodrzewina: odstęp i promień (ułamek odstępu) – szczegół i ikonki. */
  shrub: { spacingM: number; radius: number; iconSpacingM: number; iconRadius: number };
  /** Rozdzielczość maski i śladów [m/px]. */
  maskMetersPerPixel: number;
  /** Progi faktur: sztruks, ślady nart, muldy (0–1). */
  surface: { groomedMin: number; skiedMin: number; mogulsMin: number; corduroyPeriodM: number; groomerWidthM: number };
  /** Zanik śladów: czas połowicznego zaniku [s] i przyspieszenie przy opadzie śniegu. */
  tracksHalfLifeS: number;
  tracksSnowfallFactor: number;
  /** Przewyższenie cieniowania rzeźby. */
  reliefZFactor: number;
  /** Piramida kafli terenu. */
  tiles: { tilePx: number; coarsestMpp: number; levels: number; bakeBudgetMs: number; maxTiles: number; fadeInS: number };
}

/** Bufor śladów (ratrak / narty): wektor kierunku (podwojony kąt) × intensywność w R, G. */
export class TrackBuffer {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly data: Uint8Array;
  readonly source: BufferImageSource;
  /** Stan prostego generatora do rozproszonego zaokrąglania (tylko wygląd). */
  private dither = 1;
  /** Wiersze zmienione od ostatniej wysyłki do karty graficznej. */
  private readonly rowDirty: Uint8Array;
  private decayRow = 0;
  /** Wiersze, w których są ślady (pozostałe pomijamy przy zanikaniu). */
  private readonly rowActive: Uint8Array;

  constructor(
    widthM: number,
    heightM: number,
    readonly metersPerPixel: number,
  ) {
    this.widthPx = Math.ceil(widthM / metersPerPixel);
    this.heightPx = Math.ceil(heightM / metersPerPixel);
    this.data = new Uint8Array(this.widthPx * this.heightPx * 4);
    this.rowActive = new Uint8Array(this.heightPx);
    this.rowDirty = new Uint8Array(this.heightPx);
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = 128;
      this.data[i + 1] = 128;
      this.data[i + 2] = 128;
      this.data[i + 3] = 255;
    }
    this.source = new BufferImageSource({ resource: this.data, width: this.widthPx, height: this.heightPx, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha', scaleMode: 'linear' });
  }

  /**
   * Odcisk prostokąta (szerokość widthM, wzdłuż odcinka a→b) z kierunkiem jazdy; strength 0–1 –
   * ile zbliżyć do pełnego śladu (1 – ratrak zostawia od razu pełny sztruks).
   */
  stamp(ax: number, ay: number, bx: number, by: number, widthM: number, strength: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ang = 2 * Math.atan2(dy, dx);
    const vx = Math.cos(ang);
    const vy = Math.sin(ang);
    const tR = 128 + 127 * vx;
    const tG = 128 + 127 * vy;
    const mpp = this.metersPerPixel;
    const half = widthM / 2;
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - half) / mpp) - 1);
    const x1 = Math.min(this.widthPx - 1, Math.ceil((Math.max(ax, bx) + half) / mpp) + 1);
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - half) / mpp) - 1);
    const y1 = Math.min(this.heightPx - 1, Math.ceil((Math.max(ay, by) + half) / mpp) + 1);
    const ux = dx / len;
    const uy = dy / len;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const wx = (px + 0.5) * mpp - ax;
        const wy = (py + 0.5) * mpp - ay;
        const along = wx * ux + wy * uy;
        if (along < -mpp || along > len + mpp) continue;
        // Brzeg miękki na szerokości jednego piksela bufora (bez schodków przy 2 m/px).
        const cover = Math.min(1, Math.max(0, (half - Math.abs(-wx * uy + wy * ux)) / mpp + 0.5));
        if (cover <= 0) continue;
        const k = strength * cover;
        const o = (py * this.widthPx + px) * 4;
        this.data[o] += (tR - this.data[o]) * k;
        this.data[o + 1] += (tG - this.data[o + 1]) * k;
      }
    }
    this.rowDirty.fill(1, y0, y1 + 1);
    this.rowActive.fill(1, y0, y1 + 1);
  }

  /** Zanik śladów: część wierszy na wywołanie (całość w ok. 1 s przy 60 kl./s). factor – mnożnik intensywności. */
  decayStep(factor: number, rowsPerCall: number): void {
    const rows = Math.min(rowsPerCall, this.heightPx);
    for (let r = 0; r < rows; r++) {
      const py = this.decayRow;
      this.decayRow = (this.decayRow + 1) % this.heightPx;
      if (!this.rowActive[py]) continue;
      const start = py * this.widthPx * 4;
      const end = start + this.widthPx * 4;
      let any = false;
      for (let o = start; o < end; o += 4) {
        const a = this.data[o];
        const b = this.data[o + 1];
        if (a === 128 && b === 128) continue;
        // Zaokrąglanie losowe (rozproszone): średnio dokładnie × factor, a ślad i tak w końcu znika.
        this.dither = (Math.imul(this.dither, 1664525) + 1013904223) >>> 0;
        const r = this.dither / 4294967296;
        const va = (a - 128) * factor;
        const vb = (b - 128) * factor;
        const na = 128 + Math.sign(va) * Math.floor(Math.abs(va) + r);
        const nb = 128 + Math.sign(vb) * Math.floor(Math.abs(vb) + r);
        this.data[o] = na;
        this.data[o + 1] = nb;
        if (na !== 128 || nb !== 128) any = true;
      }
      if (!any) this.rowActive[py] = 0;
      this.rowDirty[py] = 1;
    }
  }

  /**
   * Wysyła do karty graficznej zmienione wiersze z pasa yMinM–yMaxM (widoczny wycinek); wiersze
   * poza nim czekają, aż staną się widoczne. Przerwy krótsze niż 32 wiersze są scalane (jedno
   * wywołanie zamiast wielu małych).
   */
  flush(yMinM = 0, yMaxM = Infinity): void {
    const r0 = Math.max(0, Math.floor(yMinM / this.metersPerPixel));
    const r1 = Math.min(this.heightPx - 1, Math.ceil(yMaxM / this.metersPerPixel));
    let start = -1;
    let last = -1;
    const send = () => {
      this.source.update(start * this.widthPx, (last + 1) * this.widthPx);
      this.rowDirty.fill(0, start, last + 1);
    };
    for (let r = r0; r <= r1; r++) {
      if (!this.rowDirty[r]) continue;
      if (start >= 0 && r - last > 32) {
        send();
        start = -1;
      }
      if (start < 0) start = r;
      last = r;
    }
    if (start >= 0) send();
  }

  /** Intensywność śladu w punkcie (0–1) – do testów i podglądu. */
  intensityAt(xM: number, yM: number): number {
    const px = Math.min(this.widthPx - 1, Math.max(0, Math.floor(xM / this.metersPerPixel)));
    const py = Math.min(this.heightPx - 1, Math.max(0, Math.floor(yM / this.metersPerPixel)));
    const o = (py * this.widthPx + px) * 4;
    return Math.hypot(this.data[o] - 128, this.data[o + 1] - 128) / 127;
  }
}

interface Tile {
  level: number;
  tx: number;
  ty: number;
  rt: RenderTexture;
  sprite: Sprite;
  /** Pokolenie danych, z którego kafel policzono (−1 – jeszcze nie policzony). */
  gen: number;
  lastUsedFrame: number;
  bornS: number;
}

/**
 * Teren w stylu A jako piramida kafli: shader terenu liczy kafel raz (przy zmianie śniegu, wycinki
 * lub obrotu mapy), a co klatkę wyświetlane są gotowe kafle. Widoczne są dwa sąsiednie poziomy
 * z płynnym przenikaniem (bez przeskoków); pod spodem zawsze cała mapa w najgrubszym poziomie.
 * Ślady (sztruks, muldy, narty) i światło tras nocą to osobne lekkie nakładki.
 */
export class TerrainRenderer {
  readonly groom: TrackBuffer;
  readonly ski: TrackBuffer;
  private readonly cells: Uint8Array;
  private readonly cellSource: BufferImageSource;
  private readonly maskCanvas: HTMLCanvasElement;
  private readonly maskSource: CanvasSource;
  private readonly bakeRoot = new Container();
  private readonly bakeMesh: Mesh<Geometry, Shader>;
  private readonly tileLayer = new Container();
  private readonly tracksMesh: Mesh<Geometry, Shader>;
  private readonly glowMesh: Mesh<Geometry, Shader>;
  private readonly tiles = new Map<string, Tile>();
  private readonly levelMpp: number[];
  private gen = 0;
  private flushTimerS = 0;
  private frame = 0;
  private rotatedBaked: boolean | null = null;
  private sunElevationDeg = 30;
  private sunAzimuthDeg = 180;
  /** Statystyka do pomiarów: kafle policzone w ostatniej klatce i łącznie. */
  stats = { bakedLastFrame: 0, bakedTotal: 0, visibleTiles: 0 };

  constructor(
    world: Container,
    private readonly renderer: Renderer,
    private readonly grid: TerrainGrid,
    private readonly style: IllustrationStyle,
    seed: number,
    forest: Float32Array | null,
    shrub: Float32Array | null,
  ) {
    const W = grid.widthM;
    const H = grid.heightM;
    const n = grid.cellCount;
    const nrm = new Uint8Array(n * 4);
    const cs = grid.cellSizeM;
    const z = grid.elevationM;
    const zf = style.reliefZFactor;
    const at = (i: number, j: number, fallback: number) => {
      const ii = Math.min(grid.widthCells - 1, Math.max(0, i));
      const jj = Math.min(grid.heightCells - 1, Math.max(0, j));
      const v = z[jj * grid.widthCells + ii];
      return Number.isNaN(v) ? fallback : v;
    };
    for (let j = 0; j < grid.heightCells; j++) {
      for (let i = 0; i < grid.widthCells; i++) {
        const k = j * grid.widthCells + i;
        const h = z[k];
        if (Number.isNaN(h)) {
          nrm.set([128, 128, 255, 0], k * 4);
          continue;
        }
        const dzdx = (at(i + 1, j, h) - at(i - 1, j, h)) / (2 * cs);
        const dzdy = (at(i, j + 1, h) - at(i, j - 1, h)) / (2 * cs);
        const nx = -dzdx * zf;
        const ny = -dzdy * zf;
        const len = Math.hypot(nx, ny, 1);
        nrm.set([Math.round(127.5 + 127.5 * (nx / len)), Math.round(127.5 + 127.5 * (ny / len)), Math.round(127.5 + 127.5 * (1 / len)), 255], k * 4);
      }
    }
    const normalSource = new BufferImageSource({ resource: nrm, width: grid.widthCells, height: grid.heightCells, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha', scaleMode: 'linear' });
    this.cells = new Uint8Array(n * 4);
    for (let k = 0; k < n; k++) {
      this.cells[k * 4] = 120;
      this.cells[k * 4 + 1] = 3 * 16;
      this.cells[k * 4 + 2] = Math.round(255 * (forest?.[k] ?? 0));
      this.cells[k * 4 + 3] = Math.round(255 * (shrub?.[k] ?? 0));
    }
    this.cellSource = new BufferImageSource({ resource: this.cells, width: grid.widthCells, height: grid.heightCells, format: 'rgba8unorm', alphaMode: 'no-premultiply-alpha', scaleMode: 'nearest' });
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = Math.ceil(W / style.maskMetersPerPixel);
    this.maskCanvas.height = Math.ceil(H / style.maskMetersPerPixel);
    const mctx = this.maskCanvas.getContext('2d')!;
    mctx.fillStyle = '#000000';
    mctx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    this.maskSource = new CanvasSource({ resource: this.maskCanvas, scaleMode: 'linear', alphaMode: 'no-premultiply-alpha' });
    this.groom = new TrackBuffer(W, H, style.maskMetersPerPixel);
    this.ski = new TrackBuffer(W, H, style.maskMetersPerPixel);

    const quad = () =>
      new Geometry({
        attributes: { aPosition: new Float32Array([0, 0, W, 0, W, H, 0, H]) },
        indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
      });
    const t = style;
    const bakeUniforms = {
      uMapSize: { value: new Float32Array([W, H]), type: 'vec2<f32>' },
      uGrid: { value: new Float32Array([grid.widthCells, grid.heightCells]), type: 'vec2<f32>' },
      uCellM: { value: cs, type: 'f32' },
      uMpp: { value: 1, type: 'f32' },
      uUp: { value: new Float32Array([0, -1]), type: 'vec2<f32>' },
      uRight: { value: new Float32Array([1, 0]), type: 'vec2<f32>' },
      uLight: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
      uShadowDir: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
      uShadowLen: { value: 0.7, type: 'f32' },
      uTint: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
      uNight: { value: 0, type: 'f32' },
      uTime: { value: 0, type: 'f32' },
      uSeed: { value: seed | 0, type: 'i32' },
      uLod: { value: new Float32Array([1, 0, 0]), type: 'vec3<f32>' },
      uHasSnow: { value: 0, type: 'f32' },
      uSurfT: { value: new Float32Array([t.surface.groomedMin, t.surface.skiedMin, t.surface.mogulsMin]), type: 'vec3<f32>' },
      uTreeA: { value: new Float32Array([t.treeIcons.spacingM, t.treeIcons.heightM, t.treeIcons.widthRatio, 2]), type: 'vec4<f32>' },
      uTreeB: { value: new Float32Array([t.trees.spacingM, t.trees.heightM, t.trees.widthRatio, 1]), type: 'vec4<f32>' },
      uShrub: { value: new Float32Array([t.shrub.spacingM, t.shrub.radius, t.shrub.iconSpacingM, t.shrub.iconRadius]), type: 'vec4<f32>' },
    };
    this.bakeMesh = new Mesh({
      geometry: quad(),
      shader: Shader.from({
        gl: { vertex: TERRAIN_VERTEX, fragment: TERRAIN_FRAGMENT, name: 'terrain-a-bake' },
        resources: { uNormals: normalSource, uCells: this.cellSource, uMask: this.maskSource, terrainUniforms: bakeUniforms },
      }),
    });
    this.bakeRoot.addChild(this.bakeMesh);
    this.tracksMesh = new Mesh({
      geometry: quad(),
      shader: Shader.from({
        gl: { vertex: TERRAIN_VERTEX, fragment: TRACKS_FRAGMENT, name: 'terrain-a-tracks' },
        resources: {
          uCells: this.cellSource,
          uGroom: this.groom.source,
          uSki: this.ski.source,
          tracksUniforms: {
            uMapSize: { value: new Float32Array([W, H]), type: 'vec2<f32>' },
            uGrid: { value: new Float32Array([grid.widthCells, grid.heightCells]), type: 'vec2<f32>' },
            uCellM: { value: cs, type: 'f32' },
            uMpp: { value: 1, type: 'f32' },
            uLight: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
            uSurfT: { value: new Float32Array([t.surface.groomedMin, t.surface.skiedMin, t.surface.mogulsMin]), type: 'vec3<f32>' },
            uCord: { value: new Float32Array([t.surface.corduroyPeriodM, t.surface.groomerWidthM]), type: 'vec2<f32>' },
          },
        },
      }),
    });
    this.tracksMesh.blendMode = 'multiply';
    this.glowMesh = new Mesh({
      geometry: quad(),
      shader: Shader.from({
        gl: { vertex: TERRAIN_VERTEX, fragment: GLOW_FRAGMENT, name: 'terrain-a-glow' },
        resources: {
          uMask: this.maskSource,
          glowUniforms: { uMapSize: { value: new Float32Array([W, H]), type: 'vec2<f32>' }, uNight: { value: 0, type: 'f32' } },
        },
      }),
    });
    this.glowMesh.blendMode = 'add';
    this.levelMpp = Array.from({ length: t.tiles.levels }, (_, i) => t.tiles.coarsestMpp / 2 ** i);
    world.addChildAt(this.glowMesh, 0);
    world.addChildAt(this.tracksMesh, 0);
    world.addChildAt(this.tileLayer, 0);
  }

  private uni(mesh: Mesh<Geometry, Shader>, group: string): Record<string, unknown> {
    return (mesh.shader!.resources[group] as { uniforms: Record<string, unknown> }).uniforms;
  }

  /** Stan śniegu z modelu (null – jeszcze nie policzony: biały śnieg wszędzie). */
  /** Śnieg z modelu: grubość [cm], stan (kod) i muldy od narciarzy (0–255, opcjonalnie). */
  setSnow(depthCm: Float32Array | null, quality: Uint8Array | null, moguls: Uint8Array | null = null): void {
    const u = this.uni(this.bakeMesh, 'terrainUniforms');
    if (!depthCm || !quality) {
      u.uHasSnow = 0;
    } else {
      for (let k = 0; k < this.grid.cellCount; k++) {
        const d = depthCm[k];
        this.cells[k * 4] = Number.isNaN(d) ? 0 : Math.min(255, Math.max(0, Math.round(d)));
        this.cells[k * 4 + 1] = Math.min(15, quality[k]) * 16 + (moguls ? Math.round((moguls[k] / 255) * 15) : 0);
      }
      this.cellSource.update();
      u.uHasSnow = 1;
    }
    this.gen++;
  }

  /** Maska przecinek (R) i tras (G) – rysowana wektorowo z układu ośrodka. */
  setLayout(layout: ResortLayout, pisteAxes: Map<string, { xM: number; yM: number; widthM: number }[]>, liftParams: LiftParams): void {
    const ctx = this.maskCanvas.getContext('2d')!;
    const s = 1 / this.style.maskMetersPerPixel;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    for (const l of layout.lifts) {
      const w = liftTypeById(liftParams, l.typeId).corridorWidthM;
      if (w <= 0) continue;
      ctx.strokeStyle = 'rgb(255,0,0)';
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(l.bottom.xM, l.bottom.yM);
      ctx.lineTo(l.top.xM, l.top.yM);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const axis of pisteAxes.values()) {
      for (let i = 0; i < axis.length - 1; i++) {
        ctx.strokeStyle = 'rgb(255,255,0)';
        ctx.lineWidth = (axis[i].widthM + axis[i + 1].widthM) / 2;
        ctx.beginPath();
        ctx.moveTo(axis[i].xM, axis[i].yM);
        ctx.lineTo(axis[i + 1].xM, axis[i + 1].yM);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    this.maskSource.update();
    this.gen++;
  }

  setSun(elevationDeg: number, azimuthDeg: number): void {
    this.sunElevationDeg = elevationDeg;
    this.sunAzimuthDeg = azimuthDeg;
  }

  /** Noc 0–1 i barwa światła (dla innych warstw – np. światła ratraków). */
  lighting() {
    return lightingForSun(this.sunElevationDeg, this.sunAzimuthDeg);
  }

  /** Poziom piramidy (indeks) dla skali kamery: najdrobniejszy poziom nie gorszy od ekranu. */
  levelFor(mpp: number): { fine: number; frac: number } {
    // Najgrubszy poziom, którego rozdzielczość nie jest gorsza od ekranu.
    let fine = this.levelMpp.length - 1;
    for (let i = 0; i < this.levelMpp.length; i++) {
      if (this.levelMpp[i] <= mpp * 1.0001) {
        fine = i;
        break;
      }
    }
    const frac = Math.min(1, Math.max(0, Math.log2(mpp / this.levelMpp[fine])));
    return { fine, frac };
  }

  private tileWorldM(level: number): number {
    return this.style.tiles.tilePx * this.levelMpp[level];
  }

  private getTile(level: number, tx: number, ty: number): Tile {
    const key = `${level}/${tx}/${ty}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      const px = this.style.tiles.tilePx;
      const rt = RenderTexture.create({ width: px, height: px, scaleMode: 'linear', antialias: false });
      const sprite = new Sprite(rt);
      const size = this.tileWorldM(level);
      sprite.position.set(tx * size, ty * size);
      sprite.width = size;
      sprite.height = size;
      sprite.visible = false;
      this.tileLayer.addChild(sprite);
      tile = { level, tx, ty, rt, sprite, gen: -1, lastUsedFrame: this.frame, bornS: 0 };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  private bake(tile: Tile, nowS: number): void {
    const m = this.levelMpp[tile.level];
    const u = this.uni(this.bakeMesh, 'terrainUniforms');
    u.uMpp = m;
    const w = lodWeights(m, this.style.lod);
    (u.uLod as Float32Array).set([w.w1, w.w2, w.w3]);
    const size = this.tileWorldM(tile.level);
    const tr = new Matrix(1 / m, 0, 0, 1 / m, -(tile.tx * size) / m, -(tile.ty * size) / m);
    this.renderer.render({ container: this.bakeRoot, target: tile.rt, clear: true, clearColor: [0, 0, 0, 0], transform: tr });
    if (tile.gen < 0) tile.bornS = nowS;
    tile.gen = this.gen;
    this.stats.bakedLastFrame++;
    this.stats.bakedTotal++;
  }

  /** Co klatkę: kafle widoczne, liczenie brakujących, nakładki, światło, ślady. */
  update(camera: Camera, timeS: number, dtS: number, snowingFactor: number): void {
    this.frame++;
    this.stats.bakedLastFrame = 0;
    const s = camera.sign;
    const bu = this.uni(this.bakeMesh, 'terrainUniforms');
    if (this.rotatedBaked !== camera.rotated) {
      this.rotatedBaked = camera.rotated;
      (bu.uUp as Float32Array).set([0, -s]);
      (bu.uRight as Float32Array).set([s, 0]);
      // Światło rzeźby z lewego górnego rogu ekranu (konwencja map); cienie drzew w prawo w dół.
      const c45 = Math.SQRT1_2;
      (bu.uLight as Float32Array).set([-s * 0.5, -s * 0.5, c45]);
      (bu.uShadowDir as Float32Array).set([s * c45, s * c45]);
      const tu = this.uni(this.tracksMesh, 'tracksUniforms');
      (tu.uLight as Float32Array).set([-s * 0.5, -s * 0.5, c45]);
      this.gen++;
    }
    const mpp = camera.metersPerPixel;
    const { fine, frac } = this.levelFor(mpp);
    const coarse = Math.max(0, fine - 1);
    // Widoczny prostokąt świata.
    const corners = [camera.screenToWorld(0, 0), camera.screenToWorld(camera.viewportWidthPx, camera.viewportHeightPx)];
    const x0 = Math.min(corners[0].xM, corners[1].xM);
    const x1 = Math.max(corners[0].xM, corners[1].xM);
    const y0 = Math.min(corners[0].yM, corners[1].yM);
    const y1 = Math.max(corners[0].yM, corners[1].yM);
    const cx = camera.centerXM;
    const cy = camera.centerYM;
    const W = this.grid.widthM;
    const H = this.grid.heightM;
    for (const t of this.tiles.values()) t.sprite.visible = false;
    const wanted: { tile: Tile; prio: number }[] = [];
    /** Zwraca true, gdy wszystkie kafle poziomu w widoku są gotowe (zakrywają to, co pod spodem). */
    const show = (level: number, alpha: number, z: number, all: boolean): boolean => {
      let complete = true;
      const size = this.tileWorldM(level);
      const ax = all ? 0 : Math.max(0, Math.floor(x0 / size));
      const bx = all ? Math.ceil(W / size) - 1 : Math.min(Math.ceil(W / size) - 1, Math.floor(x1 / size));
      const ay = all ? 0 : Math.max(0, Math.floor(y0 / size));
      const by = all ? Math.ceil(H / size) - 1 : Math.min(Math.ceil(H / size) - 1, Math.floor(y1 / size));
      for (let ty = ay; ty <= by; ty++) {
        for (let tx = ax; tx <= bx; tx++) {
          const tile = this.getTile(level, tx, ty);
          tile.lastUsedFrame = this.frame;
          if (tile.gen !== this.gen) {
            const d = Math.hypot((tx + 0.5) * size - cx, (ty + 0.5) * size - cy);
            // Najpierw grubsze poziomy (szybko zapełniają ekran), potem bliżej środka.
            wanted.push({ tile, prio: level * 1e6 + d });
          }
          if (tile.gen < 0) {
            complete = false;
            continue;
          }
          const fade = this.style.tiles.fadeInS > 0 ? Math.min(1, (timeS - tile.bornS) / this.style.tiles.fadeInS) : 1;
          if (fade < 1) complete = false;
          tile.sprite.visible = alpha > 0.001;
          tile.sprite.alpha = alpha * fade;
          tile.sprite.zIndex = z;
        }
      }
      return complete && alpha >= 0.999;
    };
    // Od najdrobniejszego: warstwy pod spodem rysujemy tylko, gdy wierzchnia nie zakrywa ekranu
    // (mniej nakładania się – szybciej).
    const fineAlpha = fine !== coarse ? 1 - smoothUnit(frac) : 1;
    const fineDone = show(fine, fineAlpha, 2, fine === 0);
    let coarseDone = fineDone;
    if (!fineDone && coarse !== fine && coarse > 0) coarseDone = show(coarse, 1, 1, false);
    if (!coarseDone && fine !== 0 && coarse !== 0) show(0, 1, 0, true);
    else if (!coarseDone && coarse === 0 && fine !== 0) show(0, 1, 1, true);
    this.tileLayer.sortableChildren = true;
    // Liczenie brakujących kafli w ramach budżetu czasu.
    wanted.sort((a, b) => a.prio - b.prio);
    const t0 = performance.now();
    // Uwaga: czas mierzony po stronie procesora (karta liczy później) – dlatego także limit liczby.
    const maxPerFrame = Math.max(1, Math.round(this.style.tiles.bakeBudgetMs / 4));
    for (const w of wanted) {
      if (this.stats.bakedLastFrame >= maxPerFrame || (performance.now() - t0 > this.style.tiles.bakeBudgetMs && this.stats.bakedLastFrame > 0)) break;
      this.bake(w.tile, timeS);
    }
    let visible = 0;
    for (const t of this.tiles.values()) if (t.sprite.visible) visible++;
    this.stats.visibleTiles = visible;
    // Pamięć: usuwamy najdawniej używane kafle.
    if (this.tiles.size > this.style.tiles.maxTiles) {
      const old = [...this.tiles.entries()].filter(([, t]) => t.lastUsedFrame < this.frame && t.level > 0).sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);
      for (const [key, t] of old.slice(0, this.tiles.size - this.style.tiles.maxTiles)) {
        t.sprite.destroy();
        t.rt.destroy(true);
        this.tiles.delete(key);
      }
    }
    // Światło pory dnia: barwa kafli; nocą świecące trasy.
    const light = lightingForSun(this.sunElevationDeg, this.sunAzimuthDeg);
    const tint = (Math.round(light.tint[0] * 255) << 16) | (Math.round(light.tint[1] * 255) << 8) | Math.round(light.tint[2] * 255);
    this.tileLayer.tint = tint;
    this.uni(this.glowMesh, 'glowUniforms').uNight = light.night;
    this.glowMesh.visible = light.night > 0.02;
    // Ślady: widoczne przy zbliżeniu.
    const tu = this.uni(this.tracksMesh, 'tracksUniforms');
    tu.uMpp = mpp;
    this.tracksMesh.visible = mpp < 2.5;
    this.tracksMesh.tint = tint;
    // Zanik śladów: połowa w tracksHalfLifeS (szybciej, gdy pada śnieg).
    const half = this.style.tracksHalfLifeS / (1 + snowingFactor * this.style.tracksSnowfallFactor);
    const rowsPerCall = Math.max(1, Math.ceil(this.groom.heightPx * Math.min(1, dtS)));
    const perPass = Math.pow(0.5, (Math.max(dtS, 1e-3) * (this.groom.heightPx / rowsPerCall)) / half);
    this.groom.decayStep(perPass, rowsPerCall);
    this.ski.decayStep(perPass, rowsPerCall);
    // Wysyłka do karty graficznej: tylko gdy ślady widać, najwyżej 10 razy na sekundę, tylko widoczny pas.
    this.flushTimerS += dtS;
    if (this.tracksMesh.visible && this.flushTimerS >= 0.1) {
      this.flushTimerS = 0;
      const a = camera.screenToWorld(0, 0);
      const b = camera.screenToWorld(camera.viewportWidthPx, camera.viewportHeightPx);
      const y0 = Math.min(a.yM, b.yM) - 20;
      const y1 = Math.max(a.yM, b.yM) + 20;
      this.groom.flush(y0, y1);
      this.ski.flush(y0, y1);
    }
  }
}

function smoothUnit(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
