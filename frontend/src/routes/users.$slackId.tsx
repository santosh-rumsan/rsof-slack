import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { admin, type SlackUser, type PresenceHistory, type DurationSummary } from "@/lib/api";
import { PresenceBadge } from "@/components/presence-badge";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export const Route = createFileRoute("/users/$slackId")({
  component: UserDetailPage,
});

function UserDetailPage() {
  const { slackId } = Route.useParams();
  const [user, setUser] = useState<SlackUser | null>(null);
  const [history, setHistory] = useState<PresenceHistory[]>([]);
  const [duration, setDuration] = useState<DurationSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      admin.getUser(slackId),
      admin.getUserPresenceHistory(slackId),
      admin.getUserDuration(slackId),
    ]).then(([u, h, d]) => {
      setUser(u);
      setHistory(h);
      setDuration(d);
    }).finally(() => setLoading(false));
  }, [slackId]);

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  if (!user) return <div className="p-6 text-sm text-red-500">User not found</div>;

  // Build chart data: group presence history by day
  const chartData = history.slice(-200).map((h) => ({
    time: new Date(h.recorded_at).toLocaleString(),
    active: h.presence === "active" ? 1 : 0,
  }));

  const activeSec = duration?.durations.find((d) => d.presence === "active")?.total_seconds ?? 0;
  const awaySec = duration?.durations.find((d) => d.presence === "away")?.total_seconds ?? 0;
  const total = activeSec + awaySec;
  const availPct = total > 0 ? ((activeSec / total) * 100).toFixed(1) : "—";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/users" className="text-sm text-gray-400 hover:text-brand">← Users</Link>
      </div>

      {/* User card */}
      <div className="rounded-xl border bg-white p-4 flex items-start gap-4">
        {user.avatar_url ? (
          <img src={user.avatar_url} className="h-16 w-16 rounded-full" alt="" />
        ) : (
          <div className="h-16 w-16 rounded-full bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-400">
            {(user.real_name ?? user.display_name ?? "?")[0].toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold">{user.real_name ?? user.display_name}</h2>
            <PresenceBadge presence={user.current_presence} showLabel />
          </div>
          {user.email && <p className="text-sm text-gray-400">{user.email}</p>}
          {user.current_status_text && (
            <p className="text-sm text-gray-600 mt-1">
              {user.current_status_emoji} {user.current_status_text}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {user.is_dnd && <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700">DnD</span>}
            {user.is_busy && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">Busy</span>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Availability</p>
          <p className="text-2xl font-bold text-brand">{availPct}%</p>
          <p className="text-xs text-gray-400">Active {fmtDuration(activeSec)}</p>
        </div>
      </div>

      {/* Presence timeline chart */}
      {chartData.length > 0 && (
        <div className="rounded-xl border bg-white p-4">
          <h3 className="font-medium text-gray-700 mb-3">Presence History (last 200 events)</h3>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" hide />
              <YAxis domain={[0, 1]} hide />
              <Tooltip
                formatter={(v: number) => (v === 1 ? "Active" : "Away")}
                labelFormatter={(l) => l}
              />
              <Area type="step" dataKey="active" stroke="#22c55e" fill="#dcfce7" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* History table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <h3 className="font-medium text-gray-700 px-4 py-3 border-b">Presence Events</h3>
        {history.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No history yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Time</th>
                <th className="px-4 py-2 text-left">Presence</th>
                <th className="px-4 py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...history].reverse().slice(0, 100).map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-2 text-gray-500">{new Date(h.recorded_at).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <PresenceBadge presence={h.presence as "active" | "away"} showLabel />
                  </td>
                  <td className="px-4 py-2 text-gray-400 text-xs">{h.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
