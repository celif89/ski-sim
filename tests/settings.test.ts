import { describe, expect, it } from 'vitest';
import { readNumber } from '../src/sim/params';
import { parseSimSettings } from '../src/sim/settings';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { simSettings, terrainParams } from './helpers';

/** Szuka w pliku JSON wszystkich liczb, które nie są opisane jako { value, unit, source }. */
function findUndocumentedNumbers(node: unknown, path: string, out: string[]): void {
  if (typeof node === 'number') {
    out.push(path);
    return;
  }
  // Tablice to zestawienia danych (np. punkty granicy, punkty kontrolne) – ich jednostki opisuje pole obok.
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  if ('value' in record && typeof record.value === 'number') {
    if (typeof record.unit !== 'string' || typeof record.source !== 'string') out.push(path);
    return;
  }
  for (const [key, child] of Object.entries(record)) findUndocumentedNumbers(child, `${path}.${key}`, out);
}

describe('Pliki danych', () => {
  it('data/settings.json zawiera seed i nazwę mapy (domyślnie Pilsko)', () => {
    expect(Number.isInteger(simSettings.seed)).toBe(true);
    expect(simSettings.mapName).toBe('pilsko');
  });

  it('generator proceduralny ma siatkę 400 × 400 komórek po 10 m', () => {
    expect(terrainParams.grid).toEqual({ widthCells: 400, heightCells: 400, cellSizeM: 10 });
  });

  it('każda liczba w plikach danych (data/**/*.json) ma jednostkę i źródło', () => {
    const dataDir = join(__dirname, '..', 'data');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith('.json')) files.push(path);
      }
    };
    walk(dataDir);
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const bad: string[] = [];
      findUndocumentedNumbers(JSON.parse(readFileSync(file, 'utf8')), relative(dataDir, file), bad);
      expect(bad, `liczby bez jednostki/źródła w ${file}`).toEqual([]);
    }
  });

  it('zły format parametru daje czytelny błąd', () => {
    expect(() => readNumber({ a: 5 }, 'a', 'test.json')).toThrow(/format/);
    expect(() => readNumber({ a: { value: 5, unit: 'm' } }, 'a', 'test.json')).toThrow(/źródła/);
    expect(() => readNumber({ a: { value: 5.5, unit: 'm', source: 'x' } }, 'a', 'test.json', { integer: true })).toThrow();
    expect(() => parseSimSettings({})).toThrow(/world/);
  });
});
