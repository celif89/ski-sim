/**
 * Górny pasek w stylu A („ilustrowana mapa narciarska”): jasne zaokrąglone karty.
 *  – lewa: godzina i data (duże), pod spodem rozwijane szczegóły – dotychczasowy panel czasu
 *    (wybór dnia, suwak godziny, „odtwórz dzień”, „przewiń sezon”),
 *  – środek: plakietka pogody (temperatura, śnieg, wiatr); kliknięcie – pełny panel pogody
 *    z prognozą,
 *  – prawa: prędkość czasu gry (pauza, ×1, ×5, ×20).
 */
import type { CalendarDate } from '../sim';
import type { EnvironmentStateMessage } from '../worker/protocol';
import { compassName } from './colors';
import { formatHour, weekdayShort } from './timePanel';
import { weatherSymbol } from './weatherPanel';

const MONTHS_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const f0 = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 0 });
const f1 = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function formatLongDate(d: CalendarDate): string {
  return `${weekdayShort(d)} ${d.day} ${MONTHS_GENITIVE[d.month - 1]} ${d.year}`;
}

/** Czas rzeczywisty (1 s gry = 1 s): przy ×1 doba trwa 10 min, czyli 144 razy szybciej. */
export const LIVE_SPEED = 1 / 144;
export const GAME_SPEEDS = [0, LIVE_SPEED, 1, 5, 20] as const;
export type GameSpeed = number;

export interface TopBarHandlers {
  onSpeed(speed: GameSpeed): void;
}

/** Grubość śniegu przy dolnej i górnej stacji pomiaru pogody [cm] (null – jeszcze nie policzona). */
export interface SnowAtPoints {
  bottomCm: number;
  topCm: number;
}

export class TopBar {
  readonly details: HTMLElement;
  readonly weatherPop: HTMLElement;
  private readonly time: HTMLElement;
  private readonly date: HTMLElement;
  private readonly status: HTMLElement;
  private readonly chip: HTMLButtonElement;
  private readonly speedButtons = new Map<GameSpeed, HTMLButtonElement>();
  private readonly moreButton: HTMLButtonElement;
  private lastKey = '';

  constructor(parent: HTMLElement, h: TopBarHandlers) {
    const left = document.createElement('div');
    left.className = 'a-top-left';
    left.innerHTML = `
      <div class="a-card a-clock">
        <div class="a-clock-main"><span class="a-clock-time">--:--</span><span class="a-clock-date"></span></div>
        <div class="a-clock-status"></div>
        <button type="button" class="a-link a-clock-more" title="Wybór dnia, suwak godziny, „odtwórz dzień”, „przewiń sezon”">Kalendarz i słońce ▾</button>
      </div>
      <div class="a-card a-clock-details hidden"></div>`;
    parent.appendChild(left);
    this.time = left.querySelector('.a-clock-time')!;
    this.date = left.querySelector('.a-clock-date')!;
    this.status = left.querySelector('.a-clock-status')!;
    this.details = left.querySelector('.a-clock-details')!;
    this.moreButton = left.querySelector('.a-clock-more')!;
    this.moreButton.addEventListener('click', () => {
      const hidden = this.details.classList.toggle('hidden');
      this.moreButton.textContent = hidden ? 'Kalendarz i słońce ▾' : 'Kalendarz i słońce ▴';
    });

    const center = document.createElement('div');
    center.className = 'a-top-center';
    center.innerHTML = `<button type="button" class="a-card a-weather-chip" title="Pogoda teraz i prognoza na 7 dni">liczę pogodę…</button><div class="a-card a-weather-pop hidden"></div>`;
    parent.appendChild(center);
    this.chip = center.querySelector('.a-weather-chip')!;
    this.weatherPop = center.querySelector('.a-weather-pop')!;
    this.chip.addEventListener('click', () => this.weatherPop.classList.toggle('hidden'));

    const right = document.createElement('div');
    right.className = 'a-top-right a-card a-speed';
    for (const s of GAME_SPEEDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'a-speed-btn';
      b.innerHTML = s === 0 ? '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>' : s === LIVE_SPEED ? '1:1' : `×${s}`;
      b.title =
        s === 0
          ? 'Pauza (spacja)'
          : s === LIVE_SPEED
            ? '1:1 – czas rzeczywisty: narciarze, krzesełka i kolejki w naturalnym tempie (najlepiej przy dużym przybliżeniu)'
            : s === 1
              ? '×1 – dzień sezonu w ok. 10 minut, noc szybciej'
              : `×${s} – czas ${s} razy szybciej niż ×1`;
      b.addEventListener('click', () => h.onSpeed(s));
      right.appendChild(b);
      this.speedButtons.set(s, b);
    }
    parent.appendChild(right);
    // Klawisze w panelach nie przesuwają mapy.
    for (const el of [left, center, right]) el.addEventListener('keydown', (e) => e.stopPropagation());
  }

  setSpeed(speed: GameSpeed): void {
    for (const [s, b] of this.speedButtons) b.classList.toggle('active', s === speed);
  }

  /** Co klatkę (tanie – zmienia tekst tylko przy zmianie). */
  setClock(date: CalendarDate, hour: number, status: string): void {
    const key = `${date.year}-${date.month}-${date.day} ${formatHour(hour)} ${status}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.time.textContent = formatHour(hour);
    this.date.textContent = formatLongDate(date);
    this.status.textContent = status;
  }

  setWeather(s: EnvironmentStateMessage, snow: SnowAtPoints | null): void {
    const top = s.top.now;
    const sym = weatherSymbol(top.phase, s.cloudFraction);
    const snowText = snow ? `${f0(snow.bottomCm)}–${f0(snow.topCm)} cm` : '…';
    this.chip.innerHTML = `
      <span class="a-wx-sym">${sym}</span>
      <span class="a-wx-item" title="Temperatura na górze ${f0(s.top.elevationM)} m / na dole ${f0(s.bottom.elevationM)} m"><b>${f1(top.temperatureC)} °C</b> <small>dół ${f1(s.bottom.now.temperatureC)}</small></span>
      <span class="a-wx-sep"></span>
      <span class="a-wx-item" title="Grubość śniegu naturalnego: dół – góra"><svg viewBox="0 0 16 16" width="13" height="13"><path d="M8 1v14M2 4.5l12 7M2 11.5l12-7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg> <b>${snowText}</b></span>
      <span class="a-wx-sep"></span>
      <span class="a-wx-item" title="Wiatr na górze"><svg viewBox="0 0 16 16" width="13" height="13"><path d="M1 6h9a2.5 2.5 0 1 0-2.5-2.5M1 10h12a2 2 0 1 1-2 2" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg> <b>${f0(top.windMs)} m/s</b> <small>${compassName(top.windFromDeg)}</small></span>`;
  }
}
