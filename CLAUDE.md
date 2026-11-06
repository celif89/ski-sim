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
- **Zmiany wypychać od razu na gałąź `main`** (po zielonym `npm test` lokalnie) – Aleksander sprawdza
  poprawki na opublikowanej stronie. Bez osobnych gałęzi i PR, chyba że poprosi inaczej. Workflow
  GitHub Pages i tak uruchamia testy i nie publikuje przy czerwonych.

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
- **Etap 3b – zrobiony** (listopad 2026): nadwyżka śniegu w wygenerowanych zimach.
  - dane kalibracyjne rozszerzone do zim 2001/02–2024/25 (Korbielów mierzy śnieg od 2010; od ok. 2020
    Zawoja i Laliki tylko opad i śnieg – temperatura z Bielska-Białej z poprawką miesięczną, pole
    `temperatureFromBielskoDays`; do kalibracji tylko zimy z mierzoną temperaturą: 49 zim 2001–2021);
  - przyczyny nadwyżki (model na pogodzie z generatora 94,4 dnia z pokrywą wobec 86,8 w pomiarach):
    (1) opad z prawdziwych dni był ustawiany „w południe” (najcieplejsza pora → za dużo deszczu), co
    kalibracja wyrównała poprawką deszczomierza 1,3 – w generatorze pora opadu jest losowa, więc ten
    sam mnożnik dawał za dużo śniegu; teraz opad z prawdziwych dni rozłożony na całą dobę
    (`observedToDailyWeather`), poprawka 1,3 → 1,2; (2) w generatorze temperatura dnia z opadem nie
    zależała od wielkości opadu – w danych IMGW zimą silny opad przychodzi z cieplejszym powietrzem
    (styczeń: różnica 3,75 °C między najsłabszym a najsilniejszym opadem); nowe pole profilu
    `wetDayAnomalyPerPercentileC` (import-climate), w generatorze przesunięcie liniowe względem
    percentyla sumy dobowej (`gammaCdf`);
  - wynik: generator 87,9 dnia wobec 86,8 w pomiarach; kalibracja na 49 zimach: błąd 5,66 → 5,03 cm;
  - raport zimy: rozkład zim z generatora (100 zim) obok prawdziwych 2001–2025 i modelu na prawdziwej
    pogodzie (dni z pokrywą, maksimum, pojawienie się, zanik; kropka = zima) i tabela pogody „jak
    widzi ją model” (temperatura opadu, śnieg, odwilże); testy `tests/snowClimate.test.ts`.
- **Etap 4 – zrobiony** (listopad 2026): budowa wyciągów i tras (bez pieniędzy i czasu – etap 6).
  - dane: `data/lifts.json` (8 typów: taśma, talerzyk, orczyk, kanapa 2s/4s, 4d/6d, gondola 8),
    `data/pistes.json` (klasy, odcinek 50 m, ostrzeżenia, koszty, sieć, OSM), `data/construction.json`
    (wycinka); wartości orientacyjne „do kalibracji” – zastąpić danymi producentów;
  - `lifts.ts`: profil pod linią co 5 m, automatyczne podpory (przęsło ≤ maxSpanM, prześwit ≥
    minClearanceM poza strefą stacji 25 m; najpierw podnoszenie podpór, potem dzielenie przęsła),
    lina = cięciwa − zwis paraboliczny 4·f·t(1−t), f = 0,04·rozpiętość; wyciągi powierzchniowe:
    nachylenie i przechył toru średnio na 20 m; błędy: poza mapą, krzyżowanie, za długi, w dół,
    za mały prześwit; moc = Q·m·g·Δh/η + bieg jałowy + opory; koszt (stacje, linia, podpory,
    wycinka), czas budowy;
  - `pistes.ts`: oś z szerokością w punktach → obrys na siatce; wysokość osi = średnia w poprzek
    (5 punktów); kolor = najtrudniejszy odcinek 50 m, czyli nachylenie utrzymujące się na całym
    odcinku (minimum z kawałków 10 m) – krótszy stromy fragment nie zmienia koloru; ostrzeżenia:
    spadek poprzeczny > 20 %, podejście;
  - `resort.ts`: układ (`ResortLayout`, zapis JSON, `LayoutHistory` cofnij/ponów), maska wycinki
    i `applyClearing`, graf sieci (`buildNetwork`: węzły – stacje, bazy, połączenia tras; krawędzie –
    wyciągi w górę, odcinki tras w dół; ostrzeżenia „donikąd” i „bez zjazdu”) – podstawa etapu 5,
    `compareRealPistes` (OSM);
  - śnieg: `SnowWorld.setLandCover` (worker `setLandCover`) – nowe pokrycie po wycince, sezon od nowa
    (promieniowanie zostaje);
  - widok: `buildController.ts`, `buildPanel.ts`, `buildProfile.ts`, `resortLayer.ts`; klawisze
    V L T O B N R, `[` `]`, Delete, Ctrl+Z/Y; zapis w localStorage (`ski-sim:osrodek:pilsko`);
    `MapInput` ma przechwytywanie przeciągania dla narzędzi;
  - OSM: `npm run import-osm-resort` (API 0.6 kaflami – Overpass z chmury nie działał) →
    `data/maps/pilsko/osm-resort.json` (12 wyciągów, 29 odcinków tras); `npm run piste-check`:
    nasza klasyfikacja 6 z 10 tras zgodna z oficjalnym kolorem, pozostałe różnią się o jedną klasę
    (4 i Dinbo: zielone → niebieskie, 6: niebieska → czerwona przez odcinek 100 m o nachyleniu 30 %
    w przebiegu OSM, 5a: czerwona → czarna – średnio 37 %, 50 m po 49 %).
- **Etap 4b – zrobiony** (listopad 2026): oprawa graficzna w stylu A („ilustrowana mapa narciarska”),
  tylko warstwa rysowania (`src/render`), symulacja bez zmian (siatka 10 m):
  - teren: `terrainRenderer.ts` + `terrainShader.ts` – piramida kafli 256 px (8, 4, 2, 1, 0,5,
    0,25 m/px) liczonych shaderem na żądanie (budżet na klatkę, pamięć LRU, unieważnianie przy
    zmianie śniegu, wycinki, obrotu); śnieg z modelu (grubość, stan), cieniowanie niebieskawe,
    las – świerki z boku (skrót PCG identyczny w TS i GLSL: `illustration.ts`), kosodrzewina,
    przecinki i trasy z maski 2 m/px; parametry w `data/map-style.json` (sekcja `illustrated`);
  - poziomy szczegółowości (`lodWeights`, płynne przejścia): > ~4 m/px cały ośrodek, ~1–4 m/px
    pojedyncze drzewa z cieniem, < ~1 m/px faktura śniegu wg stanu (`surfaceKind`); zoom do 0,25 m/px;
  - ślady: osobna nakładka (`TRACKS_FRAGMENT`) z buforów 2 m/px (`TrackBuffer`): sztruks, muldy,
    ślady nart; zanik z czasem i opadem; wysyłka do karty tylko widocznego pasa wierszy;
  - obiekty ruchome: `movers.ts` (kontenery cząstek, atlas, cienie, światła ratraka nocą) – gotowe
    na gości (etap 5) i ratraki (etap 7); `demoScene.ts` – scena demonstracyjna (usunięta w etapie 5; menu `Dev`,
    klawisz `` ` ``, adres `?demo=N`);
  - wektory: `resortLayer.ts` – trasy (biała obwódka), wyciągi z podporami i krzesełkami (prędkość,
    `carrierSeats` w `lifts.json`), budynki/drogi/parkingi/szczyty z OSM (`osm-context.json`),
    etykiety Barlow Condensed bez nakładania, `labels.json`;
  - światło pory dnia ze Słońca (`lightingForSun`), noc z oświetleniem tras; opad na ekranie
    (`weatherFx.ts`);
  - widok domyślny od Korbielowa (mapa obrócona o 180°, `view.rotatedByDefault`), róża kierunków;
  - interfejs w stylu A (`topBar.ts`, `buildBar.ts`, `style.css`): karta czasu z kalendarzem,
    plakietka pogody, prędkość czasu (pauza, ×1, ×5, ×20 – zegar gry `sim/gameClock.ts`, parametry
    `time.gameDayDurationS` i `time.nightSpeedup`), dolny pasek budowy z ikonami, „Nakładki”;
  - testy `tests/illustration.test.ts` (LOD, determinizm drzew, faktury, światło, zegar);
  - pomiar (kontener bez karty graficznej, grafika liczona przez procesor – SwiftShader): 2000
    narciarzy, praca kodu gry na klatkę 3,8–5,4 ms (cała mapa 5,4 ms, 0,25 m/px 4,1 ms) – mieści się
    w 20 ms (50 kl./s); samych klatek na sekundę nie da się tu zmierzyć (5–7 kl./s, pusta scena
    PixiJS ok. 13–15 kl./s) – do sprawdzenia na Macu z kartą graficzną.
- **Etap 5 – zrobiony** (listopad 2026): goście (agenci), bez ekonomii i popytu (etap 6):
  - dane `data/guests.json`: scenariusz dnia (liczba gości – parametr, `?goscie=N` w adresie),
    umiejętności (4 poziomy: najtrudniejsza i ulubiona klasa trasy, prędkość, nachylenie komfortowe,
    lód/muldy/puch, ryzyko wypadku), typy grup (narciarz, snowboardzista, rodzina z dziećmi, grupa
    szkolna), cierpliwość, potrzeby, wybory, ruch, zadowolenie, wypadki, wpływ na śnieg;
  - `sim/guests.ts` (`GuestDay`): tablice liczb, stały krok 1 s (ten sam seed = ten sam dzień
    niezależnie od prędkości zegara); grupa = jednostka ruchu (wspólne decyzje, prędkość
    najsłabszego, na górze czeka na resztę); kolejka w kolejności przybycia, krzesełka w stałym
    rytmie 3600·miejsca/przepustowość (nie da się przekroczyć), przejazd = długość/prędkość;
    wybór (softmax): wartość zjazdu z programowania dynamicznego po grafie (klasa wobec
    umiejętności, długość) + preferencje lidera (długie, puch, spokój) − tłok − zły śnieg −
    przewidywana kolejka (kara za minutę, za przekroczenie cierpliwości); początkujący nie wjeżdża
    tam, skąd nie ma zjazdu na jego poziom; rezygnacja z kolejki (inny wyciąg, potem spacer albo
    do domu po 2,5 × cierpliwość); głód, zmęczenie, zimno (temperatura odczuwalna z wiatrem,
    krzesełko ×1,8), przerwy w bazie/schronisku, wyjazd (plan, zmęczenie, zimno, pogoda, śnieg,
    kolejki, brak tras na poziom, zamknięcie 16:00 – kolejka dowożona); wiatr ponad próg typu
    zatrzymuje wyciąg; ruch po korytarzu trasy (oś + pas + slalom, odstęp od innych, zwalnianie);
    wypadki (tłok, lód, zmęczenie, trasa za trudna) – zdarzenie i ikona (ratownicy – etap 8);
    zadowolenie z 5 części (jazda/kolejki, śnieg, tłok, pogoda, dopasowanie) → ocena 1–5;
  - `sim/guestNetwork.ts` (sieć dla gości: miejsca – stacje bliżej niż 90 m, odcinki tras, wyciągi),
    `resort.ts`: `layoutFromOsm` – prawdziwy Pilsko z OSM jako układ do gry (przycisk w panelu
    „Goście”), `closed` na wyciągach i trasach;
  - wpływ na śnieg `sim/skierTraffic.ts`: przejazdy ubijają (gęstość → 420 kg/m³), zsuwają śnieg
    w dół na stromiznach (przetarcia; masa zachowana), tworzą muldy (`SnowState.moguls`, zasypuje
    świeży śnieg, niszczy odwilż); `SnowWorld.setTraffic` – ruch zapamiętany na każdy dzień
    i doliczany także przy przeliczaniu sezonu; muldy w teksturze terenu (dolne 4 bity kanału G);
  - wątek `worker/guestWorker.ts` (liczy bez przerwy do godziny zegara, ramki co ~25 ms;
    przewijanie do godziny w kawałkach), widok `render/guestController.ts`, `guestPanels.ts`
    (panel „Goście”, karta gościa, raport dnia), `movers.ts` (narty, deska, kolejka, krzesełko,
    pieszo, dzieci mniejsze; warstwa nad liniami tras), nakładki 9 (ruch) i K (kolejki),
    prędkość 1:1; scena demonstracyjna usunięta;
  - testy `tests/guests.test.ts` (17): przepustowość, czas przejazdu, początkujący/eksperci,
    kolejki a zadowolenie i przenoszenie się, grupy, zamknięte trasy, korytarz trasy, śnieg,
    determinizm, prawdziwy Pilsko;
  - pomiar: wątek gości przy ok. 2000 osób na stoku naraz – 7500 s gry na sekundę (×1 wymaga 144,
    ×20 – 2880; zapas 2,6× przy ×20); ekran: praca kodu na klatkę 1,5–5,4 ms przy ok. 1700 postaciach
    (limit 50 kl./s = 20 ms); samych kl./s w kontenerze bez karty graficznej nie da się zmierzyć (3–6);
  - obserwacja: na prawdziwym Pilsku (nasza klasyfikacja tras) początkujący mają w zasięgu
    praktycznie tylko Dinbo – kolejka ~25 min, wielu wyjeżdża „przez kolejki”; co druga grupa ma
    w składzie początkującego (dzieci, grupy szkolne) – do kalibracji udziałów.
- **Etap 5b – zrobiony** (listopad 2026): edycja geometrii i śnieg decydujący o jeździe.
  - edycja tras myszą (`buildController.ts`: uchwyty `EditHandle` rysowane w `resortLayer.ts`):
    punkty osi (przeciąganie, „+” w połowie odcinka, prawy przycisk / Delete), szerokość w punkcie
    (kwadraciki po bokach); w trakcie przeciągania liczy się tylko ten obiekt (profil, klasa,
    wycinka, koszt), całość po puszczeniu; uchwyt ma pierwszeństwo przed kliknięciem gościa;
  - wyciąg jako łamana (`lifts.ts`): `bends` (`LiftBend`, `mid` – stacja pośrednia), `liftPath`,
    `bendAngleDeg`; limit kąta, koszt, zajęty teren w `data/lifts.json` (`maxBendDeg`: talerzyk 6°,
    orczyk 8° – koła odchylające, kanapy stałe 45°, wyprzęgane 60°, gondola 90°; `bendCostPln`,
    `midStationCostPln`, `allowsMidStation`, `bendFootprintM`, `downhillRiding` – gondolą można
    zjechać; wszystko „do kalibracji”); podpory: stacja kątowa jest podporą o wysokości stacji
    (strefa stacji bez sprawdzania prześwitu), koła odchylające orczyka – podporą z prześwitem
    sprawdzanym obok; `retowerLift` – podpory ręczne zostają (rzut na nową linię), jeśli leżą na
    linii, z dala od stacji i mają dopuszczalną wysokość; przeciąganie stacji dolnej/górnej i załamań;
  - sieć: stacja pośrednia = węzeł `W:pośrN` (`liftMid`), krawędzie wyciągu między kolejnymi
    przystankami; goście (`guestNetwork.ts`: `NetLift.stops`, `NetBoarding`) wsiadają na wolne
    miejsca na przystankach pośrednich i wysiadają na dowolnym; wyciąg bez otwartej trasy w dół
    z żadnego przystanku nie pracuje (`liftHasDescent`), chyba że `downhillRiding` (gondola –
    zjazd wyciągiem);
  - podłoże (`ground.ts`, parametry `data/construction.json`, sekcja `ground`): las (≥ 40 % lasu),
    kamienisty (kosodrzewina ≥ 40 % – rumowisko, albo nachylenie ≥ 70 %), łąka naturalna; po budowie
    wycięty las → pniaki, trasa z `graded` → łąka wyrównana; wyrównanie kosztuje (łąka 6, pniaki 20,
    kamienie 40 zł/m², 4 dni/ha); nakładka G;
  - śnieg a jazda (`snowRiding.ts`, `data/snow.json` sekcja `riding`): baza ubita = SWE / 420 kg/m³;
    minimum: łąka wyrównana 15 cm, łąka 25, pniaki 40, kamienie 70 (źródła w pliku: Umweltbundesamt
    TOU-I-2, Blick 2011, Chestnut Mountain, Snoqualmie); `thinSegments` (ostrzeżenia na otwartych
    trasach – panel „Goście”, czerwony pas na mapie i profilu), `thinField` (pole 0–1 dla gości);
    pod kursorem grubość, baza ubita, potrzebna baza, podłoże;
  - goście na zbyt cienkiej bazie (`data/guests.json`, sekcja `thinBase`): wolniej, wypadki ×(1+4·s),
    uszkodzenia sprzętu (raport dnia), niższa ocena śniegu, omijanie takich tras w wyborze;
  - otwarte/zamknięte: trasy i wyciągi (przycisk w profilu), cały ośrodek (`resortOpen` w układzie,
    pole w panelu „Goście”; zamknięty – dzień bez gości);
  - przy okazji: panel profilu dostał jasne tło stylu A (wcześniej ciemne półprzezroczyste z ciemnym
    tekstem), wykres na ciemnym tle;
  - testy `tests/editing.test.ts` (16).
  - obserwacja: zima 2026/27 z generatora jest słaba (na początku lutego odwilż, średnio < 1 cm na
    mapie) – na naturalnym śniegu trasy Pilska przez większość sezonu dostają ostrzeżenia; bez
    naśnieżania (etap 7) gra będzie wymagać zamykania tras.
- **Etap 6 – zrobiony** (listopad 2026): sezon i ekonomia – pierwsza grywalna wersja.
  - dane `data/economy.json` (każda liczba ze źródłem lub „do kalibracji”): kalendarz roku, kariera
    (15 mln zł, start 1 V 2026, debet 1 mln, bankructwo po 90 dniach na minusie), kredyt (7,5 %/rok:
    WIBOR 3M 3,82 % + marża; do 15 lat; limit 70 % majątku i gotówki), karnety (dzienny 170, 4 h 135,
    2 h 100 zł, punkt 4 zł; ulga 80 %; Pilsko/Wisła/Szczyrk/Zwardoń 2024–26), godziny, popyt, skład gości
    (tydzień/weekend/ferie), ferie 2026 wg MEN (3 tury) z wagami regionów (śląskie 0,42, małopolskie
    0,24), koszty (energia 1,3 zł/kWh, płaca 36 zł/h + 21 %, ratownicy, przeglądy UDT, ubezpieczenie
    0,4 %, utrzymanie 1–2 %, stała załoga, ratrakowanie tymczasowe 120 zł/ha – usunięte w etapie 7), budowa zimą ×0,25
    tempa i ×1,25 ceny, reputacja, model zgrubny, konkurencja (4 wymyślone ośrodki), budynki
    (parking 300 aut, gastronomia, wypożyczalnia, szkółka);
  - `src/sim`: `calendar.ts` (pory roku, ferie – ten sam tydzień ISO co wzór, święta), `economyParams.ts`,
    `weatherBook.ts` (pogoda i prognoza dla ekonomii bez terenu – ta sama seria co Environment),
    `competition.ts` (śnieg konkurentów: model w punkcie + naśnieżanie), `economy.ts` (GameState, budowy
    w czasie – `reconcileConstruction` przy każdej zmianie układu, fakty o ośrodku, śnieg na trasach,
    popyt: pula regionu × dzień × miesiąc × prognoza × szum; udział = A/(A+ΣA_konk+A_inne), A = km^0,7 ×
    śnieg^1,5 × (reputacja/3,5)^1,5 × (cena/rynek)^−1,6; parking; karnety – najtańszy wystarczający;
    koszty dnia; raty co miesiąc; przeglądy 1 X; reputacja z zanikiem 0,997/dzień; raport roku gry
    1 V–30 IV), `gameSave.ts` (zapis: stan + układ + przejazdy gości rzadko zakodowane),
    `headlessGame.ts` (gra bez grafiki: Environment + SnowWorld + ekonomia, dni zgrubne lub z gośćmi);
  - goście: `GuestDay` – godziny i skład z planu dnia, `economySummary()`; poprawka: gość, który
    wyjechał bez zjazdu (brak trasy na jego poziom), ocenia dzień na 2/5 (`noSkiSatisfaction`; wcześniej 5);
  - model zgrubny dnia (dni przewijane): cykl = wjazd + zjazd (3,5 m/s), czekanie z bilansu
    przepustowości, pobyt × exp(−czekanie/25 min), goście bez trasy na poziom – od razu odjeżdżają;
    skalibrowany na symulacji gości (orczyk 840 m, 100–1200 gości: ocena ±0,2, przejazdy ±10 %);
  - widok: `gameController.ts` (zamykanie dni po kolei przy przewijaniu, plan dnia → goście, budowy →
    plac budowy, autozapis w IndexedDB `ski-sim-gra`), `gamePanels.ts` (Finanse, Cennik i godziny,
    Raport sezonu, ekran startowy); budynki w narzędziu B (`layout.buildings`, `bases[].typeId`); latem
    zegar ×7; w karierze nie można cofać czasu; `?tryb=kariera|piaskownica|widok`;
  - raport `npm run economy-report` (publikowany jako `raport-ekonomii.html`, ok. 1,5 min): orczyk
    Korbielów–Buczynka 788–1009 m + 2 trasy (obie czerwone – stok ok. 28 %) + parking, 10 sezonów:
    średnio 43 dni otwarte, 6,1 tys. gości, wynik +0,19 mln zł/rok (od −0,29 do +0,57), budowa 4,97 mln –
    bez naśnieżania inwestycja nie zwraca się w 10 lat; ok. 1/3 gości (początkujący) odjeżdża bez trasy
    na swój poziom;
  - testy `tests/economy.test.ts` (15), `tests/economyFixture.ts`.
- **Etap 7 – zrobiony** (listopad 2026): naśnieżanie i ratraki; tymczasowe ratrakowanie za hektar usunięte.
  - dane `data/snowmaking.json` (wartości startowe z sekcji „Dane do kalibracji” koncepcji + producenci,
    źródła przy każdej liczbie): woda (ujęcie 60 m³/h latem, zimą ×0,4, po suchym miesiącu mniej –
    opad z 30 dni wobec normy; napełnianie V–XI), pompowanie (η 0,75, straty 20 m/km, ρ, g), taryfa nocna
    ×0,75 22–6, rurociąg 450 zł/m, wykop tylko V–X, hydranty co 60 m (18 tys. zł), śnieg techniczny
    (gęstość 500 przy −2,5 °C → 400 przy −8 °C Twb, woda ciekła 6 % przy progu, straty 12 %, pryzma
    > 8 mm SWE), armatki: śmigłowa (150 tys., krzywa Twb −2,5…−15 °C → 8…90 m³/h, 1,5 kWh/m³, ciśnienie
    na dyszy 150 m, przestawna) i lanca (50 tys., od −4 °C, 5…45 m³/h, 0,65 kWh/m³, 250 m); budynki:
    ujęcie, zbiorniki 20/50/100 tys. m³, pompownie 150/300/600 m³/h, przyłącza 500/1000/2000 kW, garaż
    (3 ratraki), punkt kotwienia (lina 1000 m); ratraki: standardowy i z wyciągarką (wzór PistenBully 600:
    5,5 m, 8 / 6,5 km/h, 22–25 l/h), paliwo, serwis, leasing 2,2 %/mies., awarie (1 %/noc × (1 + 0,25 ×
    wiek)), okno 17:30–7:30, max 11 h, nachylenie +3 %/% ponad 15 %, wyciągarka od 40 %, świeży śnieg,
    pryzmy 400 m³/h; dane kalibracyjne (woda 3501 m³/ha, energia 24 449 kWh/ha, 5,4 kWh/wizytę, 4 €/m³);
  - `src/sim/snowmaking.ts`: temperatura mokra (Stull 2011), wydajność z krzywej, gęstość i woda ciekła
    śniegu technicznego, wysokość podnoszenia = Δz + straty w rurach + ciśnienie dyszy, energia pompowania
    ρ·g·h·V/η, rurociągi i hydranty (`pipelineHydrants`, `connectPipelines` – połączenie z pompownią),
    `runSnowmakingDay` (godzina po godzinie: priorytet, potem najzimniej; limity pompowni, zbiornika
    – nigdy < 0 – i mocy przyłącza razem z wyciągami; automat nie naśnieża otwartej trasy w godzinach
    pracy; ręczne on/off), `depositSnow` (armatka celuje w oś trasy do zasięgu rzutu, wiatr znosi
    2,5 m na 1 m/s – część poza trasę);
  - `src/sim/snowOps.ts`: operacje dnia na modelu śniegu (`SnowState.pileMm`, `techMm`): dodanie
    śniegu technicznego w pryzmach, ratrakowanie grupami (rozepchnięcie pryzm z zachowaniem masy, muldy
    0, gęstość; tryby: mróz – twarda 480, odwilż – mokra 450, mokry śnieg ubity przed mrozem ≤ −3 °C –
    lód); `SnowWorld.setOperations` jak `setTraffic` (zapamiętane na dzień, przeliczane przy cofnięciu);
  - `src/sim/grooming.ts`: czas pracy = powierzchnia / (szerokość × prędkość) × (1 + nachylenie) ×
    (1 + świeży śnieg) + pryzmy / 400 m³/h; `planNight` (priorytety, ręczny przydział albo automat –
    ratrak, który najwcześniej skończy; strome odcinki tylko ratrakiem z wyciągarką i z kotwą w zasięgu;
    czego nie zdąży do rana – część trasy nieratrakowana), `breakdownTonight`;
  - `src/sim/operations.ts`: `infraFacts` (co zbudowane i połączone), `blockedPistes` (pryzmy na trasie
    → zamknięta; ratrakowanie w dzień → zamknięta), `runDayOperations` (doba: zbiornik, plan naśnieżania,
    noc ratraków, koszty: energia naśnieżania z taryfą, woda, paliwo, operatorzy z dodatkiem nocnym,
    serwis, leasing, naprawy), `previewDayOperations` (to samo na kopii stanu – plan na dziś, przewidywany
    koniec nocy), `acquireGroomer`;
  - ekonomia: nowe pozycje kosztów (energia naśnieżania, woda, paliwo, operatorzy, serwis, leasing,
    naprawy) i wydatek „zakup ratraków”, budowy „tylko latem” (rurociąg, zbiornik, ujęcie – postęp tylko
    V–X), `DayRecord`: śnieg, woda, energia, paliwo, trasy ratrakowane, nieukończone, `techOpen` (dzień
    otwarty, a na samym śniegu naturalnym ponad połowa tras byłaby za cienka); zapis gry z operacjami;
  - widok: narzędzia rurociągu (`H`) i armatek (`J`) w `buildController.ts`, budynki naśnieżania w
    narzędziu B; `resortLayer.ts` – rurociągi, hydranty, armatki, chmury śniegu z wiatrem; `opsView.ts` –
    ratraki na trasach w nocy (przejazdy tam i z powrotem, sztruks w `terrain.groom`); `snowPanels.ts` –
    panel „Naśnieżanie i ratraki” (zbiornik, moc vs limit z wykresem doby, armatki, flota – zakup/leasing,
    noc), „Plan naśnieżania”, „Plan nocy” (z przewidywanym przebiegiem); nakładka `M` „Naśnieżanie teraz”
    (temperatura mokra); raport sezonu z sekcją naśnieżania;
  - raport ekonomii: ten sam orczyk z naśnieżaniem (25 armatek, zbiornik 50 tys. m³, 1 ratrak) na 30
    zimach obok wersji bez naśnieżania + tabela kalibracji – WYNIKI_30_ZIM;
  - testy `tests/snowmaking.test.ts` (12): Twb ponad progiem → 0, zimniej → więcej; energia ρgh/η;
    zbiornik ≥ 0; limit mocy; stromizna bez wyciągarki nieratrakowana; czas pracy ze wzoru; pryzmy
    blokują odcinek; mokry śnieg ubity przed mrozem → lód; wiatr znosi poza trasę; 30 zim z i bez.
- **Następny: etap 8 – anomalie, awarie, ratownicy, reputacja, konkurencja.**

Uwagi techniczne:
- Ekonomia (6): pytania o śnieg do wątku obliczeń idą po kolei (`snowSerial`) – równoległe się
  „zastępowały” i przerywały liczenie; promieniowania na sezon wątek już nie przerywa (wspólne dla
  sezonu). Podczas przeliczania dni mapa nie pyta o śnieg (`game.busy`), potem `onCaughtUp`.
  Zamknięcie dnia: jeśli wątek gości skończył ten dzień – wynik z symulacji (`agentOutcome`), inaczej
  model zgrubny. Latem (V–IX) śniegu nie liczymy (null).
- Edycja (5b): przeciąganie zmienia `this.layout` na miejscu i liczy tylko analizę edytowanego
  obiektu (`applyEdit`); historia (`LayoutHistory`) dostaje stan sprzed przeciągania przy puszczeniu.
  Kliknięcie: najpierw uchwyt edycji, potem postać gościa (promień 9 px), potem wybór obiektu.
- Goście: wątek liczy kroki po 1 s do godziny zegara; zegar czeka, gdy wątek zostaje > 15 min gry
  w tyle; jedna klatka przesuwa zegar najwyżej o 0,25 s realne (przy kilku kl./s gra zwalnia).
  Postacie i nakładka ruchu są w kontenerze `worldOver` nad warstwą ekranu (linie tras).
  Krzesełka: pozycja = (czas gry · prędkość) mod odstęp – tak samo jak odjazdy w symulacji.
- PixiJS 8: `BufferImageSource.update(początek, koniec)` – zakres w tekselach, koniec wyłączny
  (nie liczba!). Shadery GLSL zaczynać od `#version 300 es`. Kafle terenu liczy shader raz
  (render do tekstury), co klatkę tylko lekkie nakładki – pełnoekranowy shader był za wolny.
- Wzory o okresie mniejszym niż ~2 px migoczą – `detailAmp` w shaderze wygasza je przy oddaleniu;
  sztruks na rysunku ma stylizowany okres 1 m (w naturze 2–3 cm).
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
- Prawdziwa pogoda dla modelu: suma dobowa opadu rozłożona równo na 24 h (godzin opadu nie znamy;
  ustawienie „w południe” zawyżało temperaturę opadu o ok. 2–3 °C).
- Porównując generator z pomiarami, liczyć ≥ 100 zim: 30 zim gry (2026–2055) jest przypadkiem
  o ok. 9 % bardziej mokrych w XI–IV niż średnia generatora.
- Posterunek Korbielów nie mierzy temperatury – w danych kalibracji temperatura z Zawoi i Lalik
  przeniesiona gradientem na 650 m.
- Słabe strony (do poprawy później): przewiewanie nie odtwarza kontrastu „zagłębienia ~2× więcej
  niż wypukłości” (Łajczak) – śnieg wywiany odkłada się głównie na skraju lasu; parametry wiatru
  i lasu z literatury, bez kalibracji; gradient opadu z wysokością słabo określony (R² 0,09);
  stan „zlodzony” częsty (ok. 1/4 dni I–II na 1250 m) – skorupa znika dopiero po ≥ 5 mm świeżego
  śniegu; maksimum grubości na Hali Miziowej wypada w modelu w połowie lutego,
  a wg Łajczaka pod koniec marca, zanik ok. 3 V (Łajczak: 10 V w 1994, norma 24 V);
  po etapie 3b: w zimach z generatora maksimum grubości przy stacjach ok. 44 cm wobec 62 cm
  w pomiarach (model na prawdziwej pogodzie 53 cm) – generator losuje opad dzień po dniu bez
  wielodniowych śnieżyc; pierwszy śnieg ok. 1–2 tygodnie za wcześnie (ok. 31 X wobec 10–20 XI);
  słabych zim nieco za mało (10 % najsłabszych: do 59 dni wobec 53).

## Na później

- Dopracowanie przewiewania śniegu na podstawie zdjęć Sentinel-2 (mapy pokrywy śnieżnej
  po zamieciach – gdzie śnieg znika z grzbietów i gdzie zalega w zagłębieniach).
- Generator pogody: wielodniowe epizody silnego opadu (śnieżyce) – za niskie maksima grubości.
- Budowa: trasy obszarowe z OSM (area=yes) w porównaniu; mapa bazowa przerysowana po wycince
  (teraz przecinka to osobna warstwa nad mapą).
- Ekonomia (6): pula popytu, udziały typów grup, wagi regionów, elastyczność cenowa i koszty – do
  kalibracji (frekwencja i finanse prawdziwych ośrodków); konkurencja bez reakcji na nasze ceny;
  ceny bez inflacji w kolejnych latach; brak karnetów sezonowych i wielodniowych; brak oświetlenia
  tras (jazda wieczorna); w raporcie 10 sezonów obie trasy czerwone – na Pilsku orczyk mieści się
  tylko na niższych, stromych stokach (przechył toru ≤ 10 % na siatce 10 m).
- Śnieg a jazda (5b): progi minimalnej bazy i skutki cienkiej bazy do kalibracji (dane ośrodków,
  ratraków); podłoże tylko z pokrycia i nachylenia (bez mapy kamienistości); podłoże nie wpływa na
  model śniegu (np. kamienie szybciej przebijają się przy topnieniu); limity kąta i koszty stacji
  kątowych – z kart producentów; profil panelu zasłania dolną część mapy (przesuń mapę).

- **Docelowa oprawa graficzna o szczegółowości w stylu The Settlers** – ręcznie rysowane lub gotowe
  sprite'y i animacje (narciarze, ratraki, budynki, drzewa), do wymiany w warstwie rysowania
  (`src/render`: atlas w `movers.ts`, drzewa w shaderze terenu, budynki w `resortLayer.ts`) po etapie 6.
- Goście (5): udziały umiejętności i typów grup do kalibracji (ankiety, dane z bramek); jazda
  w poprzek trasy tylko w jej korytarzu (bez skrótów między trasami); grupa jeździ na poziomie
  najsłabszego (rodzice mogliby się rozdzielać); pogoda w trakcie przewijania do godziny – stała.
- Oprawa (4b): pomiar klatek na sekundę na Macu z kartą graficzną (2000 obiektów, pełne oddalenie
  i 0,25 m/px); przy szybkim zegarze kafle terenu przeliczają się stopniowo (chwilowo widać
  stary odcień śniegu); pod lasem przy cienkiej pokrywie brązowe dno – mapa ciemnieje w słabe zimy.

## Ustalenia rozgrywki

- Jeden dzień sezonu przy ×1 to ok. 10 minut realnych; dostępne ×5 i ×20, noc przewija się sama.
- Jeden ośrodek naraz; nowa lokalizacja = nowa rozgrywka.
- Pozwolenia środowiskowe pomijamy. Wycinka kosztuje i trwa.
- Sezon letni – później.
- Grafika 2D z góry. **Styl obowiązujący: A – „ilustrowana mapa narciarska”** (od etapu 4b):
  biały śnieg z niebieskawym cieniowaniem rzeźby, świerki rysowane z boku, trasy jako kolorowe
  linie z białą obwódką, wyciąg jako ciemna linia z podporami i stacjami, etykiety z białą obwódką,
  jasne zaokrąglone panele, czcionka Barlow / Barlow Condensed. Nowe elementy (goście, ratraki,
  armatki, budynki) rysować w tym stylu: widok z góry z cieniem w prawo w dół ekranu, ikony
  z boku tylko dla drzew; obiekty ruchome przez `MoverLayer`. Mapa topograficzna zostaje jako
  nakładka.
