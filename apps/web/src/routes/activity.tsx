import { createFileRoute } from "@tanstack/react-router";
import { usePresence } from "@/lib/presence-context";
import { PresenceBadge } from "@/components/presence-badge";

export const Route = createFileRoute("/activity")({
  component: ActivityLog,
});

function fmt(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ActivityLog() {
  const { events, connected } = usePresence();

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
      </div>
    </div>
  );
}
