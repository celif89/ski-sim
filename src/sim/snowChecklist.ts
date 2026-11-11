/**
 * Etap 7f: „czego brakuje” do naśnieżania – kroki samouczka i lista kontrolna panelu naśnieżania.
 * Każdy krok sprawdza układ ośrodka (i stan gry: plan naśnieżania, ratraki) i mówi, dlaczego jest
 * potrzebny. Kolejność jak przy prawdziwej budowie: woda → zbiornik → pompownia → prąd → rury
 * i armatki → plan → ratrak.
 */
import type { GameState } from './economy';
import type { Infra } from './operations';
import type { ResortLayout } from './resort';
import type { InfraKind, SnowmakingParams } from './snowmakingParams';

export type ChecklistId = 'water' | 'reservoir' | 'pump' | 'grid' | 'guns' | 'plan' | 'groomer';

export interface ChecklistStep {
  id: ChecklistId;
  title: string;
  done: boolean;
  /** Dlaczego to potrzebne (jedno, dwa zdania). */
  why: string;
  /** Co zrobić. */
  how: string;
  /** Gdzie to jest: karta palety budowy (rodzaj budynku albo narzędzie) albo przycisk panelu naśnieżania. */
  target: { kind: 'building'; infra: InfraKind } | { kind: 'tool'; tool: 'autoSnow' | 'ditch' } | { kind: 'panel'; button: 'plan' | 'groomer' };
}

export function snowChecklist(layout: ResortLayout, state: GameState | null, sp: SnowmakingParams, infra: Infra | null = null): ChecklistStep[] {
  const kinds = new Set((layout.buildings ?? []).map((b) => sp.buildings.find((t) => t.id === b.typeId)?.kind).filter((k): k is InfraKind => !!k));
  const has = (k: InfraKind) => kinds.has(k);
  const waterDone = infra && infra.sources.length ? infra.sources.some((s) => s.link && !s.problem) : has('intake') || has('well') || has('mains') || (layout.ditches ?? []).length > 0;
  const gunsDone = infra ? infra.guns.length > 0 : (layout.snowGuns ?? []).length > 0;
  const ops = state?.ops;
  return [
    {
      id: 'water',
      title: 'Źródło wody',
      done: waterDone,
      why: 'Armatka robi śnieg z wody – ok. 0,4–0,5 m³ wody na 1 m³ śniegu. Źródło napełnia zbiornik przez cały rok.',
      how: 'Postaw ujęcie na potoku (niebieska linia, najtańsza woda), studnię albo przyłącze wodociągu; połącz je ze zbiornikiem rurą zasilającą. Rów zbierający łapie deszcz i roztopy.',
      target: { kind: 'building', infra: 'intake' },
    },
    {
      id: 'reservoir',
      title: 'Zbiornik',
      done: has('reservoir'),
      why: 'Potok w zimie daje mało wody, a armatki w mroźną noc biorą jej dużo naraz. Zbiornik gromadzi wodę latem i jesienią na pierwsze zaśnieżenie.',
      how: 'Postaw zbiornik blisko źródła i tras. Większy = więcej śniegu na start sezonu.',
      target: { kind: 'building', infra: 'reservoir' },
    },
    {
      id: 'pump',
      title: 'Pompownia',
      done: has('pump'),
      why: 'Armatki potrzebują wody pod ciśnieniem 15–25 bar; pompownia tłoczy ją ze zbiornika pod górę do hydrantów.',
      how: 'Postaw pompownię przy zbiorniku. Jej wydajność (m³/h) ogranicza, ile armatek pracuje naraz.',
      target: { kind: 'building', infra: 'pump' },
    },
    {
      id: 'grid',
      title: 'Przyłącze prądu',
      done: has('grid'),
      why: 'Pompy i armatki biorą setki kilowatów; bez przyłącza nic nie ruszy. Moc przyłącza dzielą armatki, pompy i wyciągi.',
      how: 'Postaw przyłącze energetyczne (stację transformatorową) w pobliżu pompowni.',
      target: { kind: 'building', infra: 'grid' },
    },
    {
      id: 'guns',
      title: 'Naśnież trasę',
      done: gunsDone,
      why: 'Rurociąg z hydrantami prowadzi wodę wzdłuż trasy, armatki na hydrantach robią śnieg. Wykop tylko latem (V–X).',
      how: 'Wybierz „Naśnież trasę” i kliknij trasę – gra zaproponuje rury, hydranty i armatki połączone z pompownią. „Zbuduj”.',
      target: { kind: 'tool', tool: 'autoSnow' },
    },
    {
      id: 'plan',
      title: 'Plan naśnieżania',
      done: !!ops && Object.keys(ops.snowPlan).length > 0,
      why: 'Automat naśnieża od listopada do marca, gdy jest dość zimno – plan mówi, które trasy najpierw i do jakiej grubości bazy.',
      how: 'Otwórz panel „Naśnieżanie” → „Plan naśnieżania”, ustaw priorytety i docelową bazę, zapisz.',
      target: { kind: 'panel', button: 'plan' },
    },
    {
      id: 'groomer',
      title: 'Ratrak',
      done: !!ops && ops.groomers.length > 0,
      why: 'Śnieg z armatek leży w pryzmach – bez ratraka trasa jest zamknięta. Ratrak rozpycha pryzmy i ubija śnieg nocą.',
      how: 'Kup ratrak (nowy, używany albo w leasingu) w panelu „Naśnieżanie”. Garaż nie jest konieczny, ale bez niego ratrak psuje się częściej w mróz.',
      target: { kind: 'panel', button: 'groomer' },
    },
  ];
}
