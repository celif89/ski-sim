/**
 * Etap 7g: zasady budowy w karierze – działki (obiekt w całości na swoich działkach) i kamienie milowe
 * (zablokowanego typu nie da się postawić). Sprawdzane tylko dla obiektów nowych albo zmienionych
 * (istniejące zostają, nawet jeśli dziś byłyby zablokowane). Starsze zapisy: przyznanie działek pod już
 * zbudowanymi obiektami i kamienia milowego wynikającego z dotychczasowych wyników.
 */
import type { EconomyParams } from './economyParams';
import type { GameState } from './economy';
import { reputationOf } from './economy';
import type { LockKind } from './milestones';
import { ensureProgress, lockReason, reachableMilestone, unlocksOf } from './milestones';
import type { Parcel, ParcelGrid } from './parcels';
import { acquireParcel, missingParcels, missingParcelsMessage, objectParcels, ownedParcels } from './parcels';
import type { ResortAnalysis, ResortLayout } from './resort';
import { summerReputationOf } from './summer';
import { formatIsoDate } from './time';

/** Obiekty nowe albo zmienione (geometria, typ) względem poprzedniego układu. */
export function changedObjectIds(prev: ResortLayout, next: ResortLayout): Set<string> {
  const key = (o: object) => {
    const { closed: _c, name: _n, ...rest } = o as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  const before = new Map<string, string>();
  const all = (l: ResortLayout) => [...l.lifts, ...l.pistes, ...l.bases, ...(l.buildings ?? []), ...(l.pipelines ?? []), ...(l.snowGuns ?? []), ...(l.roads ?? []), ...(l.trails ?? []), ...(l.ditches ?? [])];
  for (const o of all(prev)) before.set(o.id, key(o));
  const out = new Set<string>();
  for (const o of all(next)) if (before.get(o.id) !== key(o)) out.add(o.id);
  return out;
}

/** Powód blokady z kamieni milowych dla nowego / zmienionego obiektu (null – wolno). */
export function milestoneRefusal(prev: ResortLayout, next: ResortLayout, state: GameState, ep: EconomyParams): string | null {
  const mp = ep.milestones;
  if (!mp || state.mode !== 'career') return null;
  const changed = changedObjectIds(prev, next);
  const old = <T extends { id: string }>(list: T[] | undefined, id: string) => (list ?? []).find((x) => x.id === id);
  const check = (kind: LockKind, id: string, what: string) => {
    const r = lockReason(kind, id, state, mp);
    return r ? `${what} – ${r}.` : null;
  };
  for (const l of next.lifts) {
    if (!changed.has(l.id) || old(prev.lifts, l.id)?.typeId === l.typeId) continue;
    const r = check('lift', l.typeId, `Wyciąg „${l.name}”`);
    if (r) return r;
  }
  for (const g of next.snowGuns ?? []) {
    if (!changed.has(g.id) || old(prev.snowGuns, g.id)?.typeId === g.typeId) continue;
    const r = check('gun', g.typeId, 'Armatka');
    if (r) return r;
  }
  for (const b of [...next.bases, ...(next.buildings ?? [])] as { id: string; name: string; typeId?: string }[]) {
    if (!changed.has(b.id) || !b.typeId) continue;
    const was = (old(prev.bases, b.id) ?? old(prev.buildings, b.id)) as { typeId?: string } | undefined;
    if (was && was.typeId === b.typeId) continue;
    const r = check('building', b.typeId, `„${b.name}”`);
    if (r) return r;
  }
  for (const t of next.trails ?? []) {
    if (!changed.has(t.id) || old(prev.trails, t.id)) continue;
    const r = check('trail', t.kind, t.kind === 'bike' ? 'Trasa rowerowa' : t.kind === 'toboggan' ? 'Tor saneczkowy' : 'Ścieżka');
    if (r) return r;
  }
  for (const p of next.pistes) {
    if (!p.lit || old(prev.pistes, p.id)?.lit) continue;
    const r = check('lighting', 'lit', `Oświetlenie trasy ${p.name}`);
    if (r) return r;
  }
  return null;
}

/** Brakujące działki nowych / zmienionych obiektów (pusto – wszystko na swoim, piaskownica). */
export function parcelRefusal(prev: ResortLayout, next: ResortLayout, analysis: ResortAnalysis | null, state: GameState, pg: ParcelGrid | null, cellSizeM: number, widthCells: number): { message: string | null; missing: string[] } {
  if (!pg || state.mode !== 'career') return { message: null, missing: [] };
  const changed = changedObjectIds(prev, next);
  const miss = missingParcels(objectParcels(next, analysis, pg, cellSizeM, widthCells), ownedParcels(state), changed);
  return { message: missingParcelsMessage(miss), missing: [...new Set(miss.flatMap((m) => m.missing))].filter((x) => x !== '?').sort() };
}

/** Pełne sprawdzenie zmiany układu w karierze: działka startowa, kamienie milowe, działki. */
export function buildRefusal(prev: ResortLayout, next: ResortLayout, analysis: ResortAnalysis | null, state: GameState, ep: EconomyParams, pg: ParcelGrid | null, cellSizeM: number, widthCells: number): string | null {
  if (state.mode !== 'career') return null;
  if (state.needsStartParcel && changedObjectIds(prev, next).size) return 'Najpierw wybierz działkę startową (widok danych „Działki”).';
  return milestoneRefusal(prev, next, state, ep) ?? parcelRefusal(prev, next, analysis, state, pg, cellSizeM, widthCells).message;
}

/** Działki, od których można zacząć karierę: przy drodze publicznej. */
export function startParcelChoices(pg: ParcelGrid): Parcel[] {
  return pg.parcels.filter((p) => p.touchesRoad);
}

/** Wybór działki startowej: tylko przy drodze; kupiona (albo dzierżawiona, gdy to las) z kapitału startowego. */
export function chooseStartParcel(state: GameState, parcel: Parcel): string | null {
  if (state.mode !== 'career') return 'W piaskownicy wszystkie działki są Twoje.';
  if (!parcel.touchesRoad) return `Działka ${parcel.id} nie dotyka drogi publicznej – na start wybierz działkę przy drodze.`;
  if (Object.keys(state.land?.owned ?? {}).length) return 'Działka startowa jest już wybrana.';
  const err = acquireParcel(state, parcel, parcel.pricePln === null ? 'lease' : 'buy', 1);
  if (err) return err;
  state.needsStartParcel = false;
  return null;
}

/** Ile działek wolno mieć (kamienie milowe); piaskownica – bez limitu. */
export function parcelLimit(state: GameState, ep: EconomyParams): number {
  return ep.milestones ? unlocksOf(state, ep.milestones).parcels : Infinity;
}

/**
 * Starszy zapis kariery (sprzed etapu 7g): działki pod zbudowanymi obiektami przyznane (bez opłaty,
 * jak kupione), wizyty z historii, kamień milowy z dotychczasowych wyników. Zwraca liczbę przyznanych działek.
 */
export function migrateLegacyCareer(state: GameState, layout: ResortLayout, analysis: ResortAnalysis | null, ep: EconomyParams, pg: ParcelGrid | null, cellSizeM: number, widthCells: number): number {
  if (state.mode !== 'career') return 0;
  let granted = 0;
  if (!state.progress) {
    const visits = state.history.reduce((a, h) => a + h.guests, 0) + state.year.days.reduce((a, d) => a + d.guests, 0);
    const pr = ensureProgress(state);
    pr.visits = visits;
    if (ep.milestones) {
      const rep = Math.max(reputationOf(state, ep), ep.summer ? summerReputationOf(state, ep.summer) : 0);
      pr.milestone = reachableMilestone(visits, rep, state.history.length, ep.milestones);
    }
  }
  if (pg && !state.land) {
    state.land = { owned: {} };
    const ids = new Set<string>();
    for (const o of objectParcels(layout, analysis, pg, cellSizeM, widthCells)) for (const p of o.parcels) if (p !== '?') ids.add(p);
    const today = formatIsoDate(state.date);
    for (const id of ids) {
      const p = pg.parcels.find((x) => x.id === id);
      if (!p) continue;
      state.land.owned[id] = { mode: p.pricePln === null ? 'lease' : 'buy', since: today, pricePln: p.pricePln ?? 0, leasePlnPerYear: p.leasePlnPerYear };
      granted++;
    }
    if (!granted) state.needsStartParcel = true;
  }
  return granted;
}
