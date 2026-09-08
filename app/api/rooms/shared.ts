// `cloudflare:workers` is a workerd-provided virtual module. Vinext externalizes
// it during builds; the repository intentionally has no generated Wrangler types.
// @ts-expect-error -- resolved by the Cloudflare runtime and Vite plugin
import { env } from "cloudflare:workers";
import { DEFAULT_CITY_ID, GAME_BOUNDS, getCity, getCityZones, roadStarts } from "../../multiplayer/cities";

type D1Result<T = Record<string, unknown>> = {
  results: T[];
  meta: { changes?: number };
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
};

type D1Database = {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
};

export type PlayerRole = "hunter" | "runner";
export type RoomStatus = "lobby" | "playing" | "finished";
export type VehicleState = "driving" | "dismounted" | "switching";
export type VehicleSwitchKind = "prearranged" | "hitchhike";

type RoomRow = {
  city_id: string;
  code: string;
  status: RoomStatus;
  host_player_id: string;
  created_at: number;
  started_at: number | null;
  updated_at: number;
  revision: number;
  signal_index: number;
  capture_goal: number;
};

type PlayerRow = {
  id: string;
  nickname: string;
  role: PlayerRole;
  ready: number;
  caught: number;
  joined_at: number;
  last_seen_at: number;
  lat: number | null;
  lng: number | null;
  signal_lat: number | null;
  signal_lng: number | null;
  position_updated_at: number | null;
  vehicle_started_at: number | null;
  switch_ends_at: number | null;
  vehicle_cycle: number;
  vehicle_state: VehicleState;
  switch_kind: VehicleSwitchKind | null;
  last_exit_lat: number | null;
  last_exit_lng: number | null;
  last_exit_at: number | null;
};

type SessionRow = {
  playerId: string;
  roomCode: string;
  role: PlayerRole;
  isHost: boolean;
};

export type RoomSnapshot = {
  cityId: string;
  code: string;
  status: RoomStatus;
  hostPlayerId: string;
  createdAt: string;
  startedAt: string | null;
  players: Array<{
    id: string;
    nickname: string;
    role: PlayerRole;
    ready: boolean;
    connected: boolean;
    isHost: boolean;
    caught: boolean;
    exposed: boolean;
    liveTracked: boolean;
    position: { lat: number; lng: number; updatedAt: string } | null;
    signalPosition: { lat: number; lng: number; updatedAt: string } | null;
    lastExitPosition: { lat: number; lng: number; updatedAt: string } | null;
    vehicle: {
      state: VehicleState;
      switchKind: VehicleSwitchKind | null;
      startedAt: string | null;
      expiresAt: string | null;
      switchEndsAt: string | null;
      cycle: number;
      overdue: boolean;
    } | null;
  }>;
  meId: string;
  canStart: boolean;
  startBlocker: string | null;
  serverNow: string;
  revision: number;
  game: {
    durationSeconds: number;
    signalEverySeconds: number;
    signalIndex: number;
    lastSignalAt: string | null;
    nextSignalAt: string | null;
    captureGoal: number;
    capturedCount: number;
    winner: "hunter" | "runners" | null;
    nearestOpponentMeters: number | null;
  } | null;
};

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const NICKNAME_PATTERN = /^[\p{L}\p{M}\p{N} ._'’-]+$/u;
const MAX_BODY_BYTES = 4096;
const ONLINE_WINDOW_MS = 20_000;
const RECONNECT_GRACE_MS = 120_000;
const TOUCH_THROTTLE_MS = 7_000;
export const GAME_DURATION_MS = 120 * 60 * 1000;
export const SIGNAL_INTERVAL_MS = 6 * 60 * 1000;
export const CAPTURE_DISTANCE_METERS = 50;
export const VEHICLE_DURATION_MS = 5 * 60 * 1000;
export const LAST_EXIT_VISIBLE_MS = 60 * 1000;
const PREARRANGED_SWITCH_MS = 10 * 1000;
const HITCHHIKE_MIN_MS = 25 * 1000;
const HITCHHIKE_MAX_MS = 45 * 1000;
const ZONE_INTERVAL_MS = 15 * 60 * 1000;
const POSITION_JITTER_METERS = 15;
const MIN_POSITION_INTERVAL_MS = 700;
const MAX_POSITION_AGE_MS = 20_000;

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiProblem) {
    return jsonResponse(
      { error: error.code, code: error.code, message: error.message },
      error.status,
    );
  }

  console.error("Lobby API error", error);
  return jsonResponse(
    {
      error: "SERVER_ERROR",
      code: "SERVER_ERROR",
      message: "A játékszerver átmenetileg nem érhető el.",
    },
    500,
  );
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new ApiProblem(403, "INVALID_ORIGIN", "A kérés forrása nem engedélyezett.");
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new ApiProblem(413, "BODY_TOO_LARGE", "A kérés túl nagy.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiProblem(413, "BODY_TOO_LARGE", "A kérés túl nagy.");
  }

  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ApiProblem(400, "INVALID_JSON", "Érvénytelen kérés.");
  }
}

export function normalizeCode(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!CODE_PATTERN.test(code)) {
    throw new ApiProblem(400, "INVALID_CODE", "Adj meg egy érvényes, 6 karakteres szobakódot.");
  }
  return code;
}

export function normalizeNickname(value: unknown): string {
  const nickname = typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/\s+/g, " ")
    : "";
  const length = Array.from(nickname).length;
  if (length < 2 || length > 20 || !NICKNAME_PATTERN.test(nickname)) {
    throw new ApiProblem(
      400,
      "INVALID_NICKNAME",
      "A becenév 2–20 karakteres lehet, betűkkel és számokkal.",
    );
  }
  return nickname;
}

export function parseRole(value: unknown): PlayerRole {
  if (value !== "hunter" && value !== "runner") {
    throw new ApiProblem(400, "INVALID_ROLE", "Válassz üldöző vagy menekülő szerepet.");
  }
  return value;
}

export function getDatabase(): D1Database {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) {
    throw new ApiProblem(503, "DATABASE_UNAVAILABLE", "A játékszerver adatbázisa nem érhető el.");
  }
  return database;
}

export async function ensureSchema(database: D1Database): Promise<void> {
  // Schema changes are owned by generated migrations, never runtime DDL.
  await database.prepare("SELECT city_id FROM rooms LIMIT 0").all();
}

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte & 31]).join("");
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique/i.test(message);
}

async function pruneStaleLobbyPlayers(
  database: D1Database,
  code: string,
  now: number,
): Promise<void> {
  const cutoff = now - RECONNECT_GRACE_MS;
  await database.batch([
    database.prepare(
      `UPDATE rooms
       SET status = 'finished', updated_at = ?, revision = revision + 1
       WHERE code = ? AND status = 'lobby'
         AND EXISTS (
           SELECT 1 FROM room_players p
           WHERE p.id = rooms.host_player_id
             AND p.left_at IS NULL
             AND p.last_seen_at < ?
         )`,
    ).bind(now, code, cutoff),
    database.prepare(
      `UPDATE room_players
       SET left_at = ?, ready = 0
       WHERE room_code = ? AND left_at IS NULL
         AND id <> (SELECT host_player_id FROM rooms WHERE code = ?)
         AND last_seen_at < ?
         AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status = 'lobby')`,
    ).bind(now, code, code, cutoff, code),
  ]);
}

export async function createRoom(
  database: D1Database,
  nickname: string,
  role: PlayerRole,
  cityId: unknown = DEFAULT_CITY_ID,
): Promise<{ session: { roomCode: string; playerId: string; token: string }; room: RoomSnapshot }> {
  const city = getCity(cityId);
  if (!city) throw new ApiProblem(400, "INVALID_CITY", "Válassz várost a listából.");
  const playerId = crypto.randomUUID();
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateCode();
    try {
      await database.batch([
        database.prepare(
          `INSERT INTO rooms (code, status, host_player_id, created_at, updated_at, city_id)
           VALUES (?, 'lobby', ?, ?, ?, ?)`,
        ).bind(code, playerId, now, now, city.id),
        database.prepare(
          `INSERT INTO room_players
             (id, room_code, token_hash, nickname, role, joined_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(playerId, code, tokenHash, nickname, role, now, now),
      ]);
      return {
        session: { roomCode: code, playerId, token },
        room: await getRoomSnapshot(database, code, playerId, now),
      };
    } catch (error) {
      if (isConstraintError(error)) continue;
      throw error;
    }
  }

  throw new ApiProblem(503, "CODE_EXHAUSTED", "Most nem sikerült szobakódot létrehozni. Próbáld újra.");
}

export async function joinRoom(
  database: D1Database,
  code: string,
  nickname: string,
  role: PlayerRole,
): Promise<{ session: { roomCode: string; playerId: string; token: string }; room: RoomSnapshot }> {
  const now = Date.now();
  await pruneStaleLobbyPlayers(database, code, now);

  const playerId = crypto.randomUUID();
  const token = generateToken();
  const tokenHash = await hashToken(token);
  let result: D1Result;
  try {
    result = await database.prepare(
      `INSERT INTO room_players
         (id, room_code, token_hash, nickname, role, joined_at, last_seen_at)
       SELECT ?, r.code, ?, ?, ?, ?, ?
       FROM rooms r
       WHERE r.code = ? AND r.status = 'lobby'
         AND NOT EXISTS (
           SELECT 1 FROM room_players n
           WHERE n.room_code = r.code AND n.left_at IS NULL
             AND n.nickname = ? COLLATE NOCASE
         )
         AND (
           (? = 'hunter' AND NOT EXISTS (
             SELECT 1 FROM room_players h
             WHERE h.room_code = r.code AND h.left_at IS NULL AND h.role = 'hunter'
           ))
           OR
           (? = 'runner' AND (
             SELECT COUNT(*) FROM room_players f
             WHERE f.room_code = r.code AND f.left_at IS NULL AND f.role = 'runner'
           ) < 10)
         )`,
    ).bind(
      playerId,
      tokenHash,
      nickname,
      role,
      now,
      now,
      code,
      nickname,
      role,
      role,
    ).run();
  } catch (error) {
    if (isConstraintError(error)) {
      throw roleFullProblem(role);
    }
    throw error;
  }

  if ((result.meta.changes ?? 0) !== 1) {
    await throwJoinProblem(database, code, nickname, role);
  }

  await database.prepare("UPDATE rooms SET updated_at = ?, revision = revision + 1 WHERE code = ?").bind(now, code).run();
  return {
    session: { roomCode: code, playerId, token },
    room: await getRoomSnapshot(database, code, playerId, now),
  };
}

async function throwJoinProblem(
  database: D1Database,
  code: string,
  nickname: string,
  role: PlayerRole,
): Promise<never> {
  const room = await database.prepare("SELECT status FROM rooms WHERE code = ?").bind(code).first<{ status: RoomStatus }>();
  if (!room) throw new ApiProblem(404, "ROOM_NOT_FOUND", "Nincs ilyen játékszoba.");
  if (room.status !== "lobby") {
    throw new ApiProblem(409, "GAME_STARTED", "Ez a játék már elindult vagy befejeződött.");
  }

  const duplicate = await database.prepare(
    `SELECT 1 AS found FROM room_players
     WHERE room_code = ? AND left_at IS NULL AND nickname = ? COLLATE NOCASE
     LIMIT 1`,
  ).bind(code, nickname).first();
  if (duplicate) throw new ApiProblem(409, "NICKNAME_TAKEN", "Ez a becenév már foglalt a szobában.");

  const count = await database.prepare(
    "SELECT COUNT(*) AS total FROM room_players WHERE room_code = ? AND left_at IS NULL AND role = ?",
  ).bind(code, role).first<{ total: number }>();
  if ((role === "hunter" && Number(count?.total ?? 0) >= 1) || Number(count?.total ?? 0) >= 10) {
    throw roleFullProblem(role);
  }
  throw new ApiProblem(409, "JOIN_CONFLICT", "A belépés ütközött egy másik játékoséval. Próbáld újra.");
}

function bearerToken(request: Request): string {
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new ApiProblem(401, "INVALID_TOKEN", "Hiányzó vagy érvénytelen játékoskapcsolat.");
  return match[1];
}

export async function requireSession(
  database: D1Database,
  request: Request,
  code: string,
): Promise<SessionRow> {
  const tokenHash = await hashToken(bearerToken(request));
  const row = await database.prepare(
    `SELECT p.id, p.room_code, p.role, r.host_player_id
     FROM room_players p
     JOIN rooms r ON r.code = p.room_code
     WHERE p.room_code = ? AND p.token_hash = ? AND p.left_at IS NULL
     LIMIT 1`,
  ).bind(code, tokenHash).first<{
    id: string;
    room_code: string;
    role: PlayerRole;
    host_player_id: string;
  }>();
  if (!row) throw new ApiProblem(401, "INVALID_TOKEN", "A játékoskapcsolat lejárt vagy érvénytelen.");
  return {
    playerId: row.id,
    roomCode: row.room_code,
    role: row.role,
    isHost: row.id === row.host_player_id,
  };
}

export async function touchSession(
  database: D1Database,
  session: SessionRow,
  now: number,
  force = false,
): Promise<void> {
  await database.prepare(
    `UPDATE room_players SET last_seen_at = ?
     WHERE id = ? AND room_code = ? AND left_at IS NULL
       AND (? = 1 OR last_seen_at <= ?)`,
  ).bind(now, session.playerId, session.roomCode, force ? 1 : 0, now - TOUCH_THROTTLE_MS).run();
}

export async function setReady(
  database: D1Database,
  session: SessionRow,
  ready: boolean,
  now: number,
): Promise<void> {
  const result = await database.prepare(
    `UPDATE room_players
     SET ready = ?, last_seen_at = ?
     WHERE id = ? AND room_code = ? AND left_at IS NULL
       AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status = 'lobby')`,
  ).bind(ready ? 1 : 0, now, session.playerId, session.roomCode, session.roomCode).run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ApiProblem(409, "ROOM_NOT_LOBBY", "A készültség csak a váróban módosítható.");
  }
  await markRoomUpdated(database, session.roomCode, now);
}

export async function setRole(
  database: D1Database,
  session: SessionRow,
  role: PlayerRole,
  now: number,
): Promise<void> {
  await touchSession(database, session, now, true);
  await pruneStaleLobbyPlayers(database, session.roomCode, now);
  let result: D1Result;
  try {
    result = await database.prepare(
      `UPDATE room_players AS current
       SET role = ?, ready = 0, last_seen_at = ?
       WHERE current.id = ? AND current.room_code = ? AND current.left_at IS NULL
         AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status = 'lobby')
         AND (
           (? = 'hunter' AND (
             current.role = 'hunter' OR NOT EXISTS (
               SELECT 1 FROM room_players h
               WHERE h.room_code = current.room_code AND h.left_at IS NULL
                 AND h.role = 'hunter' AND h.id <> current.id
             )
           ))
           OR
           (? = 'runner' AND (
             current.role = 'runner' OR (
               SELECT COUNT(*) FROM room_players f
               WHERE f.room_code = current.room_code AND f.left_at IS NULL
                 AND f.role = 'runner' AND f.id <> current.id
             ) < 10
           ))
         )`,
    ).bind(role, now, session.playerId, session.roomCode, session.roomCode, role, role).run();
  } catch (error) {
    if (isConstraintError(error)) throw roleFullProblem(role);
    throw error;
  }
  if ((result.meta.changes ?? 0) !== 1) {
    const room = await database.prepare("SELECT status FROM rooms WHERE code = ?").bind(session.roomCode).first<{ status: RoomStatus }>();
    if (!room || room.status !== "lobby") {
      throw new ApiProblem(409, "ROOM_NOT_LOBBY", "A szerep csak a váróban módosítható.");
    }
    throw roleFullProblem(role);
  }
  await markRoomUpdated(database, session.roomCode, now);
}

export async function startRoom(
  database: D1Database,
  session: SessionRow,
  now: number,
): Promise<void> {
  if (!session.isHost) throw new ApiProblem(403, "NOT_HOST", "Csak a házigazda indíthatja el a játékot.");
  await touchSession(database, session, now, true);
  await pruneStaleLobbyPlayers(database, session.roomCode, now);
  const beforeStart = await getRoomSnapshot(database, session.roomCode, session.playerId, now);
  if (beforeStart.status === "playing") return;
  if (!beforeStart.canStart) throw new ApiProblem(409, "NOT_READY", beforeStart.startBlocker ?? "A játék még nem indítható.");
  let starts;
  try {
    starts = await roadStarts(beforeStart.cityId);
  } catch {
    throw new ApiProblem(503, "ROAD_UNAVAILABLE", "A közúti kezdőpontok most nem tölthetők be. A szoba megmaradt, próbáld újra az indítást.");
  }
  now = Date.now();
  const result = await database.prepare(
    `UPDATE rooms
     SET status = 'playing', started_at = ?, updated_at = ?, signal_index = 0,
         capture_goal = MIN(4, (SELECT COUNT(*) FROM room_players p
           WHERE p.room_code = rooms.code AND p.left_at IS NULL AND p.role = 'runner')),
         revision = revision + 1
     WHERE code = ? AND status = 'lobby' AND host_player_id = ?
       AND (SELECT COUNT(*) FROM room_players p
            WHERE p.room_code = rooms.code AND p.left_at IS NULL AND p.role = 'hunter') = 1
       AND (SELECT COUNT(*) FROM room_players p
            WHERE p.room_code = rooms.code AND p.left_at IS NULL AND p.role = 'runner') BETWEEN 1 AND 10
       AND NOT EXISTS (
         SELECT 1 FROM room_players p
         WHERE p.room_code = rooms.code AND p.left_at IS NULL
           AND (p.ready = 0 OR p.last_seen_at < ?)
       )`,
  ).bind(now, now, session.roomCode, session.playerId, now - ONLINE_WINDOW_MS).run();
  if ((result.meta.changes ?? 0) !== 1) {
    const snapshot = await getRoomSnapshot(database, session.roomCode, session.playerId, now);
    if (snapshot.status === "playing") return;
    throw new ApiProblem(409, "NOT_READY", snapshot.startBlocker ?? "A játék még nem indítható.");
  }

  const activePlayers = await database.prepare(
    `SELECT id, role FROM room_players
     WHERE room_code = ? AND left_at IS NULL
     ORDER BY joined_at ASC, id ASC`,
  ).bind(session.roomCode).all<{ id: string; role: PlayerRole }>();
  let runnerIndex = 0;
  const positionStatements = activePlayers.results.map((player) => {
    const start = player.role === "hunter"
      ? starts[0]
      : starts[1 + Math.min(runnerIndex++, 9)];
    return database.prepare(
      `UPDATE room_players
       SET lat = ?, lng = ?, signal_lat = NULL, signal_lng = NULL,
           position_updated_at = ?, last_seen_at = ?, caught = 0,
           vehicle_started_at = CASE WHEN role = 'runner' THEN ? ELSE NULL END,
           switch_ends_at = NULL, vehicle_cycle = 0,
           vehicle_state = CASE WHEN role = 'runner' THEN 'driving' ELSE 'dismounted' END,
           switch_kind = NULL, last_exit_lat = NULL, last_exit_lng = NULL, last_exit_at = NULL
       WHERE id = ? AND room_code = ? AND left_at IS NULL`,
    ).bind(start.lat, start.lng, now, now, now, player.id, session.roomCode);
  });
  if (positionStatements.length) await database.batch(positionStatements);
}

export async function leaveRoom(
  database: D1Database,
  session: SessionRow,
  now: number,
): Promise<void> {
  if (session.isHost) {
    await database.batch([
      database.prepare(
        "UPDATE room_players SET left_at = ?, ready = 0 WHERE id = ? AND room_code = ? AND left_at IS NULL",
      ).bind(now, session.playerId, session.roomCode),
      database.prepare(
        "UPDATE rooms SET status = 'finished', updated_at = ?, revision = revision + 1 WHERE code = ?",
      ).bind(now, session.roomCode),
    ]);
    return;
  }
  await database.prepare(
    "UPDATE room_players SET left_at = ?, ready = 0 WHERE id = ? AND room_code = ? AND left_at IS NULL",
  ).bind(now, session.playerId, session.roomCode).run();
  await markRoomUpdated(database, session.roomCode, now);
}

async function markRoomUpdated(database: D1Database, code: string, now: number): Promise<void> {
  await database.prepare("UPDATE rooms SET updated_at = ?, revision = revision + 1 WHERE code = ?").bind(now, code).run();
}

function roleFullProblem(role: PlayerRole): ApiProblem {
  return role === "hunter"
    ? new ApiProblem(409, "HUNTER_TAKEN", "Az üldözői helyet már elfoglalta valaki.")
    : new ApiProblem(409, "RUNNER_SLOTS_FULL", "Mind a tíz menekülői hely foglalt.");
}

function distanceMeters(
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
): number {
  const radius = 6_371_000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const latDelta = toRadians(second.lat - first.lat);
  const lngDelta = toRadians(second.lng - first.lng);
  const firstLat = toRadians(first.lat);
  const secondLat = toRadians(second.lat);
  const haversine = Math.sin(latDelta / 2) ** 2
    + Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lngDelta / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function validPosition(lat: unknown, lng: unknown): { lat: number; lng: number } {
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiProblem(400, "INVALID_POSITION", "Érvénytelen térképpozíció.");
  }
  if (
    lat < GAME_BOUNDS.south || lat > GAME_BOUNDS.north
    || lng < GAME_BOUNDS.west || lng > GAME_BOUNDS.east
  ) {
    throw new ApiProblem(400, "OUTSIDE_GAME_AREA", "A kijelölt magyarországi és romániai játéktéren belül maradj.");
  }
  return { lat, lng };
}

export async function syncRoomGame(
  database: D1Database,
  code: string,
  now = Date.now(),
): Promise<void> {
  const room = await database.prepare(
    "SELECT status, started_at, signal_index FROM rooms WHERE code = ?",
  ).bind(code).first<{ status: RoomStatus; started_at: number | null; signal_index: number }>();
  if (!room || room.status !== "playing" || room.started_at === null) return;

  const completedSwitches = await database.prepare(
    `UPDATE room_players
     SET vehicle_state = 'driving', vehicle_started_at = switch_ends_at,
         switch_ends_at = NULL, switch_kind = NULL, vehicle_cycle = vehicle_cycle + 1
     WHERE room_code = ? AND left_at IS NULL AND role = 'runner' AND caught = 0
       AND vehicle_state = 'switching' AND switch_ends_at IS NOT NULL AND switch_ends_at <= ?`,
  ).bind(code, now).run();
  if ((completedSwitches.meta.changes ?? 0) > 0) {
    await markRoomUpdated(database, code, now);
  }

  if (now >= room.started_at + GAME_DURATION_MS) {
    await database.prepare(
      `UPDATE rooms SET status = 'finished', updated_at = ?, revision = revision + 1
       WHERE code = ? AND status = 'playing'`,
    ).bind(now, code).run();
    return;
  }

  const dueSignalIndex = Math.floor(Math.max(0, now - room.started_at) / SIGNAL_INTERVAL_MS);
  if (dueSignalIndex <= room.signal_index) return;

  await database.batch([
    database.prepare(
      `UPDATE room_players
       SET signal_lat = lat, signal_lng = lng
       WHERE room_code = ? AND left_at IS NULL AND role = 'runner' AND caught = 0
         AND lat IS NOT NULL AND lng IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM rooms
           WHERE code = ? AND status = 'playing' AND signal_index < ?
         )`,
    ).bind(code, code, dueSignalIndex),
    database.prepare(
      `UPDATE rooms
       SET signal_index = ?, updated_at = ?, revision = revision + 1
       WHERE code = ? AND status = 'playing' AND signal_index < ?`,
    ).bind(dueSignalIndex, now, code, dueSignalIndex),
  ]);
}

function parseVehicleSwitchKind(value: unknown): VehicleSwitchKind {
  if (value !== "prearranged" && value !== "hitchhike") {
    throw new ApiProblem(400, "INVALID_SWITCH_KIND", "Válassz előre egyeztetett autót vagy stoppolást.");
  }
  return value;
}

export async function exitVehicle(
  database: D1Database,
  session: SessionRow,
  now = Date.now(),
): Promise<void> {
  await syncRoomGame(database, session.roomCode, now);
  const player = await database.prepare(
    `SELECT p.role, p.caught, p.lat, p.lng, p.vehicle_state, r.status
     FROM room_players p JOIN rooms r ON r.code = p.room_code
     WHERE p.id = ? AND p.room_code = ? AND p.left_at IS NULL`,
  ).bind(session.playerId, session.roomCode).first<{
    role: PlayerRole;
    caught: number;
    lat: number | null;
    lng: number | null;
    vehicle_state: VehicleState;
    status: RoomStatus;
  }>();
  if (!player || player.status !== "playing") {
    throw new ApiProblem(409, "GAME_NOT_RUNNING", "Autót csak futó játékban válthatsz.");
  }
  if (player.role !== "runner") throw new ApiProblem(403, "RUNNER_ONLY", "Az üldöző nem cserél autót.");
  if (player.caught) throw new ApiProblem(409, "PLAYER_CAUGHT", "Az elfogott játékos nem válthat autót.");
  if (player.vehicle_state !== "driving") throw new ApiProblem(409, "NOT_DRIVING", "Már kiszálltál az autóból.");
  if (player.lat === null || player.lng === null) throw new ApiProblem(409, "POSITION_MISSING", "A kiszálláshoz nincs érvényes helyzeted.");

  const result = await database.prepare(
    `UPDATE room_players
     SET vehicle_state = 'dismounted', vehicle_started_at = NULL,
         switch_ends_at = NULL, switch_kind = NULL,
         last_exit_lat = lat, last_exit_lng = lng, last_exit_at = ?, last_seen_at = ?
     WHERE id = ? AND room_code = ? AND left_at IS NULL AND caught = 0
       AND role = 'runner' AND vehicle_state = 'driving'`,
  ).bind(now, now, session.playerId, session.roomCode).run();
  if ((result.meta.changes ?? 0) !== 1) throw new ApiProblem(409, "VEHICLE_CONFLICT", "Az autó állapota közben megváltozott.");
  await markRoomUpdated(database, session.roomCode, now);
}

export async function startVehicleSwitch(
  database: D1Database,
  session: SessionRow,
  rawKind: unknown,
  now = Date.now(),
): Promise<void> {
  const kind = parseVehicleSwitchKind(rawKind);
  await syncRoomGame(database, session.roomCode, now);
  const randomRange = HITCHHIKE_MAX_MS - HITCHHIKE_MIN_MS + 1;
  const hitchhikeDelay = HITCHHIKE_MIN_MS + crypto.getRandomValues(new Uint32Array(1))[0] % randomRange;
  const switchEndsAt = now + (kind === "prearranged" ? PREARRANGED_SWITCH_MS : hitchhikeDelay);
  const result = await database.prepare(
    `UPDATE room_players
     SET vehicle_state = 'switching', switch_kind = ?, switch_ends_at = ?, last_seen_at = ?
     WHERE id = ? AND room_code = ? AND left_at IS NULL AND caught = 0
       AND role = 'runner' AND vehicle_state = 'dismounted'
       AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status = 'playing')`,
  ).bind(kind, switchEndsAt, now, session.playerId, session.roomCode, session.roomCode).run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ApiProblem(409, "SWITCH_NOT_AVAILABLE", "Előbb állj meg és szállj ki az autóból.");
  }
  await markRoomUpdated(database, session.roomCode, now);
}

export async function updatePlayerPosition(
  database: D1Database,
  session: SessionRow,
  rawLat: unknown,
  rawLng: unknown,
  now = Date.now(),
): Promise<void> {
  const next = validPosition(rawLat, rawLng);
  // A határpillanat jelét még a következő mozgás beírása előtt rögzítjük.
  await syncRoomGame(database, session.roomCode, now);
  const current = await database.prepare(
    `SELECT p.id, p.role, p.caught, p.lat, p.lng, p.position_updated_at,
            p.vehicle_state, r.status
     FROM room_players p JOIN rooms r ON r.code = p.room_code
     WHERE p.id = ? AND p.room_code = ? AND p.left_at IS NULL`,
  ).bind(session.playerId, session.roomCode).first<{
    id: string;
    role: PlayerRole;
    caught: number;
    lat: number | null;
    lng: number | null;
    position_updated_at: number | null;
    vehicle_state: VehicleState;
    status: RoomStatus;
  }>();
  if (!current || current.status !== "playing") {
    throw new ApiProblem(409, "GAME_NOT_RUNNING", "A közös térkép csak futó játékban mozgatható.");
  }
  if (current.caught) throw new ApiProblem(409, "PLAYER_CAUGHT", "Az elfogott játékos már nem mozoghat.");
  if (current.role === "runner" && current.vehicle_state !== "driving") {
    throw new ApiProblem(409, "VEHICLE_IMMOBILE", "Kiszállás és autóváltás közben nem mozoghatsz.");
  }

  if (current.lat !== null && current.lng !== null && current.position_updated_at !== null) {
    const elapsedMs = Math.max(0, now - current.position_updated_at);
    if (elapsedMs < MIN_POSITION_INTERVAL_MS) {
      throw new ApiProblem(429, "POSITION_RATE_LIMIT", "A pozíció túl gyorsan frissül. Várj egy pillanatot.");
    }
    const elapsedSeconds = elapsedMs / 1000;
    const speedLimit = current.role === "hunter" ? 34 : 30;
    const allowedMeters = POSITION_JITTER_METERS + speedLimit * Math.min(elapsedSeconds, 30);
    const travelledMeters = distanceMeters(
      { lat: current.lat, lng: current.lng },
      next,
    );
    if (travelledMeters > allowedMeters) {
      throw new ApiProblem(409, "MOVEMENT_TOO_FAST", "Túl nagy ugrást érzékeltünk; válassz közelebbi útpontot.");
    }
  }

  const update = await database.prepare(
    `UPDATE room_players
     SET lat = ?, lng = ?, position_updated_at = ?, last_seen_at = ?
     WHERE id = ? AND room_code = ? AND left_at IS NULL AND caught = 0
       AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status = 'playing')`,
  ).bind(next.lat, next.lng, now, now, session.playerId, session.roomCode, session.roomCode).run();
  if ((update.meta.changes ?? 0) !== 1) {
    throw new ApiProblem(409, "POSITION_CONFLICT", "A játékállapot közben megváltozott. Frissítsd a térképet.");
  }
  await markRoomUpdated(database, session.roomCode, now);
  await resolveCaptures(database, session, now);
}

async function resolveCaptures(
  database: D1Database,
  session: SessionRow,
  now: number,
): Promise<void> {
  const mover = await database.prepare(
    `SELECT id, role, caught, lat, lng FROM room_players
     WHERE id = ? AND room_code = ? AND left_at IS NULL`,
  ).bind(session.playerId, session.roomCode).first<{
    id: string;
    role: PlayerRole;
    caught: number;
    lat: number | null;
    lng: number | null;
  }>();
  if (!mover || mover.lat === null || mover.lng === null) return;

  const opponents = await database.prepare(
    `SELECT id, role, caught, lat, lng, last_seen_at FROM room_players
     WHERE room_code = ? AND left_at IS NULL AND role <> ? AND caught = 0
       AND lat IS NOT NULL AND lng IS NOT NULL AND last_seen_at >= ?`,
  ).bind(session.roomCode, mover.role, now - MAX_POSITION_AGE_MS).all<{
    id: string;
    role: PlayerRole;
    caught: number;
    lat: number;
    lng: number;
    last_seen_at: number;
  }>();

  const moverPosition = { lat: mover.lat, lng: mover.lng };
  const runnerIds = opponents.results
    .filter((opponent) => distanceMeters(moverPosition, opponent) <= CAPTURE_DISTANCE_METERS)
    .map((opponent) => mover.role === "runner" ? mover.id : opponent.id);
  const uniqueRunnerIds = [...new Set(runnerIds)];
  if (!uniqueRunnerIds.length) return;

  const captureResults = await database.batch(uniqueRunnerIds.map((runnerId) => database.prepare(
    `UPDATE room_players SET caught = 1
     WHERE id = ? AND room_code = ? AND role = 'runner' AND caught = 0 AND left_at IS NULL`,
  ).bind(runnerId, session.roomCode))) as D1Result[];
  if (!captureResults.some((result) => (result.meta.changes ?? 0) > 0)) return;

  const score = await database.prepare(
    `SELECT r.capture_goal,
       (SELECT COUNT(*) FROM room_players p
        WHERE p.room_code = r.code AND p.role = 'runner' AND p.caught = 1) AS captured_count
     FROM rooms r WHERE r.code = ?`,
  ).bind(session.roomCode).first<{ capture_goal: number; captured_count: number }>();
  const hunterWon = Number(score?.captured_count ?? 0) >= Number(score?.capture_goal ?? 1);
  await database.prepare(
    `UPDATE rooms
     SET status = CASE WHEN ? = 1 THEN 'finished' ELSE status END,
         updated_at = ?, revision = revision + 1
     WHERE code = ? AND status = 'playing'`,
  ).bind(hunterWon ? 1 : 0, now, session.roomCode).run();
}

export async function getRoomSnapshot(
  database: D1Database,
  code: string,
  meId: string,
  now = Date.now(),
): Promise<RoomSnapshot> {
  await syncRoomGame(database, code, now);
  const [room, playerResult] = await Promise.all([
    database.prepare(
      `SELECT code, status, host_player_id, created_at, started_at, updated_at,
              revision, signal_index, capture_goal, city_id
       FROM rooms WHERE code = ?`,
    ).bind(code).first<RoomRow>(),
    database.prepare(
      `SELECT id, nickname, role, ready, caught, joined_at, last_seen_at,
              lat, lng, signal_lat, signal_lng, position_updated_at,
              vehicle_started_at, switch_ends_at, vehicle_cycle, vehicle_state, switch_kind,
              last_exit_lat, last_exit_lng, last_exit_at
       FROM room_players
       WHERE room_code = ? AND left_at IS NULL
       ORDER BY joined_at ASC, id ASC`,
    ).bind(code).all<PlayerRow>(),
  ]);
  if (!room) throw new ApiProblem(404, "ROOM_NOT_FOUND", "Nincs ilyen játékszoba.");

  const me = playerResult.results.find((player) => player.id === meId);
  const lastSignalAtMs = room.started_at !== null && room.signal_index > 0
    ? room.started_at + room.signal_index * SIGNAL_INTERVAL_MS
    : null;
  const GAME_ZONES = getCityZones(room.city_id);
  const zoneIndex = room.started_at === null
    ? 0
    : Math.min(GAME_ZONES.length - 1, Math.floor(Math.max(0, now - room.started_at) / ZONE_INTERVAL_MS));
  const activeZone = GAME_ZONES[zoneIndex];
  const playerIsExposed = (player: PlayerRow) => (
    room.status === "playing"
    && player.role === "runner"
    && !player.caught
    && player.lat !== null
    && player.lng !== null
    && distanceMeters({ lat: player.lat, lng: player.lng }, activeZone) > activeZone.radius
  );
  const players = playerResult.results.map((player) => {
    const exposed = playerIsExposed(player);
    const vehicleOverdue = room.status === "playing"
      && player.role === "runner"
      && player.vehicle_state === "driving"
      && player.vehicle_started_at !== null
      && now >= player.vehicle_started_at + VEHICLE_DURATION_MS;
    const liveTracked = exposed || vehicleOverdue;
    const exactPositionVisible = player.id === meId || (me?.role === "hunter" && liveTracked);
    const vehicleVisible = player.id === meId && player.role === "runner";
    const lastExitVisible = me?.role === "hunter"
      && player.role === "runner"
      && !player.caught
      && player.last_exit_lat !== null
      && player.last_exit_lng !== null
      && player.last_exit_at !== null
      && now < player.last_exit_at + LAST_EXIT_VISIBLE_MS;
    return {
    id: player.id,
    nickname: player.nickname,
    role: player.role,
    ready: Boolean(player.ready),
    connected: player.last_seen_at >= now - ONLINE_WINDOW_MS,
    isHost: player.id === room.host_player_id,
    caught: Boolean(player.caught),
    exposed,
    liveTracked,
    position: exactPositionVisible && player.lat !== null && player.lng !== null
      ? {
          lat: player.lat,
          lng: player.lng,
          updatedAt: new Date(player.position_updated_at ?? player.last_seen_at).toISOString(),
        }
      : null,
    signalPosition: (
      (me?.role === "hunter" && player.role === "runner")
      || (player.id === meId && player.role === "runner")
    ) && !player.caught && player.signal_lat !== null && player.signal_lng !== null && lastSignalAtMs !== null
      ? {
          lat: player.signal_lat,
          lng: player.signal_lng,
          updatedAt: new Date(lastSignalAtMs).toISOString(),
        }
      : null,
    lastExitPosition: lastExitVisible
      ? {
          lat: player.last_exit_lat as number,
          lng: player.last_exit_lng as number,
          updatedAt: new Date(player.last_exit_at as number).toISOString(),
        }
      : null,
    vehicle: vehicleVisible
      ? {
          state: player.vehicle_state,
          switchKind: player.switch_kind,
          startedAt: player.vehicle_started_at === null ? null : new Date(player.vehicle_started_at).toISOString(),
          expiresAt: player.vehicle_started_at === null ? null : new Date(player.vehicle_started_at + VEHICLE_DURATION_MS).toISOString(),
          switchEndsAt: player.switch_ends_at === null ? null : new Date(player.switch_ends_at).toISOString(),
          cycle: player.vehicle_cycle,
          overdue: vehicleOverdue,
        }
      : null,
    };
  });
  const startBlocker = getStartBlocker(room, players, meId);
  const capturedCount = playerResult.results.filter(
    (player) => player.role === "runner" && Boolean(player.caught),
  ).length;
  let nearestOpponentMeters: number | null = null;
  if (me && me.lat !== null && me.lng !== null && !me.caught) {
    const mePosition = { lat: me.lat, lng: me.lng };
    const distances = playerResult.results
      .filter((player) => (
        player.id !== me.id
        && player.role !== me.role
        && !player.caught
        && player.lat !== null
        && player.lng !== null
        && player.last_seen_at >= now - ONLINE_WINDOW_MS
      ))
      .map((player) => distanceMeters(mePosition, { lat: player.lat as number, lng: player.lng as number }));
    if (distances.length) nearestOpponentMeters = Math.round(Math.min(...distances));
  }
  const winner = room.status === "finished" && room.started_at !== null
    ? (capturedCount >= room.capture_goal ? "hunter" : "runners")
    : null;
  const nextSignalAtMs = room.status === "playing" && room.started_at !== null
    ? room.started_at + (room.signal_index + 1) * SIGNAL_INTERVAL_MS
    : null;

  return {
    code: room.code,
    cityId: room.city_id,
    status: room.status,
    hostPlayerId: room.host_player_id,
    createdAt: new Date(room.created_at).toISOString(),
    startedAt: room.started_at === null ? null : new Date(room.started_at).toISOString(),
    players,
    meId,
    canStart: startBlocker === null,
    startBlocker,
    serverNow: new Date(now).toISOString(),
    revision: room.revision,
    game: room.started_at === null ? null : {
      durationSeconds: GAME_DURATION_MS / 1000,
      signalEverySeconds: SIGNAL_INTERVAL_MS / 1000,
      signalIndex: room.signal_index,
      lastSignalAt: lastSignalAtMs === null ? null : new Date(lastSignalAtMs).toISOString(),
      nextSignalAt: nextSignalAtMs === null ? null : new Date(nextSignalAtMs).toISOString(),
      captureGoal: room.capture_goal,
      capturedCount,
      winner,
      nearestOpponentMeters,
    },
  };
}

function getStartBlocker(
  room: RoomRow,
  players: RoomSnapshot["players"],
  meId: string,
): string | null {
  if (room.status !== "lobby") return room.status === "playing" ? "A játék már elindult." : "A játék befejeződött.";
  if (room.host_player_id !== meId) return "Csak a házigazda indíthatja el a játékot.";
  if (players.filter((player) => player.role === "hunter").length !== 1) return "A kezdéshez pontosan egy üldöző kell.";
  if (!players.some((player) => player.role === "runner")) return "A kezdéshez legalább egy menekülő kell.";
  if (players.some((player) => !player.connected)) return "Minden játékosnak online kell lennie.";
  if (players.some((player) => !player.ready)) return "Még nem minden játékos áll készen.";
  return null;
}

