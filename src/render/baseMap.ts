/**
 * Mapa bazowa: barwy hipsometryczne × cieniowanie rzeźby + warstwice z opisami + granica państwa.
 * Liczona RAZ na starcie i zapisywana jako jedna tekstura – przesuwanie i zoom tylko ją przerysowują.
 */
import type { ContourLine, TerrainGrid } from '../sim';
import {
  BORDER_CSS,
  CONTOUR_LABEL_CSS,
  CONTOUR_MAJOR_CSS,
  CONTOUR_MINOR_CSS,
  OUTSIDE_COLOR,
  OUTSIDE_HATCH_COLOR,
  FOREST_COLOR,
  elevationTint,
} from './colors';
import type { Rgb } from './colors';
import type { MapStyle } from './mapStyle';

/** Kreskowanie obszaru „poza mapą”: okres i grubość kresek [m]. */
const HATCH_PERIOD_M = 40;
const HATCH_WIDTH_M = 6;
/** Grubość i wzór linii granicy [m w terenie]. */
const BORDER_WIDTH_M = 5;
const BORDER_DASH_M = [28, 12];
/** Odległość, na której mierzymy kierunek warstwicy pod opisem [m]. */
const LABEL_DIRECTION_SPAN_M = 25;
/** Wysokość napisu na obszarze poza mapą [m w terenie]. */
const OUTSIDE_LABEL_FONT_M = 40;

export interface BaseMapInput {
  grid: TerrainGrid;
  hillshade: Float32Array;
  contours: ContourLine[];
  /** Linie granicy w metrach lokalnych [[x, y], …]. */
  borderLinesLocal: number[][][];
  style: MapStyle;
  /** Udział lasu 0–1 w komórkach (null – brak danych o pokryciu). */
  forest: Float32Array | null;
}

export function createBaseMapCanvas(input: BaseMapInput): HTMLCanvasElement {
  const { grid, hillshade, style } = input;
  const mpp = style.baseMetersPerPixel;
  const widthPx = Math.round(grid.widthM / mpp);
  const heightPx = Math.round(grid.heightM / mpp);
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Przeglądarka nie udostępnia rysowania na płótnie 2D');

  // 1. Barwy hipsometryczne × cieniowanie.
  const image = ctx.createImageData(widthPx, heightPx);
  const px = image.data;
  const tint: Rgb = [0, 0, 0];
  const relief = style.tintHighM - style.tintLowM;
  const flatShade = Math.sin((style.hillshade.lightAltitudeDeg * Math.PI) / 180);
  const strength = style.hillshade.strength;
  for (let py = 0; py < heightPx; py++) {
    const yM = (py + 0.5) * mpp;
    for (let pxi = 0; pxi < widthPx; pxi++) {
      const xM = (pxi + 0.5) * mpp;
      const o = 4 * (py * widthPx + pxi);
      const h = grid.sampleElevationM(xM, yM);
      if (Number.isNaN(h)) {
        const hatch = (xM + yM) % HATCH_PERIOD_M < HATCH_WIDTH_M;
        const c = hatch ? OUTSIDE_HATCH_COLOR : OUTSIDE_COLOR;
        px[o] = c[0];
        px[o + 1] = c[1];
        px[o + 2] = c[2];
        px[o + 3] = 255;
        continue;
      }
      elevationTint((h - style.tintLowM) / relief, tint);
      if (input.forest) {
        // Las: ciemniejsza zieleń (najbliższa komórka – granica lasu ostra jak na mapie).
        const ci = Math.min(grid.widthCells - 1, (xM / grid.cellSizeM) | 0);
        const cj = Math.min(grid.heightCells - 1, (yM / grid.cellSizeM) | 0);
        const f = input.forest[cj * grid.widthCells + ci] * style.forestTintStrength;
        if (f > 0) {
          tint[0] += (FOREST_COLOR[0] - tint[0]) * f;
          tint[1] += (FOREST_COLOR[1] - tint[1]) * f;
          tint[2] += (FOREST_COLOR[2] - tint[2]) * f;
        }
      }
      const shade = grid.sampleLayer(hillshade, xM, yM);
      // 1 = teren płaski; > 1 stok oświetlony, < 1 stok w cieniu.
      const factor = 1 - strength * (1 - shade / flatShade);
      px[o] = Math.min(255, tint[0] * factor);
      px[o + 1] = Math.min(255, tint[1] * factor);
      px[o + 2] = Math.min(255, tint[2] * factor);
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Dalej rysujemy w metrach terenu.
  ctx.save();
  ctx.scale(1 / mpp, 1 / mpp);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 2. Warstwice: najpierw cienkie, potem pogrubione.
  for (const major of [false, true]) {
    ctx.strokeStyle = major ? CONTOUR_MAJOR_CSS : CONTOUR_MINOR_CSS;
    ctx.lineWidth = major ? style.contours.majorWidthM : style.contours.minorWidthM;
    ctx.beginPath();
    for (const line of input.contours) {
      if (line.major !== major) continue;
      const p = line.points;
      ctx.moveTo(p[0], p[1]);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
      if (line.closed) ctx.closePath();
    }
    ctx.stroke();
  }

  // 3. Opisy pogrubionych warstwic.
  drawContourLabels(ctx, input);

  // 4. Granica państwa.
  ctx.strokeStyle = BORDER_CSS;
  ctx.lineWidth = BORDER_WIDTH_M;
  ctx.setLineDash(BORDER_DASH_M);
  ctx.beginPath();
  for (const line of input.borderLinesLocal) {
    line.forEach(([x, y], n) => (n === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // 5. Napis na obszarze poza mapą.
  drawOutsideLabel(ctx, grid);

  ctx.restore();
  return canvas;
}

function drawContourLabels(ctx: CanvasRenderingContext2D, input: BaseMapInput): void {
  const { style } = input;
  const fontM = style.contours.labelFontSizeM;
  const minGapM = fontM * 6;
  const placed: [number, number][] = [];
  ctx.font = `600 ${fontM}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = fontM * 0.35;
  ctx.strokeStyle = 'rgba(244, 238, 222, 0.95)';
  ctx.fillStyle = CONTOUR_LABEL_CSS;

  for (const line of input.contours) {
    if (!line.major) continue;
    const p = line.points;
    const n = p.length / 2;
    // Długości narastające wzdłuż linii.
    const cum = new Float32Array(n);
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(p[2 * k] - p[2 * k - 2], p[2 * k + 1] - p[2 * k - 1]);
    const length = cum[n - 1];
    if (length < style.contours.labelMinLineLengthM) continue;
    const pointAt = (dist: number): [number, number] => {
      let k = 1;
      while (k < n - 1 && cum[k] < dist) k++;
      const seg = cum[k] - cum[k - 1] || 1;
      const t = Math.min(Math.max((dist - cum[k - 1]) / seg, 0), 1);
      return [p[2 * k - 2] + t * (p[2 * k] - p[2 * k - 2]), p[2 * k - 1] + t * (p[2 * k + 1] - p[2 * k - 1])];
    };
    const spacing = style.contours.labelSpacingM;
    const count = Math.max(1, Math.floor(length / spacing));
    const offset = (length - (count - 1) * spacing) / 2;
    for (let m = 0; m < count; m++) {
      const d = offset + m * spacing;
      const [x, y] = pointAt(d);
      if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < minGapM)) continue;
      const [x0, y0] = pointAt(Math.max(0, d - LABEL_DIRECTION_SPAN_M));
      const [x1, y1] = pointAt(Math.min(length, d + LABEL_DIRECTION_SPAN_M));
      let angle = Math.atan2(y1 - y0, x1 - x0);
      // Opis zawsze „na stojąco” (czytelny bez obracania głowy).
      if (angle > Math.PI / 2) angle -= Math.PI;
      else if (angle < -Math.PI / 2) angle += Math.PI;
      placed.push([x, y]);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      const text = String(Math.round(line.levelM));
      ctx.strokeText(text, 0, 0);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }
}

function drawOutsideLabel(ctx: CanvasRenderingContext2D, grid: TerrainGrid): void {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let j = 0; j < grid.heightCells; j++) {
    for (let i = 0; i < grid.widthCells; i++) {
      if (grid.isCellValid(i, j)) continue;
      sumX += (i + 0.5) * grid.cellSizeM;
      sumY += (j + 0.5) * grid.cellSizeM;
      count++;
    }
  }
  // Napis tylko, gdy obszar poza mapą jest wyraźny (co najmniej 2% mapy).
  if (count < grid.cellCount * 0.02) return;
  const x = sumX / count;
  const y = sumY / count;
  const fontM = OUTSIDE_LABEL_FONT_M;
  ctx.font = `600 ${fontM}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(70, 72, 80, 0.85)';
  ctx.fillText('SŁOWACJA – poza mapą', x, y);
}
