# Symulator ośrodka narciarskiego – Pilsko

Realistyczny symulator budowy i prowadzenia ośrodka narciarskiego na północnych stokach Pilska.
Zasady projektu i plan etapów: plik [CLAUDE.md](CLAUDE.md).

**Stan: etap 4 – budowa wyciągów i tras.** (Etap 3 – model śniegu.) Mapa to Numeryczny Model Terenu z Geoportalu (GUGiK)
w siatce 10 m: od granicy ze Słowacją pod Pilskiem do dna doliny w Korbielowie, z lasem
(ESA WorldCover). Na mapie widać cienie terenu w dowolnym dniu i godzinie, nasłonecznienie,
temperaturę, grubość i stan śniegu; pogodę daje generator oparty na danych IMGW z lat 2001–2025.
Śnieg jest na razie tylko naturalny (bez narciarzy, naśnieżania i ratraków).

**Raport zimy** (model śniegu obok pomiarów IMGW, punkty kontrolne, mapy grubości, 30 zim):
https://celif89.github.io/ski-sim/raport-zimy.html

**Raport klimatu** (30 wygenerowanych zim obok danych IMGW, mapy promieniowania):
https://celif89.github.io/ski-sim/raport-klimatu.html

---

## Jak zagrać (najprościej – w przeglądarce)

Gra jest publikowana automatycznie pod adresem:

**https://celif89.github.io/ski-sim/**

Nic nie trzeba instalować. Nowa wersja pojawia się tam kilka minut po każdej zmianie na gałęzi
`main` – ale **tylko wtedy, gdy wszystkie testy przeszły**. Jeśli testy nie przejdą, na stronie
zostaje poprzednia, sprawna wersja.

### Sterowanie

| Czynność | Jak |
|---|---|
| Przesuwanie mapy | przeciągnij myszą albo strzałki / klawisze W A S D |
| Przybliżanie i oddalanie | kółko myszy (przybliża w miejscu kursora), na gładziku Maca: gest szczypania; klawisze `+` / `−` |
| Cała mapa na ekranie | klawisz `0` lub `Home` |
| Obrót mapy o 180° | róża kierunków w prawym dolnym rogu (strzałka **N**). Domyślnie widok od Korbielowa: szczyt u góry, północ na dole |
| Upływ czasu gry | prawy górny róg: pauza, ×1 (dzień sezonu w ok. 10 minut, noc szybciej), ×5, ×20; spacja – pauza / ×1 |
| Nakładki danych | przycisk **„Nakładki”** na dolnym pasku (tam też mapa topograficzna, sieć tras, prawdziwy ośrodek) albo klawisze `1`–`8` |
| Nakładka nachylenia | „Nakładki” → „Nachylenie” lub klawisz `1` |
| Nakładka ekspozycji | przycisk „Ekspozycja” lub klawisz `2` |
| Sama mapa | przycisk „Bez nakładki” lub klawisz `3` |
| Nasłonecznienie teraz (W/m²) | przycisk „Słońce teraz” lub klawisz `4` |
| Suma dobowa promieniowania (kWh/m²) | przycisk „Słońce – doba” lub klawisz `5` |
| Temperatura powietrza | przycisk „Temperatura” lub klawisz `6` |
| Grubość śniegu (cm) | przycisk „Śnieg – grubość” lub klawisz `7` |
| Stan śniegu (puch, przewiany, osiadły, firn, breja, zlodzony, przetarty) | przycisk „Śnieg – stan” lub klawisz `8` |
| Przewijanie sezonu (śnieg zmienia się dzień po dniu do 30 kwietnia) | lewy górny róg: „Kalendarz i słońce” → „▶▶ Przewiń sezon”, prędkość 1 / 5 / 20 dni na sekundę |
| Dzień i godzina | lewy górny róg: „Kalendarz i słońce” – data, strzałki ◀ ▶, suwak godziny, „▶ Odtwórz dzień” |
| Pogoda | plakietka u góry na środku (temperatura, śnieg, wiatr); kliknięcie – szczegóły i prognoza na 7 dni |
| Menu deweloperskie | przycisk „Dev” w lewym dolnym rogu lub klawisz `` ` `` – scena demonstracyjna (narciarze, ratrak), licznik klatek |
| Profil terenu | przycisk „Profil terenu” lub klawisz `P`, potem kliknij punkt A i punkt B; `Esc` zamyka |

### Budowa ośrodka (dolny pasek i panel „Budowa ośrodka” po prawej)

Dolny pasek: **Wyciąg**, **Trasa**, **Budynki** (baza), **Nakładki**. „Wycinka” i „Naśnieżanie”
są wyszarzone – wycinka liczy się sama pod wyciągami i trasami, naśnieżanie to etap 7.

| Czynność | Jak |
|---|---|
| Wyciąg | wybierz typ, przycisk „Wyciąg” lub klawisz `L`; kliknij **dolną**, potem **górną** stację. W trakcie na dole widać profil terenu z liną, podporami i ostrzeżeniami. |
| Trasa pędzlem | „Trasa – pędzel” lub `T`: przeciągnij myszą wzdłuż trasy (mapę przesuwasz wtedy prawym przyciskiem lub klawiszami) |
| Trasa po osi | „Trasa – oś” lub `O`: klikaj kolejne punkty osi; podwójne kliknięcie lub `Enter` – koniec, `Backspace` – cofnij punkt |
| Szerokość trasy | suwak w panelu lub klawisze `[` i `]` |
| Baza (parking, wioska) | „Baza” lub `B`, kliknij miejsce – trasy mogą się tam kończyć |
| Wybór obiektu | „Wybierz” lub `V`, kliknij wyciąg lub trasę na mapie albo w liście – profil i liczby na dole |
| Podpory wyciągu | na wykresie profilu: przeciągnij podporę w bok (położenie) lub w górę/dół (wysokość); podwójne kliknięcie – nowa podpora; prawy przycisk – usuń; przycisk „Rozstaw podpory automatycznie” |
| Usuń | `Delete` lub przycisk „Usuń” |
| Cofnij / ponów | `Ctrl+Z` / `Ctrl+Y` (na Macu `Cmd`) lub przyciski |
| Sieć ośrodka | `N` – strzałki kierunku zjazdu, numery, połączenia, ostrzeżenia o trasach „donikąd” |
| Prawdziwy ośrodek Pilsko | `R` – wyciągi i trasy z OpenStreetMap (półprzezroczyste, nie do edycji) i tabela: oficjalny kolor trasy a nasza klasyfikacja |
| Zapis | układ zapisuje się sam w przeglądarce; „Zapisz plik” / „Wczytaj plik” – plik JSON |

Budowa jest na razie natychmiastowa i bez pieniędzy (to etap 6), ale każdy obiekt ma policzony koszt
i czas budowy. Wycinka lasu pod wyciągiem i na trasie zmienia pokrycie terenu – model śniegu liczy
wtedy sezon od nowa (na przecince więcej słońca i wiatru, brak zatrzymywania śniegu w koronach).

### Co widać

- **Mapa w stylu „ilustrowanej mapy narciarskiej”** (etap 4b): biały śnieg z niebieskawym
  cieniowaniem rzeźby, las jako świerki rysowane z boku, trasy jako kolorowe linie z białą obwódką,
  wyciągi jako ciemna linia z podporami, stacjami i jadącymi krzesełkami, budynki, drogi i parkingi
  z OpenStreetMap, nazwy miejsc z białą obwódką. Wygląd zależy od przybliżenia (płynnie):
  - **cały ośrodek** (powyżej ok. 4 m na piksel): śnieg według modelu (gruby – biały, cienki –
    płaty, bez śniegu – trawa), las jako gęsta faktura świerków, kosodrzewina;
  - **średnie przybliżenie** (ok. 1–4 m/px): pojedyncze świerki z cieniem (wielkość i odcień
    losowane z ziarnem – zawsze te same drzewa), przecinki z ostrymi krawędziami, dachy ze śniegiem;
  - **detal** (poniżej ok. 1 m/px, do 0,25 m/px): faktura śniegu według stanu – puch, przewiany,
    firn, breja, lód z połyskiem, przetarcia z trawą i kamieniami, a za ratrakiem sztruks (prążki
    w kierunku przejazdu, styki pasów), za narciarzami ślady na puchu i muldy. Ślady z czasem
    znikają, przy opadzie szybciej.
  Pora dnia zmienia światło (poranek chłodny, zmierzch ciepły, noc ciemna z oświetlonymi trasami
  i światłami ratraków); gdy pada, na ekranie widać płatki śniegu lub deszcz.
- **Scena demonstracyjna** (menu „Dev” albo adres `…/ski-sim/?demo=50`): kilkudziesięciu narciarzy
  zjeżdża po trasach (zbudowanych albo prawdziwych z OpenStreetMap) i jeden ratrak wyrównuje trasę.
  To tylko pokaz wyglądu – prawdziwi goście to etap 5. Sztruks i przetarcia najlepiej widać przy
  przybliżeniu ok. 0,25–0,5 m/px (pasek stanu na dole pokazuje skalę).
- **Mapa topograficzna** (dawna mapa bazowa, „Nakładki” → „Mapa topograficzna”): cieniowanie rzeźby (światło z północnego zachodu, jak na mapach
  topograficznych), barwy wysokości (zielonkawo w dolinach, jasny beż na grzbietach),
  warstwice co 10 m, pogrubione co 50 m z opisem wysokości, czerwona przerywana granica państwa.
  Teren po stronie słowackiej jest zakreskowany – to „poza mapą” (bez danych, nie do zabudowy).
- **Nakładka nachylenia** w kolorach tras: zielony do 10 %, niebieski do 25 %, czerwony do 40 %,
  czarny powyżej (progi w pliku `data/slope-classes.json`).
- **Nakładka ekspozycji:** stoki opadające na południe w ciepłych barwach, na północ w zimnych.
- **Legenda** aktywnej nakładki po prawej (bez nakładki – kolory tras i znaki mapy).
- **Pasek na dole:** współrzędne kursora w układzie PUWG 1992 (X – północ, Y – wschód, jak
  w geodezji) i w stopniach, wysokość terenu, nachylenie (% i °), ekspozycja, skala.
- **Profil terenu:** wykres przekroju A–B, odcinki pokolorowane jak nakładka nachyleń;
  odległość pozioma, różnica wysokości, maksymalne i średnie nachylenie. Po najechaniu na wykres
  żółty punkt pokazuje to miejsce na mapie.
- **Słońce i cienie:** nakładka 4 pokazuje, ile energii słonecznej dociera w tej chwili do każdego
  miejsca stoku – z cieniami terenu (także od kopuły Pilska po stronie słowackiej) i z zachmurzeniem
  z generatora pogody. „Odtwórz dzień” przesuwa czas od wschodu do zachodu Słońca – cienie
  wędrują po mapie. Przy pierwszym uruchomieniu gra liczy horyzont każdego miejsca (kilka sekund,
  pasek postępu), potem pamięta wynik.
- **Temperatura** (nakładka 6): spada z wysokością; niebieskie – mróz, pomarańczowe – powyżej 0 °C.
  Granica kolorów to izoterma 0 °C, czyli mniej więcej granica śnieg/deszcz.
- **Śnieg** (nakładki 7 i 8): grubość i stan śniegu o północy wybranego dnia. Pod kursorem pasek
  na dole pokazuje grubość, ilość wody w śniegu (SWE), gęstość i stan. Przy pierwszym włączeniu
  gra liczy sezon od 1 października do wybranego dnia (kilkanaście sekund, pasek postępu); potem
  przewijanie do przodu jest szybkie, a cofanie – z zapamiętanych stanów co 15 dni.
  Las widać na mapie jako świerki (na mapie topograficznej – ciemniejsza zieleń).
- **Pogoda** (plakietka u góry, po kliknięciu szczegóły): warunki teraz na dole i na górze ośrodka (temperatura, opad i jego
  rodzaj, wiatr, wilgotność, zachmurzenie) i prognoza na 7 dni. Prognoza jest niepewna – im dalej,
  tym bardziej może się mylić (±°C w ostatniej kolumnie).

### Punkty kontrolne do porównania z Geoportalem

| Punkt | PUWG 1992 X (N) | PUWG 1992 Y (E) | Stopnie | Wysokość z Geoportalu |
|---|---|---|---|---|
| Hala Miziowa – wypłaszczenie przy schronisku | 185 950 | 522 980 | 49,54055° N, 19,31773° E | 1275,1 m |
| Stok powyżej Hali Miziowej, przy granicy | 185 150 | 523 300 | 49,53334° N, 19,32211° E | 1461,5 m |
| Dolina potoku w Korbielowie | 189 200 | 524 900 | 49,56971° N, 19,34448° E | 657,4 m |

Wysokości z Geoportalu są w układzie PL-EVRF2007-NH, tym samym, którego używa mapa gry.
Gra pokazuje średnią wysokość komórki 10 × 10 m, więc na stromym stoku może się różnić od
wartości w punkcie o 1–2 m.

### Raport klimatu („przewiń zimy”)

https://celif89.github.io/ski-sim/raport-klimatu.html – na górze werdykt ZGODNE / NIEZGODNE:
czy 30 zim z generatora pogody zgadza się z danymi IMGW (średnie temperatury, sumy opadu,
liczba dni z opadem w miesiącach XI–IV). Niżej wykresy, przykładowa zima dzień po dniu (na dole
i na górze ośrodka – widać, kiedy na górze pada śnieg, a na dole deszcz) i mapy sumy promieniowania
21 grudnia i 21 marca. Lokalnie: `npm run climate-report` → plik `reports/raport-klimatu.html`.

### Raport zimy („przewiń zimę”)

https://celif89.github.io/ski-sim/raport-zimy.html – na górze werdykt ZGODNE / NIEZGODNE Z POMIARAMI:
model śniegu policzony na prawdziwej pogodzie 49 zim (2001–2021) w Korbielowie, Zawoi i Lalikach
porównany z grubością śniegu mierzoną codziennie przez IMGW (średni błąd w cm, różnica długości
zalegania w dniach). Niżej: wykresy każdej z tych zim (pomiar i model), zimy z generatora obok
prawdziwych zim 2001–2025 (dni z pokrywą, maksimum, pojawienie się i zanik pokrywy – każda zima
jako kropka, żeby było widać też słabe zimy), sprawdzenie promieniowania na
pomiarach z Bielska-Białej i Kasprowego Wierchu, grubość śniegu dzień po dniu w 8 punktach
kontrolnych (zima 2026/27 na tle 30 zim), mapy grubości 1 XII – 1 IV, mapa liczby dni z pokrywą
≥ 30 cm (średnio z 30 zim), rozkład śniegu z wysokością obok pomiarów Łajczaka (Pilsko 1993/94),
bilans wody i czas obliczeń. Lokalnie: `npm run winter-report` → `reports/raport-zimy.html`
(ok. 8–10 minut; szybki podgląd na 4 zimach: `npm run winter-report -- reports/raport-zimy.html 4`).

### Jednorazowa konfiguracja publikacji (zrobione przy etapie 0)

W repozytorium na GitHubie: **Settings → Pages → Build and deployment → Source:
„GitHub Actions”**.

## Czy wszystko działa? – testy

Testy uruchamiają się same przy każdej zmianie. Wynik widać na GitHubie:
zakładka **Actions** w repozytorium → „Testy i publikacja”.
Zielony znaczek ✓ = testy przeszły i gra została opublikowana; czerwony ✗ = coś jest nie tak
i gra nie została opublikowana.

Co sprawdzają testy (katalog `tests/`):

- **Słońce:** położenie nad Halą Miziową zgodne z wzorcem NREL SPA (wysokość w południe
  21 grudnia 17,1°, 21 marca 40,8°; wschody i zachody ±2 min; czas zimowy i letni),
- **cienie:** ściana od południa rzuca cień za sobą, teren płaski nie ma cieni, horyzont na stoku
  i przy górze poza mapą wyliczony zgodnie z geometrią,
- **promieniowanie:** w grudniu stok północny 30 % dostaje kilka razy mniej energii niż południowy
  (5×), w czerwcu różnica mała; sumy dobowe w realnym zakresie; chmury je osłabiają,
- **wyciągi i trasy:** stoki 8 / 20 / 35 / 50 % dają trasy zielone / niebieskie / czerwone / czarne;
  krótki stromy fragment (< 50 m) nie zmienia koloru; trawers – ostrzeżenie o spadku poprzecznym;
  orczyk na stoku 60 % odrzucony z komunikatem („za stromo… 60 % na … m od dolnej stacji,
  dopuszczalne 45 %”); podpory zawsze dają minimalny prześwit (losowe garby i doliny); czas
  przejazdu = długość / prędkość; nie da się budować przez granicę ani przez inny wyciąg; sieć
  wykrywa trasy bez połączenia i wyciągi bez zjazdu; wycinka zmienia pokrycie i śnieg na przecince;
  zapis, cofnij/ponów; prawdziwe trasy Pilska – nasza klasyfikacja zgodna w większości,
- **śnieg:** bilans wody się zgadza (opad = śnieg w pokrywie + odpływ + parowanie + wywiane);
  przy +5 °C śniegu ubywa, przy −10 °C i opadzie przybywa; grubość nigdy ujemna; stok północny
  trzyma śnieg dłużej niż południowy; deszcz, a potem mróz → śnieg zlodzony; gęstość rośnie
  z czasem; ten sam seed = ten sam śnieg; wiatr przenosi śnieg z grzbietu na stronę zawietrzną;
  las zatrzymuje część opadu; czas liczenia dnia na całej mapie,
- **pogoda:** ten sam seed = ta sama zima; 30 zim zgodnych z danymi IMGW (temperatura, opad,
  dni z opadem w tolerancji); śnieg na górze i deszcz na dole, gdy izoterma 0 °C leży pomiędzy;
  minimum temperatury nad ranem, maksimum po południu; błąd prognozy rośnie z każdym dniem,

- **nachylenie i ekspozycja:** płaszczyzna 30 % opadająca na południe daje 30 % (16,7°)
  i ekspozycję 180°, opadająca na wschód – 90°; tak samo w każdym z 8 kierunków, także na brzegu
  mapy i przy granicy obszaru „poza mapą”; teren płaski – nachylenie 0,
- **cieniowanie:** stok zwrócony na NW jaśniejszy od płaskiego, na SE ciemniejszy,
- **warstwice:** teren płaski – brak warstwic; płaszczyzna – proste warstwice w dokładnie
  wyliczonych miejscach; pojedynczy pagórek – zamknięte warstwice tylko wokół pagórka,
- **profil:** po płaszczyźnie stałe nachylenie i poprawna różnica wysokości, w poprzek stoku 0,
  po skosie nachylenie × cos kąta,
- **mapa Pilska:** wysokości 600–1560 m n.p.m., najwyżej przy granicy, najniżej ku Korbielowowi,
  teren wznosi się z północy na południe, Słowacja „poza mapą”, brak dziur po stronie polskiej,
  Hala Miziowa jako wypłaszczenie, zgodność z Geoportalem w punktach kontrolnych (±3 m),
- **współrzędne:** PUWG 1992 ↔ stopnie zgodne z biblioteką PROJ (±1 cm),
- z etapu 0: generator losowy, generator proceduralny terenu, kamera, zoom, podziałka,
- pliki danych: każda liczba ma jednostkę i źródło,
- architektura: część symulacyjna (`src/sim`) nie korzysta z grafiki ani z przeglądarki.

## Ustawienia i dane

Wszystkie liczby są w plikach `data/*.json` – każda z jednostką i źródłem:

- `data/settings.json` – seed (ziarno losowania), wybrana mapa (`pilsko` albo `procedural` –
  tymczasowa góra z etapu 0), ustawienia widoku,
- `data/maps/pilsko/map.json` – granice mapy w PUWG 1992, rozmiar komórki, źródła danych, data
  pobrania, granica państwa, punkty kontrolne; `elevation.f32` – siatka wysokości 400 × 450,
- `data/map-style.json` – wygląd mapy (kierunek światła, odstęp warstwic, krycie nakładek…),
- `data/slope-classes.json` – progi nachylenia w kolorach tras,
- `data/climate/pilsko.json` – profil klimatyczny z danych IMGW (wynik `npm run import-climate`),
  `data/climate/pilsko-sources.json` – okres referencyjny i wybór stacji,
- `data/weather-generator.json` – parametry generatora pogody i prognozy, tolerancje raportu,
- `data/radiation.json` – parametry horyzontu i promieniowania słonecznego,
- `data/snow.json` – parametry modelu śniegu (opad, gęstnienie, albedo, bilans energii, las,
  przewiewanie, stany śniegu); skalibrowane wartości oznaczone „SKALIBROWANE (było …)”,
- `data/winter-report.json` – progi werdyktu raportu zimy, punkty kontrolne, daty map,
- `data/lifts.json` – typy wyciągów (taśma, talerzyk, orczyk, kanapy 2/4 stałe, 4/6 wyprzęgane,
  gondola): przepustowość, prędkość, maks. długość, nachylenie i przechył toru, prześwit, przęsła,
  wiatr, moc, koszt, czas budowy; zwis liny,
- `data/pistes.json` – klasy trudności tras (progi nachylenia), odcinek 50 m, ostrzeżenia, koszty,
  połączenia w sieci, porównanie z OSM; `data/construction.json` – koszt i czas wycinki,
- `data/maps/pilsko/osm-resort.json` – prawdziwe wyciągi i trasy z OpenStreetMap
  (`npm run import-osm-resort`),
- `data/calibration/` – pomiary do kalibracji: grubość śniegu i pogoda ze stacji IMGW
  (`npm run snow-calibration-data`), promieniowanie (`npm run radiation-validation-data`),
  wartości z pracy Łajczaka (1996),
- `data/maps/pilsko/landcover.u8` – las, kosodrzewina i zabudowa w każdej komórce
  (ESA WorldCover 2021, `npm run import-landcover`),
- `data/terrain-generator.json` – generator proceduralny z etapu 0 (zapas do testów).

### Ponowne pobranie terenu z Geoportalu

```bash
npm run import-nmt
```

Pobiera NMT (siatka 1 m) dla granic zapisanych w `data/maps/pilsko/map.json`, uśrednia do 10 m,
wycina stronę słowacką i nadpisuje `elevation.f32` oraz opis mapy. Pierwsze pobranie trwa
ok. 15 minut. Pobrane kafle (ok. 70 MB) zostają w katalogu `.cache/`, poza repozytorium.

## Uruchomienie na własnym komputerze (dla chętnych)

Wymaga Node.js w wersji 22 LTS lub nowszej. W katalogu projektu, w Terminalu:

```bash
npm install
```

```bash
npm run dev
```

Potem otworzyć w przeglądarce adres wypisany w Terminalu (zwykle http://localhost:5173/).

| Polecenie | Co robi |
|---|---|
| `npm test` | uruchamia wszystkie testy |
| `npm run build` | sprawdza poprawność kodu i buduje wersję do opublikowania (katalog `dist/`) |
| `npm run preview` | pokazuje zbudowaną wersję tak, jak będzie wyglądać na GitHub Pages |
| `npm run import-nmt` | pobiera teren z Geoportalu i zapisuje mapę gry |
| `npm run import-horizon-dem` | pobiera model terenu okolicy (Copernicus, 15 × 15 km) do liczenia cieni |
| `npm run import-climate` | pobiera dane IMGW i liczy profil klimatyczny |
| `npm run climate-report` | raport klimatu (`reports/raport-klimatu.html`) |
| `npm run winter-report` | raport „przewiń zimę” – śnieg (`reports/raport-zimy.html`) |
| `npm run import-osm-resort` | pobiera z OpenStreetMap prawdziwe wyciągi i trasy w obszarze mapy |
| `npm run piste-check` | zestawienie: nasza klasyfikacja prawdziwych tras Pilska a ich oficjalne kolory |
| `npm run import-landcover` | pobiera mapę pokrycia terenu (las) ESA WorldCover |
| `npm run snow-calibration-data` | pobiera z IMGW pomiary grubości śniegu i pogodę stacji do kalibracji |
| `npm run radiation-validation-data` | pobiera z IMGW pomiary promieniowania do sprawdzenia modelu |

## Budowa projektu

```
src/sim/       symulacja (bez grafiki): siatka terenu, nachylenie, ekspozycja, warstwice, profil,
               współrzędne PUWG 1992, Słońce, horyzont, promieniowanie, klimat, generator pogody,
               model śniegu, kalibracja
src/render/    widok (PixiJS): mapa bazowa, nakładki, legenda, profil, kamera, pasek stanu
src/worker/    wątek w tle (Web Worker), w którym liczy się teren
src/tools/     narzędzia poza grą: konwerter NMT, model terenu okolicy, las, dane IMGW, raporty
data/          pliki z parametrami i mapy
tests/         testy automatyczne
```
