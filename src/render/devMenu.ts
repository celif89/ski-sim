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

  /**
   * Etap 7e: sekcja suwaków (np. rzeźba terenu). get/set – odczyt i zmiana wartości (zmiana od razu
   * na mapie, bez zapisu do pliku); onCopy – tekst JSON do skopiowania (do wklejenia w plik danych),
   * onReset – powrót do wartości z pliku.
   */
  addSliders(
    title: string,
    sliders: { path: string; label: string; min: number; max: number; step: number }[],
    get: (path: string) => number,
    set: (path: string, v: number) => void,
    onCopy: () => string,
    onReset: () => void,
  ): void {
    const box = document.createElement('details');
    box.className = 'dev-sliders';
    box.innerHTML = `<summary>${title}</summary><div class="dev-slider-list"></div><div class="dev-slider-actions"><button type="button" data-a="copy" title="Kopiuje bieżące wartości (JSON) – do wklejenia w data/map-style.json">Kopiuj ustawienia</button><button type="button" data-a="reset" title="Wartości z pliku danych">Przywróć z pliku</button><span class="dev-copy-note"></span></div>`;
    const list = box.querySelector('.dev-slider-list')!;
    const rows: { path: string; input: HTMLInputElement; out: HTMLElement }[] = [];
    for (const sl of sliders) {
      const row = document.createElement('label');
      row.className = 'dev-slider';
      row.innerHTML = `<span class="dev-slider-label">${sl.label}</span><input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}"><output></output>`;
      const input = row.querySelector('input')!;
      const out = row.querySelector('output')!;
      input.addEventListener('input', () => {
        set(sl.path, Number(input.value));
        out.textContent = input.value;
      });
      list.appendChild(row);
      rows.push({ path: sl.path, input, out });
    }
    const refresh = () => {
      for (const r of rows) {
        const v = get(r.path);
        r.input.value = String(v);
        r.out.textContent = String(Math.round(v * 1000) / 1000);
      }
    };
    refresh();
    const note = box.querySelector<HTMLElement>('.dev-copy-note')!;
    box.querySelector('[data-a="copy"]')!.addEventListener('click', () => {
      const text = onCopy();
      const done = () => (note.textContent = 'skopiowano');
      try {
        void navigator.clipboard.writeText(text).then(done, () => (note.textContent = 'schowek niedostępny – wartości w konsoli'));
      } catch {
        note.textContent = 'schowek niedostępny – wartości w konsoli';
      }
      console.info(text);
    });
    box.querySelector('[data-a="reset"]')!.addEventListener('click', () => {
      onReset();
      refresh();
      note.textContent = '';
    });
    this.panel.appendChild(box);
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
