import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the multiplayer entry point", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Kapj el, ha tudsz! – Online hajsza<\/title>/i);
  assert.match(html, /KAPJ EL, HA TUDSZ!/);
  assert.match(html, /ONLINE HAJSZA \/ MAGYARORSZÁG ÉS ROMÁNIA/);
  assert.match(html, /Belépési pont előkészítése/);
  assert.match(html, /KAPCSOLÓDÁS/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("keeps the agreed chase rules wired into the simulation", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const GAME_SECONDS = 120 \* 60/);
  assert.match(page, /const ZONE_SECONDS = 15 \* 60/);
  assert.match(page, /const RUNNER_SIGNAL_SECONDS = 2\.5 \* 60/);
  assert.match(page, /const HUNTER_SIGNAL_SECONDS = 10 \* 60/);
  assert.match(page, /const CAR_SECONDS = 5 \* 60/);
  assert.match(page, /router\.project-osrm\.org\/route\/v1\/driving/);
  assert.match(page, /nearestDistance<=300/);
  assert.match(page, /lockedDistance<=50/);
  assert.match(page, /engine\.lockEscape>=5/);
  assert.match(page, /signalMarkers\.current\.set/);
  assert.match(css, /\.close-banner/);
  assert.match(css, /\.capture-flash/);
  assert.match(css, /@media\s*\(max-width:/);
});

test("offers every shared city and both roles in practice mode", async () => {
  const [page, cities, starts, gameplay, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/cities.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/road-starts.ts", import.meta.url), "utf8"),
    readFile(new URL("../JATEKMENET.md", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /CITIES\.filter\(city=>cityCountry\(city\.id\)===country\)/);
  assert.match(page, /VERIFIED_ROAD_STARTS\[city\.id\]/);
  assert.match(page, /getCityZones\(city\.id\)/);
  assert.match(page, /ÜLDÖZŐ VAGYOK/);
  assert.match(page, /MENEKÜLŐ VAGYOK/);
  assert.match(page, /playerRole==="runner"\?RUNNER_STARTS\.slice\(0,1\):RUNNER_STARTS/);
  assert.match(page, /if\(playerRole==="runner"\)planHunter\(\)/);
  assert.match(cities, /\{ id: "budapest", name: "Budapest"/);
  assert.match(starts, /"budapest"/);
  assert.match(gameplay, /## Gyakorló hajsza/);
  assert.match(css, /\.practice-choice-grid\.two/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

test("keeps the shared lobby contract wired to durable room storage", async () => {
  const [hosting, schema, lobby, roomApi] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/MultiplayerLobby.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/shared.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(hosting).d1, "DB");
  assert.match(schema, /sqliteTable\("rooms"/);
  assert.match(schema, /sqliteTable\(\s*"room_players"/);
  assert.match(lobby, /setTimeout\(poll, delay\)/);
  assert.match(lobby, /action: "heartbeat"/);
  assert.match(lobby, /navigator\.share/);
  assert.doesNotMatch(roomApi, /CREATE TABLE|ALTER TABLE/);
  assert.match(schema, /idx_room_players_one_hunter/);
  assert.match(roomApi, /status = 'playing'/);
});

test("keeps the online map, protected positions and timed signals wired together", async () => {
  const [page, game, gameCss, globalCss, roomApi, migration, civilianMigration, handoffMigration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/MultiplayerGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/MultiplayerGame.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/shared.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_hesitant_bulldozer.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_handy_sharon_carter.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_shallow_rattler.sql", import.meta.url), "utf8"),
  ]);

  assert.match(game, /router\.project-osrm\.org\/route\/v1\/driving/);
  assert.match(game, /action: "position"/);
  assert.match(game, /player\.signalPosition/);
  assert.match(game, /signalEverySeconds/);
  assert.match(game, /nearestOpponentMeters/);
  assert.match(game, /overview=simplified/);
  assert.match(game, /preferCanvas: true/);
  assert.match(game, /panInside\(advanced\.position, \{ padding: \[90, 90\], animate: false \}\)/);
  assert.match(game, /setClockNow\(Date\.now\(\) \+ serverOffsetRef\.current\), 1000/);
  assert.match(game, /map\.on\("dragstart", handleMapInteraction\)/);
  assert.match(game, /cameraFollowingRef\.current && frameTime - lastCameraFollow/);
  assert.match(game, /const wasFollowing = cameraFollowingRef\.current/);
  assert.match(game, /VISSZA AZ AUTÓHOZ/);
  assert.match(gameCss, /\.followButton/);
  assert.match(gameCss, /@media \(max-width: 700px\), \(pointer: coarse\)[\s\S]*\.mapGrid \{ display: none; \}/);
  assert.match(globalCss, /@media \(max-width: 700px\), \(pointer: coarse\)[\s\S]*\.leaflet-tile-pane[\s\S]*filter: none/);
  assert.match(roomApi, /RUNNER_SIGNAL_INTERVAL_MS = 2\.5 \* 60 \* 1000/);
  assert.match(roomApi, /HUNTER_SIGNAL_INTERVAL_MS = 10 \* 60 \* 1000/);
  assert.match(roomApi, /role = 'runner'/);
  assert.match(roomApi, /role = 'hunter'/);
  assert.match(game, /opponentSignalIndex/);
  assert.match(roomApi, /CIVILIAN_REPORT_MIN_MS = 30 \* 1000/);
  assert.match(roomApi, /CIVILIAN_REPORT_MAX_MS = 60 \* 1000/);
  assert.match(roomApi, /nearestOpponentMeters: null/);
  assert.match(game, /CIVIL BEJELENTÉS/);
  assert.match(game, /TÁVOLSÁG REJTVE/);
  assert.doesNotMatch(game, /KÖVETKEZŐ CIVIL HÍVÁS/);
  assert.doesNotMatch(page, /KÖVETKEZŐ CIVIL HÍVÁS/);
  assert.doesNotMatch(roomApi, /nextCivilianReportAt/);
  assert.match(game, /A SAJÁT HELYZETED ELKÜLDÉSÉIG/);
  assert.match(page, /SAT \/\/ SAJÁT JEL/);
  assert.match(page, /opacity:playerRole==="hunter"\?1:0/);
  assert.match(civilianMigration, /civilian_reported_at/);
  assert.match(roomApi, /CAPTURE_DISTANCE_METERS = 50/);
  assert.match(roomApi, /await syncRoomGame\(database, session\.roomCode, now\)[\s\S]*UPDATE room_players/);
  assert.match(roomApi, /const exactPositionVisible = player\.id === meId/);
  assert.match(roomApi, /me\?\.role === "hunter" && liveTracked/);
  assert.match(roomApi, /player\.role !== me\.role/);
  assert.match(roomApi, /MOVEMENT_TOO_FAST/);
  assert.match(roomApi, /VEHICLE_DURATION_MS = 5 \* 60 \* 1000/);
  assert.match(roomApi, /VEHICLE_IMMOBILE/);
  assert.match(roomApi, /HANDOFF_TOO_FAR/);
  assert.match(roomApi, /position_updated_at = switch_ends_at/);
  assert.match(game, /KISZÁLLOK/);
  assert.match(game, /STOPPOLOK/);
  assert.match(game, /AUTÓ LERAKÁSA/);
  assert.match(game, /EGYEZTETETT AUTÓBA ÜLÖK/);
  assert.match(game, /action: "place_handoff_car"/);
  assert.match(game, /action: "remove_handoff_car"/);
  assert.match(page, /AUTÓ LERAKÁSA/);
  assert.match(page, /EGYEZTETETT AUTÓBA ÜLÖK/);
  assert.match(game, /action: "select_handoff"/);
  assert.match(roomApi, /cars\.length >= 10/);
  assert.match(handoffMigration, /handoff_cars/);
  assert.match(migration, /position_updated_at/);
  assert.match(migration, /revision/);
});

