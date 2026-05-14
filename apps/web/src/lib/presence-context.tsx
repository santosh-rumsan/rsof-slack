import { createContext, useContext, useEffect, useRef, useState } from "react";
import { getJwt } from "@/lib/api";

export interface PresenceEvent {
  slack_id: string;
  presence: "active" | "away";
  source: string;
  real_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  ts: string;
}

interface PresenceState {
  events: PresenceEvent[];
  presenceMap: Record<string, "active" | "away">;
  connected: boolean;
}

const PresenceContext = createContext<PresenceState>({
  events: [],
  presenceMap: {},
  connected: false,
});

export function usePresence() {
  return useContext(PresenceContext);
}

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<PresenceEvent[]>([]);
  const [presenceMap, setPresenceMap] = useState<Record<string, "active" | "away">>({});
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;

    async function connect() {
      try {
        const res = await fetch("/api/v1/admin/events/presence", {
          headers: { Authorization: `Bearer ${getJwt()}` },
        });
        if (!res.ok || !active) return;
        setConnected(true);

        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done || !active) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as PresenceEvent;
              setEvents((prev) => [ev, ...prev].slice(0, 50));
              setPresenceMap((prev) => ({ ...prev, [ev.slack_id]: ev.presence }));
            } catch {
              // ignore malformed SSE frames
            }
          }
        }
      } catch {
        // connection failed
      } finally {
        if (active) {
          setConnected(false);
          reconnectTimer.current = setTimeout(() => {
            if (active) connect();
          }, 5000);
        }
      }
    }

    connect();

    return () => {
      active = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, []);

  return (
    <PresenceContext.Provider value={{ events, presenceMap, connected }}>
      {children}
    </PresenceContext.Provider>
  );
}
