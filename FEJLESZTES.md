# Fejlesztés és futtatás

## Helyi indítás

Node.js 22.13.0 vagy újabb szükséges.

```sh
npm ci
npm run dev
```

A terminál által kiírt helyi címet nyisd meg. Ez csak a helyi fejlesztői példány; a localhost linket nem lehet távoli barátoknak tesztlinkként elküldeni.

```sh
npm test
npm run lint
```

Az npm test először buildet készít, majd a meglévő teszteket futtatja. A lint régebbi kód problémáit is jelezheti. A helyi D1 emulációt a vite.config.ts állítja be, az adatok a figyelmen kívül hagyott .wrangler mappában maradnak. Éles adatbázis nincs a tárban.

## Helyi adatbázis-migrációk

Az `npm run dev` indítás előtt automatikusan lefut az `npm run db:migrate:local`, amely a `drizzle/` mappa migrációit alkalmazza a helyi Miniflare D1 adatbázisra (`.wrangler/state/`). Friss klónon enélkül a szobalétrehozás `no such table: rooms` hibával, a felületen „A játékszerver átmenetileg hibázik” üzenettel állna le.

- A parancs külön is futtatható: `npm run db:migrate:local`. Idempotens, a már alkalmazott migrációkat kihagyja.
- A `scripts/wrangler.local-d1.jsonc` kizárólag ehhez a helyi parancshoz kell; az élő Sites/Cloudflare környezet nem ebből kapja a kötéseit. A benne lévő `database_id` szándékosan egyezik a `vite.config.ts` helyettesítő azonosítójával, így ugyanazt a helyi adatbázisfájlt éri el, mint a dev szerver.
- Új migráció után (`npm run db:generate`) elég újra elindítani a dev szervert.
- Ha a helyi adatbázist tisztán akarod kezdeni, töröld a `.wrangler/state` mappát és indítsd újra a dev szervert.

## Fontos fájlok

- app/page.tsx: belépőoldal és különálló gyakorló mód.
- app/multiplayer/MultiplayerLobby.tsx: szobák, szerepek, készenlét, meghívó.
- app/multiplayer/MultiplayerGame.tsx: online térkép, vezetés, kamera, kommunikáció.
- app/multiplayer/types.ts és room-client.ts: kliens/szerver szerződés.
- app/api/rooms/shared.ts: szobatárolás, szabályok és pozíciók láthatósága.
- app/api/rooms/: HTTP végpontok.
- db/schema.ts és drizzle/: adatbázisséma és migrációk.
- .openai/hosting.json, vite.config.ts, worker/index.ts: meglévő Sites/Cloudflare futtatókörnyezet. Ez vinext, nem hagyományos Next.js szerver.
- JATEKMENET.md: megbeszélt szabályok; CLAUDE.md: állapot, következő feladat és együttműködési keretek.

## Külső szolgáltatások

A térkép és közúti útvonaltervezés hálózati hozzáférést igényel. A jelenlegi OSRM nyilvános útvonaltervező végpont bétafüggőség, nem saját üzemeltetésű szolgáltatás. A GitHub forrástár önmagában nem futtatja a játékot. Más tárhelyre költözés külön feladat a Workers/D1 függőségek miatt.
