/**
 * Punkt startowy gry: wczytuje ustawienia, zleca przygotowanie terenu wątkowi symulacji
 * (Web Worker), buduje mapę bazową i nakładki, liczy horyzont (cienie), uruchamia moduł słońca
 * i pogody, obsługuje przesuwanie, zoom, panele i narzędzia.
 */
import { Application, CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import mapStyleJson from '../data/map-style.json';
import radiationJson from '../data/radiation.json';
import settingsJson from '../data/settings.json';
import slopeClassesJson from '../data/slope-classes.json';
import terrainGeneratorJson from '../data/terrain-generator.json';
import weatherJson from '../data/weather-generator.json';
import snowJson from '../data/snow.json';
import liftsJson from '../data/lifts.json';
import pistesJson from '../data/pistes.json';
import constructionJson from '../data/construction.json';
import economyJson from '../data/economy.json';
import { isFoodType, parseEconomyParams, withLand, withRoads, withSnowmaking, withSummer } from './sim/economyParams';
import { parkingCapacityPersons } from './sim/economy';
import snowmakingJson from '../data/snowmaking.json';
import winterClassesJson from '../data/winter-classes.json';
import waterJson from '../data/water.json';
import summerJson from '../data/summer.json';
import { careerSeed, parseWinterClasses, winterClass, winterPercentile, winterSkiDays } from './sim/winterClass';
import { parseSnowmakingParams } from './sim/snowmakingParams';
import { wetBulbC } from './sim/snowmaking';
import { NightPlanDialog, SnowPanel, SnowPlanDialog } from './render/snowPanels';
import type { PlanPiste } from './render/snowPanels';
import { OpsView, plumesAt } from './render/opsView';
import { WeatherBook } from './sim/weatherBook';
import { parseClimateProfile } from './sim/climate';
import { parseSummerParams } from './sim/summerParams';
import type { SummerStats } from './sim/summerGuests';
import type { CardKind } from './sim/objectCards';
import { objectCard } from './sim/objectCards';
import { ObjectCardView } from './render/objectCardView';
import { SNOW_QUALITY_NAMES } from './sim/snow';
import { osmDestinations } from './sim/summerGuests';
import { annualPrecipitationMm, buildStreamNet, flowFactor, normalPrecipMm, parseWaterParams, streamAt as findStream } from './sim/water';
import type { WaterContext } from './sim/operations';
import { parseWeatherParams } from './sim/weather';
import { parseRadiationParams } from './sim/radiation';
import { parseSnowParams } from './sim/snow';
import { GameController } from './render/gameController';
import {
  addDays,
  advanceClock,
  createHorizonDem,
  parseHorizonParams,
  parseLandCover,
  parseIsoDate,
  parseMapDefinition,
  parseSimSettings,
  parseSlopeClasses,
  parseTerrainGeneratorParams,
  puwg92ToLatLon,
} from './sim';
import type { CalendarDate, HorizonDem, Location, MapDefinition } from './sim';
import { createBaseMapCanvas } from './render/baseMap';
import { TerrainRenderer } from './render/terrainRenderer';
import { MoverLayer } from './render/movers';
import { GuestController } from './render/guestController';
import { GuestClient } from './worker/guestClient';
import guestsJson from '../data/guests.json';
import { parseGuestParams } from './sim/guestParams';
import { buildGuestNet } from './sim/guestNetwork';
import { layoutFromOsm } from './sim/resort';
import { designLift } from './sim/lifts';
import { WeatherFx } from './render/weatherFx';
import { DevMenu } from './render/devMenu';
import { BuildController } from './render/buildController';
import type { SnowWarning } from './render/buildController';
import type { MapContextData, MapLabel } from './render/resortLayer';
import { ROAD_WIDTH_M, drawEditHandles } from './render/resortLayer';
import { parseLiftParams } from './sim/lifts';
import type { PointM } from './sim/lifts';
import { parsePisteParams } from './sim/pistes';
import type { OsmResort, ResortAnalysis, ResortLayout } from './sim/resort';
import { parseConstructionParams, parseRoadParams } from './sim/resort';
import { parseGroundParams } from './sim/ground';
import { parseRidingParams, thinField } from './sim/snowRiding';
import { GROUND_COLORS, SNOW_QUALITY_COLORS } from './render/colors';
import type { SnowReadoutData } from './render/hud';
import { Camera } from './render/camera';
import type { ViewCamera } from './render/camera';
import { CAMERA_KEYS } from './render3d/cameraRig';
import { FieldOverlay, fieldScale } from './render/fieldOverlay';
import type { FieldKind } from './render/fieldOverlay';
import { Hud, describePoint } from './render/hud';
import { CursorTip } from './render/cursorTip';
import type { TipContent } from './render/cursorTip';
import { MapInput } from './render/input';
import { parseMapStyle } from './render/mapStyle';
import { RELIEF_SLIDERS, getPath, parseReliefParams, setPath } from './render/relief';
import { ContourLabels } from './render/contourLabels';
import { RING_TOOLS, SlopeRing } from './render/slopeRing';
import { parseSnapParams } from './render/snapping';
import landJson from '../data/land.json';
import milestonesJson from '../data/milestones.json';
import { buildParcels, parcelAt, parcelsAlong, parseLandParams } from './sim/parcels';
import type { ParcelGrid } from './sim/parcels';
import { milestoneLabel, parseMilestoneParams, unlockSummary } from './sim/milestones';
import type { Milestone } from './sim/milestones';
import { ParcelCard, ParcelLayer } from './render/parcelView';
import { SnowTutorial } from './render/ui/snowTutorial';
import { snowChecklist } from './sim/snowChecklist';
import { SnapOverlay } from './render/snapOverlay';
import { TopBar, type GameSpeed, type SnowAtPoints } from './render/topBar';
import { BuildBar } from './render/buildBar';
import type { BuildCategory, PaletteCard } from './render/buildBar';
import uiJson from '../data/ui.json';
import { UiShell, parseScaleParams, tipAttrs } from './render/ui/shell';
import { DataViews } from './render/ui/dataViews';
import { Notifications, parseNoticeParams } from './render/ui/notifications';
import type { Notice } from './render/ui/notifications';
import { Drawer, GameMenu, UiWindow, shortcutsHtml } from './render/ui/gameMenu';
import { Minimap } from './render/ui/minimap';
import { ReportWindow } from './render/ui/reportWindow';
import { parseAdvisorParams } from './render/ui/advisor';
import { parseLineParams } from './render/lineTools';
import { formatHour } from './render/timePanel';
import { reputationOf, sumCosts, sumRevenue } from './sim/economy';
import { presenceProfile, parkingProfiles } from './sim/objectCards';
import { summerReputationOf } from './sim/summer';
import type { GuestDayReport } from './sim/guests';
import { queueLayout } from './sim/guests';
import { formatIsoDate } from './sim/time';
import detailJson from '../data/detail.json';
import { SpriteAtlas } from './render/atlasTexture';
import { PropLayer } from './render/propLayer';
import { ParticleFx, parseParticleParams } from './render/particleFx';
import { DetailView } from './render/detailView';
import { createAspectOverlayCanvas, createSlopeOverlayCanvas } from './render/overlays';
import type { OverlayKind } from './render/overlays';
import { OVERLAY_KEYS, WET_BULB_COLORS } from './render/panels';
import { ProfileTool } from './render/profileTool';
import { TimePanel } from './render/timePanel';
import type { TimeChange } from './render/timePanel';
import { parseViewSettings } from './render/viewSettings';
import { WeatherPanel } from './render/weatherPanel';
import { computeHorizonCached } from './worker/horizonPool';
import type { EnvironmentStateMessage, WorkerRequest } from './worker/protocol';
import { SimClient } from './worker/simClient';

// Wszystkie mapy z data/maps/<nazwa>/: opis dołączany do programu, pliki binarne jako osobne zasoby.
const MAP_JSONS = import.meta.glob('../data/maps/*/map.json', { eager: true, import: 'default' });
const MAP_BINARY_URLS = import.meta.glob('../data/maps/*/*.{f32,u8}', { eager: true, query: '?url', import: 'default' });
const CLIMATE_JSONS = import.meta.glob('../data/climate/*.json', { eager: true, import: 'default' });
const OSM_RESORTS = import.meta.glob('../data/maps/*/osm-resort.json', { eager: true, import: 'default' });
const OSM_TRAILS = import.meta.glob('../data/maps/*/osm-trails.json', { eager: true, import: 'default' });
const OSM_WATERS = import.meta.glob('../data/maps/*/osm-water.json', { eager: true, import: 'default' });
const OSM_CONTEXTS = import.meta.glob('../data/maps/*/osm-context.json', { eager: true, import: 'default' });
const MAP_LABELS = import.meta.glob('../data/maps/*/labels.json', { eager: true, import: 'default' });

function binaryUrl(mapName: string, file: string): string {
  const url = MAP_BINARY_URLS[`../data/maps/${mapName}/${file}`] as string | undefined;
  if (!url) throw new Error(`Brak pliku ${file} w data/maps/${mapName}/`);
  // Adres względem strony (działa także pod ścieżką GitHub Pages).
  return new URL(url, window.location.href).href;
}

function buildTerrainRequest(mapName: string, seed: number, style: ReturnType<typeof parseMapStyle>): {
  request: WorkerRequest;
  def: MapDefinition | null;
} {
  const common = { hillshade: style.hillshade, contours: style.contours };
  if (mapName === 'procedural') {
    const params = parseTerrainGeneratorParams(terrainGeneratorJson);
    return { request: { type: 'generateTerrain', map: params.grid, params, seed, ...common }, def: null };
  }
  const mapJson = MAP_JSONS[`../data/maps/${mapName}/map.json`];
  if (!mapJson) throw new Error(`Nie ma mapy „${mapName}” w data/maps/`);
  const def = parseMapDefinition(mapJson);
  return { request: { type: 'loadMap', mapJson, elevationUrl: binaryUrl(mapName, def.elevationFile), ...common }, def };
}

function textureFromCanvas(canvas: HTMLCanvasElement): Texture {
  // Mipmapy: przy oddaleniu tekstura jest gładko pomniejszana (warstwice nie migoczą).
  const source = new CanvasSource({ resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear' });
  source.style.mipmapFilter = 'linear';
  return new Texture({ source });
}

const f0 = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 0 });

async function start(): Promise<void> {
  const root = document.getElementById('app')!;
  const message = document.createElement('div');
  message.className = 'message';
  message.textContent = 'Wczytuję teren…';
  document.body.appendChild(message);

  try {
    const simSettings = parseSimSettings(settingsJson);
    const viewSettings = parseViewSettings(settingsJson);
    const style = parseMapStyle(mapStyleJson);
    const slopeClasses = parseSlopeClasses(slopeClassesJson);
    const climateJson = CLIMATE_JSONS[`../data/climate/${simSettings.climateProfile}.json`];
    if (!climateJson) throw new Error(`Brak profilu klimatycznego data/climate/${simSettings.climateProfile}.json`);
    const { request, def } = buildTerrainRequest(simSettings.mapName, simSettings.seed, style);

    const app = new Application();
    const sim = new SimClient();
    const terrainPromise = sim.prepareTerrain(request);
    await app.init({
      resizeTo: root,
      background: '#3b4856',
      // Etap 3D-1: płótno z kanałem przezroczystości (nad widokiem 3D tło znika); w 2D tło pełne.
      backgroundAlpha: 0.999,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    root.appendChild(app.canvas);
    app.renderer.background.alpha = 1;

    const { grid, hillshade, contours, timingsMs } = await terrainPromise;
    // Pokrycie terenu (las) – do mapy bazowej i modelu śniegu.
    let landCover: { forest: Float32Array; shrub: Float32Array; built?: Float32Array } | null = null;
    if (def?.landCoverFile) {
      const response = await fetch(binaryUrl(simSettings.mapName, def.landCoverFile));
      if (response.ok) landCover = parseLandCover(await response.arrayBuffer(), grid.cellCount);
    }
    message.textContent = 'Rysuję mapę…';
    await new Promise((r) => requestAnimationFrame(r));

    const t0 = performance.now();
    const borderLinesLocal = (def?.borderLines ?? []).map((line) =>
      line.map(([e, n]) => {
        const p = grid.puwg92ToLocal(e, n)!;
        return [p.xM, p.yM];
      }),
    );
    // Czcionki oprawy (etykiety na mapie rysuje PixiJS – muszą być wczytane wcześniej).
    try {
      await Promise.all([document.fonts.load('700 16px "Barlow Condensed"'), document.fonts.load('700 14px Barlow'), document.fonts.load('600 14px Barlow')]);
    } catch {
      /* bez czcionek – zastępcze */
    }
    message.remove();

    // Świat w metrach. Teren w stylu A rysuje shader (TerrainRenderer); dawna mapa topograficzna
    // (warstwice, barwy wysokości) jest nakładką do włączenia w menu „Nakładki”.
    const world = new Container();
    const fitToMap = (sprite: Sprite) => {
      sprite.width = grid.widthM;
      sprite.height = grid.heightM;
      return sprite;
    };
    const terrain = new TerrainRenderer(world, app.renderer, grid, style.illustrated, simSettings.seed, landCover?.forest ?? null, landCover?.shrub ?? null);
    // Etap 7e: czytelność rzeźby – progi cieniowania nachyleniem z klas tras (niebieska, czerwona).
    const relief = parseReliefParams(mapStyleJson);
    const reliefClasses = (() => {
      const cl = parsePisteParams(pistesJson).classes;
      return { blue: cl.find((c) => c.id === 'blue')?.maxSlopePercent ?? 25, red: cl.find((c) => c.id === 'red')?.maxSlopePercent ?? 40 };
    })();
    terrain.setRelief(relief, reliefClasses.blue, reliefClasses.red);
    // Etap 7d: warstwa detalu 1 m w korytarzach tras i jej rysowanie z bliska.
    const detail = new DetailView(world, terrain, grid, detailJson, simSettings.seed, parseGuestParams(guestsJson).snowImpact);
    let detailSummer = false;
    const dayIndex = (d: CalendarDate) => Math.round(Date.UTC(d.year, d.month - 1, d.day) / 86400000);
    let topoSprite: Sprite | null = null;
    const showTopo = (on: boolean) => {
      if (on && !topoSprite) {
        const t1 = performance.now();
        const baseCanvas = createBaseMapCanvas({ grid, hillshade, contours, borderLinesLocal, style, forest: landCover?.forest ?? null });
        timingsMs['mapa topograficzna (rysowanie)'] = Math.round(performance.now() - t1);
        topoSprite = fitToMap(new Sprite(textureFromCanvas(baseCanvas)));
        world.addChildAt(topoSprite, 1);
      }
      if (topoSprite) topoSprite.visible = on;
    };
    void t0;
    const overlaySprite = new Sprite();
    overlaySprite.alpha = style.overlayOpacity;
    world.addChild(overlaySprite);
    app.stage.addChild(world);
    // Etap 7e: opisy warstwic co 100 m (góra napisu pod górę stoku).
    const contourLabels = new ContourLabels(grid, relief.contours);
    world.addChild(contourLabels.root);
    const screenLayer = new Container(); // elementy w pikselach ekranu (np. profil)
    app.stage.addChild(screenLayer);
    // Nad liniami tras i wyciągów (warstwa ekranu): postacie i nakładka ruchu – osobny kontener
    // z przekształceniem świata.
    const worldOver = new Container();
    app.stage.addChild(worldOver);

    const camera = new Camera(grid.widthM, grid.heightM, viewSettings.minMetersPerPixel, app.screen.width, app.screen.height);
    camera.rotated = viewSettings.rotatedByDefault;
    const input = new MapInput(app.canvas, camera, viewSettings);
    // Etap 3D-1: narzędzia (budowa, wybór, profil, pierścień nachylenia, okienka) przeliczają ekran ↔ mapę
    // przez ten pośrednik – w 2D kamera mapy, w widoku 3D promień z kamery na teren.
    let cam3d: ViewCamera | null = null;
    const curCam = (): ViewCamera => cam3d ?? camera;
    const viewCam: ViewCamera = {
      get centerXM() { return curCam().centerXM; },
      get centerYM() { return curCam().centerYM; },
      get metersPerPixel() { return curCam().metersPerPixel; },
      get viewportWidthPx() { return curCam().viewportWidthPx; },
      get viewportHeightPx() { return curCam().viewportHeightPx; },
      get rotated() { return curCam().rotated; },
      get viewKey() { return curCam().viewKey; },
      screenToWorld: (x, y) => curCam().screenToWorld(x, y),
      worldToScreen: (x, y) => curCam().worldToScreen(x, y),
      centerOn: (x, y) => curCam().centerOn(x, y),
    };
    /** Kursor nad mapą 2D albo nad widokiem 3D. */
    let cursor3d: () => { xPx: number; yPx: number } | null = () => null;
    const cursorNow = () => (cam3d ? cursor3d() : input.cursor);
    // ---------------------------------------------------------------- interfejs (etap 7c)
    // Jedna warstwa #ui ze skalą; panele ciemne półprzezroczyste (zasady wyglądu w CLAUDE.md).
    const shell = new UiShell(parseScaleParams(uiJson));
    const ui = shell.root;
    const hud = new Hud(ui, viewSettings.scaleBarMaxWidthPx, style.flatSlopePercent);
    const noticeParams = parseNoticeParams(uiJson);
    const lineParams = parseLineParams(uiJson);
    const drawer = new Drawer(ui);
    const slotFinance = drawer.slot('finance', 'Finanse', 'Finanse, cennik, kredyt i zapis gry – po rozpoczęciu gry (menu → Nowa gra).');
    const slotGuests = drawer.slot('guests', 'Goście i wyciągi');
    const slotSnow = drawer.slot('snow', 'Naśnieżanie i ratraki', 'Naśnieżanie i ratraki – po rozpoczęciu gry.');
    const slotObjects = drawer.slot('objects', 'Obiekty ośrodka');
    const pisteClassesLegend = parsePisteParams(pistesJson).classes.map((c) => ({ name: c.name, color: c.color }));
    const cursorTip = new CursorTip(document.body);
    let topoOn = false;
    // Etap 7g: widok działek (ustawiane, gdy gotowa siatka działek – po sieci cieków).
    let dataViewParcels: () => void = () => {};
    let parcelClick: (x: number, y: number) => boolean = () => false;
    let parcelFrame: () => void = () => {};
    const dataViews = new DataViews(ui, slopeClasses, style.flatSlopePercent, pisteClassesLegend, {
      onOverlay: (kind) => setOverlay(kind),
      onProfile: () => {
        if (!profile.active) build.setTool('select');
        profile.toggle();
      },
      onTip: () => {
        cursorTip.setEnabled(!cursorTip.enabled);
        dataViews.setTipActive(cursorTip.enabled);
      },
      onTopo: (on) => {
        topoOn = on;
        showTopo(topoOn);
      },
      onNetwork: () => build.toggleNetwork(),
      onReality: () => build.toggleReality(),
      onParcels: () => dataViewParcels(),
      onReliefLayers: (layers) => {
        terrain.setReliefLayers(layers);
        contourLabels.enabled = layers.contours;
      },
    });
    // Etap 7e: kreski spadku i warstwice – stan zapamiętany w przeglądarce.
    {
      const layers = dataViews.loadReliefLayers();
      terrain.setReliefLayers(layers);
      contourLabels.enabled = layers.contours;
    }
    const legend = dataViews.legend;
    dataViews.setTipActive(cursorTip.enabled);
    const notices = new Notifications(ui, noticeParams);
    dataViews.onLegendVisible = (v) => notices.setOffset(v);
    notices.onJump = (at) => viewCam.centerOn(at.xM, at.yM);

    // ---------------------------------------------------------------- nakładki
    const staticTextures = new Map<OverlayKind, Texture>();
    // Etap 3D-1: ta sama nakładka jako tekstura terenu 3D (płótno + numer zmiany).
    const staticCanvases = new Map<OverlayKind, HTMLCanvasElement>();
    let overlay3d: { canvas: HTMLCanvasElement; version: () => number } | null = null;
    const field = new FieldOverlay(grid);
    let overlay: OverlayKind = 'none';
    let lastState: EnvironmentStateMessage | null = null;
    let radiationSum: { date: CalendarDate; values: Float32Array } | null = null;
    let radiationRequest = 0;
    const isField = (k: OverlayKind): k is FieldKind | 'snowQuality' | 'ground' | 'wetBulb' =>
      k === 'insolation' || k === 'radiationSum' || k === 'temperature' || k === 'snowDepth' || k === 'snowQuality' || k === 'traffic' || k === 'ground' || k === 'wetBulb';
    // Natężenie ruchu gości (nakładka 9) – odświeżane co sekundę z wątku gości.
    let trafficTimer = 0;
    let trafficValues: Float32Array | null = null;
    function trafficTick(dtS: number): void {
      trafficTimer -= dtS;
      if (trafficTimer > 0) return;
      trafficTimer = 1;
      void guestsRef.current?.traffic().then((v) => {
        trafficValues = v;
        if (overlay === 'traffic') refreshField();
      });
    }
    const guestsRef: { current: GuestController | null } = { current: null };
    let lastSnow: (SnowReadoutData & { date: CalendarDate; moguls?: Uint8Array; hour?: number }) | null = null;
    const fmtDate = (d: CalendarDate) => `${d.day}.${String(d.month).padStart(2, '0')}.${d.year}`;
    const sameDate = (a: CalendarDate, b: CalendarDate) => a.year === b.year && a.month === b.month && a.day === b.day;

    // Górny pasek (czas, saldo, goście, pogoda, prognoza, menu).
    let gameSpeed: GameSpeed = 0;
    const topBar = new TopBar(ui, {
      onSpeed: (sp) => setGameSpeed(sp),
      onMenu: () => gameMenu.toggle(),
      onFinance: () => drawer.toggle('finance'),
      onGuests: () => drawer.toggle('guests'),
      onPrices: () => (game?.state ? game.showPrices() : drawer.show('finance')),
      onSnow: () => drawer.toggle('snow'),
      onMilestones: () => infoWindow.show('Kamienie milowe', milestonesHtml()),
    });
    topBar.setThawThreshold(noticeParams.thawWarnC);

    // Gra (etap 6) – tworzona niżej, gdy gotowe są budowa i goście.
    let game: GameController | null = null;
    /** Etap 6b (woda): potok pod kursorem – ustawiane, gdy warstwa cieków jest gotowa. */
    let streamAt: ((xM: number, yM: number) => { title: string; lines: string[] } | null) | null = null;
    const timePanel = new TimePanel(
      topBar.details,
      { date: parseIsoDate(simSettings.startDate), hour: simSettings.startHour },
      simSettings.playDayDurationS,
      (t) => {
        requestState(t);
        game?.onDateChange(t.date, t.hour);
      },
    );
    const weatherPanel = new WeatherPanel(topBar.weatherPop);
    function setGameSpeed(sp: GameSpeed): void {
      gameSpeed = sp;
      topBar.setSpeed(sp);
      if (sp > 0) {
        timePanel.stopPlay();
        timePanel.setSeasonPlaying(false);
      }
    }
    setGameSpeed(0);
    const profile = new ProfileTool(screenLayer, ui, grid, viewCam, slopeClasses, (active) => {
      dataViews.setProfileActive(active);
      app.canvas.classList.toggle('tool-profile', active);
    });

    // ---------------------------------------------------------------- budowa ośrodka
    let onLandCoverChange: (forest: Float32Array, shrub: Float32Array) => void = () => {};
    // Goście dostają sieć ośrodka po każdej zmianie układu (ustawiane niżej, gdy kontroler gości gotowy).
    let onGuestLayout: (layout: ResortLayout, analysis: ResortAnalysis) => void = () => {};
    const liftParams = parseLiftParams(liftsJson);
    const ridingParams = parseRidingParams(snowJson);
    const snowmakingParams = parseSnowmakingParams(snowmakingJson);
    const roadParams = parseRoadParams(constructionJson);
    const summerParams = parseSummerParams(summerJson);
    const landParams = parseLandParams(landJson);
    const milestoneParams = parseMilestoneParams(milestonesJson);
    const economyParams = withLand(withSummer(withRoads(withSnowmaking(parseEconomyParams(economyJson), snowmakingParams), roadParams), summerParams), landParams, milestoneParams);
    // Etap 7g: działki (budowane po sieci cieków) – do tego czasu brak ograniczeń.
    let parcelGrid: ParcelGrid | null = null;
    // Etap 6b: drogi publiczne z OSM (dojazd do parkingów).
    const publicRoads: PointM[][] = (((OSM_CONTEXTS[`../data/maps/${simSettings.mapName}/osm-context.json`] as { roads?: { kind: string; points: [number, number][] }[] } | undefined)?.roads) ?? [])
      .filter((r) => roadParams.publicRoadKinds.includes(r.kind))
      .map((r) => r.points.map(([e, n]) => grid.puwg92ToLocal(e, n)).filter((q): q is PointM => q !== null))
      .filter((l) => l.length >= 2);
    // Etap 7b: karta obiektu – otwierana po kliknięciu obiektu (ustawiane niżej, gdy gra gotowa).
    let onCardSelect: (sel: { kind: string; id: string } | null) => void = () => {};
    // Ostrzeżenia „za mało śniegu” → panel gości (ustawiane niżej, gdy kontroler gości gotowy).
    let onSnowWarnings: (w: SnowWarning[]) => void = () => {};
    // Dolne menu budowy – tworzone niżej (po kontrolerze budowy); wywołania zwrotne do tego czasu nic nie robią.
    let buildBar: BuildBar = null as unknown as BuildBar;
    const cardSelRef: { close: (() => void) | null } = { close: null };
    const build = new BuildController({
      grid,
      camera,
      view: viewCam,
      world,
      screenLayer,
      panelParent: slotObjects,
      profileParent: ui,
      lines: lineParams,
      snap: parseSnapParams(uiJson),
      changePreview: (next, a, id) => game?.changePreview(next, a, id) ?? null,
      missingParcels: (pts) => {
        const owned = game?.ownedParcels;
        if (!owned || !parcelGrid) return [];
        return [...parcelsAlong(parcelGrid, pts)].filter((id) => id !== '?' && !(id in owned)).sort();
      },
      onMessage: (text) => buildBar?.showToast(text),
      onState: () => buildBar?.setState(build.barState),
      liftParams,
      pisteParams: parsePisteParams(pistesJson),
      clearing: parseConstructionParams(constructionJson).clearing,
      ground: parseGroundParams(constructionJson),
      riding: ridingParams,
      onSnowWarnings: (w) => onSnowWarnings(w),
      beforeCommit: (next, a) => game?.beforeCommit(next, a) ?? null,
      onSelect: (sel) => onCardSelect(sel),
      buildingTypes: [
        ...economyParams.buildings.map((b) => ({ id: b.id, name: b.name, base: b.base, costPln: b.costPln })),
        ...snowmakingParams.buildings.map((b) => ({ id: b.id, name: `${b.name}${b.summerOnly ? ' (budowa V–X)' : ''}`, base: false, costPln: b.costPln })),
        ...summerParams.buildings.map((b) => ({ id: b.id, name: `${b.name} (lato)`, base: false, costPln: b.costPln })),
      ],
      snowmaking: snowmakingParams,
      summer: summerParams,
      roads: roadParams,
      publicRoads: publicRoads.length ? publicRoads : null,
      forest: landCover?.forest ?? null,
      shrub: landCover?.shrub ?? null,
      osm: (OSM_RESORTS[`../data/maps/${simSettings.mapName}/osm-resort.json`] as OsmResort | undefined) ?? null,
      storageKey: `ski-sim:osrodek:${simSettings.mapName}`,
      lod: style.illustrated.lod,
      context: (OSM_CONTEXTS[`../data/maps/${simSettings.mapName}/osm-context.json`] as MapContextData | undefined) ?? null,
      labels: ((MAP_LABELS[`../data/maps/${simSettings.mapName}/labels.json`] as { labels?: MapLabel[] } | undefined)?.labels ?? []),
      borderLinesLocal,
      onLandCover: (f, sh) => onLandCoverChange(f, sh),
      onLayoutChange: (layout, analysis) => {
        detail.setLayout(layout, analysis, detailSummer);
        if (buildBar) refreshMinimapLayout();
        terrain.setLayout(layout, new Map([...analysis.pistes].map(([id, a]) => [id, a.axis.filter((x) => !Number.isNaN(x.elevationM))])), liftParams);
        if (game?.state) game.onLayoutChange(layout, analysis);
        else onGuestLayout(layout, analysis);
        sendGuestSnow();
        if (overlay === 'ground') refreshField();
      },
      onToolChange: (tool) => {
        if (tool === 'select' && buildBar?.openCategory && buildBar.openCategory !== 'reports' && buildBar.openCategory !== 'clearing') buildBar.close();
        buildBar?.setState(build.barState);
        if (tool !== 'select' && cardSelRef.close) cardSelRef.close();
        app.canvas.classList.toggle('tool-build', tool !== 'select');
        if (tool !== 'select') profile.setActive(false);
      },
    });


    // ---------------------------------------------------------------- dolne menu budowy (etap 7c)
    const mln = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mln zł` : `${Math.round(v / 1000).toLocaleString('pl-PL')} tys. zł`);
    const LIFT_ART: Record<string, string> = { tasma: 'carpet', talerzyk: 'platter', orczyk: 'tbar', kanapa2s: 'chair2', kanapa4s: 'chair4', kanapa4d: 'chair4', kanapa6d: 'chair6', gondola: 'gondola' };
    const SNOW_ART: Record<string, string> = { intake: 'supply', mains: 'pipeline', well: 'tank', catchment: 'supply', reservoir: 'tank', pump: 'pipeline', grid: 'building', garage: 'building', anchor: 'info' };
    const SNOW_UNIT: Record<string, string> = { intake: 'm³/h', mains: 'm³/h', well: 'm głębokości', catchment: 'm² zlewni', reservoir: 'm³', pump: 'm³/h', grid: 'kW', garage: 'ratraki', anchor: 'm liny' };
    const f0n = (v: number) => Math.round(v).toLocaleString('pl-PL');
    const buildingCard = (id: string, name: string, art: string, param: string, costPln: number, lockKey?: string): PaletteCard => ({ id: `b-${id}`, art, name, param, price: mln(costPln), tool: 'base', sub: { kind: 'building', id }, key: 'B', ...(lockKey ? { lockKey } : {}) });
    const categories: BuildCategory[] = [
      {
        id: 'lifts',
        label: 'Wyciągi',
        icon: 'lift',
        key: 'L',
        tip: 'Wyciągi i koleje: kliknij dolną stację, potem górną',
        cards: liftParams.types.map((t) => ({
          id: `l-${t.id}`,
          art: LIFT_ART[t.id] ?? 'chair4',
          name: t.name.replace(' (stałe chwytaki)', '').replace('Wyciąg ', '').replace(/^./, (c) => c.toUpperCase()),
          param: `${f0n(t.capacityPerHour)} os./h`,
          price: `1 km ≈ ${mln(t.stationCostPln + 1000 * t.costPerMeterPln + Math.ceil(1000 / t.maxSpanM) * t.towerCostPln)}`,
          tool: 'lift' as const,
          sub: { kind: 'lift' as const, id: t.id },
          key: 'L',
          lockKey: `lift:${t.id}`,
          tip: `${t.name}: ${f0n(t.capacityPerHour)} os./h, ${t.speedMs.toLocaleString('pl-PL')} m/s; cena orientacyjna dla 1 km (stacje, lina, podpory)`,
        })),
      },
      {
        id: 'pistes',
        label: 'Trasy',
        icon: 'piste',
        key: 'T',
        tip: 'Trasy narciarskie: rysuj ręką albo klikaj punkty (O przełącza)',
        options: ['draw', 'width', 'grade'],
        cards: [
          { id: 'piste', art: 'piste', name: 'Trasa narciarska', param: 'klasa z nachylenia', price: `${parsePisteParams(pistesJson).gradingCostPlnPerM2} zł/m² + wycinka`, tool: 'pisteBrush', key: 'T', tip: 'Trasa: przeciągnij myszą z góry na dół (albo klikaj punkty). Linia sama się uprości i wygładzi.' },
          { id: 'catwalk', art: 'catwalk', name: 'Nartostrada', param: `${parsePisteParams(pistesJson).catwalkWidthM} m, do ${parsePisteParams(pistesJson).catwalkMaxSlopePercent} %`, price: 'łatwy łącznik', tool: 'catwalk', key: 'U', tip: 'Wąski, łagodny łącznik między trasami i wyciągami' },
        ],
      },
      {
        id: 'snow',
        label: 'Naśnieżanie',
        icon: 'snow',
        key: 'H',
        tip: 'Rurociąg z hydrantami, armatki, woda, zbiorniki, pompownie, przyłącza, ratraki',
        options: ['draw'],
        cards: [
          { id: 'autoSnow', art: 'fan', name: 'Naśnież trasę', param: 'rury, hydranty, armatki', price: 'jednym kliknięciem', tool: 'autoSnow', tip: 'Zaznacz trasę (albo kilka) – gra zaproponuje rurociąg wzdłuż krawędzi, hydranty, armatki i połączenie z pompownią' },
          { id: 'pipe', art: 'pipeline', name: 'Rurociąg', param: `hydrant co ${snowmakingParams.pipe.hydrantSpacingM} m`, price: `${f0n(snowmakingParams.pipe.costPlnPerM)} zł/m`, tool: 'pipeline', key: 'H', tip: 'Od pompowni wzdłuż trasy; wykop tylko latem (V–X)' },
          { id: 'supply', art: 'supply', name: 'Rura zasilająca', param: 'źródło → zbiornik', price: `${f0n(snowmakingParams.pipe.supplyCostPlnPerM)} zł/m`, tool: 'supply', key: 'F', tip: 'Od ujęcia, studni albo wodociągu do zbiornika' },
          ...snowmakingParams.guns.map((g) => ({ id: `g-${g.id}`, art: g.movable ? 'fan' : 'lance', name: g.name, param: `od ${g.curveWetBulbC[0].toLocaleString('pl-PL')} °C (temp. mokra)`, price: mln(g.costPln), tool: 'gun' as const, sub: { kind: 'gun' as const, id: g.id }, key: 'J', lockKey: `gun:${g.id}`, tip: `${g.name}: kliknij hydrant na rurociągu` })),
          ...snowmakingParams.buildings.filter((b) => b.kind !== 'catchment').map((b) => buildingCard(b.id, b.name, SNOW_ART[b.kind] ?? 'building', `${f0n(b.capacity)} ${SNOW_UNIT[b.kind] ?? ''}${b.summerOnly ? ', budowa V–X' : ''}`, b.costPln, `building:${b.id}`)),
          { id: 'ditch', art: 'supply', name: 'Rów zbierający', param: 'spływ do zbiornika', price: `${f0n(snowmakingParams.ditch.costPlnPerM)} zł/m`, tool: 'ditch', tip: 'Rów ze spadkiem do zbiornika – zbiera deszcz i roztopy z obszaru powyżej siebie (niebieskie pole). Wykop tylko latem (V–X)' },
        ],
      },
      {
        id: 'roads',
        label: 'Drogi',
        icon: 'road',
        key: 'E',
        tip: 'Droga dojazdowa do parkingu – od drogi publicznej',
        options: ['draw'],
        cards: [{ id: 'road', art: 'road', name: 'Droga dojazdowa', param: `do ${roadParams.maxSlopePercent} %, zimą odśnieżanie`, price: `${f0n(roadParams.costPlnPerM)} zł/m`, tool: 'road', key: 'E', tip: 'Od drogi publicznej (szarej) albo innej drogi do parkingu' }],
      },
      {
        id: 'buildings',
        label: 'Budynki',
        icon: 'home',
        key: 'B',
        tip: 'Parking, gastronomia, wypożyczalnia, szkółka, transport do schroniska',
        cards: economyParams.buildings.map((b) => buildingCard(b.id, b.name, b.base ? 'parking' : isFoodType(b.id) ? 'food' : 'building', b.base ? `${f0n(b.cars)} aut` : `${f0n(b.capacityPerDay)} os./dzień`, b.costPln, `building:${b.id}`)),
      },
      {
        id: 'summer',
        label: 'Lato',
        icon: 'sun',
        key: 'X',
        tip: 'Atrakcje letnie: bike park, ścieżki, tor saneczkowy, plac zabaw, punkt widokowy',
        options: ['draw'],
        cards: [
          { id: 'bike', art: 'bike', name: 'Trasa rowerowa', param: 'trudność z nachylenia', price: `${f0n(summerParams.bike.buildPlnPerM)} zł/m`, tool: 'bikeTrail', key: 'X', lockKey: 'bike', tip: 'Od górnej stacji kolei z wieszakami w dół' },
          { id: 'walk', art: 'walk', name: 'Ścieżka spacerowa', param: 'łączy szlaki i stacje', price: `${f0n(summerParams.walk.buildPlnPerM)} zł/m`, tool: 'walkTrail', key: 'Q', lockKey: 'walk' },
          { id: 'toboggan', art: 'toboggan', name: 'Tor saneczkowy', param: `${summerParams.toboggan.minSlopePercent}–${summerParams.toboggan.maxSlopePercent} %, cały rok`, price: `od ${mln(summerParams.toboggan.fixedCostPln)}`, tool: 'toboggan', key: 'C', lockKey: 'toboggan' },
          ...summerParams.buildings.map((b) => buildingCard(b.id, b.name, b.id === 'playground' ? 'playground' : 'view', `${f0n(b.capacity)} os.`, b.costPln, b.id)),
        ],
      },
      {
        id: 'clearing',
        label: 'Wycinka',
        icon: 'tree',
        tip: 'Wycinka lasu – liczona sama pod wyciągami i trasami',
        cards: [{ id: 'clear', art: 'tree', name: 'Wycinka pod budowę', param: 'sama pod wyciągami i trasami', price: 'w koszcie obiektu', disabled: 'Wycinka jest liczona sama pod wyciągami i trasami (przecinki widać na mapie). Ręczna wycinka – później.' }],
      },
      {
        id: 'demolish',
        label: 'Rozbiórka',
        icon: 'trash',
        sep: true,
        tip: 'Rozbiórka: kliknij obiekt na mapie',
        cards: [{ id: 'demolish', art: 'info', name: 'Rozbierz obiekt', param: 'kliknij obiekt na mapie', price: 'część kosztu przepada', tool: 'demolish', key: 'Delete', tip: 'Kliknij wyciąg, trasę, budynek, rurociąg albo drogę. Zaznaczony obiekt usuwa też klawisz Delete.' }],
      },
      {
        id: 'reports',
        label: 'Raporty',
        icon: 'chart',
        tip: 'Raport dnia, tygodnia i sezonu z doradcą',
        cards: [
          { id: 'rDay', art: 'info', name: 'Raport dnia', param: 'goście, pieniądze, wyciągi', price: 'z doradcą', action: 'report:day' },
          { id: 'rWeek', art: 'info', name: 'Raport tygodnia', param: '7 ostatnich dni', price: 'z doradcą', action: 'report:week' },
          { id: 'rSeason', art: 'info', name: 'Raport sezonu', param: 'rok gry od 1 maja', price: 'z doradcą', action: 'report:season' },
          { id: 'rFin', art: 'info', name: 'Finanse', param: 'saldo, kredyt, zapis', price: 'panel', action: 'drawer:finance' },
          { id: 'rObj', art: 'info', name: 'Obiekty ośrodka', param: 'lista, sieć tras, plik układu', price: 'panel', action: 'drawer:objects' },
        ],
      },
    ];
    buildBar = new BuildBar(ui, categories, {
      onCard: (k) => {
        profile.setActive(false);
        if (k.sub?.kind === 'lift') build.setLiftType(k.sub.id);
        else if (k.sub?.kind === 'building') build.setBuildingType(k.sub.id);
        else if (k.sub?.kind === 'gun') build.setGunType(k.sub.id);
        else if (k.tool) build.setTool(k.tool);
      },
      onClose: () => build.setTool('select'),
      onAction: (a) => uiAction(a),
      onDrawMode: (m) => build.setDrawMode(m),
      onWidth: (w) => build.setWidth(w),
      onGradeNew: (on) => build.setGradeNew(on),
      onUndo: () => build.undoLast(),
      onRedo: () => build.redoLast(),
      lockReason: (key) => game?.lockReason(key) ?? null,
    }, { compactBelowPx: (uiJson as unknown as { buildBar: { compactBelowPx: { value: number } } }).buildBar.compactBelowPx.value });
    buildBar.setState(build.barState);

    // ---------------------------------------------------------------- minimapa, menu, okna (etap 7c)
    const minimap = new Minimap(ui, grid, hillshade, landCover?.forest ?? null, camera, {
      onRotate: () => camera.toggleRotation(),
      onZoom: (f) => camera.zoomAt(camera.viewportWidthPx / 2, camera.viewportHeightPx / 2, f),
    });
    minimap.setPisteColors(pisteClassesLegend.map((c) => c.color));
    const refreshMinimapLayout = () => minimap.setLayout(build.current.layout, (id) => build.current.analysis.pistes.get(id)?.classIndex ?? 1);
    refreshMinimapLayout();
    const infoWindow = new UiWindow(ui);
    // Etap 7g: kamienie milowe – okno z listą (progi, co odblokowują) i okno po osiągnięciu.
    const unlockNames = {
      lift: (id: string) => liftParams.types.find((t) => t.id === id)?.name ?? id,
      gun: (id: string) => snowmakingParams.guns.find((g) => g.id === id)?.name ?? id,
      building: (id: string) => economyParams.buildings.find((b) => b.id === id)?.name ?? snowmakingParams.buildings.find((b) => b.id === id)?.name ?? summerParams.buildings.find((b) => b.id === id)?.name ?? id,
    };
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    function milestonesHtml(): string {
      const st = game?.state;
      const cur = st?.mode === 'career' ? (st.progress?.milestone ?? 0) : milestoneParams.milestones.length - 1;
      const pr = game?.milestoneProgress();
      const head = st?.mode === 'sandbox' ? '<p class="muted">Piaskownica – wszystko odblokowane.</p>' : pr?.next ? `<p>Do „${esc(pr.next.name)}”: ${pr.parts.map((x) => `${x.label} ${x.text}`).join(' · ')}</p>` : '<p>Najwyższy kamień milowy osiągnięty.</p>';
      return `${head}<div class="u-ms-list">${milestoneParams.milestones
        .map((m: Milestone, i: number) => `<div class="u-ms-item ${i < cur ? 'done' : i === cur ? 'cur' : ''}"><h3>${i <= cur ? '✓ ' : ''}${esc(m.name)}</h3><div class="muted small">${i === 0 ? 'start kariery' : esc(milestoneLabel(m).replace(`${m.name} – `, 'progi: '))}</div><ul>${unlockSummary(m, unlockNames).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`)
        .join('')}</div>`;
    }
    function showMilestoneReached(ms: Milestone[]): void {
      const m = ms[ms.length - 1];
      infoWindow.show(`Kamień milowy: ${m.name}`, `<p>Gratulacje! Twój ośrodek to teraz <b>${esc(m.name)}</b>. Odblokowane:</p><ul>${ms.flatMap((x) => unlockSummary(x, unlockNames)).map((t) => `<li>${esc(t)}</li>`).join('')}</ul><p class="muted">Nowe karty są już dostępne w dolnym menu budowy; kolejne działki kupisz w widoku „Działki”.</p>`);
    }
    const loadInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    loadInput.addEventListener('change', () => {
      if (loadInput.files?.[0]) void game?.loadFile(loadInput.files[0]);
      loadInput.value = '';
    });
    const scaleHtml = () =>
      `<p class="muted">Skala paneli, przycisków i napisów. „Automatycznie” – według szerokości okna (1366 px → ok. 75 %, 1920 px → 100 %, 2560 px → ok. 130 %).</p><div class="u-seg big u-scale-opts">${['auto', ...shell.scaleOptions]
        .map((o) => `<button type="button" data-scale="${o}" class="${String(shell.scaleChoice) === String(o) ? 'active' : ''}">${o === 'auto' ? `Automatycznie (${Math.round(shell.scale * 100)} %)` : `${Math.round(Number(o) * 100)} %`}</button>`)
        .join('')}</div>`;
    infoWindow.body.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sc = t.closest<HTMLElement>('[data-scale]')?.dataset.scale;
      if (sc) {
        shell.setScale(sc === 'auto' ? 'auto' : Number(sc));
        infoWindow.body.innerHTML = scaleHtml();
        return;
      }
      const h = t.closest<HTMLElement>('[data-h]');
      if (h) {
        const n = notices.history[Number(h.dataset.h)];
        if (n?.at) {
          infoWindow.hide();
          viewCam.centerOn(n.at.xM, n.at.yM);
        }
      }
    });
    const gameMenu = new GameMenu(
      ui,
      [
        { id: 'report', icon: 'chart', label: 'Raporty (dzień, tydzień, sezon)' },
        { id: 'finance', icon: 'coins', label: 'Finanse i kredyt' },
        { id: 'prices', icon: 'tag', label: 'Cennik i godziny' },
        { id: 'guests', icon: 'people', label: 'Goście i wyciągi' },
        { id: 'snow', icon: 'snow', label: 'Naśnieżanie i ratraki' },
        { id: 'tutorial', icon: 'info', label: 'Samouczek naśnieżania' },
        { id: 'milestones', icon: 'star', label: 'Kamienie milowe' },
        { id: 'view3d', icon: 'terrain', label: 'Widok 3D', key: 'F3' },
        { id: 'objects', icon: 'layers', label: 'Obiekty ośrodka i plik układu' },
        { id: 'history', icon: 'bell', label: 'Historia powiadomień', sep: true },
        { id: 'save', icon: 'save', label: 'Zapisz grę do pliku', sep: true },
        { id: 'load', icon: 'folder', label: 'Wczytaj grę z pliku' },
        { id: 'new', icon: 'play', label: 'Nowa gra' },
        { id: 'scale', icon: 'settings', label: 'Skala interfejsu', sep: true },
        { id: 'compact', icon: 'layers', label: 'Menu budowy: kompaktowe / pełne' },
        { id: 'keys', icon: 'info', label: 'Skróty klawiszowe' },
        { id: 'dev', icon: 'wrench', label: 'Menu deweloperskie', key: '`' },
      ],
      (id) => uiAction(`menu:${id}`),
    );
    const guestReports = new Map<string, GuestDayReport>();
    const openBuild = (id: string) => {
      if (buildBar.openCategory !== id) buildBar.toggleCategory(id);
    };
    /** Akcje z menu, palety, raportu i doradcy. */
    function uiAction(a: string): void {
      const [kind, arg] = a.split(':');
      if (kind === 'report') reportWindow.show(arg as 'day' | 'week' | 'season');
      else if (kind === 'drawer') drawer.show(arg);
      else if (kind === 'menu') {
        if (arg === 'report') reportWindow.show('day');
        else if (arg === 'finance' || arg === 'guests' || arg === 'snow' || arg === 'objects') drawer.show(arg);
        else if (arg === 'prices') (game?.state ? game.showPrices() : drawer.show('finance'));
        else if (arg === 'history') infoWindow.show('Historia powiadomień', notices.historyHtml());
        else if (arg === 'tutorial') snowTutorial.start();
        else if (arg === 'milestones') infoWindow.show('Kamienie milowe', milestonesHtml());
        else if (arg === 'view3d') void toggle3D();
        else if (arg === 'compact') {
          buildBar.setCompact(!buildBar.compact);
          buildBar.showToast(buildBar.compact ? 'Menu budowy: tryb kompaktowy.' : 'Menu budowy: pełne karty.');
        }
        else if (arg === 'save') (game?.state ? game.saveFile() : buildBar.showToast('Najpierw zacznij grę (menu → Nowa gra).'));
        else if (arg === 'load') loadInput.click();
        else if (arg === 'new') void game?.showStart();
        else if (arg === 'scale') infoWindow.show('Skala interfejsu', scaleHtml());
        else if (arg === 'keys') infoWindow.show('Skróty klawiszowe', shortcutsHtml());
        else if (arg === 'dev') devMenu.toggle();
      }
    }

    function refreshField(): void {
      if (!isField(overlay)) return;
      if (overlay === 'traffic') {
        const scale = fieldScale('traffic', style);
        if (trafficValues) field.update(trafficValues, scale, 1);
        legend.setFieldInfo(scale, trafficValues ? 'przejazdy gości przez miejsce na godzinę (ostatnie pół godziny); przezroczyste – mniej niż 1/h' : 'czekam na gości…');
        return;
      }
      if (overlay === 'ground') {
        const g = build.groundMap;
        if (g) field.updateCategorical(Uint8Array.from(g, (v) => v + 1), GROUND_COLORS);
        legend.setFieldInfo(null, 'po budowie: wycięty las – pniaki, dopóki trasa nie zostanie wyrównana (opcja w profilu trasy)');
        return;
      }
      if (overlay === 'wetBulb') {
        if (!lastState) {
          legend.setFieldInfo(null, 'liczę…');
          return;
        }
        // Temperatura mokra z temperatury komórki i wilgotności (średnia dół/góra – zmienia się z wysokością słabo).
        const rh = (lastState.bottom.now.humidityPercent + lastState.top.now.humidityPercent) / 2;
        const startFan = Math.max(...snowmakingParams.guns.map((g) => g.curveWetBulbC[0]));
        const startAll = Math.min(...snowmakingParams.guns.map((g) => g.curveWetBulbC[0]));
        const cold = snowmakingParams.snow.densityColdWetBulbC;
        const t = lastState.temperatureC;
        const codes = new Uint8Array(t.length);
        for (let k = 0; k < t.length; k++) {
          if (Number.isNaN(t[k])) continue;
          const w = wetBulbC(t[k], rh);
          codes[k] = w > startFan ? 1 : w > startAll ? 2 : w > cold ? 3 : 4;
        }
        field.updateCategorical(codes, WET_BULB_COLORS);
        const tw = (x: number) => wetBulbC(x, rh).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
        legend.setFieldInfo(
          null,
          `wilgotność ${f0(rh)} %; temp. mokra: dół ${f0(lastState.bottom.elevationM)} m ${tw(lastState.bottom.now.temperatureC)} °C, góra ${f0(lastState.top.elevationM)} m ${tw(lastState.top.now.temperatureC)} °C${lastState.bottom.now.temperatureC < lastState.top.now.temperatureC ? ' – inwersja: na dole zimniej' : ''}. Progi: armatka śmigłowa od ${startFan} °C, lanca od ${startAll} °C, suchy śnieg poniżej ${cold} °C.`,
        );
        return;
      }
      if (overlay === 'snowDepth' || overlay === 'snowQuality') {
        if (!lastSnow) {
          legend.setFieldInfo(null, 'liczę śnieg…');
          return;
        }
        const info = `${lastSnow.hour !== undefined ? `${fmtDate(lastSnow.date)}, godz. ${lastSnow.hour}:00 (na żywo, kroki godzinowe)` : `koniec dnia ${fmtDate(lastSnow.date)}`}; śnieg naturalny + techniczny (naśnieżanie i ratraki z zamkniętych dni gry)`;
        if (overlay === 'snowDepth') {
          const scale = fieldScale('snowDepth', style);
          field.update(lastSnow.depthCm, scale, 0.5);
          legend.setFieldInfo(scale, info);
        } else {
          field.updateCategorical(lastSnow.quality, SNOW_QUALITY_COLORS);
          legend.setFieldInfo(null, info);
        }
        return;
      }
      const scale = fieldScale(overlay, style, overlay === 'radiationSum' ? radiationSum?.values : undefined);
      if (overlay === 'radiationSum') {
        const date = timePanel.date;
        if (radiationSum && sameDate(radiationSum.date, date)) {
          field.update(radiationSum.values, scale);
          legend.setFieldInfo(scale, `${date.day}.${String(date.month).padStart(2, '0')}.${date.year}, z zachmurzeniem z generatora pogody; cienie terenu (także Pilska po stronie słowackiej)`);
        } else {
          legend.setFieldInfo(null, 'liczę sumę dobową…');
          requestRadiationSum(date);
        }
        return;
      }
      if (!lastState) {
        legend.setFieldInfo(null, 'liczę…');
        return;
      }
      if (overlay === 'insolation') {
        field.update(lastState.insolationWm2, scale);
        const sunText = lastState.sun.elevationDeg > 0 ? `Słońce ${f0(lastState.sun.elevationDeg)}° nad horyzontem` : 'noc – Słońce pod horyzontem';
        legend.setFieldInfo(scale, `${sunText}; zachmurzenie ${f0(lastState.cloudFraction * 100)} %. Ciemne plamy w dzień to cienie terenu.`);
      } else {
        field.update(lastState.temperatureC, scale);
        legend.setFieldInfo(
          scale,
          `dół ${f0(lastState.bottom.elevationM)} m: ${lastState.bottom.now.temperatureC.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} °C · góra ${f0(lastState.top.elevationM)} m: ${lastState.top.now.temperatureC.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} °C`,
        );
      }
    }

    function requestRadiationSum(date: CalendarDate): void {
      if (!environmentReady) return;
      const id = ++radiationRequest;
      sim
        .dailyRadiation(date)
        .then((m) => {
          if (id !== radiationRequest) return; // w międzyczasie zmieniono datę
          radiationSum = { date: m.date, values: m.sumKwhM2 };
          refreshField();
        })
        .catch((e: unknown) => timePanel.setStatus(`Błąd: ${e instanceof Error ? e.message : String(e)}`));
    }

    function setOverlay(kind: OverlayKind): void {
      overlay = kind;
      if (guestsRef.current) guestsRef.current.showWaits = kind === 'liftWait';
      // Ruch na trasach – nad liniami tras (inaczej przy oddaleniu zakryty); pozostałe – pod nimi.
      if (kind === 'traffic') worldOver.addChildAt(overlaySprite, 0);
      else if (overlaySprite.parent !== world) world.addChild(overlaySprite);
      if (kind === 'none' || kind === 'liftWait') {
        overlaySprite.visible = false;
        overlay3d = null;
      } else if (isField(kind)) {
        overlay3d = { canvas: field.canvasEl, version: () => field.version };
        overlaySprite.texture = field.texture;
        fitToMap(overlaySprite);
        overlaySprite.visible = true;
        refreshField();
      } else {
        let texture = staticTextures.get(kind);
        if (!texture) {
          const canvas =
            kind === 'slope'
              ? createSlopeOverlayCanvas(grid, slopeClasses, style.overlayMetersPerPixel)
              : createAspectOverlayCanvas(grid, style.flatSlopePercent, style.overlayMetersPerPixel);
          texture = textureFromCanvas(canvas);
          staticTextures.set(kind, texture);
          staticCanvases.set(kind, canvas);
        }
        const sc = staticCanvases.get(kind);
        overlay3d = sc ? { canvas: sc, version: () => 0 } : null;
        overlaySprite.texture = texture;
        fitToMap(overlaySprite);
        overlaySprite.visible = true;
      }
      dataViews.setOverlay(kind);
    }
    setOverlay('none');

    // ---------------------------------------------------------------- słońce i pogoda
    let freshDayKey = '';
    let environmentReady = false;
    let inflight = false;
    let pendingTime: TimeChange | null = null;
    function requestState(t: TimeChange): void {
      if (!environmentReady || inflight) {
        pendingTime = t;
        return;
      }
      inflight = true;
      sim
        .environmentState(t.date, t.hour)
        .then((s) => {
          lastState = s;
          terrain.setSun(s.sun.elevationDeg, s.sun.azimuthDeg);
          {
            const key = fmtDate(s.date);
            if (key !== freshDayKey) {
              freshDayKey = key;
              if (s.top.dayPhase === 'snow') detail.freshSnow(s.top.dayPrecipitationMm);
            }
          }
          weatherPanel.update(s);
          topBar.setWeather(s, snowAtStations());
          guests?.setConditions({
            bottomElevM: s.bottom.elevationM,
            topElevM: s.top.elevationM,
            tempBottomC: s.bottom.now.temperatureC,
            tempTopC: s.top.now.temperatureC,
            windBottomMs: s.bottom.now.windMs,
            windTopMs: s.top.now.windMs,
            precipMmH: s.top.now.precipitationMm,
            rain: s.top.now.phase === 'rain' || s.bottom.now.phase === 'rain',
            cloud: s.cloudFraction,
          });
          timePanel.setSun({ ...s.sun, summerTime: s.summerTime });
          if (overlay === 'radiationSum' && radiationSum && !sameDate(radiationSum.date, t.date)) radiationSum = null;
          refreshField();
          requestSnow(t.date);
        })
        .catch((e: unknown) => timePanel.setStatus(`Błąd: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          inflight = false;
          if (pendingTime) {
            const next = pendingTime;
            pendingTime = null;
            requestState(next);
          }
        });
    }

    // ---------------------------------------------------------------- śnieg
    let snowReady = false;
    let snowRequestedDate: CalendarDate | null = null;
    let snowInflight = 0;
    let latestSnowRequest = 0;
    /** Etap 6b: godzina śniegu na żywo (kroki godzinowe w ciągu dnia); przy przewijaniu sezonu – stan na koniec dnia. */
    function liveSnowHour(): number | undefined {
      return timePanel.seasonPlaying ? undefined : Math.floor(timePanel.hour);
    }
    const snowIs = (s: { date: CalendarDate; hour?: number } | null, date: CalendarDate, hour: number | undefined) => !!s && sameDate(s.date, date) && s.hour === hour;
    let snowRequestedHour: number | undefined;
    function requestSnow(date: CalendarDate): void {
      const hour = liveSnowHour();
      // Ekonomia przelicza dni (pyta wątek o śnieg dzień po dniu) – mapa dostanie śnieg po zakończeniu.
      if (game?.busy) {
        snowRequestedDate = date;
        return;
      }
      if (!snowReady) {
        snowRequestedDate = date;
        return;
      }
      if (snowIs(lastSnow, date, hour)) return;
      if (snowRequestedDate && sameDate(snowRequestedDate, date) && snowRequestedHour === hour && snowInflight > 0) return;
      snowRequestedDate = date;
      snowRequestedHour = hour;
      const id = ++latestSnowRequest;
      snowInflight++;
      sim
        .snowState(date, hour)
        .then((m) => {
          if (id !== latestSnowRequest) return;
          if (m.liveMs !== undefined && m.liveMs > 0) timingsMs['śnieg na żywo (ostatnie pytanie)'] = Math.round(m.liveMs);
          lastSnow = { date: m.date, hour: m.hour, depthCm: m.depthCm, sweMm: m.sweMm, densityKgM3: m.densityKgM3, quality: m.quality, moguls: m.moguls };
          build.setSnow(m.sweMm);
          sendGuestSnow();
          terrain.setSnow(m.depthCm, m.quality, m.moguls);
          {
            const gm = build.groundMap;
            detail.syncSnow(m.moguls, m.pileMm, m.quality, gm ? thinField(m.sweMm, gm, ridingParams) : null);
          }
          minimap.setSnow(m.depthCm, false);
          if (lastState) topBar.setWeather(lastState, snowAtStations());
          // Śnieg na dachach: gdy w dolnych partiach (do ok. 750 m) zwykle leży śnieg.
          let low = 0;
          let snowy = 0;
          for (let k = 0; k < m.depthCm.length; k++) {
            if (grid.elevationM[k] < 750) {
              low++;
              if (m.depthCm[k] > 3) snowy++;
            }
          }
          build.setRoofSnow(low === 0 || snowy / low > 0.5);
          timePanel.setStatus('');
          refreshField();
        })
        .catch((e: unknown) => {
          if (e instanceof Error && e.message === '__superseded__') {
            // Zastąpione nowszym pytaniem (np. ekonomii) – jeśli mapa nadal nie ma śniegu na ten dzień, pytamy ponownie.
            setTimeout(() => {
              if (id === latestSnowRequest && !snowIs(lastSnow, date, liveSnowHour())) requestSnow(date);
            }, 300);
            return;
          }
          timePanel.setStatus(`Błąd modelu śniegu: ${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => snowInflight--);
    }
    sim.onSnowProgress = (p) => {
      if (p.phase === 'radiation') timePanel.setStatus(`Liczę promieniowanie na sezon (raz na sezon)… ${f0(p.fraction * 100)} %`);
      else if (p.date) timePanel.setStatus(`Liczę śnieg dzień po dniu… ${fmtDate(p.date)}`);
    };
    /** Średnia grubość śniegu w komórkach na wysokości dolnej i górnej stacji pogody (±25 m). */
    /** Śnieg dla gości: stan, grubość, muldy i „za cienka baza” (zależna od podłoża po budowie). */
    function sendGuestSnow(): void {
      if (!lastSnow || !guests) return;
      const ground = build.groundMap;
      guests.setSnow(lastSnow.quality, lastSnow.depthCm, lastSnow.moguls ?? null, ground ? thinField(lastSnow.sweMm, ground, ridingParams) : null);
    }

    function snowAtStations(): SnowAtPoints | null {
      if (!lastSnow || !lastState) return null;
      const at = (elevM: number) => {
        let sum = 0;
        let n = 0;
        for (let k = 0; k < grid.cellCount; k++) {
          const d = lastSnow!.depthCm[k];
          if (Math.abs(grid.elevationM[k] - elevM) <= 25 && !Number.isNaN(d)) {
            sum += d;
            n++;
          }
        }
        return n ? sum / n : 0;
      };
      return { bottomCm: at(lastState.bottom.elevationM), topCm: at(lastState.top.elevationM) };
    }

    // Zegar gry (pauza, ×1, ×5, ×20): przesuwa godzinę, o północy – następny dzień (śnieg liczy się dalej).
    const clockParams = { gameDayDurationS: simSettings.gameDayDurationS, nightSpeedup: simSettings.nightSpeedup };
    function clockTick(dtS: number): void {
      if (gameSpeed === 0 || timePanel.isPlaying || timePanel.seasonPlaying) return;
      // Ekonomia zamyka dni (np. po przewinięciu) – zegar czeka.
      if (game?.busy) return;
      // Wątek gości nie nadąża (np. ×20 przy kilku tysiącach gości) – zegar czeka.
      if (guests?.holdClock(timePanel.hour)) return;
      // Nowy dzień dopiero, gdy śnieg poprzedniego jest policzony (przy ×20 model nie nadąża za zegarem).
      const { sunrise, sunset } = timePanel.sunHours;
      // Latem (budowa) zegar idzie tygodniami: doba ×7 szybciej.
      const step = advanceClock(timePanel.hour, Math.min(dtS, 0.25), gameSpeed * (game?.speedFactor(timePanel.date) ?? 1), clockParams, sunrise, sunset);
      if (step.daysAdvanced > 0) {
        if (snowReady && lastSnow && !sameDate(lastSnow.date, timePanel.date)) return;
        timePanel.setDateTime(addDays(timePanel.date, step.daysAdvanced), step.hour);
      } else if (Math.floor(step.hour * 12) !== Math.floor(timePanel.hour * 12)) {
        // Stan pogody i słońca co 5 minut czasu gry (tańsze niż co klatkę).
        timePanel.setDateTime(timePanel.date, step.hour);
      } else {
        timePanel.hour = step.hour;
      }
    }

    // Przewijanie sezonu: kolejny dzień, gdy poprzedni stan śniegu jest już policzony.
    let lastSeasonStepMs = 0;
    function seasonTick(nowMs: number): void {
      if (!timePanel.seasonPlaying || !snowReady) return;
      if (nowMs - lastSeasonStepMs < 1000 / timePanel.seasonSpeedDaysPerS) return;
      if (lastSnow && !sameDate(lastSnow.date, timePanel.date)) return; // czekamy na wynik
      const next = addDays(timePanel.date, 1);
      if (next.month === 5 && next.day === 1) {
        timePanel.setSeasonPlaying(false);
        return;
      }
      lastSeasonStepMs = nowMs;
      timePanel.setDate(next);
    }

    const location: Location = grid.georef
      ? (() => {
          const ll = puwg92ToLatLon(grid.georef.westEastingM + grid.widthM / 2, grid.georef.northNorthingM - grid.heightM / 2);
          return { latDeg: ll.latDeg, lonDeg: ll.lonDeg, timeZone: def!.timeZone };
        })()
      : { ...simSettings.fallbackLocation, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } };

    /** Ziarno pogody w wątku obliczeń (kariera może wybrać inne – pierwsza zima nie z najsłabszych 20 %). */
    let weatherSeed = simSettings.seed;
    let horizonDem: HorizonDem | null | undefined;
    async function horizonField() {
      if (horizonDem === undefined) {
        horizonDem = null;
        if (def?.horizonDem) {
          timePanel.setStatus('Wczytuję teren okolicy (do cieni)…');
          const response = await fetch(binaryUrl(simSettings.mapName, def.horizonDem.file));
          if (!response.ok) throw new Error(`Nie udało się pobrać modelu terenu okolicy (HTTP ${response.status})`);
          horizonDem = createHorizonDem(def, await response.arrayBuffer());
        }
      }
      return computeHorizonCached(grid, horizonDem, parseHorizonParams(radiationJson), (f) => timePanel.setStatus(`Liczę cienie terenu (raz, potem zapamiętane)… ${f0(f * 100)} %`));
    }
    /** Nowe ziarno pogody: słońce i pogoda oraz śnieg w wątku od nowa (horyzont z pamięci przeglądarki). */
    async function setWeatherSeed(seed: number): Promise<void> {
      await envInit;
      if (seed === weatherSeed) return;
      weatherSeed = seed;
      environmentReady = false;
      snowReady = false;
      timePanel.setStatus('Nowa pogoda kariery – liczę od nowa…');
      const { field: horizon } = await horizonField();
      await sim.initEnvironment({ type: 'initEnvironment', horizonDirections: horizon.directions, horizonAngleDeg: horizon.angleDeg, skyViewFactor: horizon.skyViewFactor, climateJson, weatherJson, radiationJson, seed, location });
      environmentReady = true;
      const n = grid.cellCount;
      const cover = build.currentLandCover();
      await sim.initSnow(cover?.forest ?? landCover?.forest.slice() ?? new Float32Array(n), cover?.shrub ?? landCover?.shrub.slice() ?? new Float32Array(n), snowJson, guestsJson, snowmakingJson);
      snowReady = true;
      lastSnow = null;
      lastState = null;
      timePanel.setStatus('');
      requestState({ date: timePanel.date, hour: timePanel.hour });
      requestSnow(timePanel.date);
    }
    const envInit = (async () => {
      try {
        let dem: HorizonDem | null = null;
        if (def?.horizonDem) {
          timePanel.setStatus('Wczytuję teren okolicy (do cieni)…');
          const response = await fetch(binaryUrl(simSettings.mapName, def.horizonDem.file));
          if (!response.ok) throw new Error(`Nie udało się pobrać modelu terenu okolicy (HTTP ${response.status})`);
          dem = createHorizonDem(def, await response.arrayBuffer());
        }
        horizonDem = dem;
        const { field: horizon, fromCache, timeMs } = await horizonField();
        timingsMs[fromCache ? 'horyzont (z pamięci)' : 'horyzont (liczenie)'] = Math.round(timeMs);
        timePanel.setStatus('');
        await sim.initEnvironment({
          type: 'initEnvironment',
          horizonDirections: horizon.directions,
          horizonAngleDeg: horizon.angleDeg,
          skyViewFactor: horizon.skyViewFactor,
          climateJson,
          weatherJson,
          radiationJson,
          seed: weatherSeed,
          location,
        });
        environmentReady = true;
        console.info(`Czasy [ms]: ${JSON.stringify(timingsMs)}`);
        requestState(pendingTime ?? { date: timePanel.date, hour: timePanel.hour });
        refreshField();
        const n = grid.cellCount;
        const cover = build.currentLandCover();
        await sim.initSnow(cover?.forest ?? landCover?.forest.slice() ?? new Float32Array(n), cover?.shrub ?? landCover?.shrub.slice() ?? new Float32Array(n), snowJson, guestsJson, snowmakingJson);
        snowReady = true;
        // Wycinka pod wyciągi i trasy zmienia pokrycie – model śniegu liczy sezon od nowa.
        onLandCoverChange = (f, sh) => {
          sim.setLandCover(f, sh);
          lastSnow = null;
          snowRequestedDate = null;
          if (overlay === 'snowDepth' || overlay === 'snowQuality') refreshField();
          requestSnow(timePanel.date);
        };
        requestSnow(snowRequestedDate ?? timePanel.date);
      } catch (e) {
        console.error(e);
        timePanel.setStatus(`Nie udało się uruchomić słońca i pogody: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    requestState({ date: timePanel.date, hour: timePanel.hour });

    // ---------------------------------------------------------------- goście (etap 5), pogoda na ekranie
    // Etap 7d: atlas postaci i maszyn (generowany przy budowaniu), obiekty z bliska, cząsteczki.
    const atlas = new SpriteAtlas();
    const props = new PropLayer(atlas, queueLayout(parseGuestParams(guestsJson).movement));
    worldOver.addChild(props.root);
    const movers = new MoverLayer(worldOver);
    movers.setAtlas(atlas);
    const particles = new ParticleFx(parseParticleParams(detailJson));
    worldOver.addChild(particles.container);
    void atlas.load().then(() => (timingsMs['atlas postaci (wczytanie)'] = Math.round(atlas.loadMs))).catch((e: unknown) => console.warn('Atlas postaci niedostępny – rysunki zastępcze', e));
    const guestOverlay = new Container(); // ikony wypadków, kolejki – nad postaciami
    app.stage.addChild(guestOverlay);
    const weatherFx = new WeatherFx(screenLayer);
    const guestParams = parseGuestParams(guestsJson);
    const guestClient = new GuestClient();
    guestClient.init(guestsJson, simSettings.seed, grid.elevationM.slice());
    guestClient.onError = (msg) => timePanel.setStatus(`Błąd symulacji gości: ${msg}`);
    const pisteParamsAll = parsePisteParams(pistesJson);
    const hutPoints = ((MAP_LABELS[`../data/maps/${simSettings.mapName}/labels.json`] as { labels?: MapLabel[] } | undefined)?.labels ?? [])
      .filter((l) => l.kind === 'hut')
      .map((l) => {
        const p = grid.puwg92ToLocal(l.point[0], l.point[1]);
        return p ? { ...p, name: l.text } : null;
      })
      .filter((p): p is { xM: number; yM: number; name: string } => p !== null);
    const urlGuests = Number(new URLSearchParams(window.location.search).get('goscie'));
    // eslint-disable-next-line prefer-const
    let guests: GuestController | null = null;
    const guestCtl = new GuestController({
      client: guestClient,
      params: guestParams,
      movers,
      ski: { stamp: (ax: number, ay: number, bx: number, by: number, w: number, st: number) => {
        terrain.ski.stamp(ax, ay, bx, by, w, st);
        detail.ski(ax, ay, bx, by);
      } },
      screenLayer: guestOverlay,
      camera: viewCam,
      panelParent: slotGuests,
      cardParent: ui,
      onReportRequest: () => reportWindow.show('day'),
      spendOf: (c) => {
        const st = game?.state;
        if (!st) return null;
        const stay = c.departH - c.arriveH;
        const p = st.prices;
        const pass = stay > 4 ? p.dayPln : stay > 2 ? p.fourHourPln : p.twoHourPln;
        return pass * (c.child ? economyParams.passes.reducedFactor : 1);
      },
      initialGuests: Number.isFinite(urlGuests) && urlGuests > 0 ? urlGuests : guestParams.scenario.guestsPerDay,
      onDaySummary: (date, summary) => {
        game?.onDaySummary(date, summary);
        // Etap 7c: raport dnia z symulacji gości do okna raportu (zapamiętany na kilka dni).
        void guestCtl.dayReport().then((r) => {
          if (!r || r.date.year !== date.year || r.date.month !== date.month || r.date.day !== date.day) return;
          guestReports.set(formatIsoDate(date), r);
          if (guestReports.size > 10) guestReports.delete(guestReports.keys().next().value!);
        });
      },
      onSummerDay: (date, outcome, stats) => game?.onSummerDay(date, outcome, stats),
      manualGuests: () => !game?.state || game.mode === 'sandbox',
      onDayTraffic: (date, passes) => {
        detail.dayPasses(passes);
        // Przejazdy dnia → model śniegu (ubijanie, zsuwanie, muldy); śnieg na mapie od nowa.
        game?.onDayTraffic(date, passes);
        sim.setTraffic(date, passes);
        lastSnow = null;
        snowRequestedDate = null;
        requestSnow(timePanel.date);
      },
      onLoadOsm: () => {
        const osm = OSM_RESORTS[`../data/maps/${simSettings.mapName}/osm-resort.json`] as OsmResort | undefined;
        if (!osm) return;
        const ctx = OSM_CONTEXTS[`../data/maps/${simSettings.mapName}/osm-context.json`] as MapContextData | undefined;
        const parkings = (ctx?.parkings ?? []).map((pk) => {
          const pts = pk.points.map(([e, n]) => grid.puwg92ToLocal(e, n)).filter((q): q is { xM: number; yM: number } => q !== null);
          return pts.length ? { xM: pts.reduce((a, q) => a + q.xM, 0) / pts.length, yM: pts.reduce((a, q) => a + q.yM, 0) / pts.length } : null;
        }).filter((q): q is { xM: number; yM: number } => q !== null);
        const layout = layoutFromOsm(osm, grid, liftParams, pisteParamsAll, (e, n) => grid.puwg92ToLocal(e, n), { snapToStationM: 150, parkings }, (id, t, name, b, top) => designLift(grid, liftParams, id, t, name, b, top));
        build.loadLayout(layout, 'Wczytano prawdziwy ośrodek Pilsko z OpenStreetMap (Cofnij przywraca poprzedni).');
      },
      onResortOpen: (open) => (game?.state ? game.setSeasonOpen(open) : build.setResortOpen(open)),
    });
    guests = guestCtl;
    guestsRef.current = guestCtl;
    onSnowWarnings = (w) => guestCtl.setSnowWarnings(w);
    guestCtl.setSnowWarnings(build.thinWarningRows);
    guestCtl.setResortOpen(build.resortOpen);
    sendGuestSnow();
    onGuestLayout = (layout, analysis) =>
      guestCtl.setNet(
        buildGuestNet({
          layout,
          lifts: analysis.lifts,
          pistes: analysis.pistes,
          network: analysis.network,
          liftParams,
          pisteParams: pisteParamsAll,
          stationWalkRadiusM: guestParams.operation.stationWalkRadiusM,
          foodPoints: hutPoints,
          grid: { cellSizeM: grid.cellSizeM, widthCells: grid.widthCells, heightCells: grid.heightCells },
          accessibleBases: analysis.accessibleBases,
          baseCapacityPersons: parkingCapacityPersons(layout, economyParams),
        }),
      );
    onGuestLayout(build.current.layout, build.current.analysis);

    // ---------------------------------------------------------------- gra: ekonomia i sezon (etap 6)
    const climateProfile = parseClimateProfile(climateJson);
    const weatherParamsMain = parseWeatherParams(weatherJson);
    // Etap 6b: woda – potoki z OSM uzupełnione z modelu terenu, przepływy, zasięg wodociągu (zabudowa wsi).
    const waterParams = parseWaterParams(waterJson);
    const osmWater = ((OSM_WATERS[`../data/maps/${simSettings.mapName}/osm-water.json`] as { streams?: { name: string; points: [number, number][] }[] } | undefined)?.streams ?? []).map((st) => ({
      name: st.name,
      points: st.points.map(([e, n]) => (grid.georef ? grid.puwg92ToLocal(e, n) : null)).filter((q): q is PointM => q !== null),
    }));
    const tWater = performance.now();
    const streamNet = buildStreamNet({ grid, osm: osmWater, annualPrecipMm: (zz) => annualPrecipitationMm(climateProfile, zz), params: waterParams });
    console.info(`Sieć cieków: ${streamNet.lines.length} linii, ${(performance.now() - tWater).toFixed(0)} ms`);
    const villageBuildings: PointM[] = (((OSM_CONTEXTS[`../data/maps/${simSettings.mapName}/osm-context.json`] as MapContextData | undefined)?.buildings) ?? [])
      .map((b) => b.points.map(([e, n]) => (grid.georef ? grid.puwg92ToLocal(e, n) : null)).filter((q): q is PointM => q !== null))
      .filter((pts) => pts.length > 0)
      .map((pts) => ({ xM: pts.reduce((a, q) => a + q.xM, 0) / pts.length, yM: pts.reduce((a, q) => a + q.yM, 0) / pts.length }));
    const waterCtx: WaterContext = { net: streamNet, wp: waterParams, villageBuildings, elevationM: grid.elevationM };
    // Etap 7g: działki (kwadraty ok. 1 km) z cechami terenu i ceną; warstwa i karta działki.
    parcelGrid = buildParcels(grid, landCover?.forest ?? null, landCover?.built ?? null, publicRoads, streamNet.lines.map((l) => l.points), landParams);
    const parcelLayer = new ParcelLayer(parcelGrid);
    app.stage.addChild(parcelLayer.root);
    let parcelsActive = false;
    const startBanner = Object.assign(document.createElement('div'), { className: 'u-panel u-start-banner hidden', textContent: 'Wybierz działkę startową: pomarańczowe działki leżą przy drodze publicznej – kliknij, żeby zobaczyć szczegóły i cenę.' });
    ui.appendChild(startBanner);
    const parcelCard = new ParcelCard(ui, {
      onBuy: (id) => {
        game?.buyParcel(id, 'buy');
        showParcel(id);
      },
      onLease: (id) => {
        game?.buyParcel(id, 'lease');
        showParcel(id);
      },
      onStart: (id) => {
        game?.chooseStartParcel(id);
        showParcel(id);
      },
      onClose: () => {},
    });
    function showParcel(id: string): void {
      const p = parcelGrid?.parcels.find((x) => x.id === id);
      const st = game?.state;
      if (!p) return;
      const owned = game?.ownedParcels ?? null;
      parcelCard.show(p, {
        owned: owned === null ? 'all' : (owned[id] ?? null),
        choosing: !!game?.needsStartParcel,
        count: owned ? Object.keys(owned).length : 0,
        limit: game?.parcelLimitNow ?? Infinity,
        balancePln: st?.balancePln ?? Infinity,
      });
    }
    function setParcelsActive(on: boolean): void {
      parcelsActive = on;
      dataViews.setParcelsActive(on);
      if (!on) parcelCard.hide();
    }
    dataViewParcels = () => setParcelsActive(!parcelsActive);
    parcelClick = (x, y) => {
      if (!parcelGrid || !(parcelsActive || game?.needsStartParcel) || build.currentTool !== 'select') return false;
      const w = viewCam.screenToWorld(x, y);
      const p = parcelAt(parcelGrid, w.xM, w.yM);
      if (!p) {
        parcelCard.hide();
        return true;
      }
      showParcel(p.id);
      return true;
    };
    parcelFrame = () => {
      const choosing = !!game?.needsStartParcel;
      startBanner.classList.toggle('hidden', !choosing);
      parcelLayer.update(viewCam, { active: parcelsActive, choosing, owned: game?.ownedParcels ?? null, missing: build.draftMissing, selected: parcelCard.currentId });
    };
    build.setStreams(streamNet.lines);
    build.setWater(waterCtx, (zz) => annualPrecipitationMm(climateProfile, zz));
    streamAt = (xM, yM) => {
      const hit = findStream(streamNet, xM, yM, 15, waterParams);
      if (!hit) return null;
      const q = hit.meanFlowM3s;
      const d = game?.state?.date ?? null;
      const lines = [`średni przepływ ${f0(q * 1000)} l/s (${f0(q * 3600)} m³/h)`, `zlewnia ${(hit.cell >= 0 ? streamNet.accM2[hit.cell] / 1e6 : 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} km²`];
      if (d) {
        const f = flowFactor(d.month, weatherBook.precipitationBefore(d, waterParams.streams.precipWindowDays), normalPrecipMm(climateProfile, d.month, waterParams.streams.precipWindowDays), waterParams);
        const mean = q * 3600;
        const avail = Math.max(0, Math.min(waterParams.streams.maxWithdrawalShare * mean * f, mean * f - waterParams.streams.ecologicalFlowShare * mean));
        lines.push(`dziś ok. ${f0(mean * f)} m³/h, wolno pobrać ${f0(avail)} m³/h`);
      }
      lines.push(hit.line.osm ? 'z mapy OpenStreetMap' : 'wyznaczony z modelu terenu');
      return { title: hit.line.name, lines };
    };
    const elevRange = grid.elevationRangeM();
    const weatherBook = new WeatherBook(climateProfile, weatherParamsMain, simSettings.seed, location, Math.round(elevRange.minM), Math.round(elevRange.maxM));
    const waitMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const winterTable = parseWinterClasses(winterClassesJson);
    const winterDeps = { profile: climateProfile, weatherParams: weatherParamsMain, snowParams: parseSnowParams(snowJson), radiationParams: parseRadiationParams(radiationJson), riding: ridingParams, location };
    // Etap 7b: szlaki PTTK z OSM i cele wycieczek (szczyty, schroniska) dla gości letnich.
    const osmTrails = ((OSM_TRAILS[`../data/maps/${simSettings.mapName}/osm-trails.json`] as { trails?: { colour: string; name: string; points: [number, number][] }[] } | undefined)?.trails ?? []).map((t) => ({
      colour: t.colour,
      name: t.name,
      points: t.points.map(([e, n]) => (grid.georef ? grid.puwg92ToLocal(e, n) : null)).filter((q): q is PointM => q !== null),
    })).filter((t) => t.points.length >= 2);
    build.setHikingTrails(osmTrails);
    const ctxData = OSM_CONTEXTS[`../data/maps/${simSettings.mapName}/osm-context.json`] as MapContextData | undefined;
    const destinations = ctxData && grid.georef ? osmDestinations(ctxData.places, ctxData.buildings, (e, n) => grid.puwg92ToLocal(e, n), (q) => !Number.isNaN(grid.sampleElevationM(q.xM, q.yM)), summerParams) : [];
    game = new GameController({
      parcels: parcelGrid,
      onStartParcel: (needed) => {
        if (needed) buildBar.close();
      },
      onMilestones: (ms) => showMilestoneReached(ms),
      summer: { summerJson, walkLines: osmTrails.map((t) => t.points), destinations },
      water: waterCtx,
      ep: economyParams,
      gp: guestParams,
      lp: liftParams,
      riding: ridingParams,
      grid,
      book: weatherBook,
      competition: { snowParams: parseSnowParams(snowJson), radiationParams: parseRadiationParams(radiationJson), location, packedDensityKgM3: ridingParams.packedDensityKgM3 },
      build,
      guests: guestCtl,
      mapName: simSettings.mapName,
      seed: simSettings.seed,
      sandboxDate: parseIsoDate(simSettings.startDate),
      panelParent: slotFinance,
      modalParent: ui,
      snowOn: async (date) => {
        while (!snowReady) await waitMs(200);
        for (;;) {
          try {
            const m = await sim.snowState(date);
            return { quality: m.quality, sweMm: m.sweMm, depthCm: m.depthCm, pileMm: m.pileMm, techMm: m.techMm, liquidMm: m.liquidMm };
          } catch (e) {
            // Pytanie zastąpione innym (np. mapą) – ponawiamy.
            if (!(e instanceof Error && e.message === '__superseded__')) throw e;
            await waitMs(50);
          }
        }
      },
      onCaughtUp: () => {
        lastSnow = null;
        requestSnow(timePanel.date);
      },
      buildNet: (layout, analysis) =>
        buildGuestNet({
          layout,
          lifts: analysis.lifts,
          pistes: analysis.pistes,
          network: analysis.network,
          liftParams,
          pisteParams: pisteParamsAll,
          stationWalkRadiusM: guestParams.operation.stationWalkRadiusM,
          foodPoints: hutPoints,
          grid: { cellSizeM: grid.cellSizeM, widthCells: grid.widthCells, heightCells: grid.heightCells },
          accessibleBases: analysis.accessibleBases,
          baseCapacityPersons: parkingCapacityPersons(layout, economyParams),
        }),
      setDateTime: (date, hour) => timePanel.setDateTime(date, hour),
      setTraffic: (date, passes) => sim.setTraffic(date, passes),
      careerSeed: () => {
        const start = parseIsoDate(economyParams.career.startDate);
        const r = careerSeed(simSettings.seed, start.month >= 10 ? start.year : start.year, winterTable, winterDeps);
        console.info(`Ziarno pogody kariery: ${r.seed} (pierwsza zima ${r.days} dni ze śniegiem na ${winterTable.elevationM} m, prób ${r.tries})`);
        return r.seed;
      },
      setWeatherSeed: (seed) => setWeatherSeed(seed),
      bookFor: (seed) => new WeatherBook(climateProfile, weatherParamsMain, seed, location, Math.round(elevRange.minM), Math.round(elevRange.maxM)),
      winterRating: (startYear, seed) => {
        const days = winterSkiDays(seed, startYear, winterTable, winterDeps);
        return { days, meanDays: winterTable.meanDays, cls: winterClass(days, winterTable), percentile: winterPercentile(days, winterTable), elevationM: winterTable.elevationM, thresholdCm: winterTable.baseThresholdCm };
      },
      setOperations: (date, ops) => sim.setOperations(date, ops),
      onOps: () => refreshSnowOps(true),
      toast: (text) => buildBar.showToast(text),
    });

    // ---------------------------------------------------------------- naśnieżanie i ratraki (etap 7)
    const opsView = new OpsView();
    let opsInfra = game.infra();
    let snowPanelMs = 0;
    const pisteName = (id: string) => build.current.layout.pistes.find((p) => p.id === id)?.name ?? id;
    const planPistes = (): PlanPiste[] => {
      const st = game?.state;
      const g = grid;
      const guns = new Set((opsInfra?.guns ?? []).map((x) => x.pisteId));
      return build.current.layout.pistes
        .filter((p) => st && !st.construction[p.id])
        .map((p) => {
          const a = build.current.analysis.pistes.get(p.id);
          let base: number | null = null;
          if (a && lastSnow) {
            let sum = 0;
            let n = 0;
            for (const q of a.axis) {
              const c = g.cellAt(q.xM, q.yM);
              if (!c) continue;
              sum += lastSnow.sweMm[g.index(c.i, c.j)] / ridingParams.packedDensityKgM3 * 100;
              n++;
            }
            base = n ? sum / n : null;
          }
          return { id: p.id, name: p.name, baseCm: base, hasGuns: guns.has(p.id), areaHa: (a?.areaM2 ?? 0) / 10000 };
        });
    };
    const snowPlanDialog = new SnowPlanDialog(ui, () => game?.opsChanged());
    const nightPlanDialog = new NightPlanDialog(
      ui,
      () => game?.opsChanged(),
      (id, on) => game?.setDayGroom(id, on),
    );
    const snowPanel = new SnowPanel(slotSnow, {
      onSnowPlan: () => {
        const st = game?.state;
        if (!st) return;
        const names = new Map(build.current.layout.pistes.map((p) => [p.id, p.name]));
        snowPlanDialog.show(
          st,
          planPistes(),
          (build.current.layout.snowGuns ?? []).map((g, i) => {
            const f = opsInfra?.guns.find((x) => x.id === g.id);
            return { id: g.id, name: `${g.typeId === 'lance' ? 'Lanca' : 'Armatka'} ${i + 1}`, pisteName: f?.pisteId ? (names.get(f.pisteId) ?? '–') : '–' };
          }),
        );
      },
      onNightPlan: () => {
        const st = game?.state;
        if (!st) return;
        nightPlanDialog.show(st, planPistes(), snowmakingParams, () => game?.preview ?? null, pisteName);
      },
      onGroomer: (typeId, leased) => game?.acquireGroomer(typeId, leased),
      onUsedGroomer: (id) => game?.buyUsedGroomer(id),
      onTutorial: () => snowTutorial.start(),
      onMains: (on) => game?.setMainsOn(on),
    });
    // Etap 7f: samouczek naśnieżania (kroki sprawdzane na bieżąco, „Pokaż gdzie” podświetla kartę lub przycisk).
    const tutorialSteps = () => snowChecklist(build.current.layout, game?.state ?? null, snowmakingParams, opsInfra);
    const snowTutorial = new SnowTutorial(ui, {
      steps: tutorialSteps,
      reveal: (step) => {
        if (step.target.kind === 'panel') {
          drawer.show('snow');
          refreshSnowOps(true);
          return document.querySelector<HTMLElement>(step.target.button === 'plan' ? '.sn-plan' : '[data-groomer]');
        }
        openBuild('snow');
        if (step.target.kind === 'tool') {
          build.setTool(step.target.tool);
          return document.querySelector<HTMLElement>(`[data-card="${step.target.tool}"]`);
        }
        const infraKind = step.target.infra;
        const t = snowmakingParams.buildings.find((b) => b.kind === infraKind);
        return t ? document.querySelector<HTMLElement>(`[data-card="b-${t.id}"]`) : null;
      },
    });
    let tutorialMs = 0;
    snowPanel.setVisible(false);
    function refreshSnowOps(force: boolean): void {
      const st = game?.state;
      snowPanel.setVisible(Boolean(st));
      if (!st) return;
      const now = performance.now();
      if (!force && now - snowPanelMs < 500) return;
      snowPanelMs = now;
      if (force) opsInfra = game!.infra();
      snowPanel.update({ state: st, infra: opsInfra, preview: game!.preview, hour: timePanel.hour, sp: snowmakingParams, pisteName, blocked: game!.blockedPistes, checklist: snowChecklist(build.current.layout, st, snowmakingParams, opsInfra), usedOffers: game!.usedOffers() });
      if (force && nightPlanDialog.visible) nightPlanDialog.renderResult();
    }
    function opsFrame(): void {
      const st = game?.state;
      if (!st) {
        build.setPlumes([]);
        movers.groomers = [];
        return;
      }
      const sameDay = sameDate(st.date, timePanel.date);
      const pv = sameDay ? (game!.preview?.summary ?? null) : null;
      build.setPlumes(plumesAt(pv, opsInfra, timePanel.hour));
      movers.groomers = opsView.groomers(timePanel.date, timePanel.hour, pv, st.ops?.last ?? null, build.current.analysis, detail.groomStamp);
      // Etap 7d: sztruks z nocy przewiniętej, pryzmy pracujących armatek (co godzinę).
      detail.applyNight(st.ops?.last ?? null, build.current.analysis, dayIndex(timePanel.date));
      const pls = plumesAt(pv, opsInfra, timePanel.hour);
      detail.plumes(`${fmtDate(timePanel.date)} ${Math.floor(timePanel.hour)}`, pls, snowmakingParams.snow.driftPerMs);
    }
    {
      const mode = new URLSearchParams(window.location.search).get('tryb');
      if (mode === 'kariera') game.newGame('career');
      else if (mode === 'piaskownica') game.newGame('sandbox');
      else if (mode !== 'widok') void game.showStart();
    }
    const devMenu = new DevMenu(ui);
    // ---------------------------------------------------------------- etap 3D-0: widok 3D (Three.js, ładowany przy pierwszym użyciu)
    let view3d: import('./render3d/view3d').View3D | null = null;
    let view3dLoading = false;
    const devInfo3d = devMenu.addInfo('Widok 3D');
    const bar3d = document.createElement('div');
    bar3d.className = 'u-panel u-3d-bar hidden';
    bar3d.innerHTML = `<button type="button" class="u-btn" data-3d="top" ${tipAttrs('Widok z góry nad miejscem pod kursorem (precyzja na stromych stokach); drugi raz – powrót', 'Z')}>Widok z góry</button><button type="button" class="u-btn" data-3d="quality" ${tipAttrs('Jakość: cienie, przyciemnienie zagłębień, zasięg drzew 3D')}>Jakość: średnia</button><button type="button" class="u-btn primary" data-3d="back" ${tipAttrs('Mapa 2D z góry (to samo miejsce). Kamera 3D: W A S D / przeciągnij – przesuń, Q E / prawy przycisk – obrót, R F – pochylenie, kółko – zbliżenie, Z – widok z góry', 'F3')}>Mapa 2D</button><span class="u-3d-help">WASD / przeciągnij – przesuń · Q E / prawy przycisk – obrót · R F – pochylenie · kółko – zbliżenie · Z – widok z góry</span>`;
    ui.appendChild(bar3d);
    bar3d.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-3d]')?.getAttribute('data-3d');
      if (!view3d) return;
      if (a === 'top') view3d.toggleTopDown();
      else if (a === 'back') void toggle3D();
      else if (a === 'quality') {
        const q = ((view3d.qualityLevel + 1) % 3) as 0 | 1 | 2;
        view3d.setQuality(q);
        bar3d.querySelector('[data-3d="quality"]')!.textContent = `Jakość: ${['niska', 'średnia', 'wysoka'][q]}`;
      }
    });
    async function toggle3D(): Promise<void> {
      if (view3d?.active) {
        // Powrót do mapy: mapa 2D nad tym miejscem, na które patrzyła kamera 3D.
        camera.centerOn(view3d.adapter.centerXM, view3d.adapter.centerYM);
        view3d.hide();
        cam3d = null;
        world.visible = worldOver.visible = true;
        build.setMapLayerVisible(true);
        app.renderer.background.color = 0x3b4856;
        app.renderer.background.alpha = 1;
        app.canvas.classList.remove('over-3d');
        bar3d.classList.add('hidden');
        document.body.classList.remove('view-3d');
        return;
      }
      if (view3dLoading) return;
      if (!view3d) {
        view3dLoading = true;
        timePanel.setStatus('Wczytuję widok 3D…');
        try {
          const [{ View3D }, { parseRender3DParams }, r3json] = await Promise.all([import('./render3d/view3d'), import('./render3d/params'), import('../data/render3d.json')]);
          const ctx3 = OSM_CONTEXTS[`../data/maps/${simSettings.mapName}/osm-context.json`] as MapContextData | undefined;
          const osmBuildings = (ctx3?.buildings ?? []).map((b) => b.points.map(([e, n]) => grid.puwg92ToLocal(e, n)).filter((q): q is PointM => q !== null)).filter((l) => l.length >= 3);
          const geo = grid.georef;
          // Etap 3D-1: stałe linie z OSM i modelu terenu (jak na mapie 2D).
          const loc = (e: number, n: number) => grid.puwg92ToLocal(e, n);
          const onMapPt = (q: PointM | null): q is PointM => q !== null && !Number.isNaN(grid.sampleElevationM(q.xM, q.yM));
          const network3d = {
            roads: (ctx3?.roads ?? []).map((r) => ({ points: r.points.map(([e, n]) => loc(e, n)).filter(onMapPt), widthM: ROAD_WIDTH_M[r.kind] ?? 3, track: r.kind === 'track' })).filter((r) => r.points.length >= 2),
            parkings: (ctx3?.parkings ?? []).map((pk) => pk.points.map(([e, n]) => loc(e, n)).filter(onMapPt)).filter((pk) => pk.length >= 3),
            streams: streamNet.lines,
            hiking: osmTrails,
            border: borderLinesLocal.map((l) => l.map(([x, y]) => ({ xM: x, yM: y }))),
            places: (ctx3?.places ?? []).map((pl) => ({ name: pl.kind === 'peak' && pl.ele ? `${pl.name} ${pl.ele} m` : pl.name, at: loc(pl.point[0], pl.point[1]), peak: pl.kind === 'peak' })).filter((pl) => onMapPt(pl.at)).map((pl) => ({ name: pl.name, xM: pl.at!.xM, yM: pl.at!.yM, peak: pl.peak })),
          };
          view3d = new View3D(
            root,
            {
              grid,
              forest: landCover?.forest ?? null,
              shrub: landCover?.shrub ?? null,
              built: landCover?.built ?? null,
              dem: () => horizonDem ?? null,
              mapWestE: geo?.westEastingM ?? 0,
              mapNorthN: geo?.northNorthingM ?? 0,
              location,
              lp: liftParams,
              osmBuildings,
              layout: () => build.current,
              snow: () => lastSnow,
              summer: () => {
                const m = timePanel.date.month;
                return m >= 5 && m <= 10;
              },
              date: () => timePanel.date,
              hour: () => timePanel.hour,
              cloud: () => lastState?.cloudFraction ?? 0.3,
              gameTimeS: () => guestCtl.gameTimeS ?? timePanel.hour * 3600,
              frame: () => movers.frame,
              groomers: () => movers.groomers,
              plumes: () => build.plumes,
              drawState: () => build.drawState,
              overlay: () => (overlay3d ? { canvas: overlay3d.canvas, version: overlay3d.version(), opacity: style.overlayOpacity } : null),
              network: network3d,
            },
            parseRender3DParams((r3json as { default: unknown }).default),
          );
          (window as unknown as { __view3d?: unknown }).__view3d = view3d;
        } catch (e) {
          console.error(e);
          buildBar.showToast(`Nie udało się uruchomić widoku 3D: ${e instanceof Error ? e.message : String(e)}`);
          view3dLoading = false;
          timePanel.setStatus('');
          return;
        }
        view3dLoading = false;
        timePanel.setStatus('');
      }
      // Etap 3D-1: płótno mapy 2D zostaje nad widokiem 3D – przezroczyste, bez świata mapy, tylko
      // elementy ekranu (profil, pierścień nachylenia, okienko budowy, działki); mysz trafia do 3D,
      // a kliknięcia i przeciągnięcia – do tych samych narzędzi co w 2D (przelicznik `viewCam`).
      const v3 = view3d;
      cam3d = v3.adapter;
      cursor3d = () => v3.cursor;
      v3.hooks.onClick = (x, y) => {
        // Klik w linę, podporę, dach – wybór obiektu pod spodem (punkt mapy pod trafieniem).
        const g = v3.groundUnderObjectAt(x, y);
        input.onClick?.(g ? g.xPx : x, g ? g.yPx : y);
      };
      v3.hooks.onDoubleClick = (x, y) => input.onDoubleClick?.(x, y);
      v3.hooks.onRightClick = (x, y) => input.onRightClick?.(x, y);
      v3.hooks.onDragStart = (x, y) => input.onDragStart?.(x, y) ?? false;
      v3.hooks.onDragMove = (x, y) => input.onDragMove?.(x, y);
      v3.hooks.onDragEnd = (x, y) => input.onDragEnd?.(x, y);
      v3.lookAt(camera.centerXM, camera.centerYM);
      world.visible = worldOver.visible = false;
      build.setMapLayerVisible(false);
      // Czarne i przezroczyste (płótno z mnożeniem przez alfę – inaczej kolor tła rozjaśniałby obraz 3D).
      app.renderer.background.color = 0x000000;
      app.renderer.background.alpha = 0;
      app.canvas.classList.add('over-3d');
      bar3d.classList.remove('hidden');
      document.body.classList.add('view-3d');
      // ?r3d=manual – bez pętli klatek (zrzuty w teście; klatka przez __view3d.renderOnce()).
      view3d.show(new URLSearchParams(window.location.search).get('r3d') !== 'manual');
    }
    setInterval(() => {
      if (!view3d?.active) return;
      const s3 = view3d.stats;
      devInfo3d.innerHTML = `${s3.fps.toFixed(1)} kl./s · praca kodu ${s3.frameMs.toFixed(1)} ms/kl.<br>${s3.drawCalls} wywołań rysowania, ${(s3.triangles / 1e6).toFixed(2)} mln trójkątów<br>drzewa 3D ${s3.treesNear.toLocaleString('pl-PL')}, obrazki ${s3.treesFar.toLocaleString('pl-PL')}<br>postacie ${s3.people}, krzesełka ${s3.carriers}; jakość ${['niska', 'średnia', 'wysoka'][view3d.qualityLevel]}<br>automatyczna płynność: rozdzielczość ×${view3d.governor.resolutionScale.toFixed(1)}, zasięg drzew ×${view3d.governor.treeScale.toFixed(1)}`;
    }, 500);
    // Etap 7e: pierścień nachylenia przy budowie (na ekranie, nad wszystkim) i suwaki rzeźby w menu Dev.
    const slopeRing = new SlopeRing(
      grid,
      parsePisteParams(pistesJson).classes.map((c) => ({ color: c.color, maxSlopePercent: c.maxSlopePercent })),
      relief.buildRing,
      style.flatSlopePercent,
    );
    app.stage.addChild(slopeRing.root);
    // Etap 7f: przyciąganie, linie pomocnicze i okienko przy kursorze w trakcie budowy.
    const snapOverlay = new SnapOverlay();
    app.stage.addChild(snapOverlay.root);
    // Etap 3D-2: uchwyty edycji nad widokiem 3D (w 2D rysuje je warstwa mapy) – te same kształty, rzut przez viewCam.
    const handles3d = new Graphics();
    handles3d.eventMode = 'none';
    app.stage.addChild(handles3d);
    let reliefPending = false;
    const applyReliefLater = () => {
      if (reliefPending) return;
      reliefPending = true;
      requestAnimationFrame(() => {
        reliefPending = false;
        terrain.setRelief(relief, reliefClasses.blue, reliefClasses.red);
        contourLabels.setParams(relief.contours);
        slopeRing.setParams(relief.buildRing);
      });
    };
    devMenu.addSliders(
      'Rzeźba terenu (etap 7e)',
      RELIEF_SLIDERS,
      (path) => getPath(relief, path),
      (path, v) => {
        setPath(relief, path, v);
        applyReliefLater();
      },
      () => JSON.stringify(Object.fromEntries(RELIEF_SLIDERS.map((sl) => [`relief.${sl.path}`, getPath(relief, sl.path)])), null, 2),
      () => {
        const fresh = parseReliefParams(mapStyleJson);
        for (const sl of RELIEF_SLIDERS) setPath(relief, sl.path, getPath(fresh, sl.path));
        applyReliefLater();
      },
    );

    // ---------------------------------------------------------------- raport z doradcą (etap 7c)
    const g0 = guestParams.scenario;
    const factsNow = () => game?.resortFactsNow ?? null;
    const parkingModel = (guests: number) => {
      const f = factsNow();
      const st = game?.state;
      if (!f || !st || guests <= 0) return null;
      const parks = f.buildings.filter((b) => b.type.base && b.built && b.accessible);
      if (!parks.length) return null;
      const prof = presenceProfile(g0.arrivalMeanH, g0.arrivalSdH, g0.stayMeanH, g0.staySdH, st.hours.closeH);
      const caps = parks.map((b) => b.type.cars);
      const pp = parkingProfiles(guests / economyParams.demand.personsPerCar, prof, caps);
      const total = caps.reduce((a, c) => a + c, 0);
      const fullK = prof.findIndex((_, k) => pp.cars.reduce((a, c) => a + c[k], 0) >= total - 0.5);
      return { fullAt: fullK >= 0 ? formatHour(fullK * 0.25) : null, turnedAway: Math.round(pp.turnedAway * economyParams.demand.personsPerCar), parkingId: parks[parks.length - 1].id, prof };
    };
    const reportWindow = new ReportWindow(
      ui,
      {
        state: () => game?.state ?? null,
        guestReport: (iso) => guestReports.get(iso) ?? null,
        presence: (guests) => presenceProfile(g0.arrivalMeanH, g0.arrivalSdH, g0.stayMeanH, g0.staySdH, game?.state?.hours.closeH ?? 16).map((p) => p * guests),
        parking: (guests) => parkingModel(guests),
        food: (guests) => {
          const f = factsNow();
          const foods = (f?.buildings ?? []).filter((b) => isFoodType(b.type.id) && b.built);
          const cap = foods.reduce((a, b) => a + b.type.capacityPerDay, 0);
          return { has: foods.length > 0, full: foods.length > 0 && guests * (foods[0]?.type.useShare ?? 0) >= cap * 0.99, id: foods[0]?.id ?? null };
        },
        thin: () => ({ open: (factsNow()?.pistes ?? []).filter((p) => p.open).length, thin: build.thinWarningRows.length }),
        hasSnowmaking: () => (build.current.layout.snowGuns?.length ?? 0) > 0,
        reputation: () => (game?.state ? reputationOf(game.state, economyParams) : 0),
        closeH: () => game?.state?.hours.closeH ?? 16,
        seasonNumber: () => (game?.state?.history.length ?? 0) + 1,
      },
      parseAdvisorParams(uiJson),
      {
        onAdvice: (id) => {
          const f = factsNow();
          const centerOn = (bid: string | null | undefined) => {
            const c = bid ? build.objectCenter('base', bid) : null;
            if (c) viewCam.centerOn(c.xM, c.yM);
          };
          if (id === 'showQueues') setOverlay('liftWait');
          else if (id === 'planLift') openBuild('lifts');
          else if (id === 'showParking') centerOn(f?.buildings.find((b) => b.type.base)?.id);
          else if (id === 'buildParking') {
            openBuild('buildings');
            build.setBuildingType('parking');
          } else if (id === 'showFood') centerOn(f?.buildings.find((b) => isFoodType(b.type.id))?.id);
          else if (id === 'buildFood') {
            openBuild('buildings');
            build.setBuildingType('gastronomy');
          } else if (id === 'showSnow') setOverlay('snowDepth');
          else if (id === 'snowPlan') drawer.show('snow');
          else if (id === 'buildSnow') openBuild('snow');
          else if (id === 'showSlope') setOverlay('slope');
          else if (id === 'drawPiste') openBuild('pistes');
          else if (id === 'guests') drawer.show('guests');
          else if (id === 'prices') game?.showPrices();
        },
        onSeasonDetails: () => game?.showReport(),
        onGuestDetails: () => void guestCtl.showReport(),
      },
    );

    // ---------------------------------------------------------------- powiadomienia (etap 7c)
    let logSeen = -1;
    let rulesMs = 0;
    const nowLabel = () => formatHour(timePanel.hour);
    const liftBottomByName = (name: string) => {
      const l = build.current.layout.lifts.find((x) => x.name === name);
      return l ? { xM: l.bottom.xM, yM: l.bottom.yM } : null;
    };
    function noticeRules(nowMs: number): void {
      if (nowMs - rulesMs < 1000) return;
      rulesMs = nowMs;
      const st = game?.state;
      if (!st) return;
      const dateLabel = fmtDate(timePanel.date);
      const base: Pick<Notice, 'time' | 'date'> = { time: nowLabel(), date: dateLabel };
      // 1) Dziennik gry (budowy ukończone, przeglądy, raty, sezon) – nowe wpisy.
      if (logSeen < 0) logSeen = st.log.length;
      for (const e of st.log.slice(logSeen)) {
        const bad = /brak|bankrut|awari|nie można|ujemn|zamknięt/i.test(e.text);
        const good = /ukończon|gotow|zbudowan|otwart/i.test(e.text);
        const cut = e.text.search(/[.:–]\s/);
        const title = cut > 8 && cut < 70 ? e.text.slice(0, cut) : e.text.length < 70 ? e.text : `${e.text.slice(0, 66)}…`;
        const rest = cut > 8 && cut < 70 ? e.text.slice(cut + 1).trim().replace(/^[–:]\s*/, '') : '';
        notices.push({ key: `log:${e.date}:${e.text}`, level: bad ? 'bad' : good ? 'good' : 'info', icon: bad ? 'warn' : good ? 'check' : 'info', title, text: rest, ...base });
      }
      logSeen = st.log.length;
      // 2) Kolejki do wyciągów.
      const qMin = noticeParams.queueWarnMin;
      for (const r of guestCtl.liftRows) {
        if (!r.closed && r.waitMin >= qMin) {
          notices.push({ key: `queue:${dateLabel}:${r.name}`, level: r.waitMin >= 2 * qMin ? 'bad' : 'warn', icon: 'clock', title: `Kolejka do ${r.name}: ${Math.round(r.waitMin)} minut`, text: `Goście zaczynają narzekać. Wyciąg pracuje na ${Math.round(r.utilization * 100)} % przepustowości.`, at: liftBottomByName(r.name), ...base });
        }
      }
      notices.resolve('queue:', (k) => guestCtl.liftRows.some((r) => k.endsWith(`:${r.name}`) && r.waitMin >= qMin * 0.6));
      // 3) Pełny parking (model dnia przy dzisiejszej liczbie gości).
      if (st.seasonOpen && guestCtl.guestsPerDay > 0) {
        const pm = parkingModel(guestCtl.guestsPerDay);
        if (pm?.fullAt && nowLabel() >= pm.fullAt && pm.turnedAway > 0) {
          const at = build.objectCenter('base', pm.parkingId ?? '');
          notices.push({ key: `parking:${dateLabel}`, level: 'bad', icon: 'car', title: `Parking pełny od ${pm.fullAt}`, text: `${Math.round(pm.turnedAway / economyParams.demand.personsPerCar)} samochodów zawróciło. Zbuduj drugi parking albo podnieś opłatę.`, at, ...base });
        }
      }
      // 4) Odwilż w prognozie (zima).
      const m = timePanel.date.month;
      if (lastState && (m >= 11 || m <= 3)) {
        const thaw = lastState.forecast.slice(1, 4).find((f) => f.bottomTMeanC > noticeParams.thawWarnC);
        if (thaw) {
          const res = st.ops ? ` Zbiornik: ${Math.round(st.ops.reservoirM3).toLocaleString('pl-PL')} m³.` : '';
          notices.push({ key: `thaw:${thaw.date.year}-${thaw.date.month}-${thaw.date.day}`, level: 'info', icon: 'thermo', title: `${weekdayLong(thaw.date)} odwilż, do +${Math.round(thaw.bottomTMeanC)} °C`, text: `Mroźne noce przed odwilżą wykorzystaj na naśnieżanie.${res}`, ...base });
        }
      }
      // 5) Za mało śniegu na otwartych trasach.
      const thin = build.thinWarningRows;
      if (thin.length && st.seasonOpen) {
        const first = build.current.layout.pistes.find((p) => p.name === thin[0].pisteName);
        notices.push({ key: `thin:${dateLabel}`, level: 'warn', icon: 'snow', title: `Za mało śniegu: ${thin.length === 1 ? `trasa ${thin[0].pisteName}` : `${thin.length} trasy`}`, text: 'Na cienkiej bazie są kamienie i wypadki. Zamknij trasę albo zaplanuj naśnieżanie.', at: first ? build.objectCenter('piste', first.id) : null, ...base });
      }
    }
    const WEEKDAYS_LONG = ['W niedzielę', 'W poniedziałek', 'We wtorek', 'W środę', 'W czwartek', 'W piątek', 'W sobotę'];
    const weekdayLong = (d: CalendarDate) => WEEKDAYS_LONG[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
    let topBarMs = 0;
    function refreshTopBarGame(nowMs: number): void {
      if (nowMs - topBarMs < 500) return;
      topBarMs = nowMs;
      const st = game?.state;
      if (!st) {
        topBar.setGame(null);
        return;
      }
      const mo = st.date.month;
      const summer = mo >= 5 && mo <= 10;
      const counts = guestCtl.counts;
      const rep = summer && st.summer ? Math.max(0, summerReputationOf(st, summerParams)) : reputationOf(st, economyParams);
      const last = st.lastDay;
      topBar.setGame({
        resortName: simSettings.mapName[0].toUpperCase() + simSettings.mapName.slice(1),
        seasonLabel: `Sezon ${st.history.length + 1}, ${summer ? 'lato' : 'zima'}${st.mode === 'sandbox' ? ' · piaskownica' : ''}`,
        balancePln: st.balancePln,
        deltaPln: last ? sumRevenue(last.flows) - sumCosts(last.flows) : null,
        deltaLabel: 'wczoraj',
        guestsToday: counts?.arrived ?? 0,
        onSlope: counts?.onHill ?? 0,
        onSlopeLabel: summer ? 'teraz' : 'na stoku',
        reputation: rep,
        priceLabel: summer ? 'Kolej góra–dół' : 'Karnet dzienny',
        pricePln: summer ? (st.summer?.prices.liftRoundTripPln ?? summerParams.prices.liftRoundTripPln) : st.prices.dayPln,
        milestone: (() => {
          const pr = st.mode === 'career' ? game?.milestoneProgress() : null;
          if (!pr) return null;
          return { name: pr.current.name, next: pr.next?.name ?? null, share: pr.share, tip: pr.next ? `Do „${pr.next.name}”: ${pr.parts.map((x) => `${x.label} ${x.text}`).join(', ')}. Kliknij – lista kamieni milowych` : 'Najwyższy kamień milowy osiągnięty' };
        })(),
      });
    }

    /** Etap 6b: treść dymku przy kursorze. */
    function tipContent(c: { xPx: number; yPx: number }): TipContent | null {
      const w = viewCam.screenToWorld(c.xPx, c.yPx);
      const d = describePoint(grid, w.xM, w.yM, style.flatSlopePercent, lastSnow ? { ...lastSnow, ground: build.groundMap, riding: ridingParams } : null);
      if (!d.elevation) return null;
      const lines = [d.elevation, d.slope, d.aspect, d.snow];
      const cell = grid.cellAt(w.xM, w.yM);
      if (cell && lastState) {
        const t = lastState.temperatureC[grid.index(cell.i, cell.j)];
        if (Number.isFinite(t)) lines.push(`powietrze ${t.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} °C (na tej wysokości, ${String(Math.floor(timePanel.hour)).padStart(2, '0')}:00)`);
      }
      const sections: { title: string; lines: string[] }[] = [];
      const obj = build.describeAt(c.xPx, c.yPx);
      if (obj) sections.push(obj);
      const stream = streamAt?.(w.xM, w.yM);
      if (stream) sections.push(stream);
      return { lines, sections };
    }

    // ---------------------------------------------------------------- sterowanie
    input.onClick = (x, y) => {
      if (profile.handleClick(x, y)) return;
      // Etap 7g: widok działek albo wybór działki startowej – kliknięcie otwiera kartę działki.
      if (parcelClick(x, y)) return;
      // Kliknięcie postaci (gdy nie budujemy) – karta gościa.
      if (build.currentTool === 'select' && !build.hasHandleAt(x, y) && guestCtl.handleClick(x, y, timePanel.hour * 3600)) return;
      build.handleClick(x, y);
    };
    input.onDoubleClick = () => build.handleDoubleClick();
    input.onRightClick = () => build.handleRightClick();
    input.onDragStart = (x, y) => !profile.active && build.handleDragStart(x, y);
    input.onDragMove = (x, y) => build.handleDragMove(x, y);
    input.onDragEnd = () => build.handleDragEnd();
    input.onKey = (code) => {
      // Etap 3D-0: F3 – widok 3D; w 3D klawisze mapy i budowania nie działają (sterowanie kamerą 3D).
      if (code === 'F3') {
        void toggle3D();
        return true;
      }
      // W 3D: klawisze kamery (WASD, strzałki, Q E R F) obsługuje widok 3D, Z – widok z góry; reszta jak w 2D
      // (narzędzia budowy E, Q, F – w 3D tylko z palety, bo te litery sterują kamerą).
      if (view3d?.active && CAMERA_KEYS.has(code)) return true;
      if (view3d?.active && code === 'KeyZ') {
        view3d.toggleTopDown();
        return true;
      }
      if (code === 'Escape') {
        if (reportWindow.visible) return (reportWindow.hide(), true);
        if (infoWindow.visible) return (infoWindow.hide(), true);
        if (gameMenu.visible) return (gameMenu.hide(), true);
        topBar.closePops();
        if (drawer.open) return (drawer.hide(), true);
        if (cardSel && build.currentTool === 'select') {
          cardSelRef.close?.();
          build.clearSelection();
          return true;
        }
        if (build.currentTool === 'select' && buildBar.openCategory) return (buildBar.close(), true);
      }
      if (code === 'Backquote') {
        devMenu.toggle();
        return true;
      }
      if (code === 'Space') {
        setGameSpeed(gameSpeed === 0 ? 1 : 0);
        return true;
      }
      const digit = /^(Digit|Numpad)([1-9])$/.exec(code);
      if (digit) {
        const o = OVERLAY_KEYS[Number(digit[2]) - 1];
        if (o) setOverlay(o.kind);
        return Boolean(o);
      }
      if (code === 'KeyK') {
        setOverlay(overlay === 'liftWait' ? 'none' : 'liftWait');
        return true;
      }
      if (code === 'KeyM') {
        setOverlay(overlay === 'wetBulb' ? 'none' : 'wetBulb');
        return true;
      }
      if (code === 'KeyI') {
        cursorTip.setEnabled(!cursorTip.enabled);
        dataViews.setTipActive(cursorTip.enabled);
        buildBar.showToast(cursorTip.enabled ? 'Dymek przy kursorze włączony.' : 'Dymek przy kursorze wyłączony.');
        return true;
      }
      if (code === 'KeyG') {
        setOverlay(overlay === 'ground' ? 'none' : 'ground');
        return true;
      }
      if (code === 'KeyP') {
        if (!profile.active) build.setTool('select');
        profile.toggle();
      } else if (code === 'Escape' && profile.active) profile.setActive(false);
      else return build.handleKey(code);
      return true;
    };

    app.renderer.on('resize', (width: number, height: number) => camera.setViewport(width, height));

    // ---------------------------------------------------------------- karta obiektu (etap 7b)
    let cardSel: { kind: string; id: string } | null = null;
    let cardStats: SummerStats | null = null;
    let cardRefreshMs = 0;
    const cardView = new ObjectCardView(ui, {
      onAction: (a, value) => {
        if (!cardSel) return;
        const sel = cardSel;
        if (a.id === 'toggleOpen' || a.id === 'toggleSummer' || a.id === 'toggleRacks' || a.id === 'demolish' || a.id === 'upgrade' || a.id === 'widen' || a.id === 'move' || a.id === 'light') {
          build.cardAction(sel.kind as Parameters<typeof build.cardAction>[0], sel.id, a.id, value);
          if (a.id === 'move') {
            cardSel = null;
            cardView.hide();
          }
          if (a.id === 'demolish') {
            cardSel = null;
            cardView.hide();
          }
        } else if (a.id === 'inspection' && value) game?.scheduleInspection(sel.id, value);
        else if (a.id === 'price' && a.priceKey && value !== null) game?.setSummerPrices({ [a.priceKey]: Number(value) });
        else if (a.id === 'mains') game?.setMainsOn(!game.state?.ops?.mainsOn);
        cardRefreshMs = 0;
      },
      onViewAction: (id) => {
        if (!cardSel) return;
        const sel = cardSel;
        if (id === 'show') {
          const c = build.objectCenter(sel.kind as Parameters<typeof build.objectCenter>[0], sel.id);
          if (c) viewCam.centerOn(c.xM, c.yM);
        } else if (id === 'moreParking') {
          buildBar.toggleCategory('buildings');
          build.setBuildingType('parking');
        } else if (id === 'moreFood') {
          buildBar.toggleCategory('buildings');
          build.setBuildingType('gastronomy');
        } else if (id === 'moreLift') buildBar.toggleCategory('lifts');
        else if (id === 'snowPlan') drawer.show('snow');
      },
      onSmooth: (v) => {
        if (cardSel) build.setLineSmooth(cardSel.kind as Parameters<typeof build.setLineSmooth>[0], cardSel.id, v);
        cardRefreshMs = 0;
      },
      onClose: () => {
        cardSel = null;
        build.clearSelection();
      },
    });
    cardSelRef.close = () => {
      cardSel = null;
      cardView.hide();
    };
    const pisteSnowOf = (id: string) => {
      const a = build.current.analysis.pistes.get(id);
      if (!a || !lastSnow) return null;
      let sum = 0;
      let n = 0;
      const qs = new Map<number, number>();
      for (const q of a.axis) {
        const c = grid.cellAt(q.xM, q.yM);
        if (!c) continue;
        const k = grid.index(c.i, c.j);
        sum += (lastSnow.sweMm[k] / ridingParams.packedDensityKgM3) * 100;
        qs.set(lastSnow.quality[k], (qs.get(lastSnow.quality[k]) ?? 0) + 1);
        n++;
      }
      const top = [...qs].sort((x, y) => y[1] - x[1])[0];
      return n ? { baseCm: sum / n, quality: top ? (SNOW_QUALITY_NAMES as unknown as Record<number, string>)[top[0]] : '' } : null;
    };
    onCardSelect = (sel) => {
      cardSel = sel && sel.id && game?.state ? sel : null;
      if (!cardSel) cardView.hide();
      else drawer.hide();
      cardRefreshMs = 0;
    };
    drawer.onShow = (name) => {
      if (name && cardSel) {
        cardSel = null;
        cardView.hide();
      }
    };
    function refreshCard(nowMs: number): void {
      if (!cardSel || !game?.state) return;
      if (nowMs - cardRefreshMs < 1000) return;
      cardRefreshMs = nowMs;
      if (guestCtl.isSummerDay) void guestCtl.liveSummerStats().then((st) => (cardStats = st));
      else cardStats = null;
      const ctx = game.cardContext(timePanel.hour, cardStats, guestCtl.liveLifts(), pisteSnowOf);
      if (!ctx) return;
      const card = objectCard(cardSel.kind as CardKind, cardSel.id, ctx);
      if (!card) {
        cardView.hide();
        return;
      }
      // Akcje widoku: pokaż na mapie i „zbuduj więcej” przy obiektach, które bywają wąskim gardłem.
      const extra: { id: string; label: string; primary?: boolean }[] = [];
      if (card.kindLabel === 'parking') extra.push({ id: 'moreParking', label: 'Zbuduj kolejny parking', primary: true });
      else if (card.kindLabel === 'gastronomia') extra.push({ id: 'moreFood', label: 'Postaw kolejny lokal', primary: true });
      else if (cardSel.kind === 'lift' && card.headline && card.headline.level !== 'good') extra.push({ id: 'moreLift', label: 'Zaplanuj drugi wyciąg', primary: true });
      else if (cardSel.kind === 'piste' && card.headline && card.headline.level === 'bad') extra.push({ id: 'snowPlan', label: 'Naśnieżanie i ratraki', primary: true });
      extra.push({ id: 'show', label: 'Pokaż na mapie' });
      cardView.show(card, cardSel.kind, extra, build.lineSmooth(cardSel.kind as Parameters<typeof build.lineSmooth>[0], cardSel.id));
    }
    // Etap 7b: wygląd lata (zielone łąki, szlaki PTTK) w miesiącach bez modelu śniegu.
    let summerLook = false;
    function refreshSeasonLook(): void {
      const m = timePanel.date.month;
      const on = m >= 5 && m <= 9;
      if (on === summerLook) return;
      summerLook = on;
      terrain.setSummer(on);
      build.setSummerLook(on);
      detailSummer = on;
      detail.setLayout(build.current.layout, build.current.analysis, on);
      if (on) minimap.setSnow(null, true);
    }

    /** Etap 7d: śnieg z bliska, obiekty z atlasu, cząsteczki (tylko przy dużym przybliżeniu). */
    const winchTypes = new Set(snowmakingParams.groomers.types.filter((t) => t.winch).map((t) => t.id));
    function detailFrame(night: number): void {
      const t0 = performance.now();
      detail.gameH = dayIndex(timePanel.date) * 24 + timePanel.hour;
      const light = terrain.lighting();
      const tint = (Math.round(light.tint[0] * 255) << 16) | (Math.round(light.tint[1] * 255) << 8) | Math.round(light.tint[2] * 255);
      const sun = lastState?.sun ?? { elevationDeg: 30, azimuthDeg: 180 };
      detail.update(camera, sun.elevationDeg, sun.azimuthDeg, (1 - night) * Math.min(1, 1.2 - (lastState?.cloudFraction ?? 0) * 0.7), tint);
      build.setPropsActive(atlas.ready && camera.metersPerPixel <= PropLayer.SHOW_MPP);
      if (camera.metersPerPixel > PropLayer.SHOW_MPP) {
        props.update(camera, { lifts: [], guns: [], winches: [], accidents: [], parked: [], timeS: 0, night });
        particles.update(camera, 0, [], []);
        timingsMs['detal z bliska (ms/klatkę)'] = Math.round((performance.now() - t0) * 10) / 10;
        return;
      }
      const lay = build.current.layout;
      const an = build.current.analysis;
      const st = game?.state;
      const gunsAll = (opsInfra?.guns ?? []).map((g) => ({ xM: g.xM, yM: g.yM, aimXM: g.aimXM, aimYM: g.aimYM, lance: g.typeId === 'lance' }));
      const anchors = opsInfra?.anchors ?? [];
      const winches = movers.groomers
        .filter((g) => {
          if (!g.id || !st?.ops) return false;
          const gr = st.ops.groomers.find((x) => x.id === g.id);
          if (!gr || !winchTypes.has(gr.typeId)) return false;
          const c = grid.cellAt(g.xM, g.yM);
          return !!c && detail.layer.slopePercent[grid.index(c.i, c.j)] >= snowmakingParams.groomers.winchSlopePercent;
        })
        .map((g) => {
          let best: { xM: number; yM: number } | null = null;
          let bd = Infinity;
          for (const a of anchors) {
            const d = Math.hypot(a.xM - g.xM, a.yM - g.yM);
            if (d <= a.rangeM && d < bd) {
              bd = d;
              best = a;
            }
          }
          return best ? { fromX: g.xM, fromY: g.yM, toX: best.xM, toY: best.yM } : null;
        })
        .filter((w): w is { fromX: number; fromY: number; toX: number; toY: number } => w !== null);
      const gameTimeS = guestCtl.gameTimeS ?? timePanel.hour * 3600;
      const firstLift = lay.lifts[0];
      props.update(camera, {
        lifts: lay.lifts.map((l) => ({ design: l, analysis: an.lifts.get(l.id)! })).filter((x) => x.analysis),
        guns: gunsAll,
        winches,
        accidents: guestCtl.recentAccidents(gameTimeS),
        parked: firstLift && !detailSummer ? [{ xM: firstLift.bottom.xM + 12, yM: firstLift.bottom.yM + 6, headingRad: 0 }] : [],
        timeS: gameTimeS,
        night,
      });
      const powder = lastSnow ? movers.skiersInView(camera, gameTimeS, 300).filter((p) => {
        const c = grid.cellAt(p.xM, p.yM);
        return !!c && lastSnow!.quality[grid.index(c.i, c.j)] === 1;
      }) : [];
      const pls = st && sameDate(st.date, timePanel.date) ? plumesAt(game!.preview?.summary ?? null, opsInfra, timePanel.hour) : [];
      particles.update(camera, performance.now() / 1000, pls, powder);
      timingsMs['detal z bliska (ms/klatkę)'] = Math.round((performance.now() - t0) * 10) / 10;
    }

    app.ticker.add((ticker) => {
      const frameStart = performance.now();
      refreshSeasonLook();
      refreshCard(performance.now());
      refreshTopBarGame(performance.now());
      noticeRules(performance.now());
      notices.tick(performance.now());
      minimap.update();
      timePanel.tick(performance.now());
      seasonTick(performance.now());
      clockTick(ticker.deltaMS / 1000);
      topBar.setClock(timePanel.date, timePanel.hour, timePanel.statusText);
      dataViews.setLayerState(build.networkShown, build.realityShown);
      input.update(ticker.deltaMS / 1000);
      // Przeliczenie metrów na piksele: świat jest w metrach, kamera mówi, ile pikseli to metr.
      const scale = camera.pixelsPerMeter;
      const sg = camera.sign;
      world.scale.set(scale);
      world.rotation = camera.rotated ? Math.PI : 0;
      world.position.set(camera.viewportWidthPx / 2 - sg * camera.centerXM * scale, camera.viewportHeightPx / 2 - sg * camera.centerYM * scale);
      worldOver.scale.copyFrom(world.scale);
      worldOver.rotation = world.rotation;
      worldOver.position.copyFrom(world.position);
      const nowS = performance.now() / 1000;
      const snowing = lastState && lastState.top.now.phase === 'snow' ? Math.min(1, lastState.top.now.precipitationMm) : 0;
      const night = terrain.lighting().night;
      guestCtl.sync(timePanel.date, timePanel.hour);
      terrain.update(camera, nowS, ticker.deltaMS / 1000, snowing);
      guestCtl.update(camera, night, timePanel.hour * 3600, ticker.deltaMS / 1000);
      detailFrame(night);
      if (overlay === 'traffic') trafficTick(ticker.deltaMS / 1000);
      profile.update(cursorNow());
      opsFrame();
      refreshSnowOps(false);
      // Etap 7f: w trakcie rysowania przy kursorze jest okienko budowy (długość, koszt) – bez dymka terenu.
      const sv = build.snapView;
      const cur = cursorNow();
      cursorTip.update(sv && (sv.info.length || sv.warn.length) ? null : cur, performance.now(), () => tipContent(cur!));
      contourLabels.update(camera);
      slopeRing.update(viewCam, cur, RING_TOOLS.has(build.currentTool));
      build.update(cur, guestCtl.gameTimeS ?? nowS);
      snapOverlay.update(viewCam, cur, build.snapView);
      handles3d.clear();
      if (cam3d) {
        const st3 = build.drawState;
        if (st3) drawEditHandles(handles3d, st3.handles ?? [], st3.hoverPoint, (x, y) => viewCam.worldToScreen(x, y));
      }
      parcelFrame();
      if (performance.now() - tutorialMs > 500) {
        tutorialMs = performance.now();
        if (buildBar.openCategory === 'snow') snowTutorial.offerOnce();
        snowTutorial.tick(tutorialMs);
      }
      hud.update(viewCam, grid, cur, lastSnow ? { ...lastSnow, ground: build.groundMap, riding: ridingParams } : null);
      const wx = lastState?.top.now;
      weatherFx.update(ticker.deltaMS / 1000, camera.viewportWidthPx, camera.viewportHeightPx, wx && wx.precipitationMm > 0 ? Math.min(1, 0.25 + wx.precipitationMm / 2) : 0, wx?.phase === 'rain', lastState?.cloudFraction ?? 0, wx?.windMs ?? 0);
      devMenu.frame(performance.now() - frameStart, `kafle terenu: ${terrain.stats.visibleTiles} widocznych, ${terrain.stats.bakedTotal} policzonych · goście: ${movers.personCount} w ramce, ${movers.visibleCount} na ekranie`);
    });

    // Do podglądu i testów w przeglądarce.
    (window as unknown as Record<string, unknown>).__skiSim = {
      camera,
      grid,
      profile,
      timingsMs,
      timePanel,
      getOverlay: () => overlay,
      getState: () => lastState,
      isEnvironmentReady: () => environmentReady,
      getSnow: () => lastSnow,
      terrain,
      showTopo,
      movers,
      devMenu,
      guests: guestCtl,
      setSpeed: (sp: number) => setGameSpeed(sp as GameSpeed),
      build,
      game,
      sim,
      ui: { shell, buildBar, drawer, notices, reportWindow, dataViews, cardView, minimap },
      detail,
      props,
      particles,
      atlas,
    };
  } catch (error) {
    console.error(error);
    message.classList.add('error');
    message.textContent = `Nie udało się uruchomić gry: ${error instanceof Error ? error.message : String(error)}`;
  }
}

void start();
