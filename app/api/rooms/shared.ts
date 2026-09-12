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
  civilian_index: number;
  next_civilian_at: number | null;
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
  civilian_lat: number | null;
  civilian_lng: number | null;
  civilian_accuracy: "confirmed" | "uncertain" | "misleading" | null;
  civilian_reported_at: number | null;
  position_updated_at: number | null;
  vehicle_started_at: number | null;
  switch_ends_at: number | null;
  vehicle_cycle: number;
  vehicle_state: VehicleState;
  switch_kind: VehicleSwitchKind | null;
  last_exit_lat: number | null;
  last_exit_lng: number | null;
  last_exit_at: number | null;
  handoff_lat: number | null;
  handoff_lng: number | null;
  handoff_selected_at: number | null;
  handoff_cars: string;
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
    civilianReport: {
      lat: number;
      lng: number;
      updatedAt: string;
      accuracy: "confirmed" | "uncertain" | "misleading";
    } | null;
    lastExitPosition: { lat: number; lng: number; updatedAt: string } | null;
    vehicle: {
      state: VehicleState;
      switchKind: VehicleSwitchKind | null;
      startedAt: string | null;
      expiresAt: string | null;
      switchEndsAt: string | null;
      cycle: number;
      overdue: boolean;
      handoffPoint: { lat: number; lng: number; updatedAt: string } | null;
      handoffCars: Array<{ id: string; lat: number; lng: number; updatedAt: string }>;
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
    opponentSignalIndex: number;
    opponentSignalEverySeconds: number;
    civilianReportIndex: number;
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
export const RUNNER_SIGNAL_INTERVAL_MS = 2.5 * 60 * 1000;
export const HUNTER_SIGNAL_INTERVAL_MS = 10 * 60 * 1000;
export const CIVILIAN_REPORT_MIN_MS = 30 * 1000;
export const CIVILIAN_REPORT_MAX_MS = 60 * 1000;
export const CAPTURE_DISTANCE_METERS = 50;
export const VEHICLE_DURATION_MS = 5 * 60 * 1000;
export const LAST_EXIT_VISIBLE_MS = 60 * 1000;
const PREARRANGED_SWITCH_MS = 10 * 1000;
const HITCHHIKE_MIN_MS = 25 * 1000;
const HITCHHIKE_MAX_MS = 45 * 1000;
const HANDOFF_DISTANCE_METERS = 75;
const ZONE_INTERVAL_MS = 15 * 60 * 1000;
const POSITION_JITTER_METERS = 15;
const MIN_POSITION_INTERVAL_MS = 700;
const MAX_POSITION_AGE_MS = 20_000;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function civilianReportDelay(code: string, index: number): number {
  const spread = CIVILIAN_REPORT_MAX_MS - CIVILIAN_REPORT_MIN_MS;
  return CIVILIAN_REPORT_MIN_MS + stableHash(`${code}:civilian-delay:${index}`) % (spread + 1);
}

function civilianAccuracy(code: string, index: number, role: PlayerRole): "confirmed" | "uncertain" | "misleading" {
  const roll = stableHash(`${code}:civilian-accuracy:${index}:${role}`) % 100;
  if (roll < 48) return "confirmed";
  if (roll < 78) return "uncertain";
  return "misleading";
}

function civilianReportPoint(
  code: string,
  index: number,
  role: PlayerRole,
  position: { lat: number; lng: number },
  accuracy: "confirmed" | "uncertain" | "misleading",
): { lat: number; lng: number } {
  const angle = (stableHash(`${code}:civilian-angle:${index}:${role}`) % 360) * Math.PI / 180;
  const base = stableHash(`${code}:civilian-radius:${index}:${role}`) / 0xffffffff;
  const meters = accuracy === "confirmed"
    ? 35 + base * 90
    : accuracy === "uncertain"
      ? 180 + base * 420
      : 900 + base * 1_400;
  const lat = position.lat + Math.sin(angle) * meters / 111_320;
  const lng = position.lng + Math.cos(angle) * meters / (111_320 * Math.cos(position.lat * Math.PI / 180));
  return {
    lat: Math.max(GAME_BOUNDS.south, Math.min(GAME_BOUNDS.north, lat)),
    lng: Math.max(GAME_BOUNDS.west, Math.min(GAME_BOUNDS.east, lng)),
  };
}

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
         civilian_index = 0, next_civilian_at = ?,
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
  ).bind(
    now,
    now,
    now + civilianReportDelay(session.roomCode, 1),
    session.roomCode,
    session.playerId,
    now - ONLINE_WINDOW_MS,
  ).run();
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
           civilian_lat = NULL, civilian_lng = NULL,
           civilian_accuracy = NULL, civilian_reported_at = NULL,
           position_updated_at = ?, last_seen_at = ?, caught = 0,
           vehicle_started_at = CASE WHEN role = 'runner' THEN ? ELSE NULL END,
           switch_ends_at = NULL, vehicle_cycle = 0,
           vehicle_state = CASE WHEN role = 'runner' THEN 'driving' ELSE 'dismounted' END,
           switch_kind = NULL, last_exit_lat = NULL, last_exit_lng = NULL, last_exit_at = NULL,
           handoff_lat = NULL, handoff_lng = NULL, handoff_selected_at = NULL, handoff_cars = '[]'
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
    "SELECT status, started_at, signal_index, civilian_index, next_civilian_at FROM rooms WHERE code = ?",
  ).bind(code).first<{
    status: RoomStatus;
    started_at: number | null;
    signal_index: number;
    civilian_index: number;
    next_civilian_at: number | null;
  }>();
  if (!room || room.status !== "playing" || room.started_at === null) return;

  const completedSwitches = await database.prepare(
    `UPDATE room_players
     SET vehicle_state = 'driving', vehicle_started_at = switch_ends_at,
         position_updated_at = switch_ends_at,
         switch_ends_at = NULL, switch_kind = NULL, vehicle_cycle = vehicle_cycle + 1,
         handoff_lat = NULL, handoff_lng = NULL, handoff_selected_at = NULL
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

  const dueSignalIndex = Math.floor(Math.max(0, now - room.started_at) / RUNNER_SIGNAL_INTERVAL_MS);
  if (dueSignalIndex > room.signal_index) {
    const previousHunterSignalIndex = Math.floor(room.signal_index * RUNNER_SIGNAL_INTERVAL_MS / HUNTER_SIGNAL_INTERVAL_MS);
    const dueHunterSignalIndex = Math.floor(dueSignalIndex * RUNNER_SIGNAL_INTERVAL_MS / HUNTER_SIGNAL_INTERVAL_MS);
    const signalStatements = [
      database.prepare(
        `UPDATE room_players
         SET signal_lat = lat, signal_lng = lng
         WHERE room_code = ? AND left_at IS NULL AND caught = 0
           AND role = 'runner'
           AND lat IS NOT NULL AND lng IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM rooms
             WHERE code = ? AND status = 'playing' AND signal_index < ?
           )`,
      ).bind(code, code, dueSignalIndex),
    ];
    if (dueHunterSignalIndex > previousHunterSignalIndex) {
      signalStatements.push(database.prepare(
        `UPDATE room_players
         SET signal_lat = lat, signal_lng = lng
         WHERE room_code = ? AND left_at IS NULL AND caught = 0
           AND role = 'hunter'
           AND lat IS NOT NULL AND lng IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM rooms
             WHERE code = ? AND status = 'playing' AND signal_index < ?
           )`,
      ).bind(code, code, dueSignalIndex));
    }
    signalStatements.push(database.prepare(
        `UPDATE rooms
         SET signal_index = ?, updated_at = ?, revision = revision + 1
         WHERE code = ? AND status = 'playing' AND signal_index < ?`,
      ).bind(dueSignalIndex, now, code, dueSignalIndex));
    await database.batch(signalStatements);
  }

  if (room.next_civilian_at === null || now < room.next_civilian_at) return;
  const reportIndex = room.civilian_index + 1;
  const activePlayers = await database.prepare(
    `SELECT id, role, lat, lng FROM room_players
     WHERE room_code = ? AND left_at IS NULL AND caught = 0
       AND lat IS NOT NULL AND lng IS NOT NULL
     ORDER BY joined_at ASC, id ASC`,
  ).bind(code).all<{ id: string; role: PlayerRole; lat: number; lng: number }>();
  const hunter = activePlayers.results.find((player) => player.role === "hunter");
  const runners = activePlayers.results.filter((player) => player.role === "runner");
  const reportedRunner = runners.length
    ? runners[stableHash(`${code}:civilian-runner:${reportIndex}`) % runners.length]
    : null;
  const reportStatements = [
    database.prepare(
      `UPDATE room_players
       SET civilian_lat = NULL, civilian_lng = NULL,
           civilian_accuracy = NULL, civilian_reported_at = NULL
       WHERE room_code = ? AND left_at IS NULL`,
    ).bind(code),
  ];
  for (const player of [hunter, reportedRunner]) {
    if (!player) continue;
    const accuracy = civilianAccuracy(code, reportIndex, player.role);
    const point = civilianReportPoint(code, reportIndex, player.role, player, accuracy);
    reportStatements.push(database.prepare(
      `UPDATE room_players
       SET civilian_lat = ?, civilian_lng = ?, civilian_accuracy = ?, civilian_reported_at = ?
       WHERE id = ? AND room_code = ? AND left_at IS NULL`,
    ).bind(point.lat, point.lng, accuracy, now, player.id, code));
  }
  reportStatements.push(database.prepare(
    `UPDATE rooms
     SET civilian_index = ?, next_civilian_at = ?, updated_at = ?, revision = revision + 1
     WHERE code = ? AND status = 'playing' AND civilian_index < ?`,
  ).bind(reportIndex, now + civilianReportDelay(code, reportIndex + 1), now, code, reportIndex));
  await database.batch(reportStatements);
}

function parseVehicleSwitchKind(value: unknown): VehicleSwitchKind {
  if (value !== "prearranged" && value !== "hitchhike") {
    throw new ApiProblem(400, "INVALID_SWITCH_KIND", "Válassz előre egyeztetett autót vagy stoppolást.");
  }
  return value;
}

type StoredHandoffCar = { id: string; lat: number; lng: number; createdAt: number };

function parseHandoffCars(value: string | null | undefined): StoredHandoffCar[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((car): car is StoredHandoffCar => Boolean(
      car && typeof car === "object"
      && typeof (car as StoredHandoffCar).id === "string"
      && Number.isFinite((car as StoredHandoffCar).lat)
      && Number.isFinite((car as StoredHandoffCar).lng)
      && Number.isFinite((car as StoredHandoffCar).createdAt),
    )).slice(0, 10);
  } catch {
    return [];
  }
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

export async function selectHandoffPoint(
  database: D1Database,
  session: SessionRow,
  rawLat: unknown,
  rawLng: unknown,
  now = Date.now(),
): Promise<void> {
  const requested = validPosition(rawLat, rawLng);
  await syncRoomGame(database, session.roomCode, now);
  const player = await database.prepare(
    `SELECT p.role, p.caught, p.vehicle_state, p.vehicle_started_at, p.handoff_cars, r.status, r.started_at, r.city_id
     FROM room_players p JOIN rooms r ON r.code = p.room_code
     WHERE p.id = ? AND p.room_code = ? AND p.left_at IS NULL`,
  ).bind(session.playerId, session.roomCode).first<{
    role: PlayerRole;
    caught: number;
    vehicle_state: VehicleState;
    vehicle_started_at: number | null;
    handoff_cars: string;
    status: RoomStatus;
    started_at: number | null;
    city_id: string;
  }>();
  if (!player || player.status !== "playing" || player.started_at === null) {
    throw new ApiProblem(409, "GAME_NOT_RUNNING", "Átadási pont csak futó játékban jelölhető ki.");
  }
  if (player.role !== "runner" || player.caught || player.vehicle_state === "switching") {
    throw new ApiProblem(409, "HANDOFF_NOT_AVAILABLE", "Ezt az autót most nem választhatod ki.");
  }
  const cars = parseHandoffCars(player.handoff_cars);
  const selected = cars.find((car) => distanceMeters(requested, car) <= 15);
  if (!selected) throw new ApiProblem(409, "HANDOFF_NOT_FOUND", "Ez az egyeztetett autó már nem érhető el.");

  await database.prepare(
    `UPDATE room_players SET handoff_lat = ?, handoff_lng = ?, handoff_selected_at = ?
     WHERE id = ? AND room_code = ? AND role = 'runner' AND caught = 0
       AND vehicle_state <> 'switching'`,
  ).bind(selected.lat, selected.lng, now, session.playerId, session.roomCode).run();
  await markRoomUpdated(database, session.roomCode, now);
}

export async function placeHandoffCar(
  database: D1Database,
  session: SessionRow,
  rawLat: unknown,
  rawLng: unknown,
  now = Date.now(),
): Promise<void> {
  const requested = validPosition(rawLat, rawLng);
  await syncRoomGame(database, session.roomCode, now);
  const player = await database.prepare(
    `SELECT p.role, p.caught, p.vehicle_state, p.handoff_cars, r.status, r.started_at, r.city_id
     FROM room_players p JOIN rooms r ON r.code = p.room_code
     WHERE p.id = ? AND p.room_code = ? AND p.left_at IS NULL`,
  ).bind(session.playerId, session.roomCode).first<{
    role: PlayerRole; caught: number; vehicle_state: VehicleState; handoff_cars: string;
    status: RoomStatus; started_at: number | null; city_id: string;
  }>();
  if (!player || player.status !== "playing" || player.started_at === null) throw new ApiProblem(409, "GAME_NOT_RUNNING", "Autót csak futó játékban rakhatsz le.");
  if (player.role !== "runner" || player.caught || player.vehicle_state !== "driving") throw new ApiProblem(409, "HANDOFF_NOT_AVAILABLE", "Autót csak menet közben rakhatsz le.");
  const cars = parseHandoffCars(player.handoff_cars);
  if (cars.length >= 10) throw new ApiProblem(409, "HANDOFF_LIMIT", "Mind a 10 egyeztetett autót elhelyezted.");
  const zones = getCityZones(player.city_id);
  const zoneIndex = Math.min(zones.length - 1, Math.floor(Math.max(0, now - player.started_at) / ZONE_INTERVAL_MS));
  if (distanceMeters(requested, zones[zoneIndex]) > zones[zoneIndex].radius) throw new ApiProblem(409, "HANDOFF_OUTSIDE_ZONE", "Autót csak az aktív zónán belül rakhatsz le.");

  let snapped = requested;
  try {
    const response = await fetch(`https://router.project-osrm.org/nearest/v1/driving/${requested.lng},${requested.lat}?number=1`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("road");
    const data = await response.json() as { code?: string; waypoints?: Array<{ distance?: number; location?: [number, number] }> };
    const waypoint = data.code === "Ok" ? data.waypoints?.[0] : undefined;
    if (!waypoint?.location || (waypoint.distance ?? Infinity) > 40) throw new Error("road");
    snapped = validPosition(waypoint.location[1], waypoint.location[0]);
  } catch {
    throw new ApiProblem(503, "HANDOFF_ROAD_UNAVAILABLE", "Az autó közúti helyét most nem sikerült ellenőrizni. Próbálj másik pontot.");
  }
  cars.push({ id: crypto.randomUUID(), lat: snapped.lat, lng: snapped.lng, createdAt: now });
  await database.prepare(
    `UPDATE room_players SET handoff_cars = ?, last_seen_at = ?
     WHERE id = ? AND room_code = ? AND role = 'runner' AND caught = 0 AND vehicle_state = 'driving'`,
  ).bind(JSON.stringify(cars), now, session.playerId, session.roomCode).run();
  await markRoomUpdated(database, session.roomCode, now);
}

export async function removeHandoffCar(
  database: D1Database,
  session: SessionRow,
  rawCarId: unknown,
  now = Date.now(),
): Promise<void> {
  if (typeof rawCarId !== "string" || !rawCarId) throw new ApiProblem(400, "INVALID_HANDOFF_CAR", "Érvénytelen autó.");
  const row = await database.prepare(
    `SELECT role, caught, vehicle_state, handoff_cars FROM room_players
     WHERE id = ? AND room_code = ? AND left_at IS NULL`,
  ).bind(session.playerId, session.roomCode).first<{ role: PlayerRole; caught: number; vehicle_state: VehicleState; handoff_cars: string }>();
  if (!row || row.role !== "runner" || row.caught || row.vehicle_state === "switching") throw new ApiProblem(409, "HANDOFF_NOT_AVAILABLE", "Az autó most nem törölhető.");
  const cars = parseHandoffCars(row.handoff_cars);
  const filtered = cars.filter((car) => car.id !== rawCarId);
  if (filtered.length === cars.length) throw new ApiProblem(404, "HANDOFF_NOT_FOUND", "Ez az autó már nincs a térképen.");
  await database.prepare(
    `UPDATE room_players SET handoff_cars = ?,
       handoff_lat = NULL, handoff_lng = NULL, handoff_selected_at = NULL, last_seen_at = ?
     WHERE id = ? AND room_code = ?`,
  ).bind(JSON.stringify(filtered), now, session.playerId, session.roomCode).run();
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
  let updatedHandoffCars: string | null = null;
  if (kind === "prearranged") {
    const handoff = await database.prepare(
      `SELECT lat, lng, handoff_lat, handoff_lng, handoff_selected_at, vehicle_started_at, handoff_cars
       FROM room_players WHERE id = ? AND room_code = ? AND left_at IS NULL`,
    ).bind(session.playerId, session.roomCode).first<{
      lat: number | null; lng: number | null; handoff_lat: number | null; handoff_lng: number | null;
      handoff_selected_at: number | null; vehicle_started_at: number | null; handoff_cars: string;
    }>();
    if (!handoff || handoff.lat === null || handoff.lng === null || handoff.handoff_lat === null || handoff.handoff_lng === null || handoff.handoff_selected_at === null) {
      throw new ApiProblem(409, "HANDOFF_REQUIRED", "Előbb válassz egy lerakott egyeztetett autót.");
    }
    if (distanceMeters({ lat: handoff.lat, lng: handoff.lng }, { lat: handoff.handoff_lat, lng: handoff.handoff_lng }) > HANDOFF_DISTANCE_METERS) {
      throw new ApiProblem(409, "HANDOFF_TOO_FAR", "Az egyeztetett autó átvételéhez 75 méteren belül kell lenned.");
    }
    updatedHandoffCars = JSON.stringify(parseHandoffCars(handoff.handoff_cars).filter(
      (car) => distanceMeters(car, { lat: handoff.handoff_lat as number, lng: handoff.handoff_lng as number }) > 15,
    ));
  }
  const result = await database.prepare(
    `UPDATE room_players
     SET vehicle_state = 'switching', switch_kind = ?, switch_ends_at = ?, last_seen_at = ?,
         handoff_cars = CASE WHEN ? IS NULL THEN handoff_cars ELSE ? END
     WHERE id = ? AND room_code = ? AND left_at IS NULL AND caught = 0
       AND role = 'runner' AND vehicle_state = 'dismounted'
       AND EXISTS (SELECT 1 FROM rooms WHERE code = ? AND status = 'playing')`,
  ).bind(kind, switchEndsAt, now, updatedHandoffCars, updatedHandoffCars, session.playerId, session.roomCode, session.roomCode).run();
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
              revision, signal_index, civilian_index, next_civilian_at, capture_goal, city_id
       FROM rooms WHERE code = ?`,
    ).bind(code).first<RoomRow>(),
    database.prepare(
       `SELECT id, nickname, role, ready, caught, joined_at, last_seen_at,
               lat, lng, signal_lat, signal_lng,
               civilian_lat, civilian_lng, civilian_accuracy, civilian_reported_at,
               position_updated_at,
              vehicle_started_at, switch_ends_at, vehicle_cycle, vehicle_state, switch_kind,
              last_exit_lat, last_exit_lng, last_exit_at,
              handoff_lat, handoff_lng, handoff_selected_at, handoff_cars
       FROM room_players
       WHERE room_code = ? AND left_at IS NULL
       ORDER BY joined_at ASC, id ASC`,
    ).bind(code).all<PlayerRow>(),
  ]);
  if (!room) throw new ApiProblem(404, "ROOM_NOT_FOUND", "Nincs ilyen játékszoba.");

  const me = playerResult.results.find((player) => player.id === meId);
  const runnerSignalIndex = room.signal_index;
  const hunterSignalIndex = Math.floor(room.signal_index * RUNNER_SIGNAL_INTERVAL_MS / HUNTER_SIGNAL_INTERVAL_MS);
  const viewerRole = me?.role ?? "runner";
  const ownSignalIndex = viewerRole === "runner" ? runnerSignalIndex : hunterSignalIndex;
  const opponentSignalIndex = viewerRole === "runner" ? hunterSignalIndex : runnerSignalIndex;
  const ownSignalIntervalMs = viewerRole === "runner" ? RUNNER_SIGNAL_INTERVAL_MS : HUNTER_SIGNAL_INTERVAL_MS;
  const opponentSignalIntervalMs = viewerRole === "runner" ? HUNTER_SIGNAL_INTERVAL_MS : RUNNER_SIGNAL_INTERVAL_MS;
  const playerSignalTime = (role: PlayerRole): number | null => {
    const index = role === "runner" ? runnerSignalIndex : hunterSignalIndex;
    const interval = role === "runner" ? RUNNER_SIGNAL_INTERVAL_MS : HUNTER_SIGNAL_INTERVAL_MS;
    return room.started_at !== null && index > 0 ? room.started_at + index * interval : null;
  };
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
      player.id !== meId
      && me !== undefined
      && player.role !== me.role
      && !player.caught
      && player.signal_lat !== null
      && player.signal_lng !== null
      && playerSignalTime(player.role) !== null
    )
      ? {
          lat: player.signal_lat,
          lng: player.signal_lng,
          updatedAt: new Date(playerSignalTime(player.role) as number).toISOString(),
        }
      : null,
    civilianReport: (
      player.id !== meId
      && me !== undefined
      && player.role !== me.role
      && !player.caught
      && player.civilian_lat !== null
      && player.civilian_lng !== null
      && player.civilian_accuracy !== null
      && player.civilian_reported_at !== null
    )
      ? {
          lat: player.civilian_lat,
          lng: player.civilian_lng,
          updatedAt: new Date(player.civilian_reported_at).toISOString(),
          accuracy: player.civilian_accuracy,
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
          handoffPoint: player.handoff_lat === null || player.handoff_lng === null || player.handoff_selected_at === null
            ? null
            : { lat: player.handoff_lat, lng: player.handoff_lng, updatedAt: new Date(player.handoff_selected_at).toISOString() },
          handoffCars: parseHandoffCars(player.handoff_cars).map((car) => ({
            id: car.id,
            lat: car.lat,
            lng: car.lng,
            updatedAt: new Date(car.createdAt).toISOString(),
          })),
        }
      : null,
    };
  });
  const startBlocker = getStartBlocker(room, players, meId);
  const capturedCount = playerResult.results.filter(
    (player) => player.role === "runner" && Boolean(player.caught),
  ).length;
  const winner = room.status === "finished" && room.started_at !== null
    ? (capturedCount >= room.capture_goal ? "hunter" : "runners")
    : null;
  const nextSignalAtMs = room.status === "playing" && room.started_at !== null
    ? room.started_at + (ownSignalIndex + 1) * ownSignalIntervalMs
    : null;
  const lastSignalAtMs = room.started_at !== null && ownSignalIndex > 0
    ? room.started_at + ownSignalIndex * ownSignalIntervalMs
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
      signalEverySeconds: ownSignalIntervalMs / 1000,
      signalIndex: ownSignalIndex,
      lastSignalAt: lastSignalAtMs === null ? null : new Date(lastSignalAtMs).toISOString(),
      nextSignalAt: nextSignalAtMs === null ? null : new Date(nextSignalAtMs).toISOString(),
      opponentSignalIndex,
      opponentSignalEverySeconds: opponentSignalIntervalMs / 1000,
      civilianReportIndex: room.civilian_index,
      captureGoal: room.capture_goal,
      capturedCount,
      winner,
      nearestOpponentMeters: null,
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

