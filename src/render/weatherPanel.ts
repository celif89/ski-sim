/**
 * Panel pogody: warunki teraz na dole i na górze ośrodka + prognoza na 7 dni.
 */
import type { PrecipitationPhase } from '../sim';
import type { EnvironmentStateMessage } from '../worker/protocol';
import { compassName } from './colors';
import { formatHour, weekdayName, weekdayShort } from './timePanel';

const f0 = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 0 });
const f1 = (v: number) => v.toLocaleString('pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const signed = (v: number) => {
  const r = Math.round(v);
  return `${r < 0 ? '−' : ''}${f0(Math.abs(r))}`;
};
/** Suma opadu: poniżej 1 mm z jednym miejscem po przecinku. */
const mm = (v: number) => (v < 1 ? f1(v) : f0(v));

const PHASE_NAME: Record<PrecipitationPhase, string> = { none: 'bez opadu', snow: 'śnieg', sleet: 'deszcz ze śniegiem', rain: 'deszcz' };
/** Progi zachmurzenia do symboli (słonecznie / częściowe / pochmurno). */
const CLEAR_SKY_MAX = 0.3;
const PARTLY_CLOUDY_MAX = 0.7;

export function weatherSymbol(phase: PrecipitationPhase, cloud: number): string {
  if (phase === 'snow') return '❄';
  if (phase === 'rain') return '☂';
  if (phase === 'sleet') return '❄☂';
  if (cloud < CLEAR_SKY_MAX) return '☀';
  if (cloud < PARTLY_CLOUDY_MAX) return '⛅';
  return '☁';
}

export class WeatherPanel {
  private readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private collapsed: boolean;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'weather-panel';
    this.element.innerHTML = `<button type="button" class="weather-toggle"><span class="weather-title">Pogoda</span><span class="weather-arrow"></span></button><div class="weather-body"><div class="legend-note">liczę cienie i pogodę…</div></div>`;
    parent.appendChild(this.element);
    this.body = this.element.querySelector('.weather-body')!;
    this.collapsed = window.matchMedia('(max-width: 700px)').matches;
    this.element.querySelector('.weather-toggle')!.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.applyCollapsed();
    });
    this.applyCollapsed();
  }

  private applyCollapsed(): void {
    this.element.classList.toggle('collapsed', this.collapsed);
    this.element.querySelector('.weather-arrow')!.textContent = this.collapsed ? '▸' : '▾';
  }

  update(s: EnvironmentStateMessage): void {
    const date = `${weekdayName(s.date)} ${s.date.day}.${String(s.date.month).padStart(2, '0')}.${s.date.year}`;
    this.element.querySelector('.weather-title')!.textContent = `Pogoda – ${date}, ${formatHour(s.hour)}`;
    const col = (p: EnvironmentStateMessage['bottom']) => {
      const now = p.now;
      const precipNow = now.precipitationMm > 0 ? `${PHASE_NAME[now.phase]} ${f1(now.precipitationMm)} mm/h` : 'nie pada';
      const precipDay = p.dayPrecipitationMm > 0 ? `${mm(p.dayPrecipitationMm)} mm, ${PHASE_NAME[p.dayPhase]}` : 'bez opadu';
      return { temp: `${f1(now.temperatureC)} °C`, range: `${signed(p.tMinC)} / ${signed(p.tMaxC)} °C`, precipNow, precipDay, wind: `${f0(now.windMs)} m/s z ${compassName(now.windFromDeg)}`, rh: `${f0(now.humidityPercent)} %` };
    };
    const b = col(s.bottom);
    const t = col(s.top);
    const row = (label: string, key: keyof typeof b) => `<tr><th>${label}</th><td>${b[key]}</td><td>${t[key]}</td></tr>`;
    const forecastRows = s.forecast
      .map((f) => {
        const d = `${weekdayShort(f.date)} ${f.date.day}.${String(f.date.month).padStart(2, '0')}`;
        const precip = f.precipitationProbability >= 0.5 ? `${f0(f.precipitationProbability * 100)} %, ${mm(f.precipitationMm)} mm` : `${f0(f.precipitationProbability * 100)} %`;
        return `<tr><td>${d}</td><td class="wx-sym" title="dół: ${PHASE_NAME[f.bottomPhase]}, góra: ${PHASE_NAME[f.topPhase]}">${weatherSymbol(f.topPhase, f.cloudFraction)}</td><td>${precip}</td><td>${signed(f.bottomTMeanC)}° / ${signed(f.topTMeanC)}°</td><td class="wx-unc">±${f1(f.temperatureUncertaintyC)}</td></tr>`;
      })
      .join('');
    this.body.innerHTML = `
      <table class="wx-now">
        <thead><tr><th></th><th>dół ${f0(s.bottom.elevationM)} m</th><th>góra ${f0(s.top.elevationM)} m</th></tr></thead>
        <tbody>
          ${row('temperatura', 'temp')}
          ${row('dziś min / maks', 'range')}
          ${row('opad teraz', 'precipNow')}
          ${row('opad dziś', 'precipDay')}
          ${row('wiatr', 'wind')}
          ${row('wilgotność', 'rh')}
        </tbody>
      </table>
      <div class="wx-cloud">Zachmurzenie: ${f0(s.cloudFraction * 100)} % ${weatherSymbol(s.top.now.phase, s.cloudFraction)}</div>
      <div class="wx-forecast-title">Prognoza na 7 dni <span class="legend-note">(średnia temp. dół / góra, niepewność rośnie z każdym dniem)</span></div>
      <table class="wx-forecast"><tbody>${forecastRows}</tbody></table>
      <a class="wx-report" href="${import.meta.env.BASE_URL}raport-klimatu.html" target="_blank" rel="noopener">Raport klimatu: 30 zim z generatora obok danych IMGW →</a>
      <a class="wx-report" href="${import.meta.env.BASE_URL}raport-zimy.html" target="_blank" rel="noopener">Raport zimy: śnieg – kalibracja na pomiarach IMGW, 30 zim →</a>`;
  }
}
