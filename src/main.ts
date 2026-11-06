/**
 * Punkt startowy gry: wczytuje ustawienia, zleca przygotowanie terenu wątkowi symulacji
 * (Web Worker), buduje mapę bazową i nakładki, liczy horyzont (cienie), uruchamia moduł słońca
 * i pogody, obsługuje przesuwanie, zoom, panele i narzędzia.
 */
import { Application, CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
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
import { parseEconomyParams, withSnowmaking } from './sim/economyParams';
import snowmakingJson from '../data/snowmaking.json';
import winterClassesJson from '../data/winter-classes.json';
import { careerSeed, parseWinterClasses, winterClass, winterPercentile, winterSkiDays } from './sim/winterClass';
import { parseSnowmakingParams } from './sim/snowmakingParams';
import { wetBulbC } from './sim/snowmaking';
import { NightPlanDialog, SnowPanel, SnowPlanDialog } from './render/snowPanels';
import type { PlanPiste } from './render/snowPanels';
import { OpsView, plumesAt } from './render/opsView';
import { WeatherBook } from './sim/weatherBook';
import { parseClimateProfile } from './sim/climate';
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
import { parseLiftParams } from './sim/lifts';
import { parsePisteParams } from './sim/pistes';
import type { OsmResort, ResortAnalysis, ResortLayout } from './sim/resort';
import { parseConstructionParams } from './sim/resort';
import { parseGroundParams } from './sim/ground';
import { parseRidingParams, thinField } from './sim/snowRiding';
import { GROUND_COLORS, SNOW_QUALITY_COLORS } from './render/colors';
import type { SnowReadoutData } from './render/hud';
import { Camera } from './render/camera';
import { FieldOverlay, fieldScale } from './render/fieldOverlay';
import type { FieldKind } from './render/fieldOverlay';
import { Hud } from './render/hud';
import { MapInput } from './render/input';
import { parseMapStyle } from './render/mapStyle';
import { TopBar, type GameSpeed, type SnowAtPoints } from './render/topBar';
import { BuildBar, MapNav } from './render/buildBar';
import { createAspectOverlayCanvas, createSlopeOverlayCanvas } from './render/overlays';
import type { OverlayKind } from './render/overlays';
import { Legend, OVERLAY_KEYS, Toolbar, WET_BULB_COLORS } from './render/panels';
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
      background: '#d5dde6',
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    root.appendChild(app.canvas);

    const { grid, hillshade, contours, timingsMs } = await terrainPromise;
    // Pokrycie terenu (las) – do mapy bazowej i modelu śniegu.
    let landCover: { forest: Float32Array; shrub: Float32Array } | null = null;
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
    const screenLayer = new Container(); // elementy w pikselach ekranu (np. profil)
    app.stage.addChild(screenLayer);
    // Nad liniami tras i wyciągów (warstwa ekranu): postacie i nakładka ruchu – osobny kontener
    // z przekształceniem świata.
    const worldOver = new Container();
    app.stage.addChild(worldOver);

    const camera = new Camera(grid.widthM, grid.heightM, viewSettings.minMetersPerPixel, app.screen.width, app.screen.height);
    camera.rotated = viewSettings.rotatedByDefault;
    const input = new MapInput(app.canvas, camera, viewSettings);
    const hud = new Hud(document.body, viewSettings.scaleBarMaxWidthPx, style.flatSlopePercent);
    const rightColumn = document.createElement('div');
    rightColumn.className = 'right-column';
    document.body.appendChild(rightColumn);
    const legend = new Legend(rightColumn, slopeClasses, style.flatSlopePercent, parsePisteParams(pistesJson).classes.map((c) => ({ name: c.name, color: c.color })));

    // ---------------------------------------------------------------- nakładki
    const staticTextures = new Map<OverlayKind, Texture>();
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
    let lastSnow: (SnowReadoutData & { date: CalendarDate; moguls?: Uint8Array }) | null = null;
    const fmtDate = (d: CalendarDate) => `${d.day}.${String(d.month).padStart(2, '0')}.${d.year}`;
    const sameDate = (a: CalendarDate, b: CalendarDate) => a.year === b.year && a.month === b.month && a.day === b.day;

    // Interfejs w stylu A: górny pasek (czas, pogoda, prędkość), dolny pasek budowy, róża kierunków.
    let gameSpeed: GameSpeed = 0;
    const topBar = new TopBar(document.body, { onSpeed: (sp) => setGameSpeed(sp) });
    const buildBar = new BuildBar(document.body, {
      onTool: (tool) => {
        if (tool !== 'select') profile.setActive(false);
        build.setTool(tool);
      },
      onInfo: (text) => buildBar.showToast(text),
    });
    const mapNav = new MapNav(document.body, {
      onRotate: () => {
        camera.toggleRotation();
        mapNav.setRotated(camera.rotated);
      },
      onZoom: (f) => camera.zoomAt(camera.viewportWidthPx / 2, camera.viewportHeightPx / 2, f),
    });
    mapNav.setRotated(camera.rotated);
    const toolbar = new Toolbar(buildBar.layersPop, {
      onOverlay: (kind) => setOverlay(kind),
      onProfileTool: () => {
        if (!profile.active) build.setTool('select');
        profile.toggle();
      },
    });
    let topoOn = false;
    const layerExtras = document.createElement('div');
    layerExtras.className = 'a-layers-extra';
    layerExtras.innerHTML = `
      <button type="button" data-l="topo" title="Dawna mapa topograficzna: warstwice co 10 m, barwy wysokości, opisy">Mapa topograficzna</button>
      <button type="button" data-l="net" title="Strzałki kierunku zjazdu, numery, połączenia (klawisz N)"><kbd>N</kbd> Sieć tras</button>
      <button type="button" data-l="real" title="Prawdziwe wyciągi i trasy Pilska z OpenStreetMap (klawisz R)"><kbd>R</kbd> Prawdziwy ośrodek</button>`;
    buildBar.layersPop.prepend(Object.assign(document.createElement('div'), { className: 'a-pop-title', textContent: 'Nakładki' }));
    buildBar.layersPop.appendChild(layerExtras);
    const layerBtn = (k: string) => layerExtras.querySelector<HTMLButtonElement>(`[data-l="${k}"]`)!;
    layerBtn('topo').addEventListener('click', () => {
      topoOn = !topoOn;
      showTopo(topoOn);
    });
    layerBtn('net').addEventListener('click', () => build.toggleNetwork());
    layerBtn('real').addEventListener('click', () => build.toggleReality());
    const refreshLayerButtons = () => {
      layerBtn('topo').classList.toggle('active', topoOn);
      layerBtn('net').classList.toggle('active', build.networkShown);
      layerBtn('real').classList.toggle('active', build.realityShown);
    };

    // Gra (etap 6) – tworzona niżej, gdy gotowe są budowa i goście.
    let game: GameController | null = null;
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
    const profile = new ProfileTool(screenLayer, document.body, grid, camera, slopeClasses, (active) => {
      toolbar.setProfileActive(active);
      app.canvas.classList.toggle('tool-profile', active);
    });

    // ---------------------------------------------------------------- budowa ośrodka
    let onLandCoverChange: (forest: Float32Array, shrub: Float32Array) => void = () => {};
    // Goście dostają sieć ośrodka po każdej zmianie układu (ustawiane niżej, gdy kontroler gości gotowy).
    let onGuestLayout: (layout: ResortLayout, analysis: ResortAnalysis) => void = () => {};
    const liftParams = parseLiftParams(liftsJson);
    const ridingParams = parseRidingParams(snowJson);
    const snowmakingParams = parseSnowmakingParams(snowmakingJson);
    const economyParams = withSnowmaking(parseEconomyParams(economyJson), snowmakingParams);
    // Ostrzeżenia „za mało śniegu” → panel gości (ustawiane niżej, gdy kontroler gości gotowy).
    let onSnowWarnings: (w: SnowWarning[]) => void = () => {};
    const build = new BuildController({
      grid,
      camera,
      world,
      screenLayer,
      panelParent: rightColumn,
      profileParent: document.body,
      liftParams,
      pisteParams: parsePisteParams(pistesJson),
      clearing: parseConstructionParams(constructionJson).clearing,
      ground: parseGroundParams(constructionJson),
      riding: ridingParams,
      onSnowWarnings: (w) => onSnowWarnings(w),
      beforeCommit: (next, a) => game?.beforeCommit(next, a) ?? null,
      buildingTypes: [
        ...economyParams.buildings.map((b) => ({ id: b.id, name: b.name, base: b.base, costPln: b.costPln })),
        ...snowmakingParams.buildings.map((b) => ({ id: b.id, name: `${b.name}${b.summerOnly ? ' (budowa V–X)' : ''}`, base: false, costPln: b.costPln })),
      ],
      snowmaking: snowmakingParams,
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
        terrain.setLayout(layout, new Map([...analysis.pistes].map(([id, a]) => [id, a.axis.filter((x) => !Number.isNaN(x.elevationM))])), liftParams);
        if (game?.state) game.onLayoutChange(layout, analysis);
        else onGuestLayout(layout, analysis);
        sendGuestSnow();
        if (overlay === 'ground') refreshField();
      },
      onToolChange: (tool) => {
        buildBar.setTool(tool);
        app.canvas.classList.toggle('tool-build', tool !== 'select');
        if (tool !== 'select') profile.setActive(false);
      },
    });

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
        const info = `koniec dnia ${fmtDate(lastSnow.date)}; śnieg naturalny + techniczny (naśnieżanie i ratraki z zamkniętych dni gry)`;
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
      } else if (isField(kind)) {
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
        }
        overlaySprite.texture = texture;
        fitToMap(overlaySprite);
        overlaySprite.visible = true;
      }
      toolbar.setOverlay(kind);
      legend.show(kind);
    }
    setOverlay('none');

    // ---------------------------------------------------------------- słońce i pogoda
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
    function requestSnow(date: CalendarDate): void {
      // Ekonomia przelicza dni (pyta wątek o śnieg dzień po dniu) – mapa dostanie śnieg po zakończeniu.
      if (game?.busy) {
        snowRequestedDate = date;
        return;
      }
      if (!snowReady) {
        snowRequestedDate = date;
        return;
      }
      if (lastSnow && sameDate(lastSnow.date, date)) return;
      if (snowRequestedDate && sameDate(snowRequestedDate, date) && snowInflight > 0) return;
      snowRequestedDate = date;
      const id = ++latestSnowRequest;
      snowInflight++;
      sim
        .snowState(date)
        .then((m) => {
          if (id !== latestSnowRequest) return;
          lastSnow = { date: m.date, depthCm: m.depthCm, sweMm: m.sweMm, densityKgM3: m.densityKgM3, quality: m.quality, moguls: m.moguls };
          build.setSnow(m.sweMm);
          sendGuestSnow();
          terrain.setSnow(m.depthCm, m.quality, m.moguls);
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
              if (id === latestSnowRequest && !(lastSnow && sameDate(lastSnow.date, date))) requestSnow(date);
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
    const movers = new MoverLayer(worldOver);
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
      ski: terrain.ski,
      screenLayer: guestOverlay,
      camera,
      panelParent: rightColumn,
      cardParent: document.body,
      initialGuests: Number.isFinite(urlGuests) && urlGuests > 0 ? urlGuests : guestParams.scenario.guestsPerDay,
      onDaySummary: (date, summary) => game?.onDaySummary(date, summary),
      manualGuests: () => !game?.state || game.mode === 'sandbox',
      onDayTraffic: (date, passes) => {
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
        }),
      );
    onGuestLayout(build.current.layout, build.current.analysis);

    // ---------------------------------------------------------------- gra: ekonomia i sezon (etap 6)
    const climateProfile = parseClimateProfile(climateJson);
    const weatherParamsMain = parseWeatherParams(weatherJson);
    const elevRange = grid.elevationRangeM();
    const weatherBook = new WeatherBook(climateProfile, weatherParamsMain, simSettings.seed, location, Math.round(elevRange.minM), Math.round(elevRange.maxM));
    const waitMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const winterTable = parseWinterClasses(winterClassesJson);
    const winterDeps = { profile: climateProfile, weatherParams: weatherParamsMain, snowParams: parseSnowParams(snowJson), radiationParams: parseRadiationParams(radiationJson), riding: ridingParams, location };
    game = new GameController({
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
      panelParent: rightColumn,
      modalParent: document.body,
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
    const snowPlanDialog = new SnowPlanDialog(document.body, () => game?.opsChanged());
    const nightPlanDialog = new NightPlanDialog(
      document.body,
      () => game?.opsChanged(),
      (id, on) => game?.setDayGroom(id, on),
    );
    const snowPanel = new SnowPanel(rightColumn, {
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
    });
    snowPanel.setVisible(false);
    function refreshSnowOps(force: boolean): void {
      const st = game?.state;
      snowPanel.setVisible(Boolean(st));
      if (!st) return;
      const now = performance.now();
      if (!force && now - snowPanelMs < 500) return;
      snowPanelMs = now;
      if (force) opsInfra = game!.infra();
      snowPanel.update({ state: st, infra: opsInfra, preview: game!.preview, hour: timePanel.hour, sp: snowmakingParams, pisteName, blocked: game!.blockedPistes });
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
      movers.groomers = opsView.groomers(timePanel.date, timePanel.hour, pv, st.ops?.last ?? null, build.current.analysis, terrain.groom);
    }
    {
      const mode = new URLSearchParams(window.location.search).get('tryb');
      if (mode === 'kariera') game.newGame('career');
      else if (mode === 'piaskownica') game.newGame('sandbox');
      else if (mode !== 'widok') void game.showStart();
    }
    const devMenu = new DevMenu(document.body);

    // ---------------------------------------------------------------- sterowanie
    input.onClick = (x, y) => {
      if (profile.handleClick(x, y)) return;
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

    app.ticker.add((ticker) => {
      const frameStart = performance.now();
      timePanel.tick(performance.now());
      seasonTick(performance.now());
      clockTick(ticker.deltaMS / 1000);
      topBar.setClock(timePanel.date, timePanel.hour, timePanel.statusText);
      refreshLayerButtons();
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
      if (overlay === 'traffic') trafficTick(ticker.deltaMS / 1000);
      profile.update(input.cursor);
      opsFrame();
      refreshSnowOps(false);
      build.update(input.cursor, guestCtl.gameTimeS ?? nowS);
      hud.update(camera, grid, input.cursor, lastSnow ? { ...lastSnow, ground: build.groundMap, riding: ridingParams } : null);
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
    };
  } catch (error) {
    console.error(error);
    message.classList.add('error');
    message.textContent = `Nie udało się uruchomić gry: ${error instanceof Error ? error.message : String(error)}`;
  }
}

void start();
