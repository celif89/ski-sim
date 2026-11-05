/**
 * Zegar gry: upływ czasu w grze z prędkością ×1 / ×5 / ×20 (lub pauza). Przy ×1 doba trwa
 * gameDayDurationS sekund realnych; noc (od pół godziny po zachodzie do pół godziny przed
 * wschodem Słońca) przewija się nightSpeedup razy szybciej. Bez DOM – liczy tylko nową godzinę
 * i liczbę dni, o które przesunęła się data.
 */

export interface GameClockParams {
  /** Długość doby przy ×1 [s czasu rzeczywistego]. */
  gameDayDurationS: number;
  /** Mnożnik prędkości nocą. */
  nightSpeedup: number;
}

export interface ClockStep {
  /** Nowa godzina 0–24 [h]. */
  hour: number;
  /** O ile dni przesunąć datę (0 lub więcej). */
  daysAdvanced: number;
}

/** Margines wokół wschodu i zachodu, w którym czas płynie normalnie [h]. */
const TWILIGHT_MARGIN_H = 0.5;

/** Czy godzina hour jest „nocą” (szybkie przewijanie). Bez danych o Słońcu – nigdy. */
export function isNightHour(hour: number, sunriseHour: number | null, sunsetHour: number | null): boolean {
  if (sunriseHour === null || sunsetHour === null) return false;
  return hour < sunriseHour - TWILIGHT_MARGIN_H || hour > sunsetHour + TWILIGHT_MARGIN_H;
}

/**
 * Krok zegara o dtRealS sekund realnych przy mnożniku speed (0 – pauza). Długie kroki dzielone
 * na kawałki, żeby granica dzień/noc była uwzględniona dokładnie.
 */
export function advanceClock(
  hour: number,
  dtRealS: number,
  speed: number,
  p: GameClockParams,
  sunriseHour: number | null,
  sunsetHour: number | null,
): ClockStep {
  if (speed <= 0 || dtRealS <= 0) return { hour, daysAdvanced: 0 };
  const hoursPerRealS = (24 / p.gameDayDurationS) * speed;
  let h = hour;
  let days = 0;
  let left = dtRealS;
  const maxChunkH = 0.25;
  while (left > 1e-9) {
    const rate = hoursPerRealS * (isNightHour(h, sunriseHour, sunsetHour) ? p.nightSpeedup : 1);
    const dt = Math.min(left, maxChunkH / rate);
    h += rate * dt;
    left -= dt;
    while (h >= 24) {
      h -= 24;
      days++;
    }
  }
  return { hour: h, daysAdvanced: days };
}
