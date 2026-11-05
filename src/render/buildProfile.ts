/**
 * Panel profilu budowanego obiektu (na dole ekranu):
 * – wyciąg: teren pod linią, lina ze zwisem, stacje i podpory (przeciąganie: w bok – położenie,
 *   w górę/dół – wysokość; podwójne kliknięcie – nowa podpora; prawy przycisk – usunięcie),
 *   miejsca ostrzeżeń i liczby;
 * – trasa: profil podłużny kolorowany nachyleniem, najtrudniejszy odcinek 50 m, liczby.
 */
import type { BuildIssue, LiftAnalysis, LiftDesign, Tower } from '../sim/lifts';
import type { PisteAnalysis, PisteParams } from '../sim/pistes';
import { niceStep, niceTicks } from './niceTicks';

const fmt0 = (x: number) => Math.round(x).toLocaleString('pl-PL');
const fmt1 = (x: number) => x.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const money = (x: number) => (x >= 1e6 ? `${(x / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mln zł` : `${fmt0(x / 1000)} tys. zł`);
const minSec = (s: number) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;

const CHART_HEIGHT_PX = 180;
const PAD = { left: 52, right: 14, top: 22, bottom: 28 };

export function issuesHtml(issues: BuildIssue[]): string {
  if (!issues.length) return '<div class="build-ok">✓ bez zastrzeżeń</div>';
  return `<ul class="build-issues">${issues.map((i) => `<li class="${i.severity}">${i.severity === 'error' ? '✗' : '⚠'} ${i.message}</li>`).join('')}</ul>`;
}

export interface ProfileCallbacks {
  /** Zmiana podpór (final = koniec przeciągania – do historii zmian). */
  onTowersChange(towers: Tower[], final: boolean): void;
  onAutoTowers(): void;
  /** Punkt profilu pod kursorem (odległość od początku) – do zaznaczenia na mapie; null – poza wykresem. */
  onHover(distanceM: number | null): void;
  onClose(): void;
}

type Shown =
  | { kind: 'lift'; design: LiftDesign; analysis: LiftAnalysis; draft: boolean }
  | { kind: 'piste'; name: string; analysis: PisteAnalysis; draft: boolean };

export class BuildProfile {
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly issues: HTMLElement;
  private readonly chart: HTMLCanvasElement;
  private readonly actions: HTMLElement;
  private shown: Shown | null = null;
  private drag: { index: number; startX: number; startY: number; tower: Tower } | null = null;
  private hoverM: number | null = null;

  constructor(
    parent: HTMLElement,
    private readonly pisteParams: PisteParams,
    private readonly cb: ProfileCallbacks,
  ) {
    this.panel = document.createElement('div');
    this.panel.className = 'profile-panel build-profile hidden';
    this.panel.innerHTML = `
      <div class="profile-header">
        <div class="build-title"></div>
        <button type="button" class="profile-close" title="Zamknij (Esc)">×</button>
      </div>
      <div class="profile-stats"></div>
      <canvas class="profile-chart"></canvas>
      <div class="build-actions"></div>
      <div class="build-issues-box"></div>`;
    parent.appendChild(this.panel);
    this.title = this.panel.querySelector('.build-title')!;
    this.stats = this.panel.querySelector('.profile-stats')!;
    this.chart = this.panel.querySelector('.profile-chart')!;
    this.actions = this.panel.querySelector('.build-actions')!;
    this.issues = this.panel.querySelector('.build-issues-box')!;
    this.panel.querySelector('.profile-close')!.addEventListener('click', () => cb.onClose());
    this.chart.addEventListener('pointerdown', (e) => this.onDown(e));
    this.chart.addEventListener('pointermove', (e) => this.onMove(e));
    this.chart.addEventListener('pointerup', (e) => this.onUp(e));
    this.chart.addEventListener('pointerleave', () => {
      if (this.drag) return;
      this.hoverM = null;
      cb.onHover(null);
      this.draw();
    });
    this.chart.addEventListener('dblclick', (e) => this.onDouble(e));
    this.chart.addEventListener('contextmenu', (e) => this.onRight(e));
    window.addEventListener('resize', () => this.draw());
  }

  get visible(): boolean {
    return this.shown !== null;
  }

  hide(): void {
    this.shown = null;
    this.drag = null;
    this.panel.classList.add('hidden');
  }

  showLift(design: LiftDesign, a: LiftAnalysis, draft: boolean): void {
    this.shown = { kind: 'lift', design, analysis: a, draft };
    this.panel.classList.remove('hidden');
    this.panel.classList.toggle('passthrough', draft);
    const t = a.type;
    this.title.innerHTML = `<b>${draft ? 'Nowy wyciąg' : `Wyciąg ${design.name}`}</b> – ${t.name}${draft ? ' <span class="muted">· kliknij górną stację</span>' : ''}`;
    const surface = t.kind === 'surface';
    this.stats.innerHTML = [
      `<span><b>Długość:</b> ${fmt0(a.horizontalLengthM)} m poziomo, ${fmt0(a.slopeLengthM)} m po linie</span>`,
      `<span><b>Przewyższenie:</b> ${fmt0(a.riseM)} m</span>`,
      `<span><b>Przejazd:</b> ${minSec(a.rideTimeS)} (${fmt1(t.speedMs)} m/s)</span>`,
      `<span><b>Przepustowość:</b> ${fmt0(a.capacityPerHour)} os./h</span>`,
      `<span><b>Moc:</b> ${fmt0(a.powerKw)} kW</span>`,
      surface ? `<span><b>Nachylenie toru:</b> do ${fmt0(a.maxTrackSlopePercent ?? 0)} % (dop. ${fmt0(t.maxTrackSlopePercent ?? 0)} %), przechył do ${fmt0(a.maxCrossSlopePercent ?? 0)} % (dop. ${fmt0(t.maxCrossSlopePercent ?? 0)} %)</span>` : '',
      a.towerCount ? `<span><b>Podpory:</b> ${a.towerCount}, najmniejszy prześwit ${fmt1(a.minClearanceM)} m (wymagane ${fmt0(t.minClearanceM)} m)</span>` : '',
      `<span><b>Wiatr:</b> stop powyżej ${fmt0(t.windLimitMs)} m/s</span>`,
      `<span><b>Koszt:</b> ${money(a.cost.totalPln)} (stacje ${money(a.cost.stationsPln)}, linia ${money(a.cost.linePln)}, podpory ${money(a.cost.towersPln)}, wycinka ${money(a.cost.clearingPln)})</span>`,
      `<span><b>Czas budowy:</b> ${fmt0(a.buildDays)} dni</span>`,
    ].join('');
    this.actions.innerHTML = !draft && a.towerCount + 1 > 1 && t.towerMaxHeightM > 0 ? '<button type="button" class="auto-towers">Rozstaw podpory automatycznie</button> <span class="muted">Podpory: przeciągnij w bok lub w górę/dół · podwójne kliknięcie – nowa · prawy przycisk – usuń</span>' : '';
    this.actions.querySelector('.auto-towers')?.addEventListener('click', () => this.cb.onAutoTowers());
    this.issues.innerHTML = issuesHtml(a.issues);
    this.draw();
  }

  showPiste(name: string, a: PisteAnalysis, draft: boolean, hint = ''): void {
    this.shown = { kind: 'piste', name, analysis: a, draft };
    this.panel.classList.remove('hidden');
    this.panel.classList.toggle('passthrough', draft);
    const cls = this.pisteParams.classes[a.classIndex];
    this.title.innerHTML = `<b>${draft ? 'Nowa trasa' : `Trasa ${name}`}</b> – <span class="piste-class" style="background:${cls.color}">${cls.name}</span>${hint ? ` <span class="muted">· ${hint}</span>` : ''}`;
    this.stats.innerHTML = [
      `<span><b>Długość:</b> ${fmt0(a.lengthM)} m</span>`,
      `<span><b>Przewyższenie:</b> ${fmt0(a.dropM)} m</span>`,
      `<span><b>Najtrudniejsze ${fmt0(this.pisteParams.segmentLengthM)} m:</b> ${fmt0(a.maxSlopePercent)} % (na ${fmt0(a.maxSlopeAtM)} m)</span>`,
      `<span><b>Średnie nachylenie:</b> ${fmt0(a.meanSlopePercent)} %</span>`,
      `<span><b>Najstromszy krótki fragment:</b> ${fmt0(a.maxLocalSlopePercent)} %</span>`,
      `<span><b>Spadek poprzeczny:</b> do ${fmt0(a.maxCrossSlopePercent)} %</span>`,
      `<span><b>Szerokość:</b> min. ${fmt0(a.minWidthM)} m, średnio ${fmt0(a.meanWidthM)} m</span>`,
      `<span><b>Powierzchnia:</b> ${fmt1(a.areaM2 / 10_000)} ha</span>`,
      `<span><b>Koszt:</b> ${money(a.cost.totalPln)} (wycinka ${money(a.cost.clearingPln)})</span>`,
      `<span><b>Czas budowy:</b> ${fmt0(a.buildDays)} dni</span>`,
    ].join('');
    this.actions.innerHTML = '';
    this.issues.innerHTML = issuesHtml(a.issues);
    this.draw();
  }

  // ------------------------------------------------------------------ wykres

  private geometry() {
    const s = this.shown!;
    const widthPx = this.chart.clientWidth || 600;
    const plotW = widthPx - PAD.left - PAD.right;
    const plotH = CHART_HEIGHT_PX - PAD.top - PAD.bottom;
    let length = 0;
    let lo = Infinity;
    let hi = -Infinity;
    if (s.kind === 'lift') {
      length = s.analysis.horizontalLengthM;
      for (const g of s.analysis.ground) if (!Number.isNaN(g.elevationM)) [lo, hi] = [Math.min(lo, g.elevationM), Math.max(hi, g.elevationM)];
      for (const c of s.analysis.cableElevationM) hi = Math.max(hi, c);
    } else {
      length = s.analysis.lengthM;
      for (const g of s.analysis.axis) if (!Number.isNaN(g.elevationM)) [lo, hi] = [Math.min(lo, g.elevationM), Math.max(hi, g.elevationM)];
    }
    if (!Number.isFinite(lo)) [lo, hi] = [0, 10];
    const pad = Math.max(hi - lo, 10) * 0.08;
    const yMin = lo - pad;
    const yMax = hi + pad;
    const xOf = (d: number) => PAD.left + (d / (length || 1)) * plotW;
    const yOf = (h: number) => PAD.top + (1 - (h - yMin) / (yMax - yMin)) * plotH;
    const dOf = (xPx: number) => Math.min(length, Math.max(0, ((xPx - PAD.left) / plotW) * length));
    const mPerPxY = (yMax - yMin) / plotH;
    return { widthPx, length, yMin, yMax, xOf, yOf, dOf, mPerPxY };
  }

  draw(): void {
    if (!this.shown) return;
    const dpr = window.devicePixelRatio || 1;
    const geo = this.geometry();
    const { widthPx, length, yMin, yMax, xOf, yOf } = geo;
    this.chart.width = Math.round(widthPx * dpr);
    this.chart.height = Math.round(CHART_HEIGHT_PX * dpr);
    this.chart.style.height = `${CHART_HEIGHT_PX}px`;
    const ctx = this.chart.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthPx, CHART_HEIGHT_PX);
    const bottom = yOf(yMin);
    ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = '#b8bec6';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const h of niceTicks(yMin, yMax, 4)) {
      ctx.beginPath();
      ctx.moveTo(PAD.left, yOf(h));
      ctx.lineTo(widthPx - PAD.right, yOf(h));
      ctx.stroke();
      ctx.fillText(fmt0(h), PAD.left - 6, yOf(h));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const step = niceStep(Math.max(length, 1), 6);
    for (let d = 0; d <= length + 1e-6; d += step) {
      ctx.beginPath();
      ctx.moveTo(xOf(d), PAD.top);
      ctx.lineTo(xOf(d), bottom);
      ctx.stroke();
      ctx.fillText(`${fmt0(d)} m`, xOf(d), bottom + 6);
    }
    ctx.textAlign = 'left';
    ctx.fillText('m n.p.m.', 4, 2);
    const s = this.shown;
    if (s.kind === 'lift') this.drawLift(ctx, s.analysis, geo);
    else this.drawPiste(ctx, s.analysis, geo);
    if (this.hoverM !== null) {
      ctx.strokeStyle = '#ffd400';
      ctx.beginPath();
      ctx.moveTo(xOf(this.hoverM), PAD.top);
      ctx.lineTo(xOf(this.hoverM), bottom);
      ctx.stroke();
    }
  }

  private drawIssueMarkers(ctx: CanvasRenderingContext2D, issues: BuildIssue[], xOf: (d: number) => number) {
    for (const i of issues) {
      if (i.distanceM === null) continue;
      ctx.fillStyle = i.severity === 'error' ? '#ff6b6b' : '#ffd43b';
      const x = xOf(i.distanceM);
      ctx.beginPath();
      ctx.moveTo(x, PAD.top + 12);
      ctx.lineTo(x - 6, PAD.top);
      ctx.lineTo(x + 6, PAD.top);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawLift(ctx: CanvasRenderingContext2D, a: LiftAnalysis, geo: ReturnType<BuildProfile['geometry']>): void {
    const { xOf, yOf, yMin } = geo;
    const bottom = yOf(yMin);
    // Teren.
    ctx.fillStyle = 'rgba(160, 150, 120, 0.55)';
    ctx.beginPath();
    ctx.moveTo(xOf(0), bottom);
    for (const g of a.ground) ctx.lineTo(xOf(g.distanceM), yOf(Number.isNaN(g.elevationM) ? yMin : g.elevationM));
    ctx.lineTo(xOf(a.horizontalLengthM), bottom);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    a.ground.forEach((g, i) => (i ? ctx.lineTo(xOf(g.distanceM), yOf(g.elevationM)) : ctx.moveTo(xOf(g.distanceM), yOf(g.elevationM))));
    ctx.stroke();
    // Linia minimalnego prześwitu (teren + prześwit) – pomocniczo.
    if (a.type.towerMaxHeightM > 0) {
      ctx.strokeStyle = 'rgba(255, 107, 107, 0.45)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      a.ground.forEach((g, i) => (i ? ctx.lineTo(xOf(g.distanceM), yOf(g.elevationM + a.type.minClearanceM)) : ctx.moveTo(xOf(g.distanceM), yOf(g.elevationM + a.type.minClearanceM))));
      ctx.stroke();
      ctx.setLineDash([]);
      // Lina.
      ctx.strokeStyle = '#74c0fc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      a.ground.forEach((g, i) => (i ? ctx.lineTo(xOf(g.distanceM), yOf(a.cableElevationM[i])) : ctx.moveTo(xOf(g.distanceM), yOf(a.cableElevationM[i]))));
      ctx.stroke();
    }
    // Podpory i stacje.
    a.supports.forEach((sup) => {
      const x = xOf(sup.distanceM);
      ctx.strokeStyle = sup.kind === 'station' ? '#ffffff' : '#dee2e6';
      ctx.lineWidth = sup.kind === 'station' ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(x, yOf(sup.groundElevationM));
      ctx.lineTo(x, yOf(sup.cableElevationM));
      ctx.stroke();
      if (sup.kind === 'tower') {
        ctx.fillStyle = '#ffd400';
        ctx.beginPath();
        ctx.arc(x, yOf(sup.cableElevationM), 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    this.drawIssueMarkers(ctx, a.issues, xOf);
  }

  private drawPiste(ctx: CanvasRenderingContext2D, a: PisteAnalysis, geo: ReturnType<BuildProfile['geometry']>): void {
    const { xOf, yOf, yMin } = geo;
    const bottom = yOf(yMin);
    const valid = a.axis.filter((s) => !Number.isNaN(s.elevationM));
    const hAt = (d: number) => {
      for (let i = 0; i < valid.length - 1; i++) {
        if (d <= valid[i + 1].distanceM) {
          const t = (d - valid[i].distanceM) / (valid[i + 1].distanceM - valid[i].distanceM || 1);
          return valid[i].elevationM + t * (valid[i + 1].elevationM - valid[i].elevationM);
        }
      }
      return valid[valid.length - 1]?.elevationM ?? yMin;
    };
    for (const seg of a.profile) {
      ctx.fillStyle = seg.slopePercent < 0 ? '#868e96' : this.pisteParams.classes[seg.classIndex].color;
      ctx.beginPath();
      ctx.moveTo(xOf(seg.fromM), bottom);
      ctx.lineTo(xOf(seg.fromM), yOf(hAt(seg.fromM)));
      ctx.lineTo(xOf(seg.toM), yOf(hAt(seg.toM)));
      ctx.lineTo(xOf(seg.toM), bottom);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    valid.forEach((g, i) => (i ? ctx.lineTo(xOf(g.distanceM), yOf(g.elevationM)) : ctx.moveTo(xOf(g.distanceM), yOf(g.elevationM))));
    ctx.stroke();
    // Najtrudniejszy odcinek.
    const half = this.pisteParams.segmentLengthM / 2;
    const x0 = xOf(Math.max(0, a.maxSlopeAtM - half));
    const x1 = xOf(Math.min(a.lengthM, a.maxSlopeAtM + half));
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, PAD.top + 4);
    ctx.lineTo(x1, PAD.top + 4);
    ctx.stroke();
    ctx.fillStyle = '#ffd400';
    ctx.textAlign = x1 > geo.widthPx * 0.7 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`najtrudniejsze ${fmt0(this.pisteParams.segmentLengthM)} m: ${fmt0(a.maxSlopePercent)} %`, ctx.textAlign === 'left' ? x0 : x1, PAD.top + 8);
    this.drawIssueMarkers(ctx, a.issues, xOf);
  }

  // ------------------------------------------------------------------ edycja podpór

  private towerHit(xPx: number, yPx: number): number {
    const s = this.shown;
    if (!s || s.kind !== 'lift' || s.draft) return -1;
    const { xOf, yOf } = this.geometry();
    let best = -1;
    let bestD = 12;
    s.design.towers.forEach((t, i) => {
      const sup = s.analysis.supports.find((x) => x.kind === 'tower' && Math.abs(x.distanceM - t.distanceM) < 0.05);
      if (!sup) return;
      const d = Math.hypot(xPx - xOf(t.distanceM), yPx - yOf(sup.cableElevationM));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private local(e: MouseEvent) {
    const r = this.chart.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const p = this.local(e);
    const i = this.towerHit(p.x, p.y);
    if (i < 0 || this.shown?.kind !== 'lift') return;
    this.drag = { index: i, startX: p.x, startY: p.y, tower: { ...this.shown.design.towers[i] } };
    this.chart.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    const p = this.local(e);
    const geo = this.geometry();
    if (this.drag && this.shown?.kind === 'lift') {
      const t = this.drag.tower;
      const towers = this.shown.design.towers.map((x) => ({ ...x }));
      const dx = ((p.x - this.drag.startX) / (geo.widthPx - PAD.left - PAD.right)) * geo.length;
      const dy = -(p.y - this.drag.startY) * geo.mPerPxY;
      // Ruch głównie w bok – położenie; głównie w pionie – wysokość.
      if (Math.abs(p.x - this.drag.startX) >= Math.abs(p.y - this.drag.startY)) towers[this.drag.index] = { distanceM: Math.min(geo.length - 1, Math.max(1, t.distanceM + dx)), heightM: t.heightM };
      else towers[this.drag.index] = { distanceM: t.distanceM, heightM: Math.max(1, t.heightM + dy) };
      this.cb.onTowersChange(towers, false);
      return;
    }
    this.hoverM = geo.dOf(p.x);
    this.chart.style.cursor = this.towerHit(p.x, p.y) >= 0 ? 'grab' : 'crosshair';
    this.cb.onHover(this.hoverM);
    this.draw();
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag || this.shown?.kind !== 'lift') return;
    this.drag = null;
    if (this.chart.hasPointerCapture(e.pointerId)) this.chart.releasePointerCapture(e.pointerId);
    this.cb.onTowersChange(this.shown.design.towers, true);
  }

  private onDouble(e: MouseEvent): void {
    const s = this.shown;
    if (!s || s.kind !== 'lift' || s.draft || s.analysis.type.towerMaxHeightM <= 0) return;
    const d = this.geometry().dOf(this.local(e).x);
    const h = Math.min(s.analysis.type.towerMaxHeightM, Math.max(s.analysis.type.towerMinHeightM, s.analysis.type.minClearanceM + 2));
    this.cb.onTowersChange([...s.design.towers, { distanceM: d, heightM: h }].sort((a, b) => a.distanceM - b.distanceM), true);
  }

  private onRight(e: MouseEvent): void {
    e.preventDefault();
    const s = this.shown;
    if (!s || s.kind !== 'lift') return;
    const p = this.local(e);
    const i = this.towerHit(p.x, p.y);
    if (i >= 0) this.cb.onTowersChange(s.design.towers.filter((_, k) => k !== i), true);
  }
}
