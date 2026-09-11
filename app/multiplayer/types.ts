export type PlayerRole = "hunter" | "runner";
export type VehicleState = "driving" | "dismounted" | "switching";
export type VehicleSwitchKind = "prearranged" | "hitchhike";

export type RoomStatus = "lobby" | "playing" | "finished";

export type PlayerPosition = {
  lat: number;
  lng: number;
  updatedAt: string;
};

export type RoomPlayer = {
  id: string;
  nickname: string;
  role: PlayerRole;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  caught: boolean;
  exposed: boolean;
  liveTracked: boolean;
  position: PlayerPosition | null;
  signalPosition: PlayerPosition | null;
  lastExitPosition: PlayerPosition | null;
  vehicle: {
    state: VehicleState;
    switchKind: VehicleSwitchKind | null;
    startedAt: string | null;
    expiresAt: string | null;
    switchEndsAt: string | null;
    cycle: number;
    overdue: boolean;
    handoffPoint: PlayerPosition | null;
  } | null;
};

export type RoomGameState = {
  durationSeconds: number;
  signalEverySeconds: number;
  signalIndex: number;
  lastSignalAt: string | null;
  nextSignalAt: string | null;
  captureGoal: number;
  capturedCount: number;
  winner: "hunter" | "runners" | null;
  nearestOpponentMeters: number | null;
};

export type RoomSnapshot = {
  cityId: string;
  code: string;
  status: RoomStatus;
  hostPlayerId: string;
  createdAt: string;
  startedAt: string | null;
  players: RoomPlayer[];
  meId: string;
  canStart: boolean;
  startBlocker: string | null;
  serverNow: string;
  revision: number;
  game: RoomGameState | null;
};

export type RoomSession = {
  roomCode: string;
  playerId: string;
  token: string;
};

export type CreateOrJoinRoomInput = {
  cityId?: string;
  action: "create" | "join";
  nickname: string;
  code?: string;
  role: PlayerRole;
};

export type CreateOrJoinRoomResponse = {
  session: RoomSession;
  room: RoomSnapshot;
};

export type RoomPatchAction =
  | { action: "ready"; ready: boolean }
  | { action: "role"; role: PlayerRole }
  | { action: "start" }
  | { action: "leave" }
  | { action: "heartbeat" }
  | { action: "position"; lat: number; lng: number }
  | { action: "exit_vehicle" }
  | { action: "select_handoff"; lat: number; lng: number }
  | { action: "start_vehicle_switch"; kind: VehicleSwitchKind };

export type ConnectionState =
  | "connecting"
  | "online"
  | "reconnecting"
  | "offline";

