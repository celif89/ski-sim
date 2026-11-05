/**
 * Budowa ośrodka – sterowanie: narzędzia (wyciąg, trasa pędzlem, trasa po osi, baza, wybór),
 * podgląd na żywo z profilem i ostrzeżeniami, zatwierdzanie z historią (cofnij/ponów), zaznaczanie,
 * usuwanie, zapis w przeglądarce i do pliku, wycinka → nowe pokrycie dla modelu śniegu.
 */
import type { Container } from 'pixi.js';
import type { LiftAnalysis, LiftDesign, LiftParams, PointM, Tower } from '../sim/lifts';
import { analyzeLift, autoPlaceTowers, designLift, liftTypeById, sampleGroundAlong } from '../sim/lifts';
import type { AxisPoint, PisteAnalysis, PisteParams } from '../sim/pistes';
import { analyzePiste, orientDownhill } from '../sim/pistes';
import type { ClearingCost, OsmResort, RealPisteComparison, ResortAnalysis, ResortLayout } from '../sim/resort';
import { LayoutHistory, analyzeResort, applyClearing, compareRealPistes, emptyLayout, parseLayout, serializeLayout } from '../sim/resort';
import type { TerrainGrid } from '../sim/terrainGrid';
import type { BuildTool } from './buildPanel';
import { BuildPanel } from './buildPanel';
import { BuildProfile } from './buildProfile';
import type { Camera } from './camera';
import { ResortLayer } from './resortLayer';
import type { MapContextData, MapLabel } from './resortLayer';
import type { LodThresholds } from './illustration';

export interface BuildControllerOptions {
  grid: TerrainGrid;
  camera: Camera;
  world: Container;
  screenLayer: Container;
  panelParent: HTMLElement;
  profileParent: HTMLElement;
  liftParams: LiftParams;
  pisteParams: PisteParams;
  clearing: ClearingCost;
  /** Pokrycie pierwotne (z mapy), udziały 0–1. */
  forest: Float32Array | null;
  shrub: Float32Array | null;
  osm: OsmResort | null;
  storageKey: string;
  /** Oprawa graficzna: progi szczegółowości, otoczenie z OSM, etykiety, granica. */
  lod: LodThresholds;
  context: MapContextData | null;
  labels: MapLabel[];
  borderLinesLocal: number[][][];
  /** Nowe pokrycie po wycince (dla modelu śniegu). */
  onLandCover(forest: Float32Array, shrub: Float32Array): void;
  /** Zmiana układu ośrodka (do rysowania przecinek i tras). */
  onLayoutChange?(layout: ResortLayout, analysis: ResortAnalysis): void;
  /** Narzędzie budowy aktywne – kursor mapy. */
  onToolChange(tool: BuildTool): void;
}

const SELECT_RADIUS_PX = 12;

export class BuildController {
  private layout: ResortLayout;
  private analysis!: ResortAnalysis;
  private readonly history = new LayoutHistory();
  private tool: BuildTool = 'select';
  private liftTypeId: string;
  private widthM: number;
  private selection: { kind: 'lift' | 'piste' | 'base'; id: string } | null = null;
  private showNetwork = false;
  private showReality = false;
  private real: RealPisteComparison[] | null = null;
  private message = '';
  private version = 0;
  private drawVersion = 0;
  private lastMaskKey = '';
  private landCoverTimer: ReturnType<typeof setTimeout> | null = null;
  // Budowa w toku.
  private liftBottom: PointM | null = null;
  private draftLift: { design: LiftDesign; analysis: LiftAnalysis } | null = null;
  private axisPoints: AxisPoint[] = [];
  private brushing = false;
  private draftPiste: { points: AxisPoint[]; analysis: PisteAnalysis | null } | null = null;
  private lastCursorKey = '';
  private hoverPoint: PointM | null = null;
  private readonly panel: BuildPanel;
  private readonly profile: BuildProfile;
  private readonly layer: ResortLayer;

  constructor(private readonly o: BuildControllerOptions) {
    this.liftTypeId = o.liftParams.types.find((t) => t.id === 'kanapa4d')?.id ?? o.liftParams.types[0].id;
    this.widthM = o.pisteParams.defaultWidthM;
    this.layout = this.loadSaved();
    this.layer = new ResortLayer(o.world, o.screenLayer, o.grid, o.camera, o.pisteParams, o.lod, o.context, o.labels, o.borderLinesLocal);
    this.panel = new BuildPanel(o.panelParent, o.liftParams, o.pisteParams, {
      onTool: (t) => this.setTool(t),
      onLiftType: (id) => {
        this.liftTypeId = id;
        this.setTool('lift');
      },
      onWidth: (w) => {
        this.widthM = w;
        if (this.tool !== 'pisteBrush' && this.tool !== 'pisteAxis') this.setTool('pisteBrush');
        this.refreshPanel();
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onDelete: () => this.deleteSelected(),
      onExport: () => this.exportFile(),
      onImport: (f) => void this.importFile(f),
      onClearAll: () => {
        if (this.layout.lifts.length + this.layout.pistes.length + this.layout.bases.length === 0) return;
        this.commit(emptyLayout(), 'Wyczyszczono ośrodek (Cofnij przywraca).');
      },
      onToggleNetwork: () => this.toggleNetwork(),
      onToggleReality: () => this.toggleReality(),
      onSelect: (kind, id) => this.select({ kind, id }),
    });
    this.profile = new BuildProfile(o.profileParent, o.pisteParams, {
      onTowersChange: (towers, final) => this.changeTowers(towers, final),
      onAutoTowers: () => this.autoTowers(),
      onHover: (d) => this.hoverAt(d),
      onClose: () => {
        this.cancelDraft();
        this.select(null);
      },
    });
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e)) return;
      if (e.code === 'KeyZ' && !e.shiftKey) this.undo();
      else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) this.redo();
      else return;
      e.preventDefault();
    });
    this.reanalyze();
    this.notifyLandCover(true);
  }

  /** Pokrycie po wycince na start (dla modelu śniegu). */
  currentLandCover(): { forest: Float32Array; shrub: Float32Array } | null {
    if (!this.o.forest || !this.o.shrub) return null;
    return applyClearing(this.o.forest, this.o.shrub, this.analysis.clearedMask);
  }

  /** Śnieg na dachach budynków. */
  setRoofSnow(snowy: boolean): void {
    this.layer.setRoofSnow(snowy);
  }

  /** Układ ośrodka i jego analiza (dla innych warstw, np. sceny demonstracyjnej). */
  get current(): { layout: ResortLayout; analysis: ResortAnalysis } {
    return { layout: this.layout, analysis: this.analysis };
  }

  get activeTool(): BuildTool {
    return this.tool;
  }

  // ------------------------------------------------------------------ stan

  private loadSaved(): ResortLayout {
    try {
      const text = window.localStorage.getItem(this.o.storageKey);
      if (text) return parseLayout(JSON.parse(text));
    } catch (e) {
      console.warn('Nie udało się wczytać zapisanego ośrodka', e);
    }
    return emptyLayout();
  }

  private save(): void {
    try {
      window.localStorage.setItem(this.o.storageKey, serializeLayout(this.layout));
    } catch (e) {
      console.warn('Nie udało się zapisać ośrodka w przeglądarce', e);
    }
  }

  private reanalyze(): void {
    this.analysis = analyzeResort(this.layout, { grid: this.o.grid, lifts: this.o.liftParams, pistes: this.o.pisteParams, clearing: this.o.clearing, forest: this.o.forest, shrub: this.o.shrub });
    this.version++;
    this.drawVersion++;
    if (this.selection && !this.findSelected()) this.selection = null;
    this.o.onLayoutChange?.(this.layout, this.analysis);
    this.refreshPanel();
    this.refreshProfile();
  }

  /** Nowy układ z zapamiętaniem poprzedniego (cofnij). */
  private commit(next: ResortLayout, message = ''): void {
    this.history.push(this.layout);
    this.layout = next;
    this.message = message;
    this.reanalyze();
    this.save();
    this.notifyLandCover(false);
  }

  private notifyLandCover(immediate: boolean): void {
    if (!this.o.forest || !this.o.shrub) return;
    const mask = this.analysis.clearedMask;
    let key = 0;
    for (let k = 0; k < mask.length; k++) if (mask[k]) key = (key * 31 + k) | 0;
    const maskKey = String(key);
    if (maskKey === this.lastMaskKey) return;
    this.lastMaskKey = maskKey;
    if (immediate) return; // na starcie pokrycie odbiera initSnow (currentLandCover)
    if (this.landCoverTimer) clearTimeout(this.landCoverTimer);
    this.landCoverTimer = setTimeout(() => {
      const c = applyClearing(this.o.forest!, this.o.shrub!, this.analysis.clearedMask);
      this.o.onLandCover(c.forest, c.shrub);
    }, 400);
  }

  private undo(): void {
    const prev = this.history.undo(this.layout);
    if (!prev) return;
    this.layout = prev;
    this.message = 'Cofnięto.';
    this.reanalyze();
    this.save();
    this.notifyLandCover(false);
  }

  private redo(): void {
    const next = this.history.redo(this.layout);
    if (!next) return;
    this.layout = next;
    this.message = 'Ponowiono.';
    this.reanalyze();
    this.save();
    this.notifyLandCover(false);
  }

  private clone(): ResortLayout {
    return parseLayout(JSON.parse(serializeLayout(this.layout)));
  }

  private nextNumber(kind: 'lift' | 'piste'): number {
    const names = kind === 'lift' ? this.layout.lifts.map((l) => l.name.replace(/^W/, '')) : this.layout.pistes.map((p) => p.name);
    return names.reduce((m, n) => Math.max(m, Number(n) || 0), 0) + 1;
  }

  // ------------------------------------------------------------------ narzędzia

  setTool(tool: BuildTool): void {
    // Narzędzie budowy: zdejmujemy zaznaczenie, żeby panel profilu nie zasłaniał mapy.
    if (tool !== 'select') this.selection = null;
    this.cancelDraft();
    this.tool = tool;
    this.message =
      tool === 'lift'
        ? `Wyciąg: kliknij dolną stację, potem górną (${liftTypeById(this.o.liftParams, this.liftTypeId).name}).`
        : tool === 'pisteBrush'
          ? 'Trasa – pędzel: przeciągnij myszą wzdłuż trasy. Mapę przesuwasz prawym przyciskiem lub klawiszami.'
          : tool === 'pisteAxis'
            ? 'Trasa – oś: klikaj punkty osi; podwójne kliknięcie lub Enter – koniec; Backspace – cofnij punkt.'
            : tool === 'base'
              ? 'Baza: kliknij miejsce bazy (parking, wioska).'
              : '';
    this.o.onToolChange(tool);
    this.refreshPanel();
  }

  private cancelDraft(): void {
    this.liftBottom = null;
    this.draftLift = null;
    this.axisPoints = [];
    this.brushing = false;
    this.draftPiste = null;
    this.drawVersion++;
    if (!this.selection) this.profile.hide();
    else this.refreshProfile();
  }

  private toggleNetwork(): void {
    this.showNetwork = !this.showNetwork;
    this.version++;
    this.refreshPanel();
  }

  private toggleReality(): void {
    this.showReality = !this.showReality;
    if (this.showReality && !this.real && this.o.osm) {
      this.real = compareRealPistes(this.o.osm, this.o.grid, this.o.pisteParams, (e, n) => this.o.grid.puwg92ToLocal(e, n));
    }
    this.drawVersion++;
    this.refreshPanel();
  }

  private world(xPx: number, yPx: number): PointM | null {
    const p = this.o.camera.screenToWorld(xPx, yPx);
    return this.o.grid.containsPointM(p.xM, p.yM) ? p : null;
  }

  /** Kliknięcie w mapę. Zwraca true, jeśli obsłużone. */
  handleClick(xPx: number, yPx: number): boolean {
    const p = this.world(xPx, yPx);
    if (this.tool === 'select') {
      this.select(p ? this.pick(xPx, yPx, p) : null);
      return true;
    }
    if (!p) return true;
    if (this.tool === 'lift') {
      if (!this.liftBottom) {
        this.liftBottom = p;
        this.message = 'Teraz kliknij górną stację. Esc – anuluj.';
        this.refreshPanel();
        this.updateDraftLift(p);
        return true;
      }
      this.updateDraftLift(p);
      const d = this.draftLift!;
      if (!d.analysis.ok) {
        this.message = `Nie można zbudować: ${d.analysis.issues.find((i) => i.severity === 'error')?.message ?? ''}`;
        this.refreshPanel();
        return true;
      }
      const next = this.clone();
      next.lifts.push(d.design);
      next.nextId++;
      this.liftBottom = null;
      this.draftLift = null;
      this.commit(next, `Zbudowano wyciąg ${d.design.name}.`);
      this.select({ kind: 'lift', id: d.design.id });
      return true;
    }
    if (this.tool === 'pisteAxis') {
      this.axisPoints.push({ xM: p.xM, yM: p.yM, widthM: this.widthM });
      this.updateDraftPiste(this.axisPoints, p);
      return true;
    }
    if (this.tool === 'base') {
      const next = this.clone();
      const id = `B${next.nextId++}`;
      next.bases.push({ id, name: `Baza ${next.bases.length + 1}`, xM: p.xM, yM: p.yM });
      this.commit(next, 'Postawiono bazę.');
      this.select({ kind: 'base', id });
      return true;
    }
    return true;
  }

  handleDoubleClick(): void {
    if (this.tool === 'pisteAxis') this.finishAxis();
  }

  handleRightClick(): void {
    if (this.tool === 'pisteAxis' && this.axisPoints.length) {
      this.axisPoints.pop();
      this.updateDraftPiste(this.axisPoints, null);
    } else if (this.liftBottom) this.cancelDraft();
  }

  handleDragStart(xPx: number, yPx: number): boolean {
    if (this.tool !== 'pisteBrush') return false;
    const p = this.world(xPx, yPx);
    if (!p) return false;
    this.brushing = true;
    this.axisPoints = [{ xM: p.xM, yM: p.yM, widthM: this.widthM }];
    this.updateDraftPiste(this.axisPoints, null);
    return true;
  }

  handleDragMove(xPx: number, yPx: number): void {
    if (!this.brushing) return;
    const p = this.world(xPx, yPx);
    if (!p) return;
    const last = this.axisPoints[this.axisPoints.length - 1];
    if (Math.hypot(p.xM - last.xM, p.yM - last.yM) < this.o.pisteParams.brushPointSpacingM) return;
    this.axisPoints.push({ xM: p.xM, yM: p.yM, widthM: this.widthM });
    this.updateDraftPiste(this.axisPoints, null);
  }

  handleDragEnd(): void {
    if (!this.brushing) return;
    this.brushing = false;
    this.finishAxis();
  }

  /** Klawisze narzędzi budowy. Zwraca true, jeśli obsłużone. */
  handleKey(code: string): boolean {
    switch (code) {
      case 'KeyV':
        this.setTool('select');
        return true;
      case 'KeyL':
        this.setTool('lift');
        return true;
      case 'KeyT':
        this.setTool('pisteBrush');
        return true;
      case 'KeyO':
        this.setTool('pisteAxis');
        return true;
      case 'KeyB':
        this.setTool('base');
        return true;
      case 'KeyN':
        this.toggleNetwork();
        return true;
      case 'KeyR':
        this.toggleReality();
        return true;
      case 'Enter':
        if (this.tool === 'pisteAxis') this.finishAxis();
        return true;
      case 'Backspace':
        if (this.tool === 'pisteAxis' && this.axisPoints.length) {
          this.axisPoints.pop();
          this.updateDraftPiste(this.axisPoints, null);
          return true;
        }
        this.deleteSelected();
        return true;
      case 'Delete':
        this.deleteSelected();
        return true;
      case 'BracketLeft':
      case 'BracketRight': {
        const step = code === 'BracketLeft' ? -5 : 5;
        this.widthM = Math.min(this.o.pisteParams.maxWidthM, Math.max(this.o.pisteParams.minWidthM, this.widthM + step));
        this.refreshPanel();
        return true;
      }
      case 'Escape':
        if (this.liftBottom || this.axisPoints.length) this.cancelDraft();
        else if (this.selection) this.select(null);
        else this.setTool('select');
        return true;
      default:
        return false;
    }
  }

  private finishAxis(): void {
    const pts = this.axisPoints;
    this.axisPoints = [];
    this.draftPiste = null;
    this.drawVersion++;
    // Podwójne kliknięcie dodaje dwa razy ten sam punkt – usuwamy duplikaty.
    const clean = pts.filter((q, i) => i === 0 || Math.hypot(q.xM - pts[i - 1].xM, q.yM - pts[i - 1].yM) > 1);
    if (clean.length < 2) {
      this.message = 'Za mało punktów – trasa potrzebuje co najmniej dwóch.';
      this.profile.hide();
      this.refreshPanel();
      return;
    }
    const oriented = orientDownhill(this.o.grid, clean).points;
    const next = this.clone();
    const id = `T${next.nextId++}`;
    const name = String(this.nextNumber('piste'));
    const design = { id, name, points: oriented };
    const a = analyzePiste(design, { grid: this.o.grid, params: this.o.pisteParams, forest: this.o.forest, shrub: this.o.shrub, clearingCost: this.o.clearing });
    if (!a.ok) {
      this.message = `Nie można zbudować trasy: ${a.issues.find((i) => i.severity === 'error')?.message ?? ''}`;
      this.profile.hide();
      this.refreshPanel();
      return;
    }
    next.pistes.push(design);
    this.commit(next, `Zbudowano trasę ${name} (${this.o.pisteParams.classes[a.classIndex].name}).`);
    this.select({ kind: 'piste', id });
  }

  private updateDraftLift(cursor: PointM): void {
    if (!this.liftBottom) return;
    const n = this.nextNumber('lift');
    const design = designLift(this.o.grid, this.o.liftParams, `W${this.layout.nextId}`, this.liftTypeId, `W${n}`, this.liftBottom, cursor);
    const analysis = analyzeLift(design, { grid: this.o.grid, params: this.o.liftParams, forest: this.o.forest, shrub: this.o.shrub, clearingCost: this.o.clearing, otherLifts: this.layout.lifts });
    this.draftLift = { design, analysis };
    this.drawVersion++;
    this.profile.showLift(design, analysis, true);
  }

  private updateDraftPiste(points: AxisPoint[], cursor: PointM | null): void {
    const pts = cursor && this.tool === 'pisteAxis' ? [...points, { xM: cursor.xM, yM: cursor.yM, widthM: this.widthM }] : points;
    const clean = pts.filter((q, i) => i === 0 || Math.hypot(q.xM - pts[i - 1].xM, q.yM - pts[i - 1].yM) > 1);
    const analysis = clean.length >= 2 ? analyzePiste({ id: 'draft', name: '', points: clean }, { grid: this.o.grid, params: this.o.pisteParams, forest: this.o.forest, shrub: this.o.shrub, clearingCost: this.o.clearing }) : null;
    this.draftPiste = { points: pts, analysis };
    this.drawVersion++;
    if (analysis) this.profile.showPiste('', analysis, true, this.tool === 'pisteAxis' ? 'podwójne kliknięcie lub Enter – koniec' : 'puść przycisk – koniec');
  }

  // ------------------------------------------------------------------ zaznaczanie i edycja

  private pick(xPx: number, yPx: number, p: PointM): { kind: 'lift' | 'piste' | 'base'; id: string } | null {
    const cam = this.o.camera;
    for (const b of this.layout.bases) {
      const s = cam.worldToScreen(b.xM, b.yM);
      if (Math.hypot(s.xPx - xPx, s.yPx - yPx) <= SELECT_RADIUS_PX) return { kind: 'base', id: b.id };
    }
    let best: { id: string; d: number } | null = null;
    for (const l of this.layout.lifts) {
      const a = cam.worldToScreen(l.bottom.xM, l.bottom.yM);
      const b = cam.worldToScreen(l.top.xM, l.top.yM);
      const dx = b.xPx - a.xPx;
      const dy = b.yPx - a.yPx;
      const t = Math.min(1, Math.max(0, ((xPx - a.xPx) * dx + (yPx - a.yPx) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(xPx - a.xPx - t * dx, yPx - a.yPx - t * dy);
      if (d <= SELECT_RADIUS_PX && (!best || d < best.d)) best = { id: l.id, d };
    }
    if (best) return { kind: 'lift', id: best.id };
    const cell = this.o.grid.cellAt(p.xM, p.yM);
    if (cell) {
      const k = this.o.grid.index(cell.i, cell.j);
      for (const pst of [...this.layout.pistes].reverse()) if (this.analysis.pistes.get(pst.id)?.cells.includes(k)) return { kind: 'piste', id: pst.id };
    }
    return null;
  }

  private findSelected(): LiftDesign | { id: string } | null {
    const s = this.selection;
    if (!s) return null;
    if (s.kind === 'lift') return this.layout.lifts.find((l) => l.id === s.id) ?? null;
    if (s.kind === 'piste') return this.layout.pistes.find((p) => p.id === s.id) ?? null;
    return this.layout.bases.find((b) => b.id === s.id) ?? null;
  }

  private select(sel: { kind: 'lift' | 'piste' | 'base'; id: string } | null): void {
    this.selection = sel;
    this.drawVersion++;
    this.refreshProfile();
    this.refreshPanel();
  }

  private refreshProfile(): void {
    if (this.draftLift || this.draftPiste) return;
    const s = this.selection;
    if (s?.kind === 'lift') {
      const l = this.layout.lifts.find((x) => x.id === s.id);
      const a = this.analysis.lifts.get(s.id);
      if (l && a) return this.profile.showLift(l, a, false);
    }
    if (s?.kind === 'piste') {
      const p = this.layout.pistes.find((x) => x.id === s.id);
      const a = this.analysis.pistes.get(s.id);
      if (p && a) return this.profile.showPiste(p.name, a, false);
    }
    this.profile.hide();
  }

  private deleteSelected(): void {
    const s = this.selection;
    if (!s) return;
    const next = this.clone();
    if (s.kind === 'lift') next.lifts = next.lifts.filter((l) => l.id !== s.id);
    else if (s.kind === 'piste') next.pistes = next.pistes.filter((p) => p.id !== s.id);
    else next.bases = next.bases.filter((b) => b.id !== s.id);
    this.selection = null;
    this.commit(next, 'Usunięto (Cofnij przywraca).');
  }

  private towersBefore: ResortLayout | null = null;

  private changeTowers(towers: Tower[], final: boolean): void {
    const s = this.selection;
    if (s?.kind !== 'lift') return;
    if (!this.towersBefore) this.towersBefore = this.clone();
    const lift = this.layout.lifts.find((l) => l.id === s.id);
    if (!lift) return;
    lift.towers = towers.map((t) => ({ distanceM: Math.round(t.distanceM * 10) / 10, heightM: Math.round(t.heightM * 10) / 10 })).sort((a, b) => a.distanceM - b.distanceM);
    lift.manualTowers = true;
    if (!final) {
      // Podczas przeciągania – tylko ten wyciąg (szybko).
      const a = analyzeLift(lift, { grid: this.o.grid, params: this.o.liftParams, forest: this.o.forest, shrub: this.o.shrub, clearingCost: this.o.clearing, otherLifts: this.layout.lifts });
      this.analysis.lifts.set(lift.id, a);
      this.drawVersion++;
      this.profile.showLift(lift, a, false);
      return;
    }
    const before = this.towersBefore;
    this.towersBefore = null;
    this.history.push(before);
    this.message = 'Zmieniono podpory.';
    this.reanalyze();
    this.save();
  }

  private autoTowers(): void {
    const s = this.selection;
    if (s?.kind !== 'lift') return;
    const next = this.clone();
    const lift = next.lifts.find((l) => l.id === s.id);
    if (!lift) return;
    const type = liftTypeById(this.o.liftParams, lift.typeId);
    const ground = sampleGroundAlong(this.o.grid, lift.bottom, lift.top, this.o.liftParams.common.profileStepM);
    lift.towers = autoPlaceTowers(ground.map((g) => ({ ...g, elevationM: Number.isNaN(g.elevationM) ? 0 : g.elevationM })), type, this.o.liftParams.common);
    lift.manualTowers = false;
    this.commit(next, 'Podpory rozstawione automatycznie.');
  }

  private hoverAt(d: number | null): void {
    this.hoverPoint = null;
    if (d !== null) {
      const draft = this.draftLift?.design;
      const s = this.selection;
      const lift = draft ?? (s?.kind === 'lift' ? this.layout.lifts.find((l) => l.id === s.id) : undefined);
      const pisteA = this.draftPiste?.analysis ?? (s?.kind === 'piste' ? this.analysis.pistes.get(s.id) : undefined);
      if (lift) {
        const L = Math.hypot(lift.top.xM - lift.bottom.xM, lift.top.yM - lift.bottom.yM) || 1;
        this.hoverPoint = { xM: lift.bottom.xM + ((lift.top.xM - lift.bottom.xM) * d) / L, yM: lift.bottom.yM + ((lift.top.yM - lift.bottom.yM) * d) / L };
      } else if (pisteA) {
        const s2 = pisteA.axis.reduce((best, x) => (Math.abs(x.distanceM - d) < Math.abs(best.distanceM - d) ? x : best), pisteA.axis[0]);
        this.hoverPoint = { xM: s2.xM, yM: s2.yM };
      }
    }
    this.drawVersion++;
  }

  // ------------------------------------------------------------------ plik

  private exportFile(): void {
    const blob = new Blob([JSON.stringify(this.layout, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'osrodek-pilsko.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importFile(file: File): Promise<void> {
    try {
      const layout = parseLayout(JSON.parse(await file.text()));
      this.selection = null;
      this.commit(layout, `Wczytano: ${layout.lifts.length} wyciągów, ${layout.pistes.length} tras.`);
    } catch (e) {
      this.message = `Nie udało się wczytać pliku: ${e instanceof Error ? e.message : String(e)}`;
      this.refreshPanel();
    }
  }

  // ------------------------------------------------------------------ co klatkę

  private refreshPanel(): void {
    this.panel.update({
      tool: this.tool,
      liftTypeId: this.liftTypeId,
      widthM: this.widthM,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      hasSelection: this.selection !== null,
      showNetwork: this.showNetwork,
      showReality: this.showReality,
      layout: this.layout,
      analysis: this.analysis,
      selection: this.selection,
      real: this.real,
      message: this.message,
    });
  }

  update(cursor: { xPx: number; yPx: number } | null, timeS = performance.now() / 1000): void {
    // Podgląd: wyciąg do kursora, oś trasy do kursora.
    const key = cursor ? `${Math.round(cursor.xPx)}|${Math.round(cursor.yPx)}|${this.o.camera.centerXM}|${this.o.camera.centerYM}|${this.o.camera.metersPerPixel}` : '';
    if (key !== this.lastCursorKey && cursor) {
      this.lastCursorKey = key;
      const p = this.world(cursor.xPx, cursor.yPx);
      if (p && this.liftBottom) this.updateDraftLift(p);
      if (p && this.tool === 'pisteAxis' && this.axisPoints.length) this.updateDraftPiste(this.axisPoints, p);
    }
    this.layer.update({
      layout: this.layout,
      analysis: this.analysis,
      selection: this.selection,
      showNetwork: this.showNetwork,
      showReality: this.showReality,
      realLifts: this.o.osm?.lifts ?? null,
      realPistes: this.real,
      draftLift: this.draftLift,
      draftPiste: this.draftPiste,
      hoverPoint: this.hoverPoint,
      version: this.version,
      drawVersion: this.drawVersion,
      timeS,
    });
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}
