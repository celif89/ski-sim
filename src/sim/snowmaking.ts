/**
 * Naśnieżanie (etap 7): temperatura termometru mokrego, rurociągi z hydrantami, armatki (wydajność
 * z krzywej od temperatury mokrej, woda, energia), pompowanie (ρ·g·h/η z różnicy wysokości pompowni
 * i hydrantu, straty w rurach, ciśnienie na dyszy), zbiornik i ujęcie z potoku, limit mocy
 * przyłącza, taryfa nocna, plan (docelowa baza i priorytety tras) z automatem i ręcznym sterowaniem,
 * znoszenie śniegu przez wiatr. Godzina po godzinie; wynik – śnieg w komórkach (pryzmy) i bilans.
 */
import type { PointM } from './lifts';
import type { SnowmakingParams } from './snowmakingParams';
import { gunTypeById } from './snowmakingParams';
import type { HourlyWeather } from './weather';

// ------------------------------------------------------------------ fizyka

/** Temperatura termometru mokrego [°C] z temperatury [°C] i wilgotności względnej [%] (Stull 2011). */
export function wetBulbC(tC: number, rhPercent: number): number {
  const rh = Math.min(99, Math.max(5, rhPercent));
  return (
    tC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) -
    4.686035
  );
}

/** Wydajność armatki [m³ śniegu/h] przy temperaturze mokrej (krzywa z pliku; 0 powyżej progu). */
export function gunProductionM3h(curveT: number[], curveQ: number[], wetBulb: number): number {
  if (wetBulb > curveT[0]) return 0;
  if (wetBulb <= curveT[curveT.length - 1]) return curveQ[curveQ.length - 1];
  for (let i = 1; i < curveT.length; i++) {
    if (wetBulb >= curveT[i]) {
      const f = (curveT[i - 1] - wetBulb) / (curveT[i - 1] - curveT[i]);
      return curveQ[i - 1] + f * (curveQ[i] - curveQ[i - 1]);
    }
  }
  return curveQ[curveQ.length - 1];
}

/** Gęstość śniegu technicznego [kg/m³]: mokry i gęsty przy progu, suchszy w mróz. */
export function technicalDensity(wetBulb: number, startC: number, p: SnowmakingParams): number {
  const s = p.snow;
  const f = Math.min(1, Math.max(0, (startC - wetBulb) / Math.max(0.1, startC - s.densityColdWetBulbC)));
  return s.densityAtStartKgM3 + f * (s.densityColdKgM3 - s.densityAtStartKgM3);
}

/** Udział wody ciekłej w świeżym śniegu technicznym (mokry przy wyższej temperaturze). */
export function technicalLiquidFraction(wetBulb: number, startC: number, p: SnowmakingParams): number {
  const s = p.snow;
  const f = Math.min(1, Math.max(0, (startC - wetBulb) / Math.max(0.1, startC - s.densityColdWetBulbC)));
  return s.liquidFractionAtStart * (1 - f);
}

/** Wysokość podnoszenia [m]: różnica wysokości hydrantu i pompowni + straty w rurach + ciśnienie na dyszy. */
export function pumpHeadM(hydrantZ: number, pumpZ: number, pipeLengthM: number, nozzleHeadM: number, p: SnowmakingParams): number {
  return Math.max(0, hydrantZ - pumpZ + (p.pumping.pipeLossMPerKm * pipeLengthM) / 1000 + nozzleHeadM);
}

/** Energia pompowania [kWh] objętości wody [m³] na wysokość [m]: ρ·g·h·V / η. */
export function pumpEnergyKWh(waterM3: number, headM: number, p: SnowmakingParams): number {
  return (p.pumping.waterDensityKgM3 * p.pumping.gravityMs2 * headM * waterM3) / p.pumping.efficiency / 3.6e6;
}

// ------------------------------------------------------------------ rurociągi i hydranty

export interface PipelineDesign {
  id: string;
  name: string;
  points: PointM[];
  /** Etap 6b: rura zasilająca (źródło wody → zbiornik) – bez hydrantów, poza siecią pompowni. */
  supply?: boolean;
  /** Etap 7c (edycja, tylko widok): punkty kontrolne linii i gładkość łuku (0 – łamana, 1 – łuk); `points` to gęsty przebieg z nich liczony. */
  ctrl?: PointM[];
  smooth?: number;
  /** Etap 7f: hydranty dopiero od tej odległości od początku [m] (odcinek dojściowy od pompowni bez hydrantów). */
  hydrantsFromM?: number;
}

export interface SnowGunDesign {
  id: string;
  typeId: string;
  pipelineId: string;
  /** Numer hydrantu na rurociągu (od początku). */
  hydrant: number;
}

export interface Hydrant {
  pipelineId: string;
  index: number;
  xM: number;
  yM: number;
  /** Odległość od początku tego rurociągu [m]. */
  alongM: number;
}

export function polylineLengthM(points: PointM[]): number {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i].xM - points[i - 1].xM, points[i].yM - points[i - 1].yM);
  return L;
}

function pointAt(points: PointM[], d: number): PointM {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.xM - a.xM, b.yM - a.yM);
    if (acc + seg >= d || i === points.length - 1) {
      const t = seg > 0 ? Math.min(1, Math.max(0, (d - acc) / seg)) : 0;
      return { xM: a.xM + (b.xM - a.xM) * t, yM: a.yM + (b.yM - a.yM) * t };
    }
    acc += seg;
  }
  return points[points.length - 1];
}

/**
 * Hydranty co `hydrantSpacingM` wzdłuż rurociągu (pierwszy w połowie odstępu od początku, a przy
 * odcinku dojściowym – w połowie odstępu od `hydrantsFromM`).
 */
export function pipelineHydrants(pipe: PipelineDesign, p: SnowmakingParams): Hydrant[] {
  if (pipe.supply) return [];
  const L = polylineLengthM(pipe.points);
  const sp = p.pipe.hydrantSpacingM;
  const out: Hydrant[] = [];
  for (let d = (pipe.hydrantsFromM ?? 0) + sp / 2, i = 0; d <= L + 1e-6; d += sp, i++) {
    const q = pointAt(pipe.points, d);
    out.push({ pipelineId: pipe.id, index: i, xM: q.xM, yM: q.yM, alongM: d });
  }
  return out;
}

/** Koszt i czas budowy rurociągu (z hydrantami). */
export function pipelineCost(pipe: PipelineDesign, p: SnowmakingParams): { costPln: number; buildDays: number; lengthM: number; hydrants: number } {
  const L = polylineLengthM(pipe.points);
  const n = pipelineHydrants(pipe, p).length;
  return { costPln: L * (pipe.supply ? p.pipe.supplyCostPlnPerM : p.pipe.costPlnPerM) + n * p.pipe.hydrantCostPln, buildDays: Math.max(1, Math.ceil(L / p.pipe.metersPerDay)), lengthM: L, hydrants: n };
}

/**
 * Sieć wodna: rurociągi połączone z pompownią (początek blisko pompowni albo blisko innego połączonego
 * rurociągu). Zwraca odległość rurą od pompowni do początku każdego połączonego rurociągu.
 */
export function connectPipelines(pipes: PipelineDesign[], pump: PointM | null, p: SnowmakingParams): Map<string, number> {
  const out = new Map<string, number>();
  if (!pump) return out;
  const r = p.pipe.connectRadiusM;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pipe of pipes) {
      if (out.has(pipe.id) || pipe.points.length < 2 || pipe.supply) continue;
      const start = pipe.points[0];
      if (Math.hypot(start.xM - pump.xM, start.yM - pump.yM) <= r) {
        out.set(pipe.id, Math.hypot(start.xM - pump.xM, start.yM - pump.yM));
        changed = true;
        continue;
      }
      for (const other of pipes) {
        if (other.supply) continue;
        const base = out.get(other.id);
        if (base === undefined) continue;
        // Najbliższy punkt innego rurociągu (wierzchołki i co 10 m).
        const L = polylineLengthM(other.points);
        let best = Infinity;
        let bestAlong = 0;
        for (let d = 0; d <= L; d += 10) {
          const q = pointAt(other.points, d);
          const dist = Math.hypot(q.xM - start.xM, q.yM - start.yM);
          if (dist < best) {
            best = dist;
            bestAlong = d;
          }
        }
        if (best <= r) {
          out.set(pipe.id, base + bestAlong + best);
          changed = true;
          break;
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ dzień naśnieżania

export type GunMode = 'auto' | 'on' | 'off';

export interface GunFact {
  id: string;
  typeId: string;
  xM: number;
  yM: number;
  zM: number;
  /** Wysokość podnoszenia od pompowni do dyszy [m] (z dyszą i stratami). */
  headM: number;
  /** Trasa, którą naśnieża (najbliższa) – do planu; null – żadna. */
  pisteId: string | null;
  /** Punkt, w który celuje (oś trasy); bez trasy – sama armatka. */
  aimXM: number;
  aimYM: number;
  mode: GunMode;
}

export interface PisteSnowNeed {
  /** Brakujący śnieg do docelowej bazy [kg]. */
  needKg: number;
  priority: number;
  enabled: boolean;
  /** Trasa otwarta w dzień (wtedy armatki na niej stoją w godzinach pracy wyciągów). */
  openDuringDay: boolean;
}

export interface SnowmakingDayInput {
  /** Pogoda w godzinie h (0–24) na wysokości z. */
  weather(hour: number, zM: number): HourlyWeather;
  guns: GunFact[];
  needs: Map<string, PisteSnowNeed>;
  reservoirM3: number;
  reservoirCapacityM3: number;
  /** Dopływ ze źródeł bezpłatnych (potok, studnie, zlewnia) [m³/h] tego dnia. */
  inflowM3h: number;
  /** Zakup z wodociągu [m³/h], gdy zbiornik nie jest pełny (etap 6b; brak – 0). */
  mainsM3h?: number;
  pumpCapacityM3h: number;
  gridLimitKw: number;
  /** Inne odbiory mocy w godzinie (wyciągi w godzinach pracy) [kW]. */
  otherLoadKw(hour: number): number;
  /** Cena energii w godzinie [zł/kWh] (taryfa nocna). */
  energyPrice(hour: number): number;
  liftsOpenH: number;
  liftsCloseH: number;
  /** Automat pracuje w tym okresie (miesiące); ręczne „on” – zawsze. */
  autoAllowed: boolean;
}

export interface GunDay {
  snowM3: number;
  snowKg: number;
  waterM3: number;
  gunKWh: number;
  pumpKWh: number;
  hoursRunning: number;
  /** Śnieg wg godzin (do rozłożenia z wiatrem): [kg, kierunek wiatru (skąd) °, prędkość m/s]. */
  byHour: { hour: number; kg: number; windFromDeg: number; windMs: number; wetBulbC: number }[];
  densitySum: number;
  liquidSum: number;
}

export interface SnowmakingDayResult {
  guns: Map<string, GunDay>;
  hourly: { hour: number; powerKw: number; gunKw: number; pumpKw: number; otherKw: number; waterM3: number; running: number; reservoirM3: number }[];
  snowM3: number;
  snowKg: number;
  waterM3: number;
  energyKWh: number;
  pumpKWh: number;
  gunKWh: number;
  energyCostPln: number;
  intakeM3: number;
  /** Woda kupiona z wodociągu [m³]. */
  mainsM3: number;
  reservoirEndM3: number;
  maxPowerKw: number;
  meanDensityKgM3: number;
  meanLiquidFraction: number;
}

/**
 * Doba naśnieżania (godziny 0–23): w każdej godzinie dopływ do zbiornika, potem armatki według
 * priorytetów tras (automat: gdy trasie brakuje śniegu do celu i temperatura mokra poniżej progu;
 * ręcznie „on” – zawsze, gdy jest zimno; „off” – nigdy), dopóki starcza wody (pompownia, zbiornik)
 * i mocy przyłącza. Zbiornik nigdy poniżej zera, moc nigdy ponad limit.
 */
export function runSnowmakingDay(input: SnowmakingDayInput, p: SnowmakingParams): SnowmakingDayResult {
  const guns = new Map<string, GunDay>();
  const hourly: SnowmakingDayResult['hourly'] = [];
  let reservoir = Math.max(0, Math.min(input.reservoirCapacityM3, input.reservoirM3));
  let intake = 0;
  let mains = 0;
  let energyCost = 0;
  let maxPower = 0;
  const needLeft = new Map<string, number>();
  for (const [id, n] of input.needs) needLeft.set(id, n.enabled ? n.needKg : 0);
  for (let h = 0; h < 24; h++) {
    // Dopływ z potoku do zbiornika (nadmiar przelewa się).
    const inflow = Math.min(input.inflowM3h, input.reservoirCapacityM3 - reservoir);
    reservoir += Math.max(0, inflow);
    intake += Math.max(0, inflow);
    // Wodociąg dolewa, dopóki zbiornik nie jest pełny (płatne za m³).
    const bought = Math.max(0, Math.min(input.mainsM3h ?? 0, input.reservoirCapacityM3 - reservoir));
    reservoir += bought;
    mains += bought;
    const other = Math.max(0, input.otherLoadKw(h));
    const lifts = h + 0.5 >= input.liftsOpenH && h + 0.5 < input.liftsCloseH;
    const cand: { g: GunFact; q: number; tw: number; w: HourlyWeather; prio: number; waterM3: number; gunKw: number; pumpKw: number; density: number; liquid: number }[] = [];
    for (const g of input.guns) {
      if (g.mode === 'off') continue;
      const need = g.pisteId ? input.needs.get(g.pisteId) : undefined;
      if (g.mode === 'auto') {
        if (!input.autoAllowed || !need || !need.enabled || (needLeft.get(g.pisteId!) ?? 0) <= 0) continue;
      }
      if (lifts && need?.openDuringDay) continue; // na otwartej trasie w godzinach pracy wyciągów nie naśnieżamy
      const t = gunTypeById(p, g.typeId);
      const w = input.weather(h + 0.5, g.zM);
      const tw = wetBulbC(w.temperatureC, w.humidityPercent);
      const q = gunProductionM3h(t.curveWetBulbC, t.curveSnowM3h, tw);
      if (q <= 0) continue;
      const density = technicalDensity(tw, t.curveWetBulbC[0], p);
      const waterM3 = ((q * density) / 1000) * (1 + p.snow.waterLossFraction);
      cand.push({
        g,
        q,
        tw,
        w,
        prio: g.mode === 'on' ? 0 : (need?.priority ?? 9),
        waterM3,
        gunKw: t.energyKWhPerM3 * q,
        pumpKw: pumpEnergyKWh(waterM3, g.headM, p),
        density,
        liquid: technicalLiquidFraction(tw, t.curveWetBulbC[0], p),
      });
    }
    // Najpierw ważniejsze trasy, potem najzimniejsze miejsca (najwięcej śniegu z m³ wody i kWh).
    cand.sort((a, b) => a.prio - b.prio || b.q - a.q || (a.g.id < b.g.id ? -1 : 1));
    let water = 0;
    let gunKw = 0;
    let pumpKw = 0;
    let running = 0;
    for (const c of cand) {
      if (c.g.mode === 'auto' && (needLeft.get(c.g.pisteId!) ?? 0) <= 0) continue;
      if (water + c.waterM3 > input.pumpCapacityM3h + 1e-9) continue;
      if (water + c.waterM3 > reservoir + 1e-9) continue;
      if (other + gunKw + pumpKw + c.gunKw + c.pumpKw > input.gridLimitKw + 1e-9) continue;
      water += c.waterM3;
      gunKw += c.gunKw;
      pumpKw += c.pumpKw;
      running++;
      const kg = c.q * c.density;
      if (c.g.pisteId && needLeft.has(c.g.pisteId)) needLeft.set(c.g.pisteId, needLeft.get(c.g.pisteId)! - kg);
      let gd = guns.get(c.g.id);
      if (!gd) {
        gd = { snowM3: 0, snowKg: 0, waterM3: 0, gunKWh: 0, pumpKWh: 0, hoursRunning: 0, byHour: [], densitySum: 0, liquidSum: 0 };
        guns.set(c.g.id, gd);
      }
      gd.snowM3 += c.q;
      gd.snowKg += kg;
      gd.waterM3 += c.waterM3;
      gd.gunKWh += c.gunKw;
      gd.pumpKWh += c.pumpKw;
      gd.hoursRunning++;
      gd.densitySum += c.density * kg;
      gd.liquidSum += c.liquid * kg;
      gd.byHour.push({ hour: h, kg, windFromDeg: c.w.windFromDeg, windMs: c.w.windMs, wetBulbC: c.tw });
    }
    reservoir = Math.max(0, reservoir - water);
    const power = other + gunKw + pumpKw;
    maxPower = Math.max(maxPower, power);
    energyCost += (gunKw + pumpKw) * input.energyPrice(h);
    hourly.push({ hour: h, powerKw: power, gunKw, pumpKw, otherKw: other, waterM3: water, running, reservoirM3: reservoir });
  }
  let snowM3 = 0;
  let snowKg = 0;
  let waterM3 = 0;
  let pumpKWh = 0;
  let gunKWh = 0;
  let dSum = 0;
  let lSum = 0;
  for (const g of guns.values()) {
    snowM3 += g.snowM3;
    snowKg += g.snowKg;
    waterM3 += g.waterM3;
    pumpKWh += g.pumpKWh;
    gunKWh += g.gunKWh;
    dSum += g.densitySum;
    lSum += g.liquidSum;
  }
  return {
    guns,
    hourly,
    snowM3,
    snowKg,
    waterM3,
    energyKWh: pumpKWh + gunKWh,
    pumpKWh,
    gunKWh,
    energyCostPln: energyCost,
    intakeM3: intake,
    mainsM3: mains,
    reservoirEndM3: reservoir,
    maxPowerKw: maxPower,
    meanDensityKgM3: snowKg > 0 ? dSum / snowKg : 450,
    meanLiquidFraction: snowKg > 0 ? lSum / snowKg : 0,
  };
}

/** Cena energii w godzinie: taryfa nocna tańsza. */
export function tariffPrice(hour: number, dayPricePln: number, p: SnowmakingParams): number {
  const e = p.energy;
  const h = ((hour % 24) + 24) % 24;
  const night = e.nightStartH > e.nightEndH ? h >= e.nightStartH || h < e.nightEndH : h >= e.nightStartH && h < e.nightEndH;
  return night ? dayPricePln * e.nightTariffFactor : dayPricePln;
}

/** Dopływ z ujęcia [m³/h] w danym miesiącu przy opadzie z ostatnich dni (sucha jesień – mniej). */
export function intakeRateM3h(capacityM3h: number, month: number, precipLastMm: number, p: SnowmakingParams): number {
  const w = p.water;
  const fill = month >= w.fillMonthsFrom && month <= w.fillMonthsTo;
  const season = fill ? 1 : w.intakeWinterFactor;
  const normal = w.normalPrecipMmPerDay * w.precipWindowDays;
  const dry = Math.min(1.3, Math.max(w.intakeDryFactorMin, normal > 0 ? precipLastMm / normal : 1));
  return capacityM3h * season * dry;
}

/**
 * Rozłożenie śniegu z armatek na komórki: plama o promieniu throwSpreadM w odległości (zasięg rzutu
 * + znoszenie z wiatrem) w kierunku wiatru. Zwraca śnieg w komórkach [mm wody] i ile spadło poza trasy.
 */
export function depositSnow(
  result: SnowmakingDayResult,
  guns: GunFact[],
  grid: { widthCells: number; heightCells: number; cellSizeM: number },
  pisteMask: Uint8Array | null,
  p: SnowmakingParams,
): { addSweMm: Float32Array; onPisteKg: number; offPisteKg: number } {
  const n = grid.widthCells * grid.heightCells;
  const add = new Float32Array(n);
  const cs = grid.cellSizeM;
  const R = p.snow.throwSpreadM;
  let on = 0;
  let off = 0;
  const byId = new Map(guns.map((g) => [g.id, g]));
  for (const [id, gd] of result.guns) {
    const g = byId.get(id);
    if (!g) continue;
    const t = gunTypeById(p, g.typeId);
    for (const h of gd.byHour) {
      // Armatka celuje w oś trasy (nie dalej niż zasięg rzutu), wiatr znosi plamę z wiatrem.
      const ax = g.aimXM - g.xM;
      const ay = g.aimYM - g.yM;
      const al = Math.hypot(ax, ay);
      const reach = Math.min(al, t.throwM);
      const az = ((h.windFromDeg + 180) * Math.PI) / 180;
      const drift = p.snow.driftPerMs * h.windMs;
      const cx = g.xM + (al > 0 ? (ax / al) * reach : 0) + Math.sin(az) * drift;
      const cy = g.yM + (al > 0 ? (ay / al) * reach : 0) - Math.cos(az) * drift;
      const cells: number[] = [];
      const i0 = Math.max(0, Math.floor((cx - R) / cs));
      const i1 = Math.min(grid.widthCells - 1, Math.floor((cx + R) / cs));
      const j0 = Math.max(0, Math.floor((cy - R) / cs));
      const j1 = Math.min(grid.heightCells - 1, Math.floor((cy + R) / cs));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * cs;
          const y = (j + 0.5) * cs;
          if (Math.hypot(x - cx, y - cy) <= R) cells.push(j * grid.widthCells + i);
        }
      }
      if (!cells.length) {
        off += h.kg;
        continue;
      }
      const perCellMm = h.kg / cells.length / (cs * cs);
      for (const k of cells) {
        add[k] += perCellMm;
        if (!pisteMask || pisteMask[k]) on += h.kg / cells.length;
        else off += h.kg / cells.length;
      }
    }
  }
  return { addSweMm: add, onPisteKg: on, offPisteKg: off };
}
