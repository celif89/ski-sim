/**
 * Klasy nachylenia w kolorach tras narciarskich (progi z data/slope-classes.json).
 */
import { readNumber } from './params';

export interface SlopeClass {
  name: string;
  /** Kolor w zapisie #rrggbb. */
  color: string;
  /** Górna granica klasy [%] (włącznie); Infinity dla ostatniej klasy. */
  maxSlopePercent: number;
}

const FILE = 'data/slope-classes.json';

export function parseSlopeClasses(raw: unknown): SlopeClass[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { classes?: unknown }).classes)) {
    throw new Error(`${FILE}: brak listy „classes”`);
  }
  const list = (raw as { classes: unknown[] }).classes;
  const classes: SlopeClass[] = list.map((entry, n) => {
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== 'string' || typeof e.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(e.color)) {
      throw new Error(`${FILE}: klasa nr ${n + 1} – brak nazwy lub koloru #rrggbb`);
    }
    const last = n === list.length - 1;
    const maxSlopePercent = last ? Infinity : readNumber(e, 'maxSlopePercent', FILE, { min: 0 });
    return { name: e.name, color: e.color, maxSlopePercent };
  });
  for (let n = 1; n < classes.length; n++) {
    if (!(classes[n].maxSlopePercent > classes[n - 1].maxSlopePercent)) {
      throw new Error(`${FILE}: progi nachylenia muszą rosnąć`);
    }
  }
  if (classes.length === 0) throw new Error(`${FILE}: pusta lista klas`);
  return classes;
}

/** Numer klasy dla nachylenia [%] (wartość bezwzględna); −1 dla NaN. */
export function classifySlope(slopePercent: number, classes: SlopeClass[]): number {
  if (Number.isNaN(slopePercent)) return -1;
  const s = Math.abs(slopePercent);
  for (let n = 0; n < classes.length; n++) if (s <= classes[n].maxSlopePercent) return n;
  return classes.length - 1;
}
