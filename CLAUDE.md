# Kapj el, ha tudsz! — fejlesztői átadás

## Kezdd itt

Olvasd el a README.md és a JATEKMENET.md fájlokat. Ez egy meglévő magyar nyelvű, online térképes játék: ne cseréld le új demóra. A dokumentált tervek nem mind megvalósított funkciók.

## Jelenlegi állapot (2026-09-07)

- Online szobalétrehozás és csatlakozás meghívóval/szobakóddal; egy üldöző, legfeljebb tíz menekülő.
- Közös szerveroldali szobaállapot, közúti útvonalak, hatpercenként befagyasztott helyzetjelek, zónán kívüli láthatóság, közelségjelzés és elfogás.
- Az online szoba létrehozásakor ország és város választható: alapértelmezés Magyarország / Budapest; mellette 12 romániai város elérhető. A city_id a szerveren tárolódik, a közös cities.ts konfiguráció adja a zónákat és közútra illesztett kezdőpontokat. A régi szobák helyszíne és a bukaresti gyakorló mód nem változik. Az adatbázis korábbi alapértéke kompatibilitás miatt Bukarest marad, az új szobák explicit city_id értéket kapnak az API-tól.
- A térkép kézzel böngészhető mozgás közben. Automatikus követés csak a visszatérés gombbal kapcsoljon vissza; közelség és jel ne rántsa vissza a szabad kamerát.
- Mobil teljesítményjavítások készültek, de a valódi iPhone-on végzett többjátékos visszateszt még szükséges.
- A gyakorló mód és az online mód külön megvalósítás. A gyakorlóban lévő autóidő nem jelenti a teljes online autóváltás elkészültét.

## Városválasztás: első változat megvalósítva

A szoba létrehozásakor egy város választható; azon belül nyolc zóna van. Másik városhoz új szobát kell nyitni. A 0002 migráció a régi szobákhoz Bukarestet rendel. Az alábbi többvárosos/várótermi szerkesztési ötletek további egyeztetést és fejlesztést igényelnek:

1. A szobagazda a váróban válassza ki a helyszínt/helyszíneket. A választást a szerver tárolja, minden csatlakozó ugyanazt lássa.
2. A térkép, úton lévő kezdőpontok és aktív/következő zónák ugyanabból a konfigurációból származzanak. Most a kliens és a szerver külön rögzített koordinátákat tartalmaz.
3. Ne lehessen teleportálni, például Bukarestből Aradra kattintani és azonnal ott lenni. Az egymást követő zónák közúton, a rendelkezésre álló idő alatt elérhetők legyenek. A távoli városok sorrendjét és átmeneti szabályát egyeztesd a felhasználóval; ne vezess be csendben lehetetlen 15 perces átmeneteket.
4. Csak a gazda változtathasson, és csak indulás előtt. Változáskor érdemes a készenléti állapotokat törölni.
5. Ellenőrizd a jogosultságot, érvénytelen választást, újracsatlakozást, közös kezdőpontokat és zónaláthatóságot.

## További elfogadott terv

A JATEKMENET.md részletezi az online autóváltást: öt perc után élő láthatóság, kiszállásig vagy új autóig; kiszálláskor megállás; stoppolás vagy előre egyeztetett csere. Az üldözőre nincs cserekényszer. A zónabüntetés külön láthatósági ok. A hatperces jel független az autó idejétől. Civil bejelentések és pontos címkereső későbbi feladatok.

## Biztonság és együttműködés

- A rejtett pozíciót a szerver szűrje ki; nem elég a kliensen elrejteni a markert.
- Időzítés, elfogás, jogosultság és mozgásellenőrzés maradjon szerveroldali. Jelenleg a szerver sebességet/távolságot vizsgál, ez nem teljes közúti csalásvédelem.
- Ne írj felül más fejlesztő munkáját. Friss főágból külön feladatágon dolgozz, és pull requestben add át a változást. Codex ágakhoz a codex/ előtagot használd.
- Ne tölts fel .env fájlt, munkamenettokent, helyi adatbázist vagy szolgáltatói hitelesítő adatot. A .openai/hosting.json projektazonosító és kötéskonfiguráció, nem belépési titok.
- A GitHub-feltöltés nem telepít automatikusan az élő oldalra, és nem ad Claude-nak tárhely-hozzáférést. Éles közzétételhez a tulajdonos jogosult környezete szükséges.
- Ellenőrzés: npm test; érintett fájlok lintje; változó játékszabályokhoz viselkedést vizsgáló tesztek. A jelenlegi tesztek egy része csak forrásszöveg-ellenőrzés, nem teljes többjátékos vagy iPhone-teszt.
