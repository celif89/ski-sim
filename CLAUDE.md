# Symulator ośrodka narciarskiego – Pilsko

Realistyczny symulator budowy i prowadzenia ośrodka narciarskiego. Gracz zaczyna od pustej góry
(północne stoki Pilska nad Korbielowem, Beskid Żywiecki) i rozbudowuje ośrodek sezon po sezonie,
wyciąg po wyciągu. Pełna koncepcja gry: dokument „Symulator ośrodka narciarskiego — koncepcja gry”
(link: https://claude.ai/artifact/GcpTohSQ7CBMZAPtqafYGT).

## O właścicielu projektu

- Aleksander jest inżynierem konstruktorem, nie programistą. Cały kod pisze Claude.
- Nie ma czasu ręcznie sprawdzać wyników ani czytać kodu. Poprawność ma potwierdzać zestaw testów
  automatycznych i raporty generowane przez program.
- Komunikacja po polsku, prostym językiem, bez żargonu programistycznego. Na końcu każdej sesji:
  co zostało zrobione, jak to uruchomić i zobaczyć, co dalej.
- Dobrze rozumie fizykę, teren, nachylenia, warstwice i przekroje – w tych sprawach można mówić
  technicznie.

## Technologia

- TypeScript, rysowanie: PixiJS (WebGL), budowanie i serwer deweloperski: Vite.
- Testy: Vitest.
- Gra działa w przeglądarce. Później, jeśli się sprawdzi: aplikacja na Maca (Tauri lub Electron)
  z tego samego kodu – nie używać rozwiązań, które to uniemożliwią.
- Repozytorium Git: małe, opisane po polsku commity po każdym działającym kroku.

## Architektura – zasady obowiązkowe

1. **Symulacja oddzielona od grafiki.** Katalog `src/sim/` nie importuje niczego z PixiJS ani DOM.
   Musi dać się uruchomić w testach i w trybie bez grafiki.
2. **Jedna siatka terenu jako wspólny stan.** Warstwy komórek (wysokość, nachylenie, ekspozycja,
   pokrycie, śnieg, mikroklimat) trzymane w tablicach typowanych (`Float32Array` itd.), nie
   w obiektach na komórkę. Rozdzielczość siatki to parametr (start: 10 m, mapa ok. 4 × 4 km).
3. **Ciężkie obliczenia w Web Workerze.** Widok co klatkę tylko odczytuje stan.
4. **Wszystkie liczby w plikach danych** (`data/*.json`): klimat lokalizacji, typy wyciągów,
   armatki, koszty, progi trudności tras. Żadnych „magicznych liczb” w kodzie symulacji.
   Przy każdej wartości w JSON pole z jednostką i krótkim źródłem lub dopiskiem „do kalibracji”.
5. **Determinizm.** Cała losowość przez jeden generator z ziarnem (seed). Ten sam seed = ta sama zima.
6. **Jednostki SI w kodzie** (m, s, °C, kg, kWh). Nazwy zmiennych zawierają jednostkę, gdy nie jest
   oczywista (`snowDepthM`, `windSpeedMs`).

## Struktura katalogów (docelowa)

```
src/sim/       model świata: teren, słońce, pogoda, śnieg, naśnieżanie, ratraki, goście, ekonomia
src/render/    PixiJS: mapa, nakładki, interfejs
src/worker/    Web Worker: uruchamia symulację w tle, wymiana wiadomości z widokiem
src/tools/     narzędzia poza grą: konwerter NMT, symulacja bez grafiki z raportem
data/          pliki JSON z parametrami; data/maps/ – mapy terenu
tests/         testy Vitest
```

## Testy i kontrola realizmu

- Każdy moduł symulacji ma testy sprawdzające zachowanie fizyczne, np.:
  - przy +5 °C śniegu ubywa, przy −10 °C i opadzie przybywa,
  - stok północny trzyma śnieg dłużej niż południowy o tym samym nachyleniu,
  - 30 wygenerowanych zim ma średnie zgodne z profilem klimatycznym (w granicach tolerancji),
  - kolejka do wyciągu nigdy nie przekracza jego przepustowości,
  - początkujący nie wybierają czarnych tras.
- Przed zakończeniem każdej sesji: `npm test` musi przejść. Nie oznaczać pracy jako gotowej
  przy czerwonych testach.
- Tryb „przewiń zimę” (`npm run winter-report`) generuje raport HTML z wykresami grubości
  śniegu w punktach kontrolnych – to główne narzędzie Aleksandra do oceny realizmu jednym rzutem oka.
  Od etapu 2 istnieje raport klimatu (`npm run climate-report`) – zgodność generatora pogody z IMGW.

## Dane źródłowe

- Teren: NMT z Geoportalu (siatka 1 m lub 5 m), przeliczany na siatkę gry przez `src/tools/`.
  Wierzchołek Pilska leży po stronie słowackiej – na start mapa kończy się na granicy.
- Klimat: archiwum danych publicznych IMGW (danepubliczne.imgw.pl, dane dobowe i godzinowe);
  sprawdzić dostępność serii ze stacji na Hali Miziowej, w razie braku – najbliższe stacje górskie.
- Naśnieżanie i wyciągi: wartości startowe w koncepcji gry, do zastąpienia danymi producentów.

## Plan etapów

0. Szkielet: okno gry, przesuwanie i zoom.
1. Teren: import NMT, cieniowanie rzeźby, warstwice, nakładki nachylenia i ekspozycji, profil terenu.
2. Słońce i pogoda.
3. Model śniegu + raport „przewiń zimę”.
4. Budowa wyciągów i tras.
5. Goście (agenci): start 2 tys. jednocześnie, docelowo ok. 5 tys.
6. Sezon i ekonomia – pierwsza grywalna wersja.
7. Naśnieżanie i ratraki.
8. Anomalie, awarie, ratownicy, reputacja, konkurencja.
9. Dopracowanie, zapis gry, druga lokalizacja.

Kryteria odbioru każdego etapu są w dokumencie koncepcji. Pracować etapami, nie wybiegać do przodu.

## Stan prac

- **Etap 0 – zrobiony** (listopad 2026): szkielet, generator losowy z ziarnem, siatka terenu,
  przesuwanie i zoom, publikacja na GitHub Pages (workflow `.github/workflows/pages.yml`,
  testy blokują publikację).
- **Etap 1 – zrobiony** (listopad 2026):
  - mapa `data/maps/pilsko/`: E 521 500–525 500, N 184 850–189 350 (PUWG 1992), 400 × 450
    komórek po 10 m; NMT z WCS GUGiK (`DTM_PL-EVRF2007-NH`, siatka 1 m, uśredniona do 10 m),
    strona słowacka wycięta wg granicy z PRG (WFS) – w siatce NaN = „poza mapą”;
  - konwerter `npm run import-nmt` (`src/tools/importNmt.ts`), kafle źródłowe w `.cache/`
    (poza repozytorium); punkty kontrolne z usługi GUGiK „wysokość w punkcie” zapisane w map.json;
  - `src/sim`: PUWG 1992 ↔ stopnie (`geo.ts`), nachylenie/ekspozycja metodą Horna
    i cieniowanie (`terrainAnalysis.ts`), warstwice (`contours.ts`), profil (`profile.ts`),
    klasy nachylenia (`slopeClasses.ts`, progi w `data/slope-classes.json`);
  - widok: mapa bazowa jako jedna tekstura 2 m/px (cieniowanie + barwy + warstwice + opisy
    + granica), nakładki nachylenia i ekspozycji (klawisze 1–3), legenda, pasek stanu,
    narzędzie profilu (P); wygląd w `data/map-style.json`;
  - generator proceduralny z etapu 0 zostaje jako zapas (`settings.json`: `terrain.map = "procedural"`).
- **Etap 2 – zrobiony** (listopad 2026):
  - Słońce: algorytm NOAA (`sun.ts`), czas lokalny z czasem letnim UE (`time.ts`);
  - horyzont 32 kierunki (`horizon.ts`) z siatki gry + modelu okolicy 15 × 15 km
    (`horizon-dem.f32`, Copernicus GLO-30, `npm run import-horizon-dem`); w przeglądarce liczony
    w kilku wątkach (`worker/horizonPool.ts`) i zapamiętywany w IndexedDB;
  - promieniowanie (`radiation.ts`): Meinel + Laue, kąt padania, cienie, rozproszone z widokiem
    nieba, chmury Kasten–Czeplak; parametry `data/radiation.json`;
  - klimat: `npm run import-climate` → `data/climate/pilsko.json` (IMGW 2001–2025). Stacja „PILSKO”
    na Hali Miziowej (249190530, 1278 m) istnieje, ale jej pomiarów nie ma w archiwum publicznym
    (tylko bieżące odczyty w API). Odniesienie: Zawoja + Laliki (~700 m), opad: Korbielów (650 m),
    spadek temperatury: regresja 24 stacji (255–1990 m), wilgotność: Bielsko-Biała + Zakopane,
    wiatr na wysokości: Kasprowy Wierch;
  - generator pogody (`weather.ts`): Markow + gamma, AR(1), rozkład godzinowy, wysokość, rodzaj
    opadu, prognoza 7 dni; `WeatherModifier` – miejsce na anomalie (etap 8);
  - `Environment` (`environment.ts`) łączy wszystko dla wątku obliczeń;
  - raport `npm run climate-report` (publikowany jako `raport-klimatu.html`);
  - widok: panel daty/godziny z „odtwórz dzień”, nakładki 4–6, panel pogody.
- **Etap 3 – zrobiony** (listopad 2026):
  - pokrycie terenu: `npm run import-landcover` → `data/maps/pilsko/landcover.u8` (3 pasma: % lasu,
    kosodrzewiny/zarośli, zabudowy; ESA WorldCover 2021, 10 m, CC BY 4.0); las na mapie bazowej;
  - model śniegu (`snow.ts`, parametry `data/snow.json`): w każdej komórce 2 warstwy (SWE, woda
    ciekła, gęstość, temperatura, lód), krok 6 h; opad z poprawką na niedobór deszczomierza,
    gęstość świeżego śniegu Hedstrom–Pomeroy, gęstnienie Verseghy, albedo malejące z wiekiem,
    bilans energii z temperaturą powierzchni (krótkofalowe z cieniami, Brutsaert, turbulencja,
    sublimacja, ciepło z gruntu), deszcz wsiąka i zamarza (skorupa → „zlodzony”), las (korony
    zatrzymują 30 % opadu, 25 % promieniowania, wiatr × 0,3), przewiewanie (Winstral Sx w 8
    kierunkach, raz na dobę), 7 stanów jakości; `addSnow`/`removeSnow` – miejsce na naśnieżanie
    i ratraki (etap 7), bilans wody `SnowBalance`;
  - `snowSeason.ts` (sezon na mapie, promieniowanie bezchmurne co 14 dni i interpolowane),
    `snowWorld.ts` (w wątku obliczeń gry, stany zapamiętywane co 15 dni), `snowPoint.ts`
    i `snowCalibration.ts` (model w punkcie stacji na prawdziwej pogodzie),
    `radiationValidation.ts` (promieniowanie vs pomiary aktynometryczne);
  - dane kalibracyjne: `npm run snow-calibration-data` → `data/calibration/imgw-stations.json`
    (Korbielów 8 zim, Zawoja 10, Laliki 10; 2009/10–2018/19), `npm run radiation-validation-data`
    → `data/calibration/radiation-stations.json` (Bielsko-Biała, Kasprowy 2007–2014),
    `data/calibration/lajczak-1996.json` (Pilsko 1993/94);
  - kalibracja (4 parametry): poprawka opadu śniegu 1,0 → 1,3; gęstość graniczna mokrego śniegu
    700 → 500 kg/m³; tempo gęstnienia suchego 0,0025 → 0,001 1/h; wykładnik chmur Kastena–Czeplaka
    3,4 → 2,5. Wynik: średni błąd 6,3 → 4,5 cm, zaniżenie −5,9 → −1,3 cm, długość zalegania
    −13,6 → +0,2 dnia;
  - widok: nakładki 7 (grubość) i 8 (stan), „Przewiń sezon” (1/5/20 dni/s), odczyt pod kursorem;
  - raport `npm run winter-report` (`winter-report.ts`, sezony w wątkach `winterWorker.ts`),
    ustawienia `data/winter-report.json`, publikowany jako `raport-zimy.html` (ok. 8–10 min w CI).
- **Następny: etap 4 – budowa wyciągów i tras.**

Uwagi techniczne:
- Usługa WCS Geoportalu przy pobieraniu w obniżonej rozdzielczości (SCALESIZE) zwraca mapę
  z dziurami (brakujące arkusze w podglądach) – dlatego konwerter pobiera pełne 1 m kaflami.
- Pokrycie `DTM_PL-KRON86-NH_TIFF` (format TIFF) jest szybsze, ale w starym układzie wysokości
  (ok. 0,5 m niżej niż EVRF2007); używamy EVRF2007 (format ASCII), zgodnego z Geoportalem.
- Usługa GUGiK `GetHbyXY`: parametr x = N (geodezyjne X), y = E (geodezyjne Y).
- W chmurowym teście (grafika programowa, bez GPU) wygładzanie krawędzi (MSAA) spowalniało
  przesuwanie – jest wyłączone (`antialias: false`).
- Archiwum IMGW: stacje klimatologiczne nie mierzą wilgotności (status 8); posterunki opadowe nie
  mają wierszy dla dni bez opadu (brak wiersza = 0 mm, jeśli miesiąc ma dane); metadane stacji
  (współrzędne, wysokość) tylko z API `api/data/meteo` (stan bieżący).
- Copernicus DEM to model powierzchni (z lasem, średnio +10 m względem NMT) – poza mapą horyzont
  uwzględnia drzewa, na mapie nie (las dojdzie z pokryciem terenu).
- Parametry generatora pogody (stałe w miesiącu dla opadu, krzywa temperatury zachowująca
  średnie miesięczne) – inaczej sumy opadu w miesiącach sąsiadujących z dużą zmianą (IV → V)
  były zawyżone o ~20 %.
- `npm run climate-report` liczy horyzont w Node (ok. 10 s); test zgodności 30 zim używa tolerancji
  3 × błąd średniej z 30 lat (z rzeczywistej zmienności z roku na rok).
- Model śniegu: jeden dzień na pełnej mapie ok. 100–170 ms (1 wątek). Przyspieszenia: kroki liczone
  w pasach wysokości co 5 m (pogoda wspólna dla pasa), tablica ciśnienia pary nasyconej, pamięć
  wschodów Słońca w `hourlyAt` (bez niej kalibracja trwała 43 s zamiast 2 s).
- Pomiar grubości IMGW (godz. 7 UTC dnia d) porównujemy ze stanem modelu na koniec dnia d − 1.
- Posterunek Korbielów nie mierzy temperatury – w danych kalibracji temperatura z Zawoi i Lalik
  przeniesiona gradientem na 650 m.
- Słabe strony (do poprawy później): przewiewanie nie odtwarza kontrastu „zagłębienia ~2× więcej
  niż wypukłości” (Łajczak) – śnieg wywiany odkłada się głównie na skraju lasu; parametry wiatru
  i lasu z literatury, bez kalibracji; gradient opadu z wysokością słabo określony (R² 0,09);
  stan „zlodzony” częsty (ok. 1/4 dni I–II na 1250 m) – skorupa znika dopiero po ≥ 5 mm świeżego
  śniegu; na pogodzie z generatora w punktach stacji (650–700 m) wychodzi o 5–21 dni pokrywy więcej
  niż w pomiarach 2009–2019 (na prawdziwej pogodzie zgodnie) – sprawdzić na dłuższej serii
  pomiarów 2001–2025; maksimum grubości na Hali Miziowej wypada w modelu w połowie lutego,
  a wg Łajczaka pod koniec marca, zanik ok. 3 V (Łajczak: 10 V w 1994, norma 24 V).

## Ustalenia rozgrywki

- Jeden dzień sezonu przy ×1 to ok. 10 minut realnych; dostępne ×5 i ×20, noc przewija się sama.
- Jeden ośrodek naraz; nowa lokalizacja = nowa rozgrywka.
- Pozwolenia środowiskowe pomijamy. Wycinka kosztuje i trwa.
- Sezon letni – później.
- Grafika 2D z góry, cieniowanie rzeźby jak na mapach topograficznych.
