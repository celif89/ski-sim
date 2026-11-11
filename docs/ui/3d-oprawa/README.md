# Oprawa 3D – śnieg z grubością i światło (etap 3D-3), zrzuty przed / po

Te same kadry przed zmianą (`przed-*.png`, wersja po etapie 3D-2) i po niej (`po-*.png`). Tryb piaskownicy,
układ „prawdziwe Pilsko z OSM”, naśnieżanie przy jednej trasie (pompownia, zbiornik, rurociąg, 53 armatki),
2 ratraki, pogoda z generatora (zima 2026/27), 2000 gości w planie dnia, 1600 × 900, jakość średnia.

Zrzuty robione w kontenerze bez karty graficznej (grafika liczona przez procesor – SwiftShader), klatki
pojedynczo (`?r3d=manual`, `__view3d.renderOnce()`). Skrypt: `scene_op.cjs` (poza repozytorium), kadry
wskazane liczbami (cel kamery, odległość, obrót, pochylenie).

| Kadr | Co widać po zmianie |
|---|---|
| `dolna-stacja-rano` – 2 I 2027, 9:18, pogodnie, −13 °C | Słońce nisko (ciepłe światło), cieńsza pokrywa na dole (kilka cm – łaty trawy, stan modelu). Okna na ścianach budynków, szczyty dachów w barwie ścian, dach bieleje wraz z grubością śniegu w danej komórce (w pełni biały od 12 cm). |
| `pryzmy-armatek` – 6 I 2027, 11:00, pochmurno | Pryzma z nocnego naśnieżania jako prawdziwa rzeźba (łata gęstej siatki 1 m przy kamerze, kształt z warstwy detalu, rozmyty ok. 2 m); wcześniej teren był płaski. Sztruks w kierunku przejazdu ratraka. Przed zmianą kamera stała niżej – teraz cel kamery leży na powierzchni śniegu. |
| `budynek-po-sniezycy` – 22 II 2027, 11:00, dzień po największym opadzie zimy | Schronisko na Hali Miziowej: dach biały (grubość śniegu w komórce), szczyty w barwie ścian, okna; ściany schowane w śniegu do grubości pokrywy. |
| `zachod-slonca` – 6 II 2027, 16:27 | Cieplejsze niskie Słońce, bledsze dalekie góry (perspektywa powietrzna), las ciemny pod światło. |
| `noc-ratrak` – 7 I 2027, 21:00 | Reflektory ratraka; sztruks widoczny tam, gdzie ratrak przejechał tej nocy (z warstwy detalu – blednie w ciągu 18 h); wcześniej – stały wzór na całej trasie. |

Wszystkie wartości oprawy są w `data/map-style.json`, sekcja `render3d` (z opisem przy każdej), a suwaki –
w menu `Dev` → „Oprawa 3D (etap 3D-3)” z przyciskiem „Kopiuj ustawienia”. Wartości „do wyczucia” –
najlepiej stroić na Macu z kartą graficzną.

Obserwacja z kadru `pryzmy-armatek`: w modelu śniegu przy dolnym końcu tej trasy pryzmy rosną noc po nocy
(średnio ok. 3,2 m wody w komórce 10 m, czyli ok. 6 m śniegu) – ratrak ich nie rozgarnia (odcinek
z ratrakowaniem pominiętym albo pryzma poza jego zasięgiem). To sprawa symulacji (etap 7), nie rysunku –
do sprawdzenia osobno.
