/**
 * Etap 7c: doradca w raporcie (makieta ui-3-raport): proste reguły – wąskie gardło wyciągu, pełny
 * parking, kuchnia (gastronomia), brak śniegu, brak tras dla początkujących, niskie oceny – każda
 * z jednym zdaniem i przyciskiem akcji. Progi w data/ui.json (sekcja „advisor”). Bez DOM – testy.
 */
import { readNumber, readSection } from '../../sim/params';

export interface AdvisorParams {
  bottleneckUtilization: number;
  bottleneckWaitMin: number;
  kitchenQueue: number;
  thinShare: number;
  lowRating: number;
}

const FILE = 'data/ui.json';

export function parseAdvisorParams(json: unknown): AdvisorParams {
  const s = readSection(json as Record<string, unknown>, 'advisor', FILE);
  return {
    bottleneckUtilization: readNumber(s, 'bottleneckUtilization', FILE, { min: 0, max: 1 }),
    bottleneckWaitMin: readNumber(s, 'bottleneckWaitMin', FILE, { min: 0 }),
    kitchenQueue: readNumber(s, 'kitchenQueue', FILE, { min: 0 }),
    thinShare: readNumber(s, 'thinShare', FILE, { min: 0, max: 1 }),
    lowRating: readNumber(s, 'lowRating', FILE, { min: 1, max: 5 }),
  };
}

export interface AdvisorInput {
  guests: number;
  /** Wyciągi: wykorzystanie (0–1) i najdłuższa kolejka [min]. */
  lifts: { name: string; id?: string; utilization: number; waitMin: number }[];
  /** Parking: ile osób odjechało bez miejsca i od kiedy pełny („10:12”). */
  parkingTurnedAway: number;
  parkingFullAt: string | null;
  parkingId?: string | null;
  /** Gastronomia: najdłuższa kolejka [os.] i czy lokal był pełny (model). */
  foodQueuePeak: number;
  foodFull: boolean;
  hasFood: boolean;
  /** Trasy otwarte i z za cienką bazą. */
  openPistes: number;
  thinPistes: number;
  /** Sezon otwarty, a dzień zamknięty (brak śniegu, wyciągi stoją). */
  closedDay: boolean;
  hasSnowmaking: boolean;
  /** Goście, którzy wyjechali, bo nie było trasy na ich poziom. */
  leftNoLevel: number;
  rating: number | null;
  winter: boolean;
}

export interface AdviceAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface Advice {
  id: string;
  level: 'bad' | 'warn' | 'good';
  title: string;
  text: string;
  actions: AdviceAction[];
  /** Kolejność: większa – ważniejsza. */
  weight: number;
}

const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');

export function advise(i: AdvisorInput, p: AdvisorParams): Advice[] {
  const out: Advice[] = [];
  // Wąskie gardło: najbardziej obciążony wyciąg.
  const worst = [...i.lifts].sort((a, b) => b.utilization + b.waitMin / 60 - (a.utilization + a.waitMin / 60))[0];
  if (worst && (worst.utilization >= p.bottleneckUtilization || worst.waitMin >= p.bottleneckWaitMin)) {
    out.push({
      id: 'bottleneck',
      level: worst.waitMin >= 2 * p.bottleneckWaitMin ? 'bad' : 'warn',
      title: `${worst.name} jest wąskim gardłem ośrodka`,
      text: `Pracuje na ${f0(worst.utilization * 100)} % przepustowości, kolejka sięgała ${f0(worst.waitMin)} min. Drugi wyciąg obok albo szybsza kolej rozładują tłok.`,
      actions: [{ id: 'showQueues', label: 'Pokaż kolejki na mapie' }, { id: 'planLift', label: 'Zaplanuj wyciąg', primary: true }],
      weight: 50 + worst.waitMin,
    });
  }
  if (i.parkingTurnedAway > 0) {
    out.push({
      id: 'parking',
      level: 'bad',
      title: `Parking pełny${i.parkingFullAt ? ` od ${i.parkingFullAt}` : ''}`,
      text: `${f0(i.parkingTurnedAway)} osób odjechało bez miejsca. Drugi parking (z drogą dojazdową) zatrzyma ich w ośrodku.`,
      actions: [...(i.parkingId ? [{ id: 'showParking', label: 'Pokaż parking' }] : []), { id: 'buildParking', label: 'Zbuduj parking', primary: true }],
      weight: 45 + Math.min(40, i.parkingTurnedAway / 10),
    });
  }
  if (i.hasFood && (i.foodQueuePeak >= p.kitchenQueue || i.foodFull)) {
    out.push({
      id: 'kitchen',
      level: 'warn',
      title: 'Za mało miejsc w gastronomii',
      text: i.foodQueuePeak >= p.kitchenQueue ? `W porze obiadu w kolejce czekało do ${f0(i.foodQueuePeak)} osób. Drugi lokal albo większa sala skrócą czekanie.` : 'Lokal był pełny – część gości odeszła głodna. Drugi lokal zwiększy przychód i oceny.',
      actions: [{ id: 'showFood', label: 'Pokaż lokal' }, { id: 'buildFood', label: 'Postaw lokal', primary: true }],
      weight: 30 + i.foodQueuePeak / 5,
    });
  } else if (!i.hasFood && i.winter && i.guests >= 300) {
    out.push({ id: 'kitchen', level: 'warn', title: 'Brak gastronomii', text: `${f0(i.guests)} gości i nigdzie nie można zjeść. Lokal przy stoku to dodatkowy przychód i lepsze oceny.`, actions: [{ id: 'buildFood', label: 'Postaw lokal', primary: true }], weight: 25 });
  }
  const thin = i.openPistes > 0 ? i.thinPistes / i.openPistes : 0;
  if (i.winter && (i.closedDay || thin >= p.thinShare)) {
    out.push({
      id: 'snow',
      level: i.closedDay ? 'bad' : 'warn',
      title: i.closedDay ? 'Ośrodek stał – brak śniegu' : 'Za mało śniegu na trasach',
      text: i.closedDay
        ? `Sezon otwarty, ale trasy były za cienkie albo wyciągi nie miały zjazdu. ${i.hasSnowmaking ? 'Zaplanuj naśnieżanie na mroźne noce.' : 'Naśnieżanie pozwoli otworzyć ośrodek także w słabe zimy.'}`
        : `${f0(i.thinPistes)} z ${f0(i.openPistes)} otwartych tras ma za cienką bazę – kamienie, wypadki, niższe oceny. ${i.hasSnowmaking ? 'Zaplanuj naśnieżanie albo zamknij te trasy.' : 'Rurociąg i armatki rozwiążą problem w słabe zimy.'}`,
      actions: [{ id: 'showSnow', label: 'Pokaż śnieg' }, i.hasSnowmaking ? { id: 'snowPlan', label: 'Plan naśnieżania', primary: true } : { id: 'buildSnow', label: 'Zbuduj naśnieżanie', primary: true }],
      weight: i.closedDay ? 70 : 40 + thin * 20,
    });
  }
  if (i.guests > 0 && i.leftNoLevel >= Math.max(10, i.guests * 0.1)) {
    out.push({
      id: 'beginners',
      level: 'warn',
      title: 'Brak tras dla początkujących',
      text: `${f0(i.leftNoLevel)} osób wyjechało, bo nie znalazło trasy na swój poziom. Łagodna zielona trasa (do 10 %) przy wyciągu zatrzyma rodziny i szkoły.`,
      actions: [{ id: 'showSlope', label: 'Pokaż nachylenie' }, { id: 'drawPiste', label: 'Narysuj trasę', primary: true }],
      weight: 35 + Math.min(30, (100 * i.leftNoLevel) / Math.max(1, i.guests)),
    });
  }
  if (i.rating !== null && i.rating < p.lowRating && !out.length) {
    out.push({ id: 'rating', level: 'warn', title: 'Goście są niezadowoleni', text: `Średnia ocena ${i.rating.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} / 5. Sprawdź kolejki, śnieg i dopasowanie tras do umiejętności gości.`, actions: [{ id: 'guests', label: 'Panel gości', primary: true }], weight: 20 });
  }
  if (!out.length) {
    out.push({ id: 'ok', level: 'good', title: 'Ośrodek działa bez wąskich gardeł', text: i.guests > 0 ? 'Kolejki krótkie, parking i śnieg wystarczają. Możesz podnieść cenę karnetu albo rozbudować ośrodek.' : 'Brak gości – sprawdź, czy sezon jest otwarty (panel gości) i czy wyciągi mają dojazd i trasę w dół.', actions: i.guests > 0 ? [{ id: 'prices', label: 'Cennik', primary: true }] : [{ id: 'guests', label: 'Panel gości', primary: true }], weight: 0 });
  }
  return out.sort((a, b) => b.weight - a.weight);
}
