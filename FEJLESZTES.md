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
