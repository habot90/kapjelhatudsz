# AGENTS.md – közös munkaszabályok

Ezen a repón két AI-ügynök dolgozik együtt Boti (tulajdonos, `@habot90`) irányításával:

- **Boti** – terméktulajdonos és a játékmeneti döntések gazdája.
- **Codex / ChatGPT** – technikai vezető; tervezi és koordinálja a fejlesztést, reviewolja Claude munkáját, és kezeli a kiadást.
- **Claude** – a Claude Cowork felületről, git-en és PR-eken keresztül dolgozik a kiosztott issue-kon.

Mindkét ügynök ezt a fájlt olvassa el először. A szabályok mindkettőre egyformán vonatkoznak.

## A projekt

**Kapj el, ha tudsz!** – valós idejű, térképes üldözős játék (menekülők vs. üldöző).

A játékmeneti specifikáció a `JATEKMENET.md`; ez az igazság forrása a szabályokra. Ha a kód és a specifikáció ellentmond, a specifikáció nyer. Ha a specifikáció hiányos, issue-ban kell kérdezni, nem találgatni.

Stack: vinext (Next.js-kompatibilis) + React 19 + Tailwind 4 + Leaflet, Cloudflare Workers/D1 + Drizzle.

Parancsok: `npm install`, `npm run dev`, `npm run build`, `npm run lint`, `npm test`.

## Munkafolyamat

1. **Minden munka issue-ból indul.** Nincs issue → nincs kód. Kis feladatokra is kell issue.
2. **Feladat felvétele:** az ügynök ráteszi a saját címkéjét (`agent:claude` vagy `agent:codex`) és hozzászól: „Felveszem.” Egy issue-n egyszerre csak egy ügynök dolgozik.
3. **Branch:** mindig `main`-ből, név: `claude/<issue-szám>-rovid-leiras` vagy `codex/<issue-szám>-rovid-leiras`. Példa: `claude/12-autovaltas-idozito`.
4. **Commit:** rövid, angol vagy magyar, jelen idő. Az első sorban az issue száma: `#12 Add 5-minute car timer`.
5. **PR:** a `main`-re, cím: `#<issue> – leírás`. A leírásban szerepeljen: mi változott, hogyan lett tesztelve, mi maradt ki. Draft PR is lehet, ha félkész.
6. **Review:** a másik ügynök reviewolja (Claude a Codex PR-jeit, Codex a Claude PR-jeit). A review konkrét, lehetőleg sorhoz kötött megjegyzésekből áll. Boti merge-el, vagy engedélyt ad a merge-re a PR-ben.
7. **Soha ne pusholj közvetlenül `main`-re.** Kivétel: ez a fájl és a dokumentáció, Boti kifejezett kérésére.
8. **Ne írj át olyan fájlt, amin a másik ügynök nyitott PR-je dolgozik.** Ha ez elkerülhetetlen, előbb jelezd az issue-ban.

## Címkék

| Címke | Jelentés |
|---|---|
| `agent:claude` | Claude vállalta |
| `agent:codex` | Codex vállalta |
| `needs-decision` | Boti döntése kell (játékszabály, prioritás) |
| `bug` / `feature` / `docs` | típus |
| `blocked` | másik issue-ra vagy külső feltételre vár |

## Kódszabályok

- TypeScript, `strict`. Az `npm run lint`, `npm run build` és `npm test` legyen zöld a PR előtt.
- A játékszabály-logika (időzítők, láthatóság, elfogás) **a szerveren** él. A jelenlegi közös szerverlogika fő helye az `app/api/rooms/shared.ts`; a `worker/` a Cloudflare belépési pontja. A kliens csak megjelenít és parancsot küld.
- Időzítés szerveridővel történik, nem a telefon órájával.
- Nagy fájl helyett kis modulok; egy PR egy dolgot csinál.
- Titkok, tokenek és `.env*` fájlok soha nem kerülnek a repóba.
- UI-szövegek magyarul, kód és kommentek angolul.

## Kommunikáció

- Az ügynökök egymással issue-kommentekben és PR-reviewkban beszélnek; ez a közös, visszakereshető csatorna.
- Ha egy ügynök bizonytalan egy szabályban, `needs-decision` címkét tesz az issue-ra és megvárja Boti döntését.
- A végleges játékmeneti döntéseket dátummal vissza kell írni a `JATEKMENET.md`-be.
- Codex koordinálja a technikai sorrendet és a kiadásokat; ez nem írja felül Boti játékmeneti és prioritási döntéseit.

## Kiadás

- A GitHub `main` ág és a nyilvános OpenAI Sites oldal külön rendszer. Egy merge önmagában nem jelent automatikus élesítést.
- Kiadás csak zöld ellenőrzések és Boti jóváhagyása után történik.

## Repo-állapot (2026-09-08)

A teljes projektforrás elérhető a repóban, beleértve az `app/`, `worker/`, `db/`, `tests/` és `.openai/` mappákat. A következő tervezett funkció az autóváltás rendszere a `JATEKMENET.md` szerint; ezt külön issue és feature branch kezeli.

