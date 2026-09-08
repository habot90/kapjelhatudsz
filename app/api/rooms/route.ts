import {
  ApiProblem,
  assertSameOrigin,
  createRoom,
  ensureSchema,
  errorResponse,
  getDatabase,
  joinRoom,
  jsonResponse,
  normalizeCode,
  normalizeNickname,
  parseRole,
  readJsonObject,
} from "./shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    if (body.action !== "create" && body.action !== "join") {
      throw new ApiProblem(400, "INVALID_ACTION", "Válassz szobalétrehozást vagy csatlakozást.");
    }

    const nickname = normalizeNickname(body.nickname);
    const role = parseRole(body.role);
    const database = getDatabase();
    await ensureSchema(database);
    const result = body.action === "create"
      ? await createRoom(database, nickname, role, body.cityId)
      : await joinRoom(database, normalizeCode(body.code), nickname, role);
    return jsonResponse(result, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
