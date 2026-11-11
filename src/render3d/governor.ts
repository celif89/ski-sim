/**
 * Etap 3D-1: automatyczna płynność. Co okno pomiaru (np. 2 s): za mało klatek – najpierw mniejsza
 * rozdzielczość obrazu, potem bliższy zasięg drzew 3D; zapas (prawie cel) – powrót krok po kroku
 * do ustawień wybranej jakości (nigdy powyżej). Czysta funkcja – testowana bez karty graficznej.
 */
export interface GovernorParams {
  targetFps: number;
  lowFps: number;
  minResolutionScale: number;
  minTreeScale: number;
  step: number;
}

export interface GovernorState {
  resolutionScale: number;
  treeScale: number;
}

export function governStep(st: GovernorState, fps: number, p: GovernorParams): GovernorState {
  const r = { ...st };
  if (fps < p.lowFps) {
    if (r.resolutionScale > p.minResolutionScale + 1e-9) r.resolutionScale = Math.max(p.minResolutionScale, r.resolutionScale - p.step);
    else r.treeScale = Math.max(p.minTreeScale, r.treeScale - p.step);
  } else if (fps >= p.targetFps * 0.95) {
    if (r.treeScale < 1 - 1e-9) r.treeScale = Math.min(1, r.treeScale + p.step);
    else r.resolutionScale = Math.min(1, r.resolutionScale + p.step);
  }
  // Zaokrąglenie (sumowanie kroków 0,1 daje 0,9999…).
  r.resolutionScale = Math.round(r.resolutionScale * 1000) / 1000;
  r.treeScale = Math.round(r.treeScale * 1000) / 1000;
  return r;
}
