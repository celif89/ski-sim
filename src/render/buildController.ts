/**
 * Budowa ośrodka – sterowanie: narzędzia (wyciąg, trasa pędzlem, trasa po osi, baza, wybór),
 * podgląd na żywo z profilem i ostrzeżeniami, zatwierdzanie z historią (cofnij/ponów), zaznaczanie,
 * usuwanie, zapis w przeglądarce i do pliku, wycinka → nowe pokrycie dla modelu śniegu.
 */
import type { Container } from 'pixi.js';
import type { LiftAnalysis, LiftDesign, LiftParams, PointM, Tower } from '../sim/lifts';
import { analyzeLift, designLift, liftPath, liftTypeById, pointAlongPath, retowerLift } from '../sim/lifts';
import type { GroundParams } from '../sim/ground';
import type { Hydrant } from '../sim/snowmaking';
import { pipelineCost, pipelineHydrants } from '../sim/snowmaking';
import type { SnowmakingParams } from '../sim/snowmakingParams';
import type { RidingParams, ThinSegment } from '../sim/snowRiding';
import { thinSegments } from '../sim/snowRiding';
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
import type { EditHandle, HandleKind, MapContextData, MapLabel } from './resortLayer';
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
  /** Podłoże terenu i progi śniegu do jazdy (etap 5b). */
  ground: GroundParams;
  riding: RidingParams;
  /** Ostrzeżenia „za mało śniegu” na otwartych trasach (po każdej zmianie śniegu lub układu). */
  onSnowWarnings?(warnings: SnowWarning[]): void;
  /** Etap 6: przed zatwierdzeniem zmiany – zwraca powód odmowy (np. brak pieniędzy) albo null. */
  beforeCommit?(next: ResortLayout, analysis: ResortAnalysis): string | null;
  /** Etap 6: typy budynków (parking, gastronomia…) do narzędzia „Budynki”. */
  buildingTypes?: { id: string; name: string; base: boolean; costPln: number }[];
  /** Etap 7: parametry naśnieżania (rurociągi, hydranty, armatki). */
  snowmaking?: SnowmakingParams | null;
}

export type SelKind = 'lift' | 'piste' | 'base' | 'pipeline' | 'gun';

export interface SnowWarning {
  pisteId: string;
  pisteName: string;
  segments: ThinSegment[];
}

const SELECT_RADIUS_PX = 12;
const HANDLE_RADIUS_PX = 10;

export class BuildController {
  private layout: ResortLayout;
  private analysis!: ResortAnalysis;
  private readonly history = new LayoutHistory();
  private tool: BuildTool = 'select';
  private liftTypeId: string;
  private widthM: number;
  private selection: { kind: SelKind; id: string } | null = null;
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
  /** Przeciąganie uchwytu (punkt osi, szerokość, stacja, załamanie). */
  private edit: { kind: HandleKind; index: number; side?: 1 | -1; id: string; before: ResortLayout; prevLift: LiftDesign | null } | null = null;
  private hoverHandle: EditHandle | null = null;
  /** Nowe trasy z wyrównaniem terenu. */
  private gradeNew = false;
  private snowSweMm: Float32Array | null = null;
  private thin = new Map<string, ThinSegment[]>();
  /** Budowy w toku: postęp 0–1 (etap 6 – plac budowy na mapie). */
  private construction = new Map<string, number>();
  private buildingTypeId = 'parking';
  /** Etap 7: rurociąg w trakcie rysowania, typ stawianej armatki, armatki pracujące teraz (chmury). */
  private pipePoints: PointM[] = [];
  private gunTypeId = 'fan';
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
      onGradeNew: (on) => {
        this.gradeNew = on;
        this.refreshPanel();
      },
      onBuildingType: (id) => {
        this.buildingTypeId = id;
        this.setTool('base');
      },
      onGunType: (id) => {
        this.gunTypeId = id;
        this.setTool('gun');
      },
    }, o.buildingTypes ?? null, o.snowmaking ? o.snowmaking.guns.map((g) => ({ id: g.id, name: g.name, costPln: g.costPln })) : null);
    this.profile = new BuildProfile(o.profileParent, o.pisteParams, {
      onTowersChange: (towers, final) => this.changeTowers(towers, final),
      onAutoTowers: () => this.autoTowers(),
      onHover: (d) => this.hoverAt(d),
      onClose: () => {
        this.cancelDraft();
        this.select(null);
      },
      onToggleClosed: () => this.toggleClosed(),
      onToggleGraded: () => this.toggleGraded(),
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
    this.analysis = analyzeResort(this.layout, { grid: this.o.grid, lifts: this.o.liftParams, pistes: this.o.pisteParams, clearing: this.o.clearing, forest: this.o.forest, shrub: this.o.shrub, ground: this.o.ground });
    this.recomputeWarnings();
    this.version++;
    this.drawVersion++;
    if (this.selection && !this.findSelected()) this.selection = null;
    this.o.onLayoutChange?.(this.layout, this.analysis);
    this.refreshPanel();
    this.refreshProfile();
  }

  get currentTool(): BuildTool {
    return this.tool;
  }

  /** Ośrodek otwarty (sezon) / zamknięty – decyduje gracz; zapisywane z układem, bez historii cofania. */
  get resortOpen(): boolean {
    return this.layout.resortOpen !== false;
  }

  setResortOpen(open: boolean): void {
    if (open === this.resortOpen) return;
    if (open) delete this.layout.resortOpen;
    else this.layout.resortOpen = false;
    this.save();
  }

  /** Wczytanie gotowego układu (np. prawdziwy ośrodek z OSM) – z możliwością cofnięcia. */
  loadLayout(next: ResortLayout, message: string): void {
    this.commit(next, message);
  }

  /** Powód odmowy zmiany (etap 6: np. brak pieniędzy w karierze) albo null. */
  private refusal(next: ResortLayout): string | null {
    if (!this.o.beforeCommit) return null;
    const a = analyzeResort(next, { grid: this.o.grid, lifts: this.o.liftParams, pistes: this.o.pisteParams, clearing: this.o.clearing, forest: this.o.forest, shrub: this.o.shrub, ground: this.o.ground });
    return this.o.beforeCommit(next, a);
  }

  /** Nowy układ z zapamiętaniem poprzedniego (cofnij). Zwraca false, gdy zmiana odrzucona. */
  private commit(next: ResortLayout, message = ''): boolean {
    const refused = this.refusal(next);
    if (refused) {
      this.message = refused;
      this.refreshPanel();
      return false;
    }
    this.history.push(this.layout);
    this.layout = next;
    this.message = message;
    this.reanalyze();
    this.save();
    this.notifyLandCover(false);
    return true;
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
    const refused = this.refusal(prev);
    if (refused) {
      this.history.redo(prev);
      this.message = refused;
      this.refreshPanel();
      return;
    }
    this.layout = prev;
    this.message = 'Cofnięto.';
    this.reanalyze();
    this.save();
    this.notifyLandCover(false);
  }

  private redo(): void {
    const next = this.history.redo(this.layout);
    if (!next) return;
    const refused = this.refusal(next);
    if (refused) {
      this.history.undo(next);
      this.message = refused;
      this.refreshPanel();
      return;
    }
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
            : tool === 'pipeline'
              ? 'Rurociąg: klikaj punkty od pompowni (albo od innego rurociągu) wzdłuż trasy; Enter lub podwójne kliknięcie – koniec. Hydranty stawiają się same co kilkadziesiąt metrów.'
              : tool === 'gun'
                ? `Armatka: kliknij hydrant (kropka na rurociągu) – ${this.o.snowmaking?.guns.find((g) => g.id === this.gunTypeId)?.name ?? ''}. Zaznaczoną armatkę śmigłową przestawisz, klikając wolny hydrant.`
                : tool === 'base'
              ? `Budynek: kliknij miejsce (${this.o.buildingTypes?.find((t) => t.id === this.buildingTypeId)?.name ?? 'baza'}).`
              : '';
    this.o.onToolChange(tool);
    this.refreshPanel();
  }

  private cancelDraft(): void {
    this.pipePoints = [];
    this.liftBottom = null;
    this.draftLift = null;
    this.axisPoints = [];
    this.brushing = false;
    this.draftPiste = null;
    this.drawVersion++;
    if (!this.selection) this.profile.hide();
    else this.refreshProfile();
  }

  get networkShown(): boolean {
    return this.showNetwork;
  }

  get realityShown(): boolean {
    return this.showReality;
  }

  toggleNetwork(): void {
    this.showNetwork = !this.showNetwork;
    this.version++;
    this.refreshPanel();
  }

  toggleReality(): void {
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
      const h = this.hitHandle(xPx, yPx);
      if (h && (h.kind === 'pisteAdd' || h.kind === 'liftAdd')) {
        this.insertAt(h);
        return true;
      }
      if (h) return true; // klik na uchwyt – bez zmiany zaznaczenia
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
    if (this.tool === 'pipeline') {
      this.pipePoints.push({ xM: p.xM, yM: p.yM });
      this.drawVersion++;
      return true;
    }
    if (this.tool === 'gun') {
      this.placeGun(xPx, yPx);
      return true;
    }
    if (this.tool === 'base') {
      const next = this.clone();
      const id = `B${next.nextId++}`;
      const types = this.o.buildingTypes ?? null;
      const t = types?.find((x) => x.id === this.buildingTypeId) ?? null;
      if (!t || t.base) {
        // Parking (baza z miejscami) albo baza bez parkingu (miejsce przyjazdu).
        const n = next.bases.length + 1;
        next.bases.push({ id, name: t ? `${t.name} ${n}` : `Baza ${n}`, xM: p.xM, yM: p.yM, ...(t ? { typeId: t.id } : {}) });
      } else {
        const n = (next.buildings ?? []).filter((b) => b.typeId === t.id).length + 1;
        (next.buildings ??= []).push({ id, typeId: t.id, name: `${t.name} ${n}`, xM: p.xM, yM: p.yM });
      }
      if (this.commit(next, t ? `Postawiono: ${t.name}.` : 'Postawiono bazę.')) this.select({ kind: 'base', id });
      return true;
    }
    return true;
  }

  handleDoubleClick(): void {
    if (this.tool === 'pipeline') this.finishPipeline();
    else if (this.tool === 'pisteAxis') this.finishAxis();
    else if (this.tool === 'select' && this.hoverHandle?.kind === 'liftBend') this.toggleBendMid(this.hoverHandle.index);
  }

  handleRightClick(): void {
    if (this.tool === 'select' && this.hoverHandle && this.removeAt(this.hoverHandle)) return;
    if (this.tool === 'pisteAxis' && this.axisPoints.length) {
      this.axisPoints.pop();
      this.updateDraftPiste(this.axisPoints, null);
    } else if (this.liftBottom) this.cancelDraft();
  }

  handleDragStart(xPx: number, yPx: number): boolean {
    if (this.tool === 'select') {
      const h = this.hitHandle(xPx, yPx);
      if (!h || h.kind === 'pisteAdd' || h.kind === 'liftAdd' || !this.selection) return false;
      const lift = this.selection.kind === 'lift' ? this.layout.lifts.find((l) => l.id === this.selection!.id) ?? null : null;
      this.edit = { kind: h.kind, index: h.index, side: h.side, id: this.selection.id, before: this.clone(), prevLift: lift ? JSON.parse(JSON.stringify(lift)) : null };
      return true;
    }
    if (this.tool !== 'pisteBrush') return false;
    const p = this.world(xPx, yPx);
    if (!p) return false;
    this.brushing = true;
    this.axisPoints = [{ xM: p.xM, yM: p.yM, widthM: this.widthM }];
    this.updateDraftPiste(this.axisPoints, null);
    return true;
  }

  handleDragMove(xPx: number, yPx: number): void {
    if (this.edit) {
      const p = this.world(xPx, yPx);
      if (p) this.applyEdit(p);
      return;
    }
    if (!this.brushing) return;
    const p = this.world(xPx, yPx);
    if (!p) return;
    const last = this.axisPoints[this.axisPoints.length - 1];
    if (Math.hypot(p.xM - last.xM, p.yM - last.yM) < this.o.pisteParams.brushPointSpacingM) return;
    this.axisPoints.push({ xM: p.xM, yM: p.yM, widthM: this.widthM });
    this.updateDraftPiste(this.axisPoints, null);
  }

  handleDragEnd(): void {
    if (this.edit) {
      const e = this.edit;
      this.edit = null;
      const refused = this.refusal(this.layout);
      if (refused) {
        this.layout = e.before;
        this.message = refused;
        this.reanalyze();
        return;
      }
      this.history.push(e.before);
      this.message = e.kind.startsWith('piste') ? 'Zmieniono trasę (Cofnij przywraca).' : 'Zmieniono wyciąg (Cofnij przywraca).';
      this.reanalyze();
      this.save();
      this.notifyLandCover(false);
      return;
    }
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
        if (this.tool === 'pipeline') this.finishPipeline();
        return true;
      case 'KeyH':
        if (!this.o.snowmaking) return false;
        this.setTool('pipeline');
        return true;
      case 'KeyJ':
        if (!this.o.snowmaking) return false;
        this.setTool('gun');
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
        if (this.hoverHandle && this.removeAt(this.hoverHandle)) return true;
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
        if (this.liftBottom || this.axisPoints.length || this.pipePoints.length) this.cancelDraft();
        else if (this.selection) this.select(null);
        else this.setTool('select');
        return true;
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------ naśnieżanie (etap 7)

  /** Hydranty wszystkich rurociągów z informacją o armatce. */
  hydrants(layout = this.layout): (Hydrant & { gunId: string | null })[] {
    const sp = this.o.snowmaking;
    if (!sp) return [];
    const out: (Hydrant & { gunId: string | null })[] = [];
    for (const pipe of layout.pipelines ?? []) {
      for (const h of pipelineHydrants(pipe, sp)) {
        const g = (layout.snowGuns ?? []).find((x) => x.pipelineId === pipe.id && x.hydrant === h.index);
        out.push({ ...h, gunId: g?.id ?? null });
      }
    }
    return out;
  }

  private finishPipeline(): void {
    const pts = this.pipePoints.filter((q, i, a) => i === 0 || Math.hypot(q.xM - a[i - 1].xM, q.yM - a[i - 1].yM) > 1);
    this.pipePoints = [];
    this.drawVersion++;
    if (pts.length < 2) {
      this.message = 'Rurociąg potrzebuje co najmniej dwóch punktów.';
      this.refreshPanel();
      return;
    }
    const next = this.clone();
    const id = `R${next.nextId++}`;
    const n = (next.pipelines ?? []).length + 1;
    (next.pipelines ??= []).push({ id, name: `Rurociąg ${n}`, points: pts });
    const c = pipelineCost(next.pipelines[next.pipelines.length - 1], this.o.snowmaking!);
    if (this.commit(next, `Rurociąg ${n}: ${Math.round(c.lengthM)} m, ${c.hydrants} hydrantów. Wykop tylko latem (V–X). Początek musi być przy pompowni albo innym rurociągu.`)) this.select({ kind: 'pipeline', id });
  }

  /** Armatka na hydrancie pod kursorem; zaznaczona armatka śmigłowa – przestawienie na wolny hydrant. */
  private placeGun(xPx: number, yPx: number): void {
    const sp = this.o.snowmaking;
    if (!sp) return;
    const cam = this.o.camera;
    let best: (Hydrant & { gunId: string | null }) | null = null;
    let bd = 14;
    for (const h of this.hydrants()) {
      const s = cam.worldToScreen(h.xM, h.yM);
      const d = Math.hypot(s.xPx - xPx, s.yPx - yPx);
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    if (!best) {
      this.message = 'Kliknij hydrant (kropka na rurociągu).';
      this.refreshPanel();
      return;
    }
    if (best.gunId) {
      this.select({ kind: 'gun', id: best.gunId });
      return;
    }
    const sel = this.selection?.kind === 'gun' ? (this.layout.snowGuns ?? []).find((g) => g.id === this.selection!.id) : undefined;
    const next = this.clone();
    if (sel) {
      const type = sp.guns.find((t) => t.id === sel.typeId);
      if (!type?.movable) {
        this.message = 'Lanca jest stała – usuń ją i postaw nową w innym miejscu.';
        this.refreshPanel();
        return;
      }
      const g = next.snowGuns!.find((x) => x.id === sel.id)!;
      g.pipelineId = best.pipelineId;
      g.hydrant = best.index;
      this.commit(next, 'Armatkę przestawiono na inny hydrant.');
      return;
    }
    const id = `A${next.nextId++}`;
    (next.snowGuns ??= []).push({ id, typeId: this.gunTypeId, pipelineId: best.pipelineId, hydrant: best.index });
    if (this.commit(next, `Postawiono: ${sp.guns.find((t) => t.id === this.gunTypeId)?.name ?? 'armatka'}.`)) this.select({ kind: 'gun', id });
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
    const design = { id, name, points: oriented, ...(this.gradeNew ? { graded: true } : {}) };
    const a = analyzePiste(design, this.pisteCtx());
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

  private pick(xPx: number, yPx: number, p: PointM): { kind: SelKind; id: string } | null {
    const cam = this.o.camera;
    for (const b of [...this.layout.bases, ...(this.layout.buildings ?? [])]) {
      const s = cam.worldToScreen(b.xM, b.yM);
      if (Math.hypot(s.xPx - xPx, s.yPx - yPx) <= SELECT_RADIUS_PX) return { kind: 'base', id: b.id };
    }
    for (const h of this.hydrants()) {
      if (!h.gunId) continue;
      const s = cam.worldToScreen(h.xM, h.yM);
      if (Math.hypot(s.xPx - xPx, s.yPx - yPx) <= SELECT_RADIUS_PX) return { kind: 'gun', id: h.gunId };
    }
    let best: { id: string; d: number } | null = null;
    for (const l of this.layout.lifts) {
      const path = liftPath(l).map((q) => cam.worldToScreen(q.xM, q.yM));
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const dx = b.xPx - a.xPx;
        const dy = b.yPx - a.yPx;
        const t = Math.min(1, Math.max(0, ((xPx - a.xPx) * dx + (yPx - a.yPx) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(xPx - a.xPx - t * dx, yPx - a.yPx - t * dy);
        if (d <= SELECT_RADIUS_PX && (!best || d < best.d)) best = { id: l.id, d };
      }
    }
    if (best) return { kind: 'lift', id: best.id };
    for (const pipe of this.layout.pipelines ?? []) {
      const path = pipe.points.map((q) => cam.worldToScreen(q.xM, q.yM));
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const dx = b.xPx - a.xPx;
        const dy = b.yPx - a.yPx;
        const t = Math.min(1, Math.max(0, ((xPx - a.xPx) * dx + (yPx - a.yPx) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(xPx - a.xPx - t * dx, yPx - a.yPx - t * dy) <= 6) return { kind: 'pipeline', id: pipe.id };
      }
    }
    const cell = this.o.grid.cellAt(p.xM, p.yM);
    if (cell) {
      const k = this.o.grid.index(cell.i, cell.j);
      for (const pst of [...this.layout.pistes].reverse()) if (this.analysis.pistes.get(pst.id)?.cells.includes(k)) return { kind: 'piste', id: pst.id };
    }
    return null;
  }

  /** Etap 6b: obiekt pod kursorem (do dymka): nazwa, status i najważniejsze dane. */
  describeAt(xPx: number, yPx: number): { title: string; lines: string[] } | null {
    const p = this.o.camera.screenToWorld(xPx, yPx);
    const hit = this.pick(xPx, yPx, p);
    if (!hit) return null;
    const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
    const building = this.construction.get(hit.id);
    const status = (closed?: boolean) => (building !== undefined ? `w budowie (${Math.round(building * 100)} %)` : closed ? 'zamknięty' : 'otwarty');
    if (hit.kind === 'lift') {
      const l = this.layout.lifts.find((x) => x.id === hit.id);
      const a = this.analysis.lifts.get(hit.id);
      if (!l) return null;
      const lines = [`status: ${status(l.closed)}`];
      if (a) lines.push(`${a.type.name} · ${f0(a.slopeLengthM)} m, przewyższenie ${f0(a.riseM)} m`, `przepustowość ${f0(a.capacityPerHour)} os./h · przejazd ${f0(a.rideTimeS / 60)} min`);
      return { title: l.name, lines };
    }
    if (hit.kind === 'piste') {
      const pst = this.layout.pistes.find((x) => x.id === hit.id);
      const a = this.analysis.pistes.get(hit.id);
      if (!pst) return null;
      const lines = [`status: ${status(pst.closed)}`];
      if (a) {
        lines.push(`${this.o.pisteParams.classes[a.classIndex]?.name ?? ''} · ${f0(a.lengthM)} m, średnio ${f0(a.meanSlopePercent)} %, maks. ${f0(a.maxSlopePercent)} %`);
        const warn = this.thinWarningRows.filter((w) => w.pisteId === hit.id);
        const seg = warn.flatMap((w) => w.segments);
        if (seg.length) lines.push(`za mało śniegu na ${seg.length} odcinkach (najcieńsza baza ${f0(Math.min(...seg.map((x) => x.baseCm)))} cm, potrzeba ${f0(Math.max(...seg.map((x) => x.neededCm)))} cm)`);
      }
      return { title: pst.name, lines };
    }
    if (hit.kind === 'base') {
      const b = [...this.layout.bases, ...(this.layout.buildings ?? [])].find((x) => x.id === hit.id);
      if (!b) return null;
      const t = this.o.buildingTypes?.find((x) => x.id === (b as { typeId?: string }).typeId);
      return { title: b.name, lines: [t ? t.name : 'baza (miejsce przyjazdu)', `status: ${building !== undefined ? `w budowie (${Math.round(building * 100)} %)` : 'gotowy'}`] };
    }
    if (hit.kind === 'pipeline') {
      const pipe = (this.layout.pipelines ?? []).find((x) => x.id === hit.id);
      if (!pipe || !this.o.snowmaking) return null;
      const n = pipelineHydrants(pipe, this.o.snowmaking).length;
      const guns = (this.layout.snowGuns ?? []).filter((g) => g.pipelineId === pipe.id).length;
      return { title: pipe.name, lines: [`rurociąg naśnieżania · ${n} hydrantów, ${guns} armatek`, `status: ${building !== undefined ? `w budowie (${Math.round(building * 100)} %)` : 'gotowy'}`] };
    }
    if (hit.kind === 'gun') {
      const g = (this.layout.snowGuns ?? []).find((x) => x.id === hit.id);
      const t = this.o.snowmaking?.guns.find((x) => x.id === g?.typeId);
      return { title: t?.name ?? 'Armatka', lines: [t ? `start od ${t.curveWetBulbC[0]} °C temp. mokrej, do ${f0(Math.max(...t.curveSnowM3h))} m³/h śniegu` : ''] };
    }
    return null;
  }

  private findSelected(): LiftDesign | { id: string } | null {
    const s = this.selection;
    if (!s) return null;
    if (s.kind === 'lift') return this.layout.lifts.find((l) => l.id === s.id) ?? null;
    if (s.kind === 'piste') return this.layout.pistes.find((p) => p.id === s.id) ?? null;
    if (s.kind === 'pipeline') return (this.layout.pipelines ?? []).find((p) => p.id === s.id) ?? null;
    if (s.kind === 'gun') return (this.layout.snowGuns ?? []).find((g) => g.id === s.id) ?? null;
    return this.layout.bases.find((b) => b.id === s.id) ?? this.layout.buildings?.find((b) => b.id === s.id) ?? null;
  }

  /** Armatki pracujące teraz (chmury śniegu): położenie, wydajność, wiatr. */
  plumes: { xM: number; yM: number; aimXM: number; aimYM: number; rateM3h: number; windFromDeg: number; windMs: number }[] = [];
  setPlumes(p: BuildController['plumes']): void {
    const key = (x: BuildController['plumes']) => x.map((q) => `${q.xM}|${q.rateM3h}|${q.windFromDeg}`).join(',');
    if (key(p) !== key(this.plumes)) {
      this.plumes = p;
      this.drawVersion++;
    }
  }

  /** Budowy w toku (etap 6): id → postęp 0–1. */
  setConstruction(progress: Map<string, number>): void {
    const key = (m: Map<string, number>) => [...m].map(([k, v]) => `${k}:${Math.round(v * 100)}`).join('|');
    if (key(progress) === key(this.construction)) return;
    this.construction = progress;
    this.drawVersion++;
  }

  /** Wymiana całego układu bez historii (wczytanie gry, nowa kariera). */
  replaceLayout(next: ResortLayout, message: string): void {
    this.history.clear();
    this.layout = next;
    this.selection = null;
    this.message = message;
    this.reanalyze();
    this.save();
    this.notifyLandCover(false);
  }

  private select(sel: { kind: SelKind; id: string } | null): void {
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
      if (l && a) return this.profile.showLift(l, a, false, { closed: l.closed === true, noDescent: !this.analysis.network.edges.some((e) => e.kind === 'piste' && !this.layout.pistes.find((x) => x.id === e.objectId)?.closed && (e.from === `${l.id}:góra` || e.from.startsWith(`${l.id}:pośr`))) });
    }
    if (s?.kind === 'piste') {
      const p = this.layout.pistes.find((x) => x.id === s.id);
      const a = this.analysis.pistes.get(s.id);
      if (p && a) return this.profile.showPiste(p.name, a, false, '', { closed: p.closed === true, graded: p.graded === true, thin: this.thin.get(p.id) ?? [] });
    }
    this.profile.hide();
  }

  private deleteSelected(): void {
    const s = this.selection;
    if (!s) return;
    const next = this.clone();
    if (s.kind === 'lift') next.lifts = next.lifts.filter((l) => l.id !== s.id);
    else if (s.kind === 'piste') next.pistes = next.pistes.filter((p) => p.id !== s.id);
    else if (s.kind === 'pipeline') {
      next.pipelines = (next.pipelines ?? []).filter((p) => p.id !== s.id);
      next.snowGuns = (next.snowGuns ?? []).filter((g) => g.pipelineId !== s.id);
    } else if (s.kind === 'gun') next.snowGuns = (next.snowGuns ?? []).filter((g) => g.id !== s.id);
    else {
      next.bases = next.bases.filter((b) => b.id !== s.id);
      if (next.buildings) next.buildings = next.buildings.filter((b) => b.id !== s.id);
    }
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
    lift.manualTowers = false;
    lift.towers = retowerLift(this.o.grid, this.o.liftParams, lift, null);
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
        this.hoverPoint = pointAlongPath(liftPath(lift), d);
      } else if (pisteA) {
        const s2 = pisteA.axis.reduce((best, x) => (Math.abs(x.distanceM - d) < Math.abs(best.distanceM - d) ? x : best), pisteA.axis[0]);
        this.hoverPoint = { xM: s2.xM, yM: s2.yM };
      }
    }
    this.drawVersion++;
  }

  // ------------------------------------------------------------------ edycja geometrii (etap 5b)

  private pisteCtx() {
    return {
      grid: this.o.grid,
      params: this.o.pisteParams,
      forest: this.o.forest,
      shrub: this.o.shrub,
      clearingCost: this.o.clearing,
      baseGround: this.analysis?.baseGround ?? null,
      leveling: { costPlnPerM2: this.o.ground.levelingCostPlnPerM2, daysPerHectare: this.o.ground.levelingDaysPerHectare },
    };
  }

  /** Uchwyty zaznaczonej trasy (punkty osi, „+” na odcinkach, szerokość) lub wyciągu (stacje, załamania, „+”). */
  private handles(): EditHandle[] {
    const s = this.selection;
    if (!s || this.tool !== 'select' || this.draftLift || this.draftPiste) return [];
    const out: EditHandle[] = [];
    const hov = this.hoverHandle;
    const isHover = (kind: HandleKind, index: number, side?: 1 | -1) => !!hov && hov.kind === kind && hov.index === index && hov.side === side;
    if (s.kind === 'piste') {
      const p = this.layout.pistes.find((x) => x.id === s.id);
      if (!p) return [];
      const pts = p.points;
      pts.forEach((q, i) => {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b.xM - a.xM;
        const dy = b.yM - a.yM;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        for (const side of [1, -1] as const) out.push({ kind: 'pisteWidth', index: i, side, xM: q.xM + nx * side * (q.widthM / 2), yM: q.yM + ny * side * (q.widthM / 2), hover: isHover('pisteWidth', i, side) });
        if (i < pts.length - 1) out.push({ kind: 'pisteAdd', index: i, xM: (q.xM + pts[i + 1].xM) / 2, yM: (q.yM + pts[i + 1].yM) / 2, hover: isHover('pisteAdd', i) });
      });
      pts.forEach((q, i) => out.push({ kind: 'pistePoint', index: i, xM: q.xM, yM: q.yM, hover: isHover('pistePoint', i) }));
    } else if (s.kind === 'lift') {
      const l = this.layout.lifts.find((x) => x.id === s.id);
      if (!l) return [];
      const path = liftPath(l);
      for (let i = 0; i < path.length - 1; i++) out.push({ kind: 'liftAdd', index: i, xM: (path[i].xM + path[i + 1].xM) / 2, yM: (path[i].yM + path[i + 1].yM) / 2, hover: isHover('liftAdd', i) });
      (l.bends ?? []).forEach((b, i) => out.push({ kind: 'liftBend', index: i, xM: b.xM, yM: b.yM, hover: isHover('liftBend', i), mid: b.mid === true }));
      out.push({ kind: 'liftBottom', index: 0, xM: l.bottom.xM, yM: l.bottom.yM, hover: isHover('liftBottom', 0) });
      out.push({ kind: 'liftTop', index: 0, xM: l.top.xM, yM: l.top.yM, hover: isHover('liftTop', 0) });
    }
    return out;
  }

  /** Czy pod kursorem jest uchwyt edycji (ma pierwszeństwo przed kliknięciem gościa). */
  hasHandleAt(xPx: number, yPx: number): boolean {
    return this.tool === 'select' && this.hitHandle(xPx, yPx) !== null;
  }

  /** Uchwyt pod kursorem (najpierw punkty i stacje, potem szerokość, na końcu „+”). */
  private hitHandle(xPx: number, yPx: number): EditHandle | null {
    const cam = this.o.camera;
    let best: EditHandle | null = null;
    let bestScore = Infinity;
    const rank: Record<HandleKind, number> = { pistePoint: 0, liftBottom: 0, liftTop: 0, liftBend: 0, pisteWidth: 1, pisteAdd: 2, liftAdd: 2 };
    for (const h of this.handles()) {
      const p = cam.worldToScreen(h.xM, h.yM);
      const d = Math.hypot(p.xPx - xPx, p.yPx - yPx);
      if (d > HANDLE_RADIUS_PX) continue;
      const score = rank[h.kind] * 100 + d;
      if (score < bestScore) {
        bestScore = score;
        best = h;
      }
    }
    return best;
  }

  /** Przeciąganie: zmiana tylko jednego obiektu i jego analizy (szybko) – reszta po puszczeniu. */
  private applyEdit(p: PointM): void {
    const e = this.edit!;
    if (e.kind.startsWith('piste')) {
      const piste = this.layout.pistes.find((x) => x.id === e.id);
      if (!piste) return;
      const q = piste.points[e.index];
      if (e.kind === 'pistePoint') piste.points[e.index] = { xM: p.xM, yM: p.yM, widthM: q.widthM };
      else if (e.kind === 'pisteWidth') {
        const pts = piste.points;
        const a = pts[Math.max(0, e.index - 1)];
        const b = pts[Math.min(pts.length - 1, e.index + 1)];
        const len = Math.hypot(b.xM - a.xM, b.yM - a.yM) || 1;
        const nx = -(b.yM - a.yM) / len;
        const ny = (b.xM - a.xM) / len;
        const half = Math.abs((p.xM - q.xM) * nx + (p.yM - q.yM) * ny);
        const w = Math.round(Math.min(this.o.pisteParams.maxWidthM, Math.max(this.o.pisteParams.minWidthM, 2 * half)));
        piste.points[e.index] = { ...q, widthM: w };
      }
      this.analysis.pistes.set(piste.id, analyzePiste(piste, this.pisteCtx()));
    } else {
      const lift = this.layout.lifts.find((x) => x.id === e.id);
      if (!lift) return;
      if (e.kind === 'liftBottom') lift.bottom = { xM: p.xM, yM: p.yM };
      else if (e.kind === 'liftTop') lift.top = { xM: p.xM, yM: p.yM };
      else if (e.kind === 'liftBend' && lift.bends) lift.bends[e.index] = { ...lift.bends[e.index], xM: p.xM, yM: p.yM };
      lift.towers = retowerLift(this.o.grid, this.o.liftParams, lift, e.prevLift);
      this.analysis.lifts.set(lift.id, analyzeLift(lift, { grid: this.o.grid, params: this.o.liftParams, forest: this.o.forest, shrub: this.o.shrub, clearingCost: this.o.clearing, otherLifts: this.layout.lifts }));
    }
    this.drawVersion++;
    this.refreshProfile();
  }

  /** Nowy punkt osi trasy albo nowe załamanie wyciągu w środku odcinka. */
  private insertAt(h: EditHandle): void {
    const s = this.selection;
    if (!s) return;
    const next = this.clone();
    if (h.kind === 'pisteAdd' && s.kind === 'piste') {
      const p = next.pistes.find((x) => x.id === s.id);
      if (!p) return;
      const a = p.points[h.index];
      const b = p.points[h.index + 1];
      p.points.splice(h.index + 1, 0, { xM: (a.xM + b.xM) / 2, yM: (a.yM + b.yM) / 2, widthM: Math.round((a.widthM + b.widthM) / 2) });
      this.commit(next, 'Dodano punkt osi trasy – przeciągnij go myszą.');
    } else if (h.kind === 'liftAdd' && s.kind === 'lift') {
      const l = next.lifts.find((x) => x.id === s.id);
      const prev = this.layout.lifts.find((x) => x.id === s.id) ?? null;
      if (!l) return;
      const bends = [...(l.bends ?? [])];
      bends.splice(h.index, 0, { xM: h.xM, yM: h.yM });
      l.bends = bends;
      l.towers = retowerLift(this.o.grid, this.o.liftParams, l, prev);
      const type = liftTypeById(this.o.liftParams, l.typeId);
      this.commit(next, type.kind === 'aerial' ? 'Dodano stację kątową – przeciągnij ją; podwójne kliknięcie – stacja pośrednia z wsiadaniem.' : 'Dodano koła odchylające – przeciągnij je (tylko niewielki kąt).');
    }
  }

  /** Usunięcie punktu osi trasy (zostają co najmniej 2) lub załamania wyciągu. */
  private removeAt(h: EditHandle): boolean {
    const s = this.selection;
    if (!s) return false;
    const next = this.clone();
    if (h.kind === 'pistePoint' && s.kind === 'piste') {
      const p = next.pistes.find((x) => x.id === s.id);
      if (!p || p.points.length <= 2) return false;
      p.points.splice(h.index, 1);
      this.hoverHandle = null;
      this.commit(next, 'Usunięto punkt osi trasy.');
      return true;
    }
    if (h.kind === 'liftBend' && s.kind === 'lift') {
      const l = next.lifts.find((x) => x.id === s.id);
      const prev = this.layout.lifts.find((x) => x.id === s.id) ?? null;
      if (!l?.bends) return false;
      l.bends.splice(h.index, 1);
      if (!l.bends.length) delete l.bends;
      l.towers = retowerLift(this.o.grid, this.o.liftParams, l, prev);
      this.hoverHandle = null;
      this.commit(next, 'Usunięto załamanie wyciągu.');
      return true;
    }
    return false;
  }

  private toggleBendMid(i: number): void {
    const s = this.selection;
    if (s?.kind !== 'lift') return;
    const next = this.clone();
    const l = next.lifts.find((x) => x.id === s.id);
    if (!l?.bends?.[i]) return;
    l.bends[i] = { ...l.bends[i], mid: !l.bends[i].mid };
    if (!l.bends[i].mid) delete l.bends[i].mid;
    this.commit(next, l.bends[i].mid ? 'Stacja pośrednia: goście wsiadają i wysiadają (droższa).' : 'Stacja kątowa (bez wsiadania).');
  }

  /** Otwarcie / zamknięcie zaznaczonej trasy lub wyciągu (decyduje gracz). */
  private toggleClosed(): void {
    const s = this.selection;
    if (!s || s.kind === 'base') return;
    const next = this.clone();
    const obj = s.kind === 'piste' ? next.pistes.find((x) => x.id === s.id) : next.lifts.find((x) => x.id === s.id);
    if (!obj) return;
    if (obj.closed) delete obj.closed;
    else obj.closed = true;
    this.commit(next, `${s.kind === 'piste' ? 'Trasa' : 'Wyciąg'} ${obj.name} ${obj.closed ? 'zamknięt' + (s.kind === 'piste' ? 'a' : 'y') : 'otwart' + (s.kind === 'piste' ? 'a' : 'y')}.`);
  }

  /** Wyrównanie terenu na zaznaczonej trasie (usunięcie kamieni i pniaków, niwelacja – koszt). */
  private toggleGraded(): void {
    const s = this.selection;
    if (s?.kind !== 'piste') return;
    const next = this.clone();
    const p = next.pistes.find((x) => x.id === s.id);
    if (!p) return;
    if (p.graded) delete p.graded;
    else p.graded = true;
    this.commit(next, p.graded ? `Trasa ${p.name}: teren wyrównany (łąka wyrównana – mniej śniegu potrzeba).` : `Trasa ${p.name}: bez wyrównania terenu.`);
  }

  /** Śnieg (zapas wody) do ostrzeżeń „za mało śniegu”. */
  setSnow(sweMm: Float32Array | null): void {
    this.snowSweMm = sweMm;
    this.recomputeWarnings();
    this.drawVersion++;
    this.refreshPanel();
    this.refreshProfile();
  }

  get groundMap(): Uint8Array | null {
    return this.analysis.ground;
  }

  /** Bieżące ostrzeżenia „za mało śniegu” (otwarte trasy). */
  get thinWarningRows(): SnowWarning[] {
    const out: SnowWarning[] = [];
    for (const p of this.layout.pistes) {
      const segs = this.thin.get(p.id);
      if (segs) out.push({ pisteId: p.id, pisteName: p.name, segments: segs });
    }
    return out;
  }

  get thinWarnings(): Map<string, ThinSegment[]> {
    return this.thin;
  }

  private recomputeWarnings(): void {
    this.thin = new Map();
    const swe = this.snowSweMm;
    const ground = this.analysis?.ground;
    if (!swe || !ground) {
      this.o.onSnowWarnings?.([]);
      return;
    }
    const g = this.o.grid;
    const cellAt = (x: number, y: number) => {
      const c = g.cellAt(x, y);
      return c ? g.index(c.i, c.j) : -1;
    };
    const out: SnowWarning[] = [];
    for (const p of this.layout.pistes) {
      if (p.closed) continue;
      const a = this.analysis.pistes.get(p.id);
      if (!a) continue;
      const segs = thinSegments(a.axis.filter((x) => !Number.isNaN(x.elevationM)), cellAt, swe, ground, this.o.riding);
      if (!segs.length) continue;
      this.thin.set(p.id, segs);
      out.push({ pisteId: p.id, pisteName: p.name, segments: segs });
    }
    this.o.onSnowWarnings?.(out);
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
      gradeNew: this.gradeNew,
      thin: this.thin,
      buildingTypeId: this.buildingTypeId,
      construction: this.construction,
      gunTypeId: this.gunTypeId,
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
      if (!this.edit) {
        const h = this.tool === 'select' ? this.hitHandle(cursor.xPx, cursor.yPx) : null;
        const k = (x: EditHandle | null) => (x ? `${x.kind}|${x.index}|${x.side ?? 0}` : '');
        if (k(h) !== k(this.hoverHandle)) {
          this.hoverHandle = h;
          this.drawVersion++;
        }
      }
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
      handles: this.handles(),
      thinMarks: this.thin,
      construction: this.construction,
      buildingTypes: this.o.buildingTypes ?? null,
      snowNet: this.o.snowmaking ? { hydrants: this.hydrants(), draftPipe: this.pipePoints, plumes: this.plumes, cursor: this.hoverPoint } : null,
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
