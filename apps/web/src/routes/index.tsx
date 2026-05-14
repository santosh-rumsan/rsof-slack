import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { admin, health, type SlackUser, type Health, getJwt } from "@/lib/api";
import { PresenceBadge } from "@/components/presence-badge";
import { usePresence } from "@/lib/presence-context";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

type SyncType = "slack-users" | "user-mappings" | "presence";

function SyncLogModal({
  type,
  onClose,
}: {
  type: SyncType;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const url = admin.syncStreamUrl(type);

    async function stream() {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${getJwt()}` },
        });
        if (!res.ok || !active) return;
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done: d } = await reader.read();
          if (d || !active) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n");
          buf = parts.pop()!;
          for (const part of parts) {
            if (!part.startsWith("data: ")) continue;
            try {
              const { log } = JSON.parse(part.slice(6)) as { log: string };
              if (active) setLines((prev) => [...prev, log]);
            } catch {
              // ignore
            }
          }
        }
      } catch (e: any) {
        if (active) setLines((prev) => [...prev, `Connection error: ${e.message}`]);
      } finally {
        if (active) setDone(true);
      }
    }

    stream();
    return () => { active = false; };
  }, [type]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const labels: Record<SyncType, string> = {
    "slack-users": "Sync Slack Users",
    "user-mappings": "Sync User Mappings",
    "presence": "Reconcile Presence",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 flex flex-col" style={{ maxHeight: "80vh" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-medium text-gray-800">{labels[type]}</h2>
          <div className="flex items-center gap-2">
            {!done && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium">
                running…
              </span>
            )}
            {done && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                complete
              </span>
            )}
            <button
              onClick={onClose}
              disabled={!done}
              className="text-sm text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 font-mono text-xs text-gray-700 bg-gray-950 text-green-400 rounded-b-xl space-y-0.5">
          {lines.length === 0 && !done && (
            <p className="text-gray-500">Starting…</p>
          )}
          {lines.map((line, i) => (
            <p key={i} className={line.startsWith("ERROR") ? "text-red-400" : line.startsWith("DONE") ? "text-cyan-300 font-bold" : "text-green-400"}>
              {line}
            </p>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const [healthData, setHealthData] = useState<Health | null>(null);
  const [allUsers, setAllUsers] = useState<SlackUser[]>([]);
  const [activeSync, setActiveSync] = useState<SyncType | null>(null);
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
          <SyncButton label="Sync Slack Users" onClick={() => setActiveSync("slack-users")} />
          <SyncButton label="Sync User Mappings" onClick={() => setActiveSync("user-mappings")} />
          <SyncButton label="Reconcile Presence" onClick={() => setActiveSync("presence")} />
        </div>
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

      {activeSync && (
        <SyncLogModal
          type={activeSync}
          onClose={() => { setActiveSync(null); refresh(); }}
        />
      )}
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

function SyncButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
    >
      {label}
    </button>
  );
}
