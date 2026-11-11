/**
 * Etap 3D-0: kamera jak w Cities: Skylines – cel na terenie, odległość, obrót (wokół pionu) i pochylenie
 * (od widoku z góry do niemal poziomego); kamera nie wchodzi pod teren. Czyste funkcje (bez WebGL).
 * Układ jak teren 3D: x = wschód, z = południe, y = wysokość. Obrót 0 – kamera na północy celu,
 * patrzy na południe (jak domyślny widok 2D od Korbielowa).
 */

export interface RigState {
  /** Cel kamery (punkt na terenie) [m]. */
  tx: number;
  ty: number;
  tz: number;
  distanceM: number;
  yawRad: number;
  /** Pochylenie: kąt nad poziomem [rad] (π/2 – z góry). */
  pitchRad: number;
}

export interface RigLimits {
  minDistanceM: number;
  maxDistanceM: number;
  minPitchDeg: number;
  maxPitchDeg: number;
  minClearanceM: number;
}

/** Położenie kamery z celu, odległości, obrotu i pochylenia. */
export function cameraPosition(s: RigState): { x: number; y: number; z: number } {
  const h = Math.cos(s.pitchRad) * s.distanceM;
  return { x: s.tx - Math.sin(s.yawRad) * h, y: s.ty + Math.sin(s.pitchRad) * s.distanceM, z: s.tz - Math.cos(s.yawRad) * h };
}

/** Kierunki „do przodu” i „w prawo” na płaszczyźnie (WASD). */
export function groundAxes(yawRad: number): { fx: number; fz: number; rx: number; rz: number } {
  return { fx: Math.sin(yawRad), fz: Math.cos(yawRad), rx: -Math.cos(yawRad), rz: Math.sin(yawRad) };
}

export function clampRig(s: RigState, lim: RigLimits): RigState {
  const d2r = Math.PI / 180;
  return {
    ...s,
    distanceM: Math.max(lim.minDistanceM, Math.min(lim.maxDistanceM, s.distanceM)),
    pitchRad: Math.max(lim.minPitchDeg * d2r, Math.min(lim.maxPitchDeg * d2r, s.pitchRad)),
  };
}

/**
 * Kamera nie schodzi pod teren: gdy położenie z celu i kąta jest za nisko, pochylenie rośnie tak, by
 * kamera była co najmniej minClearanceM nad terenem (sprawdzane w punkcie kamery i w połowie drogi do celu).
 * `groundAt` – wysokość terenu w punkcie (NaN – poza terenem: bez ograniczenia).
 */
export function keepAboveTerrain(s: RigState, lim: RigLimits, groundAt: (x: number, z: number) => number): RigState {
  let st = clampRig(s, lim);
  const ok = (r: RigState) => {
    const p = cameraPosition(r);
    const g = groundAt(p.x, p.z);
    const mx = (p.x + r.tx) / 2;
    const mz = (p.z + r.tz) / 2;
    const gm = groundAt(mx, mz);
    const midY = (p.y + r.ty) / 2;
    return (!Number.isFinite(g) || p.y >= g + lim.minClearanceM) && (!Number.isFinite(gm) || midY >= gm + lim.minClearanceM * 0.5);
  };
  const maxP = (lim.maxPitchDeg * Math.PI) / 180;
  for (let k = 0; k < 60 && !ok(st) && st.pitchRad < maxP; k++) st = { ...st, pitchRad: Math.min(maxP, st.pitchRad + 0.02) };
  // W ostateczności (z góry, a teren i tak wyżej) – cel podniesiony.
  if (!ok(st)) {
    const p = cameraPosition(st);
    const g = groundAt(p.x, p.z);
    if (Number.isFinite(g)) st = { ...st, ty: st.ty + (g + lim.minClearanceM - p.y) };
  }
  return st;
}

/** Zbliżenie kółkiem do kursora: nowa odległość i cel przesunięty w stronę punktu pod kursorem. */
export function zoomToward(s: RigState, factor: number, px: number, py: number, pz: number, lim: RigLimits): RigState {
  const d = Math.max(lim.minDistanceM, Math.min(lim.maxDistanceM, s.distanceM * factor));
  const k = 1 - d / s.distanceM; // ułamek drogi celu w stronę punktu
  return { ...s, distanceM: d, tx: s.tx + (px - s.tx) * k, ty: s.ty + (py - s.ty) * k, tz: s.tz + (pz - s.tz) * k };
}

/** Klawisze kamery 3D (pozostałe idą do gry – narzędzia, nakładki, czas). */
export const CAMERA_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyQ', 'KeyE', 'KeyR', 'KeyF']);
