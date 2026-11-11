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
src/render3d/  Three.js: widok 3D (tylko oglądanie; etap 3D-0)
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
7b. Sezon letni: kolej linowa dla pieszych (tylko kanapy i gondole), szlaki piesze, bike park (trasy
    rysowane jak narciarskie, trudność z nachylenia), tor saneczkowy całoroczny, gastronomia na górze;
    pogoda letnia (deszcz zmniejsza ruch, burze zatrzymują wyciągi); atrakcje odblokowywane w trakcie
    kariery.
3D-0. Prototyp widoku 3D (Three.js) obok mapy 2D – tylko oglądanie (zrobiony).
3D-1. (zrobiony) W 3D widać wszystko co w 2D: drogi, potoki, parkingi, rurociągi, hydranty, rowy, szlaki i trasy
    letnie; wybór obiektów i gości kliknięciem (karty jak w 2D); nakładki danych jako tekstura terenu
    (legenda bez zmian); strojenie wydajności.
3D-2. Budowa i edycja w 3D (zrobiony): wszystkie narzędzia budowy (wspólny kod z 2D – buildController, snapping,
    lineTools; inna tylko zamiana ekran ↔ teren), linie przyklejone do terenu (za wzgórzem przerywane),
    podgląd wyciągu w prawdziwej wysokości, „widok z góry” nad miejscem rysowania, uchwyty, przyciąganie,
    okienko i pierścień nachylenia jak w 2D; test: punkt wskazany w 3D = punkt mapy ±0,5 m.
3D-3. Oprawa 3D (zrobiony): śnieg z grubością (teren + pokrywa z modelu, łata 1 m przy kamerze z rzeźbą
    pryzm i muld), czapy drzew i dachy wg komórki, światło i obraz z parametrów (`map-style.json`, sekcja
    `render3d`, suwaki w menu Dev), jakość niska / średnia / wysoka z doborem przy pierwszym uruchomieniu.
8. Anomalie, awarie, ratownicy, reputacja, konkurencja (po 3D-1 i 3D-2).
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
  - raport ekonomii: ten sam orczyk z naśnieżaniem (25 armatek: 13 śmigłowych, 12 lanc; zbiornik 50 tys.
    m³, pompownia 300 m³/h, 1000 kW, ratrak z wyciągarką i kotwa; 6,3 ha) na 30 zimach obok wersji bez:
    dni otwarte 38,7 → 117,8 (słaba 1/3 zim +100, mocna +53), goście 5,7 → 16,4 tys./sezon, wynik
    działalności 0,21 → 0,77 mln zł/sezon; inwestycja 17,1 mln zł + 0,33 mln/rok utrzymania → prosty zwrot
    ok. 72 lat; kalibracja (gra / dane koncepcji): woda 4272 / 3501 m³/ha (×1,22), energia 17 161 / 24 449
    kWh/ha (×0,70), energia na wizytę 6,0 / 5,4 kWh (×1,11), koszt m³ z amortyzacją 20 lat 23,3 / 17 zł
    (×1,37; samo działanie 2,3 zł/m³);
  - błąd znaleziony w raporcie: bez ratraka z wyciągarką pryzmy na stromych odcinkach (≥ 40 %) zostawały
    na stałe i zamykały trasę – automat nie naśnieża już takich odcinków (ręcznie – można);
  - testy `tests/snowmaking.test.ts` (12): Twb ponad progiem → 0, zimniej → więcej; energia ρgh/η;
    zbiornik ≥ 0; limit mocy; stromizna bez wyciągarki nieratrakowana; czas pracy ze wzoru; pryzmy
    blokują odcinek; mokry śnieg ubity przed mrozem → lód; wiatr znosi poza trasę; 30 zim z i bez.
- **Etap 6b – zrobiony** (listopad 2026): poprawki po pierwszym rozegranym sezonie.
  - diagnoza śniegu naturalnego (`npm run snow-diagnosis [N]`, `src/tools/snowDiagnosis.ts`): dni XII–III
    z bazą ubitą ≥ progu otwarcia; przed poprawkami 750 m: generator 11,3 dnia, model na prawdziwej pogodzie
    2001–2021 24,0; 1270 m: 32,0 wobec 47,5; zima 2026/27 (seed) – 0 dni na dole (0. percentyl), 13 na
    1270 m (45.); pomiary IMGW (pokrywa ≥ 30 cm XII–III): Korbielów 13,6, Zawoja 27,4, Laliki 32,4 dnia;
    przyczyny i poprawki: (1) progi bazy z etapu 5b liczone z gęstością ubitą 420 kg/m³, a naturalny śnieg
    po przejazdach ma ok. 300 – `riding.naturalCoverDensityKgM3` 300, próg łąki 25 → 21 cm, pniaków 40 → 36;
    (2) gradient opadu z wysokością 3,08 → 5,12 %/100 m (regresja IMGW R² 0,09 słaba – przyjęte 60 mm/100 m
    z literatury, Hess 1965; `importClimate.ts` PRECIP_FIT_MIN_R2); (3) las – osłona przed wiatrem
    (Winstral Sx) z wysokością koron 20 m (`wind.forestCanopyHeightM`) – na polanach mniej wywiewania;
    po poprawkach 750 m: generator 15,8, prawdziwa pogoda 26,0; 1270 m: 48,9 / 60,0; zima 2026/27 – 24 dni
    na 1270 m (31. percentyl, „słaba”, ale nie z 20 % najsłabszych); norma Łajczaka dla Hali Miziowej
    (181 dni z pokrywą, marzec ok. 80 cm) nadal nieosiągnięta – model 139 dni, 29 cm (miejsce nawiewania);
  - klasy zim (`winterClass.ts`, `data/winter-classes.json` z `npm run snow-diagnosis -- --klasy`, 160 zim
    generatora na 1100 m, próg bazy 21 cm): średnio 39,3 dnia, kwintyle 0/22/48/68 → „bardzo słaba / słaba /
    przeciętna / dobra / bardzo dobra”; w raporcie sezonu ocena zimy z liczbą dni ze śniegiem; kariera:
    `careerSeed` – pierwsza zima nie z 20 % najsłabszych (deterministyczne szukanie ziarna; dalej losowo),
    `setWeatherSeed` przestawia pogodę w wątku obliczeń;
  - śnieg w ciągu doby (`SnowWorld.advanceLive`, `SnowSeason.hourlyForcing`): od stanu z końca poprzedniego
    dnia kroki godzinowe do bieżącej godziny gry (topnienie w dzień, zamarzanie nocą – skorupa po
    zamarznięciu ≥ 0,5 mm wody stopionej, `quality.meltCrustRefreezeMm`, stan „zlodzony”); pomiar: ok.
    32–40 ms na godzinę dla całej mapy (180 tys. komórek, 1 wątek), doba ok. 0,8 s – w wątku obliczeń,
    mapa i panele pytają o godzinę (`SnowStateRequest.hour`); testy `tests/snowLive.test.ts`;
  - ekonomia ośrodka wielkości Pilska (`npm run pilsko-economy`, układ z OSM: 12 wyciągów, 4 parkingi,
    17 odcinków tras, garaż i 3 ratraki, przeciętna zima 2052/53): przed korektą +4,4 mln zł (marża 59 % –
    za mało kosztów stałych); dodane: stała załoga na wyciąg (`permanentStaffPerLift`), administracja
    10 % przychodu (NSAA: G&A 10,3 %); wynik: 74 dni, 37,7 tys. gości, przychód 5,98 mln (karnety 5,74),
    koszty 5,73 mln (stała załoga 1,85, utrzymanie 1,31, administracja 0,60, ubezpieczenie 0,28, ratownicy
    0,25, energia 0,25, przeglądy 0,22…) → +0,25 mln zł; udział płac ok. 44 % – popyt prawdopodobnie
    za niski (do kalibracji);
  - dymek przy kursorze (`render/cursorTip.ts`, klawisz I, „Nakładki”, zapamiętany w przeglądarce): teren,
    śnieg (grubość, baza ubita, stan), temperatura na tej wysokości, obiekt (trasa, wyciąg, budynek, droga,
    rurociąg, potok z przepływem dziś i dopuszczalnym poborem);
  - dostępność i dojazd (`resort.ts`: `analyzeRoads`, `reachableNodes`; `guestNetwork.ts`, `guests.ts`):
    wyciąg pracuje tylko, gdy da się do niego dojść z parkingu z dojazdem (ostrzeżenia „niedostępny
    z parkingu”, „bez dojazdu”); drogi dojazdowe (narzędzie E, `construction.json` sekcja `roads`: 1500 zł/m,
    nachylenie ≤ 12 %, odśnieżanie 120 zł/km/dzień XI–III) od dróg publicznych z OSM; pojemność parkingu
    ogranicza przyjazdy, goście wybierają parking wg obciążenia; zjazd wyciągiem w dół (`downhill` na
    kanapach i gondolach, `downhillMaxSeatShare` w `lifts.json`, powierzchniowe – nie) gdy dolna trasa
    zamknięta lub za trudna; nartostrada (narzędzie U, szerokość 6 m, ≤ 15 %); transport do schroniska
    (budynek `shuttle` – 80 os./dzień, 90 zł, tylko goście gastronomii); testy `tests/access.test.ts`;
  - woda do naśnieżania (`sim/water.ts`, `data/water.json`): potoki z OSM (`osm-water.json` z `npm run
    import-osm-resort`, 57 km) uzupełniane z modelu terenu (spływ do najniższego sąsiada po wypełnieniu
    zagłębień, ciek przy zlewni > 0,25 km²); średni przepływ = zlewnia × opad roczny na średniej wysokości
    zlewni × 0,53 (odpływ jednostkowy ok. 20 l/(s·km²) jak Koszarawa w Pewli Małej), przepływ dnia ×
    rytm miesięczny IMGW (`npm run import-hydro` → `data/calibration/imgw-hydro.json`, Ujsoły i Pewel Mała
    2011–2020: styczeń 0,73, sierpień 0,59, III–IV 1,36 średniego) × czynnik suszy (opad 30 dni wobec
    normy); pobór tylko ponad przepływ nienaruszalny (0,3 średniego) i ≤ 50 % bieżącego, wspólny limit
    dla ujęć na tym samym potoku (`allocateIntakes`); ujęcie tylko ≤ 25 m od cieku; rura zasilająca
    (narzędzie F, 250 zł/m; pod górę energia ρgh/η); wodociąg (`mains`, 10 m³/h, tylko gdy ≥ 15 budynków
    w promieniu 300 m, 8,07 zł/m³ netto + 19,48 zł/mies. – taryfa MPWiK Żywiec od 18 VII 2026, w gminie
    Jeleśnia MPWiK prowadzi tylko kanalizację; zakup włączany w panelu); studnie 100 i 200 m (wydajność
    losowana z ziarnem po wierceniu: mediana 2,5 m³/h × (głęb./100)^0,5, rozrzut log-normalny, 15 % prawie
    suchych; pompa z głębokości 0,4 × otworu); rowy zbierające spływ do zbiornika (`catchment`, do 30 ha:
    deszcz + topnienie z modelu śniegu × 0,5); panel „Źródła wody” – dziś i od 1 V, ilość i koszt każdego
    źródła; `npm run water-check` – sieć cieków, przepływy, czas napełniania; potoki na mapie
    (`ResortLayer.setStreams`); testy `tests/water.test.ts`; bez modelu wody (testy etapu 7, raport
    ekonomii) zostaje uproszczony dopływ z ujęcia (`water` w `snowmaking.json`).
- **Etap 7b – zrobiony** (listopad 2026): sezon letni i karty obiektów.
  - poprawka 6b: raport ekonomii na modelu wody (ujęcie na potoku Kamienny z rurą zasilającą,
    `cropStreamNet` – zlewnie z całej mapy w oknie raportu; ok. 45 tys. m³/rok, 8,6 tys. zł/rok);
  - dane `data/summer.json` (źródła przy każdej liczbie): sezon V–X, wakacje 27 VI–31 VIII, święta i Boże
    Ciało (Wielkanoc + 60 dni, most w piątek), przeglądy (kolej 7 dni, orczyk 2, ważne rok, domyślnie 3 XI),
    burze z IMGW (`npm run import-storms` → `data/calibration/imgw-storms.json`: Bielsko-Biała 2001–2025,
    25 dni/rok, lipiec 6,2; P(burza | dzień z opadem / bez) w miesiącach, czas trwania), upał od 27 °C,
    wieszaki na rowery (25 % krzeseł, pół miejsca na rower), ceny (w górę 40 zł, góra-dół 55 – Jaworzyna
    Krynicka 2026: 41/58, wakacje 43/62; Pilsko–Szczawiny 35/40; karnet rowerowy 150 – Słotwiny/Kasina
    129–169; tor 15 – Czantoria; wypożyczenie roweru 180 „do kalibracji”), bike park (klasy IMBA: średnio
    ≤ 5/10/15 %, 125 zł/m – trasa pod Chrzanowem), ścieżki 60 zł/m, tor (1,5 mln + 2500 zł/m, nachylenie
    4–40 %, do 1500 m, 300 przejazdów/h; Równica ok. 2 mln zł), odblokowania (reputacja, saldo), koszenie
    350 zł/ha w lipcu, popyt (pula 4500/dzień w wakacyjną sobotę – dobrana tak, by Pilsko miało ~90 tys.
    gości latem, „do kalibracji”), reputacja letnia osobna, 4 typy gości (turysta, rodzina, rowerzysta,
    wycieczka szkolna V–VI i IX), plac zabaw 250 tys., punkt widokowy 400 tys., model zgrubny
    (współczynniki dobrane na symulacji gości);
  - `sim/summer.ts`: kalendarz (`easterSunday`, `summerDayInfo`), pogoda (`summerWeather` – burza
    losowana z ziarnem, częściej w cieplejsze dni; `stormAt`), trasy letnie (`TrailDesign`, `analyzeTrail` –
    rower od góry w dół, klasa ze średniego nachylenia, ostrzeżenia; tor – zakres nachylenia i długości),
    `summerFacts` (koleje linowe zbudowane, nie zamknięte, kursujące latem, z ważnym przeglądem; wyciągi
    powierzchniowe stoją; wieszaki zmniejszają przepustowość dla pieszych), `summerPlan` (popyt osobno dla
    typów: oferta^0,8 × reputacja × cena; deszcz × (1 − 0,7·P), burze, słońce, upał; parking),
    `quickSummerDay`, `summerDayFlows`, `summerFixedFlows` (utrzymanie tras, koszenie),
    `tobogganWinterFlows` (tor zimą), `seasonExtras` (wszystko dla dnia gry), `attractionUnlocked`;
  - `sim/summerGuests.ts` (`SummerDay`): sieć pieszych ze szlaków PTTK (OSM) i ścieżek gracza (Tobler,
    osobno w górę i w dół, Dijkstra między miejscami), grupy z celami (kolej w górę, schronisko / szczyt
    / punkt widokowy, jedzenie, tor, plac zabaw, zjazdy rowerem, powrót koleją w dół albo pieszo),
    kolejki do kolei w obie strony i do wieszaków, tor, restauracje (miejsca, kolejka), parkingi (zajęte
    w każdej chwili do pojemności, odjechali bez miejsca), burza/wiatr zatrzymują kolej i tor, deszcz
    skraca wycieczki, upał męczy; statystyki co 15 min (`SummerStats`) dla kart; ramki do rysowania
    (`DRAW_BIKE`, `DRAW_SLED`); `osmDestinations`, `summerNetFor`;
  - `sim/inspections.ts`: przegląd planowany przez gracza (`scheduleInspection`), w przeglądzie i bez
    ważnego przeglądu wyciąg nie wozi (`operationalLayout`, `resortFacts`), koszt w dniu rozpoczęcia;
  - ekonomia: nowe przychody (bilety kolei, karnety rowerowe, tor) i koszty (utrzymanie tras letnich,
    koszenie), `SeasonFlows` (zima / lato / poza sezonem / koszty wspólne), `setSummerOpen`, raport roku
    z wynikiem zimy i lata osobno, reputacja letnia, przychody wg obiektu (`objectRevenue`);
    `HeadlessGame` – dzień letni (model zgrubny albo `summerAgents`);
  - karty obiektów: `sim/objectCards.ts` (dane: status, liczby, wykres dnia co 15 min, akcje; parkingi
    w modelu dnia – `presenceProfile`, `parkingProfiles`), `render/objectCardView.ts` (okno po kliknięciu
    obiektu; akcje: otwórz/zamknij, kolej latem, wieszaki, termin przeglądu, cena, wodociąg, rozbiórka);
  - widok: łąki latem w shaderze (`uSummer`, koszone trasy jaśniejsze), szlaki PTTK przerywane w kolorach
    znakowania (`osm-trails.json` z `npm run import-osm-resort`), trasy rowerowe (kolor trudności,
    przerywane), ścieżki, tor; trasy narciarskie latem blade; postacie letnie (piechur z plecakiem,
    rowerzysta, sanki) – goście letni w wątku gości (`summerDay` w protokole); panel „Sezon letni”
    w Finansach (otwarcie, ceny); narzędzia X / Q / C, przycisk „Lato”; latem przy otwartym sezonie
    dni płyną jak zimą;
  - raport `npm run summer-report` (`raport-lata.html`, ok. 2 min): Pilsko z OSM, przeciętna zima 2052/53;
    bez lata +0,23 mln zł, z latem +2,98 mln zł (lato +2,75 mln): 184 dni, 86,7 tys. gości (turyści 37 tys.,
    rodziny 40, rowerzyści 6, szkoły 3), ocena 4,46; lato: bilety kolei 2,27 mln, karnety rowerowe 0,78,
    tor 0,61, gastronomia 0,57, parking 0,60; koszty dni letnich ok. 2,6 mln; inwestycja w atrakcje
    6,79 mln (restauracja 3, tor 2,9) → prosty zwrot ok. 2,5 roku; 27 dni z burzą; model zgrubny zgodny
    z agentami w ok. 10 %;
  - testy: `tests/summer.test.ts` (kalendarz, burze, orczyk latem nie wozi, kanapa w obie strony,
    wieszaki, burza zatrzymuje kolej i tor, deszczowy weekend mniej gości, przegląd, parkingi, pełny
    rok zima + lato), `tests/objectCards.test.ts`.
- **Etap 7c – zrobiony** (listopad 2026): nowy interfejs gry i prostsza edycja tras.
  - makiety `docs/ui/` (ui-1-mapa, ui-2-karty, ui-3-raport: PNG + HTML – źródło kolorów, rozmiarów,
    czcionek), zrzuty gry w tych samych sytuacjach i lista funkcji „gdzie co teraz jest”:
    `docs/ui/porownanie/` (README.md);
  - zasady wyglądu – sekcja „Ustalenia rozgrywki” (obowiązujące); `src/render/style.css` napisany od
    nowa (ciemne panele, tokeny kolorów), czcionki `@fontsource` (Barlow 400–700, Barlow Condensed
    500–700), ikony `src/render/ui/icons.ts` (także rysunki kart palety), bez emoji;
  - `src/render/ui/`: `shell.ts` (kontener `#ui` ze skalą CSS zoom – automatycznie wg szerokości okna
    albo z menu, podpowiedzi `data-tip` ze skrótem, fokus), `dataViews.ts` (lewy pasek widoków danych:
    grupy nakładek z zakładkami, legenda obok aktywnego przycisku, mapa topograficzna / sieć / OSM),
    `notifications.ts` (powiadomienia z ikoną stanu, godziną, jednym zdaniem i skokiem kamery; historia
    w menu; reguły w main.ts: dziennik gry, kolejki ≥ 10 min, pełny parking z modelu dnia, odwilż
    w prognozie, za mało śniegu), `gameMenu.ts` (menu ☰, panel boczny na dotychczasowe panele – jeden
    naraz: Finanse, Goście, Naśnieżanie, Obiekty ośrodka; okno historii, skrótów, skali), `minimap.ts`
    (teren, las, śnieg, trasy, wyciągi, prostokąt widoku, klik przesuwa kamerę, obrót, zoom),
    `reportWindow.ts` (raport dzień / tydzień / sezon: 5 kafelków, goście na stoku w ciągu dnia –
    z symulacji gości albo z modelu, „co mówią goście”, skąd pieniądze / na co poszły, wyciągi,
    doradca), `advisor.ts` (reguły: wąskie gardło wyciągu, pełny parking, kuchnia, brak śniegu, brak
    tras dla początkujących, niska ocena – zdanie + przycisk akcji);
  - `topBar.ts` (nazwa, sezon, saldo ze zmianą, goście dziś / na stoku, reputacja z gwiazdkami, cena
    karnetu, data i zegar, czas, pogoda góra/dół, baza śniegu, wiatr, prognoza 4 dni, menu),
    `buildBar.ts` (kategorie i paleta kart z ceną i blokadą), `objectCardView.ts` (nagłówek z ikoną,
    zakładki, liczba stanu z paskiem, kafelki, wykres godzinowy – szare słupki prognozy, sugestia,
    akcje, suwak „Gładkość”), karta gościa w `guestPanels.ts` (imię i wiek z numeru gościa – tylko
    widok, potrzeby, „co myśli”, wydatek na karnet, śledzenie kamerą);
  - dane tylko do wyświetlania w `src/sim`: `ObjectCard.headline / tiles / note`, `chart.forecast`
    (objectCards.ts), `GameState.recentFlows` (7 dni – raport tygodnia), `ctrl` i `smooth` w trasach,
    drogach, rurociągach i trasach letnich (zapis układu, `parseLayout`);
  - rysowanie linii (`src/render/lineTools.ts`, parametry `data/ui.json` sekcja `lines`): ślad ręki
    uśredniany wzdłuż linii, punkty kontrolne dokładane tam, gdzie gładki łuk odbiega najbardziej
    (Douglas–Peucker liczony względem łuku), odchyłka < tolerancji (4 m albo 3 px), potem usuwanie
    punktów bliżej niż 40 m (zostają na zakrętach ≥ 35°); łuk Catmull–Rom w wariancie dośrodkowym,
    gładkość 0–1 (0 – łamana); `points` w układzie = gęsty przebieg co 8 m (symulacja bez zmian);
    tryb „ręką / punktami” (klawisz O, paleta) dla tras, nartostrad, dróg, rurociągów i tras letnich;
    uchwyty tylko przy zaznaczonym obiekcie, przeciągnięcie odcinka wstawia punkt, prawy przycisk /
    Delete usuwa; starsze zapisy: łamana ≤ 12 punktów zostaje (gładkość 0), gęstsza – upraszczana;
  - testy: `tests/lineTools.test.ts` (300 próbek ręki → 12–13 punktów, odchyłka 2–3 m przy tolerancji
    4 m; drżenie co próbkę; serpentyna; łuk przez punkty; gładkość 0 = łamana), `tests/advisor.test.ts`
    (reguły doradcy, skala automatyczna 1366/1920/2560 px);
  - pomiar: rysowanie 300 próbek 0,4 s, uproszczenie po puszczeniu ok. 0,2 s (kontener, 1 wątek).
- **Etap 7d – zrobiony** (listopad 2026): szczegóły z bliska – trasy, ludzie, maszyny, śnieg.
  - warstwa detalu 1 m (`src/sim/detailLayer.ts`, parametry `data/detail.json` sekcja `layer`): bloki
    10 × 10 komórek 1 m tylko w korytarzach tras (komórki tras + pierścień sąsiadów; latem także trasy
    rowerowe), tablice: kierunek (bajt, oś 0–π) i czas ostatniego ratrakowania [h gry], ślady nart,
    świeży śnieg, muldy [m], lód, pryzmy [mm w.e.], przetarcia; zasilanie: ratrak na mapie
    (`groomSegment` – te same pasy co sztruks na `TrackBuffer`), noc przewinięta (`groomWholeJob`
    z zadań `OpsSummary`), narciarze na ekranie (`skiSegment`), przejazdy całego dnia (`applyPasses` –
    ślady, muldy rosną szybciej na zakrętach trasy `turnField`), armatki (`addPile` – pryzma w miejscu
    opadu z przesunięciem z wiatrem), opad (`weather` – zasypuje ślady i sztruks); bilans masy liczy
    siatka 10 m, warstwa 1 m tylko rozkłada (`syncTo10m` po każdym kroku modelu: średnia muld = indeks ·
    0,8 m / 2, średnia pryzm = pryzmy 10 m, lód = stan „zlodzony”, przetarcia = `wornFraction` z „za
    cienkiej bazy” × udział powierzchni trasy w komórce (`onPiste` – obrys z osi i szerokości, brzeg
    ±1,5 m; pierścień poza trasą bez przetarć), plamy trawy dopiero przy bazie < 50 % wymaganej, kształt
    z gładkiego szumu interpolowanego między komórkami, średnia dopasowana bisekcją; kształt muld –
    pole garbów cos · cos w układzie mapy, odstęp 5 m – ten sam wzór liczy shader);
  - śnieg z bliska (`src/render/detailRenderer.ts`, `detailView.ts`, sekcja `render`): okno tekstur
    1024 × 1024 m wokół widoku (wypełniane przy przesunięciu > 20 % okna, zmianie danych, co 20 min gry;
    ok. 50 ms), shader w dwóch warstwach – mnożenie (rzeźba: sztruks – prążki co 1 m w poprzek
    przejazdu, głębokość 5 cm, bledną w ciągu 18 h, zacierane śladami; ślady nart, puch, firn, breja,
    muldy i pryzmy z cieniem: marsz w stronę Słońca z modelu – cienie zmieniają się w ciągu dnia;
    noc i pochmurno – ciemniejsze rowki) i zwykła (trawa i kamienie w przetarciach, połysk lodu,
    iskrzenie puchu); stan powierzchni, lód i brzeg korytarza przenikają się dwuliniowo między
    komórkami 10 m (bez kwadratów); detal od 0,5 m/px, pełny od 0,35 m/px; największe przybliżenie
    zmienione z 0,25 na 0,125 m/px (`settings.json` `view.minMetersPerPixel`; kafle terenu nadal
    najdrobniejsze 0,25 m/px – niżej powiększane); muldy w shaderze ze wzoru (wysokość z warstwy 1 m,
    gradient i cień liczone wprost – bez fasetek); normalne z pochodnych
    ekranowych (jedno liczenie rzeźby na piksel), szum tylko tam, gdzie dany stan występuje, cień
    muld miękki; z bliska linie tras cieńsze i półprzezroczyste (`ResortLayer.propsActive`), stara
    nakładka śladów 2 m/px (etap 4b) wygasa (`TerrainRenderer.detailFade`); w kaflach terenu grubość
    śniegu i stan „przetarty” interpolowane między komórkami (`depthThinAt` – bez schodków 10 m);
  - atlas postaci i maszyn: opis `data/atlas.json` (jeden plik do podmiany: kształty SVG w polu
    100 jednostek, przód = góra, warstwy cień / ciało / kurtka barwiona z ziarnem, fazy ruchu),
    generator `src/render/atlasGen.ts` uruchamiany przy budowaniu (wtyczka Vite, moduł
    `virtual:sprite-atlas`), 22 obiekty × fazy × 8 kierunków × 3 poziomy szczegółowości (16/32/64 px,
    ratrak i koło zwrotne 32/64/128) w jednym SVG 2048 px, wczytanie w przeglądarce ok. 0,35 s
    (`atlasTexture.ts`); narciarz (fazy skrętu), snowboardzista, dziecko (×0,7), ratownik, siedzący,
    stojący w kolejce, pieszy, turysta, rowerzysta, sanki, ratrak (gąsienice, pług, frez, kabina,
    światła), skuter, armatka śmigłowa i lanca, krzesełka 2/4/6, gondola, orczyk, talerzyk, głowica
    podpory z rolkami, koło zwrotne, bramka;
  - `src/render/propLayer.ts` (od 1,2 m/px zamiast uproszczonych wektorów): podpory z rolkami, koła
    zwrotne, bramki, szpalery kolejki (taśmy), krzesełka / orczyki / talerzyki jadące po linie (pozycja
    jak odjazdy w symulacji), siedzący wg zajętych miejsc (`movers.ts`), armatki, lina wyciągarki ratraka
    do punktu kotwienia (nachylenie ≥ 40 %, kotwa w zasięgu), skuter i ratownik przy wypadku, skuter
    zaparkowany przy dolnej stacji; `particleFx.ts` – chmura armatki (160 cząstek, znoszona wiatrem
    z modelu, 3 m na 1 m/s) i pył spod nart w puchu (sekcja `particles`);
  - kolejka w szpalerach (`queueLayout`, `queueSlot` w `guests.ts`, `data/guests.json`:
    `queueRowSize` = 6 szpalerów, `queueLaneLengthM` 12 m) – zygzakiem, dalej rzędy za taśmami;
  - poprawki przy okazji: podgląd doby (plan naśnieżania i nocy) nie przeliczał się po przewinięciu
    dni (`refreshPreview` blokowane w `catchUp`) – chmur armatek nie było widać;
  - testy: `tests/detailLayer.test.ts` (przejazd ratraka zmienia kierunek sztruksu tylko na swojej
    drodze; 500 przejazdów na 40 % tworzy muldy, na 10 % nie, zakręt przyspiesza; średnie 1 m = 10 m;
    świeży śnieg zaciera ślady), `tests/atlas.test.ts` (wszystkie obiekty × fazy × 8 kierunków ×
    3 LOD, bez nakładania, kierunek z kąta, maski kurtek; szpalery kolejki);
  - zrzuty `docs/ui/detal/` (piaskownica, Pilsko z OSM, 1920 × 1080, opis w README.md): sztruks rano,
    ratrak nocą, armatka przy wietrze, muldy po południu, kolejka w szpalerach (widok pomiaru);
  - pomiar (kontener bez karty graficznej – grafika liczona przez procesor, SwiftShader; 1920 × 1080,
    0,125 m/px przy dolnej stacji najbardziej obleganego wyciągu, 8000 gości w planie dnia – przyjechało
    2876, na stoku naraz ok. 1180, w kadrze ok. 520 postaci): praca kodu gry na klatkę 4–8 ms (z tego
    detal 0,4–0,5 ms; wypełnienie okna tekstur 50–100 ms raz na 20 min gry lub po przesunięciu widoku
    o > 20 % okna), mieści się w 20 ms (50 kl./s); czas klatki w kontenerze 540–680 ms z detalem, 170–420 ms
    bez (procesor zamiast karty graficznej) – samych kl./s nie da się tu zmierzyć; pierwsza wersja shadera
    była 6× droższa od reszty sceny (2263 wobec 347 ms) – przepisana; do sprawdzenia na Macu (menu `Dev`).
- **Etap 7e – zrobiony** (listopad 2026): czytelność rzeźby terenu (tylko rysowanie, symulacja bez zmian).
  - parametry `data/map-style.json` sekcja `relief`, wzory w `src/render/relief.ts` (wspólne z shaderem
    terenu i testami): cieniowanie z 4 kierunków naraz (MDOW; 315° waga 0,5, 270° i 0° po 0,2, 225° 0,1;
    wysokość 45°; kierunki związane z ekranem – po obrocie mapy światło dalej z lewej góry,
    `lightVectors`), przewyższenie `shading.zFactor` 2,2 liczone w shaderze (normalne w teksturze nadal
    z `illustrated.reliefZFactor` – tylko dokładność zapisu); cieniowanie nachyleniem niezależne od
    kierunku (`slopeTone`: 1 płasko → 0,95 przy 25 % → 0,86 przy 40 % → 0,74 od 70 %, chłodniej,
    progi z klas tras w `pistes.json`); przyciemnienie wklęsłości (`concavityField`: komórka niżej niż
    średnia w promieniu 60 m, pełne przy 8 m, siła 0,18; tekstura pomocnicza R = wklęsłość, G/B/A =
    wysokość w cm – 24 bity, interpolacja dwuliniowa w shaderze); las – drzewa przyciemnione wg
    cieniowania (`treeShadeStrength`), ikony z daleka rzadziej (`iconDensity` 0,6);
  - kreski spadku (`hachureAt` w TS i GLSL): siatka o odstępie 10 px × m/px (6–48 m), punkt w oczku
    ze skrótu (ziarno – bez migania), kreska wzdłuż linii spadku, zwężona w dół stoku; brak poniżej
    15 %, pełne od 20 %, przy 70 % najdłuższe, najgrubsze i najgęstsze; tylko teren otwarty i trasy
    (las, kosodrzewina – nie; przecinki i trasy z maski – tak); zanik powyżej 5–9 m/px i poniżej
    0,55–0,35 m/px (tam faktury 7d);
  - warstwice w shaderze (`contourLine`: grubość w px przez `fwidth`): co 50 m, przy zbliżeniu
    co 10 m (1,5–3 m/px przejście), grubsze co 100 m; opisy co 100 m (`render/contourLabels.ts`,
    `traceLevel` z etapu 1, co 650 m wzdłuż linii, góra napisu pod górę stoku – `contourLabelAngle`,
    stała wielkość 11 px, od 2,5 m/px);
  - przełączniki „Kreski spadku” i „Warstwice” w widokach danych → „Teren i mapa” (zapamiętane
    w przeglądarce, `ski-sim:rzezba`), `TerrainRenderer.setRelief` / `setReliefLayers` (przeliczenie kafli);
  - menu `Dev` → „Rzeźba terenu (etap 7e)”: 22 suwaki (`RELIEF_SLIDERS`), zmiana od razu na mapie,
    „Kopiuj ustawienia” (JSON ścieżek i wartości do przeniesienia do pliku), „Przywróć z pliku”;
  - pomoc przy budowie (`render/slopeRing.ts`): przy rysowaniu trasy, nartostrady, wyciągu, drogi,
    trasy rowerowej i toru – pierścień w kolorze klasy nachylenia, strzałka w dół stoku (z ekspozycji,
    także po obrocie mapy – `downhillScreen`) i nachylenie w %;
  - testy `tests/relief.test.ts` (9): płasko – jednolita jasność i zero kresek; płaszczyzna 30 % na
    północ – kreski równoległe, w dół stoku; jasność 4 ekspozycji przy tym samym nachyleniu równa;
    stromiej – ciemniej i chłodniej, progi klas tras; światło z lewej góry ekranu przy obu ustawieniach
    mapy; wklęsłości; kreski tylko na terenie otwartym, stałe, zanik z przybliżeniem; opis warstwicy
    pod górę; pierścień – klasa i kierunek;
  - zrzuty przed / po: `docs/ui/rzezba/` (cała mapa, Hala Miziowa, zbliżenie na trasę, pierścień).
- **Etap 7f – zrobiony** (listopad 2026): wygoda budowania (wzór: Cities: Skylines) i poprawki po testach.
  - przyciąganie i linie pomocnicze (`src/render/snapping.ts`, parametry `data/ui.json` sekcja `snapping`):
    punkty i odcinki tej samej sieci (rurociąg – pompownia, hydrant, armatka, rury; rura zasilająca – źródła,
    zbiornik; droga – drogi, drogi publiczne, parkingi; trasa i nartostrada – stacje wyciągów, trasy; trasy
    letnie – stacje, budynki; wyciąg – końce tras, parkingi, stacje; rów – zbiorniki) w promieniu 14 px,
    potem linie pomocnicze w 9 px: kąt co 15° (w tym 90°) względem najbliższego obiektu (≤ 60 m od początku
    odcinka; bez sąsiada – względem poprzedniego odcinka), przedłużenie odcinka (≤ 400 m), równoległa 5 m
    od krawędzi trasy (rurociąg, droga, rów); Shift wyłącza; `BuildController.snapAt`, `snapBase`
    (zapamiętane do zmiany układu); `SnapOverlay` (`render/snapOverlay.ts`) – znacznik, linia przerywana
    z opisem, okienko przy kursorze: długość, koszt narastająco, nachylenie odcinka, ostrzeżenia na
    czerwono (droga i nartostrada za stroma, tor, rurociąg niepołączony z pompownią, błędy analizy
    wyciągu i trasy, rów pod górę); dymek terenu chowa się na czas rysowania;
  - tryby rysowania (`DrawMode`: `straight` – łamana, gładkość 0; `arc` – Bézier 2. stopnia przez punkt
    sterujący, `arcPoints`, potem uproszczenie jak ręka; `hand`), klawisz O po kolei, w palecie
    „Prosto / Łuk / Ręką”; starszy zapis „click” → „straight”;
  - ulepszanie (`src/sim/upgrades.ts`): `upgradeLift` (ten sam przebieg, podpory od nowa, zjazd i wieszaki
    tylko gdy typ pozwala; `liftUpgradeCheck` – kąt załamania i stacja pośrednia), `upgradeGun`,
    `widenPiste` (`pistes.json` `widenStepM` 5 m), `moveBuilding` (obrót co 90°, `BuildingDesign.rotDeg` –
    tylko widok, poza podpisem kosztu); akcje w kartach (`CardAction` `upgrade` z listą wyboru, `widen`,
    `move`), potwierdzenie z różnicą kosztu, dopłatą i czasem przebudowy (`GameController.changePreview`);
    przesuwanie budynku: podgląd pod kursorem, R / prawy przycisk – obrót; przeniesienie budynku = przebudowa
    (opłata `rebuildFeeShare`), armatki – bez kosztu; rozbiórka gotowego obiektu – zwrot
    `demolishRefundShare` 15 % (`economy.json`, do kalibracji);
  - „Naśnież trasę” (`src/sim/autoSnowmaking.ts`, `data/snowmaking.json` sekcja `autoPlan`): krawędź trasy
    (oś przesunięta o pół szerokości + 3 m, strona i koniec bliżej sieci), dojście od pompowni albo rury
    połączonej z pompownią najkrótszą drogą po terenie (Dijkstra na siatce 10 m, długość 3D × (1 + 1,5 ×
    las) × (1 + 0,01 × nachylenie %)), Douglas–Peucker 4 m; odcinek dojściowy bez hydrantów
    (`PipelineDesign.hydrantsFromM`); hydranty co 60 m, przy każdym armatka (`chooseGunType`: lanca przy
    lesie ≥ 30 % w promieniu 25 m, szerokości < 30 m lub nachyleniu > 35 %; inaczej śmigłowa); koszt =
    `pipelineCost` + ceny armatek (te same wzory co ekonomia); wydajność przy Twb −6 °C (ograniczona
    pompownią), pierwsze zaśnieżenie 40 cm ubitego śniegu przy 20 h pracy na dobę; widok – narzędzie
    `autoSnow` (klik trasy dodaje / zdejmuje), podgląd na mapie, okno `render/autoSnowPanel.ts`
    („Zbuduj” / „Anuluj”, Enter / Esc);
  - samouczek i lista kontrolna: `src/sim/snowChecklist.ts` (7 kroków: woda – źródło połączone ze
    zbiornikiem, zbiornik, pompownia, przyłącze, armatki, plan naśnieżania zapisany, ratrak; dlaczego
    i co zrobić), `render/ui/snowTutorial.ts` (proponowany raz przy pierwszym otwarciu kategorii
    Naśnieżanie – `localStorage` `ski-sim:samouczek-nasniezanie`; menu ☰ i przycisk w panelu; „Pokaż
    gdzie” podświetla kartę / przycisk pomarańczową obwódką, zrobiony krok – po 1,8 s następny); lista
    „Czego brakuje do naśnieżania” w panelu, dopóki czegoś brakuje;
  - ratraki bez garażu i używane (`snowmaking.json` `groomers.outdoor`, `groomers.used`, wszystko „do
    kalibracji”): w garażu pierwsze `garageSlots` ratraki floty (`shelteredGroomers`); pod chmurką
    rozgrzewanie 25 min (`GroomerUnit.warmupH` – później start nocy), awarie ×2,5 przy minimum nocy
    ≤ −8 °C (`breakdownChance` z kontekstem; minimum 18–30 h na wysokości dolnej stacji), serwis ×1,35,
    starzenie ×1,5 (`outdoorDays`, `groomerAgeYears`); zakup bez garażu; rynek używanych:
    `usedGroomerOffers(seed, sezon)` – 3 oferty, wiek 4–14 lat, ok. 1/3 ceny nowego × stan, gorszy stan –
    więcej awarii (`condition`), zakup raz (`ops.usedTaken`); panel: „w garażu” / „stoi pod chmurką”, wiek,
    stan, oferty z przyciskiem;
  - rowy zbierające jako linie (`DitchDesign`, `layout.ditches`; `water.ts`: `analyzeDitch` – koniec przy
    zbiorniku ≤ 40 m, średni spadek ≥ 0,5 %, lokalnie nie pod górę > 1 % na odcinkach 20 m, zlewnia =
    komórki, których spływ przecina rów (`upstreamCells`), przepustowość 30 ha, dopływ roczny = zlewnia ×
    opad roczny na średniej wysokości × 0,5; `data/water.json` sekcja `ditches`, koszt 60 zł/m i tempo
    w `snowmaking.json` `ditch`, wykop latem); źródło wody `catchment` w `waterSources`; narzędzie `ditch`
    (karta „Rów zbierający”), nakładka zlewni (niebieskie pole) przy rysowaniu i po kliknięciu rowu, rów
    na mapie (niebieska przerywana linia ze strzałką), karta obiektu; starsze zapisy:
    `convertLegacyCatchments` – „budynek” rowów → rów dnem doliny powyżej zbiornika (`legacyDitchPoints`,
    300 m, komórki niżej niż zbiornik odpadają), ten sam identyfikator i podpis kosztu (`legacySig`,
    `legacyKey`) – bez opłaty; karta „rowy” zniknęła z palety;
  - kompaktowe menu budowy (`BuildBar.setCompact`, `localStorage` `ski-sim:menu-kompaktowe`, domyślnie
    przy szerokości okna < 1920 px – `data/ui.json` `buildBar`): ikony 40 px z podpowiedzią i skrótem,
    karty: nazwa + cena (parametr w podpowiedzi), przycisk „−” zwija paletę; przełącznik w menu ☰;
  - testy `tests/building7f.test.ts` (17): przyciąganie (hydrant, pompownia, odcinek, Shift), 90° i 45°,
    przedłużenie, równoległa, łuk; „Naśnież trasę” (odstęp hydrantów, połączenie z pompownią, koszt =
    suma, dobór armatek); ulepszenie wyciągu (linia, podpory, koszt różnicowy, czas przebudowy),
    rozbiórka ze zwrotem, poszerzenie, zamiana armatki, przesunięcie z obrotem; ratrak bez garażu pracuje,
    awarie pod chmurką > 1,5× w garażu (3000 nocy, te same losowania), rynek używanych; rów – zlewnia
    powyżej rowu, rów pod górę odrzucony, rów z dawnego „budynku”; lista „czego brakuje”.
- **Etap 7g – zrobiony** (listopad 2026): działki do dokupienia i kamienie milowe (wzór: Cities: Skylines).
  - działki (`src/sim/parcels.ts`, `data/land.json`): kwadraty 1 × 1 km (Pilsko: 4 × 5, 19 działek – skrawki
    < 5 ha przy granicy pominięte), nazwy „B1” (litera – kolumna od zachodu, numer – wiersz od północy),
    cechy: powierzchnia części polskiej, wysokości od–do, nachylenie średnie i 90 %, las, zabudowa (ESA
    WorldCover), potoki [km], droga publiczna (OSM, w działce albo ≤ 30 m od granicy); cena = łąka
    55 tys. zł/ha (GUS: śląskie 53 414 zł/ha, IV kw. 2024) + grunt przy zabudowie 400 tys. zł/ha (oferty
    gm. Jeleśnia 26–41 zł/m²) + las 69 tys. zł/ha (GUS 2023, śląskie); las ≥ 50 % – tylko dzierżawa
    (Lasy Państwowe, art. 39 ustawy o lasach); czynsz: łąki 4 %, las 2 % wartości rocznie (do kalibracji),
    płatny przy podpisaniu i co roku 1 maja (`annualLeasePln`, koszt `landLease`, zakup – `land`);
    na Pilsku wszystkie działki są w ponad połowie leśne – w praktyce dzierżawa ok. 130–270 tys. zł/rok;
  - kamienie milowe (`src/sim/milestones.ts`, `data/milestones.json`): Górka za wsią (start) → Lokalny stok
    (5 tys. wizyt, reputacja 3,3, 1 sezon) → Ośrodek regionalny (20 tys., 3,8, 2) → Ośrodek górski (60 tys.,
    4,1, 3) → Kurort (150 tys., 4,4, 5); wizyty = goście dni zimowych i letnich (`state.progress.visits`),
    reputacja – lepsza z zimowej i letniej, sezony – zakończone lata gry; sprawdzane po kolei po każdym
    dniu (`checkMilestones`, nie da się przeskoczyć); odblokowania: wyciągi (start: taśma, talerzyk,
    orczyk; kanapa 2 → 4 → wyprzęgane → gondola), armatki (lanca → śmigłowa), budynki (bar przy stoku →
    restauracja, większe zbiorniki, pompownie, przyłącza, plac zabaw, punkt widokowy, transport do
    schroniska), lato (ścieżki → bike park → tor), oświetlenie tras, działki (1 + 1, +2, +3, +4, bez
    limitu), limit kredytu (3 / 8 / 20 / 50 / 150 mln zł, razem z 70 % majątku – `loanLimit`); blokady
    atrakcji letnich z 7b przez kamienie (`attractionUnlocked` zostaje tylko bez kamieni); piaskownica –
    wszystko odblokowane;
  - zasady budowy (`src/sim/buildRules.ts`): tylko obiekty nowe albo zmienione (`changedObjectIds`) –
    kamień milowy typu (`milestoneRefusal`) i działki (`parcelRefusal`: wyciąg – przebieg, trasa – obrys
    z analizy, drogi / rurociągi / rowy / trasy letnie – przebieg, budynek i ujęcie – punkt); start kariery
    tylko na działce przy drodze (`chooseStartParcel`; kupiona albo dzierżawiona z kapitału); starsze
    zapisy (`migrateLegacyCareer`): działki pod zbudowanymi obiektami przyznane (bez opłaty; leśne jako
    dzierżawa), wizyty z historii, kamień z dotychczasowych wyników;
  - oświetlenie tras (`PisteDesign.lit`, karta trasy „Oświetl trasę”, 650 zł/m, 30 W/m po zmroku do
    zamknięcia – koniec zmierzchu cywilnego wg miesiąca w `milestones.json`; zamknięcie do 21:00 tylko
    z oświetloną trasą – `maxCloseH`); bar przy stoku (`economy.json`, 600 tys. zł, 200 gości/dzień) –
    gastronomia jak restauracja (`isFoodType`);
  - widok: `render/parcelView.ts` – warstwa działek (widok danych „Działki” w lewym pasku: granice, nazwy,
    cena / czynsz, twoje – zielone, dzierżawa – niebieskie, wybór startu – pomarańczowe, brakujące pod
    rysowanym obiektem – czerwone) i karta działki (cechy, Kup / Dzierżaw / Zacznij tutaj, limit);
    wybór działki startowej po „Nowa kariera” (pasek z informacją, budowa zablokowana do wyboru);
    okienko przy kursorze: „poza Twoimi działkami – dokup: …”; paleta – zablokowane karty z powodem
    („wymaga: Ośrodek regionalny – 20 tys. wizyt, reputacja 3,8, 2 sezony”, klucze `lift:`, `gun:`,
    `building:`, `trail`); górny pasek – bieżący kamień i postęp do następnego (najmniejszy udział progów),
    okno „Kamienie milowe” (menu ☰ i klik w pasku), okno i powiadomienie po osiągnięciu;
  - testy `tests/land7g.test.ts` (7): siatka i ceny, start tylko przy drodze i zakup z salda, limit
    działek, budowa poza działkami odrzucona z listą brakujących (także ujęcie), dzierżawa przy podpisaniu
    i 1 maja, progi kamienia „dokładnie” (każdy z trzech osobno), blokady typów i oświetlenia,
    piaskownica, starszy zapis.
- **Etap 3D-0 – zrobiony** (listopad 2026): prototyp widoku 3D (Three.js 0.186) obok mapy 2D; symulacja
  i widok 2D bez zmian; kopia stanu sprzed 3D na gałęzi `wersja-2d-przed-3d`.
  - przełączanie: F3 i menu ☰ „Widok 3D (podgląd)”; moduł ładowany dopiero przy pierwszym włączeniu
    (osobny plik ok. 660 kB); budowanie tylko w 2D; parametry `data/render3d.json`;
  - `src/render3d/` – czyste obliczenia (testowane): `terrainMesh.ts` (siatka gry 10 m w kawałkach 50 × 50
    komórek, 4 poziomy szczegółowości co 2^n wg odległości 900/2000/4000 m, fartuchy przeciw szczelinom,
    NaN – bez trójkątów, normalne z różnic środkowych, na brzegu jednostronnych), `cameraRig.ts` (cel,
    odległość, obrót, pochylenie; nie pod teren: najpierw podnosi pochylenie, potem cel), `liftGeometry.ts`
    (lina = krzywa zwisu z symulacji `cableElevationAt`, krzesełka ze wzoru (czas · prędkość) mod odstęp –
    jak w 2D), `buildingShapes.ts` (prostokąt o najmniejszym polu z obrysu OSM, dach 40°);
  - rysowanie: `terrain3d.ts` (materiał terenu z teksturami danych: grubość śniegu, trasa / oświetlona,
    las, kosówka – liniowo; stan śniegu, muldy, zabudowa – najbliższy; barwy puchu, sztruksu, firnu, brei,
    lodu, przetarć – łaty śniegu na cienkiej pokrywie, trawa i kamienie; latem łąki; sztruks i muldy jako
    zaburzenie normalnych do ~260 m; mgła w dolinach poniżej 820 m rano i nocą; trasy oświetlone nocą);
    tło okolicy z Copernicus 30 m (`horizon-dem`, obniżone o 8 m – model z lasem), plamy lasu z szumu,
    linia śniegu z mapy; `forest3d.ts` (świerki 4 warianty niskopoligonowe, kosodrzewina, rozkład
    `treesInRect` z ziarnem jak w 2D, kawałki 500 m: blisko instancje 3D z cieniem, dalej skrzyżowane
    obrazki; śnieg na gałęziach ze średniej grubości; wycinka z analizy układu); `objects3d.ts` (podpory
    z belką, stacje, liny, krzesełka / gondole / orczyki z instancji, budynki OSM i gracza z dachem
    dwuspadowym i śniegiem, tyczki co 25 m w kolorze trasy, siatki na stromiznach ≥ 40 % przy lesie, numery
    tras, ratraki ze światłami i reflektorami nocą, armatki z chmurą cząstek); `people3d.ts` (postacie
    instancjonowane z ramek wątku gości: narty / deska, kurtka z ziarna, pochylenie w skręcie, siedzący
    na krzesełkach); `view3d.ts` (Słońce z `sunPosition` i `localToUtcMs`, zachmurzenie z modelu pogody,
    cienie kaskadowe CSM, niebo Preetham, mgła, noc, GTAO, ACES, korekcja barw; jakość 0–2 – kaskady
    1/3/4, mapa cieni 1024/2048/2048, drzewa 3D do 300/500/900 m, GTAO od średniej);
  - pomiar (kontener bez karty graficznej, SwiftShader, 1920 × 1080): praca kodu na klatkę 5–12 ms,
    520–950 wywołań rysowania, cały ośrodek 2,9 mln trójkątów, z bliska 13–20 mln (z przebiegami cieni),
    do 40–70 tys. drzew 3D; sama klatka w kontenerze trwa ok. 5–10 s (0,1–0,2 kl./s – karta graficzna
    udawana przez procesor) – nic nie mówi o Macu; miarodajny pomiar dopiero na Macu (menu `Dev`);
    po pomiarze zasięg drzew 3D zmniejszony 800 → 500 m (średnia jakość: 23 → 14 mln trójkątów z bliska);
  - zrzuty `docs/3d/` (README.md): cały ośrodek o poranku, Hala Miziowa w południe, trasa z narciarzami,
    wyciąg z krzesełkami, zachód słońca, noc z ratrakami, lato; scenariusz w trybie `?r3d=manual`
    (bez pętli klatek, klatka przez `__view3d.renderOnce()`);
  - testy `tests/render3d.test.ts` (10): kawałki bez szczelin, poziomy szczegółowości, wysokości i normalne
    na stoku 30 %, NaN, kamera nigdy pod terenem (stok 30 %, pełny obrót i pochylenie), widok z góry,
    zbliżenie do kursora, krzesełka na linie w stałym odstępie i z okresem odstęp / prędkość, zamknięty
    wyciąg, prostokąt budynku.
- **Etap 3D-1 – zrobiony** (listopad 2026): w widoku 3D wszystko, co na mapie 2D.
  - linie po terenie (`src/render3d/lines3d.ts`): oś co kilka metrów po terenie (`drapePolyline`), wstęga
    rozszerzana w shaderze (szerokość w metrach, ale nie mniej niż kilka pikseli – bez przeliczania przy
    ruchu kamery), uniesiona tym bardziej, im dalej (zgrubniejszy teren w oddali), przerywane w pikselach
    przy celu kamery; druga warstwa „za wzgórzem” (odwrócony test głębokości) – przerywana,
    półprzezroczysta (zaznaczenie i podglądy);
  - `network3d.ts` (te same dane co 2D – `BuildController.drawState`, `ResortDrawState`): drogi
    publiczne i parkingi z OSM, granica, potoki (grubość z przepływu), szlaki PTTK latem, nazwy miejsc,
    drogi dojazdowe, rowy, trasy letnie (rower w kolorze trudności, ścieżki, tor), rurociągi (zasilające
    inaczej), hydranty (słupki), znaczki baz i budynków (litery jak w 2D), place budowy (postęp %);
    zaznaczenie na pomarańczowo; podglądy rysowania (dla 3D-2);
  - wybór kliknięciem: `ViewCamera` (`render/camera.ts`) – wspólny przelicznik ekran ↔ mapa dla
    `BuildController` (`view`), `GuestController`, `ProfileTool`, `SlopeRing` (kierunek spadku z rzutu
    odcinka 5 m), `SnapOverlay`, `ParcelView` (boki co 50 m – po terenie), `Hud`, dymka; w 3D
    `Camera3DAdapter` (`render3d/picking.ts`: promień z kamery, marsz po terenie i połowienie do 1 mm,
    rzut na wysokości terenu, metry na piksel przy kursorze, `viewKey` do odświeżania rysunków);
    klik w linę, podporę, dach, znaczek – wybór obiektu pod spodem (`groundUnderObjectAt`); płótno 2D
    zostaje nad 3D przezroczyste (bez świata mapy, tło czarne z alfą 0 – mnożenie przez alfę) i bez
    myszy: profil, pierścień, okienka, ikony wypadków, kolejki, zaznaczony gość rysują się w 3D;
  - nakładki danych: ta sama tekstura co w 2D (`FieldOverlay.canvasEl` + `version`, nachylenie
    i ekspozycja – płótna) na terenie 3D (`Terrain3D.setOverlay`, barwa wmieszana i lekko świecąca);
    przy nakładce las schowany; lewy pasek widoków danych i legenda działają w 3D; kolejki (K),
    zlewnia rowu i działki – w pikselach ekranu przez `ViewCamera`;
  - klawisze w 3D: kamera (W A S D, strzałki, Q E R F), nakładki (1–9, G, M, K), czas (spacja), dymek
    (I), profil (P), Esc, menu Dev; narzędzia budowy – etap 3D-2;
  - wydajność: pomiar właściciela na Macu – 60 kl./s przy średniej jakości (1920 × 1080); automatyczna
    płynność (`governor.ts`, `data/render3d.json` sekcja `governor`): co 2 s, poniżej 50 kl./s mniejsza
    rozdzielczość (do ×0,6), potem bliższe drzewa 3D (do ×0,5); przy ~60 kl./s powrót do ustawień
    jakości (nie wyżej); stan w menu Dev;
  - testy `tests/render3d1.test.ts` (7): linia po terenie (krok, wysokość, długość, przerwa poza mapą),
    automatyczna płynność, punkt mapy → ekran → punkt ±0,5 m (stok 0 i 40 %, obroty co 30°,
    pochylenia 12–88°, odległości 120–2000 m; punkty zasłonięte wzgórzem pominięte), piksel → punkt
    → piksel.
- **Etap 3D-2 – zrobiony** (listopad 2026): budowa i edycja w widoku 3D.
  - wszystkie narzędzia budowy działają w 3D tym samym kodem co w 2D (`BuildController`, `snapping`,
    `lineTools`) – inna jest tylko zamiana ekran ↔ teren (`ViewCamera` → `Camera3DAdapter`); mysz z płótna
    3D trafia do tych samych funkcji (`View3D.hooks`: klik, podwójny klik, prawy, przeciąganie narzędzia –
    gdy narzędzie nie przejmie przeciągania, przeciąganie przesuwa kamerę); dolne menu budowy i paleta
    widoczne w 3D; klawisze narzędzi jak w 2D poza literami kamery (E – droga, Q – ścieżka, F – rura
    zasilająca, R – obrót budynku: w 3D z palety / prawym przyciskiem);
  - linie budowy przyklejone do terenu (`network3d.ts`, warstwa podglądów): rysowana droga, rurociąg,
    trasa letnia, trasa narciarska (pas o szerokości trasy w kolorze klasy z analizy), oś wyciągu;
    za wzgórzem i drzewami – przerywane, półprzezroczyste; linie pomocnicze przyciągania próbkowane na
    mapie i rzutowane (w 3D idą po terenie, w 2D bez zmian);
  - podgląd wyciągu (`liftPreview3d.ts`): podpory i lina w prawdziwej wysokości z analizy symulacji, odcinki
    z prześwitem poniżej minimum (poza strefą stacji, jak w `lifts.ts`: `lowClearanceSpans`) i podpory na
    nich – na czerwono; lina widoczna przez drzewa (przerywana); także zaznaczony wyciąg w trakcie edycji;
  - „widok z góry” (klawisz Z albo przycisk): kamera płynnie (0,6 s) pionowo nad miejscem pod kursorem,
    ten sam obrót, odległość ≤ 1,5 km; drugie naciśnięcie – powrót do poprzedniego ustawienia;
  - uchwyty edycji (`drawEditHandles` – wspólna funkcja 2D i 3D, rzut przez `ViewCamera`), przyciąganie,
    okienko z długością, kosztem i nachyleniem, pierścień nachylenia – jak w 2D;
  - wycinka w lesie 3D przeliczana tylko przy zmianie maski (budowa drogi czy rury nie przebudowuje drzew);
  - testy: `tests/render3d1.test.ts` – punkt wskazany w 3D = punkt mapy ±0,5 m (stok 0 i 40 %, obroty
    co 30°, pochylenia 12–88°), piksel → mapa → piksel, za mały prześwit tylko poza strefą stacji;
    sprawdzenie w przeglądarce: wyciąg zbudowany dwoma kliknięciami w 3D (błąd wskazania 1 mm), droga
    narysowana ręką (349 m), widok z góry (89°) i powrót.
- **Etap 3D-3 – zrobiony** (listopad 2026): oprawa 3D – śnieg z grubością i światło (tylko `src/render3d`,
  symulacja bez zmian).
  - parametry `data/map-style.json` sekcja `render3d` (27 wartości z jednostką i opisem: Słońce, niebo,
    mgiełka, obraz, śnieg, okna, czapy), `render3d/look.ts` (`parseLook`, `LOOK_SLIDERS`, `lookToJson`,
    `sunDirection`); menu `Dev` → „Oprawa 3D (etap 3D-3)”: suwaki (zmiana od razu, także przed włączeniem
    3D), „Kopiuj ustawienia”, „Przywróć z pliku”; z `render3d.json` usunięte dawne `atmosphere.exposure`,
    `fogDensity`, `pisteLightIntensity` (teraz w `map-style.json`);
  - powierzchnia śniegu (`render3d/snowSurface.ts`): teren + grubość z modelu (siatka 10 m, wartości
    w środkach komórek, dwuliniowo – bez schodków), ten sam wzór w TS (`snowSurfaceAt`) i GLSL
    (`SNOW_DEPTH_GLSL`, tekstura float, `texelFetch`); wierzchołki terenu podniesione w shaderze, normalne
    z nachylenia pokrywy (zaspy, wywiane grzbiety); przewyższenie tylko w menu Dev (1 = skala prawdziwa);
    linie (`lines3d.ts`) dostają grubość w shaderze (leżą na śniegu także po zmianie dnia); ludzie, ratraki,
    cel kamery i wskazywanie myszą – `Terrain3D.surfaceAt`; podpory, stacje, budynki, armatki, drzewa,
    hydranty – na terenie (dolna część schowana w śniegu);
  - łata gęstej siatki przy kamerze (`render3d/snowPatch.ts`, `Terrain3D.updatePatch`): bok 192 m (średnia)
    / 288 m (wysoka), krok 1 m, wokół celu kamery; teren bazowy pod łatą odrzucany w shaderze; brzeg łaty na
    liniach przez środki komórek (dokładnie wysokość terenu bazowego – bez szczeliny), rzeźba warstwy detalu
    (muldy, pryzmy – odchylenie od średniej komórki 10 m, masa zachowana; pryzmy rozmyte ok. 2 m) wygasa
    w pasie `patchFadeM`; przebudowa ok. 25–35 ms – przy przesunięciu o ćwierć boku / nowym śniegu od razu,
    przy zmianie samej warstwy detalu najwyżej co 8 s; tekstura detalu 1 m w łacie (sztruks w kierunku
    przejazdu ratraka, blednący w 18 h, ślady nart, świeży śnieg – zasypuje); dalej od kamery rzeźba tylko
    w cieniowaniu (jak w 3D-0);
  - czapy drzew (`forest3d.ts`) wg grubości w komórce drzewa (`treeSnowFullM`), dachy (`objects3d.ts`) wg
    grubości w komórce (`roofSnowFullM`), szczyty dachów w barwie ścian, okna na ścianach (siatka 3,2 × 3 m,
    część zapalona) świecące nocą (`windowGlow`);
  - światło: kierunek Słońca z `sim/sun.ts` (`sunDirection`), siła i barwa wg wysokości (ciepłe nisko,
    `sunWarmLow`) i zachmurzenia (`sunCloudDim`), światło nieba wg zachmurzenia (`skyBase`, `skyCloudBoost`)
    z niebieskawymi cieniami (`skyBlue`), mgiełka gęstsza przy chmurach i opadzie (`fogCloudBoost`,
    `fogPrecipBoost`; opad z `EnvironmentState`), dalekie góry bledsze (`farHaze`), iskrzenie puchu,
    połysk lodu i brei (szorstkość), ACES + korekta (ekspozycja, nasycenie, kontrast, ciepło), miękkie
    cienie PCF (`shadowSoftness`, jakość niska – ostre), GTAO (`aoIntensity`); wszystkie materiały
    obiektów, ludzi i lasu z cieniami kaskadowymi;
  - jakość (`render3d.json` → `quality`: `snowPatchM` 0/192/288 m, `snowPatchStepM`, `shadowSoftness`):
    przy pierwszym uruchomieniu 3D pomiar kl./s przy średniej (1 s rozgrzewki + 4 s, `autoQuality`:
    ≥ 58 – wysoka, < 40 – niska), wynik w `localStorage` `ski-sim:jakosc3d`; zmiana przyciskiem „Jakość”;
  - testy `tests/render3d3.test.ts` (11): powierzchnia = teren + grubość ±1 cm w punktach kontrolnych,
    bez schodków, bez śniegu = teren, przewyższenie; łata – brzeg = teren bazowy, rzeźba w środku, średnia
    komórki zachowana, łata tylko przy śniegu; kierunek Słońca = azymut i wysokość z `sun.ts`; parametry
    z opisem i suwakiem; ustawienia jakości nie zmieniają sezonu (ten sam seed), rysowanie nie zmienia
    danych śniegu; `src/sim` i `src/worker` nie sięgają do `render3d`, `three` ani `map-style.json`;
  - zrzuty przed / po: `docs/ui/3d-oprawa/` (README.md): dolna stacja rano, pryzmy armatek, budynek po
    śnieżycy, zachód słońca, noc z ratrakiem;
  - pomiar (kontener bez karty graficznej, SwiftShader, 1600 × 900, średnia): praca kodu na klatkę 5–10 ms,
    z przebudową łaty 25–40 ms (raz przy przesunięciu); 520–670 wywołań rysowania, 6–14 mln trójkątów;
    miarodajne kl./s (cel: średnia ≥ 50 przy ok. 2000 gości) – pomiar właściciela na Macu (menu Dev; nowy
    wiersz „łata śniegu przy kamerze: przebudowa … ms”);
  - obserwacja (symulacja, nie rysunek): przy dolnym końcu naśnieżanej trasy w scenie zrzutów pryzmy rosną
    noc po nocy (średnio ok. 3,2 m wody w komórce 10 m ≈ 6 m śniegu) – ratrak ich nie rozgarnia; do
    sprawdzenia w modelu ratraków (etap 7).
- **Następny: etap 8 – anomalie, awarie, ratownicy, reputacja, konkurencja.**

Uwagi techniczne:
- Przed wypchnięciem uruchamiać `npm run build` (nie tylko `npm test` i `tsc -p tsconfig.json`):
  sprawdza też `tsconfig.sim.json`, w którym `src/sim` nie ma typów przeglądarki ani Node –
  np. `structuredClone` nie przechodzi (etap 7: publikacja padła na tym; kopia stanu przez JSON).
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

- Interfejs (7c): makieta zakłada „Rozbuduj parking o 120 miejsc”, „Zatrudnij kucharza”, menu
  potraw, oceny jedzenia/cen/czekania – w symulacji tego nie ma (karta proponuje kolejny budynek);
  opinie gości i tabela wyciągów w raporcie tylko z dni oglądanych na żywo (dni przewinięte – model);
  wąskie gardło z modelu dla dni przewiniętych; paleta – blokady tylko atrakcji letnich (wyciągi bez
  progów reputacji); minimapa bez odświeżania śniegu w ciągu doby; brak przeciągania punktów linii
  w trakcie rysowania punktami (dopiero po zakończeniu).

## Na później

- Widok 3D (3D-0): modele generowane kodem (stożki świerków, prostopadłościany stacji, postacie
  z brył) – do wymiany na modele z programu graficznego (glTF) i animacje; siatka terenu tylko 10 m
  (bez kafli 1 m przy zbliżeniu – sztruks i muldy jako zaburzenie normalnych, nie geometria); stan śniegu
  w komórkach 10 m (schodki na brzegach przetarć i oświetlenia tras); brak dróg, parkingów, potoków,
  szlaków, rurociągów i tras letnich w 3D (dodane w 3D-1); brak cieni chmur, opadu, gwiazd i Księżyca; tło okolicy bez
  drzew (plamy z szumu); dalekie drzewa (obrazki) budowane od razu dla całej mapy (~290 tys.); cień
  rzucają tylko bliskie drzewa; kamera może wejść między korony drzew; śnieg na gałęziach ze średniej grubości na mapie (nie z opadu i temperatury); płynność
  na Macu – 60 kl./s przy średniej jakości (pomiar właściciela po 3D-0).
- Widok 3D (3D-1): nakładki przykrywają teren, a las jest wtedy schowany (dane pod koronami); działki,
  zlewnia rowu i kolejki rysowane w pikselach ekranu (proste odcinki między punktami terenu co 50 m /
  komórkami 10 m); linie dróg i rur rozjaśnia mapowanie tonów (ACES) – kolory nieco jaśniejsze niż w 2D;
  wybór gościa na krzesełku (w powietrzu) – po punkcie terenu pod nim; minimapa w 3D schowana.
- Oprawa 3D (3D-3): wartości oprawy „do wyczucia” – stroić suwakami na Macu i przenieść do pliku; cienie
  terenu bez grubości śniegu (mapa cieni z gołego terenu – różnica do ok. 1 m); dach bez grubości warstwy
  śniegu (tylko barwa); czapy drzew wg grubości na ziemi (nie z opadu i temperatury); łata przy kamerze
  liczona na procesorze w głównym wątku (25–35 ms – do przeniesienia do Web Workera, jeśli na Macu będzie
  widać szarpnięcie); poza łatą rzeźba pryzm i muld tylko w cieniowaniu; okna – wzór z położenia (bez
  pięter i drzwi z modelu budynku); iskrzenie zależne od położenia kamery (miga przy ruchu).
- Budowa w 3D (3D-2): klawisze E, Q, F, R sterują kamerą – te narzędzia tylko z palety; zlewnia rowu,
  podgląd „Naśnież trasę”, przesuwany budynek i działki rysowane w pikselach ekranu (odcinki między
  punktami terenu); podgląd trasy narciarskiej to pas stałej szerokości po terenie (bez obrysu
  z analizy); profil wyciągu / trasy w panelu jak w 2D (zasłania dół ekranu).

- Lato (7b): popyt letni, udziały typów gości, ceny i koszty atrakcji do kalibracji (frekwencja Pilska,
  Babiej Góry, dane kolei); wynik lata w raporcie raczej optymistyczny (cała kanapa i restauracja
  przy górnej stacji, brak konkurencji letniej poza stałym „A_inne”); zimowi goście w agentach nadal
  z dzienną pojemnością parkingów (karty – model dnia), latem pojemność chwilowa; wypożyczalnia rowerów
  bez własnej kolejki; burza – piesi na górze czekają w schronisku; brak oświetlenia i wydarzeń.

- Woda (6b): raport ekonomii nadal z uproszczonym dopływem z ujęcia – przestawić na model potoków
  (ujęcie na Buczynce, rura zasilająca); współczynnik odpływu, przepływ nienaruszalny, wydajności studni
  i wodociąg (limit, cena dla Korbielowa) do kalibracji; rowy zlewni bez strat na infiltrację zimą;
  podgląd doby liczy dopływ ze zlewni na kopii stanu (zapamiętany śnieg zlewni). Ekonomia Pilska: popyt
  i udział płac do kalibracji (frekwencja prawdziwego Pilska).

- Dopracowanie przewiewania śniegu na podstawie zdjęć Sentinel-2 (mapy pokrywy śnieżnej
  po zamieciach – gdzie śnieg znika z grzbietów i gdzie zalega w zagłębieniach).
- Generator pogody: wielodniowe epizody silnego opadu (śnieżyce) – za niskie maksima grubości.
- Budowa: trasy obszarowe z OSM (area=yes) w porównaniu; mapa bazowa przerysowana po wycince
  (teraz przecinka to osobna warstwa nad mapą).
- Naśnieżanie (7): wartości armatek, pompowni, zbiorników i ratraków z kart producentów; zbiornik
  50 tys. m³ to za dużo na 6 ha (sezon zużywa ok. 27 tys. m³) – inwestycja w raporcie zawyżona; automat
  ratrakuje od razu od 17:30 (doświadczony operator czekałby na mróz – mniej lodu); śnieg techniczny
  w modelu bez osobnego, wolniejszego topnienia poza większą gęstością; brak przestawiania armatek
  przez automat; podgląd naśnieżania liczy dzień z prognozą równą pogodzie (gracz zna przyszłość dnia).
- Ekonomia (6): pula popytu, udziały typów grup, wagi regionów, elastyczność cenowa i koszty – do
  kalibracji (frekwencja i finanse prawdziwych ośrodków); konkurencja bez reakcji na nasze ceny;
  ceny bez inflacji w kolejnych latach; brak karnetów sezonowych i wielodniowych; brak oświetlenia
  tras (jazda wieczorna); w raporcie 10 sezonów obie trasy czerwone – na Pilsku orczyk mieści się
  tylko na niższych, stromych stokach (przechył toru ≤ 10 % na siatce 10 m).
- Śnieg a jazda (5b): progi minimalnej bazy i skutki cienkiej bazy do kalibracji (dane ośrodków,
  ratraków); podłoże tylko z pokrycia i nachylenia (bez mapy kamienistości); podłoże nie wpływa na
  model śniegu (np. kamienie szybciej przebijają się przy topnieniu); limity kąta i koszty stacji
  kątowych – z kart producentów; profil panelu zasłania dolną część mapy (przesuń mapę).

- Detal z bliska (7d): płynność na Macu z kartą graficzną do sprawdzenia (menu `Dev` – kl./s);
  w kontenerze bez GPU shader detalu ok. 1,5–3× wydłuża czas klatki z bliska; długa kolejka (> ok. 55 osób)
  stoi rzędami za szpalerami w linii prostej – także w lesie i przez potok (bez dopasowania do terenu);
  przetarcia (trawa) zależą od „za cienkiej bazy do jazdy”, więc na trasie widać trawę, choć obok
  (ten sam śnieg, nieubity) jest biało – do kalibracji; ślady nart z przejazdów
  dnia mają stały wzór (rowki wzdłuż linii spadku), nie z prawdziwych torów gości; muldy – pole
  garbów w układzie mapy (zaburzone szumem), nie wzdłuż linii spadku; sztruks nocą ledwie widoczny (światło
  reflektorów nie oświetla faktury); pył spod nart tylko w stanie „puch”; atlas rysowany wektorowo
  (styl prosty) – do wymiany na rysunki w stylu docelowym bez zmian w kodzie (`data/atlas.json`).
- Działki i kamienie (7g): ceny gruntów i czynsze do kalibracji (brak opublikowanych stawek dzierżawy pod
  stoki – przetargi gmin i LP); działka kupowana w całości (bez podziału na mniejsze części); las ≥ 50 %
  tylko w dzierżawie także, gdy część jest łąką; jazda wieczorna – goście w modelu jeżdżą po zmroku po
  wszystkich trasach (oświetlenie decyduje tylko o godzinie zamknięcia i koszcie prądu); progi kamieni
  milowych do kalibracji na rozegranych karierach; przeniesienie istniejącego obiektu na cudzą działkę
  jest odrzucane, ale obiekt już stojący na niej zostaje.
- Budowanie (7f): przyciąganie tylko do końców i odcinków (bez przecięć dwóch linii pomocniczych naraz);
  kąt liczony względem najbliższego odcinka w promieniu 60 m od początku rysowanego odcinka; łuk – jeden
  punkt sterujący na odcinek (bez edycji punktu sterującego po postawieniu – potem jak zwykła linia);
  „Naśnież trasę” prowadzi rurę jedną stroną trasy i podłącza do pierwszej pompowni najbliższej trasie
  (bez wyboru pompowni, bez sprawdzania mocy przyłącza i pojemności zbiornika – tylko ostrzeżenie
  o pompowni), dojście po terenie nie omija budynków ani innych tras; reguła śmigłowa / lanca i czas
  pierwszego zaśnieżenia do kalibracji; ulepszenie wyciągu w trakcie przebudowy – wyciąg nie działa
  (zmiana podpisu), ale bez osobnej opłaty za rozbiórkę starego; przeniesienie budynku kosztuje jak
  przebudowa (10 % + czas); karty używanych ratraków bez zdjęć i historii; rów: zlewnia z modelu spływu
  D8 (priorytetowe wypełnianie) – na równym stoku spływ bywa skośny, przez co zlewnia rowu jest
  przesunięta w bok (do 20–30 % powierzchni); rów nie traci wody na wsiąkanie zimą; samouczek tylko
  dla naśnieżania.
- Rzeźba (7e): wartości cieniowania, kresek i warstwic „do wyczucia” – stroić suwakami w menu Dev
  na Macu i przenieść do pliku; opisy warstwic czasem do góry nogami (konwencja: góra pod górę) i bez
  przerwy w linii pod napisem; kreski z gradientu siatki 10 m (na krótkich stromiznach < 20 m słabo);
  kafle przeliczają się po każdej zmianie suwaka (chwilę widać stary wygląd).
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
- Sezon letni (etap 7b): od maja do października, gracz otwiera i zamyka; dni jak zimą.
- **Widok 3D jest docelowy** (od etapu 3D-1; pomiar na Macu: 60 kl./s przy średniej jakości, 1920 × 1080).
  Mapa 2D zostaje jako „mapa” (przełącznik F3 / menu ☰), ale **nowe elementy graficzne robimy tylko
  w 3D** (`src/render3d/`). Narzędzia (budowa, wybór, profil, pierścień, okienka) liczą ekran ↔ mapa
  przez wspólny `ViewCamera` – w 2D kamera mapy, w 3D promień z kamery na teren (`Camera3DAdapter`).
- Mapa 2D z góry. **Mapa: styl A – „ilustrowana mapa narciarska”** (od etapu 4b):
  biały śnieg z niebieskawym cieniowaniem rzeźby, świerki rysowane z boku, trasy jako kolorowe
  linie z białą obwódką, wyciąg jako ciemna linia z podporami i stacjami, etykiety z białą obwódką.
  Nowe elementy (goście, ratraki, armatki, budynki) rysować w tym stylu: widok z góry z cieniem
  w prawo w dół ekranu, ikony z boku tylko dla drzew; obiekty ruchome przez `MoverLayer`. Mapa
  topograficzna zostaje jako widok danych.
- **Interfejs – zasady wyglądu obowiązujące od etapu 7c** (makiety i ich HTML w `docs/ui/` – źródło
  dokładnych kolorów, rozmiarów i czcionek; style w `src/render/style.css`):
  - panele ciemnogranatowe półprzezroczyste `rgba(20,31,43,0.92–0.94)` z rozmyciem tła (blur 14 px),
    obramowanie `rgba(255,255,255,0.09)`, zaokrąglenie 14 px (karty) / 10 px (przyciski);
  - tekst `#EEF3F8`, drugorzędny `#9DB0C3`; **jeden kolor akcentu: pomarańcz siatek
    zabezpieczających `#FF7A1A`** – tylko zaznaczenie, aktywne narzędzie i główny przycisk; stany:
    dobrze `#5FD39A`, uwaga `#F5C542`, źle `#FF6B6B`, woda i śnieg `#7CC4F2`;
  - czcionki Barlow (tekst) i Barlow Condensed (liczby, nagłówki), cyfry tabelaryczne; wgrane
    lokalnie (`@fontsource`), bez Google Fonts – gra działa offline i na Macu;
  - ikony: jeden zestaw liniowych ikon SVG (`src/render/ui/icons.ts`, grubość 1,7–1,9), bez emoji;
  - bez gradientów i cieni pod każdą kartą (cień tylko pod oknami: raport, dialogi); teksty krótkie,
    zdaniami, bez wielkich liter w etykietach;
  - każdy przycisk ma podpowiedź (`data-tip`, skrót w `data-key`), widoczne obramowanie fokusu
    (Tab); cały interfejs w kontenerze `#ui` ze skalą (`--ui-scale`, menu → Skala interfejsu).
