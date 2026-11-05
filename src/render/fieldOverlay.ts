/**
 * Nakładki zmienne w czasie (nasłonecznienie, suma dobowa promieniowania, temperatura): jedna
 * wartość na komórkę siatki → tekstura o rozdzielczości siatki (400 × 450), wygładzana przez kartę
 * graficzną. Przeliczenie kolorów trwa kilka milisekund, więc można je odświeżać przy animacji dnia.
 */
import { CanvasSource, Texture } from 'pixi.js';
import type { TerrainGrid } from '../sim';
import { RADIATION_SUM_STOPS, SNOW_DEPTH_STOPS, TEMPERATURE_STOPS, TRAFFIC_STOPS, sampleColorStops } from './colors';
import type { Rgb, Stop } from './colors';

export type FieldKind = 'insolation' | 'radiationSum' | 'temperature' | 'snowDepth' | 'traffic';

export interface FieldScale {
  stops: Stop[];
  min: number;
  max: number;
}

/** Krok zaokrąglenia skali sumy dobowej [kWh/m²]. */
const RADIATION_SUM_SCALE_STEP = 0.5;

/**
 * Skala barw nakładki. Dla sumy dobowej – dopasowana do danego dnia (zimą sumy są kilka razy
 * mniejsze niż latem; przy stałej skali cała mapa byłaby jednolicie ciemna).
 */
export function fieldScale(
  kind: FieldKind,
  style: { insolationMaxWm2: number; radiationSumMaxKwhM2: number; temperatureRangeC: number; snowDepthMaxCm: number; trafficMaxPerHour?: number },
  values?: Float32Array,
): FieldScale {
  if (kind === 'insolation') return { stops: RADIATION_SUM_STOPS, min: 0, max: style.insolationMaxWm2 };
  if (kind === 'snowDepth') return { stops: SNOW_DEPTH_STOPS, min: 0, max: style.snowDepthMaxCm };
  if (kind === 'traffic') return { stops: TRAFFIC_STOPS, min: 0, max: style.trafficMaxPerHour ?? 400 };
  if (kind === 'radiationSum') {
    let max = 0;
    if (values) for (const v of values) if (v > max) max = v;
    const rounded = Math.ceil(max / RADIATION_SUM_SCALE_STEP) * RADIATION_SUM_SCALE_STEP || RADIATION_SUM_SCALE_STEP;
    return { stops: RADIATION_SUM_STOPS, min: 0, max: Math.min(style.radiationSumMaxKwhM2, rounded) };
  }
  return { stops: TEMPERATURE_STOPS, min: -style.temperatureRangeC, max: style.temperatureRangeC };
}

export class FieldOverlay {
  readonly texture: Texture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly source: CanvasSource;

  constructor(private readonly grid: TerrainGrid) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = grid.widthCells;
    this.canvas.height = grid.heightCells;
    this.ctx = this.canvas.getContext('2d')!;
    this.image = this.ctx.createImageData(grid.widthCells, grid.heightCells);
    this.source = new CanvasSource({ resource: this.canvas, scaleMode: 'linear' });
    this.texture = new Texture({ source: this.source });
  }

  /** Kolory kategorii (np. stan śniegu); kod 0 = przezroczysty. */
  updateCategorical(codes: Uint8Array, colors: [number, number, number][], transparentWhere?: (k: number) => boolean): void {
    const px = this.image.data;
    for (let k = 0; k < this.grid.cellCount; k++) {
      const o = 4 * k;
      const c = codes[k];
      if (c === 0 || (transparentWhere && transparentWhere(k))) {
        px[o + 3] = 0;
        continue;
      }
      const col = colors[c];
      px[o] = col[0];
      px[o + 1] = col[1];
      px[o + 2] = col[2];
      px[o + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.source.update();
  }

  /** Wartości z progiem: poniżej `transparentBelow` – przezroczyste (np. brak śniegu). */
  update(values: Float32Array, scale: FieldScale, transparentBelow = -Infinity): void {
    const px = this.image.data;
    const c: Rgb = [0, 0, 0];
    const span = scale.max - scale.min;
    for (let k = 0; k < this.grid.cellCount; k++) {
      const v = values[k];
      const o = 4 * k;
      if (Number.isNaN(v) || v < transparentBelow) {
        px[o + 3] = 0;
        continue;
      }
      sampleColorStops(scale.stops, (v - scale.min) / span, c);
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.source.update();
  }
}

/** Gradient CSS dla legendy. */
export function scaleGradientCss(scale: FieldScale): string {
  const c: Rgb = [0, 0, 0];
  const stops = Array.from({ length: 11 }, (_, i) => {
    sampleColorStops(scale.stops, i / 10, c);
    return `rgb(${c.map(Math.round).join(',')}) ${i * 10}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
