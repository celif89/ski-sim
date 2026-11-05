/**
 * Interfejs na ekranie: pasek stanu na dole (współrzędne kursora, wysokość terenu, skala)
 * oraz podziałka liniowa w lewym dolnym rogu.
 */
import type { TerrainGrid } from '../sim';
import type { Camera } from './camera';
import { computeScaleBar } from './scaleBar';

const formatInt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const formatScale = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2, minimumFractionDigits: 1 });

export class Hud {
  private readonly statusPosition: HTMLElement;
  private readonly statusElevation: HTMLElement;
  private readonly statusScale: HTMLElement;
  private readonly scaleBarLine: HTMLElement;
  private readonly scaleBarLabel: HTMLElement;
  private lastText = '';

  constructor(
    parent: HTMLElement,
    private readonly scaleBarMaxWidthPx: number,
  ) {
    const status = document.createElement('div');
    status.className = 'status-bar';
    status.innerHTML = `
      <span class="status-item" data-role="position"></span>
      <span class="status-item" data-role="elevation"></span>
      <span class="status-item status-right" data-role="scale"></span>`;
    parent.appendChild(status);
    this.statusPosition = status.querySelector('[data-role="position"]')!;
    this.statusElevation = status.querySelector('[data-role="elevation"]')!;
    this.statusScale = status.querySelector('[data-role="scale"]')!;

    const scaleBar = document.createElement('div');
    scaleBar.className = 'scale-bar';
    scaleBar.innerHTML = `<div class="scale-bar-label"></div><div class="scale-bar-line"></div>`;
    parent.appendChild(scaleBar);
    this.scaleBarLabel = scaleBar.querySelector('.scale-bar-label')!;
    this.scaleBarLine = scaleBar.querySelector('.scale-bar-line')!;
  }

  update(camera: Camera, grid: TerrainGrid, cursor: { xPx: number; yPx: number } | null): void {
    let positionText = 'x: –   y: –';
    let elevationText = 'wysokość: –';
    if (cursor) {
      const { xM, yM } = camera.screenToWorld(cursor.xPx, cursor.yPx);
      if (grid.containsPointM(xM, yM)) {
        positionText = `x: ${formatInt.format(xM)} m   y: ${formatInt.format(yM)} m`;
        elevationText = `wysokość: ${formatInt.format(grid.sampleElevationM(xM, yM))} m n.p.m.`;
      } else {
        positionText = 'poza mapą';
      }
    }
    const bar = computeScaleBar(camera.metersPerPixel, this.scaleBarMaxWidthPx);
    const scaleText = `skala: ${formatScale.format(camera.metersPerPixel)} m/px`;

    const text = `${positionText}|${elevationText}|${scaleText}|${bar.widthPx}`;
    if (text === this.lastText) return; // nic się nie zmieniło – nie dotykamy strony
    this.lastText = text;
    this.statusPosition.textContent = positionText;
    this.statusElevation.textContent = elevationText;
    this.statusScale.textContent = scaleText;
    this.scaleBarLine.style.width = `${bar.widthPx.toFixed(1)}px`;
    this.scaleBarLabel.textContent = bar.label;
  }
}
