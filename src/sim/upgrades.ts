/**
 * Etap 7f: „Ulepsz”, „Przesuń” – zmiany gotowych obiektów bez rysowania od nowa.
 *  - wyciąg: inny typ na tej samej linii (stacje i załamania zostają, podpory rozstawione od nowa
 *    dla nowego typu); koszt różnicowy i czas przebudowy liczy ekonomia (zmiana podpisu obiektu:
 *    dopłata różnicy + opłata za przebudowę, rebuildDaysShare czasu budowy);
 *  - armatka: inny typ na tym samym hydrancie;
 *  - trasa: poszerzenie o widenStepM na całej długości (do maxWidthM);
 *  - budynek: przesunięcie i obrót co 90° (obrót tylko w widoku – nie zmienia kosztu).
 */
import type { LiftDesign, LiftParams } from './lifts';
import { bendAngleDeg, hasCable, liftPath, liftTypeById, retowerLift } from './lifts';
import type { PisteDesign, PisteParams } from './pistes';
import type { BuildingDesign, ResortLayout } from './resort';
import type { TerrainGrid } from './terrainGrid';

export interface LiftUpgradeCheck {
  ok: boolean;
  /** Powód, dla którego typ nie pasuje do tej linii (kąt załamania, stacja pośrednia). */
  reason: string | null;
}

/** Czy dany typ wyciągu da się postawić na linii istniejącego (te same załamania i stacje pośrednie). */
export function liftUpgradeCheck(design: LiftDesign, typeId: string, params: LiftParams): LiftUpgradeCheck {
  const t = liftTypeById(params, typeId);
  const path = liftPath(design);
  for (let i = 1; i < path.length - 1; i++) {
    const ang = bendAngleDeg(path[i - 1], path[i], path[i + 1]);
    if (ang > t.maxBendDeg + 1e-6) return { ok: false, reason: `załamanie ${Math.round(ang)}° – ${t.name} dopuszcza ${t.maxBendDeg}°` };
  }
  if ((design.bends ?? []).some((b) => b.mid) && !t.allowsMidStation) return { ok: false, reason: `${t.name} nie może mieć stacji pośredniej` };
  return { ok: true, reason: null };
}

/** Wyciąg innego typu na tej samej linii: podpory rozstawione od nowa, ręczne podpory porzucone. */
export function upgradeLift(grid: TerrainGrid, params: LiftParams, design: LiftDesign, typeId: string): LiftDesign {
  const t = liftTypeById(params, typeId);
  const next: LiftDesign = { ...design, typeId, manualTowers: false, towers: [] };
  // Zjazd wyciągiem i wieszaki tylko tam, gdzie typ na nie pozwala.
  if (!(t.downhillMaxSeatShare > 0)) delete next.downhill;
  if (!hasCable(t)) delete next.bikeRacks;
  next.towers = retowerLift(grid, params, next, null);
  return next;
}

/** Poszerzenie trasy na całej długości (szerokość każdego punktu + krok, najwyżej maxWidthM). */
export function widenPiste(design: PisteDesign, p: PisteParams, stepM = p.widenStepM): PisteDesign {
  const w = (x: number) => Math.min(p.maxWidthM, x + stepM);
  return {
    ...design,
    points: design.points.map((q) => ({ ...q, widthM: w(q.widthM) })),
    ...(design.ctrl ? { ctrl: design.ctrl.map((q) => ({ ...q, widthM: w(q.widthM) })) } : {}),
  };
}

/** Czy trasę da się jeszcze poszerzyć. */
export function canWiden(design: PisteDesign, p: PisteParams): boolean {
  return design.points.some((q) => q.widthM < p.maxWidthM - 1e-6);
}

/** Armatka innego typu na tym samym hydrancie (nowy układ – kopia). */
export function upgradeGun(layout: ResortLayout, gunId: string, typeId: string): ResortLayout {
  return { ...layout, snowGuns: (layout.snowGuns ?? []).map((g) => (g.id === gunId ? { ...g, typeId } : g)) };
}

/** Przesunięcie budynku (i obrót co 90°). */
export function moveBuilding(layout: ResortLayout, id: string, xM: number, yM: number, rotDeg?: number): ResortLayout {
  const mv = <T extends BuildingDesign>(b: T): T => {
    if (b.id !== id) return b;
    const r = rotDeg === undefined ? b.rotDeg : (((Math.round(rotDeg / 90) * 90) % 360) + 360) % 360;
    const out = { ...b, xM, yM } as T;
    if (r) out.rotDeg = r;
    else delete out.rotDeg;
    return out;
  };
  return {
    ...layout,
    buildings: (layout.buildings ?? []).map(mv),
    bases: layout.bases.map((b) => (b.id === id ? { ...b, xM, yM } : b)),
  };
}
