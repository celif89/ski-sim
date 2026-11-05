# Symulator ośrodka narciarskiego – Pilsko

Realistyczny symulator budowy i prowadzenia ośrodka narciarskiego na północnych stokach Pilska.
Zasady projektu i plan etapów: plik [CLAUDE.md](CLAUDE.md).

**Stan: etap 0 – szkielet.** Na razie widać tymczasową, wygenerowaną górę (700–1500 m n.p.m.)
w skali szarości. Prawdziwy teren z Geoportalu przyjdzie w etapie 1.

---

## Jak zagrać (najprościej – w przeglądarce)

Gra jest publikowana automatycznie pod adresem:

**https://celif89.github.io/ski-sim/**

Nic nie trzeba instalować. Nowa wersja pojawia się tam kilka minut po każdej zmianie na gałęzi
`main` – ale **tylko wtedy, gdy wszystkie testy przeszły**. Jeśli testy nie przejdą, na stronie
zostaje poprzednia, sprawna wersja.

### Co widać i jak się poruszać

| Czynność | Jak |
|---|---|
| Przesuwanie mapy | przeciągnij myszą albo strzałki / klawisze W A S D |
| Przybliżanie i oddalanie | kółko myszy (przybliża w miejscu kursora), na gładziku Maca: gest szczypania; klawisze `+` / `−` |
| Cała mapa na ekranie | klawisz `0` lub `Home` |

- **Kolory:** nisko = ciemno, wysoko = jasno.
- **Pasek na dole:** współrzędne kursora w metrach (x – na wschód od lewej krawędzi mapy,
  y – na południe od górnej krawędzi) i wysokość terenu pod kursorem w m n.p.m.
  Po prawej: bieżąca skala w metrach na piksel.
- **Podziałka** w lewym dolnym rogu – długość odcinka zmienia się przy przybliżaniu.
- Zoom działa od widoku całej mapy (ok. 4 × 4 km) do ok. 2 m na piksel.

### Jednorazowa konfiguracja publikacji (robi się raz)

W repozytorium na GitHubie: **Settings → Pages → Build and deployment → Source:
„GitHub Actions”**. Bez tego automat zbuduje grę, ale nie będzie miał gdzie jej opublikować.

## Czy wszystko działa? – testy

Testy uruchamiają się same przy każdej zmianie. Wynik widać na GitHubie:
zakładka **Actions** w repozytorium → „Testy i publikacja”.
Zielony znaczek ✓ = testy przeszły i gra została opublikowana; czerwony ✗ = coś jest nie tak
i gra nie została opublikowana.

Co sprawdzają testy (katalog `tests/`):

- generator losowy: ten sam seed (ziarno) daje zawsze to samo, inny seed – co innego,
- teren: ten sam seed = identyczny teren, inny seed = inny teren; wysokości w zakresie
  700–1500 m n.p.m.; szczyt tam, gdzie powinien; stoki łagodne (bez urwisk),
- przeliczanie pikseli ekranu na metry przy różnych powiększeniach, zoom w miejscu kursora,
  granice zoomu i przesuwania, podziałka,
- pliki danych: każda liczba ma jednostkę i źródło,
- architektura: część symulacyjna (`src/sim`) nie korzysta z grafiki ani z przeglądarki.

## Ustawienia

Wszystkie liczby są w plikach `data/*.json` – każda z jednostką i źródłem:

- `data/settings.json` – seed (ziarno losowania), rozmiar mapy w komórkach, rozmiar komórki
  w metrach, ustawienia widoku (np. największe przybliżenie 2 m/px),
- `data/terrain-generator.json` – parametry tymczasowej góry (wysokości, doliny, nierówności).

Zmiana seeda w `data/settings.json` daje inną górę.

## Uruchomienie na własnym komputerze (dla chętnych)

Wymaga Node.js w wersji 22 LTS lub nowszej. W katalogu projektu, w Terminalu:

```bash
npm install
```

```bash
npm run dev
```

Potem otworzyć w przeglądarce adres wypisany w Terminalu (zwykle http://localhost:5173/).

Pozostałe polecenia:

| Polecenie | Co robi |
|---|---|
| `npm test` | uruchamia wszystkie testy |
| `npm run build` | sprawdza poprawność kodu i buduje wersję do opublikowania (katalog `dist/`) |
| `npm run preview` | pokazuje zbudowaną wersję tak, jak będzie wyglądać na GitHub Pages |

## Budowa projektu

```
src/sim/       symulacja świata (bez grafiki): generator losowy, siatka terenu, generator góry
src/render/    widok (PixiJS): mapa, kamera, obsługa myszy i klawiatury, pasek stanu, podziałka
src/worker/    wątek w tle (Web Worker), w którym liczy się symulacja
src/tools/     narzędzia poza grą (od etapu 1: konwerter NMT)
data/          pliki z parametrami
tests/         testy automatyczne
```
