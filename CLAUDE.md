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

## Ustalenia rozgrywki

- Jeden dzień sezonu przy ×1 to ok. 10 minut realnych; dostępne ×5 i ×20, noc przewija się sama.
- Jeden ośrodek naraz; nowa lokalizacja = nowa rozgrywka.
- Pozwolenia środowiskowe pomijamy. Wycinka kosztuje i trwa.
- Sezon letni – później.
- Grafika 2D z góry, cieniowanie rzeźby jak na mapach topograficznych.
