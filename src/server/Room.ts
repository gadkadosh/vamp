import { DurableObject } from "cloudflare:workers";
import { COMPOSITION_ID, isSharedId, isSharedNote } from "../shared/composition";
import type { Composition, CompositionEdit, EditResponse, NoteChange } from "../shared/composition";
import { STEP_COUNT } from "../shared/music";
import { createPattern, placeNote, TONES } from "../shared/pattern";
import type { Pattern } from "../shared/pattern";

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEdit(value: unknown): value is CompositionEdit {
  if (
    !isRecord(value) ||
    !isSharedId(value.compositionId) ||
    !Array.isArray(value.changes) ||
    value.changes.length < 1 ||
    value.changes.length > STEP_COUNT * TONES.length
  )
    return false;
  return value.changes.every((change: unknown) => {
    if (!isRecord(change)) return false;
    if (change.type === "remove") return isSharedId(change.id);
    if (change.type !== "add" && change.type !== "move") return false;
    return isSharedNote(change.note);
  });
}

// Bound streamed bodies as well as requests with a Content-Length header.
async function readEdit(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    reader.releaseLock();
  }
}

function applyChanges(original: Pattern, changes: NoteChange[]) {
  let pattern = original;
  for (const change of changes) {
    if (change.type === "remove") {
      if (pattern.notes.some(({ id }) => id === change.id)) {
        pattern = { notes: pattern.notes.filter(({ id }) => id !== change.id) };
      }
      continue;
    }
    const note = { id: change.note.id, step: change.note.step, tone: change.note.tone };
    const existing = pattern.notes.find(({ id }) => id === note.id);
    if (change.type === "add" && existing) {
      if (existing.step === note.step && existing.tone === note.tone) continue;
      return { pattern: original, error: "That note ID is already in use." };
    }
    if (change.type === "move" && !existing) {
      return { pattern: original, error: "That note no longer exists." };
    }
    const placement = placeNote(pattern, note);
    if (!placement.accepted) {
      return { pattern: original, error: "That sound is already here. Try another pitch or beat." };
    }
    pattern = placement.document;
  }
  return { pattern };
}

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.transactionSync(() => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS compositions (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        pattern TEXT NOT NULL
      )`);
      const seed = createPattern();
      seed.notes = seed.notes.map((note) => ({ ...note, id: `seed-${note.id}` }));
      ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO compositions (id, revision, pattern) VALUES (?, 0, ?)",
        COMPOSITION_ID,
        JSON.stringify(seed),
      );
    });
  }

  private composition(): Composition {
    const row = this.ctx.storage.sql
      .exec<{ id: string; revision: number; pattern: string }>(
        "SELECT id, revision, pattern FROM compositions WHERE id = ?",
        COMPOSITION_ID,
      )
      .one();
    return { ...row, pattern: JSON.parse(row.pattern) as Pattern };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") return json(this.composition());
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
    }
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "Forbidden" }, 403);
    if (request.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
      return json({ error: "Send edits as application/json." }, 415);
    }
    let edit: unknown;
    try {
      edit = await readEdit(request);
    } catch {
      return json({ error: "Invalid edit." }, 400);
    }
    if (!isEdit(edit)) return json({ error: "Invalid edit." }, 400);
    if (edit.compositionId !== COMPOSITION_ID) {
      return json({ error: "This composition is not active." }, 409);
    }

    // Re-read and commit synchronously after parsing, so concurrent clients edit the latest state.
    const result = this.ctx.storage.transactionSync((): EditResponse => {
      const composition = this.composition();
      const result = applyChanges(composition.pattern, edit.changes);
      if (result.error) return { composition, error: result.error };
      if (result.pattern !== composition.pattern) {
        composition.pattern = result.pattern;
        composition.revision++;
        this.ctx.storage.sql.exec(
          "UPDATE compositions SET revision = ?, pattern = ? WHERE id = ?",
          composition.revision,
          JSON.stringify(composition.pattern),
          composition.id,
        );
      }
      return { composition };
    });
    return json(result, result.error ? 409 : 200);
  }
}
