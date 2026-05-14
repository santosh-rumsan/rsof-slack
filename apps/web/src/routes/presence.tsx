import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { admin, type SlackUser, type PresenceHistory } from "@/lib/api";
import { PresenceBadge } from "@/components/presence-badge";
import { usePresence } from "@/lib/presence-context";

export const Route = createFileRoute("/presence")({
  component: PresenceOverviewPage,
});

const WORK_START = parseInt(import.meta.env.VITE_WORK_START_HOUR ?? "7");
const WORK_END = parseInt(import.meta.env.VITE_WORK_END_HOUR ?? "23");
const WORK_DURATION_MS = (WORK_END - WORK_START) * 60 * 60 * 1000;

interface Segment {
  startPct: number;
  widthPct: number;
  presence: "active" | "away" | "unknown";
}

function buildDaySegments(history: PresenceHistory[], date: Date): Segment[] {
  const now = Date.now();
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const windowStart = new Date(y, m, d, WORK_START, 0, 0, 0).getTime();
  const rawWindowEnd = new Date(y, m, d, WORK_END, 0, 0, 0).getTime();

  if (windowStart > now) return [];

  const windowEnd = Math.min(rawWindowEnd, now);
  const dayMidnight = new Date(y, m, d, 0, 0, 0, 0).getTime();
  const nextMidnight = dayMidnight + 86400000;

  const dayEvents = history
    .filter((e) => {
      const t = new Date(e.recorded_at).getTime();
      return t >= dayMidnight && t < nextMidnight;
    })
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

  const prior = history
    .filter((e) => new Date(e.recorded_at).getTime() < windowStart)
    .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime());

  let state: "active" | "away" | "unknown" =
    prior.length > 0 ? (prior[0].presence as "active" | "away") : "unknown";

  const segments: Segment[] = [];
  let cursor = windowStart;

  for (const ev of dayEvents) {
    const evMs = new Date(ev.recorded_at).getTime();
    if (evMs <= windowStart) {
      state = ev.presence as "active" | "away";
      continue;
    }
    const segEnd = Math.min(evMs, windowEnd);
    if (segEnd > cursor) {
      segments.push({
        startPct: ((cursor - windowStart) / WORK_DURATION_MS) * 100,
        widthPct: ((segEnd - cursor) / WORK_DURATION_MS) * 100,
        presence: state,
      });
    }
    state = ev.presence as "active" | "away";
    cursor = evMs;
    if (cursor >= windowEnd) break;
  }

  if (cursor < windowEnd) {
    segments.push({
      startPct: ((cursor - windowStart) / WORK_DURATION_MS) * 100,
      widthPct: ((windowEnd - cursor) / WORK_DURATION_MS) * 100,
      presence: state,
    });
  }

  return segments;
}

function segmentColor(presence: "active" | "away" | "unknown") {
  if (presence === "active") return "bg-green-400";
  if (presence === "away") return "bg-gray-200";
  return "bg-gray-100";
}

const HOURS: number[] = [];
for (let h = WORK_START; h <= WORK_END; h += 2) HOURS.push(h);

function PresenceOverviewPage() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [users, setUsers] = useState<SlackUser[]>([]);
  const [historyMap, setHistoryMap] = useState<Record<string, PresenceHistory[]>>({});
  const [loading, setLoading] = useState(true);
  const { presenceMap } = usePresence();

  useEffect(() => {
    load(selectedDate);
  }, [selectedDate]);

  async function load(date: Date) {
    setLoading(true);
    try {
      const allUsers = await admin.listUsers();
      setUsers(allUsers);

      const y = date.getFullYear();
      const mo = date.getMonth();
      const d = date.getDate();
      const from = new Date(y, mo, d, 0, 0, 0, 0).toISOString();
      const to = new Date(y, mo, d + 1, 0, 0, 0, 0).toISOString();

      const histories = await Promise.all(
        allUsers.map((u) => admin.getUserPresenceHistory(u.slack_id, from, to).catch(() => [])),
      );

      const map: Record<string, PresenceHistory[]> = {};
      allUsers.forEach((u, i) => {
        map[u.slack_id] = histories[i];
      });
      setHistoryMap(map);
    } finally {
      setLoading(false);
    }
  }

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      const aActive = (presenceMap[a.slack_id] ?? a.current_presence) === "active" ? 0 : 1;
      const bActive = (presenceMap[b.slack_id] ?? b.current_presence) === "active" ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (a.real_name ?? a.display_name ?? "").localeCompare(b.real_name ?? b.display_name ?? "");
    });
  }, [users, presenceMap]);

  const isToday = selectedDate.toDateString() === today.toDateString();

  function changeDate(delta: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Presence Overview</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeDate(-1)}
            className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
          >
            ←
          </button>
          <span className="text-sm font-medium w-40 text-center">
            {selectedDate.toLocaleDateString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          <button
            onClick={() => changeDate(1)}
            disabled={isToday}
            className="rounded border px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-40"
          >
            →
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="rounded-xl border bg-white p-4">
          {/* Hour labels */}
          <div className="flex mb-2 ml-[200px]">
            {HOURS.map((h) => (
              <span key={h} className="text-[10px] text-gray-400 flex-1">
                {h}:00
              </span>
            ))}
          </div>

          {/* User rows */}
          <div className="space-y-1">
            {sortedUsers.map((user) => {
              const history = historyMap[user.slack_id] ?? [];
              const segments = buildDaySegments(history, selectedDate);
              const livePresence = presenceMap[user.slack_id] ?? user.current_presence;

              return (
                <div key={user.slack_id} className="flex items-center gap-3">
                  <Link
                    to="/users/$slackId"
                    params={{ slackId: user.slack_id }}
                    className="flex items-center gap-2 w-[192px] flex-shrink-0 hover:opacity-75 min-w-0"
                  >
                    {user.avatar_url ? (
                      <img
                        src={user.avatar_url}
                        className="h-6 w-6 rounded-full flex-shrink-0"
                        alt=""
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-xs font-bold text-gray-500">
                        {(user.real_name ?? user.display_name ?? "?")[0].toUpperCase()}
                      </div>
                    )}
                    <span className="text-xs truncate flex-1">
                      {user.real_name ?? user.display_name}
                    </span>
                    {isToday && <PresenceBadge presence={livePresence} />}
                  </Link>

                  <div className="relative flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                    {/* Hour grid lines */}
                    {HOURS.slice(1, -1).map((h) => (
                      <div
                        key={h}
                        className="absolute top-0 bottom-0 w-px bg-white/60"
                        style={{ left: `${((h - WORK_START) / (WORK_END - WORK_START)) * 100}%` }}
                      />
                    ))}
                    {segments.map((seg, si) => (
                      <div
                        key={si}
                        className={`absolute top-0 bottom-0 ${segmentColor(seg.presence)}`}
                        style={{ left: `${seg.startPct}%`, width: `${seg.widthPct}%` }}
                        title={seg.presence}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-gray-500 mt-3 pt-3 border-t">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-green-400" /> Active
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-gray-200" /> Away
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-gray-100 border" /> No data
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
