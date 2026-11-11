/**
 * Karty obiektów (etap 7b): dane do karty każdego obiektu na mapie – nazwa, status (budowa / czynny /
 * zamknięty / przegląd / awaria), najważniejsze liczby teraz, wykres dzisiejszego dnia (co 15 min)
 * i akcje. Liczone tutaj (symulacja), karta w widoku tylko wyświetla.
 *
 * Dzień letni z symulacją gości – statystyki SummerDay (parkingi, restauracje, kolejki). Pozostałe
 * dni – profil dnia z modelu: obecność gości w czasie z rozkładu przyjazdów i pobytu (te same parametry
 * co u gości), samochody na parkingach wypełniane po kolei do pojemności (jak w zamknięciu dnia).
 */
import { isFoodType } from './economyParams';
import type { EconomyParams } from './economyParams';
import type { GameState, OpsSummary, ResortFacts } from './economy';
import type { GuestParams } from './guestParams';
import { INSPECTION_STATUS_NAMES, inspectionStatus } from './inspections';
import type { LiftParams } from './lifts';
import { liftTypeById } from './lifts';
import type { Infra } from './operations';
import type { ResortAnalysis, ResortLayout } from './resort';
import type { SummerFacts, SummerPlan } from './summer';
import { BIKE_CLASS_NAMES, TRAIL_KIND_NAMES, stormAt } from './summer';
import type { SummerStats } from './summerGuests';
import { SLOTS, SLOT_S } from './summerGuests';
import { formatIsoDate } from './time';
import { liftUpgradeCheck } from './upgrades';
import { lockReason } from './milestones';

export type CardKind = 'lift' | 'piste' | 'base' | 'pipeline' | 'gun' | 'road' | 'trail' | 'ditch';
export type CardStatus = 'budowa' | 'czynny' | 'zamknięty' | 'przegląd' | 'awaria' | 'nieczynny';

export interface CardAction {
  id: 'toggleOpen' | 'toggleSummer' | 'toggleRacks' | 'demolish' | 'inspection' | 'price' | 'mains' | 'upgrade' | 'move' | 'widen' | 'light';
  label: string;
  /** Pole daty / ceny (gdy akcja z wartością); etap 7f: lista wyboru (typ po ulepszeniu). */
  value?: string | number;
  input?: 'date' | 'number' | 'select';
  options?: { value: string; label: string }[];
  /** Klucz ceny (akcja „price”). */
  priceKey?: string;
}

export type CardLevel = 'good' | 'warn' | 'bad';

/** Etap 7c (tylko do wyświetlenia): duża liczba stanu z paskiem, np. „320 / 320 miejsc zajętych – Pełny”. */
export interface CardHeadline {
  value: number;
  of?: number;
  unit: string;
  level: CardLevel;
  badge?: string;
  /** Liczba z przecinkiem (np. baza śniegu). */
  decimals?: number;
}

export interface ObjectCard {
  title: string;
  kindLabel: string;
  status: CardStatus;
  statusText: string;
  rows: [string, string][];
  chart: { title: string; unit: string; values: number[]; slotH: number; nowIndex: number; capacity?: number; /** Wartości po „teraz” to prognoza z modelu dnia (szare słupki). */ forecast?: boolean } | null;
  actions: CardAction[];
  /** Etap 7c: liczba stanu, trzy kafelki, jedno zdanie z sugestią (żółte pole). */
  headline?: CardHeadline;
  tiles?: { label: string; value: string; level?: CardLevel }[];
  note?: string;
}

const levelOf = (share: number, warn = 0.8, bad = 0.98): CardLevel => (share >= bad ? 'bad' : share >= warn ? 'warn' : 'good');

export interface CardContext {
  state: GameState;
  layout: ResortLayout;
  analysis: ResortAnalysis;
  facts: ResortFacts;
  ep: EconomyParams;
  lp: LiftParams;
  gp: GuestParams;
  hour: number;
  /** Dzień zimowy: plan (goście, godziny) i stan wyciągów na żywo z wątku gości. */
  winter: { open: boolean; guests: number; openH: number; closeH: number; liveLifts: Map<string, { queue: number; waitMin: number; utilization: number; rides: number; closed: boolean }> } | null;
  /** Dzień letni: plan, fakty i statystyki symulacji gości (null – jeszcze brak). */
  summer: { plan: SummerPlan; sf: SummerFacts; stats: SummerStats | null; poiOf: (kind: string, id: string) => number } | null;
  ops: OpsSummary | null;
  infra: Infra | null;
  /** Śnieg na trasie: średnia baza [cm] i najczęstszy stan (opis). */
  pisteSnow?: (id: string) => { baseCm: number; quality: string } | null;
}

const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const pln = (v: number) => `${f0(v)} zł`;
const hh = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

/** Normalny rozkład skumulowany (przybliżenie Abramowitza–Steguna). */
function phi(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Część gości dnia obecna o godzinie h (przyjazd ~N(μ, σ), pobyt ~N(s, σs)). */
export function presenceAt(h: number, arriveMeanH: number, arriveSdH: number, stayMeanH: number, staySdH: number): number {
  const a = phi((h - arriveMeanH) / Math.max(0.1, arriveSdH));
  const d = phi((h - arriveMeanH - stayMeanH) / Math.max(0.1, Math.hypot(arriveSdH, staySdH)));
  return Math.max(0, a - d);
}

/** Profil obecności gości (96 przedziałów po 15 min). */
export function presenceProfile(arriveMeanH: number, arriveSdH: number, stayMeanH: number, staySdH: number, closeH: number): number[] {
  return Array.from({ length: SLOTS }, (_, k) => {
    const h = (k * SLOT_S + SLOT_S / 2) / 3600;
    return h > closeH + 0.5 ? 0 : presenceAt(h, arriveMeanH, arriveSdH, stayMeanH, staySdH);
  });
}

/**
 * Samochody na parkingach w ciągu dnia (model): samochody obecnych gości wypełniają parkingi po kolei
 * do pojemności (jak w zamknięciu dnia); nadwyżka – odjechali. Suma zajętych = samochody gości obecnych
 * (o ile mieszczą się na parkingach).
 */
export function parkingProfiles(totalCars: number, profile: number[], capacities: number[]): { cars: number[][]; turnedAway: number } {
  const cars = capacities.map(() => new Array<number>(profile.length).fill(0));
  let peakOver = 0;
  profile.forEach((p, k) => {
    let left = totalCars * p;
    capacities.forEach((cap, i) => {
      const here = Math.min(cap, left);
      cars[i][k] = here;
      left -= here;
    });
    peakOver = Math.max(peakOver, left);
  });
  return { cars, turnedAway: peakOver };
}

function nowSlot(hour: number): number {
  return Math.max(0, Math.min(SLOTS - 1, Math.floor((hour * 3600) / SLOT_S)));
}

function constructionStatus(c: CardContext, id: string): { status: CardStatus; text: string } | null {
  const b = c.state.construction[id];
  if (!b) return null;
  const done = Math.max(0, Math.min(1, 1 - b.leftDays / Math.max(1, b.totalDays)));
  return { status: 'budowa', text: `w budowie – ${Math.round(done * 100)} %, zostało ok. ${Math.ceil(b.leftDays)} dni${b.summerOnly ? ' (wykop tylko V–X)' : ''}` };
}

/** Karta obiektu (null – nieznany obiekt). */
export function objectCard(kind: CardKind, id: string, c: CardContext): ObjectCard | null {
  const card = objectCardBase(kind, id, c);
  if (card) withBuildActions(card, kind, id, c);
  return card;
}

/**
 * Etap 7f: „Ulepsz” (wyciąg – inny typ na tej samej linii, armatka – inny typ, trasa – poszerzenie),
 * „Przesuń” (budynki z obrotem, armatki śmigłowe). Koszt różnicowy pokazuje kontroler budowy przed zmianą.
 */
function withBuildActions(card: ObjectCard, kind: CardKind, id: string, c: CardContext): void {
  const add: CardAction[] = [];
  if (kind === 'lift') {
    const l = c.layout.lifts.find((x) => x.id === id);
    if (l) {
      const opts = c.lp.types.filter((t) => t.id !== l.typeId && liftUpgradeCheck(l, t.id, c.lp).ok).map((t) => ({ value: t.id, label: `${t.name} – ${f0(t.capacityPerHour)} os./h` }));
      if (opts.length) add.push({ id: 'upgrade', label: 'Ulepsz: inny typ na tej samej linii', input: 'select', options: opts, value: opts[0].value });
    }
  } else if (kind === 'gun') {
    const g = (c.layout.snowGuns ?? []).find((x) => x.id === id);
    const guns = c.ep.snowmaking?.guns ?? [];
    const opts = guns.filter((t) => t.id !== g?.typeId).map((t) => ({ value: t.id, label: `${t.name} – ${pln(t.costPln)}` }));
    if (g && opts.length) add.push({ id: 'upgrade', label: 'Zamień typ armatki', input: 'select', options: opts, value: opts[0].value });
    if (g && guns.find((t) => t.id === g.typeId)?.movable) add.push({ id: 'move', label: 'Przesuń na inny hydrant' });
  } else if (kind === 'piste') {
    add.push({ id: 'widen', label: 'Ulepsz: poszerz trasę' });
    // Etap 7g: oświetlenie trasy (jazda wieczorna) – odblokowuje kamień milowy.
    const p = c.layout.pistes.find((x) => x.id === id);
    const mp = c.ep.milestones;
    if (p && mp) {
      const lock = lockReason('lighting', 'lit', c.state, mp);
      const len = c.analysis.pistes.get(id)?.lengthM ?? 0;
      add.push({ id: 'light', label: p.lit ? 'Wyłącz oświetlenie trasy' : lock ? `Oświetlenie trasy (${lock})` : `Oświetl trasę – ${pln(len * mp.lighting.costPlnPerM)}` });
    }
  } else if (kind === 'base') {
    add.push({ id: 'move', label: 'Przesuń (R – obrót)' });
  }
  if (!add.length) return;
  const dem = card.actions.findIndex((a) => a.id === 'demolish');
  if (dem >= 0) card.actions.splice(dem, 0, ...add);
  else card.actions.push(...add);
}

function objectCardBase(kind: CardKind, id: string, c: CardContext): ObjectCard | null {
  if (kind === 'lift') return liftCard(id, c);
  if (kind === 'piste') return pisteCard(id, c);
  if (kind === 'trail') return trailCard(id, c);
  if (kind === 'base') return buildingCard(id, c);
  if (kind === 'road') {
    const r = (c.layout.roads ?? []).find((x) => x.id === id);
    const a = c.analysis.roads?.get(id);
    if (!r) return null;
    const cs = constructionStatus(c, id);
    return { title: r.name, kindLabel: 'droga dojazdowa', status: cs?.status ?? 'czynny', statusText: cs?.text ?? (a?.connected === false ? 'nie łączy się z drogą publiczną' : 'przejezdna'), rows: [['długość', `${f0(a?.lengthM ?? 0)} m`], ['nachylenie maks.', `${f0(a?.maxSlopePercent ?? 0)} %`], ['odśnieżanie zimą', c.ep.roads ? `${pln(((a?.lengthM ?? 0) / 1000) * c.ep.roads.plowingPlnPerKmPerDay)}/dzień` : '–']], chart: null, actions: [{ id: 'demolish', label: 'Rozbierz' }] };
  }
  if (kind === 'ditch') {
    const d = (c.layout.ditches ?? []).find((x) => x.id === id);
    if (!d) return null;
    let L = 0;
    for (let i = 1; i < d.points.length; i++) L += Math.hypot(d.points[i].xM - d.points[i - 1].xM, d.points[i].yM - d.points[i - 1].yM);
    const src = c.infra?.sources.find((x) => x.id === id);
    const cs = constructionStatus(c, id);
    return {
      title: d.name,
      kindLabel: 'rów zbierający',
      status: cs?.status ?? (src && !src.problem ? 'czynny' : 'nieczynny'),
      statusText: cs?.text ?? (src?.problem ?? 'zbiera deszcz i roztopy do zbiornika'),
      rows: [['długość', `${f0(L)} m`], ['zlewnia (z przepustowością rowu)', src?.catchment ? `${(src.catchment.areaM2 / 1e4).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha` : '–']],
      chart: null,
      actions: [{ id: 'demolish', label: 'Rozbierz' }],
      note: 'Zlewnia rowu – niebieskie pole na mapie (obszar powyżej rowu, z którego woda spływa do niego).',
    };
  }
  if (kind === 'pipeline') {
    const p = (c.layout.pipelines ?? []).find((x) => x.id === id);
    if (!p) return null;
    const cs = constructionStatus(c, id);
    const conn = c.infra?.connected.has(id) ?? false;
    const guns = (c.layout.snowGuns ?? []).filter((g) => g.pipelineId === id).length;
    return { title: p.name, kindLabel: p.supply ? 'rura zasilająca' : 'rurociąg naśnieżania', status: cs?.status ?? (p.supply || conn ? 'czynny' : 'nieczynny'), statusText: cs?.text ?? (p.supply ? 'źródło wody → zbiornik' : conn ? 'połączony z pompownią' : 'niepołączony z pompownią'), rows: p.supply ? [] : [['armatki', String(guns)]], chart: null, actions: [{ id: 'demolish', label: 'Rozbierz' }] };
  }
  if (kind === 'gun') {
    const g = (c.layout.snowGuns ?? []).find((x) => x.id === id);
    if (!g) return null;
    const t = c.ep.snowmaking?.guns.find((x) => x.id === g.typeId);
    const hours = c.ops?.gunHours[id] ?? [];
    const values = new Array<number>(SLOTS).fill(0);
    for (const [h, m3] of hours) for (let k = 0; k < 4; k++) values[Math.min(SLOTS - 1, h * 4 + k)] = m3;
    const now = hours.find((x) => x[0] === Math.floor(c.hour));
    const cs = constructionStatus(c, id);
    return {
      title: `Armatka ${id}`,
      kindLabel: t?.name ?? 'armatka',
      status: cs?.status ?? (now ? 'czynny' : 'nieczynny'),
      statusText: cs?.text ?? (now ? `pracuje: ${f0(now[1])} m³/h śniegu, wiatr ${f0(now[3])} m/s` : 'stoi (za ciepło, cel osiągnięty albo brak wody/mocy)'),
      rows: [['śnieg dziś', `${f0(hours.reduce((a, x) => a + x[1], 0))} m³`], ['godziny pracy dziś', String(hours.length)], ['start od temp. mokrej', t ? `${t.curveWetBulbC[0]} °C` : '–']],
      chart: { title: 'śnieg z armatki dziś', unit: 'm³/h', values, slotH: 0.25, nowIndex: nowSlot(c.hour) },
      actions: [{ id: 'demolish', label: 'Rozbierz' }],
    };
  }
  return null;
}

function liftCard(id: string, c: CardContext): ObjectCard | null {
  const i = c.layout.lifts.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const l = c.layout.lifts[i];
  const t = liftTypeById(c.lp, l.typeId);
  const f = c.facts.lifts[i];
  const a = c.analysis.lifts.get(id);
  const cs = constructionStatus(c, id);
  const ins = inspectionStatus(c.state, id, c.state.date);
  const insState = c.state.inspections?.[id];
  const rows: [string, string][] = [];
  let status: CardStatus = cs?.status ?? 'czynny';
  let text = cs?.text ?? '';
  let chart: ObjectCard['chart'] = null;
  const summer = c.summer;
  const sl = summer?.sf.lifts.find((x) => x.id === id) ?? null;
  if (!cs) {
    if (ins === 'inspection') {
      status = 'przegląd';
      text = `przegląd do ${insState?.activeUntil ?? '–'} – nie wozi`;
    } else if (ins === 'expired') {
      status = 'awaria';
      text = 'brak ważnego przeglądu – stoi';
    } else if (l.closed) {
      status = 'zamknięty';
      text = 'zamknięty przez gracza';
    } else if (summer) {
      if (!sl) {
        status = 'nieczynny';
        text = 'latem wyciągi powierzchniowe stoją';
      } else if (!sl.operating) {
        status = 'nieczynny';
        text = l.summerOff ? 'latem nie kursuje (wyłączony)' : 'nie kursuje';
      } else if (stormAt(summer.plan.weather, c.hour)) {
        status = 'awaria';
        text = 'burza – kolej zatrzymana';
      } else text = 'kursuje latem – piesi w górę i w dół' + (sl.bikeRacks ? ', rowery na wieszakach' : '');
    } else if (!f?.operating) {
      status = 'nieczynny';
      text = c.winter?.open ? 'nie pracuje (brak otwartej trasy w dół, niedostępny z parkingu albo wiatr)' : 'sezon zamknięty';
    } else text = 'pracuje';
  }
  rows.push(['typ', t.name], ['przepustowość', `${f0(t.capacityPerHour)} os./h`], ['długość', `${f0(a?.slopeLengthM ?? f?.lengthM ?? 0)} m`]);
  if (summer && sl) {
    const st = summer.stats;
    const li = summer.poiOf('lift', id);
    rows.push(['latem dla pieszych', `${f0(sl.pedCapacityPerHour)} os./h${sl.bikeRacks ? `, rowery ${f0(sl.bikeCapacityPerHour)}/h` : ''}`]);
    if (st && li >= 0) {
      const k = nowSlot(c.hour);
      rows.push(['dziś w górę / w dół / rowery', `${f0(st.liftUp[li])} / ${f0(st.liftDown[li])} / ${f0(st.liftBikes[li])}`], ['kolejka teraz', `${f0(st.liftQueueUp[li][k])} os. w górę, ${f0(st.liftQueueDown[li][k])} w dół`], ['czekanie teraz', `${f0(st.liftWaitMin[li][k])} min`]);
      const hours = Math.max(0.25, Math.min(c.hour, summer.plan.hours.closeH) - summer.plan.hours.openH);
      rows.push(['wykorzystanie', `${f0((100 * (st.liftUp[li] + st.liftDown[li] + st.liftBikes[li])) / Math.max(1, 2 * (sl.pedCapacityPerHour + sl.bikeCapacityPerHour) * hours))} %`]);
      chart = { title: 'wsiadający co 15 min', unit: 'os.', values: Array.from(st.liftBoardedSlots[li]), slotH: 0.25, nowIndex: k };
    }
  } else if (c.winter) {
    const live = c.winter.liveLifts.get(id);
    if (live) {
      rows.push(['pasażerowie dziś', f0(live.rides)], ['kolejka teraz', `${f0(live.queue)} os.`], ['czekanie teraz', `${f0(live.waitMin)} min`], ['wykorzystanie teraz', `${f0(live.utilization * 100)} %`]);
    }
    if (c.winter.open && f?.operating) {
      const prof = presenceProfile(c.gp.scenario.arrivalMeanH, c.gp.scenario.arrivalSdH, c.gp.scenario.stayMeanH, c.gp.scenario.staySdH, c.winter.closeH);
      const cap = c.facts.capacityPerHour || 1;
      const share = f.capacityPerHour / cap;
      const peak = Math.max(...prof) || 1;
      chart = { title: 'obciążenie w ciągu dnia (model)', unit: 'os./15 min', values: prof.map((p, k) => (k * 0.25 >= c.winter!.openH && k * 0.25 < c.winter!.closeH ? Math.min(t.capacityPerHour / 4, ((p / peak) * c.winter!.guests * share * 0.5) / 4) : 0)), slotH: 0.25, nowIndex: nowSlot(c.hour), capacity: t.capacityPerHour / 4 };
    }
  }
  if (f) {
    const hours = c.winter?.open ? Math.max(0, c.winter.closeH - c.winter.openH) : summer && sl?.operating ? summer.plan.hours.closeH - summer.plan.hours.openH : 0;
    rows.push(['energia (bieg jałowy – pełne obciążenie)', `${f0(f.idleKw)}–${f0(f.powerKw)} kW${hours ? `, dziś do ${f0(hours * f.powerKw)} kWh` : ''}`]);
  }
  rows.push(['przegląd', `${INSPECTION_STATUS_NAMES[ins]}${insState?.validUntil ? `, ważny do ${insState.validUntil}` : ''}${insState?.scheduled ? `; następny ${insState.scheduled}` : ''}`]);
  const actions: CardAction[] = [{ id: 'toggleOpen', label: l.closed ? 'Otwórz' : 'Zamknij' }];
  if (t.kind === 'aerial' && c.ep.summer) {
    actions.push({ id: 'toggleSummer', label: l.summerOff ? 'Kursuj latem' : 'Nie kursuj latem' }, { id: 'toggleRacks', label: l.bikeRacks ? 'Zdejmij wieszaki na rowery' : 'Załóż wieszaki na rowery' });
  }
  if (c.ep.summer && insState && !insState.activeUntil) actions.push({ id: 'inspection', label: 'Termin przeglądu', input: 'date', value: insState.scheduled ?? formatIsoDate(c.state.date) });
  actions.push({ id: 'demolish', label: 'Rozbierz' });
  const card: ObjectCard = { title: l.name, kindLabel: t.kind === 'aerial' ? 'kolej linowa' : 'wyciąg', status, statusText: text, rows, chart, actions };
  const live = c.winter?.liveLifts.get(id);
  if (live && !summer) {
    const u = Math.min(1, live.utilization);
    card.headline = { value: Math.round(u * 100), of: 100, unit: '% przepustowości', level: levelOf(u, 0.75, 0.95), badge: live.waitMin >= 1 ? `Kolejka ${f0(live.waitMin)} min` : 'Bez kolejki' };
    card.tiles = [{ label: 'Pasażerowie dziś', value: f0(live.rides) }, { label: 'W kolejce', value: `${f0(live.queue)} os.`, level: live.waitMin >= 15 ? 'bad' : live.waitMin >= 5 ? 'warn' : undefined }, { label: 'Przepustowość', value: `${f0(t.capacityPerHour)}/h` }];
    if (live.waitMin >= 10) card.note = `Kolejka ${f0(live.waitMin)} min – goście zaczynają narzekać. Drugi wyciąg obok albo szybsza kolej rozładuje tłok.`;
  } else if (summer && sl && summer.stats) {
    const li = summer.poiOf('lift', id);
    const st = summer.stats;
    if (li >= 0) {
      const k = nowSlot(c.hour);
      const w = st.liftWaitMin[li][k];
      card.headline = { value: Math.round(st.liftUp[li] + st.liftDown[li]), unit: 'przejazdów dziś', level: w >= 15 ? 'bad' : w >= 5 ? 'warn' : 'good', badge: w >= 1 ? `Kolejka ${f0(w)} min` : 'Bez kolejki' };
      card.tiles = [{ label: 'W górę', value: f0(st.liftUp[li]) }, { label: 'W dół', value: f0(st.liftDown[li]) }, { label: 'Rowery', value: f0(st.liftBikes[li]) }];
    }
  } else {
    card.tiles = [{ label: 'Przepustowość', value: `${f0(t.capacityPerHour)}/h` }, { label: 'Długość', value: `${f0(a?.slopeLengthM ?? f?.lengthM ?? 0)} m` }, { label: 'Przegląd', value: INSPECTION_STATUS_NAMES[ins] }];
  }
  if (chart && !summer) chart.forecast = true;
  return card;
}

function pisteCard(id: string, c: CardContext): ObjectCard | null {
  const p = c.layout.pistes.find((x) => x.id === id);
  const a = c.analysis.pistes.get(id);
  if (!p || !a) return null;
  const pf = c.facts.pistes.find((x) => x.id === id);
  const cs = constructionStatus(c, id);
  const cls = c.analysis.pistes.get(id) ? ['zielona', 'niebieska', 'czerwona', 'czarna'][a.classIndex] : '';
  const rows: [string, string][] = [['klasa', cls ?? ''], ['długość', `${f0(a.lengthM)} m`], ['powierzchnia', `${(a.areaM2 / 10000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} ha`], ['nachylenie', `średnio ${f0(a.meanSlopePercent)} %, maks. ${f0(a.maxSlopePercent)} %`]];
  let status: CardStatus = cs?.status ?? (p.closed ? 'zamknięty' : pf?.open ? 'czynny' : 'nieczynny');
  let text = cs?.text ?? (p.closed ? 'zamknięta przez gracza' : pf?.open ? 'otwarta' : 'nieczynna (sezon zamknięty albo brak wyciągu)');
  if (c.summer) {
    status = cs?.status ?? 'nieczynny';
    const mow = c.state.summer?.mowing ?? true;
    text = cs?.text ?? `lato – łąka${mow ? ', koszona w lipcu' : ''}`;
    rows.push(['nawierzchnia latem', `łąka${mow && c.ep.summer ? ` (koszenie ${pln((a.areaM2 / 10000) * c.ep.summer.mowing.plnPerHa)}/rok)` : ''}`]);
  } else {
    const sn = c.pisteSnow?.(id);
    if (sn) rows.push(['śnieg', `baza ubita ${f0(sn.baseCm)} cm, ${sn.quality}`]);
    if (c.winter?.open && pf?.open) {
      const prof = presenceProfile(c.gp.scenario.arrivalMeanH, c.gp.scenario.arrivalSdH, c.gp.scenario.stayMeanH, c.gp.scenario.staySdH, c.winter.closeH);
      const km = c.facts.kmOpen || 1;
      const share = a.lengthM / 1000 / km;
      const onPiste = prof.map((x) => x * c.winter!.guests * 0.35 * share);
      const k = nowSlot(c.hour);
      rows.push(['narciarzy na trasie teraz (model)', f0(onPiste[k])], ['tłok teraz', `${(onPiste[k] / Math.max(0.1, a.lengthM / 100)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} os./100 m`]);
      return pisteExtras({ title: p.name, kindLabel: 'trasa narciarska', status, statusText: text, rows, chart: { title: 'narciarze na trasie (model)', unit: 'os.', values: onPiste, slotH: 0.25, nowIndex: k, forecast: true }, actions: [{ id: 'toggleOpen', label: p.closed ? 'Otwórz' : 'Zamknij' }, { id: 'demolish', label: 'Rozbierz' }] }, a, sn ?? null, onPiste[k], cls);
    }
    return pisteExtras({ title: p.name, kindLabel: 'trasa narciarska', status, statusText: text, rows, chart: null, actions: [{ id: 'toggleOpen', label: p.closed ? 'Otwórz' : 'Zamknij' }, { id: 'demolish', label: 'Rozbierz' }] }, a, sn ?? null, null, cls);
  }
  return pisteExtras({ title: p.name, kindLabel: 'trasa narciarska', status, statusText: text, rows, chart: null, actions: [{ id: 'toggleOpen', label: p.closed ? 'Otwórz' : 'Zamknij' }, { id: 'demolish', label: 'Rozbierz' }] }, a, null, null, cls);
}

/** Etap 7c: liczba stanu i kafelki trasy (baza śniegu, długość, nachylenie, narciarze). */
function pisteExtras(card: ObjectCard, a: { lengthM: number; meanSlopePercent: number; maxSlopePercent: number }, sn: { baseCm: number; quality: string } | null, skiers: number | null, cls: string): ObjectCard {
  if (sn) card.headline = { value: Math.round(sn.baseCm), unit: 'cm bazy ubitej', level: sn.baseCm >= 30 ? 'good' : sn.baseCm >= 15 ? 'warn' : 'bad', badge: sn.quality };
  card.tiles = [{ label: 'Klasa', value: cls }, { label: 'Długość', value: `${f0(a.lengthM)} m` }, skiers !== null ? { label: 'Narciarzy teraz', value: f0(skiers) } : { label: 'Nachylenie', value: `${f0(a.meanSlopePercent)}–${f0(a.maxSlopePercent)} %` }];
  return card;
}

function trailCard(id: string, c: CardContext): ObjectCard | null {
  const t = (c.layout.trails ?? []).find((x) => x.id === id);
  const a = c.analysis.trails?.get(id);
  const sp = c.ep.summer;
  if (!t || !a || !sp) return null;
  const cs = constructionStatus(c, id);
  const rows: [string, string][] = [['długość', `${f0(a.lengthM)} m`], ['spadek', `${f0(a.dropM)} m, średnio ${f0(a.meanSlopePercent)} %, maks. ${f0(a.maxSlopePercent)} %`], ['utrzymanie', `${pln(a.maintenancePlnPerYear)}/rok`]];
  if (t.kind === 'bike') rows.unshift(['trudność', `${BIKE_CLASS_NAMES[a.classIndex]} (IMBA, średnie nachylenie)`]);
  if (a.issues.length) rows.push(['uwagi', a.issues.join('; ')]);
  const s = c.summer;
  let chart: ObjectCard['chart'] = null;
  let status: CardStatus = cs?.status ?? (t.closed ? 'zamknięty' : 'czynny');
  let text = cs?.text ?? (t.closed ? 'zamknięta przez gracza' : 'otwarta');
  if (t.kind === 'toboggan') {
    rows.push(['przepustowość', `${f0(sp.toboggan.capacityPerHour)} przejazdów/h`], ['cena przejazdu', pln(c.state.summer?.prices.tobogganRidePln ?? sp.prices.tobogganRidePln)], ['sezon', 'cały rok (zimą też jeździ)']);
    if (s?.stats) {
      const k = nowSlot(c.hour);
      rows.push(['przejazdy dziś', f0(s.stats.tobRides)], ['kolejka teraz', `${f0(s.stats.tobQueue[k])} os.`], ['przychód dziś', pln(s.stats.tobRides * (c.state.summer?.prices.tobogganRidePln ?? sp.prices.tobogganRidePln))]);
      chart = { title: 'kolejka do toru', unit: 'os.', values: Array.from(s.stats.tobQueue), slotH: 0.25, nowIndex: k };
      if (stormAt(s.plan.weather, c.hour)) {
        status = 'awaria';
        text = 'burza – tor zatrzymany';
      }
    }
  } else if (t.kind === 'bike' && s?.stats) {
    const bi = s.poiOf('bike', id);
    if (bi >= 0) rows.push(['zjazdy dziś', f0(s.stats.bikeLaps[bi])]);
    rows.push(['karnet rowerowy', pln(c.state.summer?.prices.bikeDayPln ?? sp.prices.bikeDayPln)]);
  }
  rows.push(['przychód w sezonie', pln(c.state.objectRevenue?.[id] ?? 0)]);
  const actions: CardAction[] = [{ id: 'toggleOpen', label: t.closed ? 'Otwórz' : 'Zamknij' }];
  if (t.kind === 'toboggan') actions.push({ id: 'price', label: 'Cena przejazdu [zł]', input: 'number', value: c.state.summer?.prices.tobogganRidePln ?? sp.prices.tobogganRidePln, priceKey: 'tobogganRidePln' });
  if (t.kind === 'bike') actions.push({ id: 'price', label: 'Karnet rowerowy [zł]', input: 'number', value: c.state.summer?.prices.bikeDayPln ?? sp.prices.bikeDayPln, priceKey: 'bikeDayPln' });
  actions.push({ id: 'demolish', label: 'Rozbierz' });
  const card: ObjectCard = { title: t.name, kindLabel: TRAIL_KIND_NAMES[t.kind], status, statusText: text, rows, chart, actions };
  if (t.kind === 'toboggan' && s?.stats) card.headline = { value: Math.round(s.stats.tobRides), unit: 'przejazdów dziś', level: 'good', badge: `Kolejka ${f0(s.stats.tobQueue[nowSlot(c.hour)])} os.` };
  card.tiles = [{ label: 'Długość', value: `${f0(a.lengthM)} m` }, { label: 'Spadek', value: `${f0(a.dropM)} m` }, { label: 'Przychód w sezonie', value: pln(c.state.objectRevenue?.[id] ?? 0) }];
  return card;
}

function buildingCard(id: string, c: CardContext): ObjectCard | null {
  const b = [...c.layout.bases, ...(c.layout.buildings ?? [])].find((x) => x.id === id) as { id: string; name: string; typeId?: string; xM: number; yM: number } | undefined;
  if (!b) return null;
  const bf = c.facts.buildings.find((x) => x.id === id);
  const cs = constructionStatus(c, id);
  const ep = c.ep;
  const wage = ep.costs.hourlyWagePln * ep.costs.employerCostFactor;
  const t = bf?.type;
  const sp = c.ep.summer;
  const season = c.state.objectRevenue?.[id] ?? 0;
  const k = nowSlot(c.hour);
  // Parking.
  if (t?.base) {
    const caps = c.facts.buildings.filter((x) => x.type.base && x.built && x.accessible);
    const idx = caps.findIndex((x) => x.id === id);
    const rows: [string, string][] = [['miejsca razem', `${f0(t.cars)} aut`], ['opłata', `${pln(t.feePerCarPln)} za auto`]];
    let series: number[] | null = null;
    let turned = 0;
    const s = c.summer;
    const pi = s ? s.poiOf('parking', id) : -1;
    if (s?.stats && pi >= 0) {
      series = Array.from(s.stats.parkingCars[pi]);
      turned = s.stats.parkingTurnedAway[pi];
    } else if (c.winter?.open && idx >= 0) {
      const prof = presenceProfile(c.gp.scenario.arrivalMeanH, c.gp.scenario.arrivalSdH, c.gp.scenario.stayMeanH, c.gp.scenario.staySdH, c.winter.closeH);
      const cars = c.winter.guests / ep.demand.personsPerCar;
      const pp = parkingProfiles(cars, prof, caps.map((x) => x.type.cars));
      series = pp.cars[idx];
      turned = idx === caps.length - 1 ? pp.turnedAway * ep.demand.personsPerCar : 0;
    }
    if (series) {
      const now = series[k];
      const peak = Math.max(...series);
      const peakK = series.indexOf(peak);
      const fullK = series.findIndex((v) => v >= t.cars - 0.5);
      rows.push(['zajęte teraz', `${f0(now)} aut`], ['wolne teraz', `${f0(Math.max(0, t.cars - now))}`], ['szczyt dnia', `${f0(peak)} aut o ${hh(peakK * 0.25)}`], ['pełny od', fullK >= 0 ? hh(fullK * 0.25) : 'nie był pełny'], ['odjechało (brak miejsc)', `${f0(turned)} os.`], ['przychód dziś (szac.)', pln(series.reduce((a, v, i) => a + Math.max(0, v - (i ? series![i - 1] : 0)), 0) * t.feePerCarPln)]);
    }
    rows.push(['przychód w roku gry', pln(season)]);
    const card: ObjectCard = { title: b.name, kindLabel: 'parking', status: cs?.status ?? (bf?.accessible === false ? 'nieczynny' : 'czynny'), statusText: cs?.text ?? (bf?.accessible === false ? 'bez dojazdu – zbuduj drogę' : 'czynny'), rows, chart: series ? { title: 'zajęte miejsca w ciągu dnia', unit: 'aut', values: series, slotH: 0.25, nowIndex: k, capacity: t.cars, forecast: !(s?.stats && pi >= 0) } : null, actions: [{ id: 'demolish', label: 'Rozbierz' }] };
    const now = series ? series[k] : 0;
    const full = series ? series.findIndex((v) => v >= t.cars - 0.5) : -1;
    card.headline = { value: Math.round(now), of: t.cars, unit: 'miejsc zajętych', level: levelOf(now / Math.max(1, t.cars)), badge: now >= t.cars - 0.5 ? 'Pełny' : undefined };
    const income = series ? series.reduce((acc, v, i) => acc + Math.max(0, v - (i ? series![i - 1] : 0)), 0) * t.feePerCarPln : 0;
    card.tiles = [{ label: 'Odjechało', value: `${f0(turned / Math.max(1, c.ep.demand.personsPerCar))} aut`, level: turned > 0 ? 'bad' : undefined }, { label: 'Przychód dziś', value: pln(income) }, { label: 'Opłata', value: pln(t.feePerCarPln) }];
    if (turned > 0 && full >= 0) card.note = `Parking pełny od ${hh(full * 0.25)}, ${f0(turned)} osób odjechało. Zbuduj drugi parking albo podnieś opłatę.`;
    return card;
  }
  // Gastronomia (restauracja, schronisko, bar).
  if (t && isFoodType(t.id)) {
    const seats = sp?.guests.summerFoodSeatsPerBuilding ?? 0;
    const rows: [string, string][] = [['miejsca', String(seats)]];
    const s = c.summer;
    const fi = s ? s.poiOf('food', id) : -1;
    let chart: ObjectCard['chart'] = null;
    const staffH = (c.winter?.closeH ?? sp?.season.closeH ?? 16) - (c.winter?.openH ?? sp?.season.openH ?? 9) + ep.costs.staffExtraHours;
    if (s?.stats && fi >= 0 && sp) {
      const served = s.stats.foodServed[fi];
      rows.push(['zajęte teraz', f0(s.stats.foodOccupied[fi][k])], ['kolejka teraz', `${f0(s.stats.foodQueue[fi][k])} os.`], ['obsłużeni dziś', f0(served)], ['średni rachunek', pln(sp.guests.mealSpendPln)], ['przychód dziś', pln(served * sp.guests.mealSpendPln)], ['zadowolenie z jedzenia', s.stats.foodQueue[fi].some((q) => q > seats * 0.3) ? 'kolejki – niższe' : 'dobre']);
      chart = { title: 'zajęte miejsca', unit: 'os.', values: Array.from(s.stats.foodOccupied[fi]), slotH: 0.25, nowIndex: k, capacity: seats };
    } else if (c.winter?.open) {
      const users = Math.min(t.capacityPerDay, c.winter.guests * t.useShare);
      rows.push(['obsłużeni dziś (plan)', f0(users)], ['średni rachunek', pln(t.revenuePerGuestPln)], ['przychód dziś (plan)', pln(users * t.revenuePerGuestPln)]);
      const lunch = Array.from({ length: SLOTS }, (_, i) => Math.exp(-(((i * 0.25 - 12.75) / 1.1) ** 2) / 2));
      const sum = lunch.reduce((a, v) => a + v, 0) || 1;
      chart = { title: 'goście w lokalu (model)', unit: 'os.', values: lunch.map((v) => Math.min(seats || 9999, ((users * v) / sum) * 3)), slotH: 0.25, nowIndex: k, capacity: seats || undefined };
    }
    rows.push(['koszty personelu dziś', pln(t.staffPerDay * staffH * wage)], ['przychód w roku gry', pln(season)]);
    const card: ObjectCard = { title: b.name, kindLabel: 'gastronomia', status: cs?.status ?? 'czynny', statusText: cs?.text ?? 'czynna', rows, chart, actions: [{ id: 'demolish', label: 'Rozbierz' }] };
    if (s?.stats && fi >= 0 && sp) {
      const occ = s.stats.foodOccupied[fi][k];
      const q = s.stats.foodQueue[fi][k];
      const served = s.stats.foodServed[fi];
      card.headline = { value: Math.round(occ), of: seats, unit: 'miejsc zajętych', level: q > 0 ? 'warn' : levelOf(occ / Math.max(1, seats)), badge: q >= 1 ? `Kolejka ${f0(q)} osób` : undefined };
      card.tiles = [{ label: 'Obsłużeni', value: f0(served) }, { label: 'Średni rachunek', value: pln(sp.guests.mealSpendPln) }, { label: 'Przychód dziś', value: pln(served * sp.guests.mealSpendPln) }];
      const peakQ = Math.max(...s.stats.foodQueue[fi]);
      if (peakQ > seats * 0.3) card.note = `W szczycie obiadowym w kolejce czekało do ${f0(peakQ)} osób. Większa sala albo drugi lokal skróci czekanie.`;
    } else if (c.winter?.open) {
      const users = Math.min(t.capacityPerDay, c.winter.guests * t.useShare);
      card.headline = { value: Math.round(users), of: t.capacityPerDay, unit: 'gości dziś (plan)', level: levelOf(users / Math.max(1, t.capacityPerDay), 0.85, 0.99), badge: users >= t.capacityPerDay * 0.99 ? 'Pełne obłożenie' : undefined };
      card.tiles = [{ label: 'Obsłużeni (plan)', value: f0(users) }, { label: 'Średni rachunek', value: pln(t.revenuePerGuestPln) }, { label: 'Przychód (plan)', value: pln(users * t.revenuePerGuestPln) }];
      if (users >= t.capacityPerDay * 0.99) card.note = 'Lokal jest pełny – część gości odchodzi głodna. Drugi lokal zwiększy przychód i zadowolenie.';
      if (card.chart) card.chart.forecast = true;
    }
    return card;
  }
  if (t && (t.id === 'rental' || t.id === 'school' || t.id === 'shuttle')) {
    const users = c.winter?.open ? Math.min(t.capacityPerDay, c.winter.guests * t.useShare) : 0;
    const rows: [string, string][] = [['przepustowość', `${f0(t.capacityPerDay)} os./dzień`], ['obsłużeni dziś (plan)', f0(users)], ['kolejka (model)', users >= t.capacityPerDay * 0.95 ? 'pełne obłożenie – część odchodzi' : 'bez kolejki'], ['przychód dziś (plan)', pln(users * t.revenuePerGuestPln)], ['personel', `${t.staffPerDay} os.`], ['przychód w roku gry', pln(season)]];
    return { title: b.name, kindLabel: t.name.toLowerCase(), status: cs?.status ?? 'czynny', statusText: cs?.text ?? 'czynna', rows, chart: null, actions: [{ id: 'demolish', label: 'Rozbierz' }] };
  }
  // Infrastruktura naśnieżania i budynki letnie.
  const infraT = ep.snowmaking?.buildings.find((x) => x.id === b.typeId);
  if (infraT) {
    const rows: [string, string][] = [];
    const inf = c.infra;
    const ops = c.state.ops;
    const sum = c.ops;
    if (infraT.kind === 'reservoir') {
      const capAll = Math.max(1, inf?.reservoirCapacityM3 ?? infraT.capacity);
      const nowM3 = ops?.reservoirM3 ?? 0;
      const card: ObjectCard = { title: b.name, kindLabel: infraT.name, status: cs?.status ?? 'czynny', statusText: cs?.text ?? 'czynny', rows, chart: null, actions: [{ id: 'demolish', label: 'Rozbierz' }], headline: { value: Math.round(nowM3), of: Math.round(capAll), unit: 'm³ wody (wszystkie zbiorniki)', level: nowM3 / capAll < 0.2 ? 'bad' : nowM3 / capAll < 0.5 ? 'warn' : 'good' }, tiles: [{ label: 'Dopływ dziś', value: `${f0(sum?.inflowM3 ?? 0)} m³` }, { label: 'Zużycie dziś', value: `${f0(sum?.waterM3 ?? 0)} m³` }, { label: 'Pojemność', value: `${f0(infraT.capacity)} m³` }] };
      rows.push(['pojemność', `${f0(infraT.capacity)} m³`], ['woda teraz', `${f0(ops?.reservoirM3 ?? 0)} m³ (${f0((100 * (ops?.reservoirM3 ?? 0)) / Math.max(1, inf?.reservoirCapacityM3 ?? infraT.capacity))} % wszystkich zbiorników)`], ['dopływ dziś', `${f0(sum?.inflowM3 ?? 0)} m³`], ['zużycie dziś', `${f0(sum?.waterM3 ?? 0)} m³`]);
      for (const so of sum?.sources ?? []) rows.push([`źródło: ${so.name}`, `${f0(so.m3)} m³, ${pln(so.costPln)} – ${so.note}`]);
      return card;
    } else if (infraT.kind === 'intake' || infraT.kind === 'mains' || infraT.kind === 'well' || infraT.kind === 'catchment') {
      const src = inf?.sources.find((x) => x.id === id);
      const day = sum?.sources?.find((x) => x.id === id);
      rows.push(['dziś do zbiornika', `${f0(day?.m3 ?? 0)} m³, koszt ${pln(day?.costPln ?? 0)}`], ['opis', day?.note ?? src?.problem ?? '–']);
      if (src?.wellYieldM3h !== undefined) rows.push(['wydajność studni', `${src.wellYieldM3h.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} m³/h`]);
    } else if (infraT.kind === 'pump') {
      const hourly = sum?.hourly ?? [];
      rows.push(['wydajność', `${f0(infraT.capacity)} m³/h`], ['pompowanie dziś', `${f0(hourly.reduce((a, x) => a + x.waterM3, 0))} m³`]);
      const values = new Array<number>(SLOTS).fill(0);
      for (const x of hourly) for (let q = 0; q < 4; q++) values[Math.min(SLOTS - 1, x.hour * 4 + q)] = x.pumpKw;
      return { title: b.name, kindLabel: infraT.name, status: cs?.status ?? 'czynny', statusText: cs?.text ?? 'czynna', rows, chart: { title: 'moc pomp', unit: 'kW', values, slotH: 0.25, nowIndex: k }, actions: [{ id: 'demolish', label: 'Rozbierz' }] };
    } else if (infraT.kind === 'garage') {
      for (const g of ops?.groomers ?? []) rows.push([g.id, `${ep.snowmaking?.groomers.types.find((x) => x.id === g.typeId)?.name ?? g.typeId}${g.leased ? ' (leasing)' : ''} – ${g.brokenNights > 0 ? `w naprawie ${g.brokenNights} nocy` : 'sprawny'}`]);
      const jobs = sum?.jobs ?? [];
      rows.push(['plan nocy', jobs.length ? `${jobs.length} tras, koniec ok. ${hh(sum?.finishH ?? 0)}` : 'brak']);
    } else rows.push(['wydajność', String(infraT.capacity)]);
    return { title: b.name, kindLabel: infraT.name, status: cs?.status ?? 'czynny', statusText: cs?.text ?? 'czynny', rows, chart: null, actions: infraT.kind === 'mains' ? [{ id: 'mains', label: ops?.mainsOn ? 'Wyłącz zakup wody' : 'Włącz zakup wody' }, { id: 'demolish', label: 'Rozbierz' }] : [{ id: 'demolish', label: 'Rozbierz' }] };
  }
  const st = sp?.buildings.find((x) => x.id === b.typeId);
  if (st) {
    const rows: [string, string][] = [['pojemność', `${f0(st.capacity)} ${b.typeId === 'playground' ? 'dzieci' : 'osób'}`], ['utrzymanie', `${pln(st.costPln * st.maintenanceRatePerYear)}/rok`], ['działa', 'latem (przyciąga rodziny / turystów)']];
    return { title: b.name, kindLabel: st.name.toLowerCase(), status: cs?.status ?? 'czynny', statusText: cs?.text ?? 'czynny', rows, chart: null, actions: [{ id: 'demolish', label: 'Rozbierz' }] };
  }
  return { title: b.name, kindLabel: 'baza', status: cs?.status ?? 'czynny', statusText: cs?.text ?? '', rows: [], chart: null, actions: [{ id: 'demolish', label: 'Rozbierz' }] };
}
