import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PresenceBadge } from "@/components/presence-badge";

export const Route = createFileRoute("/activity")({
  component: ActivityLog,
});

interface PresenceEvent {
  slack_id: string;
  presence: "active" | "away";
  source: string;
  real_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  ts: string;
}

function getApiKey(): string {
  return localStorage.getItem("rsof_slack_api_key") ?? "";
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ActivityLog() {
  const [events, setEvents] = useState<PresenceEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      try {
        const res = await fetch("/api/v1/admin/events/presence", {
          headers: { "X-API-Key": getApiKey() },
          signal: ac.signal,
        });

        if (!res.ok) {
          setError(`${res.status}: ${await res.text()}`);
          return;
        }

        setConnected(true);
        setError(null);

        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as PresenceEvent;
              setEvents((prev) => [ev, ...prev].slice(0, 500));
            } catch {
              // ignore malformed
            }
          }
        }
      } catch (e: unknown) {
        if ((e as Error).name !== "AbortError") {
          setError(String(e));
        }
      } finally {
        setConnected(false);
      }
    })();

    return () => {
      ac.abort();
    };
  }, []);

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Presence Activity</h1>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            connected ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
          }`}
        >
          {connected ? "live" : "disconnected"}
        </span>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>
      )}

      <div className="flex-1 overflow-auto rounded-xl border bg-white">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {connected ? "Waiting for presence changes…" : "Connecting…"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white border-b">
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2 w-24">Time</th>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2 w-24">Presence</th>
                <th className="px-4 py-2 w-20">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {events.map((ev, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">
                    {fmt(ev.ts)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {ev.avatar_url && (
                        <img src={ev.avatar_url} className="h-6 w-6 rounded-full" alt="" />
                      )}
                      <span className="font-medium">
                        {ev.real_name ?? ev.display_name ?? ev.slack_id}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <PresenceBadge presence={ev.presence} />
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400">{ev.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
