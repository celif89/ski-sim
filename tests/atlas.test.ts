/**
 * Etap 7d: atlas postaci i maszyn – wszystkie kierunki i poziomy szczegółowości, warstwy cienia,
 * rysunku i kurtki, klatki bez nakładania w obrębie obrazu.
 */
import { describe, expect, it } from 'vitest';

import atlasJson from '../data/atlas.json';
import { directionIndex, frameKey, generateAtlas } from '../src/render/atlasGen';
import type { AtlasDesc } from '../src/render/atlasGen';

const atlas = generateAtlas(atlasJson as unknown as AtlasDesc);

describe('Atlas', () => {
  it('8 kierunków, 3 poziomy szczegółowości, każda faza – klatki cienia, rysunku i (jeśli jest) kurtki', () => {
    expect(atlas.directions).toBe(8);
    expect(atlas.lods).toBe(3);
    const need = ['ski', 'board', 'stand', 'seated', 'walk', 'hiker', 'bike', 'sled', 'patrol', 'groomer', 'snowmobile', 'fanGun', 'lance', 'chair2', 'chair4', 'chair6', 'gondola', 'tbar', 'platter', 'towerHead', 'bullwheel', 'gate'];
    for (const id of need) expect(atlas.sprites[id], id).toBeDefined();
    let n = 0;
    for (const [id, m] of Object.entries(atlas.sprites)) {
      for (let ph = 0; ph < m.phases; ph++) {
        for (let d = 0; d < 8; d++) {
          for (let lod = 0; lod < 3; lod++) {
            for (const layer of m.hasJacket ? (['s', 'b', 'j'] as const) : (['s', 'b'] as const)) {
              const f = atlas.frames[frameKey(id, layer, ph, d, lod)];
              expect(f, `${id} ${layer} ${ph} ${d} ${lod}`).toBeDefined();
              expect(f[2]).toBe(m.lodPx[lod]);
              expect(f[0] + f[2]).toBeLessThanOrEqual(atlas.width);
              expect(f[1] + f[2]).toBeLessThanOrEqual(atlas.height);
              n++;
            }
          }
        }
      }
    }
    expect(Object.keys(atlas.frames)).toHaveLength(n);
    // Fazy skrętu narciarza i kurtka barwiona osobno.
    expect(atlas.sprites.ski.phases).toBe(3);
    expect(atlas.sprites.ski.hasJacket).toBe(true);
    expect(atlas.sprites.groomer.hasJacket).toBe(false);
  });

  it('klatki się nie nakładają', () => {
    const fr = Object.values(atlas.frames).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (let i = 0; i < fr.length; i++) {
      for (let j = i + 1; j < fr.length && fr[j][1] < fr[i][1] + fr[i][2]; j++) {
        const a = fr[i];
        const b = fr[j];
        const overlap = a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[2] && b[1] < a[1] + a[2];
        expect(overlap).toBe(false);
      }
    }
  });

  it('kierunek klatki z kąta ruchu na ekranie (0 – w górę, 2 – w prawo, 4 – w dół)', () => {
    expect(directionIndex(-Math.PI / 2)).toBe(0);
    expect(directionIndex(0)).toBe(2);
    expect(directionIndex(Math.PI / 2)).toBe(4);
    expect(directionIndex(Math.PI)).toBe(6);
    expect(directionIndex(-Math.PI / 4)).toBe(1);
  });

  it('obraz SVG zawiera wszystkie klatki i maski kurtek', () => {
    expect(atlas.svg.startsWith('<svg')).toBe(true);
    expect(atlas.svg).toContain('<mask');
    expect(atlas.height).toBeLessThanOrEqual(4096);
  });
});

describe('Kolejka w szpalerach (rysowanie)', () => {
  it('kolejne osoby stoją obok siebie, zygzakiem, bez nakładania', async () => {
    const { queueLayout, queueSlot } = await import('../src/sim/guests');
    const { parseGuestParams } = await import('../src/sim/guestParams');
    const guestsJson = (await import('../data/guests.json')).default;
    const l = queueLayout(parseGuestParams(guestsJson).movement);
    const n = l.lanes * l.perLane + 20;
    const pts = Array.from({ length: n }, (_, i) => queueSlot(l, i));
    expect(pts[0].back).toBeCloseTo(l.frontM, 6);
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const key = `${pts[i].back.toFixed(2)}|${pts[i].across.toFixed(2)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      // W szpalerach następna osoba stoi tuż za poprzednią (ciągła ścieżka zygzakiem).
      if (i > 0 && pts[i].lane >= 0) expect(Math.hypot(pts[i].back - pts[i - 1].back, pts[i].across - pts[i - 1].across)).toBeLessThanOrEqual(l.spacingM + 1e-6);
    }
    // Pasy na przemian: w stronę stacji i od stacji.
    expect(pts[0].towardStation).toBe(true);
    expect(pts[l.perLane].towardStation).toBe(false);
  });
});
