import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import test from "node:test";

const asModule = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString("base64")}`;
const roadsUrl = asModule(await readFile(new URL("../app/multiplayer/road-starts.ts", import.meta.url), "utf8"));
const citiesUrl = asModule((await readFile(new URL("../app/multiplayer/cities.ts", import.meta.url), "utf8")).replace('"./road-starts"', JSON.stringify(roadsUrl)));
const cities = await import(citiesUrl);
const source = (await readFile(new URL("../app/api/rooms/shared.ts", import.meta.url), "utf8"))
  .replace('import { env } from "cloudflare:workers";', 'const env = {};')
  .replace('"../../multiplayer/cities"', JSON.stringify(citiesUrl));
const api = await import(asModule(source));

async function database() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../drizzle/", import.meta.url);
  for (const file of (await readdir(dir)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(await readFile(new URL(file, dir), "utf8"));
  return {
    sqlite,
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async all() { return { results: stmt.all(...values) }; },
        async first() { return stmt.get(...values) ?? null; },
        async run() { return { meta: { changes: stmt.run(...values).changes } }; },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}

test("all selectable cities have eight nearby zones and eleven separated starting seeds", () => {
  assert.equal(new Set(cities.CITIES.map(c => c.id)).size, cities.CITIES.length);
  for (const city of cities.CITIES) {
    const zones = cities.getCityZones(city.id);
    assert.equal(zones.length, 8);
    assert.equal(cities.getStartSeeds(city.id).length, 11);
    assert.ok(zones.every(z => z.radius >= 2600 && Math.abs(z.lat - city.lat) < 0.15 && Math.abs(z.lng - city.lng) < 0.15));
  }
  assert.equal(cities.getCity("not-a-city"), undefined);
});

test("road snapping refuses failed or distant results", async () => {
  await assert.rejects(cities.roadStarts("arad", async () => new Response("", { status: 503 })));
  await assert.rejects(cities.roadStarts("arad", async () => Response.json({ code: "Ok", waypoints: [{ distance: 9000, location: [21, 46] }] })));
});

test("every city has independent verified starts inside its opening zone", async () => {
  for (const city of cities.CITIES) {
    const points = await cities.roadStarts(city.id);
    assert.equal(points.length, 11);
    assert.equal(new Set(points.map(p => `${p.lat},${p.lng}`)).size, 11);
    for (const point of points) {
      const north = (point.lat - city.lat) * 111320;
      const east = (point.lng - city.lng) * 111320 * Math.cos(city.lat * Math.PI / 180);
      assert.ok(Math.hypot(north, east) < cities.getCityZones(city.id)[0].radius);
      assert.ok(point.lng >= cities.GAME_BOUNDS.west && point.lng <= cities.GAME_BOUNDS.east);
    }
    points[0].lat = 0;
    assert.notEqual((await cities.roadStarts(city.id))[0].lat, 0);
  }
});

for (const selectedCity of ["budapest", "arad"]) test(`${selectedCity}: city survives joining/reloading; movement, start and exposure use that city; only host starts`, async (t) => {
  const db = await database();
  t.after(() => db.sqlite.close());
  await api.ensureSchema(db);
  await assert.rejects(api.createRoom(db, "Host", "hunter", "unknown"), e => e.code === "INVALID_CITY");
  const host = await api.createRoom(db, "Host", "hunter", selectedCity === "budapest" ? undefined : selectedCity);
  const runner = await api.joinRoom(db, host.room.code, "Runner", "runner");
  assert.equal(runner.room.cityId, selectedCity);
  assert.equal((await api.getRoomSnapshot(db, host.room.code, host.session.playerId)).cityId, selectedCity);
  const hs = { ...host.session, isHost: true, role: "hunter" };
  const rs = { ...runner.session, isHost: false, role: "runner" };
  await assert.rejects(api.startRoom(db, rs, Date.now()), e => e.code === "NOT_HOST");
  await api.setReady(db, hs, true, Date.now());
  await api.setReady(db, rs, true, Date.now());
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response("", { status: 503 });
  // Start must work even when the public road service is unavailable.
  await api.startRoom(db, hs, Date.now());
  const snapshot = await api.getRoomSnapshot(db, host.room.code, host.session.playerId);
  assert.equal(snapshot.status, "playing");
  assert.ok(snapshot.players.find(p => p.isHost).position.lat > 46);
  assert.equal(snapshot.players.find(p => !p.isHost).exposed, false);
  assert.equal(snapshot.players.find(p => !p.isHost).position, null);
  const ownPosition = snapshot.players.find(p => p.isHost).position;
  assert.ok(Math.abs(ownPosition.lng - cities.getCity(selectedCity).lng) < 0.01);
  const movedAt = Date.now() + 1000;
  await api.updatePlayerPosition(db, hs, ownPosition.lat + 0.0001, ownPosition.lng, movedAt);
  assert.equal((await api.getRoomSnapshot(db, host.room.code, host.session.playerId, movedAt)).players.find(p => p.isHost).position.lat, ownPosition.lat + 0.0001);
  await assert.rejects(api.updatePlayerPosition(db, hs, 0, 0, movedAt + 1000), e => e.code === "OUTSIDE_GAME_AREA");
  db.sqlite.prepare("UPDATE room_players SET lat = 44.4268, lng = 26.1025 WHERE id = ?").run(runner.session.playerId);
  assert.equal((await api.getRoomSnapshot(db, host.room.code, host.session.playerId)).players.find(p => !p.isHost).exposed, true);
});
