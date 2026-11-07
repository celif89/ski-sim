/**
 * Etap 7b: karty obiektów – dane liczone w symulacji.
 * - suma zajętych miejsc na parkingach = samochody gości w danej chwili, zajęte ≤ pojemność
 *   (model dnia i symulacja gości letnich),
 * - karta wyciągu pokazuje status (czynny / przegląd), karta parkingu – zajęte, wolne, szczyt.
 */
import { describe, expect, it } from 'vitest';

import { parkingProfiles, objectCard, presenceProfile } from '../src/sim/objectCards';
import type { CardContext } from '../src/sim/objectCards';
import { processInspections, registerLift, scheduleInspection } from '../src/sim/inspections';
import { addDays } from '../src/sim/time';
import { gp, lp } from './guestFixture';
import { ep, plan, runSummerDay, sp, summerLayout, summerWorld } from './summerFixture';

describe('Parkingi w karcie (model dnia)', () => {
  it('suma zajętych = samochody obecnych gości (do pojemności), każdy parking ≤ pojemność', () => {
    const prof = presenceProfile(9.6, 0.9, 5, 1.3, 16);
    const caps = [300, 120, 80];
    for (const total of [100, 450, 900]) {
      const r = parkingProfiles(total, prof, caps);
      prof.forEach((p, k) => {
        const sum = r.cars.reduce((a, c) => a + c[k], 0);
        expect(sum).toBeCloseTo(Math.min(total * p, 500), 6);
        r.cars.forEach((c, i) => expect(c[k]).toBeLessThanOrEqual(caps[i] + 1e-9));
      });
      if (total * Math.max(...prof) > 500) expect(r.turnedAway).toBeGreaterThan(0);
    }
  });
});

describe('Karty obiektów latem', () => {
  const w = summerWorld(summerLayout());
  const p = plan([1800, 1200, 100, 0]);
  const day = runSummerDay(w, p);
  const stats = day.stats;
  const net = day.net;
  const ctx = (hour: number): CardContext => ({
    state: w.state,
    layout: w.layout,
    analysis: w.analysis,
    facts: w.facts,
    ep,
    lp,
    gp,
    hour,
    winter: null,
    summer: {
      plan: p,
      sf: w.sf,
      stats,
      poiOf: (kind, id) => (kind === 'lift' ? net.lifts.findIndex((l) => l.id === id) : kind === 'parking' ? net.parkings.findIndex((x) => x.id === id) : kind === 'food' ? net.foods.findIndex((x) => x.id === id) : kind === 'bike' ? net.bikeTrails.findIndex((x) => x.id === id) : -1),
    },
    ops: null,
    infra: null,
  });

  it('parking: zajęte ≤ pojemność, szczyt i wykres z symulacji gości', () => {
    const c = objectCard('base', 'B1', ctx(12))!;
    expect(c.kindLabel).toBe('parking');
    expect(c.chart).not.toBeNull();
    const cap = ep.buildings.find((b) => b.id === 'parking')!.cars;
    expect(Math.max(...c.chart!.values)).toBeLessThanOrEqual(cap);
    const row = (k: string) => c.rows.find((r) => r[0] === k)?.[1] ?? '';
    expect(row('miejsca razem')).toContain(String(cap));
    expect(row('szczyt dnia')).toMatch(/aut o \d\d:\d\d/);
  });

  it('kolej: czynna latem z liczbą pasażerów; w przeglądzie – status „przegląd”', () => {
    const c = objectCard('lift', 'W1', ctx(13))!;
    expect(c.status).toBe('czynny');
    expect(c.rows.find((r) => r[0].startsWith('dziś w górę'))?.[1]).toMatch(/^[1-9]/);
    expect(c.actions.some((a) => a.id === 'toggleRacks')).toBe(true);
    const today = { ...w.state.date };
    registerLift(w.state, 'W1', addDays(today, -30), sp);
    scheduleInspection(w.state, 'W1', today, today);
    processInspections(w.state, today, [{ id: 'W1', name: 'Kanapa', aerial: true, built: true }], ep, sp);
    const c2 = objectCard('lift', 'W1', ctx(13))!;
    expect(c2.status).toBe('przegląd');
  });

  it('restauracja i tor saneczkowy: liczby z dnia', () => {
    const food = objectCard('base', 'G1', ctx(13))!;
    expect(food.kindLabel).toBe('gastronomia');
    expect(Number(food.rows.find((r) => r[0] === 'obsłużeni dziś')?.[1].replace(/\s/g, ''))).toBeGreaterThan(0);
    const tor = objectCard('trail', 'Z1', ctx(13))!;
    expect(tor.kindLabel).toBe('tor saneczkowy');
    expect(tor.actions.some((a) => a.id === 'price')).toBe(true);
  });
});
