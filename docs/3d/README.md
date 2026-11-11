# Widok 3D – zrzuty (etap 3D-0)

Prototyp widoku 3D (Three.js) obok mapy 2D. Włączanie: **F3** albo menu ☰ → „Widok 3D (podgląd)”.
Zrzuty z trybu piaskownicy, układ „prawdziwe Pilsko z OSM” (12 wyciągów, wszystkie trasy oświetlone,
3 ratraki), pogoda z generatora (zima 2026/27 – słaba, mało śniegu w niższych partiach),
1920 × 1080, jakość średnia.

Zrzuty robione w kontenerze bez karty graficznej (grafika liczona przez procesor – SwiftShader),
dlatego klatki rysowane pojedynczo (`?r3d=manual`, `__view3d.renderOnce()`), a nie w pętli.

| Plik | Co widać |
|---|---|
| `osrodek-rano.png` | 2 I 2027, 9:00, pogodnie, −14 °C. Cały ośrodek od Korbielowa (od północy), Słońce nisko na południowym wschodzie, mgła w dolinie, okoliczne góry z modelu Copernicus. |
| `trasa-narciarze.png` | 2 I 2027, ok. 12:00, −9 °C – narciarze z symulacji gości (ramki wątku gości) na trasie, tyczki, krzesełka. |
| `wyciag-krzeselka.png` | ta sama chwila, dolna stacja kanapy (W1) – kanapa: podpory z belką, dwie nitki liny z krzywą zwisu, krzesełka w tym samym miejscu co w 2D, siedzący goście. |
| `hala-miziowa-poludnie.png` | 6 II 2027, 12:00, pogodnie – Hala Miziowa, schronisko z OSM (dach dwuspadowy), cienie drzew na śniegu (cienie kaskadowe). |
| `zachod-slonca.png` | 6 II 2027, ok. 16:30 – Słońce z modelu (data, godzina, położenie) przy horyzoncie, ciepłe światło i niebo. |
| `noc-ratraki.png` | 6 II 2027, 21:00 – trasy oświetlone, ratrak z reflektorami (plan nocy z symulacji). |
| `lato.png` | 20 VII 2027, południe – łąki zamiast śniegu, trasy jako koszone łąki, las, letni goście. |

Śnieg na zrzutach to dokładnie stan modelu (bez naśnieżania): na niższych trasach pokrywa ma
1–5 cm i widać łaty zeschłej trawy – tak samo jak w mapie 2D (stan „przetarty”). Zima 2026/27
z generatora jest słaba – z naśnieżaniem trasy byłyby białe.

Ograniczenia prototypu: patrz CLAUDE.md, „Na później” → „Widok 3D (3D-0)”.
