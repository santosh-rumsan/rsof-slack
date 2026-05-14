import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { admin, health, type SlackUser, type Health } from "@/lib/api";
import { PresenceBadge } from "@/components/presence-badge";
import { usePresence } from "@/lib/presence-context";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const [healthData, setHealthData] = useState<Health | null>(null);
  const [allUsers, setAllUsers] = useState<SlackUser[]>([]);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const { presenceMap } = usePresence();

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, []);

  async function refresh() {
    const [h, users] = await Promise.all([
      health.get().catch(() => null),
      admin.listUsers().catch(() => []),
    ]);
    setHealthData(h);
    setAllUsers(users);
  }

  const activeUsers = useMemo(
    () => allUsers.filter((u) => (presenceMap[u.slack_id] ?? u.current_presence) === "active"),
    [allUsers, presenceMap],
  );

  async function triggerSync(type: "slack-users" | "user-mappings" | "presence") {
    setSyncing(type);
    setSyncMsg(null);
    try {
      let result;
      if (type === "slack-users") result = await admin.syncSlackUsers();
      else if (type === "user-mappings") result = await admin.syncUserMappings();
      else result = await admin.syncPresence();
      setSyncMsg(result.message);
      await refresh();
    } catch (e: unknown) {
      setSyncMsg(String(e));
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {/* Status bar */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="RTM Status" value={healthData?.rtm ?? "—"} color={healthData?.rtm === "connected" ? "green" : "red"} />
        <StatCard label="Currently Active" value={String(activeUsers.length)} color="blue" />
        <StatCard label="Total Users" value={String(allUsers.length)} color="gray" />
      </div>

      {/* Sync controls */}
      <div className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-medium text-gray-700">Manual Sync</h2>
        <div className="flex flex-wrap gap-2">
          <SyncButton label="Sync Slack Users" loading={syncing === "slack-users"} onClick={() => triggerSync("slack-users")} />
          <SyncButton label="Sync User Mappings" loading={syncing === "user-mappings"} onClick={() => triggerSync("user-mappings")} />
          <SyncButton label="Reconcile Presence" loading={syncing === "presence"} onClick={() => triggerSync("presence")} />
        </div>
        {syncMsg && <p className="text-sm text-gray-600 bg-gray-50 rounded px-3 py-2">{syncMsg}</p>}
      </div>

      {/* Active users */}
      <div className="rounded-xl border bg-white p-4">
        <h2 className="font-medium text-gray-700 mb-3">Currently Active ({activeUsers.length})</h2>
        {activeUsers.length === 0 ? (
          <p className="text-sm text-gray-400">No active users right now</p>
        ) : (
          <div className="divide-y">
            {activeUsers.map((u) => (
              <Link
                key={u.slack_id}
                to="/users/$slackId"
                params={{ slackId: u.slack_id }}
                className="flex items-center gap-3 py-2 hover:bg-gray-50 -mx-1 px-1 rounded"
              >
                {u.avatar_url && <img src={u.avatar_url} className="h-8 w-8 rounded-full" alt="" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.real_name ?? u.display_name}</p>
                  {u.current_status_text && (
                    <p className="text-xs text-gray-500 truncate">
                      {u.current_status_emoji} {u.current_status_text}
                    </p>
                  )}
                </div>
                <PresenceBadge presence={presenceMap[u.slack_id] ?? u.current_presence} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    green: "text-green-600",
    red: "text-red-500",
    blue: "text-blue-600",
    gray: "text-gray-700",
  };
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colors[color] ?? ""}`}>{value}</p>
    </div>
  );
}

function SyncButton({ label, loading, onClick }: { label: string; loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
    >
      {loading ? "Syncing…" : label}
    </button>
  );
}
