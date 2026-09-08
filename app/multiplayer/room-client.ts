import type {
  CreateOrJoinRoomInput,
  CreateOrJoinRoomResponse,
  RoomPatchAction,
  RoomSession,
  RoomSnapshot,
} from "./types";

type ErrorPayload = {
  error?: string;
  code?: string;
  message?: string;
};

export class RoomApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "RoomApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorFrom(response: Response, payload: unknown): RoomApiError {
  const details = (payload && typeof payload === "object" ? payload : {}) as ErrorPayload;
  const code = details.code ?? details.error ?? null;
  const message = details.message ?? details.error ?? `A kérés sikertelen (${response.status}).`;
  return new RoomApiError(message, response.status, code);
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new RoomApiError("A játékszerver jelenleg nem érhető el.", 0, "NETWORK_ERROR");
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    throw errorFrom(response, payload);
  }

  if (payload === null) {
    throw new RoomApiError("A játékszerver üres választ küldött.", response.status, "EMPTY_RESPONSE");
  }

  return payload as T;
}

function roomUrl(code: string): string {
  return `/api/rooms/${encodeURIComponent(code.toUpperCase())}`;
}

function authenticatedInit(
  session: RoomSession,
  init: RequestInit = {},
): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.token}`);
  return { ...init, headers };
}

function unwrapRoom(payload: RoomSnapshot | { room: RoomSnapshot }): RoomSnapshot {
  return "room" in payload ? payload.room : payload;
}

export async function createOrJoinRoom(
  input: CreateOrJoinRoomInput,
  signal?: AbortSignal,
): Promise<CreateOrJoinRoomResponse> {
  return requestJson<CreateOrJoinRoomResponse>("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
}

export async function getRoom(
  session: RoomSession,
  signal?: AbortSignal,
): Promise<RoomSnapshot> {
  const payload = await requestJson<RoomSnapshot | { room: RoomSnapshot }>(
    roomUrl(session.roomCode),
    authenticatedInit(session, { method: "GET", signal }),
  );
  return unwrapRoom(payload);
}

export async function patchRoom(
  session: RoomSession,
  action: RoomPatchAction,
  signal?: AbortSignal,
): Promise<RoomSnapshot> {
  const payload = await requestJson<RoomSnapshot | { room: RoomSnapshot }>(
    roomUrl(session.roomCode),
    authenticatedInit(session, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
      signal,
    }),
  );
  return unwrapRoom(payload);
}
