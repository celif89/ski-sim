/**
 * Etap 7c: doradca raportu – proste reguły z jednym zdaniem i przyciskiem akcji.
 */
import { describe, expect, it } from 'vitest';

import uiJson from '../data/ui.json';
import { advise, parseAdvisorParams } from '../src/render/ui/advisor';
import type { AdvisorInput } from '../src/render/ui/advisor';
import { autoScale, parseScaleParams } from '../src/render/ui/shell';
import { parseNoticeParams } from '../src/render/ui/notifications';

const p = parseAdvisorParams(uiJson);
const base: AdvisorInput = {
  guests: 1500,
  lifts: [{ name: 'W1', utilization: 0.5, waitMin: 2 }],
  parkingTurnedAway: 0,
  parkingFullAt: null,
  foodQueuePeak: 0,
  foodFull: false,
  hasFood: true,
  openPistes: 4,
  thinPistes: 0,
  closedDay: false,
  hasSnowmaking: false,
  leftNoLevel: 0,
  rating: 4.2,
  winter: true,
};

describe('Doradca', () => {
  it('bez problemów – jedna dobra rada', () => {
    const a = advise(base, p);
    expect(a).toHaveLength(1);
    expect(a[0].level).toBe('good');
  });

  it('wąskie gardło: wyciąg ponad próg obciążenia → rada z akcją „Zaplanuj wyciąg”', () => {
    const a = advise({ ...base, lifts: [{ name: 'K1', utilization: 0.94, waitMin: 9 }, { name: 'O1', utilization: 0.6, waitMin: 2 }] }, p);
    expect(a[0].id).toBe('bottleneck');
    expect(a[0].title).toContain('K1');
    expect(a[0].actions.some((x) => x.id === 'planLift' && x.primary)).toBe(true);
    expect(a[0].text.split('. ').length).toBeLessThanOrEqual(3);
  });

  it('pełny parking, kuchnia, brak śniegu, brak tras dla początkujących – po jednej radzie, najważniejsze najpierw', () => {
    const a = advise({ ...base, parkingTurnedAway: 230, parkingFullAt: '10:12', foodQueuePeak: 25, thinPistes: 3, leftNoLevel: 400 }, p);
    const ids = a.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['parking', 'kitchen', 'snow', 'beginners']));
    expect(new Set(ids).size).toBe(ids.length);
    for (let k = 1; k < a.length; k++) expect(a[k - 1].weight).toBeGreaterThanOrEqual(a[k].weight);
    for (const x of a) expect(x.actions.filter((y) => y.primary)).toHaveLength(1);
  });

  it('dzień zamknięty przez brak śniegu – najważniejsza rada; z naśnieżaniem – „Plan naśnieżania”', () => {
    const a = advise({ ...base, closedDay: true, guests: 0, hasSnowmaking: true }, p);
    expect(a[0].id).toBe('snow');
    expect(a[0].actions.find((x) => x.primary)?.id).toBe('snowPlan');
  });

  it('latem bez rad o śniegu', () => {
    const a = advise({ ...base, winter: false, thinPistes: 4 }, p);
    expect(a.some((x) => x.id === 'snow')).toBe(false);
  });
});

describe('Ustawienia interfejsu z data/ui.json', () => {
  it('skala automatyczna: 1366 px → ok. 0,75, 1920 → 1, 2560 → ok. 1,3', () => {
    const sp = parseScaleParams(uiJson);
    expect(autoScale(1366, 768, sp)).toBeCloseTo(0.75, 1);
    expect(autoScale(1920, 1080, sp)).toBe(1);
    expect(autoScale(2560, 1440, sp)).toBeCloseTo(1.3, 1);
  });

  it('powiadomienia: liczba widocznych i czas życia', () => {
    const np = parseNoticeParams(uiJson);
    expect(np.visible).toBe(3);
    expect(np.lifetimeS).toBeGreaterThan(0);
  });
});
