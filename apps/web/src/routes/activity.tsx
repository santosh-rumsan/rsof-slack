import { createFileRoute, Link } from "@tanstack/react-router";
import { usePresence, type ActivityEvent } from "@/lib/presence-context";
import { PresenceBadge } from "@/components/presence-badge";
import { SlackText } from "@/lib/slack-emoji";

export const Route = createFileRoute("/activity")({
  component: ActivityLog,
});

function fmt(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EventRow({ ev }: { ev: ActivityEvent }) {
  const name = ev.real_name ?? ev.display_name ?? ev.slack_id;

  const userCell = (
    <div className="flex items-center gap-2">
      {ev.avatar_url && <img src={ev.avatar_url} className="h-6 w-6 rounded-full" alt="" />}
      <Link
        to="/users/$slackId"
        params={{ slackId: ev.slack_id }}
        className="font-medium hover:underline"
      >
        {name}
      </Link>
    </div>
  );

  if (ev.type === "presence") {
    return (
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{fmt(ev.ts)}</td>
        <td className="px-4 py-2">{userCell}</td>
        <td className="px-4 py-2">
          <PresenceBadge presence={ev.presence} showLabel />
        </td>
        <td className="px-4 py-2 text-xs text-gray-400 hidden sm:table-cell">{ev.source}</td>
        <td className="px-4 py-2 text-xs text-gray-500 hidden sm:table-cell" />
      </tr>
    );
  }

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{fmt(ev.ts)}</td>
      <td className="px-4 py-2">{userCell}</td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 font-medium">
          status change
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-gray-400 hidden sm:table-cell">rtm</td>
      <td className="px-4 py-2 text-xs text-gray-600 hidden sm:table-cell">
        {ev.status_emoji ? <SlackText text={ev.status_emoji} /> : null}{" "}
        {ev.status_text ? <SlackText text={ev.status_text} /> : <span className="italic text-gray-400">cleared</span>}
      </td>
    </tr>
  );
}

export default function ActivityLog() {
  const { events, connected } = usePresence();

  return (
    <div className="flex flex-col h-full p-4 sm:p-6 gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Presence Activity</h1>
        <span
          className={`h-3 w-3 rounded-full flex-shrink-0 ${connected ? "bg-green-500" : "bg-red-500"}`}
          title={connected ? "Connected" : "Disconnected"}
        />
      </div>

      <div className="flex-1 overflow-auto rounded-xl border bg-white">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {connected ? "Waiting for activity…" : "Connecting…"}
          </div>
        ) : (
          <div className="overflow-x-auto h-full">
            <table className="w-full text-sm min-w-[500px]">
              <thead className="sticky top-0 bg-white border-b">
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-2 w-24">Time</th>
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2 w-32">Event</th>
                  <th className="px-4 py-2 w-20 hidden sm:table-cell">Source</th>
                  <th className="px-4 py-2 hidden sm:table-cell">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {events.map((ev, i) => (
                  <EventRow key={i} ev={ev} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
