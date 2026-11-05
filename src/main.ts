/**
 * Punkt startowy gry: wczytuje ustawienia, zleca przygotowanie terenu wątkowi symulacji
 * (Web Worker), buduje mapę bazową i nakładki, liczy horyzont (cienie), uruchamia moduł słońca
 * i pogody, obsługuje przesuwanie, zoom, panele i narzędzia.
 */
import { Application, CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import mapStyleJson from '../data/map-style.json';
import radiationJson from '../data/radiation.json';
import settingsJson from '../data/settings.json';
import slopeClassesJson from '../data/slope-classes.json';
import terrainGeneratorJson from '../data/terrain-generator.json';
import weatherJson from '../data/weather-generator.json';
import {
  createHorizonDem,
  parseHorizonParams,
  parseIsoDate,
  parseMapDefinition,
  parseSimSettings,
  parseSlopeClasses,
  parseTerrainGeneratorParams,
  puwg92ToLatLon,
} from './sim';
import type { CalendarDate, HorizonDem, Location, MapDefinition } from './sim';
import { createBaseMapCanvas } from './render/baseMap';
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
const MAP_BINARY_URLS = import.meta.glob('../data/maps/*/*.f32', { eager: true, query: '?url', import: 'default' });
const CLIMATE_JSONS = import.meta.glob('../data/climate/*.json', { eager: true, import: 'default' });

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
    message.textContent = 'Rysuję mapę…';
    await new Promise((r) => requestAnimationFrame(r));

    const t0 = performance.now();
    const borderLinesLocal = (def?.borderLines ?? []).map((line) =>
      line.map(([e, n]) => {
        const p = grid.puwg92ToLocal(e, n)!;
        return [p.xM, p.yM];
      }),
    );
    const baseCanvas = createBaseMapCanvas({ grid, hillshade, contours, borderLinesLocal, style });
    timingsMs['mapa bazowa (rysowanie)'] = Math.round(performance.now() - t0);
    message.remove();

    // Świat w metrach: tekstury rozciągnięte na wymiar mapy.
    const world = new Container();
    const fitToMap = (sprite: Sprite) => {
      sprite.width = grid.widthM;
      sprite.height = grid.heightM;
      return sprite;
    };
    world.addChild(fitToMap(new Sprite(textureFromCanvas(baseCanvas))));
    const overlaySprite = new Sprite();
    overlaySprite.alpha = style.overlayOpacity;
    world.addChild(overlaySprite);
    app.stage.addChild(world);
    const screenLayer = new Container(); // elementy w pikselach ekranu (np. profil)
    app.stage.addChild(screenLayer);

    const camera = new Camera(grid.widthM, grid.heightM, viewSettings.minMetersPerPixel, app.screen.width, app.screen.height);
    const input = new MapInput(app.canvas, camera, viewSettings);
    const hud = new Hud(document.body, viewSettings.scaleBarMaxWidthPx, style.flatSlopePercent);
    const legend = new Legend(document.body, slopeClasses, style.flatSlopePercent);

    // ---------------------------------------------------------------- nakładki
    const staticTextures = new Map<OverlayKind, Texture>();
    const field = new FieldOverlay(grid);
    let overlay: OverlayKind = 'none';
    let lastState: EnvironmentStateMessage | null = null;
    let radiationSum: { date: CalendarDate; values: Float32Array } | null = null;
    let radiationRequest = 0;
    const isField = (k: OverlayKind): k is FieldKind => k === 'insolation' || k === 'radiationSum' || k === 'temperature';
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

    function refreshField(): void {
      if (!isField(overlay)) return;
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
          weatherPanel.update(s);
          timePanel.setSun({ ...s.sun, summerTime: s.summerTime });
          if (overlay === 'radiationSum' && radiationSum && !sameDate(radiationSum.date, t.date)) radiationSum = null;
          refreshField();
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
      } catch (e) {
        console.error(e);
        timePanel.setStatus(`Nie udało się uruchomić słońca i pogody: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    requestState({ date: timePanel.date, hour: timePanel.hour });

    // ---------------------------------------------------------------- sterowanie
    input.onClick = (x, y) => profile.handleClick(x, y);
    input.onKey = (code) => {
      const digit = /^(Digit|Numpad)([1-9])$/.exec(code);
      if (digit) {
        const o = OVERLAY_KEYS[Number(digit[2]) - 1];
        if (o) setOverlay(o.kind);
        return Boolean(o);
      }
      if (code === 'KeyP') profile.toggle();
      else if (code === 'Escape') profile.setActive(false);
      else return false;
      return true;
    };

    app.renderer.on('resize', (width: number, height: number) => camera.setViewport(width, height));

    app.ticker.add((ticker) => {
      timePanel.tick(performance.now());
      input.update(ticker.deltaMS / 1000);
      // Przeliczenie metrów na piksele: świat jest w metrach, kamera mówi, ile pikseli to metr.
      const scale = camera.pixelsPerMeter;
      world.scale.set(scale);
      world.position.set(camera.viewportWidthPx / 2 - camera.centerXM * scale, camera.viewportHeightPx / 2 - camera.centerYM * scale);
      profile.update(input.cursor);
      hud.update(camera, grid, input.cursor);
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
    };
  } catch (error) {
    console.error(error);
    message.classList.add('error');
    message.textContent = `Nie udało się uruchomić gry: ${error instanceof Error ? error.message : String(error)}`;
  }
}

void start();
