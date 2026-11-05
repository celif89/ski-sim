/** „Okrągłe” podziałki osi wykresu (1, 2, 5 × 10ⁿ). Czysta matematyka – testowana. */

/** Najmniejszy „okrągły” krok, przy którym na osi mieści się nie więcej niż ok. targetCount + 1 kresek. */
export function niceStep(range: number, targetCount: number): number {
  if (!(range > 0) || !(targetCount > 0)) return 1;
  const minStep = range / (targetCount + 1);
  const power = 10 ** Math.floor(Math.log10(minStep));
  for (const m of [1, 2, 5, 10]) if (m * power >= minStep) return m * power;
  return 10 * power;
}

export function niceTicks(min: number, max: number, targetCount: number): number[] {
  const step = niceStep(max - min, targetCount);
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}
