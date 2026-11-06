/**
 * Etap 7: naśnieżanie i ratraki – wydajność od temperatury mokrej, energia pompowania ρ·g·h/η,
 * zbiornik nigdy poniżej zera, limit mocy przyłącza, wyciągarka na stromych odcinkach, czas pracy
 * ratraka ze wzoru, pryzmy blokują otwarcie, mokry śnieg ubity przed mrozem daje lód, 30 zim z
 * naśnieżaniem i bez.
 */
import { describe, expect, it, vi } from 'vitest';
import climateJson from '../data/climate/pilsko.json';
import radiationJson from '../data/radiation.json';
import snowJson from '../data/snow.json';
import snowmakingJson from '../data/snowmaking.json';
import wxJson from '../data/weather-generator.json';
import { parseClimateProfile } from '../src/sim/climate';
import { seasonWeather } from '../src/sim/environment';
import type { GroomPiste, GroomerUnit } from '../src/sim/grooming';
import { groomMode, groomingHours, planNight } from '../src/sim/grooming';
import { parseRadiationParams } from '../src/sim/radiation';
import { SnowState, parseSnowParams } from '../src/sim/snow';
import type { GunFact } from '../src/sim/snowmaking';
import { depositSnow, gunProductionM3h, pumpEnergyKWh, pumpHeadM, runSnowmakingDay, technicalDensity, wetBulbC } from '../src/sim/snowmaking';
import { parseSnowmakingParams } from '../src/sim/snowmakingParams';
import { GROOM_HARD, GROOM_ICE, GROOM_WET, applySnowOps, emptyOps } from '../src/sim/snowOps';
import { SnowSeason, buildSolarCache, createSnowDomain } from '../src/sim/snowSeason';
import { TerrainGrid } from '../src/sim/terrainGrid';
import { computeSlopeAndAspect, prepareSolarTerrainSafe } from './snowmakingHelpers';
import type { HourlyWeather } from '../src/sim/weather';
import { hourlyAt, parseWeatherParams } from '../src/sim/weather';

vi.setConfig({ testTimeout: 300_000 });

const sp = parseSnowmakingParams(snowmakingJson);
const snowP = parseSnowParams(snowJson);
const fan = sp.guns.find((g) => g.id === 'fan')!;
const lance = sp.guns.find((g) => g.id === 'lance')!;

const weatherAt = (tC: number, rh = 80, windMs = 2): HourlyWeather => ({ temperatureC: tC, humidityPercent: rh, windMs, windFromDeg: 0, precipitationMm: 0, phase: 'none', cloudFraction: 0.3 });

function gun(id: string, typeId = 'fan', z = 900, headM = 200): GunFact {
  return { id, typeId, xM: 100, yM: 100, zM: z, headM, pisteId: 'T1', aimXM: 100, aimYM: 100, mode: 'auto' };
}

describe('Armatki i pompowanie', () => {
  it('temperatura mokra (Stull): niższa niż zwykła przy suchym powietrzu, równa przy nasyceniu', () => {
    expect(wetBulbC(-2, 99)).toBeCloseTo(-2, 0);
    expect(wetBulbC(0, 50)).toBeLessThan(-3);
    expect(wetBulbC(20, 50)).toBeCloseTo(13.7, 0); // tabela Stulla
  });

  it('powyżej progu temperatury mokrej produkcja = 0; im zimniej, tym większa', () => {
    expect(gunProductionM3h(fan.curveWetBulbC, fan.curveSnowM3h, -2)).toBe(0);
    expect(gunProductionM3h(fan.curveWetBulbC, fan.curveSnowM3h, 1)).toBe(0);
    expect(gunProductionM3h(lance.curveWetBulbC, lance.curveSnowM3h, -3.5)).toBe(0); // lanca potrzebuje zimniej
    let prev = 0;
    for (let tw = -2.6; tw >= -20; tw -= 0.5) {
      const q = gunProductionM3h(fan.curveWetBulbC, fan.curveSnowM3h, tw);
      expect(q).toBeGreaterThanOrEqual(prev);
      prev = q;
    }
    expect(prev).toBeCloseTo(90, 6); // duża armatka ok. 90 m³/h w mroźną noc (koncepcja)
    expect(technicalDensity(-2.5, -2.5, sp)).toBeCloseTo(500, 6);
    expect(technicalDensity(-12, -2.5, sp)).toBeCloseTo(400, 6);
  });

  it('energia pompowania = ρ·g·h·V / η; wysokość = różnica wysokości + straty w rurze + ciśnienie na dyszy', () => {
    const h = pumpHeadM(950, 750, 1000, 150, sp);
    expect(h).toBeCloseTo(200 + sp.pumping.pipeLossMPerKm + 150, 6);
    const kwh = pumpEnergyKWh(100, h, sp);
    expect(kwh).toBeCloseTo((1000 * 9.81 * h * 100) / sp.pumping.efficiency / 3.6e6, 9);
    // W dobie naśnieżania energia pomp = suma ρgh/η wody każdej armatki.
    const r = runSnowmakingDay(
      {
        weather: () => weatherAt(-8),
        guns: [gun('a', 'fan', 950, h)],
        needs: new Map([['T1', { needKg: 1e12, priority: 1, enabled: true, openDuringDay: false }]]),
        reservoirM3: 1e6,
        reservoirCapacityM3: 1e6,
        inflowM3h: 0,
        pumpCapacityM3h: 1000,
        gridLimitKw: 1e6,
        otherLoadKw: () => 0,
        energyPrice: () => 1,
        liftsOpenH: 8.5,
        liftsCloseH: 16,
        autoAllowed: true,
      },
      sp,
    );
    expect(r.pumpKWh).toBeCloseTo(pumpEnergyKWh(r.waterM3, h, sp), 6);
    expect(r.gunKWh).toBeCloseTo(r.snowM3 * fan.energyKWhPerM3, 6);
    expect(r.waterM3).toBeCloseTo((r.snowKg / 1000) * (1 + sp.snow.waterLossFraction), 6);
  });

  it('zbiornik nigdy poniżej zera; limit mocy przyłącza nigdy przekroczony (z wyciągami w dzień)', () => {
    const guns = Array.from({ length: 30 }, (_, i) => gun(`g${i}`, i % 3 ? 'fan' : 'lance', 900 + i * 5, 250));
    const r = runSnowmakingDay(
      {
        weather: (h) => weatherAt(-6 - Math.sin(h) * 4),
        guns,
        needs: new Map([['T1', { needKg: 1e12, priority: 1, enabled: true, openDuringDay: false }]]),
        reservoirM3: 300,
        reservoirCapacityM3: 2000,
        inflowM3h: 20,
        pumpCapacityM3h: 600,
        gridLimitKw: 700,
        otherLoadKw: (h) => (h >= 8 && h < 16 ? 250 : 0),
        energyPrice: () => 1,
        liftsOpenH: 8.5,
        liftsCloseH: 16,
        autoAllowed: true,
      },
      sp,
    );
    expect(r.snowM3).toBeGreaterThan(0);
    for (const h of r.hourly) {
      expect(h.reservoirM3).toBeGreaterThanOrEqual(0);
      expect(h.powerKw).toBeLessThanOrEqual(700 + 1e-9);
      expect(h.waterM3).toBeLessThanOrEqual(600 + 1e-9);
    }
    expect(r.reservoirEndM3).toBeGreaterThanOrEqual(0);
    // Woda zużyta nie większa niż było w zbiorniku + dopływ.
    expect(r.waterM3).toBeLessThanOrEqual(300 + r.intakeM3 + 1e-6);
  });

  it('plan: trasa bez potrzeby śniegu – automat stoi; ręcznie „on” – pracuje; w dzień na otwartej trasie – stoi', () => {
    const base = {
      weather: () => weatherAt(-10),
      reservoirM3: 1e5,
      reservoirCapacityM3: 1e5,
      inflowM3h: 0,
      pumpCapacityM3h: 1000,
      gridLimitKw: 1e5,
      otherLoadKw: () => 0,
      energyPrice: () => 1,
      liftsOpenH: 8.5,
      liftsCloseH: 16,
      autoAllowed: true,
    };
    const full = new Map([['T1', { needKg: 0, priority: 1, enabled: true, openDuringDay: false }]]);
    expect(runSnowmakingDay({ ...base, guns: [gun('a')], needs: full }, sp).snowM3).toBe(0);
    expect(runSnowmakingDay({ ...base, guns: [{ ...gun('a'), mode: 'on' }], needs: full }, sp).snowM3).toBeGreaterThan(0);
    const open = new Map([['T1', { needKg: 1e12, priority: 1, enabled: true, openDuringDay: true }]]);
    const r = runSnowmakingDay({ ...base, guns: [gun('a')], needs: open }, sp);
    expect(r.hourly.filter((h) => h.hour >= 9 && h.hour < 15).every((h) => h.running === 0)).toBe(true);
    expect(r.hourly.filter((h) => h.hour < 8 || h.hour >= 16).every((h) => h.running === 1)).toBe(true);
  });

  it('wiatr znosi śnieg poza trasę: przy silnym wietrze więcej śniegu ląduje poza trasą', () => {
    const grid = { widthCells: 60, heightCells: 60, cellSizeM: 10 };
    const mask = new Uint8Array(3600);
    for (let j = 0; j < 60; j++) for (let i = 25; i < 35; i++) mask[j * 60 + i] = 1; // trasa N–S, 100 m szerokości
    const g: GunFact = { ...gun('a'), xM: 300, yM: 300, aimXM: 300, aimYM: 300 };
    const dayAt = (windMs: number) => ({ guns: new Map([['a', { snowM3: 10, snowKg: 4500, waterM3: 5, gunKWh: 0, pumpKWh: 0, hoursRunning: 1, byHour: [{ hour: 1, kg: 4500, windFromDeg: 270, windMs, wetBulbC: -8 }], densitySum: 0, liquidSum: 0 }]]) });
    const calm = depositSnow(dayAt(0) as never, [g], grid, mask, sp);
    const windy = depositSnow(dayAt(30) as never, [g], grid, mask, sp);
    expect(calm.offPisteKg / (calm.onPisteKg + calm.offPisteKg)).toBeLessThan(0.05);
    expect(windy.offPisteKg / (windy.onPisteKg + windy.offPisteKg)).toBeGreaterThan(0.5);
    // Masa zachowana.
    let sum = 0;
    for (const v of calm.addSweMm) sum += v * 100;
    expect(sum).toBeCloseTo(4500, 3);
  });
});

describe('Ratraki', () => {
  const pisteBase = (o: Partial<GroomPiste> = {}): GroomPiste => {
    const cells = Array.from({ length: 200 }, (_, i) => i);
    const steep = new Uint8Array(200);
    for (let i = 80; i < 120; i++) steep[i] = 1;
    return {
      id: 'T1',
      group: 1,
      areaM2: 40 * 500,
      lengthM: 500,
      meanSlopePercent: 30,
      cells,
      steep,
      steepTops: [{ xM: 100, yM: 400 }],
      freshSnowCm: 0,
      pileM3: 0,
      priority: 1,
      enabled: true,
      groomerId: null,
      airTempC: () => -6,
      wetSnow: false,
      ...o,
    };
  };
  const std: GroomerUnit = { id: 'R1', type: sp.groomers.types.find((t) => t.id === 'standard')!, available: true };
  const winch: GroomerUnit = { id: 'R2', type: sp.groomers.types.find((t) => t.id === 'winch')!, available: true };

  it('czas pracy = powierzchnia / (szerokość × prędkość) × nachylenie × świeży opad + pryzmy', () => {
    const pi = pisteBase({ freshSnowCm: 15, pileM3: 800 });
    const g = sp.groomers;
    const expected = ((40 * 500) / (5.5 * std.type.speedKmh * 1000)) * (1 + g.slopeFactorPerPercent * (30 - g.slopeFactorFromPercent)) * (1 + g.freshFactorPerCm * (15 - g.freshThresholdCm)) + 800 / g.pilePushM3h;
    expect(groomingHours(pi, std.type, true, sp)).toBeCloseTo(expected, 9);
    const r = planNight([pi], [winch], [{ xM: 100, yM: 300, rangeM: 1000 }], sp);
    expect(r.jobs[0].endH - r.jobs[0].startH).toBeCloseTo(groomingHours(pi, winch.type, true, sp), 9);
    expect(r.fuelL).toBeCloseTo((r.jobs[0].endH - r.jobs[0].startH) * winch.type.fuelLph, 9);
  });

  it('stromy odcinek bez ratraka z wyciągarką (albo bez kotwy) zostaje nieratrakowany', () => {
    const pi = pisteBase();
    const noWinch = planNight([pi], [std], [{ xM: 100, yM: 300, rangeM: 1000 }], sp);
    expect(noWinch.steepSkipped).toEqual(['T1']);
    const done = new Set(noWinch.jobs[0].groomedCells);
    for (let i = 80; i < 120; i++) expect(done.has(i)).toBe(false);
    expect(done.size).toBe(160);
    const noAnchor = planNight([pi], [winch], [], sp);
    expect(noAnchor.steepSkipped).toEqual(['T1']);
    const ok = planNight([pi], [winch], [{ xM: 100, yM: 300, rangeM: 1000 }], sp);
    expect(ok.steepSkipped).toEqual([]);
    expect(ok.jobs[0].groomedCells).toHaveLength(200);
  });

  it('nie zdążą do rana – część tras zostaje nieratrakowana; awaria = mniej ratraków', () => {
    const big = Array.from({ length: 8 }, (_, i) => pisteBase({ id: `T${i}`, group: i + 1, areaM2: 120_000, steep: new Uint8Array(200), steepTops: [] }));
    const r = planNight(big, [std], [], sp);
    expect(r.unfinished.length).toBeGreaterThan(0);
    for (const j of r.jobs) expect(j.endH).toBeLessThanOrEqual(sp.groomers.windowStartH + sp.groomers.maxShiftH + 1e-9);
    const two = planNight(big, [std, { ...std, id: 'R3' }], [], sp);
    expect(two.unfinished.length).toBeLessThan(r.unfinished.length);
  });

  it('mróz – twarda trasa, odwilż – mokra, mokry śnieg ubity przed mrozem – lód', () => {
    expect(groomMode(-6, -8, false, sp)).toBe(GROOM_HARD);
    expect(groomMode(3, 2, false, sp)).toBe(GROOM_WET);
    expect(groomMode(2, -6, false, sp)).toBe(GROOM_ICE);
    expect(groomMode(-1, -6, true, sp)).toBe(GROOM_ICE);
    // W modelu śniegu: lód na powierzchni (stan „zlodzony”), woda zamarznięta.
    const s = new SnowState(4);
    const ops = emptyOps();
    ops.addSweMm = Float32Array.from([60, 60, 60, 60]);
    ops.addLiquidFraction = 0.08;
    applySnowOps(s, ops, snowP, sp);
    expect(s.topLiquid[0]).toBeGreaterThan(0);
    const groom = emptyOps();
    groom.groomGroup = Int16Array.from([1, 1, 2, 2]);
    groom.groomMode = Uint8Array.from([GROOM_ICE, GROOM_ICE, GROOM_WET, GROOM_WET]);
    applySnowOps(s, groom, snowP, sp);
    expect(s.topIce[0]).toBe(1);
    expect(s.topLiquid[0]).toBe(0);
    expect(s.topIce[2]).toBe(0);
    expect(s.topLiquid[2]).toBeGreaterThan(0);
  });
});

describe('Pryzmy', () => {
  it('śnieg z armatek leży w pryzmach; rozepchnięcie ratrakiem rozkłada go równo po trasie (masa zachowana)', () => {
    const s = new SnowState(10);
    const ops = emptyOps();
    ops.addSweMm = new Float32Array(10);
    ops.addSweMm[3] = 200;
    applySnowOps(s, ops, snowP, sp);
    expect(s.pileMm[3]).toBeCloseTo(200, 3);
    expect(s.techMm[3]).toBeCloseTo(200, 3);
    const total = () => Array.from({ length: 10 }, (_, k) => s.totalWater(k)).reduce((a, b) => a + b, 0);
    const before = total();
    const groom = emptyOps();
    groom.groomGroup = new Int16Array(10).fill(1);
    groom.groomMode = new Uint8Array(10).fill(GROOM_HARD);
    applySnowOps(s, groom, snowP, sp);
    expect(total()).toBeCloseTo(before, 3);
    for (let k = 0; k < 10; k++) {
      expect(s.pileMm[k]).toBe(0);
      expect(s.totalWater(k)).toBeCloseTo(20, 3);
    }
  });
});

describe('30 zim: z naśnieżaniem i bez', () => {
  it('z naśnieżaniem średnio więcej dni otwartych; różnica największa w słabych zimach', () => {
    const res = thirtyWinters();
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const order = res.natural.map((_, i) => i).sort((a, b) => res.natural[a] - res.natural[b]);
    const third = Math.floor(order.length / 3);
    const weak = order.slice(0, third);
    const strong = order.slice(-third);
    const gain = (idx: number[]) => mean(idx.map((i) => res.made[i] - res.natural[i]));
    console.log(`30 zim: bez naśnieżania średnio ${mean(res.natural).toFixed(1)} dni otwartych, z naśnieżaniem ${mean(res.made).toFixed(1)}; zysk w słabych zimach ${gain(weak).toFixed(1)} dni, w mocnych ${gain(strong).toFixed(1)} dni`);
    expect(mean(res.made)).toBeGreaterThan(mean(res.natural) + 10);
    for (let i = 0; i < res.made.length; i++) expect(res.made[i]).toBeGreaterThanOrEqual(res.natural[i]);
    expect(gain(weak)).toBeGreaterThan(gain(strong));
  });
});

/**
 * Mały stok (300 × 600 m, 25 %, 820–970 m n.p.m.), trasa szerokości 60 m wzdłuż spadku, armatki
 * śmigłowe co 60 m, ratrak co noc. Dzień otwarty: 1 XII – 31 III, średnia baza na trasie ≥ 25 cm.
 */
function thirtyWinters(): { natural: number[]; made: number[] } {
  const W = 30;
  const H = 60;
  const z = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) z[j * W + i] = 970 - j * 10 * 0.25;
  const grid = new TerrainGrid(W, H, 10, z);
  computeSlopeAndAspect(grid);
  const profile = parseClimateProfile(climateJson);
  const wp = parseWeatherParams(wxJson);
  const rp = parseRadiationParams(radiationJson);
  const location = { latDeg: 49.54, lonDeg: 19.32, timeZone: { standardOffsetHours: 1, euDaylightSaving: true } };
  const solarTerrain = prepareSolarTerrainSafe(grid);
  const piste: number[] = [];
  for (let j = 2; j < H - 2; j++) for (let i = 12; i < 18; i++) piste.push(j * W + i);
  const mask = new Uint8Array(W * H);
  for (const k of piste) mask[k] = 1;
  const guns: GunFact[] = [];
  for (let y = 40; y < 580; y += 60) {
    const zz = grid.sampleElevationM(140, y);
    guns.push({ id: `g${y}`, typeId: 'fan', xM: 140, yM: y, zM: zz, headM: pumpHeadM(zz, 820, y + 100, fan.nozzleHeadM, sp), pisteId: 'T1', aimXM: 150, aimYM: y, mode: 'auto' });
  }
  const natural: number[] = [];
  const made: number[] = [];
  const domain = createSnowDomain(grid, new Float32Array(W * H), new Float32Array(W * H), snowP);
  for (let y = 0; y < 30; y++) {
    const startYear = 2026 + y;
    const weather = seasonWeather(profile, wp, 20261105, startYear);
    const days = 212; // 1 X – 30 IV
    const solar = buildSolarCache(solarTerrain, weather[0].date, days + 1, location, rp, snowP);
    for (const withSnowmaking of [false, true]) {
      const season = new SnowSeason({ domain, solar, weather, profile, weatherParams: wp, snowParams: snowP, radiationParams: rp, location });
      let reservoir = 30_000;
      let open = 0;
      for (let d = 0; d < days; d++) {
        season.stepDay();
        const st = season.state;
        const date = weather[d].date;
        if (withSnowmaking && (date.month >= 11 || date.month <= 3)) {
          let base = 0;
          for (const k of piste) base += (st.totalWater(k) / 420) * 100;
          base /= piste.length;
          const r = runSnowmakingDay(
            {
              weather: (h, zz) => hourlyAt(weather[Math.max(0, d - 1)], weather[d], weather[d + 1], h, zz, profile, wp, location),
              guns,
              needs: new Map([['T1', { needKg: (Math.max(0, 50 - base) / 100) * 420 * piste.length * 100, priority: 1, enabled: true, openDuringDay: false }]]),
              reservoirM3: reservoir,
              reservoirCapacityM3: 30_000,
              inflowM3h: 20,
              pumpCapacityM3h: 300,
              gridLimitKw: 1000,
              otherLoadKw: () => 0,
              energyPrice: () => 1,
              liftsOpenH: 8.5,
              liftsCloseH: 16,
              autoAllowed: true,
            },
            sp,
          );
          reservoir = r.reservoirEndM3;
          const ops = emptyOps();
          if (r.snowKg > 0) {
            ops.addSweMm = depositSnow(r, guns, grid, mask, sp).addSweMm;
            ops.addDensityKgM3 = r.meanDensityKgM3;
          }
          ops.groomGroup = new Int16Array(W * H);
          ops.groomMode = new Uint8Array(W * H);
          for (const k of piste) {
            ops.groomGroup[k] = 1;
            ops.groomMode[k] = GROOM_HARD;
          }
          applySnowOps(st, ops, snowP, sp);
        }
        if (date.month === 12 || date.month <= 3) {
          let base = 0;
          for (const k of piste) base += (st.totalWater(k) / 420) * 100;
          if (base / piste.length >= 25) open++;
        }
      }
      (withSnowmaking ? made : natural).push(open);
    }
  }
  return { natural, made };
}
