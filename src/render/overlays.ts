/**
 * Nakładki tematyczne (liczone raz, przy pierwszym włączeniu, jako tekstury):
 *  – nachylenie w kolorach tras (progi z data/slope-classes.json),
 *  – ekspozycja (stoki S ciepłe, N zimne).
 */
import { classifySlope } from '../sim';
import type { SlopeClass, TerrainGrid } from '../sim';
import { FLAT_COLOR, aspectColor, hexToRgb } from './colors';
import type { Rgb } from './colors';

export type OverlayKind = 'slope' | 'aspect' | 'insolation' | 'radiationSum' | 'temperature' | 'none';

function createCanvas(grid: TerrainGrid, mpp: number): { canvas: HTMLCanvasElement; image: ImageData; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(grid.widthM / mpp);
  canvas.height = Math.round(grid.heightM / mpp);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Przeglądarka nie udostępnia rysowania na płótnie 2D');
  return { canvas, image: ctx.createImageData(canvas.width, canvas.height), ctx };
}

export function createSlopeOverlayCanvas(grid: TerrainGrid, classes: SlopeClass[], mpp: number): HTMLCanvasElement {
  const { canvas, image, ctx } = createCanvas(grid, mpp);
  const colors = classes.map((c) => hexToRgb(c.color));
  const px = image.data;
  for (let py = 0; py < canvas.height; py++) {
    const yM = (py + 0.5) * mpp;
    for (let pxi = 0; pxi < canvas.width; pxi++) {
      const s = grid.sampleLayer(grid.slopePercent, (pxi + 0.5) * mpp, yM);
      const cls = classifySlope(s, classes);
      if (cls < 0) continue; // poza mapą – przezroczyste
      const c = colors[cls];
      const o = 4 * (py * canvas.width + pxi);
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function createAspectOverlayCanvas(grid: TerrainGrid, flatSlopePercent: number, mpp: number): HTMLCanvasElement {
  const { canvas, image, ctx } = createCanvas(grid, mpp);
  // Ekspozycji (kąta) nie wolno uśredniać wprost (359° i 1° dałyby 180°) – uśredniamy wektory.
  const cosA = new Float32Array(grid.cellCount);
  const sinA = new Float32Array(grid.cellCount);
  for (let k = 0; k < grid.cellCount; k++) {
    const a = grid.aspectDeg[k];
    if (Number.isNaN(grid.elevationM[k])) {
      cosA[k] = Number.NaN;
      sinA[k] = Number.NaN;
    } else if (Number.isNaN(a)) {
      cosA[k] = 0;
      sinA[k] = 0;
    } else {
      cosA[k] = Math.cos((a * Math.PI) / 180);
      sinA[k] = Math.sin((a * Math.PI) / 180);
    }
  }
  const color: Rgb = [0, 0, 0];
  const px = image.data;
  for (let py = 0; py < canvas.height; py++) {
    const yM = (py + 0.5) * mpp;
    for (let pxi = 0; pxi < canvas.width; pxi++) {
      const xM = (pxi + 0.5) * mpp;
      const c = grid.sampleLayer(cosA, xM, yM);
      if (Number.isNaN(c)) continue;
      const s = grid.sampleLayer(sinA, xM, yM);
      const slope = grid.sampleLayer(grid.slopePercent, xM, yM);
      const out = slope < flatSlopePercent ? FLAT_COLOR : aspectColor((Math.atan2(s, c) * 180) / Math.PI, color);
      const o = 4 * (py * canvas.width + pxi);
      px[o] = out[0];
      px[o + 1] = out[1];
      px[o + 2] = out[2];
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
