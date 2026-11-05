/**
 * Warstwa terenu: wysokości w skali szarości (nisko ciemno, wysoko jasno).
 * Tymczasowe – w etapie 1 zastąpi ją cieniowanie rzeźby i warstwice.
 */
import { Sprite, Texture } from 'pixi.js';
import type { TerrainGrid } from '../sim';

/** Jasność najniższego i najwyższego punktu (0 = czarny, 255 = biały). Pozostawiamy margines. */
const DARKEST_GRAY = 30;
const BRIGHTEST_GRAY = 240;

export function createTerrainSprite(grid: TerrainGrid): Sprite {
  const { minM, maxM } = grid.elevationRangeM();
  const reliefM = maxM - minM || 1;
  const canvas = document.createElement('canvas');
  canvas.width = grid.widthCells;
  canvas.height = grid.heightCells;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Przeglądarka nie udostępnia rysowania na płótnie 2D');
  const image = ctx.createImageData(grid.widthCells, grid.heightCells);
  const pixels = image.data;
  for (let k = 0; k < grid.cellCount; k++) {
    const t = (grid.elevationM[k] - minM) / reliefM;
    const gray = Math.round(DARKEST_GRAY + t * (BRIGHTEST_GRAY - DARKEST_GRAY));
    pixels[4 * k] = gray;
    pixels[4 * k + 1] = gray;
    pixels[4 * k + 2] = gray;
    pixels[4 * k + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'linear';
  const sprite = new Sprite(texture);
  // Sprite w jednostkach świata: 1 jednostka = 1 metr.
  sprite.width = grid.widthM;
  sprite.height = grid.heightM;
  return sprite;
}
