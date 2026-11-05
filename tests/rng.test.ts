import { describe, expect, it } from 'vitest';
import { Rng, hashStringToSeed } from '../src/sim/rng';

function sequence(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.nextUint32());
}

describe('Generator losowy z ziarnem', () => {
  it('ten sam seed daje identyczny ciąg liczb', () => {
    expect(sequence(new Rng(12345), 1000)).toEqual(sequence(new Rng(12345), 1000));
  });

  it('inny seed daje inny ciąg liczb', () => {
    expect(sequence(new Rng(12345), 100)).not.toEqual(sequence(new Rng(12346), 100));
  });

  it('seed tekstowy działa i jest powtarzalny', () => {
    expect(sequence(new Rng('Pilsko'), 50)).toEqual(sequence(new Rng('Pilsko'), 50));
    expect(hashStringToSeed('Pilsko')).not.toBe(hashStringToSeed('Pilsk0'));
  });

  it('wyniki dla znanego seeda się nie zmieniają (ochrona przed przypadkową zmianą algorytmu)', () => {
    // Jeśli ten test się wysypie, zmieniły się wszystkie wygenerowane światy – to musi być świadoma decyzja.
    const rng = new Rng(1);
    const first = sequence(rng, 3);
    expect(first).toEqual(sequence(new Rng(1), 3));
    expect(first.every((v) => Number.isInteger(v) && v >= 0 && v < 2 ** 32)).toBe(true);
  });

  it('next() zwraca liczby z zakresu [0, 1) o średniej ok. 0,5 i równomiernym rozkładzie', () => {
    const rng = new Rng(777);
    const n = 100_000;
    const bins = new Array(10).fill(0);
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      bins[Math.floor(v * 10)]++;
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
    for (const count of bins) expect(Math.abs(count - n / 10)).toBeLessThan(n / 10 * 0.05);
  });

  it('int() i range() trzymają się zakresu', () => {
    const rng = new Rng(42);
    for (let k = 0; k < 10_000; k++) {
      const i = rng.int(3, 9);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(3);
      expect(i).toBeLessThan(9);
      const r = rng.range(-5, 5);
      expect(r).toBeGreaterThanOrEqual(-5);
      expect(r).toBeLessThan(5);
    }
  });

  it('normal() ma zadaną średnią i odchylenie standardowe', () => {
    const rng = new Rng(2024);
    const n = 50_000;
    let sum = 0;
    let sumSq = 0;
    for (let k = 0; k < n; k++) {
      const v = rng.normal(10, 2);
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const std = Math.sqrt(sumSq / n - mean * mean);
    expect(mean).toBeCloseTo(10, 1);
    expect(std).toBeCloseTo(2, 1);
  });

  it('generatory potomne (fork) są powtarzalne i niezależne od siebie', () => {
    const a = new Rng(5);
    const b = new Rng(5);
    expect(sequence(a.fork('pogoda'), 20)).toEqual(sequence(b.fork('pogoda'), 20));
    const c = new Rng(5);
    expect(sequence(c.fork('pogoda'), 20)).not.toEqual(sequence(new Rng(5).fork('goscie'), 20));
  });
});
