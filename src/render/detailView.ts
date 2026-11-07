/**
 * Etap 7d: warstwa detalu 1 m w grze – łączy symulację detalu (src/sim/detailLayer.ts) z procesami:
 *  – ratrak na mapie „pisze” sztruks (te same pasy co na rysunku), noc przewinięta – całe zadania,
 *  – narciarze na ekranie zostawiają ślady, przejazdy całego dnia – ślady i muldy,
 *  – armatki – pryzmy z przesunięciem z wiatrem,
 *  – model śniegu 10 m – uzgodnienie średnich (muldy, pryzmy, lód, przetarcia) po każdym kroku,
 *  – świeży śnieg zasypuje sztruks i ślady.
 * Rysowanie: DetailRenderer (tylko przy dużym przybliżeniu, okno wokół widoku).
 */
import type { Container } from 'pixi.js';
import type { OpsSummary } from '../sim/economy';
import { DetailLayer, groomWholeJob, parseDetailParams, turnField } from '../sim/detailLayer';
import type { MogulRule } from '../sim/detailLayer';
import type { ResortAnalysis, ResortLayout } from '../sim/resort';
import type { TerrainGrid } from '../sim/terrainGrid';
import { DetailRenderer, parseDetailRenderParams } from './detailRenderer';
import type { Camera } from './camera';
import type { TerrainRenderer } from './terrainRenderer';

const GROOMER_WIDTH_M = 5.5;

export class DetailView {
  readonly layer: DetailLayer;
  readonly renderer: DetailRenderer;
  private turn: Float32Array | null = null;
  private nightApplied = '';
  private plumeHour = '';
  /** Godzina gry (bieżąca) – znacznik czasu sztruksu. */
  gameH = 0;

  constructor(
    world: Container,
    private readonly terrain: TerrainRenderer,
    private readonly grid: TerrainGrid,
    detailJson: unknown,
    seed: number,
    private readonly rule: MogulRule,
  ) {
    this.layer = new DetailLayer({ widthCells: grid.widthCells, heightCells: grid.heightCells, cellSizeM: grid.cellSizeM, elevationM: grid.elevationM }, parseDetailParams(detailJson), seed);
    const idx = world.getChildIndex(terrain.tracksLayer) + 1;
    this.renderer = new DetailRenderer(world, idx, terrain.normals, grid.widthM, grid.heightM, parseDetailRenderParams(detailJson));
  }

  /** Korytarze: komórki tras (latem także trasy rowerowe). */
  setLayout(layout: ResortLayout, analysis: ResortAnalysis, summer: boolean): void {
    const cells = new Set<number>();
    const axes: { xM: number; yM: number; distanceM: number; widthM: number }[][] = [];
    const cellsOf: number[][] = [];
    for (const p of layout.pistes) {
      const a = analysis.pistes.get(p.id);
      if (!a) continue;
      for (const k of a.cells) cells.add(k);
      axes.push(a.axis);
      cellsOf.push(a.cells);
    }
    if (summer) {
      for (const t of layout.trails ?? []) {
        if (t.kind !== 'bike') continue;
        for (let i = 1; i < t.points.length; i++) {
          const a = t.points[i - 1];
          const b = t.points[i];
          const n = Math.max(1, Math.ceil(Math.hypot(b.xM - a.xM, b.yM - a.yM) / 4));
          for (let s = 0; s <= n; s++) {
            const c = this.grid.cellAt(a.xM + ((b.xM - a.xM) * s) / n, a.yM + ((b.yM - a.yM) * s) / n);
            if (c) cells.add(this.grid.index(c.i, c.j));
          }
        }
      }
    }
    this.layer.setCorridors(cells, axes);
    this.turn = turnField(this.grid.cellCount, this.grid.widthCells, this.grid.cellSizeM, axes, cellsOf);
  }

  /** Ratrak na mapie: sztruks na TrackBuffer (oddalenie) i w warstwie 1 m. */
  readonly groomStamp = {
    stamp: (ax: number, ay: number, bx: number, by: number, widthM: number, strength: number) => {
      this.terrain.groom.stamp(ax, ay, bx, by, widthM, strength);
      this.layer.groomSegment(ax, ay, bx, by, widthM, this.gameH);
    },
  };

  /** Ślad nart narciarza na ekranie. */
  ski(ax: number, ay: number, bx: number, by: number): void {
    this.layer.skiSegment(ax, ay, bx, by);
  }

  /** Przejazdy całego dnia (z wątku gości) – ślady i muldy. */
  dayPasses(passes: Float32Array): void {
    this.layer.applyPasses(passes, this.rule, this.turn);
  }

  /** Stan śniegu 10 m (po kroku modelu) – uzgodnienie średnich. */
  syncSnow(moguls: Uint8Array | undefined, pileMm: Float32Array | undefined, quality: Uint8Array, thin: Float32Array | null): void {
    const m = new Float32Array(quality.length);
    if (moguls) for (let k = 0; k < m.length; k++) m[k] = moguls[k] / 255;
    this.layer.syncTo10m(m, pileMm ?? new Float32Array(quality.length), quality, thin);
  }

  freshSnow(mm: number): void {
    this.layer.weather(mm);
  }

  /** Noc przewinięta (dzień zamknięty bez oglądania): sztruks z całych zadań ratraków. */
  applyNight(last: OpsSummary | null, analysis: ResortAnalysis, dayIndex: number): void {
    if (!last || last.date === this.nightApplied) return;
    this.nightApplied = last.date;
    for (const j of last.jobs) {
      const a = analysis.pistes.get(j.pisteId);
      if (a) groomWholeJob(this.layer, a.axis, GROOMER_WIDTH_M, dayIndex * 24 + j.startH - 24, dayIndex * 24 + j.endH - 24);
    }
  }

  /** Pracujące armatki – pryzma w miejscu opadu (cel na osi trasy + zniesienie z wiatrem). */
  plumes(key: string, list: { aimXM: number; aimYM: number; rateM3h: number; windFromDeg: number; windMs: number }[], driftPerMs: number): void {
    if (key === this.plumeHour) return;
    this.plumeHour = key;
    for (const pl of list) {
      const az = ((pl.windFromDeg + 180) * Math.PI) / 180;
      this.layer.addPile(pl.aimXM + Math.sin(az) * pl.windMs * driftPerMs, pl.aimYM - Math.cos(az) * pl.windMs * driftPerMs, Math.min(400, pl.rateM3h * 2));
    }
  }

  update(camera: Camera, sunElevationDeg: number, sunAzimuthDeg: number, day: number, tint: number): void {
    const el = (Math.max(-5, sunElevationDeg) * Math.PI) / 180;
    const az = (sunAzimuthDeg * Math.PI) / 180;
    // Kierunek do Słońca na mapie: północ = −y.
    const sun: [number, number, number] = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.max(0.05, Math.sin(el))];
    this.renderer.update(this.layer, camera.centerXM, camera.centerYM, camera.metersPerPixel, this.gameH, sun, day, tint);
    this.terrain.detailFade = this.layer.blockCount > 0 ? this.renderer.fadeFor(camera.metersPerPixel) : 0;
  }
}
