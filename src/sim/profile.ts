/**
 * Profil (przekrój) terenu wzdłuż odcinka A–B.
 *
 * Wysokości próbkowane co krok ≤ rozmiar komórki (interpolacja dwuliniowa). Dla każdego odcinka
 * między kolejnymi próbkami: nachylenie [%] = 100 · Δh / Δl (dodatnie = pod górę w kierunku A → B).
 */
import type { TerrainGrid } from './terrainGrid';

export interface ProfilePoint {
  /** Odległość pozioma od punktu A [m]. */
  distanceM: number;
  xM: number;
  yM: number;
  /** Wysokość terenu [m n.p.m.]; NaN poza mapą. */
  elevationM: number;
}

export interface ProfileSegment {
  fromDistanceM: number;
  toDistanceM: number;
  /** Nachylenie odcinka [%], dodatnie pod górę (A → B); NaN, gdy odcinek wychodzi poza mapę. */
  slopePercent: number;
}

export interface TerrainProfile {
  points: ProfilePoint[];
  segments: ProfileSegment[];
  /** Odległość pozioma A–B [m]. */
  horizontalDistanceM: number;
  /** Długość po terenie (suma długości odcinków w przestrzeni) [m]. */
  surfaceDistanceM: number;
  /** Różnica wysokości B − A [m]. */
  elevationDifferenceM: number;
  minElevationM: number;
  maxElevationM: number;
  /** Największe nachylenie odcinka (co do wartości bezwzględnej) [%]. */
  maxSlopePercent: number;
  /** Suma podejść i zejść [m]. */
  totalAscentM: number;
  totalDescentM: number;
}

export function computeProfile(
  grid: TerrainGrid,
  a: { xM: number; yM: number },
  b: { xM: number; yM: number },
  maxStepM: number = grid.cellSizeM,
): TerrainProfile {
  const horizontalDistanceM = Math.hypot(b.xM - a.xM, b.yM - a.yM);
  const steps = Math.max(1, Math.ceil(horizontalDistanceM / maxStepM));
  const points: ProfilePoint[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const xM = a.xM + t * (b.xM - a.xM);
    const yM = a.yM + t * (b.yM - a.yM);
    points.push({ distanceM: t * horizontalDistanceM, xM, yM, elevationM: grid.sampleElevationM(xM, yM) });
  }
  const segments: ProfileSegment[] = [];
  let surfaceDistanceM = 0;
  let maxSlopePercent = 0;
  let totalAscentM = 0;
  let totalDescentM = 0;
  let minElevationM = Infinity;
  let maxElevationM = -Infinity;
  for (const p of points) {
    if (p.elevationM < minElevationM) minElevationM = p.elevationM;
    if (p.elevationM > maxElevationM) maxElevationM = p.elevationM;
  }
  for (let s = 0; s < steps; s++) {
    const p0 = points[s];
    const p1 = points[s + 1];
    const dl = p1.distanceM - p0.distanceM;
    const dh = p1.elevationM - p0.elevationM;
    const slopePercent = dl > 0 ? (100 * dh) / dl : 0;
    segments.push({ fromDistanceM: p0.distanceM, toDistanceM: p1.distanceM, slopePercent });
    if (Number.isNaN(dh)) continue;
    surfaceDistanceM += Math.hypot(dl, dh);
    if (Math.abs(slopePercent) > maxSlopePercent) maxSlopePercent = Math.abs(slopePercent);
    if (dh > 0) totalAscentM += dh;
    else totalDescentM -= dh;
  }
  return {
    points,
    segments,
    horizontalDistanceM,
    surfaceDistanceM,
    elevationDifferenceM: points[points.length - 1].elevationM - points[0].elevationM,
    minElevationM,
    maxElevationM,
    maxSlopePercent,
    totalAscentM,
    totalDescentM,
  };
}
