/**
 * Naśnieżanie i ratraki na mapie (etap 7): chmury śniegu pracujących armatek (z podglądu bieżącej
 * doby) i ratraki jadące po trasach w nocy (z planu nocy – zadania z godzinami), sztruks za nimi.
 * Tylko odczyt stanu gry – liczenie jest w src/sim/operations.ts.
 */
import type { CalendarDate } from '../sim';
import type { OpsSummary } from '../sim/economy';
import type { Infra } from '../sim/operations';
import type { ResortAnalysis } from '../sim/resort';
import { addDays, formatIsoDate } from '../sim/time';

export interface Plume {
  xM: number;
  yM: number;
  aimXM: number;
  aimYM: number;
  rateM3h: number;
  windFromDeg: number;
  windMs: number;
}

export interface GroomerSprite {
  xM: number;
  yM: number;
  headingRad: number;
  lightsOn: boolean;
}

interface Stamp {
  stamp(ax: number, ay: number, bx: number, by: number, widthM: number, strength: number): void;
}

const GROOMER_WIDTH_M = 5.5;

/** Chmury śniegu armatek pracujących w danej godzinie. */
export function plumesAt(summary: OpsSummary | null, infra: Infra | null, hour: number): Plume[] {
  if (!summary || !infra) return [];
  const h = Math.floor(hour);
  const out: Plume[] = [];
  for (const g of infra.guns) {
    const e = summary.gunHours[g.id]?.find((x) => x[0] === h);
    if (!e || e[1] <= 0) continue;
    out.push({ xM: g.xM, yM: g.yM, aimXM: g.aimXM, aimYM: g.aimYM, rateM3h: e[1], windFromDeg: e[2], windMs: e[3] });
  }
  return out;
}

/** Pozycja na osi trasy w odległości d od góry [m] i kierunek jazdy. */
function onAxis(axis: { xM: number; yM: number; distanceM: number }[], d: number): { xM: number; yM: number; dirX: number; dirY: number } {
  let i = 1;
  while (i < axis.length - 1 && axis[i].distanceM < d) i++;
  const a = axis[i - 1];
  const b = axis[i];
  const L = Math.max(1e-6, b.distanceM - a.distanceM);
  const t = Math.max(0, Math.min(1, (d - a.distanceM) / L));
  const dx = b.xM - a.xM;
  const dy = b.yM - a.yM;
  const n = Math.hypot(dx, dy) || 1;
  return { xM: a.xM + dx * t, yM: a.yM + dy * t, dirX: dx / n, dirY: dy / n };
}

export class OpsView {
  private readonly prev = new Map<string, { xM: number; yM: number }>();

  /**
   * Ratraki w godzinie `hour` dnia `date`: zadania nocy po dniu `date` (podgląd) i nocy po dniu
   * poprzednim (ostatnie zamknięte – godziny przesunięte o dobę).
   */
  groomers(date: CalendarDate, hour: number, today: OpsSummary | null, last: OpsSummary | null, analysis: ResortAnalysis, track: Stamp | null): GroomerSprite[] {
    const out: GroomerSprite[] = [];
    const seen = new Set<string>();
    const yesterday = formatIsoDate(addDays(date, -1));
    const sources: [OpsSummary | null, number][] = [
      [today, hour],
      [last && last.date === yesterday ? last : null, hour + 24],
    ];
    for (const [sum, h] of sources) {
      if (!sum) continue;
      for (const j of sum.jobs) {
        if (h < j.startH || h > j.endH || seen.has(j.groomerId)) continue;
        const pa = analysis.pistes.get(j.pisteId);
        if (!pa || pa.axis.length < 2) continue;
        const axis = pa.axis;
        const len = axis[axis.length - 1].distanceM;
        const meanW = axis.reduce((a, x) => a + x.widthM, 0) / axis.length;
        const passes = Math.max(1, Math.round(meanW / GROOMER_WIDTH_M));
        const f = (h - j.startH) / Math.max(1e-6, j.endH - j.startH);
        const total = f * passes;
        const k = Math.min(passes - 1, Math.floor(total));
        const along = total - k;
        // Przejazdy w górę i w dół na zmianę, każdy przesunięty w poprzek o szerokość ratraka.
        const d = k % 2 === 0 ? along * len : (1 - along) * len;
        const p = onAxis(axis, d);
        const off = (k - (passes - 1) / 2) * GROOMER_WIDTH_M;
        const x = p.xM - p.dirY * off;
        const y = p.yM + p.dirX * off;
        const sgn = k % 2 === 0 ? 1 : -1;
        out.push({ xM: x, yM: y, headingRad: Math.atan2(p.dirY * sgn, p.dirX * sgn), lightsOn: true });
        seen.add(j.groomerId);
        const q = this.prev.get(j.groomerId);
        if (track && q && Math.hypot(q.xM - x, q.yM - y) < 40) track.stamp(q.xM, q.yM, x, y, GROOMER_WIDTH_M, 1);
        this.prev.set(j.groomerId, { xM: x, yM: y });
      }
    }
    for (const id of [...this.prev.keys()]) if (!seen.has(id)) this.prev.delete(id);
    return out;
  }
}
