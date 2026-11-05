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
import {
  addDays,
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
import { DemoScene } from './render/demoScene';
import type { DemoPath } from './render/demoScene';
import { WeatherFx } from './render/weatherFx';
import { DevMenu } from './render/devMenu';
import { compareRealPistes } from './sim/resort';
import { BuildController } from './render/buildController';
import type { MapContextData, MapLabel } from './render/resortLayer';
import { parseLiftParams } from './sim/lifts';
import { parsePisteParams } from './sim/pistes';
import type { OsmResort } from './sim/resort';
import { parseConstructionParams } from './sim/resort';
import { SNOW_QUALITY_COLORS } from './render/colors';
import type { SnowReadoutData } from './render/hud';
import { Camera } from './render/camera';
import { FieldOverlay, fieldScale } from './render/fieldOverlay';
import type { FieldKind } from './render/fieldOverlay';
import { Hud } from './render/hud';
import { MapInput } from './render/input';
import { parseMapStyle } from './render/mapStyle';
import { createAspectOverlayCanvas, createSlopeOverlayCanvas } from './render/overlays';
import type { OverlayKind } from './render/overlays';
import { Legend, OVERLAY_KEYS, Toolbar } from './render/panels';
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
      background: '#1b1d21',
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

    const camera = new Camera(grid.widthM, grid.heightM, viewSettings.minMetersPerPixel, app.screen.width, app.screen.height);
    camera.rotated = viewSettings.rotatedByDefault;
    const input = new MapInput(app.canvas, camera, viewSettings);
    const hud = new Hud(document.body, viewSettings.scaleBarMaxWidthPx, style.flatSlopePercent);
    const rightColumn = document.createElement('div');
    rightColumn.className = 'right-column';
    document.body.appendChild(rightColumn);
    const legend = new Legend(rightColumn, slopeClasses, style.flatSlopePercent);

    // ---------------------------------------------------------------- nakładki
    const staticTextures = new Map<OverlayKind, Texture>();
    const field = new FieldOverlay(grid);
    let overlay: OverlayKind = 'none';
    let lastState: EnvironmentStateMessage | null = null;
    let radiationSum: { date: CalendarDate; values: Float32Array } | null = null;
    let radiationRequest = 0;
    const isField = (k: OverlayKind): k is FieldKind | 'snowQuality' =>
      k === 'insolation' || k === 'radiationSum' || k === 'temperature' || k === 'snowDepth' || k === 'snowQuality';
    let lastSnow: (SnowReadoutData & { date: CalendarDate }) | null = null;
    const fmtDate = (d: CalendarDate) => `${d.day}.${String(d.month).padStart(2, '0')}.${d.year}`;
    const sameDate = (a: CalendarDate, b: CalendarDate) => a.year === b.year && a.month === b.month && a.day === b.day;

    const toolbar = new Toolbar(document.body, {
      onOverlay: (kind) => setOverlay(kind),
      onProfileTool: () => profile.toggle(),
    });
    const left = document.createElement('div');
    left.className = 'left-column';
    document.body.appendChild(left);

    const timePanel = new TimePanel(
      left,
      { date: parseIsoDate(simSettings.startDate), hour: simSettings.startHour },
      simSettings.playDayDurationS,
      (t) => requestState(t),
    );
    const weatherPanel = new WeatherPanel(left);
    const profile = new ProfileTool(screenLayer, document.body, grid, camera, slopeClasses, (active) => {
      toolbar.setProfileActive(active);
      app.canvas.classList.toggle('tool-profile', active);
    });

    // ---------------------------------------------------------------- budowa ośrodka
    let onLandCoverChange: (forest: Float32Array, shrub: Float32Array) => void = () => {};
    const liftParams = parseLiftParams(liftsJson);
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
      forest: landCover?.forest ?? null,
      shrub: landCover?.shrub ?? null,
      osm: (OSM_RESORTS[`../data/maps/${simSettings.mapName}/osm-resort.json`] as OsmResort | undefined) ?? null,
      storageKey: `ski-sim:osrodek:${simSettings.mapName}`,
      lod: style.illustrated.lod,
      context: (OSM_CONTEXTS[`../data/maps/${simSettings.mapName}/osm-context.json`] as MapContextData | undefined) ?? null,
      labels: ((MAP_LABELS[`../data/maps/${simSettings.mapName}/labels.json`] as { labels?: MapLabel[] } | undefined)?.labels ?? []),
      borderLinesLocal,
      onLandCover: (f, sh) => onLandCoverChange(f, sh),
      onLayoutChange: (layout, analysis) =>
        terrain.setLayout(layout, new Map([...analysis.pistes].map(([id, a]) => [id, a.axis.filter((x) => !Number.isNaN(x.elevationM))])), liftParams),
      onToolChange: (tool) => {
        app.canvas.classList.toggle('tool-build', tool !== 'select');
        if (tool !== 'select') profile.setActive(false);
      },
    });

    function refreshField(): void {
      if (!isField(overlay)) return;
      if (overlay === 'snowDepth' || overlay === 'snowQuality') {
        if (!lastSnow) {
          legend.setFieldInfo(null, 'liczę śnieg…');
          return;
        }
        const info = `koniec dnia ${fmtDate(lastSnow.date)}; śnieg naturalny (bez ratraków i naśnieżania)`;
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
      if (kind === 'none') {
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
          lastSnow = { date: m.date, depthCm: m.depthCm, sweMm: m.sweMm, densityKgM3: m.densityKgM3, quality: m.quality };
          terrain.setSnow(m.depthCm, m.quality);
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
          if (e instanceof Error && e.message === '__superseded__') return; // zastąpione nowszym pytaniem
          timePanel.setStatus(`Błąd modelu śniegu: ${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => snowInflight--);
    }
    sim.onSnowProgress = (p) => {
      if (p.phase === 'radiation') timePanel.setStatus(`Liczę promieniowanie na sezon (raz na sezon)… ${f0(p.fraction * 100)} %`);
      else if (p.date) timePanel.setStatus(`Liczę śnieg dzień po dniu… ${fmtDate(p.date)}`);
    };
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

    void (async () => {
      try {
        let dem: HorizonDem | null = null;
        if (def?.horizonDem) {
          timePanel.setStatus('Wczytuję teren okolicy (do cieni)…');
          const response = await fetch(binaryUrl(simSettings.mapName, def.horizonDem.file));
          if (!response.ok) throw new Error(`Nie udało się pobrać modelu terenu okolicy (HTTP ${response.status})`);
          dem = createHorizonDem(def, await response.arrayBuffer());
        }
        const horizonParams = parseHorizonParams(radiationJson);
        const { field: horizon, fromCache, timeMs } = await computeHorizonCached(grid, dem, horizonParams, (f) =>
          timePanel.setStatus(`Liczę cienie terenu (raz, potem zapamiętane)… ${f0(f * 100)} %`),
        );
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
          seed: simSettings.seed,
          location,
        });
        environmentReady = true;
        console.info(`Czasy [ms]: ${JSON.stringify(timingsMs)}`);
        requestState(pendingTime ?? { date: timePanel.date, hour: timePanel.hour });
        refreshField();
        const n = grid.cellCount;
        const cover = build.currentLandCover();
        await sim.initSnow(cover?.forest ?? landCover?.forest.slice() ?? new Float32Array(n), cover?.shrub ?? landCover?.shrub.slice() ?? new Float32Array(n), snowJson);
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

    // ---------------------------------------------------------------- obiekty ruchome, scena demonstracyjna, pogoda
    const movers = new MoverLayer(world);
    const demo = new DemoScene(simSettings.seed, terrain.groom, terrain.ski, style.illustrated.surface.groomerWidthM);
    const weatherFx = new WeatherFx(screenLayer);
    let demoOn = false;
    const demoPaths = (): DemoPath[] => {
      const { layout, analysis } = build.current;
      const built = layout.pistes.map((p) => ({ points: (analysis.pistes.get(p.id)?.axis ?? []).filter((x) => !Number.isNaN(x.elevationM)) }));
      if (built.some((b) => b.points.length >= 2)) return built;
      // Brak tras w grze – prawdziwe trasy Pilska z OSM.
      const osm = OSM_RESORTS[`../data/maps/${simSettings.mapName}/osm-resort.json`] as OsmResort | undefined;
      if (!osm) return [];
      const pp = parsePisteParams(pistesJson);
      return compareRealPistes(osm, grid, pp, (e, n) => grid.puwg92ToLocal(e, n)).map((r) => ({ points: r.analysis.axis.filter((x) => !Number.isNaN(x.elevationM)) }));
    };
    const devMenu = new DevMenu(document.body, {
      onDemo: (on, skiers) => {
        demoOn = on;
        if (on) demo.setup(demoPaths(), skiers);
        else movers.setMovers([]);
      },
    });
    {
      // Adres ?demo=2000 – od razu scena demonstracyjna (do pomiarów).
      const q = new URLSearchParams(window.location.search).get('demo');
      if (q) {
        const n = Number(q) || 50;
        devMenu.setDemo(true, n);
        demoOn = true;
        demo.setup(demoPaths(), n);
      }
    }

    // ---------------------------------------------------------------- sterowanie
    input.onClick = (x, y) => {
      if (!profile.handleClick(x, y)) build.handleClick(x, y);
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
      const digit = /^(Digit|Numpad)([1-9])$/.exec(code);
      if (digit) {
        const o = OVERLAY_KEYS[Number(digit[2]) - 1];
        if (o) setOverlay(o.kind);
        return Boolean(o);
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
      input.update(ticker.deltaMS / 1000);
      // Przeliczenie metrów na piksele: świat jest w metrach, kamera mówi, ile pikseli to metr.
      const scale = camera.pixelsPerMeter;
      const sg = camera.sign;
      world.scale.set(scale);
      world.rotation = camera.rotated ? Math.PI : 0;
      world.position.set(camera.viewportWidthPx / 2 - sg * camera.centerXM * scale, camera.viewportHeightPx / 2 - sg * camera.centerYM * scale);
      const nowS = performance.now() / 1000;
      const snowing = lastState && lastState.top.now.phase === 'snow' ? Math.min(1, lastState.top.now.precipitationMm) : 0;
      const night = terrain.lighting().night;
      if (demoOn) movers.setMovers(demo.step(ticker.deltaMS / 1000, night));
      terrain.update(camera, nowS, ticker.deltaMS / 1000, snowing);
      movers.update(camera, night);
      profile.update(input.cursor);
      build.update(input.cursor, nowS);
      hud.update(camera, grid, input.cursor, lastSnow);
      const wx = lastState?.top.now;
      weatherFx.update(ticker.deltaMS / 1000, camera.viewportWidthPx, camera.viewportHeightPx, wx && wx.precipitationMm > 0 ? Math.min(1, 0.25 + wx.precipitationMm / 2) : 0, wx?.phase === 'rain', lastState?.cloudFraction ?? 0, wx?.windMs ?? 0);
      devMenu.frame(performance.now() - frameStart, `kafle terenu: ${terrain.stats.visibleTiles} widocznych, ${terrain.stats.bakedTotal} policzonych · obiekty ruchome: ${movers.visibleCount} na ekranie`);
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
      build,
    };
  } catch (error) {
    console.error(error);
    message.classList.add('error');
    message.textContent = `Nie udało się uruchomić gry: ${error instanceof Error ? error.message : String(error)}`;
  }
}

void start();
