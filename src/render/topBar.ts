/**
 * Górny pasek (etap 7c, makieta docs/ui/ui-1-mapa.html): ciemny półprzezroczysty pasek na całą
 * szerokość.
 *  – lewa część: nazwa ośrodka i sezon, saldo ze zmianą, goście dziś i na stoku, reputacja
 *    z gwiazdkami, cena karnetu (kliknięcia otwierają finanse, gości i cennik),
 *  – środek: data i zegar (kliknięcie – kalendarz, suwak godziny, „przewiń sezon”, czas 1:1),
 *    przyciski czasu (pauza, ×1, ×5, ×20),
 *  – prawa część: pogoda na górze i na dole, baza śniegu, wiatr, prognoza na 4 dni (dni z odwilżą
 *    wyróżnione), menu gry.
 */
import type { CalendarDate } from '../sim';
import type { EnvironmentStateMessage } from '../worker/protocol';
import { compassName } from './colors';
import { formatHour, weekdayShort } from './timePanel';
import { BRAND_MARK, SPEED_GLYPHS, icon, starsSvg } from './ui/icons';
import { tipAttrs } from './ui/shell';

const MONTHS_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const WEEKDAYS = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
const WD2 = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
const wd2 = (d: CalendarDate) => WD2[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
const f0 = (v: number) => Math.round(v).toLocaleString('pl-PL');
const signed = (v: number) => `${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${Math.abs(Math.round(v))}`;

export function formatLongDate(d: CalendarDate): string {
  return `${weekdayShort(d)} ${d.day} ${MONTHS_GENITIVE[d.month - 1]} ${d.year}`;
}

/** „Sobota, 17 stycznia” – nad zegarem. */
export function formatDayHeader(d: CalendarDate): string {
  const wd = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${d.day} ${MONTHS_GENITIVE[d.month - 1]}`;
}

/** Kwoty w pasku: „2 384 120 zł”. */
export function money(v: number): string {
  return `${v < 0 ? '−' : ''}${f0(Math.abs(v))} zł`;
}

/** Czas rzeczywisty (1 s gry = 1 s): przy ×1 doba trwa 10 min, czyli 144 razy szybciej. */
export const LIVE_SPEED = 1 / 144;
export const GAME_SPEEDS = [0, LIVE_SPEED, 1, 5, 20] as const;
export type GameSpeed = number;

export interface TopBarHandlers {
  onSpeed(speed: GameSpeed): void;
  onMenu(): void;
  onFinance(): void;
  onGuests(): void;
  onPrices(): void;
  onSnow(): void;
}

/** Grubość śniegu przy dolnej i górnej stacji pomiaru pogody [cm] (null – jeszcze nie policzona). */
export interface SnowAtPoints {
  bottomCm: number;
  topCm: number;
}

/** Dane gry do paska (null – bez gry: tylko mapa). */
export interface TopBarGame {
  resortName: string;
  seasonLabel: string;
  balancePln: number;
  /** Wynik ostatniego zamkniętego dnia (null – jeszcze żadnego). */
  deltaPln: number | null;
  deltaLabel: string;
  guestsToday: number;
  onSlope: number;
  onSlopeLabel: string;
  reputation: number;
  priceLabel: string;
  pricePln: number;
}

export class TopBar {
  readonly details: HTMLElement;
  readonly weatherPop: HTMLElement;
  private readonly el: HTMLElement;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly statusEl: HTMLElement;
  private lastClock = '';
  private lastGame = '';
  private thawC = 2;

  constructor(parent: HTMLElement, h: TopBarHandlers) {
    this.el = document.createElement('header');
    this.el.className = 'u-top';
    this.el.innerHTML = `
      <div class="u-brand">${BRAND_MARK}<div class="u-stack"><span class="u-brand-name">Pilsko</span><span class="u-sub u-season">bez gry – tylko mapa</span></div></div>
      <div class="u-vsep"></div>
      <div class="u-stats">
        <button type="button" class="u-stat" data-act="finance" ${tipAttrs('Saldo konta; obok wynik ostatniego zamkniętego dnia. Kliknij – finanse, kredyt, zapis gry')}><span class="u-label">Saldo</span><span class="u-num u-balance">–</span></button>
        <button type="button" class="u-stat" data-act="guests" ${tipAttrs('Goście dziś i teraz na stoku. Kliknij – panel gości (wyciągi, kolejki, ostrzeżenia)')}><span class="u-label">Goście dziś</span><span class="u-num u-guests">–</span></button>
        <div class="u-stat" ${tipAttrs('Reputacja ośrodka (średnia ocen gości z zanikiem) – od niej zależy popyt')} tabindex="0"><span class="u-label">Reputacja</span><span class="u-num u-rep">–</span></div>
        <button type="button" class="u-stat" data-act="prices" ${tipAttrs('Cena karnetu dziennego. Kliknij – cennik i godziny otwarcia')}><span class="u-label u-price-label">Karnet dzienny</span><span class="u-num u-price">–</span></button>
      </div>
      <div class="u-time">
        <button type="button" class="u-clock" ${tipAttrs('Kalendarz i słońce: wybór dnia, suwak godziny, „odtwórz dzień”, „przewiń sezon”, czas rzeczywisty 1:1')}><span class="u-sub u-date">–</span><span class="u-clock-time">--:--</span></button>
        <div class="u-speed" role="group" aria-label="Prędkość czasu"></div>
      </div>
      <div class="u-vsep"></div>
      <div class="u-weather">
        <button type="button" class="u-wx" ${tipAttrs('Pogoda na górze i na dole; kliknij – szczegóły i prognoza na 7 dni')}><span class="u-wx-icon">${icon('cloud', 30, 1.7)}</span><span class="u-stack"><span class="u-num u-wx-temp">…</span><span class="u-sub u-wx-bottom"></span></span></button>
        <button type="button" class="u-stat" data-act="snow" ${tipAttrs('Grubość śniegu przy górnej stacji pomiaru i świeży opad dziś. Kliknij – naśnieżanie i ratraki')}><span class="u-label">Baza śniegu</span><span class="u-num u-num-s u-snow">…</span></button>
        <div class="u-stat" tabindex="0" ${tipAttrs('Wiatr na górze (porywy zatrzymują wyciągi)')}><span class="u-label">Wiatr</span><span class="u-num u-num-s u-wind">…</span></div>
        <div class="u-forecast" role="list" aria-label="Prognoza na 4 dni"></div>
      </div>
      <button type="button" class="u-icon-btn u-menu-btn" ${tipAttrs('Menu gry: okna, raporty, zapis, historia powiadomień, ustawienia')}>${icon('menu', 20, 2)}</button>`;
    parent.appendChild(this.el);
    const speed = this.el.querySelector('.u-speed')!;
    const speeds: [GameSpeed, string, string, string][] = [
      [0, 'pause', 'Pauza', 'Spacja'],
      [1, 'x1', '×1 – dzień sezonu w ok. 10 minut, noc szybciej', '1'],
      [5, 'x5', '×5 – pięć razy szybciej', ''],
      [20, 'x20', '×20 – dwadzieścia razy szybciej', ''],
    ];
    for (const [s, glyph, tip, key] of speeds) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'u-speed-btn';
      b.innerHTML = SPEED_GLYPHS[glyph];
      b.dataset.tip = tip;
      if (key === 'Spacja') b.dataset.key = key;
      b.setAttribute('aria-label', tip);
      b.addEventListener('click', () => h.onSpeed(s));
      speed.appendChild(b);
      this.speedButtons.set(s, b);
    }
    this.details = document.createElement('div');
    this.details.className = 'u-pop u-time-pop hidden';
    this.details.innerHTML = '<div class="u-pop-title">Kalendarz i słońce</div>';
    const live = document.createElement('button');
    live.type = 'button';
    live.className = 'u-btn u-live';
    live.textContent = 'Czas rzeczywisty 1:1';
    live.dataset.tip = 'Narciarze, krzesełka i kolejki w naturalnym tempie (najlepiej przy dużym przybliżeniu)';
    live.addEventListener('click', () => h.onSpeed(LIVE_SPEED));
    this.speedButtons.set(LIVE_SPEED, live);
    this.details.appendChild(live);
    parent.appendChild(this.details);
    this.weatherPop = document.createElement('div');
    this.weatherPop.className = 'u-pop u-weather-pop hidden';
    parent.appendChild(this.weatherPop);
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'u-status hidden';
    parent.appendChild(this.statusEl);

    this.el.querySelector('.u-clock')!.addEventListener('click', () => this.togglePop(this.details));
    this.el.querySelector('.u-wx')!.addEventListener('click', () => this.togglePop(this.weatherPop));
    this.el.querySelector('.u-menu-btn')!.addEventListener('click', () => h.onMenu());
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'finance') h.onFinance();
      else if (act === 'guests') h.onGuests();
      else if (act === 'prices') h.onPrices();
      else if (act === 'snow') h.onSnow();
    });
  }

  setThawThreshold(c: number): void {
    this.thawC = c;
  }

  private togglePop(pop: HTMLElement): void {
    const open = pop.classList.contains('hidden');
    this.details.classList.add('hidden');
    this.weatherPop.classList.add('hidden');
    pop.classList.toggle('hidden', !open);
  }

  closePops(): void {
    this.details.classList.add('hidden');
    this.weatherPop.classList.add('hidden');
  }

  setSpeed(speed: GameSpeed): void {
    for (const [s, b] of this.speedButtons) {
      b.classList.toggle('active', s === speed);
      b.setAttribute('aria-pressed', String(s === speed));
    }
  }

  /** Co klatkę (tanie – zmienia tekst tylko przy zmianie). */
  setClock(date: CalendarDate, hour: number, status: string): void {
    const key = `${date.year}-${date.month}-${date.day} ${formatHour(hour)} ${status}`;
    if (key === this.lastClock) return;
    this.lastClock = key;
    this.el.querySelector('.u-clock-time')!.textContent = formatHour(hour);
    this.el.querySelector('.u-date')!.textContent = formatDayHeader(date);
    this.statusEl.textContent = status;
    this.statusEl.classList.toggle('hidden', !status);
  }

  setGame(g: TopBarGame | null): void {
    const key = JSON.stringify(g);
    if (key === this.lastGame) return;
    this.lastGame = key;
    const q = (s: string) => this.el.querySelector<HTMLElement>(s)!;
    if (!g) {
      q('.u-season').textContent = 'bez gry – tylko mapa';
      for (const s of ['.u-balance', '.u-guests', '.u-rep', '.u-price']) q(s).textContent = '–';
      return;
    }
    q('.u-brand-name').textContent = g.resortName;
    q('.u-season').textContent = g.seasonLabel;
    const delta = g.deltaPln === null ? '' : ` <span class="u-delta ${g.deltaPln >= 0 ? 'good' : 'bad'}">${g.deltaPln >= 0 ? '+' : '−'}${f0(Math.abs(g.deltaPln))} ${g.deltaLabel}</span>`;
    q('.u-balance').innerHTML = `${money(g.balancePln)}${delta}`;
    q('.u-guests').innerHTML = `${f0(g.guestsToday)} <span class="u-dim">${g.onSlopeLabel} ${f0(g.onSlope)}</span>`;
    q('.u-rep').innerHTML = `${g.reputation.toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${starsSvg(g.reputation)}`;
    q('.u-price-label').textContent = g.priceLabel;
    q('.u-price').textContent = `${f0(g.pricePln)} zł`;
  }

  setWeather(s: EnvironmentStateMessage, snow: SnowAtPoints | null): void {
    const top = s.top.now;
    const ic = top.phase === 'snow' || top.phase === 'sleet' ? 'cloudSnow' : top.phase === 'rain' ? 'cloudRain' : s.cloudFraction < 0.3 ? (s.sun.elevationDeg > 0 ? 'sun' : 'moon') : s.cloudFraction < 0.7 ? 'partly' : 'cloud';
    const q = (sel: string) => this.el.querySelector<HTMLElement>(sel)!;
    q('.u-wx-icon').innerHTML = icon(ic, 30, 1.7);
    q('.u-wx-icon').classList.toggle('sunny', ic === 'sun');
    const t = (v: number) => `${v < -0.05 ? '−' : ''}${Math.abs(v).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} °C`;
    q('.u-wx-temp').textContent = t(top.temperatureC);
    q('.u-wx-bottom').textContent = `na dole ${t(s.bottom.now.temperatureC)}`;
    const fresh = s.top.dayPhase === 'snow' && s.top.dayPrecipitationMm >= 0.5 ? s.top.dayPrecipitationMm : 0;
    q('.u-snow').innerHTML = snow ? `${f0(snow.topCm)} cm${fresh ? ` <span class="u-cold">+${f0(fresh)} cm puchu</span>` : ''}` : '…';
    q('.u-wind').textContent = `${f0(top.windMs * 3.6)} km/h ${compassName(top.windFromDeg)}`;
    const days = s.forecast.slice(1, 5);
    q('.u-forecast').innerHTML = days
      .map((f) => {
        const thaw = f.bottomTMeanC > this.thawC;
        return `<div role="listitem" class="u-fc${thaw ? ' thaw' : ''}" data-tip="${weekdayShort(f.date)} ${f.date.day}.${String(f.date.month).padStart(2, '0')}: średnio ${signed(f.bottomTMeanC)}° na dole, ${signed(f.topTMeanC)}° na górze${thaw ? ' – odwilż' : ''}; opad ${f0(f.precipitationProbability * 100)} %"><span>${wd2(f.date)}</span><b>${signed(f.bottomTMeanC)}°</b></div>`;
      })
      .join('');
  }
}
