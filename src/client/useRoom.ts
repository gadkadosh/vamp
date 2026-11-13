import { useEffect, useEffectEvent, useRef, useState } from "react";
import { TONE_LAYOUT_VERSION } from "../shared/room";
import type { Change, EditMessage, StateMessage } from "../shared/room";

export function useRoom(
  enabled: boolean,
  onState: (message: StateMessage, pending: boolean) => void,
  onDisconnect: () => void,
) {
  const [status, setStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [pending, setPending] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingId = useRef<string | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const receive = useEffectEvent(onState);
  const disconnect = useEffectEvent(onDisconnect);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 500;

    function connect() {
      if (stopped) return;
      setStatus("connecting");
      setPending(false);

      const url = new URL("/api/room", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url);
      socketRef.current = socket;
      timeout.current = setTimeout(() => socket.close(), 10_000);

      socket.onmessage = (event) => {
        if (stopped) return;
        let message: StateMessage;
        try {
          message = JSON.parse(event.data) as StateMessage;
          if (
            message.type !== "state" ||
            !Number.isSafeInteger(message.state.revision) ||
            !Array.isArray(message.state.pattern.notes)
          )
            throw new Error("Invalid state");
        } catch {
          socket.close();
          return;
        }

        if (message.requestId === pendingId.current || message.error) {
          pendingId.current = null;
          setPending(false);
        }
        if (!pendingId.current) {
          clearTimeout(timeout.current);
          setPending(false);
        }

        delay = 500;
        setStatus("connected");
        receive(message, pendingId.current !== null);
      };

      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (stopped) return;
        clearTimeout(timeout.current);
        socketRef.current = null;
        pendingId.current = null;
        setPending(false);
        setStatus("offline");
        disconnect();

        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    }

    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(timeout.current);
      pendingId.current = null;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [enabled]);

  function send(changes: Change[]) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || pendingId.current) return false;

    const requestId = crypto.randomUUID();
    try {
      socket.send(
        JSON.stringify({
          type: "edit",
          toneLayout: TONE_LAYOUT_VERSION,
          requestId,
          changes,
        } satisfies EditMessage),
      );
    } catch {
      socket.close();
      return false;
    }

    pendingId.current = requestId;
    setPending(true);
    clearTimeout(timeout.current);
    // An unacknowledged edit is never retried: reconnect and load the durable state instead.
    timeout.current = setTimeout(() => socket.close(), 10_000);
    return true;
  }

  return { status, pending, send };
}
