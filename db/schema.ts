import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  cityId: text("city_id").notNull().default("bucharest"),
  status: text("status", { enum: ["lobby", "playing", "finished"] })
    .notNull()
    .default("lobby"),
  hostPlayerId: text("host_player_id").notNull(),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  updatedAt: integer("updated_at").notNull(),
  revision: integer("revision").notNull().default(0),
  signalIndex: integer("signal_index").notNull().default(0),
  captureGoal: integer("capture_goal").notNull().default(1),
});

export const roomPlayers = sqliteTable(
  "room_players",
  {
    id: text("id").primaryKey(),
    roomCode: text("room_code")
      .notNull()
      .references(() => rooms.code, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    nickname: text("nickname").notNull(),
    role: text("role", { enum: ["hunter", "runner"] }).notNull(),
    ready: integer("ready", { mode: "boolean" }).notNull().default(false),
    caught: integer("caught", { mode: "boolean" }).notNull().default(false),
    joinedAt: integer("joined_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    positionUpdatedAt: integer("position_updated_at"),
    leftAt: integer("left_at"),
    lat: real("lat"),
    lng: real("lng"),
    signalLat: real("signal_lat"),
    signalLng: real("signal_lng"),
    vehicleStartedAt: integer("vehicle_started_at"),
    switchEndsAt: integer("switch_ends_at"),
    vehicleCycle: integer("vehicle_cycle").notNull().default(0),
    vehicleState: text("vehicle_state", { enum: ["driving", "dismounted", "switching"] })
      .notNull()
      .default("dismounted"),
    switchKind: text("switch_kind", { enum: ["prearranged", "hitchhike"] }),
    lastExitLat: real("last_exit_lat"),
    lastExitLng: real("last_exit_lng"),
    lastExitAt: integer("last_exit_at"),
    handoffLat: real("handoff_lat"),
    handoffLng: real("handoff_lng"),
    handoffSelectedAt: integer("handoff_selected_at"),
  },
  (table) => [
    uniqueIndex("idx_room_players_token_hash").on(table.tokenHash),
    index("idx_room_players_room_active").on(table.roomCode, table.leftAt),
    index("idx_room_players_room_role").on(table.roomCode, table.role),
    uniqueIndex("idx_room_players_one_hunter")
      .on(table.roomCode)
      .where(sql`${table.role} = 'hunter' AND ${table.leftAt} IS NULL`),
  ],
);

