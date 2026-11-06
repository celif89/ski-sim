/**
 * Interfejs na ekranie: pasek stanu na dole (współrzędne kursora, wysokość, nachylenie,
 * ekspozycja, skala) oraz podziałka liniowa w lewym dolnym rogu.
 */
import { puwg92ToLatLon, slopePercentToDeg } from '../sim';
import { SNOW_QUALITY_CODES, SNOW_QUALITY_NAMES } from '../sim/snow';
import { GROUND_FOREST, GROUND_NAMES } from '../sim/ground';
import type { RidingParams } from '../sim/snowRiding';
import { minBaseCm, packedBaseCm } from '../sim/snowRiding';
import type { TerrainGrid } from '../sim';
import type { Camera } from './camera';
import { compassName } from './colors';
import { computeScaleBar } from './scaleBar';

const formatInt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const formatOne = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const formatScale = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2, minimumFractionDigits: 1 });
const formatDeg = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 5, minimumFractionDigits: 5 });

export interface CursorReadout {
  position: string;
  geographic: string;
  elevation: string;
  slope: string;
  aspect: string;
  snow: string;
}

/** Stan śniegu do odczytu pod kursorem. */
export interface SnowReadoutData {
  depthCm: Float32Array;
  sweMm: Float32Array;
  densityKgM3: Float32Array;
  quality: Uint8Array;
  /** Podłoże (ground.ts) i progi jazdy – baza ubita i minimum (etap 5b). */
  ground?: Uint8Array | null;
  riding?: RidingParams | null;
}

const EMPTY: CursorReadout = { position: 'kursor poza mapą', geographic: '', elevation: '', slope: '', aspect: '', snow: '' };

/** Opis terenu pod kursorem (czysta funkcja – testowana). */
export function describePoint(grid: TerrainGrid, xM: number, yM: number, flatSlopePercent: number, snow: SnowReadoutData | null = null): CursorReadout {
  if (!grid.containsPointM(xM, yM)) return EMPTY;
  const puwg = grid.localToPuwg92(xM, yM);
  let position: string;
  let geographic = '';
  if (puwg) {
    // Zapis geodezyjny: X – północ (N), Y – wschód (E).
    position = `PUWG 1992: X ${formatInt.format(puwg.northingM)}  Y ${formatInt.format(puwg.eastingM)}`;
    const ll = puwg92ToLatLon(puwg.eastingM, puwg.northingM);
    geographic = `${formatDeg.format(ll.latDeg)}° N  ${formatDeg.format(ll.lonDeg)}° E`;
  } else {
    position = `x ${formatInt.format(xM)} m  y ${formatInt.format(yM)} m`;
  }
  const h = grid.sampleElevationM(xM, yM);
  if (Number.isNaN(h)) return { position, geographic, elevation: 'poza mapą (Słowacja)', slope: '', aspect: '', snow: '' };
  const cell = grid.cellAt(xM, yM)!;
  const k = grid.index(cell.i, cell.j);
  const s = grid.slopePercent[k];
  const a = grid.aspectDeg[k];
  return {
    position,
    geographic,
    elevation: `${formatInt.format(h)} m n.p.m.`,
    slope: Number.isNaN(s) ? '' : `nachylenie ${formatInt.format(s)} % (${formatOne.format(slopePercentToDeg(s))}°)`,
    aspect:
      Number.isNaN(a) || s < flatSlopePercent
        ? 'ekspozycja: płasko'
        : `ekspozycja ${compassName(a)} (${formatInt.format(a)}°)`,
    snow: snow ? describeSnow(snow, k) : '',
  };
}

function describeSnow(snow: SnowReadoutData, k: number): string {
  const q = SNOW_QUALITY_CODES[snow.quality[k]];
  const g = snow.ground ? snow.ground[k] : -1;
  const groundText = g >= 0 ? ` · podłoże: ${GROUND_NAMES[g]}` : '';
  if (q === 'none' || !(snow.depthCm[k] > 0)) return `śnieg: brak${groundText}`;
  let base = '';
  if (snow.riding) {
    const b = packedBaseCm(snow.sweMm[k], snow.riding);
    const need = g >= 0 && g !== GROUND_FOREST ? minBaseCm(g, snow.riding) : null;
    base = ` (baza ubita ${formatInt.format(b)} cm${need !== null ? `, potrzeba ${formatInt.format(need)} cm${b < need ? ' – ZA MAŁO' : ''}` : ''})`;
  }
  return `śnieg ${formatInt.format(snow.depthCm[k])} cm${base} · SWE ${formatInt.format(snow.sweMm[k])} mm · ${formatInt.format(snow.densityKgM3[k])} kg/m³ · ${SNOW_QUALITY_NAMES[q]}${groundText}`;
}

export class Hud {
  private readonly fields: Record<keyof CursorReadout | 'scale', HTMLElement>;
  private readonly scaleBarLine: HTMLElement;
  private readonly scaleBarLabel: HTMLElement;
  private lastText = '';

  constructor(
    parent: HTMLElement,
    private readonly scaleBarMaxWidthPx: number,
    private readonly flatSlopePercent: number,
  ) {
    const status = document.createElement('div');
    status.className = 'status-bar';
    const roles = ['position', 'geographic', 'elevation', 'slope', 'aspect', 'snow', 'scale'] as const;
    status.innerHTML = roles
      .map((r) => `<span class="status-item status-${r}" data-role="${r}"></span>`)
      .join('');
    parent.appendChild(status);
    this.fields = Object.fromEntries(roles.map((r) => [r, status.querySelector(`[data-role="${r}"]`)!])) as Record<
      keyof CursorReadout | 'scale',
      HTMLElement
    >;

    const scaleBar = document.createElement('div');
    scaleBar.className = 'scale-bar';
    scaleBar.innerHTML = `<div class="scale-bar-label"></div><div class="scale-bar-line"></div>`;
    parent.appendChild(scaleBar);
    this.scaleBarLabel = scaleBar.querySelector('.scale-bar-label')!;
    this.scaleBarLine = scaleBar.querySelector('.scale-bar-line')!;
  }

  update(camera: Camera, grid: TerrainGrid, cursor: { xPx: number; yPx: number } | null, snow: SnowReadoutData | null = null): void {
    let readout = EMPTY;
    if (cursor) {
      const { xM, yM } = camera.screenToWorld(cursor.xPx, cursor.yPx);
      readout = describePoint(grid, xM, yM, this.flatSlopePercent, snow);
    }
    const bar = computeScaleBar(camera.metersPerPixel, this.scaleBarMaxWidthPx);
    const scaleText = `skala ${formatScale.format(camera.metersPerPixel)} m/px`;
    const text = `${Object.values(readout).join('|')}|${scaleText}|${bar.widthPx}`;
    if (text === this.lastText) return; // nic się nie zmieniło – nie dotykamy strony
    this.lastText = text;
    for (const key of Object.keys(readout) as (keyof CursorReadout)[]) this.fields[key].textContent = readout[key];
    this.fields.scale.textContent = scaleText;
    this.scaleBarLine.style.width = `${bar.widthPx.toFixed(1)}px`;
    this.scaleBarLabel.textContent = bar.label;
  }
}
