import { COMPOSITION_ID } from "../shared/composition";
export { Room } from "./Room";

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    if (pathname === "/api/composition") {
      return env.ROOM.getByName(COMPOSITION_ID).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
