/**
 * Punkt startowy gry: wczytuje ustawienia, zleca wygenerowanie terenu wątkowi symulacji
 * (Web Worker) i pokazuje mapę z możliwością przesuwania i przybliżania.
 */
import { Application, Container } from 'pixi.js';
import settingsJson from '../data/settings.json';
import terrainGeneratorJson from '../data/terrain-generator.json';
import { parseSimSettings, parseTerrainGeneratorParams } from './sim';
import { Camera } from './render/camera';
import { Hud } from './render/hud';
import { MapInput } from './render/input';
import { createTerrainSprite } from './render/terrainLayer';
import { parseViewSettings } from './render/viewSettings';
import { generateTerrainInWorker } from './worker/simClient';

async function start(): Promise<void> {
  const root = document.getElementById('app')!;
  const message = document.createElement('div');
  message.className = 'message';
  message.textContent = 'Generuję teren…';
  document.body.appendChild(message);

  try {
    const simSettings = parseSimSettings(settingsJson);
    const viewSettings = parseViewSettings(settingsJson);
    const terrainParams = parseTerrainGeneratorParams(terrainGeneratorJson);

    const app = new Application();
    const terrainPromise = generateTerrainInWorker(simSettings.map, terrainParams, simSettings.seed);
    await app.init({
      resizeTo: root,
      background: '#1b1d21',
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    root.appendChild(app.canvas);

    const { grid, generationTimeMs } = await terrainPromise;
    console.info(
      `Teren ${grid.widthCells} × ${grid.heightCells} komórek po ${grid.cellSizeM} m ` +
        `(seed ${simSettings.seed}) wygenerowany w ${generationTimeMs.toFixed(0)} ms.`,
    );
    message.remove();

    const world = new Container();
    world.addChild(createTerrainSprite(grid));
    app.stage.addChild(world);

    const camera = new Camera(
      grid.widthM,
      grid.heightM,
      viewSettings.minMetersPerPixel,
      app.screen.width,
      app.screen.height,
    );
    const input = new MapInput(app.canvas, camera, viewSettings);
    const hud = new Hud(document.body, viewSettings.scaleBarMaxWidthPx);

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
      hud.update(camera, grid, input.cursor);
    });

    // Do podglądu i testów w przeglądarce.
    (window as unknown as Record<string, unknown>).__skiSim = { camera, grid };
  } catch (error) {
    console.error(error);
    message.classList.add('error');
    message.textContent = `Nie udało się uruchomić gry: ${error instanceof Error ? error.message : String(error)}`;
  }
}

void start();
