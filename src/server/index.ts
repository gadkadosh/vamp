import { DurableObject } from "cloudflare:workers";
import { createPattern } from "../shared/pattern";
import { applyChanges, MAX_MESSAGE_LENGTH, parseEdit } from "../shared/room";
import type { RoomState, StateMessage } from "../shared/room";

export class Room extends DurableObject<Env> {
  private state!: RoomState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomState>("state");
      this.state = saved ?? { revision: 0, pattern: createPattern(() => crypto.randomUUID()) };
      if (!saved) await ctx.storage.put("state", this.state);
    });
  }

  fetch() {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.send(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || data.length > MAX_MESSAGE_LENGTH) {
      socket.close(1009, "Edit is too large or is not text.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      this.send(socket, { error: "Invalid edit." });
      return;
    }
    const edit = parseEdit(parsed);
    if (!edit) {
      this.send(socket, { error: "Invalid edit." });
      return;
    }
    await this.ctx.blockConcurrencyWhile(async () => {
      let pattern;
      try {
        pattern = applyChanges(this.state.pattern, edit.changes);
      } catch (error) {
        this.send(socket, { requestId: edit.requestId, error: (error as Error).message });
        return;
      }
      const next = { revision: this.state.revision + 1, pattern };
      // Save before acknowledging or broadcasting; clients only see durable state.
      await this.ctx.storage.put("state", next);
      this.state = next;
      for (const peer of this.ctx.getWebSockets()) this.send(peer, { requestId: edit.requestId });
    });
  }

  webSocketClose(socket: WebSocket, code: number) {
    socket.close(code === 1005 ? 1000 : code);
  }

  webSocketError(socket: WebSocket) {
    socket.close(1011, "Connection interrupted.");
  }

  private send(socket: WebSocket, extra: Pick<StateMessage, "requestId" | "error"> = {}) {
    try {
      socket.send(
        JSON.stringify({ type: "state", state: this.state, ...extra } satisfies StateMessage),
      );
    } catch {
      // A disconnected peer must not prevent delivery to the remaining listeners.
      socket.close(1011, "Connection interrupted.");
    }
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/room" && request.method === "GET") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return new Response("Forbidden", { status: 403 });
      return env.ROOM.getByName("global").fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
