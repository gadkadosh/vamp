import { useCallback, useEffect, useRef, useState } from "react";
import { COMPOSITION_ID, isComposition } from "../shared/composition";
import type { Composition, EditResponse, NoteChange } from "../shared/composition";
import { placeNote } from "../shared/pattern";
import type { Pattern } from "../shared/pattern";
import type { PatternEdit, SharedSession } from "./editing";

type State = {
  composition: Composition | null;
  pending: Pattern | null;
  status: SharedSession["status"];
  error: string;
};
const EMPTY_PATTERN: Pattern = { notes: [] };

async function readResponse(signal: AbortSignal, options: RequestInit = {}) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 15_000);
  const clear = () => clearTimeout(timer);
  signal.addEventListener("abort", clear, { once: true });
  try {
    const response = await fetch("/api/composition", {
      ...options,
      signal: AbortSignal.any([signal, deadline.signal]),
    });
    const body: unknown = await response.json();
    return { response, body };
  } finally {
    clear();
    signal.removeEventListener("abort", clear);
  }
}

export function useSharedSession(active: boolean): SharedSession {
  const [state, setState] = useState<State>({
    composition: null,
    pending: null,
    status: "loading",
    error: "",
  });
  const current = useRef(state);
  const request = useRef<AbortController | null>(null);

  const publish = useCallback((next: State) => {
    current.current = next;
    setState(next);
  }, []);

  const reload = useCallback(() => {
    if (current.current.status === "saving") return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    publish({ ...current.current, pending: null, status: "loading", error: "" });
    void (async () => {
      try {
        const { response, body: composition } = await readResponse(controller.signal, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Loading failed");
        if (!isComposition(composition) || composition.id !== COMPOSITION_ID) {
          throw new Error("Invalid composition");
        }
        if (!controller.signal.aborted) {
          publish({ composition, pending: null, status: "ready", error: "" });
        }
      } catch {
        if (!controller.signal.aborted) {
          publish({
            ...current.current,
            status: "unavailable",
            error: "Couldn’t load the shared pattern. Reload it, or play solo.",
          });
        }
      }
    })();
  }, [publish]);

  useEffect(() => {
    if (active) reload();
    return () => request.current?.abort();
  }, [active, reload]);

  function edit(edit: PatternEdit) {
    const before = current.current;
    if (before.status !== "ready" || !before.composition) return;
    const compositionId = before.composition.id;
    let pending = before.composition.pattern;
    const changes: NoteChange[] = [];
    if (edit.type === "remove") {
      const id = String(edit.id);
      if (!pending.notes.some((note) => note.id === id)) return;
      pending = { notes: pending.notes.filter((note) => note.id !== id) };
      changes.push({ type: "remove", id });
    } else {
      for (const candidate of edit.notes) {
        const note = { ...candidate, id: String(candidate.id) };
        const type = pending.notes.some(({ id }) => id === note.id) ? "move" : "add";
        const placement = placeNote(pending, note);
        if (!placement.accepted) return;
        if (placement.document === pending) continue;
        pending = placement.document;
        changes.push({ type, note: { ...placement.note, id: note.id } });
      }
    }
    if (!changes.length) return;
    publish({ ...before, pending, status: "saving", error: "" });
    const controller = new AbortController();
    request.current = controller;
    void (async () => {
      try {
        const { response, body } = await readResponse(controller.signal, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ compositionId, changes }),
        });
        const result = body as EditResponse | null;
        if (
          (!response.ok && response.status !== 409) ||
          !result ||
          !isComposition(result.composition) ||
          result.composition.id !== compositionId ||
          (result.error !== undefined && typeof result.error !== "string")
        ) {
          throw new Error("Saving failed");
        }
        if (!controller.signal.aborted) {
          publish({
            composition: result.composition,
            pending: null,
            status: "ready",
            error: result.error ? `${result.error} The shared pattern has been refreshed.` : "",
          });
        }
      } catch {
        // A lost response does not prove the edit failed. Reconcile with a GET, never replay a write.
        if (!controller.signal.aborted) {
          publish({
            ...before,
            status: "unavailable",
            error: "Couldn’t confirm the edit. It may be saved; reload before editing again.",
          });
        }
      }
    })();
  }

  return {
    kind: "shared",
    pattern: state.pending ?? state.composition?.pattern ?? EMPTY_PATTERN,
    status: state.status,
    error: state.error,
    edit,
    reload,
    nextId: () => crypto.randomUUID(),
  };
}
