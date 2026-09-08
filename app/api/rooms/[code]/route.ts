import {
  ApiProblem,
  assertSameOrigin,
  ensureSchema,
  errorResponse,
  getDatabase,
  getRoomSnapshot,
  jsonResponse,
  leaveRoom,
  normalizeCode,
  parseRole,
  readJsonObject,
  requireSession,
  setReady,
  setRole,
  startRoom,
  touchSession,
  updatePlayerPosition,
} from "../shared";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> | { code: string } };

async function codeFrom(context: RouteContext): Promise<string> {
  return normalizeCode((await context.params).code);
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const code = await codeFrom(context);
    const database = getDatabase();
    await ensureSchema(database);
    const session = await requireSession(database, request, code);
    const now = Date.now();
    await touchSession(database, session, now);
    return jsonResponse({ room: await getRoomSnapshot(database, code, session.playerId, now) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const code = await codeFrom(context);
    const body = await readJsonObject(request);
    const database = getDatabase();
    await ensureSchema(database);
    const session = await requireSession(database, request, code);
    const now = Date.now();

    switch (body.action) {
      case "heartbeat":
        await touchSession(database, session, now, true);
        break;
      case "ready":
        if (typeof body.ready !== "boolean") {
          throw new ApiProblem(400, "INVALID_READY", "Érvénytelen készenléti állapot.");
        }
        await setReady(database, session, body.ready, now);
        break;
      case "role":
        await setRole(database, session, parseRole(body.role), now);
        break;
      case "start":
        await startRoom(database, session, now);
        break;
      case "leave":
        await leaveRoom(database, session, now);
        break;
      case "position":
        await updatePlayerPosition(database, session, body.lat, body.lng, now);
        break;
      default:
        throw new ApiProblem(400, "INVALID_ACTION", "Ismeretlen szobaművelet.");
    }

    return jsonResponse({ room: await getRoomSnapshot(database, code, session.playerId, now) });
  } catch (error) {
    return errorResponse(error);
  }
}
