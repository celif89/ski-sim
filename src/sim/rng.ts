/**
 * Generator liczb pseudolosowych z ziarnem (seed) – JEDYNE źródło losowości w grze.
 *
 * Ten sam seed daje zawsze ten sam ciąg liczb, na każdym komputerze i w każdej przeglądarce
 * (obliczenia na liczbach całkowitych 32-bitowych, bez Math.random).
 *
 * Algorytm: SFC32 (Small Fast Counter, Chris Doty-Humphrey, pakiet PractRand),
 * stan początkowy rozpraszany funkcją SplitMix32. Szybki i dobrej jakości statystycznej.
 */

/** Jeden krok SplitMix32 – służy tylko do rozproszenia ziarna na stan generatora. */
function splitMix32(state: number): { value: number; next: number } {
  const next = (state + 0x9e3779b9) | 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z ^= z >>> 16;
  return { value: z >>> 0, next };
}

/** Zamienia tekst na 32-bitowe ziarno (FNV-1a). Pozwala używać seedów w postaci słów. */
export function hashStringToSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    hash ^= text.charCodeAt(k);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const UINT32_TO_UNIT = 1 / 4294967296; // 2^-32

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string) {
    const seed32 = typeof seed === 'string' ? hashStringToSeed(seed) : normalizeSeed(seed);
    let s = seed32 | 0;
    const r1 = splitMix32(s);
    s = r1.next;
    const r2 = splitMix32(s);
    s = r2.next;
    const r3 = splitMix32(s);
    s = r3.next;
    const r4 = splitMix32(s);
    this.a = r1.value | 0;
    this.b = r2.value | 0;
    this.c = r3.value | 0;
    this.d = r4.value | 0;
    // Rozgrzanie generatora – kilka pierwszych wyników SFC32 jest słabiej wymieszanych.
    for (let k = 0; k < 12; k++) this.nextUint32();
  }

  /** Liczba całkowita z zakresu [0, 2^32). */
  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Liczba rzeczywista z zakresu [0, 1). */
  next(): number {
    return this.nextUint32() * UINT32_TO_UNIT;
  }

  /** Liczba rzeczywista z zakresu [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Liczba całkowita z zakresu [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  /** Liczba z rozkładu normalnego (metoda Boxa–Mullera). */
  normal(mean = 0, stdDev = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Tworzy niezależny, ale deterministyczny generator potomny (np. osobny dla terenu, pogody,
   * gości). Dzięki temu dodanie losowania w jednym module nie zmienia wyników w innym.
   */
  fork(label: string): Rng {
    return new Rng((this.nextUint32() ^ hashStringToSeed(label)) >>> 0);
  }
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new Error(`Nieprawidłowy seed: ${seed}`);
  // Seedy większe niż 32 bity są składane, żeby nie tracić ich części.
  const integer = Math.trunc(seed);
  const low = integer % 4294967296;
  const high = Math.floor(integer / 4294967296);
  return (low ^ Math.imul(high, 0x9e3779b1)) >>> 0;
}
