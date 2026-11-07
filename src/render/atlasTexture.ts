/**
 * Etap 7d: atlas postaci i maszyn w grze – obraz SVG wygenerowany przy budowaniu (data/atlas.json →
 * src/render/atlasGen.ts → moduł „virtual:sprite-atlas”) zamieniany raz na teksturę. Klatki wycinane
 * leniwie i zapamiętywane.
 */
import { Rectangle, Texture } from 'pixi.js';
import type { Texture as TextureT } from 'pixi.js';
import atlas from 'virtual:sprite-atlas';
import type { AtlasLayer, SpriteMeta } from './atlasGen';
import { frameKey } from './atlasGen';

export class SpriteAtlas {
  private base: TextureT | null = null;
  private readonly cache = new Map<string, TextureT>();
  readonly directions = atlas.directions;
  readonly lods = atlas.lods;
  /** Czas przygotowania tekstury [ms] (pomiar). */
  loadMs = 0;

  get ready(): boolean {
    return this.base !== null;
  }

  meta(id: string): SpriteMeta {
    return atlas.sprites[id];
  }

  /** Obraz SVG → płótno → tekstura (raz, w tle). */
  async load(): Promise<void> {
    const t0 = performance.now();
    const img = new Image();
    img.decoding = 'async';
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(atlas.svg)}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = atlas.width;
    canvas.height = atlas.height;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    this.base = Texture.from(canvas);
    this.base.source.scaleMode = 'linear';
    this.loadMs = performance.now() - t0;
  }

  /** Poziom szczegółowości z długości obiektu na ekranie [px]. */
  lodFor(lengthPx: number): number {
    return lengthPx < 20 ? 0 : lengthPx < 44 ? 1 : 2;
  }

  frame(id: string, layer: AtlasLayer, phase: number, dir: number, lod: number): TextureT {
    const key = frameKey(id, layer, phase, dir, lod);
    let t = this.cache.get(key);
    if (t) return t;
    const f = atlas.frames[key];
    if (!f || !this.base) return Texture.EMPTY;
    t = new Texture({ source: this.base.source, frame: new Rectangle(f[0], f[1], f[2], f[2]) });
    this.cache.set(key, t);
    return t;
  }

  /** Skala cząstki: długość obiektu w metrach świata (komórka obejmuje fit/100 długości). */
  scaleFor(id: string, lengthM: number, lod: number): number {
    const m = atlas.sprites[id];
    return (lengthM * (m.fit / 100)) / m.lodPx[lod];
  }
}
