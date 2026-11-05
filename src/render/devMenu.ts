/**
 * Menu deweloperskie (klawisz ` lub przycisk „Dev” w rogu): licznik klatek, czas pracy procesora
 * na klatkę i statystyki rysowania (do pomiarów wydajności). Liczba gości dnia – w panelu „Goście”
 * albo w adresie strony (?goscie=2000).
 */
export class DevMenu {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly stats: HTMLElement;
  private frames = 0;
  private lastS = performance.now() / 1000;
  private cpuMsSum = 0;
  fps = 0;
  cpuMs = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dev-menu';
    this.root.innerHTML = `
      <button type="button" class="dev-toggle" title="Menu deweloperskie (klawisz \`)">Dev</button>
      <div class="dev-panel hidden">
        <div class="dev-title">Menu deweloperskie</div>
        <div class="dev-hint">Pomiar wydajności: liczba gości w panelu „Goście” (albo adres ?goscie=2000), zegar ×1. Sztruks, muldy i ślady: przybliż do ok. 0,25–0,5 m/px.</div>
        <div class="dev-stats"></div>
      </div>`;
    parent.appendChild(this.root);
    this.panel = this.root.querySelector('.dev-panel')!;
    this.stats = this.root.querySelector('.dev-stats')!;
    this.root.querySelector('.dev-toggle')!.addEventListener('click', () => this.toggle());
  }

  toggle(): void {
    this.panel.classList.toggle('hidden');
  }

  /** Co klatkę: licznik klatek i czas pracy procesora na klatkę. */
  frame(cpuMs: number, extra: string): void {
    this.frames++;
    this.cpuMsSum += cpuMs;
    const now = performance.now() / 1000;
    if (now - this.lastS >= 1) {
      this.fps = this.frames / (now - this.lastS);
      this.cpuMs = this.cpuMsSum / this.frames;
      this.frames = 0;
      this.cpuMsSum = 0;
      this.lastS = now;
      if (!this.panel.classList.contains('hidden')) this.stats.textContent = `${this.fps.toFixed(1)} kl./s · procesor ${this.cpuMs.toFixed(1)} ms/klatkę · ${extra}`;
    }
  }
}
