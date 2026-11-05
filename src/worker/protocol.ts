/** Wiadomości wymieniane między widokiem (wątek główny) a symulacją (Web Worker). */
import type { MapSettings, TerrainGeneratorParams } from '../sim';

export interface GenerateTerrainRequest {
  type: 'generateTerrain';
  map: MapSettings;
  params: TerrainGeneratorParams;
  seed: number;
}

export interface TerrainReadyMessage {
  type: 'terrainReady';
  widthCells: number;
  heightCells: number;
  cellSizeM: number;
  /** Bufor z wysokościami [m n.p.m.] (Float32Array), przekazywany bez kopiowania. */
  elevationBuffer: ArrayBuffer;
  generationTimeMs: number;
}

export interface WorkerErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerRequest = GenerateTerrainRequest;
export type WorkerResponse = TerrainReadyMessage | WorkerErrorMessage;
