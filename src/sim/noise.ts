/**
 * Szum gradientowy 2D (szum Perlina) z permutacją losowaną generatorem z ziarnem.
 * Daje gładkie, „naturalnie” wyglądające nierówności. Wartości w przybliżeniu w zakresie [-1, 1].
 */
import type { Rng } from './rng';

const PERIOD = 256;

export class GradientNoise2D {
  private readonly perm: Uint8Array;
  private readonly gradX: Float32Array;
  private readonly gradY: Float32Array;

  constructor(rng: Rng) {
    this.perm = new Uint8Array(PERIOD * 2);
    this.gradX = new Float32Array(PERIOD);
    this.gradY = new Float32Array(PERIOD);
    const p = new Uint8Array(PERIOD);
    for (let k = 0; k < PERIOD; k++) p[k] = k;
    // Tasowanie Fishera–Yatesa
    for (let k = PERIOD - 1; k > 0; k--) {
      const m = rng.int(0, k + 1);
      const tmp = p[k];
      p[k] = p[m];
      p[m] = tmp;
    }
    for (let k = 0; k < PERIOD * 2; k++) this.perm[k] = p[k % PERIOD];
    for (let k = 0; k < PERIOD; k++) {
      const angle = rng.range(0, 2 * Math.PI);
      this.gradX[k] = Math.cos(angle);
      this.gradY[k] = Math.sin(angle);
    }
  }

  /** Wartość szumu w punkcie (x, y) wyrażonym w „długościach fali”. */
  sample(x: number, y: number): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const xi = xf & (PERIOD - 1);
    const yi = yf & (PERIOD - 1);
    const dx = x - xf;
    const dy = y - yf;
    const u = fade(dx);
    const v = fade(dy);
    const n00 = this.dot(xi, yi, dx, dy);
    const n10 = this.dot(xi + 1, yi, dx - 1, dy);
    const n01 = this.dot(xi, yi + 1, dx, dy - 1);
    const n11 = this.dot(xi + 1, yi + 1, dx - 1, dy - 1);
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    // Mnożnik √2 sprowadza wynik w przybliżeniu do zakresu [-1, 1].
    return (nx0 + (nx1 - nx0) * v) * Math.SQRT2;
  }

  /**
   * Szum wielowarstwowy (fBm): suma warstw o coraz krótszej fali i mniejszej amplitudzie.
   * Wynik znormalizowany do przybliżonego zakresu [-1, 1].
   */
  fractal(x: number, y: number, octaves: number, persistence: number, lacunarity: number): number {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      // Przesunięcie każdej warstwy (dowolne niecałkowite liczby) – żeby warstwy nie miały
      // wspólnego punktu zerowego w (0, 0). To szczegół techniczny szumu, nie parametr terenu.
      sum += amplitude * this.sample(x * frequency + o * 17.13, y * frequency - o * 11.71);
      norm += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return sum / norm;
  }

  private dot(ix: number, iy: number, dx: number, dy: number): number {
    const g = this.perm[(ix & (PERIOD - 1)) + this.perm[iy & (PERIOD - 1)]];
    return this.gradX[g] * dx + this.gradY[g] * dy;
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
