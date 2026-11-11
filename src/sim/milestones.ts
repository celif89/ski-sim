/**
 * Etap 7g: kamienie milowe (wzór: Cities: Skylines). Kamień osiąga się, gdy jednocześnie łączna liczba
 * wizyt gości (zima i lato), reputacja (lepsza z zimowej i letniej) i liczba rozegranych sezonów
 * osiągną progi. Każdy odblokowuje typy wyciągów, armatek, budynków, atrakcje letnie, oświetlenie tras,
 * kolejne działki do kupienia i wyższy limit kredytu (wszystko w data/milestones.json). W piaskownicy
 * wszystko jest odblokowane.
 */
import type { GameState } from './economy';
import { readNumber } from './params';

const FILE = 'data/milestones.json';

export type TrailUnlock = 'bike' | 'walk' | 'toboggan';

export interface Milestone {
  id: string;
  name: string;
  visits: number;
  reputation: number;
  seasons: number;
  lifts: string[];
  guns: string[];
  buildings: string[];
  trails: TrailUnlock[];
  lighting: boolean;
  /** Ile działek więcej wolno mieć (narastająco z poprzednimi kamieniami). */
  parcels: number;
  loanLimitPln: number;
}

export interface MilestoneParams {
  milestones: Milestone[];
  lighting: { costPlnPerM: number; powerWPerM: number; maxCloseLitH: number; darkFromH: number[] };
}

export function parseMilestoneParams(raw: unknown): MilestoneParams {
  const r = raw as { milestones?: Record<string, unknown>[]; lighting?: Record<string, unknown> };
  if (!Array.isArray(r.milestones) || !r.milestones.length) throw new Error(`${FILE}: brak listy milestones`);
  const strs = (v: unknown, what: string): string[] => {
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`${FILE}: ${what} – lista nazw`);
    return v as string[];
  };
  const milestones = r.milestones.map((m, i) => ({
    id: String(m.id),
    name: String(m.name),
    visits: readNumber(m, 'visits', FILE, { min: 0 }),
    reputation: readNumber(m, 'reputation', FILE, { min: 0, max: 5 }),
    seasons: readNumber(m, 'seasons', FILE, { min: 0, integer: true }),
    lifts: strs(m.lifts, `milestones[${i}].lifts`),
    guns: strs(m.guns, `milestones[${i}].guns`),
    buildings: strs(m.buildings, `milestones[${i}].buildings`),
    trails: strs(m.trails, `milestones[${i}].trails`) as TrailUnlock[],
    lighting: m.lighting === true,
    parcels: readNumber(m, 'parcels', FILE, { min: 0, integer: true }),
    loanLimitPln: readNumber(m, 'loanLimitPln', FILE, { min: 0 }),
  }));
  const li = r.lighting;
  if (!li) throw new Error(`${FILE}: brak sekcji lighting`);
  const dark = (li.darkFromH as { value?: unknown } | undefined)?.value;
  if (!Array.isArray(dark) || dark.length !== 12) throw new Error(`${FILE}: lighting.darkFromH – 12 liczb`);
  return {
    milestones,
    lighting: {
      costPlnPerM: readNumber(li, 'costPlnPerM', FILE, { min: 0 }),
      powerWPerM: readNumber(li, 'powerWPerM', FILE, { min: 0 }),
      maxCloseLitH: readNumber(li, 'maxCloseLitH', FILE, { min: 0, max: 24 }),
      darkFromH: dark as number[],
    },
  };
}

/** Stan postępu w karierze (w starszych zapisach brak – uzupełnia `ensureProgress`). */
export interface ProgressState {
  /** Łączna liczba wizyt gości (zima i lato) od początku kariery. */
  visits: number;
  /** Indeks osiągniętego kamienia milowego (0 – start). */
  milestone: number;
}

export function ensureProgress(state: GameState): ProgressState {
  return (state.progress ??= { visits: 0, milestone: 0 });
}

export const seasonsPlayed = (state: GameState) => state.history.length;

/** Najwyższy kamień, którego progi są spełnione (sprawdzane po kolei – nie da się przeskoczyć). */
export function reachableMilestone(visits: number, reputation: number, seasons: number, mp: MilestoneParams): number {
  let k = 0;
  for (let i = 1; i < mp.milestones.length; i++) {
    const m = mp.milestones[i];
    if (visits >= m.visits && reputation >= m.reputation && seasons >= m.seasons) k = i;
    else break;
  }
  return k;
}

/** Sprawdzenie po zamknięciu dnia: zwraca nowo osiągnięte kamienie (zwykle 0 albo 1). */
export function checkMilestones(state: GameState, reputation: number, mp: MilestoneParams): Milestone[] {
  if (state.mode !== 'career') return [];
  const pr = ensureProgress(state);
  const k = reachableMilestone(pr.visits, reputation, seasonsPlayed(state), mp);
  if (k <= pr.milestone) return [];
  const out = mp.milestones.slice(pr.milestone + 1, k + 1);
  pr.milestone = k;
  return out;
}

export interface Unlocks {
  all: boolean;
  lifts: Set<string>;
  guns: Set<string>;
  buildings: Set<string>;
  trails: Set<TrailUnlock>;
  lighting: boolean;
  /** Ile działek wolno mieć łącznie (z działką startową). */
  parcels: number;
  loanLimitPln: number;
}

export function unlocksOf(state: GameState | null, mp: MilestoneParams): Unlocks {
  const all = !state || state.mode !== 'career';
  const k = all ? mp.milestones.length - 1 : (state!.progress?.milestone ?? 0);
  const u: Unlocks = { all, lifts: new Set(), guns: new Set(), buildings: new Set(), trails: new Set(), lighting: false, parcels: 1, loanLimitPln: 0 };
  for (let i = 0; i <= k; i++) {
    const m = mp.milestones[i];
    m.lifts.forEach((x) => u.lifts.add(x));
    m.guns.forEach((x) => u.guns.add(x));
    m.buildings.forEach((x) => u.buildings.add(x));
    m.trails.forEach((x) => u.trails.add(x));
    u.lighting ||= m.lighting;
    u.parcels += m.parcels;
    u.loanLimitPln = Math.max(u.loanLimitPln, m.loanLimitPln);
  }
  if (all) u.parcels = Infinity;
  return u;
}

export type LockKind = 'lift' | 'gun' | 'building' | 'trail' | 'lighting';

/** Pierwszy kamień, który odblokowuje rzecz (null – żaden: zawsze dostępna). */
export function milestoneFor(kind: LockKind, id: string, mp: MilestoneParams): Milestone | null {
  for (const m of mp.milestones) {
    const has = kind === 'lift' ? m.lifts.includes(id) : kind === 'gun' ? m.guns.includes(id) : kind === 'building' ? m.buildings.includes(id) : kind === 'trail' ? m.trails.includes(id as TrailUnlock) : m.lighting;
    if (has) return m;
  }
  return null;
}

/** Opis progów kamienia: „Ośrodek regionalny – 20 tys. wizyt, reputacja 3,8, 2 sezony”. */
export function milestoneLabel(m: Milestone): string {
  const parts: string[] = [];
  if (m.visits > 0) parts.push(m.visits >= 1000 ? `${(m.visits / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} tys. wizyt` : `${m.visits} wizyt`);
  if (m.reputation > 0) parts.push(`reputacja ${m.reputation.toLocaleString('pl-PL')}`);
  if (m.seasons > 0) parts.push(`${m.seasons} ${m.seasons === 1 ? 'sezon' : m.seasons < 5 ? 'sezony' : 'sezonów'}`);
  return `${m.name}${parts.length ? ` – ${parts.join(', ')}` : ''}`;
}

/** Powód blokady („wymaga: …”) albo null, gdy dostępne. Rzeczy spoza listy kamieni – zawsze dostępne. */
export function lockReason(kind: LockKind, id: string, state: GameState | null, mp: MilestoneParams): string | null {
  if (!state || state.mode !== 'career') return null;
  const m = milestoneFor(kind, id, mp);
  if (!m) return null;
  const k = mp.milestones.indexOf(m);
  if (k <= (state.progress?.milestone ?? 0)) return null;
  return `wymaga: ${milestoneLabel(m)}`;
}

export interface MilestoneProgress {
  current: Milestone;
  next: Milestone | null;
  /** Części progu następnego kamienia: wartość, próg, udział 0–1. */
  parts: { label: string; value: number; target: number; share: number; text: string }[];
  /** Najmniejszy udział (pasek postępu). */
  share: number;
}

export function milestoneProgress(state: GameState, reputation: number, mp: MilestoneParams): MilestoneProgress {
  const k = state.mode === 'career' ? (state.progress?.milestone ?? 0) : mp.milestones.length - 1;
  const current = mp.milestones[k];
  const next = mp.milestones[k + 1] ?? null;
  if (!next) return { current, next: null, parts: [], share: 1 };
  const visits = state.progress?.visits ?? 0;
  const seasons = seasonsPlayed(state);
  const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
  const parts = [
    { label: 'wizyty', value: visits, target: next.visits, text: `${f0(visits)} / ${f0(next.visits)}` },
    { label: 'reputacja', value: reputation, target: next.reputation, text: `${reputation.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} / ${next.reputation.toLocaleString('pl-PL')}` },
    { label: 'sezony', value: seasons, target: next.seasons, text: `${seasons} / ${next.seasons}` },
  ]
    .filter((p) => p.target > 0)
    .map((p) => ({ ...p, share: Math.max(0, Math.min(1, p.value / p.target)) }));
  return { current, next, parts, share: parts.length ? Math.min(...parts.map((p) => p.share)) : 1 };
}

/** Co odblokowuje kamień – zdania do okna i powiadomienia. */
export function unlockSummary(m: Milestone, names: { lift(id: string): string; gun(id: string): string; building(id: string): string }): string[] {
  const out: string[] = [];
  const trailNames: Record<TrailUnlock, string> = { bike: 'trasy rowerowe (bike park)', walk: 'ścieżki spacerowe', toboggan: 'tor saneczkowy' };
  if (m.lifts.length) out.push(`wyciągi: ${m.lifts.map(names.lift).join(', ')}`);
  if (m.guns.length) out.push(`naśnieżanie: ${m.guns.map(names.gun).join(', ')}`);
  if (m.buildings.length) out.push(`budynki: ${m.buildings.map(names.building).join(', ')}`);
  if (m.trails.length) out.push(`lato: ${m.trails.map((t) => trailNames[t]).join(', ')}`);
  if (m.lighting) out.push('oświetlenie tras (jazda wieczorna)');
  if (m.parcels > 0) out.push(m.parcels >= 50 ? 'działki bez limitu' : `+${m.parcels} ${m.parcels === 1 ? 'działka' : m.parcels < 5 ? 'działki' : 'działek'} do kupienia`);
  out.push(`limit kredytu ${(m.loanLimitPln / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} mln zł`);
  return out;
}
