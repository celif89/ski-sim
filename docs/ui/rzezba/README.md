# Etap 7e – czytelność rzeźby terenu (zrzuty przed i po)

Zrzuty z gry w przeglądarce: piaskownica, prawdziwy Pilsko z OpenStreetMap, 7 stycznia 2027,
10:30, ekran 1920 × 1080; widok domyślny od Korbielowa (mapa obrócona – szczyt u góry). Grafika
w kontenerze bez karty graficznej (SwiftShader) – na Macu wygląda tak samo.

| Przed | Po | Co widać |
| --- | --- | --- |
| `przed-cala-mapa.png` | `po-cala-mapa.png` | Cała mapa (ok. 4 m/px): grzbiety, doliny potoków i żleby widać przez las – cieniowanie z czterech kierunków i nachyleniem, przyciemnione dna dolin, rzadsze ikony świerków; warstwice co 50 m. |
| `przed-hala-miziowa.png` | `po-hala-miziowa.png` | Hala Miziowa (1,6 m/px): stoki strome ciemniejsze i chłodniejsze niezależnie od kierunku; opisy warstwic co 100 m (góra napisu pod górę stoku); kreski spadku na polanach. |
| `przed-trasa-zblizenie.png` | `po-trasa-zblizenie.png` | Trasy przy Korbielowie (0,6 m/px): warstwice co 10 m, kreski spadku wzdłuż linii największego spadku (zwężone w dół stoku). |
| – | `po-budowa-pierscien.png` | Rysowanie trasy: pod kursorem pierścień w kolorze klasy nachylenia (36 % – czerwona), strzałka w dół stoku i liczba w %, obok dymek. |

Jak powtórzyć: piaskownica → panel „Goście” → „Pilsko z OSM”. Kreski spadku i warstwice:
widoki danych → „Teren i mapa” → przyciski „Kreski spadku”, „Warstwice”. Ustawienia: menu `Dev`
(lewy dolny róg) → „Rzeźba terenu (etap 7e)”.
