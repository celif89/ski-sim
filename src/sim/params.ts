/**
 * Odczyt parametrów z plików data/*.json.
 *
 * Każda liczba w plikach danych ma postać:
 *   { "value": 10, "unit": "m", "source": "skąd ta wartość / do kalibracji" }
 * Funkcje poniżej sprawdzają ten format i zwracają same wartości.
 */

export interface ParamEntry {
  value: number;
  unit: string;
  source: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Zwraca podobiekt pliku danych (np. sekcję „map”). */
export function readSection(raw: unknown, key: string, fileLabel: string): Record<string, unknown> {
  if (!isRecord(raw)) throw new Error(`${fileLabel}: oczekiwano obiektu JSON`);
  const section = raw[key];
  if (!isRecord(section)) throw new Error(`${fileLabel}: brak sekcji „${key}”`);
  return section;
}

/** Odczytuje jedną liczbę w formacie { value, unit, source } i sprawdza jej poprawność. */
export function readNumber(
  section: Record<string, unknown>,
  key: string,
  fileLabel: string,
  options: { integer?: boolean; min?: number; max?: number } = {},
): number {
  const entry = section[key];
  const where = `${fileLabel}: parametr „${key}”`;
  if (!isRecord(entry)) throw new Error(`${where} – brak lub zły format (oczekiwano { value, unit, source })`);
  const { value, unit, source } = entry;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${where} – „value” musi być liczbą`);
  if (typeof unit !== 'string' || unit.length === 0) throw new Error(`${where} – brak jednostki („unit”)`);
  if (typeof source !== 'string' || source.length === 0) throw new Error(`${where} – brak źródła („source”)`);
  if (options.integer && !Number.isInteger(value)) throw new Error(`${where} – musi być liczbą całkowitą`);
  if (options.min !== undefined && value < options.min) throw new Error(`${where} – wartość ${value} < ${options.min}`);
  if (options.max !== undefined && value > options.max) throw new Error(`${where} – wartość ${value} > ${options.max}`);
  return value;
}

/** Odczytuje tablicę liczb w formacie { value: [...], unit, source } (np. 12 wartości miesięcznych). */
export function readNumberArray(
  section: Record<string, unknown>,
  key: string,
  fileLabel: string,
  options: { length?: number; min?: number; max?: number } = {},
): number[] {
  const entry = section[key];
  const where = `${fileLabel}: parametr „${key}”`;
  if (!isRecord(entry)) throw new Error(`${where} – brak lub zły format (oczekiwano { value: [...], unit, source })`);
  const { value, unit, source } = entry;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error(`${where} – „value” musi być tablicą liczb`);
  }
  if (typeof unit !== 'string' || unit.length === 0) throw new Error(`${where} – brak jednostki („unit”)`);
  if (typeof source !== 'string' || source.length === 0) throw new Error(`${where} – brak źródła („source”)`);
  if (options.length !== undefined && value.length !== options.length) throw new Error(`${where} – oczekiwano ${options.length} wartości`);
  for (const v of value as number[]) {
    if (options.min !== undefined && v < options.min) throw new Error(`${where} – wartość ${v} < ${options.min}`);
    if (options.max !== undefined && v > options.max) throw new Error(`${where} – wartość ${v} > ${options.max}`);
  }
  return value as number[];
}
