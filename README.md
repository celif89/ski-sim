# Symulator ośrodka narciarskiego – Pilsko

Realistyczny symulator budowy i prowadzenia ośrodka narciarskiego na północnych stokach Pilska.
Zasady projektu i plan etapów: plik [CLAUDE.md](CLAUDE.md).

**Stan: etap 1 – prawdziwy teren Pilska i czytelna mapa.** Mapa to Numeryczny Model Terenu
z Geoportalu (GUGiK) przeliczony na siatkę 10 m: od granicy ze Słowacją pod Pilskiem
do dna doliny w Korbielowie.

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
| Nakładka nachylenia | przycisk „Nachylenie” lub klawisz `1` |
| Nakładka ekspozycji | przycisk „Ekspozycja” lub klawisz `2` |
| Sama mapa | przycisk „Bez nakładki” lub klawisz `3` |
| Profil terenu | przycisk „Profil terenu” lub klawisz `P`, potem kliknij punkt A i punkt B; `Esc` zamyka |

### Co widać

- **Mapa bazowa:** cieniowanie rzeźby (światło z północnego zachodu, jak na mapach
  topograficznych), barwy wysokości (zielonkawo w dolinach, jasny beż na grzbietach),
  warstwice co 10 m, pogrubione co 50 m z opisem wysokości, czerwona przerywana granica państwa.
  Teren po stronie słowackiej jest zakreskowany – to „poza mapą” (bez danych, nie do zabudowy).
- **Nakładka nachylenia** w kolorach tras: zielony do 10 %, niebieski do 25 %, czerwony do 40 %,
  czarny powyżej (progi w pliku `data/slope-classes.json`).
- **Nakładka ekspozycji:** stoki opadające na południe w ciepłych barwach, na północ w zimnych.
- **Legenda** aktywnej nakładki w prawym górnym rogu.
- **Pasek na dole:** współrzędne kursora w układzie PUWG 1992 (X – północ, Y – wschód, jak
  w geodezji) i w stopniach, wysokość terenu, nachylenie (% i °), ekspozycja, skala.
- **Profil terenu:** wykres przekroju A–B, odcinki pokolorowane jak nakładka nachyleń;
  odległość pozioma, różnica wysokości, maksymalne i średnie nachylenie. Po najechaniu na wykres
  żółty punkt pokazuje to miejsce na mapie.

### Punkty kontrolne do porównania z Geoportalem

| Punkt | PUWG 1992 X (N) | PUWG 1992 Y (E) | Stopnie | Wysokość z Geoportalu |
|---|---|---|---|---|
| Hala Miziowa – wypłaszczenie przy schronisku | 185 950 | 522 980 | 49,54055° N, 19,31773° E | 1275,1 m |
| Stok powyżej Hali Miziowej, przy granicy | 185 150 | 523 300 | 49,53334° N, 19,32211° E | 1461,5 m |
| Dolina potoku w Korbielowie | 189 200 | 524 900 | 49,56971° N, 19,34448° E | 657,4 m |

Wysokości z Geoportalu są w układzie PL-EVRF2007-NH, tym samym, którego używa mapa gry.
Gra pokazuje średnią wysokość komórki 10 × 10 m, więc na stromym stoku może się różnić od
wartości w punkcie o 1–2 m.

### Jednorazowa konfiguracja publikacji (zrobione przy etapie 0)

W repozytorium na GitHubie: **Settings → Pages → Build and deployment → Source:
„GitHub Actions”**.

## Czy wszystko działa? – testy

Testy uruchamiają się same przy każdej zmianie. Wynik widać na GitHubie:
zakładka **Actions** w repozytorium → „Testy i publikacja”.
Zielony znaczek ✓ = testy przeszły i gra została opublikowana; czerwony ✗ = coś jest nie tak
i gra nie została opublikowana.

Co sprawdzają testy (katalog `tests/`):

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

## Budowa projektu

```
src/sim/       symulacja (bez grafiki): siatka terenu, nachylenie, ekspozycja, warstwice, profil,
               współrzędne PUWG 1992, generator losowy, generator proceduralny
src/render/    widok (PixiJS): mapa bazowa, nakładki, legenda, profil, kamera, pasek stanu
src/worker/    wątek w tle (Web Worker), w którym liczy się teren
src/tools/     narzędzia poza grą: konwerter NMT z Geoportalu
data/          pliki z parametrami i mapy
tests/         testy automatyczne
```
