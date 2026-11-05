/**
 * Menu deweloperskie (klawisz ` lub przycisk „Dev” w rogu): scena demonstracyjna, liczba
 * narciarzy (test wydajności), licznik klatek i statystyki rysowania.
 */
export interface DevMenuHandlers {
  onDemo(on: boolean, skiers: number): void;
}

export class DevMenu {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly demo: HTMLInputElement;
  private readonly count: HTMLSelectElement;
  private frames = 0;
  private lastS = performance.now() / 1000;
  private cpuMsSum = 0;
  fps = 0;
  cpuMs = 0;

  constructor(parent: HTMLElement, h: DevMenuHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'dev-menu';
    this.root.innerHTML = `
      <button type="button" class="dev-toggle" title="Menu deweloperskie (klawisz \`)">Dev</button>
      <div class="dev-panel hidden">
        <div class="dev-title">Menu deweloperskie</div>
        <label><input type="checkbox" class="dev-demo"> Scena demonstracyjna</label>
        <label>Narciarzy <select class="dev-count"><option>50</option><option>500</option><option>2000</option></select></label>
        <div class="dev-hint">Narciarze i ratrak jeżdżą po trasach (zbudowanych albo prawdziwych z OSM) – tylko do oceny wyglądu. Sztruks i przetarcia: przybliż do ok. 0,25–0,5 m/px.</div>
        <div class="dev-stats"></div>
      </div>`;
    parent.appendChild(this.root);
    this.panel = this.root.querySelector('.dev-panel')!;
    this.stats = this.root.querySelector('.dev-stats')!;
    this.demo = this.root.querySelector('.dev-demo')!;
    this.count = this.root.querySelector('.dev-count')!;
    this.root.querySelector('.dev-toggle')!.addEventListener('click', () => this.toggle());
    const fire = () => h.onDemo(this.demo.checked, Number(this.count.value));
    this.demo.addEventListener('change', fire);
    this.count.addEventListener('change', fire);
  }

  toggle(): void {
    this.panel.classList.toggle('hidden');
  }

  /** Ustawienie z kodu (np. adres strony ?demo=2000). */
  setDemo(on: boolean, skiers: number): void {
    this.demo.checked = on;
    this.count.value = String(skiers);
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
