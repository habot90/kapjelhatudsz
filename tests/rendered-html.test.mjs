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
  assert.match(page, /const SIGNAL_SECONDS = 6 \* 60/);
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
  const [game, gameCss, globalCss, roomApi, migration] = await Promise.all([
    readFile(new URL("../app/multiplayer/MultiplayerGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/multiplayer/MultiplayerGame.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/shared.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0001_hesitant_bulldozer.sql", import.meta.url), "utf8"),
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
  assert.match(roomApi, /SIGNAL_INTERVAL_MS = 6 \* 60 \* 1000/);
  assert.match(roomApi, /CAPTURE_DISTANCE_METERS = 50/);
  assert.match(roomApi, /await syncRoomGame\(database, session\.roomCode, now\)[\s\S]*UPDATE room_players/);
  assert.match(roomApi, /const exactPositionVisible = player\.id === meId/);
  assert.match(roomApi, /me\?\.role === "hunter" && liveTracked/);
  assert.match(roomApi, /me\?\.role === "hunter" && player\.role === "runner"/);
  assert.match(roomApi, /MOVEMENT_TOO_FAST/);
  assert.match(roomApi, /VEHICLE_DURATION_MS = 5 \* 60 \* 1000/);
  assert.match(roomApi, /VEHICLE_IMMOBILE/);
  assert.match(game, /KISZÁLLOK/);
  assert.match(game, /STOPPOLOK/);
  assert.match(migration, /position_updated_at/);
  assert.match(migration, /revision/);
});

