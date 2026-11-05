/**
 * Panel daty i godziny: wybór dnia, suwak godziny, „odtwórz dzień” (cienie przesuwają się po mapie).
 */
import { addDays, formatIsoDate, parseIsoDate } from '../sim';
import type { CalendarDate } from '../sim';

const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
/** Krok suwaka godziny [h] (15 minut). */
const HOUR_STEP = 0.25;

export function formatHour(hour: number): string {
  const totalMin = Math.round(hour * 60);
  const h = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const WEEKDAYS_SHORT = ['ndz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];

export function weekdayName(date: CalendarDate): string {
  return WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
}

export function weekdayShort(date: CalendarDate): string {
  return WEEKDAYS_SHORT[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
}

export interface TimeChange {
  date: CalendarDate;
  hour: number;
}

export class TimePanel {
  date: CalendarDate;
  hour: number;
  private readonly element: HTMLElement;
  private readonly dateInput: HTMLInputElement;
  private readonly slider: HTMLInputElement;
  private readonly timeLabel: HTMLElement;
  private readonly sunLabel: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly playButton: HTMLButtonElement;
  private playing: { startMs: number; fromHour: number; toHour: number } | null = null;
  private sunrise: number | null = null;
  private sunset: number | null = null;

  constructor(
    parent: HTMLElement,
    start: TimeChange,
    private readonly playDurationS: number,
    private readonly onChange: (t: TimeChange) => void,
  ) {
    this.date = start.date;
    this.hour = start.hour;
    this.element = document.createElement('div');
    this.element.className = 'time-panel';
    this.element.innerHTML = `
      <div class="time-row">
        <button type="button" data-act="prev" title="Poprzedni dzień">◀</button>
        <input type="date" class="time-date" />
        <button type="button" data-act="next" title="Następny dzień">▶</button>
        <span class="time-label"></span>
        <button type="button" data-act="play" class="time-play" title="Przewiń dzień od wschodu do zachodu Słońca">▶ Odtwórz dzień</button>
      </div>
      <input type="range" class="time-slider" min="0" max="24" step="${HOUR_STEP}" />
      <div class="time-sun"></div>
      <div class="time-status"></div>`;
    parent.appendChild(this.element);
    this.dateInput = this.element.querySelector('.time-date')!;
    this.slider = this.element.querySelector('.time-slider')!;
    this.timeLabel = this.element.querySelector('.time-label')!;
    this.sunLabel = this.element.querySelector('.time-sun')!;
    this.statusLabel = this.element.querySelector('.time-status')!;
    this.playButton = this.element.querySelector('.time-play')!;
    this.dateInput.addEventListener('change', () => {
      try {
        this.setDate(parseIsoDate(this.dateInput.value));
      } catch {
        // niepełna data w polu – ignorujemy
      }
    });
    this.slider.addEventListener('input', () => {
      this.stop();
      this.setHour(Number(this.slider.value));
    });
    this.element.querySelector('[data-act="prev"]')!.addEventListener('click', () => this.setDate(addDays(this.date, -1)));
    this.element.querySelector('[data-act="next"]')!.addEventListener('click', () => this.setDate(addDays(this.date, 1)));
    this.playButton.addEventListener('click', () => (this.playing ? this.stop() : this.play()));
    // Klawisze w panelu nie mają przesuwać mapy.
    this.element.addEventListener('keydown', (e) => e.stopPropagation());
    this.refresh();
  }

  setDate(date: CalendarDate): void {
    this.date = date;
    this.refresh();
    this.onChange({ date: this.date, hour: this.hour });
  }

  setHour(hour: number): void {
    this.hour = Math.min(24 - HOUR_STEP, Math.max(0, hour));
    this.refresh();
    this.onChange({ date: this.date, hour: this.hour });
  }

  /** Informacje o Słońcu z symulacji (wysokość, azymut, wschód, zachód). */
  setSun(info: { elevationDeg: number; azimuthDeg: number; sunriseHour: number | null; sunsetHour: number | null; summerTime: boolean }): void {
    this.sunrise = info.sunriseHour;
    this.sunset = info.sunsetHour;
    const f1 = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 0 });
    const pos =
      info.elevationDeg > 0
        ? `Słońce ${f1(info.elevationDeg)}° nad horyzontem, azymut ${f1(info.azimuthDeg)}°`
        : 'Słońce pod horyzontem';
    const times = info.sunriseHour !== null && info.sunsetHour !== null ? ` · wschód ${formatHour(info.sunriseHour)} · zachód ${formatHour(info.sunsetHour)}` : '';
    this.sunLabel.textContent = pos + times;
    this.timeLabel.textContent = `${formatHour(this.hour)} (${info.summerTime ? 'czas letni' : 'czas zimowy'})`;
  }

  setStatus(text: string): void {
    this.statusLabel.textContent = text;
  }

  /** Wywoływane co klatkę – animacja „odtwórz dzień”. */
  tick(nowMs: number): void {
    if (!this.playing) return;
    const t = (nowMs - this.playing.startMs) / (this.playDurationS * 1000);
    if (t >= 1) {
      this.setHour(this.playing.toHour);
      this.stop();
      return;
    }
    this.setHour(this.playing.fromHour + t * (this.playing.toHour - this.playing.fromHour));
  }

  private play(): void {
    const from = this.sunrise !== null ? Math.max(0, this.sunrise - 0.5) : 0;
    const to = this.sunset !== null ? Math.min(24 - HOUR_STEP, this.sunset + 0.5) : 24 - HOUR_STEP;
    this.playing = { startMs: performance.now(), fromHour: from, toHour: to };
    this.playButton.textContent = '■ Zatrzymaj';
  }

  private stop(): void {
    this.playing = null;
    this.playButton.textContent = '▶ Odtwórz dzień';
  }

  private refresh(): void {
    this.dateInput.value = formatIsoDate(this.date);
    this.slider.value = String(this.hour);
    if (!this.timeLabel.textContent) this.timeLabel.textContent = formatHour(this.hour);
  }

  get isPlaying(): boolean {
    return this.playing !== null;
  }
}
