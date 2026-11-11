/**
 * Budowa ośrodka – sterowanie: narzędzia (wyciąg, trasa pędzlem, trasa po osi, baza, wybór),
 * podgląd na żywo z profilem i ostrzeżeniami, zatwierdzanie z historią (cofnij/ponów), zaznaczanie,
 * usuwanie, zapis w przeglądarce i do pliku, wycinka → nowe pokrycie dla modelu śniegu.
 */
import { Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import type { LiftAnalysis, LiftDesign, LiftParams, PointM, Tower } from '../sim/lifts';
import { analyzeLift, designLift, liftPath, liftTypeById, pointAlongPath, retowerLift } from '../sim/lifts';
import type { GroundParams } from '../sim/ground';
import type { Hydrant } from '../sim/snowmaking';
import { pipelineCost, pipelineHydrants } from '../sim/snowmaking';
import type { WaterContext } from '../sim/operations';
import type { SummerParams } from '../sim/summerParams';
import { analyzeDitch, reservoirCatchment, streamAt, villageCoverage } from '../sim/water';
import type { DitchAnalysis } from '../sim/water';
import { convertLegacyCatchments } from '../sim/operations';
import type { AutoSnowPlan } from '../sim/autoSnowmaking';
import { pisteEdgeLine, planPisteSnowmaking, simplifyPolyline } from '../sim/autoSnowmaking';
import { canWiden, liftUpgradeCheck, moveBuilding, upgradeGun, upgradeLift, widenPiste } from '../sim/upgrades';
import { connectPipelines } from '../sim/snowmaking';
import { BIKE_CLASS_NAMES, TRAIL_KIND_NAMES, analyzeTrail } from '../sim/summer';
import type { RoadParams } from '../sim/resort';
import { analyzeRoads } from '../sim/resort';
import type { SnowmakingParams } from '../sim/snowmakingParams';
import type { RidingParams, ThinSegment } from '../sim/snowRiding';
import { thinSegments } from '../sim/snowRiding';
import type { AxisPoint, PisteAnalysis, PisteParams } from '../sim/pistes';
import { analyzePiste, orientDownhill } from '../sim/pistes';
import type { ClearingCost, OsmResort, RealPisteComparison, ResortAnalysis, ResortLayout } from '../sim/resort';
import { LayoutHistory, analyzeResort, applyClearing, compareRealPistes, emptyLayout, parseLayout, serializeLayout } from '../sim/resort';
import type { TerrainGrid } from '../sim/terrainGrid';
import type { BuildTool, DrawMode } from './buildPanel';
import { BuildPanel } from './buildPanel';
import { BuildProfile } from './buildProfile';
import type { Camera } from './camera';
import { ResortLayer } from './resortLayer';
import type { EditHandle, HandleKind, MapContextData, MapLabel } from './resortLayer';
import type { LodThresholds } from './illustration';
import type { BuildBarState } from './buildBar';
import type { CtrlPt, LineParams } from './lineTools';
import { ctrlFromPoints, effectiveTolerance, nearestOnPolyline, simplifyStroke, smoothPath, smoothPathWithSeg } from './lineTools';
import type { SnapContext, SnapParams, SnapPoint, SnapResult, SnapSegment } from './snapping';
import { arcPoints, polylineSegments, snapPoint } from './snapping';
import { AutoSnowPanel } from './autoSnowPanel';

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
  /** Etap 6b: drogi – parametry i drogi publiczne (OSM, lokalne współrzędne). */
  roads?: RoadParams | null;
  /** Etap 7b: sezon letni (trasy rowerowe, ścieżki, tor saneczkowy, budynki letnie). */
  summer?: SummerParams | null;
  /** Etap 7b: zaznaczenie obiektu (karta obiektu). */
  onSelect?: (sel: { kind: SelKind; id: string } | null) => void;
  publicRoads?: PointM[][] | null;
  /** Etap 7c: upraszczanie i wygładzanie linii (data/ui.json). */
  lines: LineParams;
  /** Etap 7c: komunikat budowy (podpowiedź nad paletą). */
  onMessage?: (text: string) => void;
  /** Etap 7c: zmiana stanu narzędzi (paleta budowy). */
  onState?: () => void;
  /** Etap 7f: przyciąganie i linie pomocnicze (data/ui.json). */
  snap: SnapParams;
  /** Etap 7f: opad roczny na wysokości z – szacowany dopływ z rowów. */
  annualPrecipMm?(zM: number): number;
  /** Etap 7f: podgląd kosztu zmiany (dopłata, czas przebudowy obiektu `id`) – kariera; null bez gry. */
  changePreview?(next: ResortLayout, analysis: ResortAnalysis, id: string | null): { chargePln: number; days: number | null } | null;
}

/** Etap 7f: to, co rysuje SnapOverlay przy kursorze (znacznik przyciągnięcia, linia pomocnicza, opis). */
export interface SnapView {
  point: PointM;
  hit: SnapResult['hit'];
  guide: SnapResult['guide'];
  info: string[];
  warn: string[];
}

export type SelKind = 'lift' | 'piste' | 'base' | 'pipeline' | 'gun' | 'road' | 'trail' | 'ditch';

export interface SnowWarning {
  pisteId: string;
  pisteName: string;
  segments: ThinSegment[];
}

const SELECT_RADIUS_PX = 12;
const HANDLE_RADIUS_PX = 10;
/** Etap 7c: odległość od linii zaznaczonego obiektu, przy której przeciągnięcie wstawia punkt [px]. */
const SEGMENT_GRAB_PX = 9;
const DRAW_MODE_KEY = 'ski-sim:rysowanie';
const LINE_TOOLS: BuildTool[] = ['pisteBrush', 'pisteAxis', 'catwalk', 'road', 'pipeline', 'supply', 'bikeTrail', 'walkTrail', 'toboggan', 'ditch'];
/** Etap 7f: narzędzia z przyciąganiem (linie i stacje wyciągu). */
const SNAP_TOOLS: BuildTool[] = [...LINE_TOOLS, 'lift'];


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
  private water: WaterContext | null = null;
  /** Etap 6b: droga w trakcie rysowania. */
  private roadPoints: PointM[] = [];
  private trailPoints: PointM[] = [];
  private gunTypeId = 'fan';
  /** Etap 7c: rysowanie linii ręką (przeciągnięcie, potem uproszczenie) albo klikaniem punktów. */
  private drawModeValue: DrawMode = 'hand';
  /** Etap 7f: łuk – punkt sterujący czekający na koniec łuku. */
  private arcCtrl: PointM | null = null;
  private shiftDown = false;
  private snapRes: SnapResult | null = null;
  private snapCache: { key: string; ctx: Omit<SnapContext, 'anchor' | 'prevDir' | 'metersPerPixel' | 'shift'> } | null = null;
  private cursorWorld: PointM | null = null;
  private infoLines: string[] = [];
  private warnLines: string[] = [];
  /** Etap 7f: rów w trakcie rysowania i jego analiza (zlewnia). */
  private ditchPoints: PointM[] = [];
  private ditchDraft: DitchAnalysis | null = null;
  private annualPrecip: ((zM: number) => number) | null = null;
  /** Etap 7f: nakładka w świecie – zlewnia rowu, podgląd „Naśnież trasę”, przesuwany budynek. */
  private readonly overlayG = new Graphics();
  private overlayKey = '';
  /** Etap 7f: „Naśnież trasę” – zaznaczone trasy i propozycja. */
  private autoSel: string[] = [];
  private autoPlan: AutoSnowPlan | null = null;
  private autoPanel: AutoSnowPanel;
  /** Etap 7f: przesuwanie budynku (z obrotem) albo armatki. */
  private moving: { kind: 'base' | 'gun'; id: string; before: ResortLayout; rotDeg: number } | null = null;
  /** Linia rysowana teraz ręką (przeciąganie). */
  private handStroke = false;
  private strokeSinceAnalysis = 0;
  private lastMessage = '';
  private readonly panel: BuildPanel;
  private readonly profile: BuildProfile;
  private readonly layer: ResortLayer;

  constructor(private readonly o: BuildControllerOptions) {
    this.liftTypeId = o.liftParams.types.find((t) => t.id === 'kanapa4d')?.id ?? o.liftParams.types[0].id;
    this.widthM = o.pisteParams.defaultWidthM;
    this.layout = this.loadSaved();
    try {
      const m = window.localStorage.getItem(DRAW_MODE_KEY);
      if (m === 'click' || m === 'straight') this.drawModeValue = 'straight';
      else if (m === 'arc') this.drawModeValue = 'arc';
    } catch {
      /* bez pamięci przeglądarki */
    }
    this.layer = new ResortLayer(o.world, o.screenLayer, o.grid, o.camera, o.pisteParams, o.lod, o.context, o.labels, o.borderLinesLocal);
    this.overlayG.eventMode = 'none';
    o.screenLayer.addChild(this.overlayG);
    this.annualPrecip = o.annualPrecipMm ?? null;
    this.autoPanel = new AutoSnowPanel(o.profileParent, {
      onBuild: () => this.buildAutoPlan(),
      onCancel: () => this.setTool('select'),
    });
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
      onToggleDownhill: () => this.toggleLiftDownhill(),
      onToggleGraded: () => this.toggleGraded(),
    });
    // Etap 7f: Shift wyłącza przyciąganie.
    const shift = (e: KeyboardEvent) => {
      if (e.shiftKey !== this.shiftDown) {
        this.shiftDown = e.shiftKey;
        this.lastCursorKey = '';
      }
    };
    window.addEventListener('keyup', shift);
    window.addEventListener('blur', () => (this.shiftDown = false));
    window.addEventListener('keydown', (e) => {
      shift(e);
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

  /** Etap 6b: model wody – sprawdzanie miejsca ujęcia, wodociągu, rowów. */
  setWater(w: WaterContext, annualPrecipMm?: (zM: number) => number): void {
    this.water = w;
    if (annualPrecipMm) this.annualPrecip = annualPrecipMm;
    // Etap 7f: starszy zapis – „budynek” rowów przy zbiorniku zamieniany na rów dnem doliny (bez opłaty).
    if (this.o.snowmaking) {
      const conv = convertLegacyCatchments(this.layout, this.o.snowmaking, w);
      if (conv) {
        this.layout = conv;
        this.message = 'Rowy przy zbiorniku są teraz linią wzdłuż dna doliny (rów zbierający) – bez opłaty.';
        this.reanalyze();
        this.save();
      }
    }
  }

  /** Etap 7b: szlaki PTTK (lato) i wygląd lata. */
  setHikingTrails(lines: Parameters<ResortLayer['setHikingTrails']>[0]): void {
    this.layer.setHikingTrails(lines);
  }

  setSummerLook(on: boolean): void {
    this.layer.setSummer(on);
  }

  /** Etap 6b: potoki na mapie. */
  setStreams(lines: Parameters<ResortLayer['setStreams']>[0]): void {
    this.layer.setStreams(lines);
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
    this.analysis = analyzeResort(this.layout, { grid: this.o.grid, lifts: this.o.liftParams, pistes: this.o.pisteParams, clearing: this.o.clearing, forest: this.o.forest, shrub: this.o.shrub, ground: this.o.ground, roads: this.o.roads, publicRoads: this.o.publicRoads, summer: this.o.summer ?? null });
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
    const a = analyzeResort(next, { grid: this.o.grid, lifts: this.o.liftParams, pistes: this.o.pisteParams, clearing: this.o.clearing, forest: this.o.forest, shrub: this.o.shrub, ground: this.o.ground, roads: this.o.roads, publicRoads: this.o.publicRoads, summer: this.o.summer ?? null });
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
    // Etap 7c: trasa – jedno narzędzie, sposób rysowania wg trybu (ręką / punktami).
    if (tool === 'pisteAxis' && this.drawModeValue === 'hand') this.drawModeValue = 'straight';
    if (tool === 'pisteBrush' && this.drawModeValue !== 'hand') tool = 'pisteAxis';
    if (this.moving && tool !== 'move') this.cancelMove();
    if (tool !== 'autoSnow') {
      this.autoSel = [];
      this.autoPlan = null;
      this.autoPanel.hide();
    }
    // Narzędzie budowy: zdejmujemy zaznaczenie, żeby panel profilu nie zasłaniał mapy.
    if (tool !== 'select' && this.selection) {
      this.selection = null;
      this.o.onSelect?.(null);
    }
    this.cancelDraft();
    this.tool = tool;
    this.message =
      tool === 'lift'
        ? `Wyciąg: kliknij dolną stację, potem górną (${liftTypeById(this.o.liftParams, this.liftTypeId).name}).`
        : tool === 'pisteBrush'
          ? 'Trasa: przeciągnij myszą wzdłuż trasy – linia sama się uprości i wygładzi. Mapę przesuwasz prawym przyciskiem lub klawiszami. O – rysowanie punktami.'
          : tool === 'pisteAxis'
            ? 'Trasa: klikaj punkty osi; podwójne kliknięcie lub Enter – koniec; Backspace – cofnij punkt. O – rysowanie ręką.'
            : tool === 'demolish'
              ? 'Rozbiórka: kliknij obiekt na mapie (wyciąg, trasę, budynek, rurociąg…), który chcesz rozebrać.'
            : tool === 'road'
              ? `Droga: klikaj punkty od drogi publicznej (szara) albo innej drogi do parkingu; Enter lub podwójne kliknięcie – koniec. Nachylenie do ${this.o.roads?.maxSlopePercent ?? 12} %, koszt ${Math.round(this.o.roads?.costPlnPerM ?? 0)} zł/m, zimą odśnieżanie.`
              : tool === 'catwalk'
                ? `Nartostrada: klikaj punkty osi łatwego łącznika (szerokość ${this.o.pisteParams.catwalkWidthM} m, nachylenie do ${this.o.pisteParams.catwalkMaxSlopePercent} %); Enter – koniec.`
            : tool === 'bikeTrail'
              ? `Trasa rowerowa: klikaj punkty od górnej stacji kolei (z wieszakami na rowery) w dół; Enter – koniec. Trudność z nachylenia (IMBA): do ${this.o.summer?.bike.classMaxAvgSlopePercent.join(' / ')} %. ${Math.round(this.o.summer?.bike.buildPlnPerM ?? 0)} zł/m.`
            : tool === 'walkTrail'
              ? `Ścieżka spacerowa: klikaj punkty (łączy szlaki, schroniska, stacje kolei); Enter – koniec. ${Math.round(this.o.summer?.walk.buildPlnPerM ?? 0)} zł/m.`
            : tool === 'toboggan'
              ? `Tor saneczkowy całoroczny: klikaj od góry do dołu (stacja startowa na dole); nachylenie ${this.o.summer?.toboggan.minSlopePercent}–${this.o.summer?.toboggan.maxSlopePercent} %, do ${this.o.summer?.toboggan.maxLengthM} m; Enter – koniec.`
            : tool === 'supply'
              ? `Rura zasilająca: klikaj punkty od źródła wody (ujęcie, studnia, wodociąg) do zbiornika; Enter – koniec. ${Math.round(this.o.snowmaking?.pipe.supplyCostPlnPerM ?? 0)} zł/m; pod górę woda jest pompowana (energia).`
            : tool === 'pipeline'
              ? 'Rurociąg: klikaj punkty od pompowni (albo od innego rurociągu) wzdłuż trasy; Enter lub podwójne kliknięcie – koniec. Hydranty stawiają się same co kilkadziesiąt metrów. Końce przyciągają się do pompowni, hydrantów i rur (Shift – bez przyciągania).'
            : tool === 'ditch'
              ? `Rów zbierający: rysuj od góry stoku w dół do zbiornika (koniec najwyżej ${this.water?.wp.ditches.reservoirRadiusM ?? 40} m od niego), ze spadkiem co najmniej ${this.water?.wp.ditches.minSlopePercent ?? 0.5} %. Zbiera wodę z obszaru powyżej rowu (niebieskie pole). ${Math.round(this.o.snowmaking?.ditch.costPlnPerM ?? 0)} zł/m.`
            : tool === 'autoSnow'
              ? 'Naśnież trasę: kliknij trasę (albo kilka) – gra zaproponuje rurociąg wzdłuż krawędzi, hydranty, armatki i połączenie z pompownią. Potem „Zbuduj” albo „Anuluj”.'
            : tool === 'move'
              ? 'Przesuń: kliknij nowe miejsce; R albo prawy przycisk – obrót o 90°; Esc – anuluj.'
              : tool === 'gun'
                ? `Armatka: kliknij hydrant (kropka na rurociągu) – ${this.o.snowmaking?.guns.find((g) => g.id === this.gunTypeId)?.name ?? ''}. Zaznaczoną armatkę śmigłową przestawisz, klikając wolny hydrant.`
                : tool === 'base'
              ? `Budynek: kliknij miejsce (${this.o.buildingTypes?.find((t) => t.id === this.buildingTypeId)?.name ?? 'baza'}).`
              : '';
    if (LINE_TOOLS.includes(tool) && tool !== 'pisteBrush') this.message += this.drawModeValue === 'hand' ? ' Rysujesz ręką: przeciągnij myszą (O – zmiana sposobu).' : this.drawModeValue === 'arc' ? ' Łuk: klik – początek, klik – punkt sterujący, klik – koniec (O – zmiana sposobu).' : ' Prosto: klikaj punkty (O – zmiana sposobu).';
    this.o.onToolChange(tool);
    this.refreshPanel();
  }

  // ------------------------------------------------------------------ etap 7c: stan dla palety budowy

  get drawMode(): DrawMode {
    return this.drawModeValue;
  }

  setDrawMode(mode: DrawMode): void {
    this.arcCtrl = null;
    this.drawModeValue = mode;
    try {
      window.localStorage.setItem(DRAW_MODE_KEY, mode);
    } catch {
      /* bez pamięci przeglądarki */
    }
    if (this.tool === 'pisteBrush' || this.tool === 'pisteAxis') this.setTool(mode !== 'hand' ? 'pisteAxis' : 'pisteBrush');
    else if (LINE_TOOLS.includes(this.tool)) this.setTool(this.tool);
    else this.refreshPanel();
  }

  setLiftType(id: string): void {
    this.liftTypeId = id;
    this.setTool('lift');
  }

  setBuildingType(id: string): void {
    this.buildingTypeId = id;
    this.setTool('base');
  }

  setGunType(id: string): void {
    this.gunTypeId = id;
    this.setTool('gun');
  }

  setWidth(w: number): void {
    this.widthM = Math.min(this.o.pisteParams.maxWidthM, Math.max(this.o.pisteParams.minWidthM, w));
    this.refreshPanel();
  }

  setGradeNew(on: boolean): void {
    this.gradeNew = on;
    this.refreshPanel();
  }

  undoLast(): void {
    this.undo();
  }

  redoLast(): void {
    this.redo();
  }

  get barState(): BuildBarState {
    return {
      tool: this.tool,
      liftTypeId: this.liftTypeId,
      buildingTypeId: this.buildingTypeId,
      gunTypeId: this.gunTypeId,
      drawMode: this.drawModeValue,
      widthM: this.widthM,
      minWidthM: this.o.pisteParams.minWidthM,
      maxWidthM: this.o.pisteParams.maxWidthM,
      gradeNew: this.gradeNew,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    };
  }

  /** Środek obiektu (kamera „Pokaż na mapie”). */
  objectCenter(kind: SelKind, id: string): PointM | null {
    const l = this.layout;
    const mid = (pts: PointM[]) => pts[Math.floor(pts.length / 2)] ?? null;
    if (kind === 'lift') {
      const x = l.lifts.find((o) => o.id === id);
      return x ? { xM: (x.bottom.xM + x.top.xM) / 2, yM: (x.bottom.yM + x.top.yM) / 2 } : null;
    }
    if (kind === 'piste') return mid(l.pistes.find((o) => o.id === id)?.points ?? []);
    if (kind === 'road') return mid((l.roads ?? []).find((o) => o.id === id)?.points ?? []);
    if (kind === 'trail') return mid((l.trails ?? []).find((o) => o.id === id)?.points ?? []);
    if (kind === 'pipeline') return mid((l.pipelines ?? []).find((o) => o.id === id)?.points ?? []);
    if (kind === 'ditch') return mid((l.ditches ?? []).find((o) => o.id === id)?.points ?? []);
    if (kind === 'gun') {
      const g = (l.snowGuns ?? []).find((o) => o.id === id);
      const h = g ? this.hydrants().find((x) => x.pipelineId === g.pipelineId && x.index === g.hydrant) : null;
      return h ? { xM: h.xM, yM: h.yM } : null;
    }
    const b = [...l.bases, ...(l.buildings ?? [])].find((o) => o.id === id);
    return b ? { xM: b.xM, yM: b.yM } : null;
  }

  /** Etap 7d: z bliska obiekty z atlasu zamiast uproszczonych wektorów. */
  setPropsActive(on: boolean): void {
    this.layer.propsActive = on;
  }

  /** Zdjęcie zaznaczenia (zamknięcie karty obiektu). */
  clearSelection(): void {
    if (this.selection) this.select(null);
  }

  /** Zaznaczenie z zewnątrz (powiadomienie, raport, karta). */
  selectObject(kind: SelKind, id: string): void {
    if (this.tool !== 'select') this.setTool('select');
    this.select({ kind, id });
  }

  // ------------------------------------------------------------------ etap 7c: linie z punktami kontrolnymi

  private lineObj(kind: SelKind, id: string, layout = this.layout): { points: CtrlPt[]; ctrl?: CtrlPt[]; smooth?: number } | null {
    if (kind === 'piste') return layout.pistes.find((o) => o.id === id) ?? null;
    if (kind === 'road') return (layout.roads ?? []).find((o) => o.id === id) ?? null;
    if (kind === 'trail') return (layout.trails ?? []).find((o) => o.id === id) ?? null;
    if (kind === 'pipeline') return (layout.pipelines ?? []).find((o) => o.id === id) ?? null;
    if (kind === 'ditch') return (layout.ditches ?? []).find((o) => o.id === id) ?? null;
    return null;
  }

  /** Punkty kontrolne obiektu (starszy zapis bez nich – z gęstych punktów). */
  private ctrlOf(o: { points: CtrlPt[]; ctrl?: CtrlPt[]; smooth?: number }): { ctrl: CtrlPt[]; smooth: number } {
    if (o.ctrl && o.ctrl.length >= 2) return { ctrl: o.ctrl, smooth: o.smooth ?? this.o.lines.defaultSmooth };
    return ctrlFromPoints(o.points, this.o.lines);
  }

  /** Gęsty przebieg z punktów kontrolnych (zapisywany jako `points` – z niego liczy symulacja). */
  private densify<T extends CtrlPt>(ctrl: T[], smooth: number): T[] {
    return smoothPath(ctrl, smooth, this.o.lines.sampleStepM);
  }

  /** Narysowane punkty → punkty kontrolne (ręką – upraszczanie) i gęsty przebieg. */
  private lineFromDrawn<T extends CtrlPt>(drawn: T[], hand: boolean): { ctrl: T[]; smooth: number; points: T[] } {
    const clean = drawn.filter((q, i, a) => i === 0 || Math.hypot(q.xM - a[i - 1].xM, q.yM - a[i - 1].yM) > 1);
    const mode: DrawMode = hand ? 'hand' : this.drawModeValue;
    // Etap 7f: prosty odcinek – łamana przez kliknięte punkty (gładkość 0); łuk i ręka – uproszczenie śladu, gładki łuk.
    const smooth = mode === 'straight' ? 0 : this.o.lines.defaultSmooth;
    const L = this.o.lines;
    const ctrl = mode !== 'straight' && clean.length > 2 ? simplifyStroke(clean, { toleranceM: mode === 'arc' ? L.toleranceM : effectiveTolerance(L, this.o.camera.metersPerPixel), minSpacingM: mode === 'arc' ? L.sampleStepM * 2 : L.minSpacingM, cornerAngleDeg: L.cornerAngleDeg, smooth }) : clean;
    return { ctrl, smooth, points: this.densify(ctrl, smooth) };
  }

  /** Etap 7f: łuk – niedokończony (bez końca) kończy się prosto w punkcie sterującym. */
  private flushArc(): void {
    if (!this.arcCtrl) return;
    const q = this.arcCtrl;
    this.arcCtrl = null;
    const arr = this.drawArr();
    if (!arr) return;
    if (this.tool === 'pisteAxis' || this.tool === 'catwalk') this.axisPoints.push({ xM: q.xM, yM: q.yM, widthM: this.axisPoints[this.axisPoints.length - 1]?.widthM ?? this.widthM });
    else arr.push({ xM: q.xM, yM: q.yM });
  }

  /** Punkty rysowanej teraz linii (null – narzędzie nie rysuje linii). */
  private drawArr(): PointM[] | null {
    if (this.tool === 'pisteAxis' || this.tool === 'pisteBrush' || this.tool === 'catwalk') return this.axisPoints;
    if (this.tool === 'road') return this.roadPoints;
    if (this.tool === 'pipeline' || this.tool === 'supply') return this.pipePoints;
    if (this.tool === 'ditch') return this.ditchPoints;
    if (this.tool === 'bikeTrail' || this.tool === 'walkTrail' || this.tool === 'toboggan') return this.trailPoints;
    return null;
  }

  /** Etap 7f: nowy punkt linii klikaniem – prosto albo łukiem (punkt sterujący, potem koniec). */
  private addClickPoint(q: PointM): void {
    const arr = this.drawArr();
    if (!arr) return;
    const axis = this.tool === 'pisteAxis' || this.tool === 'catwalk';
    const w = this.tool === 'catwalk' ? this.o.pisteParams.catwalkWidthM : this.widthM;
    const mk = (p: PointM) => (axis ? { xM: p.xM, yM: p.yM, widthM: w } : { xM: p.xM, yM: p.yM });
    if (this.drawModeValue === 'arc' && arr.length) {
      if (!this.arcCtrl) {
        this.arcCtrl = q;
        this.message = 'Łuk: teraz kliknij koniec łuku (Enter – koniec prosto w tym punkcie).';
        this.refreshPanel();
        this.drawVersion++;
        return;
      }
      for (const p of arcPoints(arr[arr.length - 1], this.arcCtrl, q, this.o.lines.sampleStepM)) arr.push(mk(p) as never);
      this.arcCtrl = null;
    } else arr.push(mk(q) as never);
    if (axis) this.updateDraftPiste(this.axisPoints, q);
    else this.drawVersion++;
    if (this.tool === 'ditch') this.updateDitchDraft(null);
  }

  /** Gładkość zaznaczonej linii (suwak w karcie) – null, gdy zaznaczenie nie jest linią. */
  lineSmooth(kind: SelKind, id: string): number | null {
    const o = this.lineObj(kind, id);
    return o ? this.ctrlOf(o).smooth : null;
  }

  setLineSmooth(kind: SelKind, id: string, smooth: number): void {
    const next = this.clone();
    const o = this.lineObj(kind, id, next);
    if (!o) return;
    const c = this.ctrlOf(o);
    o.ctrl = c.ctrl.map((q) => ({ ...q }));
    o.smooth = Math.max(0, Math.min(1, smooth));
    o.points = this.densify(o.ctrl, o.smooth);
    this.commit(next, `Gładkość: ${Math.round(o.smooth * 100)} %.`);
  }

  private cancelDraft(): void {
    this.arcCtrl = null;
    this.ditchPoints = [];
    this.ditchDraft = null;
    this.pipePoints = [];
    this.roadPoints = [];
    this.trailPoints = [];
    this.liftBottom = null;
    this.draftLift = null;
    this.axisPoints = [];
    this.brushing = false;
    this.handStroke = false;
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
    // Etap 7f: końce linii i stacje wyciągu przyciągają się do obiektów tej samej sieci.
    const p = SNAP_TOOLS.includes(this.tool) ? this.snapAt(xPx, yPx) : this.world(xPx, yPx);
    if (this.tool === 'move') {
      if (p) this.placeMoving(xPx, yPx, p);
      return true;
    }
    if (this.tool === 'autoSnow') {
      if (p) this.toggleAutoPiste(xPx, yPx, p);
      return true;
    }
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
    if (this.tool === 'demolish') {
      const hit = this.pick(xPx, yPx, p);
      if (!hit) {
        this.message = 'Kliknij obiekt do rozebrania (wyciąg, trasę, budynek, rurociąg, drogę).';
        this.refreshPanel();
        return true;
      }
      const name = this.nameOf(hit.kind, hit.id);
      this.select(hit);
      if (confirm(`Rozebrać „${name}”? Część kosztu budowy przepada.`)) this.cardAction(hit.kind, hit.id, 'demolish');
      return true;
    }
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
    if (LINE_TOOLS.includes(this.tool) && this.tool !== 'pisteBrush') {
      this.addClickPoint(p);
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
        // Etap 6b: źródła wody – ujęcie tylko na potoku, wodociąg tylko przy wsi, rowy przy zbiorniku.
        const check = this.checkWaterSite(t.id, p.xM, p.yM, next);
        if (check.error) {
          this.message = check.error;
          this.refreshPanel();
          return true;
        }
        const n = (next.buildings ?? []).filter((b) => b.typeId === t.id).length + 1;
        (next.buildings ??= []).push({ id, typeId: t.id, name: `${t.name} ${n}`, xM: p.xM, yM: p.yM });
        if (this.commit(next, `Postawiono: ${t.name}.${check.info ? ` ${check.info}` : ''}`)) this.select({ kind: 'base', id });
        return true;
      }
      if (this.commit(next, t ? `Postawiono: ${t.name}.` : 'Postawiono bazę.')) this.select({ kind: 'base', id });
      return true;
    }
    return true;
  }

  handleDoubleClick(): void {
    if (this.tool === 'ditch') this.finishDitch();
    else if (this.tool === 'pipeline' || this.tool === 'supply') this.finishPipeline();
    else if (this.tool === 'road') this.finishRoad();
    else if (this.tool === 'bikeTrail' || this.tool === 'walkTrail' || this.tool === 'toboggan') this.finishTrail();
    else if (this.tool === 'pisteAxis' || this.tool === 'catwalk') this.finishAxis();
    else if (this.tool === 'select' && this.hoverHandle?.kind === 'liftBend') this.toggleBendMid(this.hoverHandle.index);
  }

  handleRightClick(): void {
    if (this.tool === 'move') return this.rotateMoving();
    if (this.tool === 'select' && this.hoverHandle && this.removeAt(this.hoverHandle)) return;
    if (this.tool === 'pisteAxis' && this.axisPoints.length) {
      this.axisPoints.pop();
      this.updateDraftPiste(this.axisPoints, null);
    } else if (this.liftBottom) this.cancelDraft();
  }

  handleDragStart(xPx: number, yPx: number): boolean {
    if (this.tool === 'select') {
      const sel = this.selection;
      if (!sel) return false;
      const h = this.hitHandle(xPx, yPx);
      if (h && h.kind !== 'pisteAdd' && h.kind !== 'liftAdd') {
        const before = this.clone();
        const lift = sel.kind === 'lift' ? this.layout.lifts.find((l) => l.id === sel.id) ?? null : null;
        // Linia ze starszego zapisu – punkty kontrolne zapisujemy w obiekcie przed edycją.
        const lo = this.lineObj(sel.kind, sel.id);
        if (lo && !lo.ctrl) {
          const c = this.ctrlOf(lo);
          lo.ctrl = c.ctrl.map((q) => ({ ...q }));
          lo.smooth = c.smooth;
        }
        this.edit = { kind: h.kind, index: h.index, side: h.side, id: sel.id, before, prevLift: lift ? JSON.parse(JSON.stringify(lift)) : null };
        return true;
      }
      // Etap 7c: przeciągnięcie odcinka zaznaczonej linii wstawia punkt kontrolny i od razu go przesuwa.
      const lo = this.lineObj(sel.kind, sel.id);
      const p = this.world(xPx, yPx);
      if (!lo || !p) return false;
      const c = this.ctrlOf(lo);
      const { points, seg } = smoothPathWithSeg(c.ctrl, c.smooth, this.o.lines.sampleStepM);
      const near = nearestOnPolyline(p, points);
      if (near.d / this.o.camera.metersPerPixel > SEGMENT_GRAB_PX) return false;
      const before = this.clone();
      const i = seg[Math.min(seg.length - 1, near.index)] + 1;
      const a = c.ctrl[i - 1];
      const b = c.ctrl[Math.min(c.ctrl.length - 1, i)];
      const ins: CtrlPt = { xM: p.xM, yM: p.yM, ...(a.widthM !== undefined ? { widthM: Math.round(((a.widthM ?? 0) + (b.widthM ?? a.widthM ?? 0)) / 2) } : {}) };
      lo.ctrl = [...c.ctrl.slice(0, i).map((q) => ({ ...q })), ins, ...c.ctrl.slice(i).map((q) => ({ ...q }))];
      lo.smooth = c.smooth;
      lo.points = this.densify(lo.ctrl, lo.smooth);
      this.edit = { kind: sel.kind === 'piste' ? 'pistePoint' : 'linePoint', index: i, id: sel.id, before, prevLift: null };
      this.drawVersion++;
      return true;
    }
    if (this.drawModeValue !== 'hand' || !LINE_TOOLS.includes(this.tool) || this.tool === 'pisteAxis') return false;
    const p = this.snapAt(xPx, yPx);
    if (!p) return false;
    this.handStroke = true;
    if (this.tool === 'pisteBrush' || this.tool === 'catwalk') {
      this.brushing = true;
      this.axisPoints = [{ xM: p.xM, yM: p.yM, widthM: this.tool === 'catwalk' ? this.o.pisteParams.catwalkWidthM : this.widthM }];
      this.updateDraftPiste(this.axisPoints, null);
    } else this.strokeArray().splice(0, Infinity, { xM: p.xM, yM: p.yM });
    this.drawVersion++;
    return true;
  }

  /** Tablica punktów rysowanej linii (droga, rurociąg, trasa letnia). */
  private strokeArray(): PointM[] {
    if (this.tool === 'road') return this.roadPoints;
    if (this.tool === 'pipeline' || this.tool === 'supply') return this.pipePoints;
    if (this.tool === 'ditch') return this.ditchPoints;
    return this.trailPoints;
  }

  private nameOf(kind: SelKind, id: string): string {
    const l = this.layout;
    const all: { id: string; name?: string }[] = [...l.lifts, ...l.pistes, ...l.bases, ...(l.buildings ?? []), ...(l.pipelines ?? []), ...(l.roads ?? []), ...(l.trails ?? []), ...(l.ditches ?? [])];
    return all.find((o) => o.id === id)?.name ?? (kind === 'gun' ? `armatka ${id}` : id);
  }

  handleDragMove(xPx: number, yPx: number): void {
    if (this.edit) {
      const p = this.world(xPx, yPx);
      if (p) this.applyEdit(p);
      return;
    }
    if (!this.handStroke) return;
    const p = this.world(xPx, yPx);
    if (!p) return;
    // Próbki co ok. 1/3 odstępu pędzla (dokładny ślad ręki – upraszczanie po puszczeniu).
    const spacing = Math.max(1, this.o.pisteParams.brushPointSpacingM / 3);
    if (this.brushing) {
      const last = this.axisPoints[this.axisPoints.length - 1];
      if (Math.hypot(p.xM - last.xM, p.yM - last.yM) < spacing) return;
      this.axisPoints.push({ xM: p.xM, yM: p.yM, widthM: last.widthM });
      // Profil i klasa liczone co ok. odstęp pędzla (analiza trasy jest droższa niż rysowanie śladu).
      if (++this.strokeSinceAnalysis >= 3 || !this.draftPiste) {
        this.strokeSinceAnalysis = 0;
        this.updateDraftPiste(this.axisPoints, null);
      } else {
        this.draftPiste = { points: this.axisPoints, analysis: this.draftPiste.analysis };
        this.drawVersion++;
      }
      return;
    }
    const arr = this.strokeArray();
    const last = arr[arr.length - 1];
    if (last && Math.hypot(p.xM - last.xM, p.yM - last.yM) < spacing) return;
    arr.push({ xM: p.xM, yM: p.yM });
    this.drawVersion++;
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
      this.message = e.kind.startsWith('piste') ? 'Zmieniono trasę (Cofnij przywraca).' : e.kind === 'linePoint' ? 'Zmieniono przebieg (Cofnij przywraca).' : 'Zmieniono wyciąg (Cofnij przywraca).';
      this.reanalyze();
      this.save();
      this.notifyLandCover(false);
      return;
    }
    if (!this.handStroke) return;
    this.brushing = false;
    // Etap 7f: koniec śladu ręki przyciągnięty do obiektu sieci (jeśli kursor był w progu).
    if (this.snapRes?.hit && this.cursorWorld) {
      const q = this.snapRes.point;
      if (this.brushing || this.tool === 'pisteBrush' || this.tool === 'catwalk') this.axisPoints.push({ xM: q.xM, yM: q.yM, widthM: this.axisPoints[this.axisPoints.length - 1]?.widthM ?? this.widthM });
      else this.strokeArray().push({ xM: q.xM, yM: q.yM });
    }
    if (this.tool === 'pisteBrush' || this.tool === 'catwalk') this.finishAxis(true);
    else if (this.tool === 'ditch') this.finishDitch(true);
    else if (this.tool === 'road') this.finishRoad(true);
    else if (this.tool === 'pipeline' || this.tool === 'supply') this.finishPipeline(true);
    else this.finishTrail(true);
    this.handStroke = false;
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
        // Etap 7f: sposób rysowania linii po kolei: prosto → łuk → ręką.
        this.setDrawMode(this.drawModeValue === 'straight' ? 'arc' : this.drawModeValue === 'arc' ? 'hand' : 'straight');
        this.message = this.drawModeValue === 'hand' ? 'Rysowanie ręką: przeciągnij myszą – linia sama się uprości i wygładzi.' : this.drawModeValue === 'arc' ? 'Łuk: klik – początek, klik – punkt sterujący (kierunek łuku), klik – koniec.' : 'Prosto: klik = punkt, podwójny klik lub Enter = koniec.';
        this.refreshPanel();
        return true;
      case 'KeyB':
        this.setTool('base');
        return true;
      case 'KeyN':
        this.toggleNetwork();
        return true;
      case 'KeyR':
        if (this.tool === 'move') {
          this.rotateMoving();
          return true;
        }
        this.toggleReality();
        return true;
      case 'Enter':
        if (this.tool === 'autoSnow' && this.autoPlan) this.buildAutoPlan();
        if (this.tool === 'ditch') this.finishDitch();
        if (this.tool === 'pisteAxis' || this.tool === 'catwalk') this.finishAxis();
        if (this.tool === 'pipeline' || this.tool === 'supply') this.finishPipeline();
        if (this.tool === 'road') this.finishRoad();
        if (this.tool === 'bikeTrail' || this.tool === 'walkTrail' || this.tool === 'toboggan') this.finishTrail();
        return true;
      case 'KeyX':
        if (!this.o.summer) return false;
        this.setTool('bikeTrail');
        return true;
      case 'KeyQ':
        if (!this.o.summer) return false;
        this.setTool('walkTrail');
        return true;
      case 'KeyC':
        if (!this.o.summer) return false;
        this.setTool('toboggan');
        return true;
      case 'KeyE':
        if (!this.o.roads) return false;
        this.setTool('road');
        return true;
      case 'KeyU':
        this.setTool('catwalk');
        return true;
      case 'KeyH':
        if (!this.o.snowmaking) return false;
        this.setTool('pipeline');
        return true;
      case 'KeyF':
        if (!this.o.snowmaking) return false;
        this.setTool('supply');
        return true;
      case 'KeyJ':
        if (!this.o.snowmaking) return false;
        this.setTool('gun');
        return true;
      case 'Backspace':
        if (this.arcCtrl) {
          this.arcCtrl = null;
          this.drawVersion++;
          return true;
        }
        if ((this.tool === 'pisteAxis' || this.tool === 'catwalk') && this.axisPoints.length) {
          this.axisPoints.pop();
          this.updateDraftPiste(this.axisPoints, null);
          return true;
        }
        if (LINE_TOOLS.includes(this.tool) && this.strokeArray().length) {
          this.strokeArray().pop();
          this.drawVersion++;
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
        if (this.tool === 'move') {
          this.cancelMove();
          this.setTool('select');
        } else if (this.liftBottom || this.axisPoints.length || this.pipePoints.length || this.roadPoints.length || this.trailPoints.length || this.ditchPoints.length) this.cancelDraft();
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

  /** Etap 6b: czy źródło wody może tu stanąć; informacja o przepływie, zlewni, wodociągu. */
  private checkWaterSite(typeId: string, xM: number, yM: number, layout: ResortLayout): { error?: string; info?: string } {
    const sp = this.o.snowmaking;
    const w = this.water;
    const t = sp?.buildings.find((x) => x.id === typeId);
    if (!sp || !t || !w) return {};
    const wp = w.wp;
    const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
    if (t.kind === 'intake') {
      const hit = streamAt(w.net, xM, yM, wp.streams.intakeMaxDistanceM, wp);
      if (!hit) return { error: `Ujęcie musi stać na potoku (niebieska linia na mapie, najwyżej ${wp.streams.intakeMaxDistanceM} m od niej).` };
      const mean = hit.meanFlowM3s * 3600;
      const avail = (f: number) => Math.max(0, Math.min(wp.streams.maxWithdrawalShare * mean * f, mean * f - wp.streams.ecologicalFlowShare * mean));
      const jan = avail(wp.streams.monthlyFactor[0]);
      const nov = avail(wp.streams.monthlyFactor[10]);
      const apr = avail(wp.streams.monthlyFactor[3]);
      return { info: `${hit.line.name}: średni przepływ ${f0(mean)} m³/h; wolno pobrać ok. ${f0(nov)} m³/h w listopadzie, ${f0(jan)} w styczniu, ${f0(apr)} w kwietniu (mniej w suchym miesiącu, wspólny limit z innymi ujęciami na potoku). Połącz ze zbiornikiem rurą zasilającą (F).` };
    }
    if (t.kind === 'mains') {
      const v = villageCoverage(xM, yM, w.villageBuildings, wp);
      if (!v.ok) return { error: `Przyłącze wodociągowe tylko w zasięgu sieci wsi: w promieniu ${wp.mains.villageRadiusM} m musi stać co najmniej ${wp.mains.villageMinBuildings} budynków (tu: ${v.buildings}).` };
      return { info: `Woda z sieci ${wp.mains.pricePlnPerM3.toLocaleString('pl-PL')} zł/m³, do ${f0(t.capacity)} m³/h – zakup włączasz w panelu naśnieżania.` };
    }
    if (t.kind === 'well') return { info: `Wydajność studni poznasz dopiero po wierceniu – we fliszu bywa od prawie zera do kilkunastu m³/h.` };
    if (t.kind === 'catchment') {
      const res = (layout.buildings ?? []).filter((b) => sp.buildings.find((x) => x.id === b.typeId)?.kind === 'reservoir');
      const near = res.find((b) => Math.hypot(b.xM - xM, b.yM - yM) <= wp.supply.directRadiusM);
      if (!near) return { error: `Rowy zbierające spływ stawia się przy zbiorniku (najwyżej ${wp.supply.directRadiusM} m od niego).` };
      const c = reservoirCatchment(w.net, near.xM, near.yM, t.capacity, wp, w.elevationM);
      return { info: `Zlewnia zbiornika ${(c.areaM2 / 10000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha – woda z roztopów i deszczu (najwięcej wiosną).` };
    }
    return {};
  }

  private finishPipeline(hand = false): void {
    if (!hand) this.flushArc();
    const supply = this.tool === 'supply';
    const line = this.lineFromDrawn(this.pipePoints, hand);
    const pts = line.points;
    this.pipePoints = [];
    this.drawVersion++;
    if (pts.length < 2) {
      this.message = 'Rurociąg potrzebuje co najmniej dwóch punktów.';
      this.refreshPanel();
      return;
    }
    const next = this.clone();
    const id = `R${next.nextId++}`;
    if (supply) {
      const n = (next.pipelines ?? []).filter((x) => x.supply).length + 1;
      (next.pipelines ??= []).push({ id, name: `Rura zasilająca ${n}`, points: pts, supply: true, ctrl: line.ctrl, smooth: line.smooth });
      const c = pipelineCost(next.pipelines[next.pipelines.length - 1], this.o.snowmaking!);
      if (this.commit(next, `Rura zasilająca ${n}: ${Math.round(c.lengthM)} m. Jeden koniec przy źródle wody, drugi przy zbiorniku (do ${this.water?.wp.supply.connectRadiusM ?? 40} m). Wykop tylko latem (V–X).`)) this.select({ kind: 'pipeline', id });
      return;
    }
    const n = (next.pipelines ?? []).filter((x) => !x.supply).length + 1;
    (next.pipelines ??= []).push({ id, name: `Rurociąg ${n}`, points: pts, ctrl: line.ctrl, smooth: line.smooth });
    const c = pipelineCost(next.pipelines[next.pipelines.length - 1], this.o.snowmaking!);
    if (this.commit(next, `Rurociąg ${n}: ${Math.round(c.lengthM)} m, ${c.hydrants} hydrantów. Wykop tylko latem (V–X). Początek musi być przy pompowni albo innym rurociągu.`)) this.select({ kind: 'pipeline', id });
  }

  /** Etap 7b: trasa letnia (rower, ścieżka, tor) z narysowanych punktów. */
  private finishTrail(hand = false): void {
    if (!hand) this.flushArc();
    const kind = this.tool === 'bikeTrail' ? 'bike' : this.tool === 'walkTrail' ? 'walk' : 'toboggan';
    const line = this.lineFromDrawn(this.trailPoints, hand);
    const pts = line.points;
    this.trailPoints = [];
    this.drawVersion++;
    if (pts.length < 2 || !this.o.summer) {
      this.message = 'Trasa potrzebuje co najmniej dwóch punktów.';
      this.refreshPanel();
      return;
    }
    const next = this.clone();
    const id = `S${next.nextId++}`;
    const base = kind === 'bike' ? 'Trasa rowerowa' : kind === 'walk' ? 'Ścieżka' : 'Tor saneczkowy';
    const n = (next.trails ?? []).filter((t) => t.kind === kind).length + 1;
    const t = { id, name: `${base} ${n}`, kind, points: pts } as const;
    const a = analyzeTrail(t, this.o.grid, this.o.summer);
    if (kind === 'toboggan' && !a.ok) {
      this.message = `Tor saneczkowy tu się nie zmieści: ${a.issues.join('; ')}.`;
      this.refreshPanel();
      return;
    }
    (next.trails ??= []).push({ ...t, points: pts, ctrl: line.ctrl, smooth: line.smooth });
    const info = kind === 'bike' ? `trasa ${BIKE_CLASS_NAMES[a.classIndex]} (średnio ${Math.round(a.meanSlopePercent)} %)` : kind === 'toboggan' ? `spadek ${Math.round(a.dropM)} m` : '';
    if (this.commit(next, `${base} ${n}: ${Math.round(a.lengthM)} m${info ? `, ${info}` : ''}, koszt ${Math.round(a.costPln / 1000)} tys. zł${a.issues.length ? ` – ${a.issues.join('; ')}` : ''}.`)) this.select({ kind: 'trail', id });
  }

  private finishRoad(hand = false): void {
    if (!hand) this.flushArc();
    const line = this.lineFromDrawn(this.roadPoints, hand);
    const pts = line.points;
    this.roadPoints = [];
    this.drawVersion++;
    if (pts.length < 2) {
      this.message = 'Droga potrzebuje co najmniej dwóch punktów.';
      this.refreshPanel();
      return;
    }
    const next = this.clone();
    const id = `D${next.nextId++}`;
    const n = (next.roads ?? []).length + 1;
    (next.roads ??= []).push({ id, name: `Droga ${n}`, points: pts, ctrl: line.ctrl, smooth: line.smooth });
    const a = analyzeRoads(next, this.o.grid, this.o.roads ?? null, this.o.publicRoads ?? null, this.o.pisteParams.baseRadiusM).roads.get(id);
    if (this.commit(next, `Droga ${n}: ${Math.round(a?.lengthM ?? 0)} m, nachylenie do ${Math.round(a?.maxSlopePercent ?? 0)} %${a && !a.connected ? ' – UWAGA: nie łączy się z drogą publiczną' : ''}.`)) this.select({ kind: 'road', id });
  }

  /** Etap 6b: zjazd wyciągiem w dół (kanapy, gondole) – włącz/wyłącz przy zaznaczonym wyciągu. */
  toggleLiftDownhill(): void {
    const s = this.selection;
    if (s?.kind !== 'lift') return;
    const next = this.clone();
    const l = next.lifts.find((x) => x.id === s.id);
    if (!l) return;
    const t = liftTypeById(this.o.liftParams, l.typeId);
    if (t.downhillMaxSeatShare <= 0) {
      this.message = 'Wyciągiem powierzchniowym nie da się zjechać w dół.';
      this.refreshPanel();
      return;
    }
    l.downhill = !l.downhill;
    this.commit(next, l.downhill ? `„${l.name}”: zjazd w dół włączony (do ${Math.round(t.downhillMaxSeatShare * 100)} % miejsc).` : `„${l.name}”: zjazd w dół wyłączony.`);
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

  private finishAxis(hand = false): void {
    if (!hand) this.flushArc();
    const pts = this.axisPoints;
    this.axisPoints = [];
    this.draftPiste = null;
    this.drawVersion++;
    // Podwójne kliknięcie dodaje dwa razy ten sam punkt – usuwamy duplikaty. Ręką – upraszczanie.
    const line = this.lineFromDrawn(pts, hand);
    const clean = line.ctrl;
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
    const catwalk = this.tool === 'catwalk';
    const design = { id, name: catwalk ? `Nartostrada ${name}` : name, points: this.densify(oriented, line.smooth), ctrl: oriented, smooth: line.smooth, ...(this.gradeNew ? { graded: true } : {}), ...(catwalk ? { catwalk: true } : {}) };
    const a = analyzePiste(design, this.pisteCtx());
    if (!a.ok) {
      this.message = `Nie można zbudować trasy: ${a.issues.find((i) => i.severity === 'error')?.message ?? ''}`;
      this.profile.hide();
      this.refreshPanel();
      return;
    }
    next.pistes.push(design);
    this.commit(next, `Zbudowano trasę ${name} (${this.o.pisteParams.classes[a.classIndex].name})${hand ? ` – ${oriented.length} punktów kontrolnych. Poprawki: Esc, potem przeciągnij punkt albo odcinek trasy` : ''}.`);
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
    const lastW = points[points.length - 1]?.widthM ?? this.widthM;
    const tail = cursor && points.length && this.arcCtrl ? arcPoints(points[points.length - 1], this.arcCtrl, cursor, this.o.lines.sampleStepM) : cursor ? [cursor] : [];
    const pts = cursor && (this.tool === 'pisteAxis' || this.tool === 'catwalk') ? [...points, ...tail.map((q) => ({ xM: q.xM, yM: q.yM, widthM: lastW }))] : points;
    const clean = pts.filter((q, i) => i === 0 || Math.hypot(q.xM - pts[i - 1].xM, q.yM - pts[i - 1].yM) > 1);
    const analysis = clean.length >= 2 ? analyzePiste({ id: 'draft', name: '', points: clean }, { grid: this.o.grid, params: this.o.pisteParams, forest: this.o.forest, shrub: this.o.shrub, clearingCost: this.o.clearing }) : null;
    this.draftPiste = { points: this.handStroke ? pts : clean, analysis };
    this.drawVersion++;
    if (analysis) this.profile.showPiste('', analysis, true, this.handStroke ? 'puść przycisk – koniec' : 'podwójne kliknięcie lub Enter – koniec');
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
    for (const tr of this.layout.trails ?? []) {
      const path = tr.points.map((q) => cam.worldToScreen(q.xM, q.yM));
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const dx = b.xPx - a.xPx;
        const dy = b.yPx - a.yPx;
        const t = Math.min(1, Math.max(0, ((xPx - a.xPx) * dx + (yPx - a.yPx) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(xPx - a.xPx - t * dx, yPx - a.yPx - t * dy) <= 6) return { kind: 'trail', id: tr.id };
      }
    }
    for (const road of this.layout.roads ?? []) {
      const path = road.points.map((q) => cam.worldToScreen(q.xM, q.yM));
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const dx = b.xPx - a.xPx;
        const dy = b.yPx - a.yPx;
        const t = Math.min(1, Math.max(0, ((xPx - a.xPx) * dx + (yPx - a.yPx) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(xPx - a.xPx - t * dx, yPx - a.yPx - t * dy) <= 6) return { kind: 'road', id: road.id };
      }
    }
    for (const d of this.layout.ditches ?? []) {
      const path = d.points.map((q) => cam.worldToScreen(q.xM, q.yM));
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const dx = b.xPx - a.xPx;
        const dy = b.yPx - a.yPx;
        const t = Math.min(1, Math.max(0, ((xPx - a.xPx) * dx + (yPx - a.yPx) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(xPx - a.xPx - t * dx, yPx - a.yPx - t * dy) <= 6) return { kind: 'ditch', id: d.id };
      }
    }
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
      if (l.downhill || a?.type.downhillRiding) lines.push('można zjechać w dół wyciągiem');
      const warn = this.analysis.network.issues.find((i) => i.objectId === l.id && i.message.includes('niedostępny'));
      if (warn) lines.push('niedostępny z parkingu – nie pracuje');
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
      const typeId = (b as { typeId?: string }).typeId;
      const water = typeId ? this.checkWaterSite(typeId, b.xM, b.yM, this.layout) : {};
      return { title: b.name, lines: [t ? t.name : 'baza (miejsce przyjazdu)', `status: ${building !== undefined ? `w budowie (${Math.round(building * 100)} %)` : 'gotowy'}`, ...(water.info ? [water.info] : water.error ? [water.error] : [])] };
    }
    if (hit.kind === 'trail') {
      const t = (this.layout.trails ?? []).find((x) => x.id === hit.id);
      const a = this.analysis.trails?.get(hit.id);
      if (!t || !a) return null;
      const lines = [`${TRAIL_KIND_NAMES[t.kind]}${t.kind === 'bike' ? ` ${BIKE_CLASS_NAMES[a.classIndex]}` : ''} · ${f0(a.lengthM)} m, średnio ${f0(a.meanSlopePercent)} % (maks. ${f0(a.maxSlopePercent)} %)`, `status: ${building !== undefined ? `w budowie (${Math.round(building * 100)} %)` : t.closed ? 'zamknięta' : 'czynna'}`];
      if (a.issues.length) lines.push(a.issues.join('; '));
      return { title: t.name, lines };
    }
    if (hit.kind === 'road') {
      const r = (this.layout.roads ?? []).find((x) => x.id === hit.id);
      const a = this.analysis.roads?.get(hit.id);
      if (!r) return null;
      return { title: r.name, lines: [`droga dojazdowa · ${f0(a?.lengthM ?? 0)} m, nachylenie do ${f0(a?.maxSlopePercent ?? 0)} %`, a?.connected === false ? 'nie łączy się z drogą publiczną' : 'połączona z drogą publiczną', `status: ${building !== undefined ? `w budowie (${Math.round(building * 100)} %)` : 'gotowa'}`] };
    }
    if (hit.kind === 'pipeline') {
      const pipe = (this.layout.pipelines ?? []).find((x) => x.id === hit.id);
      if (!pipe || !this.o.snowmaking) return null;
      const n = pipelineHydrants(pipe, this.o.snowmaking).length;
      const guns = (this.layout.snowGuns ?? []).filter((g) => g.pipelineId === pipe.id).length;
      if (pipe.supply) return { title: pipe.name, lines: [`rura zasilająca (źródło → zbiornik) · ${Math.round(pipelineCost(pipe, this.o.snowmaking).lengthM)} m`, `status: ${building !== undefined ? `w budowie (${Math.round(building * 100)} %)` : 'gotowa'}`] };
      return { title: pipe.name, lines: [`rurociąg naśnieżania · ${n} hydrantów, ${guns} armatek`, `status: ${building !== undefined ? `w budowie (${Math.round(building * 100)} %)` : 'gotowy'}`] };
    }
    if (hit.kind === 'ditch') {
      const d = (this.layout.ditches ?? []).find((x) => x.id === hit.id);
      if (!d) return null;
      const a = this.analyzeDitchPts(d.points);
      const lines = [`rów zbierający · ${f0(a?.lengthM ?? 0)} m, spadek ${(a?.slopePercent ?? 0).toFixed(1)} %`, `status: ${building !== undefined ? `w budowie (${Math.round(building * 100)} %)` : 'gotowy'}`];
      if (a) lines.push(`zlewnia ${(a.effectiveAreaM2 / 1e4).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha${a.annualInflowM3 ? `, ok. ${f0(a.annualInflowM3)} m³ w przeciętnym roku` : ''}`);
      if (a && !a.ok) lines.push(a.issues.join('; '));
      return { title: d.name, lines };
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
    if (s.kind === 'road') return (this.layout.roads ?? []).find((p) => p.id === s.id) ?? null;
    if (s.kind === 'trail') return (this.layout.trails ?? []).find((p) => p.id === s.id) ?? null;
    if (s.kind === 'gun') return (this.layout.snowGuns ?? []).find((g) => g.id === s.id) ?? null;
    if (s.kind === 'ditch') return (this.layout.ditches ?? []).find((g) => g.id === s.id) ?? null;
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
    if (sel?.kind === 'ditch') {
      const d = (this.layout.ditches ?? []).find((x) => x.id === sel.id);
      const a = d ? this.analyzeDitchPts(d.points) : null;
      if (a) this.message = `${d!.name}: zlewnia ${(a.effectiveAreaM2 / 1e4).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha (niebieskie pole) – ok. ${Math.round(a.annualInflowM3).toLocaleString('pl-PL')} m³ wody w przeciętnym roku${a.ok ? '' : `; ${a.issues.join('; ')}`}.`;
    }
    this.o.onSelect?.(sel);
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
      if (l && a) return this.profile.showLift(l, a, false, { closed: l.closed === true, downhill: l.downhill === true, noDescent: !this.analysis.network.edges.some((e) => e.kind === 'piste' && !this.layout.pistes.find((x) => x.id === e.objectId)?.closed && (e.from === `${l.id}:góra` || e.from.startsWith(`${l.id}:pośr`))) });
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
    else if (s.kind === 'road') next.roads = (next.roads ?? []).filter((r) => r.id !== s.id);
    else if (s.kind === 'trail') next.trails = (next.trails ?? []).filter((r) => r.id !== s.id);
    else if (s.kind === 'pipeline') {
      next.pipelines = (next.pipelines ?? []).filter((p) => p.id !== s.id);
      next.snowGuns = (next.snowGuns ?? []).filter((g) => g.pipelineId !== s.id);
    } else if (s.kind === 'gun') next.snowGuns = (next.snowGuns ?? []).filter((g) => g.id !== s.id);
    else if (s.kind === 'ditch') next.ditches = (next.ditches ?? []).filter((g) => g.id !== s.id);
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
    const lo = this.lineObj(s.kind, s.id);
    if (lo) {
      // Etap 7c: uchwyty tylko w punktach kontrolnych (przeciągnięcie odcinka wstawia nowy punkt).
      const pts = this.ctrlOf(lo).ctrl;
      const kind: HandleKind = s.kind === 'piste' ? 'pistePoint' : 'linePoint';
      if (s.kind === 'piste') {
        pts.forEach((q, i) => {
          const a = pts[Math.max(0, i - 1)];
          const b = pts[Math.min(pts.length - 1, i + 1)];
          const dx = b.xM - a.xM;
          const dy = b.yM - a.yM;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const w = q.widthM ?? 30;
          for (const side of [1, -1] as const) out.push({ kind: 'pisteWidth', index: i, side, xM: q.xM + nx * side * (w / 2), yM: q.yM + ny * side * (w / 2), hover: isHover('pisteWidth', i, side) });
        });
      }
      pts.forEach((q, i) => out.push({ kind, index: i, xM: q.xM, yM: q.yM, hover: isHover(kind, i) }));
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
    const rank: Record<HandleKind, number> = { pistePoint: 0, linePoint: 0, liftBottom: 0, liftTop: 0, liftBend: 0, pisteWidth: 1, pisteAdd: 2, liftAdd: 2 };
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
    if (e.kind === 'linePoint') {
      const sel = this.selection;
      const lo = sel ? this.lineObj(sel.kind, e.id) : null;
      if (!lo?.ctrl) return;
      lo.ctrl[e.index] = { ...lo.ctrl[e.index], xM: p.xM, yM: p.yM };
      lo.points = this.densify(lo.ctrl, lo.smooth ?? this.o.lines.defaultSmooth);
      this.drawVersion++;
      return;
    }
    if (e.kind.startsWith('piste')) {
      const piste = this.layout.pistes.find((x) => x.id === e.id);
      if (!piste?.ctrl) return;
      const q = piste.ctrl[e.index];
      if (e.kind === 'pistePoint') piste.ctrl[e.index] = { xM: p.xM, yM: p.yM, widthM: q.widthM };
      else if (e.kind === 'pisteWidth') {
        const pts = piste.ctrl;
        const a = pts[Math.max(0, e.index - 1)];
        const b = pts[Math.min(pts.length - 1, e.index + 1)];
        const len = Math.hypot(b.xM - a.xM, b.yM - a.yM) || 1;
        const nx = -(b.yM - a.yM) / len;
        const ny = (b.xM - a.xM) / len;
        const half = Math.abs((p.xM - q.xM) * nx + (p.yM - q.yM) * ny);
        const w = Math.round(Math.min(this.o.pisteParams.maxWidthM, Math.max(this.o.pisteParams.minWidthM, 2 * half)));
        piste.ctrl[e.index] = { ...q, widthM: w };
      }
      piste.points = this.densify(piste.ctrl, piste.smooth ?? this.o.lines.defaultSmooth);
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
    if (h.kind === 'pistePoint' || h.kind === 'linePoint') {
      const lo = this.lineObj(s.kind, s.id, next);
      if (!lo) return false;
      const c = this.ctrlOf(lo);
      if (c.ctrl.length <= 2) return false;
      lo.ctrl = c.ctrl.filter((_, i) => i !== h.index).map((q) => ({ ...q }));
      lo.smooth = c.smooth;
      lo.points = this.densify(lo.ctrl, lo.smooth);
      this.hoverHandle = null;
      this.commit(next, 'Usunięto punkt kontrolny.');
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

  /** Etap 7b – akcje z karty obiektu: otwórz/zamknij, kolej latem, wieszaki, rozbiórka. */
  cardAction(kind: SelKind, id: string, action: 'toggleOpen' | 'toggleSummer' | 'toggleRacks' | 'demolish' | 'upgrade' | 'widen' | 'move', value: string | null = null): void {
    if (action === 'upgrade' || action === 'widen') return this.upgradeObject(kind, id, value);
    if (action === 'move') return this.startMove(kind, id);
    if (action === 'demolish') {
      this.selection = { kind, id };
      this.deleteSelected();
      return;
    }
    const next = this.clone();
    if (action === 'toggleOpen') {
      const obj = kind === 'piste' ? next.pistes.find((x) => x.id === id) : kind === 'lift' ? next.lifts.find((x) => x.id === id) : kind === 'trail' ? (next.trails ?? []).find((x) => x.id === id) : null;
      if (!obj) return;
      if (obj.closed) delete obj.closed;
      else obj.closed = true;
      this.commit(next, `${obj.name}: ${obj.closed ? 'zamknięte' : 'otwarte'}.`);
      return;
    }
    const l = next.lifts.find((x) => x.id === id);
    if (!l) return;
    if (liftTypeById(this.o.liftParams, l.typeId).kind !== 'aerial') {
      this.message = 'Latem wożą tylko koleje linowe (kanapy, gondole).';
      this.refreshPanel();
      return;
    }
    if (action === 'toggleSummer') {
      if (l.summerOff) delete l.summerOff;
      else l.summerOff = true;
      this.commit(next, `${l.name}: latem ${l.summerOff ? 'nie kursuje' : 'kursuje'}.`);
    } else {
      if (l.bikeRacks) delete l.bikeRacks;
      else l.bikeRacks = true;
      this.commit(next, `${l.name}: ${l.bikeRacks ? 'wieszaki na rowery – mniej miejsc dla pieszych' : 'bez wieszaków na rowery'}.`);
    }
  }

  get currentSelection(): { kind: SelKind; id: string } | null {
    return this.selection;
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


  // ------------------------------------------------------------------ etap 7f: przyciąganie i informacje przy kursorze

  private analyzeLayout(next: ResortLayout): ResortAnalysis {
    return analyzeResort(next, { grid: this.o.grid, lifts: this.o.liftParams, pistes: this.o.pisteParams, clearing: this.o.clearing, forest: this.o.forest, shrub: this.o.shrub, ground: this.o.ground, roads: this.o.roads, publicRoads: this.o.publicRoads, summer: this.o.summer ?? null });
  }

  private kindOf(typeId: string): string | undefined {
    return this.o.snowmaking?.buildings.find((x) => x.id === typeId)?.kind;
  }

  /** Punkty, odcinki, odniesienia i równoległe dla bieżącego narzędzia (zapamiętane do zmiany układu). */
  private snapBase(): Omit<SnapContext, 'anchor' | 'prevDir' | 'metersPerPixel' | 'shift'> {
    const key = `${this.tool}|${this.version}`;
    if (this.snapCache?.key === key) return this.snapCache.ctx;
    const L = this.layout;
    const t = this.tool;
    const points: SnapPoint[] = [];
    const segments: SnapSegment[] = [];
    const refs: SnapSegment[] = [];
    const parallels: SnapSegment[] = [];
    const ctrlPts = (o: { points: PointM[]; ctrl?: PointM[] }) => (o.ctrl && o.ctrl.length >= 2 ? o.ctrl : simplifyPolyline(o.points, 2));
    const ends = (pts: PointM[], label: string) => {
      if (pts.length < 2) return;
      points.push({ xM: pts[0].xM, yM: pts[0].yM, label }, { xM: pts[pts.length - 1].xM, yM: pts[pts.length - 1].yM, label });
    };
    const liftStations = () => {
      for (const l of L.lifts) {
        points.push({ xM: l.bottom.xM, yM: l.bottom.yM, label: `${l.name}: dolna stacja` }, { xM: l.top.xM, yM: l.top.yM, label: `${l.name}: górna stacja` });
        for (const b of l.bends ?? []) if (b.mid) points.push({ xM: b.xM, yM: b.yM, label: `${l.name}: stacja pośrednia` });
      }
    };
    if (t === 'pipeline') {
      for (const b of L.buildings ?? []) if (this.kindOf(b.typeId) === 'pump') points.push({ xM: b.xM, yM: b.yM, label: b.name });
      for (const h of this.hydrants()) points.push({ xM: h.xM, yM: h.yM, label: h.gunId ? 'armatka' : 'hydrant' });
      for (const p of L.pipelines ?? []) {
        if (p.supply) continue;
        ends(p.points, p.name);
        segments.push(...polylineSegments(p.points, p.name));
      }
    } else if (t === 'supply') {
      for (const b of L.buildings ?? []) {
        const k = this.kindOf(b.typeId);
        if (k === 'intake' || k === 'well' || k === 'mains' || k === 'reservoir') points.push({ xM: b.xM, yM: b.yM, label: b.name });
      }
      for (const p of L.pipelines ?? []) {
        if (!p.supply) continue;
        ends(p.points, p.name);
        segments.push(...polylineSegments(p.points, p.name));
      }
    } else if (t === 'road') {
      for (const b of L.bases) points.push({ xM: b.xM, yM: b.yM, label: b.name });
      for (const r of L.roads ?? []) {
        ends(r.points, r.name);
        segments.push(...polylineSegments(r.points, r.name));
      }
      for (const r of this.o.publicRoads ?? []) segments.push(...polylineSegments(r, 'droga publiczna'));
    } else if (t === 'pisteAxis' || t === 'pisteBrush' || t === 'catwalk') {
      liftStations();
      for (const p of L.pistes) {
        ends(p.points, `trasa ${p.name}`);
        segments.push(...polylineSegments(p.points, `trasa ${p.name}`));
      }
    } else if (t === 'bikeTrail' || t === 'walkTrail' || t === 'toboggan') {
      liftStations();
      for (const b of [...L.bases, ...(L.buildings ?? [])]) points.push({ xM: b.xM, yM: b.yM, label: b.name });
      for (const tr of L.trails ?? []) {
        ends(tr.points, tr.name);
        segments.push(...polylineSegments(tr.points, tr.name));
      }
    } else if (t === 'lift') {
      for (const p of L.pistes) ends(p.points, `trasa ${p.name}`);
      for (const b of L.bases) points.push({ xM: b.xM, yM: b.yM, label: b.name });
      liftStations();
    } else if (t === 'ditch') {
      for (const b of L.buildings ?? []) if (this.kindOf(b.typeId) === 'reservoir') points.push({ xM: b.xM, yM: b.yM, label: b.name });
      for (const d of L.ditches ?? []) ends(d.points, d.name);
    }
    // Odniesienia kąta i przedłużenia: osie tras, drogi, rurociągi, wyciągi, rowy.
    for (const p of L.pistes) refs.push(...polylineSegments(ctrlPts(p), `trasa ${p.name}`));
    for (const r of L.roads ?? []) refs.push(...polylineSegments(ctrlPts(r), r.name));
    for (const p of L.pipelines ?? []) refs.push(...polylineSegments(ctrlPts(p), p.name));
    for (const d of L.ditches ?? []) refs.push(...polylineSegments(ctrlPts(d), d.name));
    for (const l of L.lifts) refs.push(...polylineSegments(liftPath(l), l.name));
    // Rurociąg i droga wzdłuż trasy w stałej odległości od krawędzi.
    if (t === 'pipeline' || t === 'road' || t === 'ditch') {
      for (const p of L.pistes) {
        for (const side of [1, -1] as const) parallels.push(...polylineSegments(simplifyPolyline(pisteEdgeLine(p, side, this.o.snap.parallelOffsetM, 10, this.o.grid), 1), `wzdłuż trasy ${p.name}`));
      }
    }
    const ctx = { points, segments, refs, parallels };
    this.snapCache = { key, ctx };
    return ctx;
  }

  /** Punkt kliknięcia po przyciągnięciu (Shift – bez); null poza mapą. */
  private snapAt(xPx: number, yPx: number): PointM | null {
    const w = this.world(xPx, yPx);
    if (!w) return null;
    if (!SNAP_TOOLS.includes(this.tool)) return w;
    const arr = this.drawArr();
    const anchor = this.tool === 'lift' ? this.liftBottom : arr && arr.length ? arr[arr.length - 1] : null;
    let prevDir: PointM | null = null;
    if (arr && arr.length >= 2) {
      const a = arr[arr.length - 2];
      const b = arr[arr.length - 1];
      const L = Math.hypot(b.xM - a.xM, b.yM - a.yM);
      if (L > 1e-6) prevDir = { xM: (b.xM - a.xM) / L, yM: (b.yM - a.yM) / L };
    }
    const r = snapPoint(w, { ...this.snapBase(), anchor: this.handStroke ? null : anchor, prevDir, metersPerPixel: this.o.camera.metersPerPixel, shift: this.shiftDown }, this.o.snap);
    if (this.handStroke) r.guide = null;
    this.snapRes = r;
    return this.o.grid.containsPointM(r.point.xM, r.point.yM) ? r.point : w;
  }

  /** Etap 7f: dane dla nakładki przy kursorze (null – nic do pokazania). */
  get snapView(): SnapView | null {
    if (!SNAP_TOOLS.includes(this.tool) || !this.snapRes || !this.cursorWorld) return null;
    return { point: this.snapRes.point, hit: this.snapRes.hit, guide: this.snapRes.guide, info: this.infoLines, warn: this.warnLines };
  }

  /** Długość, koszt narastająco, nachylenie odcinka i ostrzeżenia rysowanej linii (przy kursorze). */
  private computeInfo(q: PointM): void {
    const info: string[] = [];
    const warn: string[] = [];
    const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
    const money = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} mln zł` : `${f0(v / 1000)} tys. zł`);
    const z = (p: PointM) => this.o.grid.sampleElevationM(p.xM, p.yM);
    const t = this.tool;
    this.infoLines = info;
    this.warnLines = warn;
    if (t === 'lift') {
      const d = this.draftLift;
      if (!d) return;
      const a = d.analysis;
      info.push(`${f0(a.slopeLengthM)} m, przewyższenie ${f0(a.riseM)} m · ${money(a.cost.totalPln)}`);
      for (const i of a.issues) (i.severity === 'error' ? warn : info).push(i.message);
      return;
    }
    const arr = this.drawArr();
    if (!arr || !arr.length) return;
    const last = arr[arr.length - 1];
    const tail = this.arcCtrl ? arcPoints(last, this.arcCtrl, q, this.o.lines.sampleStepM) : this.handStroke ? [] : [q];
    const pts: PointM[] = [...arr, ...tail];
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].xM - pts[i - 1].xM, pts[i].yM - pts[i - 1].yM);
    const end = pts[pts.length - 1];
    const segFrom = this.handStroke ? arr[Math.max(0, arr.length - 6)] : last;
    const run = Math.hypot(end.xM - segFrom.xM, end.yM - segFrom.yM);
    const slope = run > 1 ? ((z(end) - z(segFrom)) / run) * 100 : 0;
    const sp = this.o.snowmaking;
    let cost: number | null = null;
    let extra = '';
    if ((t === 'pipeline' || t === 'supply') && sp) {
      const c = pipelineCost({ id: 'x', name: '', points: pts, ...(t === 'supply' ? { supply: true } : {}) }, sp);
      cost = c.costPln;
      if (t === 'pipeline') extra = ` · ${c.hydrants} hydrantów`;
      if (t === 'pipeline') {
        const pumps = (this.layout.buildings ?? []).filter((b) => this.kindOf(b.typeId) === 'pump');
        const pump = pumps[0] ?? null;
        const conn = connectPipelines([...(this.layout.pipelines ?? []), { id: '__draft', name: '', points: pts }], pump ? { xM: pump.xM, yM: pump.yM } : null, sp);
        if (!conn.has('__draft')) warn.push(pump ? 'początek nie łączy się z pompownią ani z rurociągiem' : 'brak pompowni – rurociąg nie dostanie wody');
      }
    } else if (t === 'road' && this.o.roads) {
      cost = L * this.o.roads.costPlnPerM;
      if (Math.abs(slope) > this.o.roads.maxSlopePercent) warn.push(`za stromo: ${f0(Math.abs(slope))} % (droga do ${this.o.roads.maxSlopePercent} %)`);
    } else if (t === 'ditch' && sp) {
      cost = L * sp.ditch.costPlnPerM;
      const d = this.ditchDraft;
      if (d && d.catchment.areaM2 > 0) extra = ` · zlewnia ${(d.effectiveAreaM2 / 1e4).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha${d.annualInflowM3 ? `, ok. ${f0(d.annualInflowM3)} m³/rok` : ''}`;
      if (L > 20 && z(end) > z(pts[0]) + 0.5) warn.push('rów idzie pod górę – rysuj od góry stoku w dół do zbiornika');
      else if (d && !d.reservoirId && d.lengthM > 20) info.push(`koniec przy zbiorniku (do ${this.water?.wp.ditches.reservoirRadiusM ?? 40} m)`);
    } else if ((t === 'bikeTrail' || t === 'walkTrail' || t === 'toboggan') && this.o.summer) {
      const su = this.o.summer;
      cost = t === 'bikeTrail' ? L * su.bike.buildPlnPerM : t === 'walkTrail' ? L * su.walk.buildPlnPerM : su.toboggan.fixedCostPln + L * su.toboggan.costPlnPerM;
      if (t === 'toboggan' && run > 1 && (Math.abs(slope) < su.toboggan.minSlopePercent || Math.abs(slope) > su.toboggan.maxSlopePercent)) warn.push(`tor: nachylenie ${su.toboggan.minSlopePercent}–${su.toboggan.maxSlopePercent} %`);
      if (t === 'toboggan' && L > su.toboggan.maxLengthM) warn.push(`tor za długi (do ${f0(su.toboggan.maxLengthM)} m)`);
    } else if (t === 'pisteAxis' || t === 'pisteBrush' || t === 'catwalk') {
      const a = this.draftPiste?.analysis;
      if (a) {
        cost = a.cost.totalPln;
        extra = ` · ${this.o.pisteParams.classes[a.classIndex]?.name ?? ''}`;
        for (const i of a.issues) (i.severity === 'error' ? warn : info).push(i.message);
      }
      if (t === 'catwalk' && Math.abs(slope) > this.o.pisteParams.catwalkMaxSlopePercent) warn.push(`za stromo na nartostradę (do ${this.o.pisteParams.catwalkMaxSlopePercent} %)`);
    }
    info.unshift(`${f0(L)} m${cost !== null ? ` · ${money(cost)}` : ''}${extra}`, `odcinek: ${slope >= 0 ? '+' : '−'}${f0(Math.abs(slope))} %`);
  }

  // ------------------------------------------------------------------ etap 7f: rowy zbierające

  private reservoirs(): { id: string; xM: number; yM: number }[] {
    return (this.layout.buildings ?? []).filter((b) => this.kindOf(b.typeId) === 'reservoir').map((b) => ({ id: b.id, xM: b.xM, yM: b.yM }));
  }

  private analyzeDitchPts(pts: PointM[]): DitchAnalysis | null {
    const w = this.water;
    const sp = this.o.snowmaking;
    if (!w || !sp || pts.length < 2) return null;
    return analyzeDitch(pts, w.net, w.elevationM, this.reservoirs(), w.wp, this.annualPrecip ?? undefined, sp.ditch);
  }

  private updateDitchDraft(cursor: PointM | null): void {
    const pts = cursor ? [...this.ditchPoints, cursor] : this.ditchPoints;
    this.ditchDraft = this.analyzeDitchPts(pts);
    this.drawVersion++;
  }

  private finishDitch(hand = false): void {
    if (!hand) this.flushArc();
    const line = this.lineFromDrawn(this.ditchPoints, hand);
    this.ditchPoints = [];
    this.ditchDraft = null;
    this.drawVersion++;
    if (!this.water) {
      this.message = 'Model wody jeszcze się liczy – spróbuj za chwilę.';
      this.refreshPanel();
      return;
    }
    const a = this.analyzeDitchPts(line.points);
    if (!a) {
      this.message = 'Rów potrzebuje co najmniej dwóch punktów.';
      this.refreshPanel();
      return;
    }
    if (!a.ok) {
      this.message = `Rów odrzucony: ${a.issues.join('; ')}.`;
      this.refreshPanel();
      return;
    }
    const rev = a.oriented[0] !== line.points[0];
    const next = this.clone();
    const id = `K${next.nextId++}`;
    const n = (next.ditches ?? []).length + 1;
    const r1 = (q: PointM) => ({ xM: Math.round(q.xM * 10) / 10, yM: Math.round(q.yM * 10) / 10 });
    (next.ditches ??= []).push({ id, name: `Rów zbierający ${n}`, points: a.oriented.map(r1), ctrl: (rev ? [...line.ctrl].reverse() : line.ctrl).map(r1), smooth: line.smooth });
    const ha = (a.effectiveAreaM2 / 1e4).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
    if (this.commit(next, `Rów zbierający ${n}: ${Math.round(a.lengthM)} m, spadek ${a.slopePercent.toFixed(1)} %, zlewnia ${ha} ha – ok. ${Math.round(a.annualInflowM3).toLocaleString('pl-PL')} m³ wody w przeciętnym roku. Wykop tylko latem (V–X).`)) this.select({ kind: 'ditch', id });
  }

  // ------------------------------------------------------------------ etap 7f: „Naśnież trasę”

  private toggleAutoPiste(xPx: number, yPx: number, p: PointM): void {
    const hit = this.pick(xPx, yPx, p);
    if (hit?.kind !== 'piste') {
      this.message = 'Kliknij trasę, którą chcesz naśnieżać (kolejne kliknięcia dodają trasy).';
      this.refreshPanel();
      return;
    }
    this.autoSel = this.autoSel.includes(hit.id) ? this.autoSel.filter((x) => x !== hit.id) : [...this.autoSel, hit.id];
    this.recomputeAutoPlan();
  }

  private autoNextId = 0;

  private recomputeAutoPlan(): void {
    const sp = this.o.snowmaking;
    const pistes = this.autoSel.map((id) => this.layout.pistes.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
    this.drawVersion++;
    if (!sp || !pistes.length) {
      this.autoPlan = null;
      this.autoPanel.hide();
      return;
    }
    // Pompownia najbliżej pierwszej zaznaczonej trasy.
    const c0 = pistes[0].points[Math.floor(pistes[0].points.length / 2)];
    let pump: { xM: number; yM: number; cap: number } | null = null;
    let bd = Infinity;
    for (const b of this.layout.buildings ?? []) {
      const t = sp.buildings.find((x) => x.id === b.typeId);
      if (t?.kind !== 'pump') continue;
      const d = Math.hypot(b.xM - c0.xM, b.yM - c0.yM);
      if (d < bd) {
        bd = d;
        pump = { xM: b.xM, yM: b.yM, cap: t.capacity };
      }
    }
    let n = this.layout.nextId;
    const plan = planPisteSnowmaking({ grid: this.o.grid, forest: this.o.forest, pistes, pipelines: this.layout.pipelines ?? [], pump: pump ? { xM: pump.xM, yM: pump.yM } : null, ...(pump ? { pumpCapacityM3h: pump.cap } : {}), newId: (pf) => `${pf}${n++}` }, sp);
    this.autoNextId = n;
    this.autoPlan = plan;
    const next = this.layoutWithPlan(plan);
    const prev = this.o.changePreview?.(next, this.analyzeLayout(next), null) ?? null;
    this.autoPanel.show({ pistes: pistes.map((p) => p.name), plan, chargePln: prev?.chargePln ?? null, gunNames: Object.fromEntries(sp.guns.map((g) => [g.id, g.name])) });
  }

  private layoutWithPlan(plan: AutoSnowPlan): ResortLayout {
    const next = this.clone();
    (next.pipelines ??= []).push(...plan.pipelines.map((p) => ({ ...p, points: p.points.map((q) => ({ ...q })) })));
    (next.snowGuns ??= []).push(...plan.guns.map((g) => ({ ...g })));
    next.nextId = Math.max(next.nextId, this.autoNextId);
    return next;
  }

  private buildAutoPlan(): void {
    const plan = this.autoPlan;
    if (!plan || !plan.pipelines.length) return;
    const next = this.layoutWithPlan(plan);
    const msg = `Naśnieżanie: ${plan.pipelines.length} ${plan.pipelines.length === 1 ? 'rurociąg' : 'rurociągi'}, ${plan.guns.length} armatek. Wykop tylko latem (V–X) – potem plan naśnieżania w panelu „Naśnieżanie”.`;
    if (this.commit(next, msg)) {
      this.autoSel = [];
      this.autoPlan = null;
      this.autoPanel.hide();
      this.setTool('select');
      this.message = msg;
      this.refreshPanel();
    }
  }

  // ------------------------------------------------------------------ etap 7f: ulepszanie i przesuwanie

  /** „Ulepsz” z karty obiektu: wyciąg (typ), armatka (typ), trasa (poszerzenie). */
  upgradeObject(kind: SelKind, id: string, value: string | null): void {
    const fmt = (v: number) => `${Math.round(v).toLocaleString('pl-PL')} zł`;
    let next: ResortLayout | null = null;
    let what = '';
    if (kind === 'lift' && value) {
      const l = this.layout.lifts.find((x) => x.id === id);
      if (!l) return;
      const chk = liftUpgradeCheck(l, value, this.o.liftParams);
      if (!chk.ok) {
        this.message = `Nie da się: ${chk.reason}.`;
        this.refreshPanel();
        return;
      }
      next = this.clone();
      next.lifts = next.lifts.map((x) => (x.id === id ? upgradeLift(this.o.grid, this.o.liftParams, l, value) : x));
      what = `${l.name} → ${liftTypeById(this.o.liftParams, value).name}`;
    } else if (kind === 'gun' && value) {
      next = upgradeGun(this.clone(), id, value);
      what = `armatka ${id} → ${this.o.snowmaking?.guns.find((g) => g.id === value)?.name ?? value}`;
    } else if (kind === 'piste') {
      const p = this.layout.pistes.find((x) => x.id === id);
      if (!p) return;
      if (!canWiden(p, this.o.pisteParams)) {
        this.message = `Trasa ${p.name} ma już największą szerokość (${this.o.pisteParams.maxWidthM} m).`;
        this.refreshPanel();
        return;
      }
      next = this.clone();
      next.pistes = next.pistes.map((x) => (x.id === id ? widenPiste(x, this.o.pisteParams) : x));
      what = `trasa ${p.name} szersza o ${this.o.pisteParams.widenStepM} m`;
    }
    if (!next) return;
    const a = this.analyzeLayout(next);
    if (kind === 'lift') {
      const la = a.lifts.get(id);
      const err = la?.issues.find((i) => i.severity === 'error');
      if (err) {
        this.message = `Nie da się: ${err.message}.`;
        this.refreshPanel();
        return;
      }
    }
    const oldCost = kind === 'lift' ? this.analysis.lifts.get(id)?.cost.totalPln ?? 0 : kind === 'piste' ? this.analysis.pistes.get(id)?.cost.totalPln ?? 0 : this.o.snowmaking?.guns.find((g) => g.id === (this.layout.snowGuns ?? []).find((x) => x.id === id)?.typeId)?.costPln ?? 0;
    const newCost = kind === 'lift' ? a.lifts.get(id)?.cost.totalPln ?? 0 : kind === 'piste' ? a.pistes.get(id)?.cost.totalPln ?? 0 : this.o.snowmaking?.guns.find((g) => g.id === value)?.costPln ?? 0;
    const prev = this.o.changePreview?.(next, a, id) ?? null;
    const text = `Ulepszenie: ${what}. Różnica kosztu ${newCost >= oldCost ? '+' : '−'}${fmt(Math.abs(newCost - oldCost))}${prev ? `; do zapłaty teraz ${fmt(Math.max(0, prev.chargePln))} (z opłatą za przebudowę)${prev.days ? `, przebudowa ok. ${prev.days} dni – w tym czasie obiekt nie działa` : ''}` : ''}.`;
    if (!confirm(`${text}\n\nWykonać?`)) return;
    this.commit(next, text);
  }

  /** „Przesuń” z karty obiektu: budynek (obrót co 90°) albo armatka śmigłowa. */
  startMove(kind: SelKind, id: string): void {
    const sp = this.o.snowmaking;
    if (kind === 'gun') {
      const g = (this.layout.snowGuns ?? []).find((x) => x.id === id);
      if (!g || !sp?.guns.find((t) => t.id === g.typeId)?.movable) {
        this.message = 'Lanca jest stała – usuń ją i postaw nową w innym miejscu.';
        this.refreshPanel();
        return;
      }
    } else if (kind !== 'base') return;
    const b = [...this.layout.bases, ...(this.layout.buildings ?? [])].find((x) => x.id === id) as { rotDeg?: number } | undefined;
    this.setTool('move');
    this.moving = { kind: kind === 'gun' ? 'gun' : 'base', id, before: this.clone(), rotDeg: b?.rotDeg ?? 0 };
    this.message = kind === 'gun' ? 'Przesuń armatkę: kliknij wolny hydrant. Esc – anuluj.' : 'Przesuń budynek: kliknij nowe miejsce; R albo prawy przycisk – obrót o 90°; Esc – anuluj.';
    this.refreshPanel();
  }

  private cancelMove(): void {
    const m = this.moving;
    if (!m) return;
    this.moving = null;
    this.layout = m.before;
    this.reanalyze();
  }

  private rotateMoving(): void {
    const m = this.moving;
    if (!m || m.kind !== 'base') return;
    m.rotDeg = (m.rotDeg + 90) % 360;
    const b = (this.layout.buildings ?? []).find((x) => x.id === m.id);
    if (b) {
      if (m.rotDeg) b.rotDeg = m.rotDeg;
      else delete b.rotDeg;
    }
    this.drawVersion++;
  }

  /** Podgląd przesuwanego budynku pod kursorem (bez historii – zatwierdza kliknięcie). */
  private previewMove(p: PointM): void {
    const m = this.moving;
    if (!m || m.kind !== 'base') return;
    const b = [...this.layout.bases, ...(this.layout.buildings ?? [])].find((x) => x.id === m.id);
    if (!b) return;
    b.xM = p.xM;
    b.yM = p.yM;
    this.drawVersion++;
  }

  private placeMoving(xPx: number, yPx: number, p: PointM): void {
    const m = this.moving;
    if (!m) return;
    if (m.kind === 'gun') {
      const cam = this.o.camera;
      let best: (Hydrant & { gunId: string | null }) | null = null;
      let bd = 14;
      for (const h of this.hydrants(m.before)) {
        const s2 = cam.worldToScreen(h.xM, h.yM);
        const d = Math.hypot(s2.xPx - xPx, s2.yPx - yPx);
        if (d < bd && !h.gunId) {
          bd = d;
          best = h;
        }
      }
      if (!best) {
        this.message = 'Kliknij wolny hydrant (kropka na rurociągu bez armatki).';
        this.refreshPanel();
        return;
      }
      const next = parseLayout(JSON.parse(serializeLayout(m.before)));
      const g = (next.snowGuns ?? []).find((x) => x.id === m.id);
      if (!g) return;
      g.pipelineId = best.pipelineId;
      g.hydrant = best.index;
      this.moving = null;
      this.layout = m.before;
      if (this.commit(next, 'Armatkę przestawiono na inny hydrant.')) this.select({ kind: 'gun', id: m.id });
      this.tool = 'select';
      this.o.onToolChange('select');
      return;
    }
    const next = moveBuilding(parseLayout(JSON.parse(serializeLayout(m.before))), m.id, Math.round(p.xM), Math.round(p.yM), m.rotDeg);
    const b = (next.buildings ?? []).find((x) => x.id === m.id);
    if (b) {
      const check = this.checkWaterSite(b.typeId, b.xM, b.yM, next);
      if (check.error) {
        this.message = check.error;
        this.refreshPanel();
        return;
      }
    }
    const prev = this.o.changePreview?.(next, this.analyzeLayout(next), m.id) ?? null;
    this.moving = null;
    this.layout = m.before;
    const name = [...next.bases, ...(next.buildings ?? [])].find((x) => x.id === m.id)?.name ?? '';
    const ok = this.commit(next, `Przesunięto: ${name}${prev && prev.chargePln > 0 ? ` (przeniesienie ${Math.round(prev.chargePln).toLocaleString('pl-PL')} zł${prev.days ? `, ok. ${prev.days} dni` : ''})` : ''}.`);
    this.tool = 'select';
    this.o.onToolChange('select');
    if (ok) this.select({ kind: 'base', id: m.id });
    this.refreshPanel();
  }

  // ------------------------------------------------------------------ etap 7f: nakładka (zlewnia rowu, podgląd naśnieżania)

  private selDitchCache: { key: string; a: DitchAnalysis | null } | null = null;

  private drawOverlay(): void {
    const cam = this.o.camera;
    const sel = this.selection;
    let ditch: DitchAnalysis | null = null;
    if (this.tool === 'ditch') ditch = this.ditchDraft;
    else if (sel?.kind === 'ditch') {
      const key = `${sel.id}|${this.version}`;
      if (this.selDitchCache?.key !== key) {
        const d = (this.layout.ditches ?? []).find((x) => x.id === sel.id);
        this.selDitchCache = { key, a: d ? this.analyzeDitchPts(d.points) : null };
      }
      ditch = this.selDitchCache.a;
    }
    const key = `${cam.centerXM}|${cam.centerYM}|${cam.metersPerPixel}|${cam.rotated}|${this.drawVersion}|${this.version}|${ditch ? ditch.catchment.cells.length : -1}|${this.autoPlan ? this.autoPlan.guns.length : -1}|${this.autoSel.join(',')}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    const g = this.overlayG.clear();
    const S = (x: number, y: number) => cam.worldToScreen(x, y);
    if (ditch && ditch.catchment.cells.length) {
      // Zlewnia: komórki łączone w pasy wierszy.
      const W = this.o.grid.widthCells;
      const cs = this.o.grid.cellSizeM;
      const rows = new Map<number, number[]>();
      for (const k of ditch.catchment.cells) {
        const j = Math.floor(k / W);
        let r = rows.get(j);
        if (!r) rows.set(j, (r = []));
        r.push(k - j * W);
      }
      for (const [j, is] of rows) {
        is.sort((a, b) => a - b);
        let a0 = is[0];
        let prev = is[0];
        const flush = (i0: number, i1: number) => {
          const p1 = S(i0 * cs, j * cs);
          const p2 = S((i1 + 1) * cs, j * cs);
          const p3 = S((i1 + 1) * cs, (j + 1) * cs);
          const p4 = S(i0 * cs, (j + 1) * cs);
          g.poly([p1.xPx, p1.yPx, p2.xPx, p2.yPx, p3.xPx, p3.yPx, p4.xPx, p4.yPx]).fill({ color: 0x7cc4f2, alpha: 0.28 });
        };
        for (let n = 1; n < is.length; n++) {
          if (is[n] !== prev + 1) {
            flush(a0, prev);
            a0 = is[n];
          }
          prev = is[n];
        }
        flush(a0, prev);
      }
    }
    if (ditch) {
      const pts = ditch.oriented.map((q) => S(q.xM, q.yM));
      if (pts.length >= 2) {
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width: 4, color: ditch.ok ? 0x2563eb : 0xff6b6b, cap: 'round', join: 'round' });
      }
    }
    // „Naśnież trasę”: zaznaczone trasy, rury, hydranty, armatki.
    if (this.tool === 'autoSnow') {
      for (const id of this.autoSel) {
        const p = this.layout.pistes.find((x) => x.id === id);
        if (!p) continue;
        const pts = p.points.map((q) => S(q.xM, q.yM));
        g.moveTo(pts[0].xPx, pts[0].yPx);
        for (const q of pts) g.lineTo(q.xPx, q.yPx);
        g.stroke({ width: Math.max(6, (p.points[0]?.widthM ?? 30) / cam.metersPerPixel), color: 0xff7a1a, alpha: 0.22, cap: 'round', join: 'round' });
      }
      const plan = this.autoPlan;
      const sp = this.o.snowmaking;
      if (plan && sp) {
        for (const pipe of plan.pipelines) {
          const pts = pipe.points.map((q) => S(q.xM, q.yM));
          g.moveTo(pts[0].xPx, pts[0].yPx);
          for (const q of pts) g.lineTo(q.xPx, q.yPx);
          g.stroke({ width: 5, color: 0xffffff, alpha: 0.9, cap: 'round', join: 'round' });
          g.moveTo(pts[0].xPx, pts[0].yPx);
          for (const q of pts) g.lineTo(q.xPx, q.yPx);
          g.stroke({ width: 2.5, color: 0xff7a1a, cap: 'round', join: 'round' });
          for (const h of pipelineHydrants(pipe, sp)) {
            const q = S(h.xM, h.yM);
            const gun = plan.guns.find((x) => x.pipelineId === pipe.id && x.hydrant === h.index);
            const fan = gun && sp.guns.find((t) => t.id === gun.typeId)?.movable;
            if (fan) g.circle(q.xPx, q.yPx, 5.5).fill({ color: 0x7cc4f2 }).stroke({ width: 1.5, color: 0x0f172a });
            else g.rect(q.xPx - 3.5, q.yPx - 3.5, 7, 7).fill({ color: 0xeef3f8 }).stroke({ width: 1.5, color: 0x0f172a });
          }
        }
      }
    }
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
    if (this.message && this.message !== this.lastMessage) this.o.onMessage?.(this.message);
    this.lastMessage = this.message;
    this.o.onState?.();
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

  /** Podgląd linii rysowanej punktami – od razu gładki łuk; ręką – surowy ślad. */
  private draftLine(pts: PointM[]): PointM[] {
    // Etap 7f: punktami – łamana (prosto) albo łuki; podgląd ostatniego odcinka do kursora.
    const c = this.snapRes?.point ?? this.cursorWorld;
    if (this.handStroke || !pts.length || !c) return pts;
    return [...pts, ...(this.arcCtrl ? arcPoints(pts[pts.length - 1], this.arcCtrl, c, this.o.lines.sampleStepM) : [c])];
  }

  update(cursor: { xPx: number; yPx: number } | null, timeS = performance.now() / 1000): void {
    // Podgląd: wyciąg do kursora, oś trasy do kursora.
    const key = cursor ? `${Math.round(cursor.xPx)}|${Math.round(cursor.yPx)}|${this.o.camera.centerXM}|${this.o.camera.centerYM}|${this.o.camera.metersPerPixel}` : '';
    if (key !== this.lastCursorKey && cursor) {
      this.lastCursorKey = key;
      this.cursorWorld = this.world(cursor.xPx, cursor.yPx);
      const p = SNAP_TOOLS.includes(this.tool) ? this.snapAt(cursor.xPx, cursor.yPx) : this.cursorWorld;
      if (!SNAP_TOOLS.includes(this.tool)) this.snapRes = null;
      if (p && this.liftBottom) this.updateDraftLift(p);
      if (p && (this.tool === 'pisteAxis' || this.tool === 'catwalk') && this.axisPoints.length && !this.handStroke) this.updateDraftPiste(this.axisPoints, p);
      if (p && this.tool === 'ditch' && this.ditchPoints.length && !this.handStroke) this.updateDitchDraft(p);
      if (p && this.tool === 'move') this.previewMove(p);
      if (p && SNAP_TOOLS.includes(this.tool)) {
        this.computeInfo(p);
        this.drawVersion++;
      }
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
      snowNet: this.o.snowmaking ? { hydrants: this.hydrants(), draftPipe: this.draftLine(this.pipePoints), plumes: this.plumes, cursor: this.hoverPoint } : null,
      roadDraft: this.roadPoints.length ? { points: this.draftLine(this.roadPoints), cursor: this.hoverPoint } : null,
      trailDraft: this.trailPoints.length ? { kind: this.tool === 'bikeTrail' ? 'bike' : this.tool === 'walkTrail' ? 'walk' : 'toboggan', points: this.draftLine(this.trailPoints), cursor: this.hoverPoint } : null,
      version: this.version,
      drawVersion: this.drawVersion,
      timeS,
    });
    this.drawOverlay();
  }
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
}
