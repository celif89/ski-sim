/**
 * Punkt startowy gry: wczytuje ustawienia, zleca przygotowanie terenu wątkowi symulacji
 * (Web Worker), buduje mapę bazową i nakładki, obsługuje przesuwanie, zoom i narzędzia.
 */
import { Application, CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import mapStyleJson from '../data/map-style.json';
import settingsJson from '../data/settings.json';
import slopeClassesJson from '../data/slope-classes.json';
import terrainGeneratorJson from '../data/terrain-generator.json';
import { parseMapDefinition, parseSimSettings, parseSlopeClasses, parseTerrainGeneratorParams } from './sim';
import type { MapDefinition } from './sim';
import { createBaseMapCanvas } from './render/baseMap';
import { Camera } from './render/camera';
import { Hud } from './render/hud';
import { MapInput } from './render/input';
import { parseMapStyle } from './render/mapStyle';
import { createAspectOverlayCanvas, createSlopeOverlayCanvas } from './render/overlays';
import type { OverlayKind } from './render/overlays';
import { Legend, Toolbar } from './render/panels';
import { ProfileTool } from './render/profileTool';
import { parseViewSettings } from './render/viewSettings';
import type { WorkerRequest } from './worker/protocol';
import { prepareTerrainInWorker } from './worker/simClient';

// Wszystkie mapy z data/maps/<nazwa>/: opis dołączany do programu, plik wysokości jako osobny zasób.
const MAP_JSONS = import.meta.glob('../data/maps/*/map.json', { eager: true, import: 'default' });
const MAP_ELEVATION_URLS = import.meta.glob('../data/maps/*/*.f32', { eager: true, query: '?url', import: 'default' });

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
  const elevationUrl = MAP_ELEVATION_URLS[`../data/maps/${mapName}/${def.elevationFile}`] as string | undefined;
  if (!elevationUrl) throw new Error(`Brak pliku ${def.elevationFile} w data/maps/${mapName}/ – uruchom npm run import-nmt`);
  // Adres względem strony (działa także pod ścieżką GitHub Pages).
  const absoluteUrl = new URL(elevationUrl, window.location.href).href;
  return { request: { type: 'loadMap', mapJson, elevationUrl: absoluteUrl, ...common }, def };
}

function textureFromCanvas(canvas: HTMLCanvasElement): Texture {
  // Mipmapy: przy oddaleniu tekstura jest gładko pomniejszana (warstwice nie migoczą).
  const source = new CanvasSource({ resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear' });
  source.style.mipmapFilter = 'linear';
  return new Texture({ source });
}

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
    const { request, def } = buildTerrainRequest(simSettings.mapName, simSettings.seed, style);

    const app = new Application();
    const terrainPromise = prepareTerrainInWorker(request);
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
    console.info(
      `Teren ${grid.widthCells} × ${grid.heightCells} komórek po ${grid.cellSizeM} m` +
        (def ? ` – mapa „${def.name}”` : ` – generator (seed ${simSettings.seed})`) +
        `; ${contours.length} linii warstwic. Czasy [ms]: ${JSON.stringify(timingsMs)}`,
    );
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

    // Nakładki liczone przy pierwszym włączeniu.
    const overlayTextures = new Map<OverlayKind, Texture>();
    let overlay: OverlayKind = 'none';
    const toolbar = new Toolbar(document.body, {
      onOverlay: (kind) => setOverlay(kind),
      onProfileTool: () => profile.toggle(),
    });
    const profile = new ProfileTool(screenLayer, document.body, grid, camera, slopeClasses, (active) => {
      toolbar.setProfileActive(active);
      app.canvas.classList.toggle('tool-profile', active);
    });
    function setOverlay(kind: OverlayKind): void {
      overlay = kind;
      if (kind === 'none') {
        overlaySprite.visible = false;
      } else {
        let texture = overlayTextures.get(kind);
        if (!texture) {
          const canvas =
            kind === 'slope'
              ? createSlopeOverlayCanvas(grid, slopeClasses, style.overlayMetersPerPixel)
              : createAspectOverlayCanvas(grid, style.flatSlopePercent, style.overlayMetersPerPixel);
          texture = textureFromCanvas(canvas);
          overlayTextures.set(kind, texture);
        }
        overlaySprite.texture = texture;
        fitToMap(overlaySprite);
        overlaySprite.visible = true;
      }
      toolbar.setOverlay(kind);
      legend.show(kind);
    }
    setOverlay('none');

    input.onClick = (x, y) => profile.handleClick(x, y);
    input.onKey = (code) => {
      if (code === 'Digit1' || code === 'Numpad1') setOverlay('slope');
      else if (code === 'Digit2' || code === 'Numpad2') setOverlay('aspect');
      else if (code === 'Digit3' || code === 'Numpad3') setOverlay('none');
      else if (code === 'KeyP') profile.toggle();
      else if (code === 'Escape') profile.setActive(false);
      else return false;
      return true;
    };

    app.renderer.on('resize', (width: number, height: number) => camera.setViewport(width, height));

    app.ticker.add((ticker) => {
      input.update(ticker.deltaMS / 1000);
      // Przeliczenie metrów na piksele: świat jest w metrach, kamera mówi, ile pikseli to metr.
      const scale = camera.pixelsPerMeter;
      world.scale.set(scale);
      world.position.set(
        camera.viewportWidthPx / 2 - camera.centerXM * scale,
        camera.viewportHeightPx / 2 - camera.centerYM * scale,
      );
      profile.update(input.cursor);
      hud.update(camera, grid, input.cursor);
    });

    // Do podglądu i testów w przeglądarce.
    (window as unknown as Record<string, unknown>).__skiSim = { camera, grid, profile, timingsMs, getOverlay: () => overlay };
  } catch (error) {
    console.error(error);
    message.classList.add('error');
    message.textContent = `Nie udało się uruchomić gry: ${error instanceof Error ? error.message : String(error)}`;
  }
}

void start();
