# Kapj el, ha tudsz! – játékmeneti specifikáció

## Városválasztás

- Szobalétrehozáskor a gazda országot és várost választ: Magyarországon Budapest, Romániában 12 város érhető el. Az új szobák alapértelmezett helyszíne Budapest. A már meglévő szobák helyszíne nem változik.
- A választás a szerveren tárolódik; csatlakozás és újracsatlakozás után is mindenki ugyanazt a helyszínt kapja.
- A kezdőpontok előre ellenőrzött közúti pontok, a játék részeként tárolva. Az indulás nem igényel külső útvonaltervező-kérést; a vezetés közbeni útvonaltervezés továbbra is hálózatot igényel.
- A nyolc, tizenöt percenként váltakozó zóna a kiválasztott városhoz tartozik. Nincs városok közötti teleportálás.
- A helyszín szobán belül rögzített; másik városhoz új szobát kell nyitni. A külön gyakorló mód Bukarestben marad.

## Térképnézet és kamerakövetés

- Az autó mozgása nem akadályozhatja a térkép kézi böngészését.
- Alapállapotban a kamera követi a játékos saját autóját.
- Kézi térképhúzás, nagyítás vagy kicsinyítés szabad nézetre vált.
- Szabad nézetben az autó, az útvonal és a helyzetküldés változatlanul tovább működik; csak az automatikus kameramozgás áll le.
- A kamera nem kapcsol vissza magától és nem ugrik vissza közeli hajsza vagy új helyzetjel miatt.
- A **VISSZA AZ AUTÓHOZ** gomb újraközépre helyezi a saját ikont és visszakapcsolja a követést.
- A térképre kattintva szabad nézetben is kijelölhető új közúti célpont.
- A beírható, pontos címkereső a civil bejelentések fejlesztésével együtt kerül be; a szabad nézet addig is lehetővé teszi a térképen történő kézi keresést és tervezést.

## Gyakorló hajsza

**Rögzítve:** 2026. szeptember 11.

- A gyakorlás indítása előtt országot, várost és szerepet kell választani.
- Magyarországon Budapest, Romániában a közös játékban elérhető városok használhatók.
- A kiválasztott város határozza meg a teljes gyakorlás térképét, zónáit és ellenőrzött közúti kezdőpontjait.
- **Üldöző vagyok** módban a játékos vezeti az üldözőt, a menekülőket a gép irányítja.
- **Menekülő vagyok** módban a játékos vezeti a menekülőt, az üldözőt a gép irányítja.
- A játékos és a gépi ellenfél is közúti útvonalakon halad.
- Az 50 méteres elfogási szabály mindkét szerepben érvényes.
- Másik város vagy szerep választásához új gyakorlást kell indítani.

## Autóváltás

**Állapot:** jóváhagyott terv, még nincs leprogramozva  
**Rögzítve:** 2026. szeptember 4.

### Alapszabály

- A kötelező autóváltás csak a menekülőkre vonatkozik.
- Az üldöző végig autóval közlekedhet, számára nincs ötperces váltási kötelezettség.
- Egy menekülő egy autóval legfeljebb 5 percig haladhat rejtve.
- Az autó saját ötperces ideje akkor indul, amikor az előző váltás vagy stoppolás befejeződött, és az új jármű mozgathatóvá vált.
- Az időt a játékszerver tartja nyilván; oldalfrissítés, újracsatlakozás vagy másik böngésző nem indítja újra.

### Normál autóhasználat

1. Az új autó átvételekor elindul az `5:00` visszaszámláló.
2. A menekülő három, csak számára látható, valódi út mellett elhelyezett átadási pontból választhat.
3. A kiválasztott pont az aktív zónán belül legyen. Zónaváltás közelében a következő zóna irányába vezessen.
4. Az átadási pont az utolsó 60 másodpercben válik használhatóvá.
5. A menekülő bármikor dönthet úgy, hogy a tervezett átadás helyett kiszáll és stoppol.

### Figyelmeztetések

- `4:30`: sárga figyelmeztetés – hamarosan autót kell váltani.
- `4:50`: piros figyelmeztetés – 10 másodperc maradt.
- `5:00`: az autó **túlidős** állapotba kerül, és a menekülő pontos helyzete élőben megjelenik az üldöző térképén.

### Túlidős autó

- Az autó az öt perc letelte után is vezethető marad.
- A menekülő normál sebességgel haladhat tovább, de a pontos helyzete folyamatosan látható az üldözőnek.
- Az élő követés addig tart, amíg a menekülő:
  - meg nem nyomja a **KISZÁLLOK** gombot; vagy
  - ténylegesen át nem ül egy új autóba.
- A túlidős autó tudatos csaliként is használható: a menekülő magára húzhatja az üldözőt, hogy segítse a társait.

### Kiszállás

- A **KISZÁLLOK** gomb megnyomásakor az autó és a játékos azonnal megáll.
- A megkezdett útvonal törlődik; gyalogos mozgás nincs.
- A folyamatos élő követés megszűnik.
- Az üldöző térképén a kiszállás helye 60 másodpercig szürke, mozdulatlan „utolsó ismert hely” jelölőként marad meg.
- Ezután a menekülő csak egy előre egyeztetett autó átvételével vagy stoppolással indulhat tovább.

### Előre egyeztetett autó

- Csak a menekülő által kiválasztott átadási pont közelében vehető át.
- Az elfogadási távolság tervezett értéke 75 méter.
- Az autóváltás 10 másodpercig tart; ezalatt a menekülő mozdulatlan.
- Ha a váltás még az öt perc lejárta előtt megtörténik, nem keletkezik élő helyzetjel.
- A váltás befejezésekor eltűnik a korábbi autó miatti élő követés, és elindul az új 5 perces idő.

### Stoppolás

- Kiszállás után megfelelő közúton indítható.
- A várakozás 25–45 másodperc közötti.
- A várakozás alatt a menekülő mozdulatlan.
- Az új autó megérkezésekor a menekülő ismét irányíthatóvá válik, és elindul az új 5 perces idő.
- A későbbi civilbejelentés-rendszerben a stoppolás növeli a valós bejelentés esélyét.

### Kapcsolat a zónaszabállyal

- A lejárt autó és a zónán kívüli tartózkodás két külön láthatósági ok.
- Ha a menekülő a zónán kívül van, a kiszállás nem rejti el: továbbra is élőben látható marad a zónabüntetés miatt.
- A pontos hely csak akkor rejtőzik el újra, ha nincs túlidős autóban, és az aktív zónán belül tartózkodik.

### Kapcsolat a 10 perces helyzetjellel

- A globális helyzetjel továbbra is 10 percenként készít befagyasztott pillanatképet.
- Az autó ötperces ideje és a helyzetjel időzítése egymástól független.
- Tipikus taktika: autóváltás az ötödik perc körül, kereszteződés választása, a tizedik perces jel megvárása, majd irányváltás.
- Ha a menekülő a jel pillanatában túlidős autóban van, az élő követés mellett a szabályos, befagyasztott helyzetjel is létrejön.

### Felületi elemek

- Mindig látható autóidő: `AUTÓ 03 · 2:41`.
- A kiválasztott átadási pont távolsága és várható elérési ideje.
- Sárga, majd piros lejárati figyelmeztetés.
- Túlidőben jól látható: `ÉLŐBEN LÁTHATÓ VAGY`.
- Nagy, érintőképernyőn is könnyen használható **KISZÁLLOK** gomb.
- Váltáskor és stoppoláskor visszaszámláló, valamint egyértelmű mozdulatlan állapot.
- Az üldözőnél külön jelölés az élő célponthoz és az utolsó ismert kiszállási ponthoz.

### Kötelező működési feltételek

- Az ötperces lejáratot a szerver állapítja meg, nem a telefon órája.
- A lejárat pillanatában az élő helyzet rögzül akkor is, ha a menekülő azonnal kiszáll.
- Kiszállás közben és várakozás alatt a szerver nem fogad el mozgást.
- Egy új autó csak a váltás vagy stoppolás befejezése után indít új ötperces ciklust.
- Az 50 méteres elfogás minden autóváltási állapotban érvényes.
- Kapcsolatvesztés alatt az autó ideje nem áll meg.

### Első fejlesztési változat elfogadási feltételei

- A menekülő látja az ötperces autóidőt és a két figyelmeztetést.
- Lejárat után az üldöző élőben látja a menekülőt.
- A kiszállás azonnal megállítja a menekülőt és létrehozza a 60 másodperces utolsóhely-jelölőt.
- Működik a 10 másodperces előre egyeztetett váltás.
- Működik a 25–45 másodperces stoppolás.
- Az új autó helyesen újraindítja az ötperces ciklust.
- A zónán kívüli láthatóság elsőbbséget élvez a kiszállással szemben.
- A 10 perces helyzetjel és az 50 méteres elfogás változatlanul működik.

## Aszimmetrikus információ és civil jelentések (2026. szeptember 12-i döntés)

- Az üldöző és a menekülő sem látja folyamatosan az ellenfél pontos távolságát vagy irányát.
- Mindkét oldal 10 percenként kap hivatalos, pontos pillanatképet az ellenfél helyéről. A jelölő a következő jelig a rögzített ponton marad, nem követi élőben az ellenfelet.
- Civil bejelentés mindkét oldalnak véletlenszerűen 30–60 másodpercenként érkezik.
- A civil jelentés lehet határozott, bizonytalan vagy félrevezető. A térképen a megbízhatósághoz igazodó keresési körzet jelenik meg.
- Az üldöző a menekülők civil nyomait, a menekülő az üldözőről érkező veszélyjelzéseket kapja.
- A két szerep külön ikont és külön stratégiai panelt használ. Az üldözői felület a keresést, a menekülői felület a menekülési útvonalat és az autóváltást emeli ki.
- Az 50 méteres elfogást továbbra is a szerver dönti el automatikusan; ehhez nem kell előzetesen megmutatni a pontos távolságot.

## Jövőbeli játékmeneti ötletek (2026-09-08)

Az alábbi ötleteket Boti megőrzésre elfogadta. Ezek még nem végleges játékszabályok: megvalósítás előtt mindegyiket külön issue-ban kell részletezni és jóváhagyni.

### 1. Kötelező menekülő-célpontok

- A menekülők 10–15 percenként új, időkorlátos célpontot kapnak, például teret, pályaudvart vagy benzinkutat.
- A célpont mozgásra kényszerít, és lehetőséget ad az üldözőnek a várható útvonalak kikövetkeztetésére.
- A sikeres elérés pontot vagy egyszer használható taktikai előnyt adhat.

### 2. Többféle autócsere

- Előre egyeztetett autó: gyors csere, de csak kijelölt átadási ponton.
- Stoppolás: megfelelő közúton indítható, 25–45 másodperc mozdulatlan várakozással.
- Lehetséges későbbi változat: biztonságosabb, lassabb csere, amely késlelteti az üldöző nyomát.

### 3. Haladási irányt mutató helyzetjel

- A 10 perces helyzetjel a befagyasztott pont mellett a jel pillanatában mért haladási irányt is mutathatja.
- A menekülő kereszteződésnél kivárhatja a jeladást, majd irányt válthat vagy autót cserélhet.

### 4. Üldözői útlezárás

- Az üldöző korlátozott időközönként egy rövid útszakaszt vagy kereszteződést 60–90 másodpercre lezárhat.
- A lezárás nem fog el automatikusan, hanem kerülőre és újratervezésre kényszerít.

### 5. Civil bejelentések

- A 30–60 másodperces alapritmus és a kétoldalú jelentés a 2026. szeptember 12-i döntéssel elfogadott alapszabály; az alábbi pontok ennek későbbi bővítései.
- A bejelentések eltérő pontosságúak és megbízhatóságúak lehetnek: biztos, bizonytalan vagy akár hamis.
- Az üldöző és a menekülők is kaphatnak jelentéseket, de azok száma és gyakorisága korlátozott.
- A jelölés pont helyett pontosságtól függő méretű terület is lehet.

### 6. Közeli üldözés fokozatai

- 500 méteren belül enyhe figyelmeztetés.
- 300 méteren belül automatikus közelítés és erősebb hang-, vizuális vagy rezgésjelzés.
- 100 méteren belül intenzív veszélyjelzés és mérsékelt lassítás.
- 50 méteren belül elfogás és bilincsanimáció.
- A felek ne kapjanak folyamatos, méterre pontos távolságot; elsősorban a veszély fokozódását érzékeljék.

### 7. Menekülők közötti segítség

- A menekülők megoszthatnak egymással korlátozott információt vagy civil jelentést.
- Egy játékos csalit játszhat, hamis nyomot kelthet vagy magára vonhatja az üldözőt.
- A csapatjáték nem fedheti fel automatikusan minden menekülő pontos helyét.

### 8. Részletes pontozás

- Menekülői pontok: túlélési idő, elért célpontok, sikeres autócserék, kockázatos közelség és csapattárs segítése.
- Üldözői pontok: elfogások, gyors megtalálás és a helyes civil jelentések felismerése.
- A pontozás egészítse ki, ne váltsa le az alapvető győzelmi feltételeket.

### Javasolt fejlesztési sorrend

1. Az autóváltás alapverziója.
2. Kötelező menekülő-célpontok.
3. Haladási irányt mutató helyzetjel.
4. Civil bejelentések.
5. Üldözői útlezárás.
6. Menekülők közötti segítség és részletes pontozás.

Az első nagy taktikai csomag ajánlott összeállítása: **célpontok + autóváltás + haladási irányt mutató helyzetjel**.

