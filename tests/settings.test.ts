import { describe, expect, it } from 'vitest';
import { readNumber } from '../src/sim/params';
import { parseSimSettings } from '../src/sim/settings';
import { settingsJson, simSettings, terrainJson } from './helpers';

/** Szuka w pliku JSON wszystkich liczb, które nie są opisane jako { value, unit, source }. */
function findUndocumentedNumbers(node: unknown, path: string, out: string[]): void {
  if (typeof node === 'number') {
    out.push(path);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  if ('value' in record && typeof record.value === 'number') {
    if (typeof record.unit !== 'string' || typeof record.source !== 'string') out.push(path);
    return;
  }
  for (const [key, child] of Object.entries(record)) findUndocumentedNumbers(child, `${path}.${key}`, out);
}

describe('Pliki danych', () => {
  it('data/settings.json zawiera seed i wymiary mapy (start 400 × 400 komórek po 10 m)', () => {
    expect(Number.isInteger(simSettings.seed)).toBe(true);
    expect(simSettings.map).toEqual({ widthCells: 400, heightCells: 400, cellSizeM: 10 });
  });

  it('każda liczba w plikach danych ma jednostkę i źródło', () => {
    for (const [name, json] of [
      ['settings.json', settingsJson],
      ['terrain-generator.json', terrainJson],
    ] as const) {
      const bad: string[] = [];
      findUndocumentedNumbers(json, name, bad);
      expect(bad, `liczby bez jednostki/źródła w ${name}`).toEqual([]);
    }
  });

  it('zły format parametru daje czytelny błąd', () => {
    expect(() => readNumber({ a: 5 }, 'a', 'test.json')).toThrow(/format/);
    expect(() => readNumber({ a: { value: 5, unit: 'm' } }, 'a', 'test.json')).toThrow(/źródła/);
    expect(() => readNumber({ a: { value: 5.5, unit: 'm', source: 'x' } }, 'a', 'test.json', { integer: true })).toThrow();
    expect(() => parseSimSettings({})).toThrow(/world/);
  });
});
