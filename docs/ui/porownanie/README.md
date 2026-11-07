# Etap 7c – porównanie z makietami i lista funkcji

Zrzuty nowego interfejsu (1920 × 1080, przeglądarka w chmurze z grafiką programową) w tych samych
sytuacjach co makiety w `docs/ui/`:

| Makieta | Gra | Co widać |
|---|---|---|
| `../ui-1-mapa.png` | `ui-1-mapa.png` | górny pasek, widok „Kolejki” z legendą, karta parkingu (pełny, wykres godzinowy z prognozą), paleta „Wyciągi”, minimapa |
| `../ui-2-karty.png` | `ui-2-karty.png` | karta gościa (potrzeby, „co myśli”, wydatki, śledzenie kamerą) i karta gastronomii (pełne obłożenie, sugestia) |
| `../ui-3-raport.png` | `ui-3-raport.png` | raport dnia z doradcą; także `raport-tydzien.png`, `raport-sezon.png` |
| – | `edycja-trasy.png` | trasa narysowana ręką: punkty kontrolne (kółka), szerokość, suwak „Gładkość” w karcie |
| – | `ekran-1366.png` | ekran 1366 × 768 – skala interfejsu automatycznie ok. 75 % |

Różnice wobec makiet: obiekty i liczby pochodzą z gry (prawdziwy Pilsko z OSM, piaskownica), więc
nazwy i wartości są inne; na makiecie parking i paleta budowy są widoczne jednocześnie – w grze karta
obiektu zamyka się, gdy wybierasz narzędzie budowy (zrzut zrobiony z paletą otwartą bez narzędzia).

## Lista funkcji – nic nie zginęło

| Funkcja (dotychczas) | Gdzie teraz |
|---|---|
| Godzina, data, kalendarz, suwak godziny, „odtwórz dzień”, „przewiń sezon” | górny pasek – kliknięcie zegara |
| Prędkość: pauza, ×1, ×5, ×20 | górny pasek (spacja – pauza / ×1) |
| Czas rzeczywisty 1:1 | kliknięcie zegara → „Czas rzeczywisty 1:1” |
| Pogoda teraz, prognoza 7 dni, linki do raportów klimatu i zimy | górny pasek – kliknięcie pogody; prognoza 4 dni w pasku (odwilż na żółto) |
| Śnieg przy stacjach, wiatr | górny pasek („Baza śniegu”, „Wiatr”) |
| Nakładki 1–9, G, K, M | lewy pasek widoków danych (te same klawisze); legenda obok, warianty jako zakładki |
| Mapa topograficzna, sieć tras (N), prawdziwy ośrodek (R) | lewy pasek → „Teren i mapa” (legenda z przełącznikami) |
| Profil terenu (P), dymek przy kursorze (I) | lewy pasek pod kreską |
| Legenda mapy | lewy pasek → „Teren i mapa” |
| Budowa: wyciąg (typy), trasa pędzlem i po osi, szerokość, wyrównanie, nartostrada | dolne menu „Wyciągi”, „Trasy” (ręką / punktami – klawisz O, szerokość, wyrównanie) |
| Droga dojazdowa | „Drogi” |
| Rurociąg, rura zasilająca, armatka i lanca, ujęcie, studnie, wodociąg, rowy, zbiorniki, pompownie, przyłącza, garaż, kotwa | „Naśnieżanie” |
| Parking, gastronomia, wypożyczalnia, szkółka, transport do schroniska | „Budynki” |
| Trasa rowerowa, ścieżka, tor saneczkowy, plac zabaw, punkt widokowy (z blokadą) | „Lato” (zablokowane – szare z powodem) |
| Wycinka (liczona sama) | „Wycinka” – karta z wyjaśnieniem |
| Usuwanie obiektu | „Rozbiórka” (klik na obiekcie), klawisz Delete, karta → Ustawienia → Rozbierz |
| Cofnij / ponów | paleta budowy, Ctrl+Z / Ctrl+Y |
| Lista obiektów, ostrzeżenia sieci, porównanie z OSM, zapis/wczytanie układu, wyczyść | menu → „Obiekty ośrodka i plik układu” (panel boczny) |
| Profil wyciągu i trasy (podpory, zamknij, zjazd w dół, wyrównanie) | panel profilu na dole po zaznaczeniu |
| Przeciąganie stacji, załamań, punktów osi, szerokości | jak wcześniej; linie: punkty kontrolne + przeciągnięcie odcinka wstawia punkt |
| Karta obiektu (etap 7b): status, liczby, wykres, akcje | prawa strona – Przegląd / Szczegóły / Ustawienia |
| Karta gościa | lewa strona (nowy wygląd + „Więcej o gościu”) |
| Panel „Goście” (liczba gości, od nowa, sezon otwarty, wyciągi, ostrzeżenia, zdarzenia, prawdziwy Pilsko) | górny pasek „Goście dziś” albo menu → panel boczny |
| Raport dnia gości (zatłoczone trasy, wypadki, oceny co godzinę) | raport → „Szczegóły dnia gości” |
| Finanse, kredyt, sezon letni i ceny lata, zapis / wczytanie / nowa gra | górny pasek „Saldo” albo menu → panel boczny; menu: Zapisz / Wczytaj / Nowa gra |
| Cennik i godziny | górny pasek „Karnet dzienny”, menu |
| Raport sezonu (szczegółowy, poprzednie lata) | raport → Sezon → „Szczegóły roku i poprzednie sezony” |
| Naśnieżanie i ratraki, plan naśnieżania, plan nocy, flota, wodociąg | górny pasek „Baza śniegu” albo menu → panel boczny |
| Ekran startowy (kariera, piaskownica, kontynuacja, plik) | menu → Nowa gra |
| Obrót mapy, zoom | minimapa (N↓, +/−), kółko myszy |
| Podziałka, pasek stanu pod kursorem | lewy dolny róg |
| Menu deweloperskie | klawisz `, menu → Menu deweloperskie |
| Komunikaty (toast) | nad dolnym menu |
| **Nowe:** powiadomienia z historią, raport tydzień / sezon, doradca, minimapa, skala interfejsu, lista skrótów | lewa strona, menu |
