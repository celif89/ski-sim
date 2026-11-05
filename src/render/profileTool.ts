/**
 * Narzędzie „profil terenu”: klik w punkt A, klik w punkt B → przekrój terenu z nachyleniami
 * odcinków (kolory jak w nakładce nachyleń), maks. nachyleniem i różnicą wysokości.
 */
import { Container, Graphics } from 'pixi.js';
import { classifySlope, computeProfile, slopePercentToDeg } from '../sim';
import type { SlopeClass, TerrainGrid, TerrainProfile } from '../sim';
import type { Camera } from './camera';
import { niceStep, niceTicks } from './niceTicks';

const formatInt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const formatOne = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const CHART_HEIGHT_PX = 210;
const CHART_PADDING = { left: 52, right: 14, top: 22, bottom: 28 };
const LINE_WIDTH_PX = 4;
const LINE_OUTLINE_PX = 7;
const MARKER_RADIUS_PX = 7;

export class ProfileTool {
  active = false;
  private a: { xM: number; yM: number } | null = null;
  private b: { xM: number; yM: number } | null = null;
  private profile: TerrainProfile | null = null;
  private hoverDistanceM: number | null = null;
  private readonly graphics = new Graphics();
  private readonly panel: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly hoverInfo: HTMLElement;
  private readonly chart: HTMLCanvasElement;
  private lastDrawKey = '';
  private readonly classColors: number[];

  constructor(
    screenLayer: Container,
    parent: HTMLElement,
    private readonly grid: TerrainGrid,
    private readonly camera: Camera,
    private readonly slopeClasses: SlopeClass[],
    private readonly onActiveChange: (active: boolean) => void,
  ) {
    screenLayer.addChild(this.graphics);
    this.classColors = slopeClasses.map((c) => parseInt(c.color.slice(1), 16));

    this.panel = document.createElement('div');
    this.panel.className = 'profile-panel hidden';
    this.panel.innerHTML = `
      <div class="profile-header">
        <div class="profile-stats"></div>
        <button type="button" class="profile-close" title="Zamknij (Esc)">×</button>
      </div>
      <canvas class="profile-chart"></canvas>
      <div class="profile-hover"></div>`;
    parent.appendChild(this.panel);
    this.stats = this.panel.querySelector('.profile-stats')!;
    this.hoverInfo = this.panel.querySelector('.profile-hover')!;
    this.chart = this.panel.querySelector('.profile-chart')!;
    this.panel.querySelector('.profile-close')!.addEventListener('click', () => this.setActive(false));
    this.chart.addEventListener('pointermove', (e) => this.onChartHover(e));
    this.chart.addEventListener('pointerleave', () => {
      this.hoverDistanceM = null;
      this.hoverInfo.textContent = '';
      this.drawChart();
    });
    window.addEventListener('resize', () => this.drawChart());
  }

  toggle(): void {
    this.setActive(!this.active);
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.a = null;
      this.b = null;
      this.profile = null;
      this.hoverDistanceM = null;
      this.panel.classList.add('hidden');
    } else {
      this.showHint();
    }
    this.onActiveChange(active);
  }

  /** Kliknięcie w mapę (piksele ekranu). Zwraca true, jeśli narzędzie je obsłużyło. */
  handleClick(xPx: number, yPx: number): boolean {
    if (!this.active) return false;
    const p = this.camera.screenToWorld(xPx, yPx);
    if (!this.grid.containsPointM(p.xM, p.yM)) return true;
    if (!this.a || this.b) {
      this.a = p;
      this.b = null;
      this.profile = null;
      this.showHint();
    } else {
      this.b = p;
      this.profile = computeProfile(this.grid, this.a, this.b);
      this.showProfile();
    }
    return true;
  }

  /** Wywoływane co klatkę: rysuje odcinek A–B na mapie (tylko gdy coś się zmieniło). */
  update(cursor: { xPx: number; yPx: number } | null): void {
    const preview = this.active && this.a && !this.b && cursor ? this.camera.screenToWorld(cursor.xPx, cursor.yPx) : null;
    const key = [
      this.active, this.a?.xM, this.a?.yM, this.b?.xM, this.b?.yM, this.hoverDistanceM,
      preview?.xM, preview?.yM, this.camera.centerXM, this.camera.centerYM, this.camera.metersPerPixel,
      this.camera.viewportWidthPx, this.camera.viewportHeightPx,
    ].join('|');
    if (key === this.lastDrawKey) return;
    this.lastDrawKey = key;
    const g = this.graphics;
    g.clear();
    if (!this.active || !this.a) return;
    const toScreen = (x: number, y: number) => this.camera.worldToScreen(x, y);
    const a = toScreen(this.a.xM, this.a.yM);

    if (this.profile) {
      // Obrys, potem odcinki w kolorach klas nachylenia.
      const pts = this.profile.points.map((p) => toScreen(p.xM, p.yM));
      g.moveTo(pts[0].xPx, pts[0].yPx);
      for (const p of pts) g.lineTo(p.xPx, p.yPx);
      g.stroke({ width: LINE_OUTLINE_PX, color: 0xffffff, alpha: 0.9, cap: 'round', join: 'round' });
      this.profile.segments.forEach((s, n) => {
        const cls = classifySlope(s.slopePercent, this.slopeClasses);
        g.moveTo(pts[n].xPx, pts[n].yPx).lineTo(pts[n + 1].xPx, pts[n + 1].yPx);
        g.stroke({ width: LINE_WIDTH_PX, color: cls < 0 ? 0x888888 : this.classColors[cls], cap: 'round' });
      });
      const b = pts[pts.length - 1];
      this.drawMarker(g, b.xPx, b.yPx, 'B');
      if (this.hoverDistanceM !== null) {
        const t = this.hoverDistanceM / (this.profile.horizontalDistanceM || 1);
        const h = toScreen(this.a.xM + t * (this.b!.xM - this.a.xM), this.a.yM + t * (this.b!.yM - this.a.yM));
        g.circle(h.xPx, h.yPx, MARKER_RADIUS_PX - 2).fill({ color: 0xffd400 }).stroke({ width: 2, color: 0x000000 });
      }
    } else if (preview) {
      const p = toScreen(preview.xM, preview.yM);
      g.moveTo(a.xPx, a.yPx).lineTo(p.xPx, p.yPx).stroke({ width: 2, color: 0x222222, alpha: 0.8 });
    }
    this.drawMarker(g, a.xPx, a.yPx, 'A');
  }

  /** Znacznik punktu: A – zielony, B – czerwony. */
  private drawMarker(g: Graphics, x: number, y: number, label: 'A' | 'B'): void {
    g.circle(x, y, MARKER_RADIUS_PX).fill({ color: label === 'A' ? 0x1b7f3a : 0xb3261e }).stroke({ width: 2, color: 0xffffff });
  }

  private showHint(): void {
    this.panel.classList.remove('hidden');
    this.panel.classList.add('hint');
    this.stats.innerHTML = this.a
      ? '<b>Profil terenu:</b> kliknij punkt <b>B</b>.'
      : '<b>Profil terenu:</b> kliknij na mapie punkt <b>A</b>, potem punkt <b>B</b>. Esc – zamknij.';
    this.hoverInfo.textContent = '';
  }

  private showProfile(): void {
    const p = this.profile!;
    this.panel.classList.remove('hidden', 'hint');
    const dh = p.elevationDifferenceM;
    this.stats.innerHTML = `
      <span><b>Odległość pozioma:</b> ${formatInt.format(p.horizontalDistanceM)} m</span>
      <span><b>Różnica wysokości (B − A):</b> ${dh >= 0 ? '+' : '−'}${formatInt.format(Math.abs(dh))} m</span>
      <span><b>Maks. nachylenie:</b> ${formatInt.format(p.maxSlopePercent)} % (${formatOne.format(slopePercentToDeg(p.maxSlopePercent))}°)</span>
      <span><b>Średnie nachylenie:</b> ${formatInt.format(p.horizontalDistanceM > 0 ? (100 * Math.abs(dh)) / p.horizontalDistanceM : 0)} %</span>
      <span><b>Długość po terenie:</b> ${formatInt.format(p.surfaceDistanceM)} m</span>`;
    this.hoverInfo.textContent = 'Najedź na wykres, żeby zobaczyć punkt na mapie.';
    this.drawChart();
  }

  private chartGeometry() {
    const p = this.profile!;
    const widthPx = this.chart.clientWidth;
    const plotW = widthPx - CHART_PADDING.left - CHART_PADDING.right;
    const plotH = CHART_HEIGHT_PX - CHART_PADDING.top - CHART_PADDING.bottom;
    const range = Math.max(p.maxElevationM - p.minElevationM, 10);
    const pad = range * 0.08;
    const yMin = p.minElevationM - pad;
    const yMax = p.maxElevationM + pad;
    const xOf = (d: number) => CHART_PADDING.left + (d / (p.horizontalDistanceM || 1)) * plotW;
    const yOf = (h: number) => CHART_PADDING.top + (1 - (h - yMin) / (yMax - yMin)) * plotH;
    return { widthPx, plotW, plotH, yMin, yMax, xOf, yOf };
  }

  private drawChart(): void {
    if (!this.profile || this.panel.classList.contains('hidden')) return;
    const p = this.profile;
    const dpr = window.devicePixelRatio || 1;
    const { widthPx, yMin, yMax, xOf, yOf } = this.chartGeometry();
    this.chart.width = Math.round(widthPx * dpr);
    this.chart.height = Math.round(CHART_HEIGHT_PX * dpr);
    this.chart.style.height = `${CHART_HEIGHT_PX}px`;
    const ctx = this.chart.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthPx, CHART_HEIGHT_PX);
    const bottom = yOf(yMin);

    // Siatka i opisy osi.
    ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#b8bec6';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const h of niceTicks(yMin, yMax, 4)) {
      const y = yOf(h);
      ctx.beginPath();
      ctx.moveTo(CHART_PADDING.left, y);
      ctx.lineTo(widthPx - CHART_PADDING.right, y);
      ctx.stroke();
      ctx.fillText(`${formatInt.format(h)}`, CHART_PADDING.left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const stepX = niceStep(p.horizontalDistanceM, 6);
    for (let d = 0; d <= p.horizontalDistanceM + 1e-6; d += stepX) {
      const x = xOf(d);
      ctx.beginPath();
      ctx.moveTo(x, CHART_PADDING.top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillText(`${formatInt.format(d)} m`, x, bottom + 6);
    }
    ctx.textAlign = 'left';
    ctx.fillText('m n.p.m.', 4, 2);

    // Pole pod profilem, odcinkami w kolorach klas nachylenia.
    let maxSeg = -1;
    p.segments.forEach((s, n) => {
      const h0 = p.points[n].elevationM;
      const h1 = p.points[n + 1].elevationM;
      if (Number.isNaN(h0) || Number.isNaN(h1)) return;
      if (maxSeg < 0 || Math.abs(s.slopePercent) > Math.abs(p.segments[maxSeg].slopePercent)) maxSeg = n;
      const cls = classifySlope(s.slopePercent, this.slopeClasses);
      ctx.fillStyle = this.slopeClasses[cls].color;
      ctx.beginPath();
      ctx.moveTo(xOf(s.fromDistanceM), bottom);
      ctx.lineTo(xOf(s.fromDistanceM), yOf(h0));
      ctx.lineTo(xOf(s.toDistanceM), yOf(h1));
      ctx.lineTo(xOf(s.toDistanceM), bottom);
      ctx.closePath();
      ctx.fill();
    });
    // Linia terenu.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let pen = false;
    for (const pt of p.points) {
      if (Number.isNaN(pt.elevationM)) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(xOf(pt.distanceM), yOf(pt.elevationM));
      else ctx.moveTo(xOf(pt.distanceM), yOf(pt.elevationM));
      pen = true;
    }
    ctx.stroke();

    // Miejsce największego nachylenia.
    if (maxSeg >= 0) {
      const s = p.segments[maxSeg];
      const mid = (s.fromDistanceM + s.toDistanceM) / 2;
      const h = (p.points[maxSeg].elevationM + p.points[maxSeg + 1].elevationM) / 2;
      const x = xOf(mid);
      const y = yOf(h);
      ctx.fillStyle = '#ffd400';
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x - 6, y - 14);
      ctx.lineTo(x + 6, y - 14);
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = x > widthPx * 0.75 ? 'right' : 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(` maks. ${formatInt.format(Math.abs(s.slopePercent))} %`, x, y - 15);
    }

    // Punkt pod kursorem.
    if (this.hoverDistanceM !== null) {
      const x = xOf(this.hoverDistanceM);
      ctx.strokeStyle = '#ffd400';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, CHART_PADDING.top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }

    // Etykiety A i B.
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 12px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('A', xOf(0) + 3, CHART_PADDING.top);
    ctx.textAlign = 'right';
    ctx.fillText('B', xOf(p.horizontalDistanceM) - 3, CHART_PADDING.top);
  }

  private onChartHover(event: PointerEvent): void {
    if (!this.profile) return;
    const rect = this.chart.getBoundingClientRect();
    const { plotW } = this.chartGeometry();
    const t = Math.min(Math.max((event.clientX - rect.left - CHART_PADDING.left) / plotW, 0), 1);
    const p = this.profile;
    const d = t * p.horizontalDistanceM;
    this.hoverDistanceM = d;
    const n = Math.min(Math.floor(t * p.segments.length), p.segments.length - 1);
    const seg = p.segments[n];
    const h = this.grid.sampleElevationM(
      p.points[0].xM + t * (p.points[p.points.length - 1].xM - p.points[0].xM),
      p.points[0].yM + t * (p.points[p.points.length - 1].yM - p.points[0].yM),
    );
    this.hoverInfo.textContent =
      `odległość od A: ${formatInt.format(d)} m · wysokość: ${Number.isNaN(h) ? '–' : formatInt.format(h) + ' m n.p.m.'}` +
      ` · nachylenie odcinka: ${Number.isNaN(seg.slopePercent) ? '–' : `${formatInt.format(seg.slopePercent)} % (${formatOne.format(slopePercentToDeg(seg.slopePercent))}°)`}`;
    this.drawChart();
  }
}
