/**
 * Etap 7c: jeden zestaw ikon liniowych SVG (siatka 24 × 24, grubość linii 1,7–1,9, zaokrąglone
 * końce). Kształty jak w makietach docs/ui (ui-1-mapa.html, ui-2-karty.html, ui-3-raport.html).
 * Bez emoji – wszędzie, gdzie potrzebny symbol, używamy tych ikon.
 */

const PATHS: Record<string, string> = {
  // widoki danych
  terrain: '<path d="M2.5 19l6.5-11 4 6.5 2.5-3.5L21.5 19z"/>',
  slope: '<path d="M4 19h16L4 6z"/><path d="M8 19a4 4 0 0 0-1.4-3"/>',
  aspect: '<circle cx="12" cy="12" r="8.5"/><path d="M12 5.5l2.5 6.5-2.5-1.5-2.5 1.5z"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 15h15a3 3 0 1 1-3 3"/>',
  water: '<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.3a3 3 0 0 1 0 5.4M21 20c0-2.6-1.6-4.9-4-5.7"/>',
  person: '<circle cx="12" cy="7" r="3.5"/><path d="M5 20.5c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  thermo: '<path d="M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0z"/>',
  ground: '<path d="M3 17h18"/><path d="M5 17l2-4 3 2 3-5 3 3 3-2 2 6"/><path d="M6 20.5h.01M11 20.5h.01M16 20.5h.01"/>',
  ruler: '<path d="M3 17l6-7 4 4 8-9"/><path d="M3 21h18"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5h.01"/>',
  // budowa
  lift: '<path d="M3 6l18-3"/><path d="M12 4.5V12"/><path d="M7 12h10v4H7z"/><path d="M7 16v3M17 16v3"/>',
  piste: '<path d="M8 3c6 2 8 4 2 7s-4 6 4 11"/>',
  road: '<path d="M8 3L5 21M16 3l3 18"/><path d="M12 5v3M12 11v3M12 17v3"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
  building: '<path d="M4 11l8-6 8 6v9H4z"/><path d="M10 20v-5h4v5"/>',
  tree: '<path d="M12 3l6 9h-4l4 6H6l4-6H6z"/><path d="M12 18v3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  pipe: '<path d="M3 8h12a3 3 0 0 1 3 3v10"/><path d="M3 13h9a1 1 0 0 1 1 1v7"/><path d="M8 5v3M8 13v3"/>',
  gun: '<path d="M4 15l9-6 3 4.5-9 6z"/><path d="M8.5 18l-1.5 3M5 21h4"/><path d="M17 7.5l2-1M18 10.5l2.5 0M16.5 4.5l1-1.5"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-8h5l3 8M10 8l4 8M9 5h3"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M9 21l2.5-6.5L14 17v4M11.5 14.5L12 9l-3 2-1 3.5M12 9l3 3 3 1"/>',
  sled: '<path d="M4 15h13a3 3 0 0 0 3-3"/><path d="M6 15v3M14 15v3M3 18h15"/><circle cx="10" cy="8" r="2"/><path d="M8 13l2-3 3 2"/>',
  parking: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M10 16.5v-9h3a3 3 0 0 1 0 6h-3"/>',
  car: '<path d="M5 16h14v-3.5L17 8H7l-2 4.5z"/><path d="M7 16v2.5M17 16v2.5"/><path d="M8 12.5h.01M16 12.5h.01"/>',
  food: '<path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5M16 21V3c-2 1.5-3 4-3 7h3"/>',
  groomer: '<path d="M3 16h12l2-5h-4l-1-3H6l-2 5"/><path d="M15 16l4.5 2.5"/><circle cx="7" cy="18.5" r="1.8"/><circle cx="12" cy="18.5" r="1.8"/>',
  tank: '<ellipse cx="12" cy="6" rx="8" ry="2.8"/><path d="M4 6v12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V6"/><path d="M4 12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M6 12H3a9 9 0 0 0 18 0h-3M8 10h8"/>',
  playground: '<path d="M4 21V9l4-5 4 5v12"/><path d="M12 13h6l2 8"/><path d="M4 13h8"/>',
  view: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  // interfejs
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.5l2.7 2.7L16 9.8"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 0 12h-1"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 0 0 0 12h1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 9a3.5 3.5 0 0 1 .5 9z"/>',
  cloudSnow: '<path d="M7 15a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7"/><path d="M9 19l.01 0M13 18l.01 0M16 20l.01 0M11 21.5l.01 0"/>',
  cloudRain: '<path d="M7 15a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7"/><path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3"/>',
  partly: '<path d="M8 4.5v1.5M3.5 9H5M4.8 5.8l1 1M11.2 5.8l-1 1"/><path d="M5.5 11.2A3.5 3.5 0 1 1 11 7.6"/><path d="M9 20a3.5 3.5 0 0 1-.5-7 5 5 0 0 1 9.5 1 3 3 0 0 1 .3 6z"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  storm: '<path d="M7 15a4 4 0 0 1-.6-8A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7"/><path d="M12.5 13l-2 4h3l-2 4"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 16l9 5 9-5"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="2.5"/><path d="M3 7v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7"/><path d="M9 16.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-4c0-1.4-2.7-2.5-6-2.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><path d="M7.5 8.5h.01"/>',
  play: '<path d="M7 5l11 7-11 7z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  hand: '<path d="M4 17c3-5 6-8 9-9.5s5-1 6 0"/><path d="M4 17c2 .5 3.5.3 5-.6"/>',
  arc: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M6.3 16.4C8.5 9 15.5 9 17.7 16.4"/><path d="M12 5.5h.01"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  magic: '<path d="M4 20L16 8"/><path d="M15 4v3M19 8h-3M18 5l-2 2"/><path d="M20 13v2M19 14h2M8 4v2M7 5h2"/>',
  points: '<circle cx="5" cy="17" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="19" cy="15" r="2"/><path d="M6.4 15.6l4.2-6.2M13.6 9l4 4.6"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2 2 0 0 1-3-3z"/><path d="M14.5 6.5L17 4l3 3-2.5 2.5"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
};

/** Ikona liniowa: rozmiar w pikselach, grubość linii 1,7–1,9 (domyślnie 1,8). */
export function icon(name: string, size = 22, strokeWidth = 1.8): string {
  const p = PATHS[name] ?? PATHS.info;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" class="ic" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

/** Wypełnione symbole przycisków czasu (jak w makiecie – pauza, ×1, ×5, ×20). */
export const SPEED_GLYPHS: Record<string, string> = {
  pause: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  x1: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M7 5l11 7-11 7z"/></svg>',
  x5: '<svg viewBox="0 0 24 24" width="18" height="16" aria-hidden="true" fill="currentColor"><path d="M3 5l9 7-9 7z"/><path d="M12 5l9 7-9 7z"/></svg>',
  x20: '<svg viewBox="0 0 28 24" width="20" height="16" aria-hidden="true" fill="currentColor"><path d="M1 5l8 7-8 7z"/><path d="M9.5 5l8 7-8 7z"/><path d="M18 5l8 7-8 7z"/></svg>',
};

/** Znak marki (góra z pomarańczowym stokiem). */
export const BRAND_MARK =
  '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M2 20L9.5 7l4 6.5 2.5-4L22 20z" fill="#FF7A1A"/><path d="M7.6 10.3L9.5 7l1.9 3.1-1.9 1.2z" fill="#FFFFFF"/></svg>';

/** Gwiazdki reputacji (pełne, ułamkowa, puste) – jak w makiecie. */
export function starsSvg(value: number, width = 80): string {
  const star = 'M8 1l2.2 4.6 5 .7-3.6 3.5.9 5L8 12.4 3.5 14.8l.9-5L.8 6.3l5-.7z';
  let g = '';
  for (let i = 0; i < 5; i++) {
    const f = Math.max(0, Math.min(1, value - i));
    const x = i * 18;
    g += `<path transform="translate(${x} 0)" d="${star}" fill="${f >= 0.75 ? '#FF7A1A' : 'rgba(255,255,255,0.18)'}"/>`;
    if (f >= 0.25 && f < 0.75) g += `<path transform="translate(${x} 0)" d="M8 1L8 12.4 3.5 14.8l.9-5L.8 6.3l5-.7z" fill="#FF7A1A" opacity="0.6"/>`;
  }
  return `<svg viewBox="0 0 90 16" width="${width}" height="${(width * 14) / 80}" role="img" aria-label="${value.toLocaleString('pl-PL', { maximumFractionDigits: 1 })} na 5 gwiazdek">${g}</svg>`;
}

/** Rysunki kart palety budowy (64 × 36) – wyciągi wg typu, pozostałe obiekty. */
const ART: Record<string, string> = {
  carpet: '<path d="M4 28l56-14"/><path d="M4 31l56-14" opacity="0.5"/><path d="M14 24.5v-3M26 21.5v-3M38 18.5v-3M50 15.5v-3"/>',
  platter: '<path d="M4 30L60 6"/><path d="M22 22.3v8M42 13.7v8"/><circle cx="22" cy="31.5" r="1.8"/><circle cx="42" cy="23" r="1.8"/>',
  tbar: '<path d="M4 30L60 6"/><path d="M22 22.3v8M42 13.7v8"/><path d="M18 30.3h8M38 21.7h8"/>',
  chair2: '<path d="M4 12L60 4"/><path d="M22 9.4v12M42 6.6v12"/><path d="M18 21.4h8v4M38 18.6h8v4"/>',
  chair4: '<path d="M4 12L60 4"/><path d="M22 9.4v12M42 6.6v12"/><path d="M16 21.4h12v4M36 18.6h12v4"/>',
  chair6: '<path d="M4 12L60 4"/><path d="M22 9.4v11M42 6.6v11"/><path d="M14 20.4h16v5M34 17.6h16v5"/><path d="M14 17.4h16M34 14.6h16" opacity="0.55"/>',
  gondola: '<path d="M4 8L60 2"/><rect x="15" y="12" width="14" height="12" rx="3"/><path d="M22 6.5v5.5"/><rect x="37" y="10" width="14" height="12" rx="3"/><path d="M44 4v6"/>',
  piste: '<path d="M10 4c18 4 26 8 12 14s-6 10 22 14"/><path d="M18 4c18 4 26 8 12 14s-6 10 22 14" opacity="0.5"/>',
  catwalk: '<path d="M4 26c14-6 26-2 36-8s14-8 20-10"/><path d="M4 30c14-6 26-2 36-8s14-8 20-10" opacity="0.5"/>',
  road: '<path d="M6 32L22 4M42 32L30 4"/><path d="M27 8v4M28 17v4M29 26v4"/>',
  pipeline: '<path d="M4 26h40a6 6 0 0 0 6-6V6"/><circle cx="16" cy="26" r="2.5"/><circle cx="32" cy="26" r="2.5"/><circle cx="50" cy="12" r="2.5"/>',
  supply: '<path d="M4 30c8-2 10-10 18-10h20c8 0 10-8 18-12"/><path d="M8 34c4-1 6-3 8-6" opacity="0.5"/>',
  fan: '<circle cx="20" cy="16" r="9"/><path d="M20 25v8M14 33h12"/><path d="M33 10l8-3M34 16h9M33 22l8 3"/><path d="M48 9l.01 0M50 17l.01 0M47 25l.01 0M55 13l.01 0M56 21l.01 0"/>',
  lance: '<path d="M14 34L36 6"/><path d="M10 34h10"/><path d="M38 6l6-2M39 10l7 0M37 3l3-2"/><path d="M50 4l.01 0M52 10l.01 0M48 14l.01 0"/>',
  building: '<path d="M12 32V16l12-10 12 10v16z"/><path d="M36 32V20l8-6 8 6v12"/><path d="M20 32v-8h8v8"/>',
  parking: '<rect x="18" y="4" width="28" height="28" rx="5"/><path d="M28 26V10h6a5 5 0 0 1 0 10h-6"/>',
  food: '<path d="M18 4v12a4 4 0 0 0 4 4v12M14 4v8M22 4v8M44 32V4c-4 3-6 8-6 14h6"/>',
  tank: '<ellipse cx="32" cy="10" rx="20" ry="5"/><path d="M12 10v16c0 3 9 6 20 6s20-3 20-6V10"/>',
  bike: '<circle cx="16" cy="24" r="7"/><circle cx="46" cy="24" r="7"/><path d="M16 24l8-14h12l10 14M24 10l10 14M22 6h6"/>',
  walk: '<path d="M4 30c10-2 12-12 22-12s14 8 34-8" stroke-dasharray="4 4"/>',
  toboggan: '<path d="M4 6c10 4 8 12 20 14s12 8 36 12"/><path d="M4 10c10 4 8 12 20 14s12 8 36 12" opacity="0.5"/>',
  tree: '<path d="M20 4l10 14h-6l7 10H9l7-10h-6z"/><path d="M20 28v5"/><path d="M42 10l8 11h-5l6 8H35l6-8h-5z" opacity="0.6"/>',
  info: '<circle cx="32" cy="18" r="13"/><path d="M32 16v9M32 11h.01"/>',
  playground: '<path d="M10 32V12l8-8 8 8v20"/><path d="M26 20h14l6 12"/><path d="M10 20h16"/>',
  view: '<path d="M8 18s8-12 24-12 24 12 24 12-8 12-24 12S8 18 8 18z"/><circle cx="32" cy="18" r="6"/>',
};

export function artSvg(name: string, color = '#C9D6E3'): string {
  return `<svg viewBox="0 0 64 36" width="64" height="36" aria-hidden="true" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ART[name] ?? ART.info}</svg>`;
}
