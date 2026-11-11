# Symulator ośrodka narciarskiego – Pilsko

Realistyczny symulator budowy i prowadzenia ośrodka narciarskiego na północnych stokach Pilska.
Zasady projektu i plan etapów: plik [CLAUDE.md](CLAUDE.md).

**Stan: etap 7b – sezon letni i karty obiektów.** Latem koleje krzesełkowe i gondole wożą pieszych
w górę i w dół (rowery na wieszakach), są szlaki PTTK z OpenStreetMap, bike park, ścieżki, tor saneczkowy
całoroczny, plac zabaw i punkt widokowy; burze (dane IMGW) zatrzymują kolej i tor. Kliknięcie obiektu
otwiera jego kartę z liczbami na żywo i wykresem dnia. Kariera od pustej góry z ograniczonym
kapitałem (budowa kosztuje i trwa, kredyt, bankructwo) albo piaskownica bez limitu pieniędzy. Goście
przyjeżdżają według popytu (dzień tygodnia, ferie, święta, śnieg, prognoza, reputacja, ceny, konkurencja,
parking), płacą za karnety, ośrodek ponosi koszty (energia, obsługa, ratownicy, przeglądy, ubezpieczenie,
naśnieżanie, ratraki). System naśnieżania: ujęcie wody, zbiornik, pompownia, przyłącze energetyczne,
rurociąg z hydrantami, armatki śmigłowe i lance; flota ratraków z planem nocy. Mapa to NMT z Geoportalu
(GUGiK) w siatce 10 m, pogoda – generator oparty na danych IMGW 2001–2025, śnieg – model fizyczny
(naturalny i techniczny).

**Raport lata** (ośrodek wielkości Pilska w przeciętnym roku – bez lata i z latem; wynik zimy, lata
i koszty wspólne osobno; atrakcje, goście latem, burze):
https://celif89.github.io/ski-sim/raport-lata.html

**Raport ekonomii** (10 sezonów prostego ośrodka: orczyk i dwie trasy, tryb kariery; ten sam ośrodek
z naśnieżaniem na 30 zimach i tabela kalibracji naśnieżania):
https://celif89.github.io/ski-sim/raport-ekonomii.html

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

### Gra: kariera i piaskownica (etap 6)

Po otwarciu strony pojawia się okno wyboru:

- **Nowa kariera** – pusta góra, 15 mln zł na koncie, start 1 maja 2026 (lato – czas budowy).
  Każdy obiekt kosztuje i buduje się przez określoną liczbę dni (orczyk ok. 3 miesiące, trasa
  2–4 tygodnie, parking miesiąc); zimą budowa idzie 4× wolniej i jest o 25 % droższa. Na mapie widać
  **plac budowy** (pomarańczowa przerywana linia i procent postępu). Gdy brakuje pieniędzy, budowa jest
  odrzucana z komunikatem – można wziąć kredyt. Saldo poniżej −1 mln zł albo ujemne dłużej niż 90 dni =
  **bankructwo** (koniec kariery).
- **Piaskownica** – bez limitu pieniędzy, wszystko gotowe od razu; zostaje Twój dotychczasowy układ
  (np. „Wczytaj prawdziwy ośrodek Pilsko” w panelu „Goście”). Liczbę gości dnia możesz wpisać ręcznie.
- **Kontynuuj** – gra zapisuje się sama co dzień w przeglądarce; **Wczytaj grę z pliku** – plik z
  przycisku „Zapisz grę”. Adres `…/ski-sim/?tryb=kariera` lub `?tryb=piaskownica` od razu zaczyna grę.

Rok gry: **lato (V–IX)** – budowa, zegar idzie tygodniami (doba 7× szybciej); **jesień (X–XI)** –
przeglądy wyciągów (1 X); **zima** – codzienna eksploatacja; **wiosna (IV)** – koniec sezonu, 1 maja
sam otwiera się **raport sezonu**. O otwarciu i zamknięciu sezonu decydujesz Ty: pole **„Sezon otwarty”**
w panelu „Goście” (można od listopada do kwietnia).

Panel **„Finanse”** (po prawej): saldo, reputacja (gwiazdki z ocen gości, świeże ważą więcej), wczoraj
(goście, przychody, koszty), rok gry, budowa, kredyt; karnet dzienny wobec średniej konkurencji; opis
dzisiejszego popytu; wydarzenia (gotowe budowy, przeglądy, raty). Przyciski:
- **Cennik i godziny** – karnety dzienny, 4 h, 2 h, punktowy (cena punktu), godziny pracy wyciągów;
  zmiany od następnego dnia;
- **Raport sezonu** – wynik, przepływy (przychody, koszty, budowa, kredyt), dni otwarte, goście dzień po
  dniu, ocena, porównanie z 4 ośrodkami konkurencji;
- **Kredyt inwestycyjny** – kwota i liczba lat (rata co miesiąc, 7,5 % rocznie), „Spłać”;
- **Zapisz grę / Wczytaj grę / Nowa gra**.

Narzędzie **„Budynek” (B)**: typ w panelu budowy – parking (300 aut, tu przyjeżdżają goście; opłata
parkingowa), gastronomia, wypożyczalnia, szkółka (przychód od części gości), albo baza bez parkingu.
Bez parkingu goście mieszczą się tylko na poboczach (ok. 40 aut).

Przewijanie: kalendarz albo „Przewiń sezon” – dni pominięte liczą się **modelem zgrubnym** (popyt,
przejazdy ograniczone przepustowością, kolejki, ocena – skalibrowany na pełnej symulacji gości); dni
oglądane zegarem (×1, ×5, ×20) – **pełną symulacją gości**. W karierze nie można cofać czasu.

### Działki i kamienie milowe (etap 7g)

**Działki.** Mapa jest podzielona na kwadraty ok. 1 × 1 km (nazwy jak w szachach: litera – kolumna, numer –
wiersz). W karierze zaczynasz od jednej działki **przy drodze publicznej**: po „Nowa kariera” działki do
wyboru są pomarańczowe – kliknij, żeby zobaczyć wysokości, przewyższenie, nachylenia, las, potoki i cenę,
potem „Zacznij tutaj”. Budować można tylko na swoich działkach – wyciąg, trasa, droga, rurociąg, rów
i budynek (także ujęcie wody) muszą leżeć w całości na nich; przy rysowaniu brakujące działki świecą na
czerwono, a okienko przy kursorze mówi, które dokupić. Kolejne działki: lewy pasek → „Działki”, klik
w działkę → „Kup” albo „Dzierżaw”. Las (Lasy Państwowe) – tylko dzierżawa. Czynsz płaci się przy podpisaniu
umowy i co roku 1 maja. Ile działek wolno mieć – zależy od kamienia milowego. W piaskownicy wszystkie
działki są Twoje.

**Kamienie milowe** (górny pasek: bieżący kamień i postęp; klik – lista): Górka za wsią (start) → Lokalny
stok (5 tys. wizyt, reputacja 3,3, 1 sezon) → Ośrodek regionalny (20 tys., 3,8, 2) → Ośrodek górski (60 tys.,
4,1, 3) → Kurort (150 tys., 4,4, 5). Każdy odblokowuje typy wyciągów, armatek i budynków, atrakcje letnie,
oświetlenie tras, kolejne działki i wyższy limit kredytu (`data/milestones.json`). Zablokowane karty
w dolnym menu są szare z powodem („wymaga: …”). Starsze zapisy kariery dostają działki pod tym, co już
zbudowano, i kamień milowy z dotychczasowych wyników.

**Oświetlenie tras:** karta trasy → „Oświetl trasę” (od „Lokalnego stoku”) – potem w „Cenniku i godzinach”
można zamykać wyciągi nawet o 21:00; po zmroku płacisz za prąd.

### Naśnieżanie i ratraki (etap 7)

**Najprościej (etap 7f): „Naśnież trasę”** – dolne menu „Naśnieżanie” → pierwsza karta, kliknij trasę
(kolejne kliknięcia dodają lub zdejmują trasy). Gra proponuje rurociąg wzdłuż krawędzi trasy (3 m za
krawędzią), dojście od najbliższej pompowni najkrótszą drogą po terenie (las i strome zbocza liczą się
jako „dłuższa droga”), hydranty co 60 m i armatki przy każdym: śmigłowe na szerokich (≥ 30 m)
i łagodnych (≤ 35 %) odcinkach, lance na wąskich, stromych i przy lesie (reguły w `data/snowmaking.json`,
sekcja `autoPlan`). W okienku: koszt (rury, hydranty, armatki), wydajność przy −6 °C temperatury
mokrej, potrzebna woda (ostrzeżenie, gdy pompownia nie nadąży), czas pierwszego zaśnieżenia (40 cm
ubitego śniegu na całej trasie) i czas budowy. „Zbuduj” albo „Anuluj”.

**Samouczek naśnieżania** – proponowany przy pierwszym otwarciu kategorii „Naśnieżanie” (i w menu ☰,
i w panelu naśnieżania): 7 kroków – źródło wody, zbiornik, pompownia, przyłącze prądu, „Naśnież trasę”,
plan naśnieżania, ratrak. Każdy krok mówi, dlaczego jest potrzebny, „Pokaż gdzie” podświetla kartę
albo przycisk, a gdy krok jest zrobiony – samouczek sam przechodzi dalej. Ta sama lista
**„Czego brakuje do naśnieżania”** jest w panelu „Naśnieżanie i ratraki”, dopóki czegoś brakuje.

**Ratraki bez garażu i używane (etap 7f).** Garaż nie jest konieczny. Ratrak „pod chmurką” dłużej się
rozgrzewa (25 min), w mroźną noc (≤ −8 °C) psuje się 2,5× częściej, serwis jest o 35 % droższy, a maszyna
starzeje się 1,5× szybciej (wartości „do kalibracji”). W panelu przy każdym ratraku: „w garażu” albo
„stoi pod chmurką”. Co sezon są 3 oferty **używanych** ratraków (wiek 4–14 lat, ok. 1/3 ceny nowego, stan
różny – gorszy stan to częstsze awarie).

Ręcznie, krok po kroku:

Jak zbudować system naśnieżania (najlepiej latem – wykopy pod rurociąg i zbiornik tylko od maja do
października):

1. **Źródło wody** (narzędzie „Budynki”, `B`, typ w panelu budowy):
   - **ujęcie z potoku** – tylko na cieku (niebieskie linie na mapie; potoki z OpenStreetMap uzupełnione
     z modelu terenu). Przy stawianiu gra podaje średni przepływ i ile wolno pobrać w listopadzie, styczniu
     i kwietniu. Pobór tylko ponad przepływ nienaruszalny; kilka ujęć na jednym potoku ma wspólny limit.
     Przepływ zmienia się z porą roku (najwięcej przy roztopach III–V, najmniej w sierpniu i styczniu)
     i spada po suchym miesiącu;
   - **przyłącze wodociągowe** – tylko przy zabudowie wsi, do 10 m³/h, 8,07 zł/m³ (taryfa MPWiK Żywiec);
     zakup włączasz i wyłączasz w panelu „Naśnieżanie i ratraki”;
   - **studnia głębinowa** 100 lub 200 m – wydajność poznasz dopiero po wierceniu (we fliszu zwykle
     1–10 m³/h, bywa prawie sucha); pompa zużywa energię;
   - **rów zbierający** (etap 7f) – linia rysowana od góry stoku w dół do zbiornika (koniec najwyżej
     40 m od niego, spadek co najmniej 0,5 %; rów pod górę jest odrzucany); zbiera deszcz i roztopy
     z obszaru powyżej siebie – zlewnię widać jako niebieskie pole przy rysowaniu i po kliknięciu rowu,
     z szacowanym dopływem w roku przeciętnym. Starsze zapisy: dawny „budynek” rowów zamienia się sam
     na rów wzdłuż dna doliny powyżej zbiornika (bez opłaty).
   Źródło łączy się ze zbiornikiem **rurą zasilającą** (klawisz `F`: klikaj od źródła do zbiornika,
   `Enter` – koniec; 250 zł/m, wykop latem) albo stoi przy nim (do 60 m). Pod górę woda jest pompowana.
2. **Zbiornik** (20, 50 lub 100 tys. m³) – napełnia się ze źródeł; w panelu „Źródła wody” widać ilość
   i koszt z każdego źródła dziś i od 1 maja.
3. **Pompownia** (150, 300 lub 600 m³/h) – postaw ją przy dolnej stacji; od niej zaczyna się rurociąg.
4. **Przyłącze energetyczne** (500, 1000 lub 2000 kW) – ogranicza, ile armatek i pomp pracuje naraz
   (razem z wyciągami w godzinach otwarcia).
5. **Rurociąg** – przycisk „Naśnieżanie” na dolnym pasku albo klawisz `H`: klikaj punkty od pompowni
   wzdłuż trasy (pierwszy punkt blisko pompowni albo innego rurociągu), `Enter` lub podwójne kliknięcie
   – koniec. Hydranty (kropki) pojawiają się co 60 m. Koszt za metr + hydranty.
6. **Armatki** – klawisz `J`, typ w panelu budowy (śmigłowa: wydajna, droższa, pracuje od −2,5 °C
   temperatury mokrej, przestawna; lanca: tańsza, oszczędniejsza, od −4 °C), kliknij hydrant. Zaznaczoną
   armatkę śmigłową przestawisz, klikając wolny hydrant (bez kosztu).
7. **Garaż ratraków** (3 miejsca) i ratraki w panelu **„Naśnieżanie i ratraki”**: „Kup” albo „Leasing”
   (rata miesięczna); standardowy albo z wyciągarką. Na stromych trasach (≥ 40 %) ratrak z wyciągarką
   potrzebuje **punktu kotwienia** (budynek „Punkt kotwienia”) na górze stoku – lina sięga 1000 m.

Panel **„Naśnieżanie i ratraki”** (po prawej): stan zbiornika, dopływ i zużycie dziś, moc chwilowa
wobec limitu przyłącza (wykres doby: armatki, pompy, wyciągi; czerwona linia – limit), armatki gotowe
i pracujące, trasy zamknięte przez pryzmy, flota ratraków, przewidywany koniec pracy w nocy.

- **Plan naśnieżania** – dla każdej trasy: naśnieżać tak/nie, docelowa baza (cm śniegu ubitego),
  priorytet 1–3. Automat (od listopada do marca) włącza armatki, gdy jest dość zimno (temperatura
  mokra), a baza jest cieńsza niż docelowa – najpierw priorytet 1, w ramach priorytetu najzimniejsze
  miejsca; ogranicza go woda, pompownia i moc. Na otwartej trasie w godzinach pracy wyciągów automat nie
  naśnieża. Pojedyncze armatki można przełączyć na „włączona” / „wyłączona” (ręcznie).
- Śnieg z armatek ląduje w **pryzmach** – dopóki ratrak go nie rozepchnie, ten odcinek trasy jest
  nierówny, a trasa zamknięta. Wiatr znosi część śniegu poza trasę (do lasu).
- **Plan nocy** – dla każdej trasy: ratrakować tak/nie, kolejność (1 – najpierw), ratrak (automat albo
  konkretny), „w dzień” (ratrakowanie w dzień – trasa zamknięta dla gości do końca dnia). Pod tabelą
  przewidywany przebieg nocy: który ratrak, która trasa, w jakich godzinach, czy zdąży do rana, czy
  strome odcinki zostaną zrobione i jaka będzie trasa (mróz – twarda, odwilż – mokra, mokry śnieg ubity
  przed mrozem – lód).
- Nakładka **„Naśnieżanie teraz”** (klawisz `M`): gdzie temperatura mokra pozwala teraz robić śnieg
  (przy inwersji na dole zimniej niż na górze).
- Na mapie: rurociągi (niebieska linia), hydranty, armatki (okrągłe – śmigłowe, wąskie – lance), chmury
  śniegu pracujących armatek z wiatrem, ratraki ze światłami w nocy i sztruks za nimi; budynki: U – ujęcie,
  Z – zbiornik, Pm – pompownia, E – przyłącze, R – garaż ratraków, K – punkt kotwienia, Wd – wodociąg,
  St – studnia; potoki (niebieskie linie), rury zasilające (turkusowe).
- Raport sezonu: śnieg (m³), woda, energia, paliwo, koszty naśnieżania i ratraków, **dni otwarte dzięki
  naśnieżaniu**.

### Widok 3D (etapy 3D-0 – 3D-2)

- **F3** albo menu ☰ → „Widok 3D” – przełącza na widok 3D; **F3** lub przycisk „Mapa 2D” wraca (mapa 2D
  pokazuje to samo miejsce).
- W 3D widać wszystko, co na mapie: drogi, potoki, parkingi, rurociągi, hydranty, rowy, szlaki, trasy
  letnie; kliknięcie obiektu (także liny, podpory, dachu) albo gościa otwiera tę samą kartę co w 2D;
  nakładki danych (lewy pasek, klawisze 1–9, G, M, K) leżą na terenie 3D, legenda jak w 2D.
- Budowanie w 3D: te same narzędzia i paleta co na mapie; linie biegną po terenie (za wzgórzem
  przerywane), wyciąg widać od razu z podporami i liną na prawdziwej wysokości (za mały prześwit na
  czerwono). **Z** (albo przycisk „Widok z góry”) – kamera pionowo nad miejscem pod kursorem, drugi raz –
  powrót. Klawisze E, Q, F, R sterują w 3D kamerą – drogę, ścieżkę i rurę zasilającą wybieraj z palety.
- Kamera: **W A S D** / strzałki albo przeciąganie lewym przyciskiem – przesuwanie; **Q E** albo prawy /
  środkowy przycisk – obrót; **R F** – pochylenie (od widoku z góry do niemal poziomego); kółko – zbliżenie
  do miejsca pod kursorem; przycisk „Widok z góry”. Kamera nie wchodzi pod teren.
- „Jakość: niska / średnia / wysoka” – cienie, zasięg drzew 3D, przyciemnienie zagłębień, rozdzielczość.
- Menu `Dev` – licznik klatek, czas pracy kodu, liczba wywołań rysowania, trójkątów, drzew i postaci,
  stan automatycznej płynności (przy spadku poniżej 50 kl./s gra sama zmniejsza rozdzielczość i zasięg
  drzew 3D, potem wraca do wybranej jakości).
- Zrzuty i opis: `docs/3d/README.md`.

### Sterowanie

| Czynność | Jak |
|---|---|
| Przesuwanie mapy | przeciągnij myszą albo strzałki / klawisze W A S D |
| Przybliżanie i oddalanie | kółko myszy (przybliża w miejscu kursora), na gładziku Maca: gest szczypania; klawisze `+` / `−` |
| Cała mapa na ekranie | klawisz `0` lub `Home` |
| Obrót mapy o 180° | minimapa w prawym dolnym rogu – przycisk **N↓** (tam też przybliżanie +/−; kliknięcie w minimapę przesuwa widok). Domyślnie widok od Korbielowa: szczyt u góry, północ na dole |
| Upływ czasu gry | górny pasek: pauza, ×1 (dzień sezonu w ok. 10 minut, noc szybciej), ×5, ×20; spacja – pauza / ×1; czas rzeczywisty **1:1** – kliknij zegar |
| Widoki danych (dawne nakładki) | **lewy pionowy pasek** (ikony z podpowiedzią) albo klawisze `1`–`9`, `G`, `K`, `M`; legenda pokazuje się obok, warianty jako zakładki (np. Śnieg: grubość / stan / podłoże) |
| Mapa, mapa topograficzna, sieć tras, prawdziwy ośrodek | lewy pasek → „Teren i mapa” (`3`), w legendzie przełączniki; `N`, `R` |
| Nachylenie / ekspozycja | `1` / `2` |
| Nasłonecznienie teraz / suma doby | `4` / `5` |
| Temperatura / gdzie można teraz naśnieżać (temp. mokra) | `6` / `M` |
| Śnieg: grubość / stan / podłoże | `7` / `8` / `G` |
| Ruch na trasach / kolejki | `9` / `K` |
| Dzień, godzina, przewijanie sezonu | kliknij **zegar** w górnym pasku – kalendarz, suwak godziny, „Odtwórz dzień”, „Przewiń sezon” |
| Pogoda | górny pasek: góra i dół, baza śniegu, wiatr, prognoza 4 dni (dzień z odwilżą na żółto); kliknięcie – szczegóły i prognoza na 7 dni |
| Saldo, goście, cennik, naśnieżanie | kliknięcie pozycji w górnym pasku otwiera panel po prawej (Finanse, Goście, Cennik, Naśnieżanie i ratraki) |
| Menu gry | przycisk ☰ w prawym górnym rogu: raporty, panele, historia powiadomień, zapis / wczytanie / nowa gra, **skala interfejsu**, skróty klawiszowe, menu deweloperskie |
| Powiadomienia | lewa strona pod paskiem: kolejki, pełny parking, odwilż, za mało śniegu, wpisy dziennika gry; kliknięcie – kamera jedzie w to miejsce |
| Raporty | dolne menu „Raporty” albo menu: dzień, tydzień, sezon – z doradcą (jedno zdanie i przycisk akcji) |
| Karta obiektu / gościa | kliknij obiekt lub postać na mapie: zakładki Przegląd / Szczegóły / Ustawienia; karta gościa – „Śledź kamerą” |
| Profil terenu | lewy pasek pod kreską albo `P`, potem kliknij punkt A i punkt B; `Esc` zamyka |
| Dymek przy kursorze | lewy pasek (ikona „i”) albo `I`: wysokość, nachylenie, ekspozycja, śnieg, temperatura, obiekt pod kursorem |
| Menu deweloperskie | „Dev” w lewym dolnym rogu lub klawisz `` ` `` |

### Budowa ośrodka (dolne menu)

Kategorie: **Wyciągi, Trasy, Naśnieżanie, Drogi, Budynki, Lato, Wycinka | Rozbiórka, Raporty**. Kliknięcie
kategorii otwiera nad menu paletę kart (rysunek, nazwa, najważniejszy parametr, cena); zablokowana karta
jest szara z powodem (np. reputacja). Lista obiektów, ostrzeżenia sieci, porównanie z OSM i plik układu –
menu ☰ → „Obiekty ośrodka i plik układu”.

| Czynność | Jak |
|---|---|
| Wyciąg | „Wyciągi” → karta typu (albo `L`); kliknij **dolną**, potem **górną** stację. W trakcie na dole profil terenu z liną, podporami i ostrzeżeniami. |
| Trasa, droga, rurociąg, trasa letnia – **rysowanie ręką** | przeciągnij myszą wzdłuż przebiegu; po puszczeniu linia sama się upraszcza do kilku punktów kontrolnych (co ok. 40 m, gęściej na zakrętach) i prowadzi gładkim łukiem – odbiega od narysowanej najwyżej o kilka metrów |
| … **prosto / łukiem** (etap 7f) | przełącznik „Prosto / Łuk / Ręką” w palecie albo klawisz `O` (po kolei). Prosto: klik = punkt (łamana), podwójny klik lub `Enter` = koniec, `Backspace` – cofnij punkt. Łuk: klik – początek, klik – punkt sterujący (w którą stronę wygiąć), klik – koniec łuku; dalej następny łuk |
| **Przyciąganie i linie pomocnicze** (etap 7f) | końce przyciągają się do obiektów tej samej sieci: rurociąg – do pompowni, hydrantu, armatki i innego rurociągu; droga – do drogi, drogi publicznej i parkingu; trasa – do stacji wyciągu i innej trasy; wyciąg – do końców tras i parkingów (pomarańczowe kółko – punkt, romb – odcinek). Linie pomocnicze (pomarańczowe, przerywane): kąt prosty i co 15° względem sąsiedniego obiektu, przedłużenie istniejącego odcinka, równoległa 5 m od krawędzi trasy (rurociąg, droga). **Shift** – bez przyciągania. Przy kursorze: długość, koszt narastająco, nachylenie odcinka; ostrzeżenia na czerwono (np. „za stromo”, „początek nie łączy się z pompownią”) |
| **Ulepsz, przesuń, poszerz** (etap 7f) | karta obiektu: wyciąg – „Ulepsz” (inny typ na tej samej linii: podpory od nowa, różnica kosztu i opłata za przebudowę, w tym czasie nie działa); armatka – zamiana typu, „Przesuń na inny hydrant” (śmigłowa); trasa – „Poszerz” (+5 m); budynek – „Przesuń” (klik w nowe miejsce, `R` albo prawy przycisk – obrót o 90°) |
| Menu kompaktowe (etap 7f) | menu ☰ → „Menu budowy: kompaktowe / pełne” (ikony 40 px, karty: nazwa + cena, parametr w podpowiedzi; „−” zwija paletę); domyślnie kompaktowe na ekranach węższych niż 1920 px |
| Szerokość trasy, wyrównanie terenu | suwak i pole w palecie „Trasy”; klawisze `[` `]` |
| Nartostrada, droga, rurociąg, rura zasilająca, armatka | `U`, `E`, `H`, `F`, `J` albo karty w paletach |
| Budynek | „Budynki” / „Naśnieżanie” / „Lato” → karta, kliknij miejsce (`B`) |
| Poprawianie linii | `Esc` (wybieranie), kliknij trasę / drogę / rurociąg: **kółka** to punkty kontrolne – przeciągnij; **przeciągnięcie odcinka** wstawia nowy punkt; prawy przycisk albo `Delete` na kółku – usuń punkt; **kwadraciki** po bokach trasy – szerokość; suwak **„Gładkość”** w karcie (0 % – łamana, 100 % – łuk) |
| Edycja wyciągu | zaznacz wyciąg: **prostokąty** – stacja dolna i górna (przeciągnij), **„+”** na linii – nowe załamanie, **romb** – załamanie (podwójne kliknięcie – stacja pośrednia; prawy przycisk – usuń) |
| Otwarcie / zamknięcie | karta obiektu („Zamknij / Otwórz”) albo profil; cały ośrodek – pole „Sezon otwarty” w panelu Goście |
| Podpory wyciągu | na wykresie profilu: przeciągnij podporę; podwójne kliknięcie – nowa; prawy przycisk – usuń; „Rozstaw podpory automatycznie” |
| Rozbiórka | „Rozbiórka” i klik na obiekcie, `Delete` przy zaznaczonym albo karta → Ustawienia → Rozbierz; gotowy obiekt – zwrot 15 % kosztu (`data/economy.json`, `demolishRefundShare`, do kalibracji), w budowie – 70 % (tego samego dnia 100 %) |
| Cofnij / ponów | `Ctrl+Z` / `Ctrl+Y` (na Macu `Cmd`) albo strzałki w palecie |
| Zapis | układ zapisuje się sam w przeglądarce; plik JSON – menu → „Obiekty ośrodka i plik układu” |

**Śnieg a jazda (etap 5b).** Pod kursorem (pasek na dole) i w profilu trasy widać osobno grubość
całkowitą i **bazę ubitą** (zapas wody w śniegu przeliczony na śnieg ubity 420 kg/m³ – 10 cm puchu to
ok. 2,4 cm bazy) oraz ile bazy potrzeba na tym podłożu: łąka wyrównana 15 cm, łąka naturalna 25 cm,
przecinka z pniakami 40 cm, kamienie / skała 70 cm (`data/snow.json`, sekcja `riding`, do kalibracji).
Gdy na otwartej trasie baza jest za cienka, panel „Goście” ostrzega („za mało śniegu: trasa 6,
0–780 m – 6 cm bazy, potrzebne 40 cm”), odcinki są zaznaczone czerwonym pasem na mapie i na
profilu. Na takich odcinkach goście jadą wolniej, częściej mają wypadki i uszkadzają sprzęt, gorzej
oceniają dzień, a jeśli mogą – wybierają inne trasy. O otwarciu decydujesz Ty: zamknięta trasa ma
zero przejazdów; wyciąg bez żadnej otwartej trasy w dół stoi (wyjątek: gondolą można zjechać);
przy zamkniętym ośrodku nie przyjeżdża nikt.

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
  - **detal** (poniżej ok. 1 m/px, do 0,125 m/px): faktura śniegu według stanu – puch, przewiany,
    firn, breja, lód z połyskiem, przetarcia z trawą i kamieniami, a za ratrakiem sztruks.
  - **śnieg z bliska** (etap 7d; pojawia się od 0,5 m/px, w pełni od 0,35 m/px – najlepiej
    przybliżyć do końca, 0,125 m/px): na trasach osobna warstwa co 1 m – sztruks w kierunku
    ostatniego przejazdu ratraka (blednie w ciągu dnia i pod śladami nart), ślady nart, muldy
    z cieniem zależnym od położenia Słońca (rano cienie długie z południowego wschodu, po
    południu z południowego zachodu), pryzmy spod armatek, lód z połyskiem, breja, firn, plamy
    trawy i kamieni tam, gdzie śniegu jest wyraźnie za mało. Od 1,2 m/px zamiast uproszczonych
    znaczków: podpory z rolkami, stacje z kołem zwrotnym i bramkami, krzesełka z siedzącymi,
    orczyki i talerzyki z pasażerami, armatki z chmurą śniegu znoszoną przez wiatr, lina
    wyciągarki ratraka do punktu kotwienia, skuter i ratownik przy wypadku, pył spod nart w puchu.
    Zrzuty: `docs/ui/detal/`. Wygląd postaci i maszyn opisuje jeden plik `data/atlas.json`.
  Pora dnia zmienia światło (poranek chłodny, zmierzch ciepły, noc ciemna z oświetlonymi trasami
  i światłami ratraków); gdy pada, na ekranie widać płatki śniegu lub deszcz.
- **Rzeźba terenu** (etap 7e): światło pada z kilku stron naraz, zawsze głównie z lewej góry ekranu
  (także po obrocie mapy); strome stoki ciemniejsze i chłodniejsze niezależnie od kierunku (progi
  jak klasy tras: 25 % i 40 %), dna dolin przyciemnione; kreski spadku – krótkie kreski w dół stoku,
  gęstsze i grubsze na stromiznach (od ok. 15–20 %, tylko teren otwarty i trasy); warstwice co 50 m
  z daleka i co 10 m z bliska, grubsze co 100 m z opisem (góra napisu pod górę stoku). Kreski
  i warstwice włącza się w widokach danych → „Teren i mapa”. Przy rysowaniu trasy, wyciągu, drogi
  pod kursorem pierścień w kolorze klasy nachylenia, strzałka w dół stoku i liczba w %. Wygląd
  stroi się suwakami w menu `Dev` (lewy dolny róg) → „Rzeźba terenu”; „Kopiuj ustawienia” daje
  wartości do przeniesienia do `data/map-style.json` (sekcja `relief`). Zrzuty: `docs/ui/rzezba/`.
- **Goście** (etap 5) – patrz niżej „Dzień z gośćmi”. Ślady nart, muldy i przetarcia najlepiej
  widać przy przybliżeniu ok. 0,25–0,5 m/px (pasek stanu na dole pokazuje skalę).
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

### Dzień z gośćmi (etap 5)

1. Ośrodek: zbuduj wyciąg i trasę (dolny pasek) albo w panelu **„Goście”** kliknij **„Wczytaj
   prawdziwy ośrodek Pilsko”** (12 wyciągów i trasy z OpenStreetMap, parkingi jako bazy; Ctrl+Z
   cofa).
2. Liczba gości: pole „Gości dziś” w panelu (na razie parametr – popyt i ceny w etapie 6) albo
   adres strony `…/ski-sim/?goscie=2000`.
3. Czas: przycisk ×1 (albo ×5, ×20) w prawym górnym rogu. Goście przyjeżdżają od ok. 8:15,
   wyciągi kursują 8:30–16:00. Wybranie innej godziny lub dnia przelicza dzień do tej chwili
   (pasek postępu w panelu). Ten sam dzień zawsze przebiega tak samo (ten sam seed).

Co widać:
- **postacie**: narciarze i snowboardziści (kolor kurtki losowy, dzieci mniejsze) zjeżdżają slalomem
  po całej szerokości trasy, omijając innych; **kolejki** – rzędy za dolnymi stacjami (kolejność
  przybycia); **krzesełka z siedzącymi gośćmi** (na orczyku i talerzyku – stojący); grupy (rodziny,
  szkoły) jadą razem i czekają na siebie na górze; idący pieszo z parkingu;
- **karta gościa** (kliknij postać): kim jest, co robi i co planuje, zadowolenie (gwiazdki),
  zmęczenie, głód, zimno, liczba zjazdów, czas jazdy i w kolejkach, preferencje;
- **panel „Goście”**: ilu na stoku, w kolejkach, na wyciągach, na trasach, na przerwie; dla każdego
  wyciągu długość kolejki, czas oczekiwania i wykorzystanie przepustowości (ostatnie 30 min);
  dziennik zdarzeń (wypadki – ikona 🚑 także na mapie);
- **nakładki**: `9` – natężenie ruchu na trasach (przejazdy na godzinę), `K` – plakietki z czasem
  oczekiwania i liczbą osób przy dolnych stacjach (zielone do 5 min … czerwone ponad 30 min);
- **śnieg**: za narciarzami ślady na puchu; po zakończeniu dnia przejazdy trafiają do modelu śniegu
  – śnieg na trasach jest ubity, na stromiznach zsunięty w dół (przetarcia), rosną muldy
  (zasypuje je świeży śnieg; ratraki – etap 7);
- **raport dnia** (sam się otwiera po zamknięciu wyciągów, albo przycisk „Raport dnia”): liczba gości,
  wjazdów i zjazdów, średni czas w kolejce na wjazd, średnia ocena i rozkład ocen 1–5, dlaczego
  goście wyjechali, wykres na stoku/w kolejkach co godzinę, wyciągi z najdłuższym czekaniem,
  najbardziej zatłoczone trasy, wypadki.

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

### Raport ekonomii (10 sezonów)

https://celif89.github.io/ski-sim/raport-ekonomii.html – prosty ośrodek (orczyk Korbielów–Buczynka
788–1009 m, dwie trasy, parking) w trybie kariery przez 10 sezonów, liczony tym samym kodem co gra (bez
grafiki): tabela sezon po sezonie (dni otwarte, goście, ocena, przychody, koszty, wynik, saldo,
reputacja), wykresy gości i wyniku, przychody i koszty średnio na sezon, dzień po dniu w najlepszym
i najsłabszym sezonie, porównanie z konkurencją, porównanie pełnej symulacji gości z modelem zgrubnym
w te same dni; **naśnieżanie**: ten sam ośrodek z ujęciem, zbiornikiem, pompownią, rurociągami i armatkami
na 30 zimach obok wersji bez naśnieżania (dni otwarte zima po zimie, zysk w słabych i mocnych zimach,
wynik, zwrot) i **tabela kalibracji** (woda i energia na hektar, energia na wizytę, koszt m³ śniegu – gra
wobec danych z koncepcji); założenia. Lokalnie: `npm run economy-report` → `reports/raport-ekonomii.html`
(ok. 4–5 min; szybciej: `WINTERS=5 npm run economy-report`).

### Raport lata (etap 7b)

https://celif89.github.io/ski-sim/raport-lata.html – prawdziwy układ Pilska z OpenStreetMap w przeciętnym
roku gry dwa razy: bez sezonu letniego i z sezonem letnim (najdłuższa kanapa kursuje latem z wieszakami
na rowery, restauracja i punkt widokowy przy górnej stacji, plac zabaw przy parkingu, tor saneczkowy
i trasa rowerowa). Tabela przychodów i kosztów osobno dla zimy, lata, dni poza sezonem i kosztów wspólnych;
o ile lato zmienia wynik roku; goście latem miesiąc po miesiącu i wg typu; dni z burzą; ceny i źródła.
Lokalnie: `npm run summer-report` → `reports/raport-lata.html` (ok. 2 min; `SUMMER_AGENTS=0` – model
zgrubny zamiast symulacji gości).

### Sezon letni w grze (etap 7b)

- **Otwarcie:** panel „Finanse” → sekcja „Sezon letni” → „Otwórz sezon letni” (od maja do października).
  Tam też ceny lata: bilet w górę, góra-dół, karnet rowerowy, przejazd torem. Gdy sezon letni jest
  otwarty, dni płyną jak zimą (bez przewijania tygodniami); burze i deszcz zmniejszają ruch.
- **Atrakcje:** przycisk „Lato” na dolnym pasku albo klawisze `X` (trasa rowerowa – trudność z nachylenia),
  `Q` (ścieżka spacerowa), `C` (tor saneczkowy – od góry do dolnej stacji, nachylenie w granicach toru);
  plac zabaw i punkt widokowy – narzędzie „Budynki”. W karierze atrakcje odblokowują się z reputacją
  i saldem.
- **Kolej latem:** karta kanapy lub gondoli – „Kursuj latem / Nie kursuj latem”, „Załóż wieszaki na
  rowery” (mniej miejsc dla pieszych). Orczyki i talerzyki latem stoją.
- **Przeglądy:** każdy wyciąg ma przegląd ważny rok; termin wybierasz w karcie wyciągu („Termin
  przeglądu”). W czasie przeglądu wyciąg nie wozi – najlepiej w listopadzie lub kwietniu.
- **Karta obiektu:** kliknij wyciąg, trasę, parking, restaurację, tor, zbiornik… – status, liczby na żywo
  (np. parking: zajęte, wolne, szczyt, kiedy był pełny, ilu odjechało), wykres dnia i akcje (otwórz /
  zamknij, cena, rozbiórka).

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
- **goście (etap 5):** w tłumie 3000 gości żaden wyciąg nie przewozi w godzinę więcej osób niż jego
  przepustowość; przejazd trwa dokładnie długość / prędkość; początkujący nigdy nie wjeżdżają na
  czarną górę ani nie zjeżdżają czarną trasą; eksperci wybierają czarną ponad 2× częściej niż
  zieloną; dłuższy czas w kolejce zawsze obniża zadowolenie, wolniejsze wyciągi – niższe oceny dnia;
  przy wolnym i szybkim wyciągu obok siebie goście przenoszą się na szybszy (bez patrzenia na
  kolejki czekaliby ponad 2× dłużej); grupa jedzie razem; nikt nie zjeżdża zamkniętą trasą;
  jadący są zawsze w korytarzu trasy (nie w lesie); przejazdy ubijają śnieg, zsuwają go w dół
  (masa zachowana), tworzą muldy, a wielodniowy ruch wyciera stromiznę do przetarć; świeży śnieg
  zasypuje muldy; ten sam seed = ten sam dzień (także przy innym podziale czasu); prawdziwy Pilsko
  z OSM – dzień 2000 gości bez błędów,
- **sezon i ekonomia (etap 6):** pełny rok gry od maja do kwietnia bez grafiki (budowa w czasie,
  sezon, kredyt w trakcie, dzień z symulacją gości) przechodzi bez błędów; **saldo końcowe = saldo
  początkowe + przychody − koszty − budowa + kredyt − spłata kapitału**; wyższa cena karnetu – mniej
  gości; weekendy i ferie (śląskie 2027) – ponad 2× więcej niż wtorek, w tygodniu więcej grup
  szkolnych, w weekend rodzin; zamknięty ośrodek – zero przychodów z karnetów (koszty stałe zostają);
  **zapis i wczytanie dają identyczny dalszy przebieg** (także dni z symulacją gości); ferie 2026 zgodne
  z komunikatem MEN; parking ogranicza przyjazdy; lepsza reputacja i śnieg – więcej gości, konkurencja
  bez śniegu – więcej dla nas; budowa kosztuje i trwa, zimą drożej i wolniej, anulowana tego samego dnia
  – pełny zwrot, piaskownica – za darmo; kredyt spłaca się w terminie; bankructwo kończy karierę;
  karnety (krótki pobyt – 2 h/4 h, dzieci ulgowo); model zgrubny dnia zgodny z pełną symulacją gości
  (ocena ±0,45, przejazdy ±25–35 %, przychód na gościa ±25 % przy 100–800 gościach),
- **edycja i śnieg a jazda (etap 5b):** przesunięcie punktu osi zmienia profil i kolor trasy,
  usunięcie punktu działa, szerokość zmienia obrys i koszt; stacja kątowa w limicie – droższa
  i poprawna, ponad limit (kanapa 45°, orczyk 8°) – odrzucona; stacja pośrednia jest węzłem sieci
  i przystankiem dla gości; ręcznie ustawiona podpora zostaje po przesunięciu stacji; podłoże po
  wycince – pniaki, po wyrównaniu – łąka wyrównana (wyrównanie kamieni droższe niż łąki); 10 cm
  puchu po ubiciu to mniej niż minimum na każdym podłożu i trasa dostaje ostrzeżenie z odcinkiem;
  na zbyt cienkiej bazie (ci sami goście, ten sam seed) wypadków ponad 1,5× więcej, są uszkodzenia
  sprzętu i niższa ocena dnia; zamknięta trasa ma zero przejazdów, a wyciąg bez otwartego zjazdu
  stoi,
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
- **działki i kamienie milowe (etap 7g):** nie da się zbudować poza swoimi działkami (lista brakujących),
  kamień milowy odblokowuje się dokładnie po przekroczeniu wszystkich progów, zablokowanego typu nie da
  się postawić, start kariery tylko przy drodze publicznej, zakup obciąża saldo, dzierżawa co roku 1 maja,
  starszy zapis wczytuje się z poprawnymi działkami,
- **wygoda budowania (etap 7f):** koniec rurociągu w progu łączy się z hydrantem i pompownią, Shift
  wyłącza przyciąganie, linia pomocnicza daje dokładnie 90° (i 45° co 15°), przedłużenie i równoległa;
  „Naśnież trasę” – hydranty dokładnie co 60 m, wszystkie armatki podłączone do pompowni, koszt = suma
  rur, hydrantów i armatek, śmigłowe na szerokich odcinkach, lance przy lesie; ulepszenie wyciągu
  zachowuje stacje i załamania, podpory od nowa, koszt różnicowy + opłata za przebudowę; rozbiórka –
  zwrot z pliku danych; ratrak bez garażu pracuje (dłużej się rozgrzewa), w mróz psuje się częściej niż
  w garażu (te same warunki i ziarno); oferty używanych z ziarna; rów – zlewnia to obszar powyżej rowu,
  rów pod górę do zbiornika odrzucony; lista „czego brakuje”,
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
| `npm run snow-diagnosis` | diagnoza śniegu naturalnego: dni z bazą do otwarcia – generator a prawdziwe zimy IMGW (`-- --klasy` zapisuje klasy zim) |
| `npm run pilsko-economy` | ekonomia ośrodka wielkości Pilska (prawdziwy układ z OSM) w przeciętnej zimie – struktura przychodów i kosztów |
| `npm run import-hydro` | pobiera z IMGW przepływy potoków (Ujsoły, Pewel Mała) i liczy rytm roczny |
| `npm run summer-report` | raport lata: ośrodek wielkości Pilska z sezonem letnim i bez (`reports/raport-lata.html`) |
| `npm run import-storms` | pobiera z IMGW dni z burzą (Bielsko-Biała 2001–2025) do pogody letniej |
| `npm run water-check` | potoki na mapie: przepływy, ile wolno pobrać w miesiącach, czas napełniania zbiornika |

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
