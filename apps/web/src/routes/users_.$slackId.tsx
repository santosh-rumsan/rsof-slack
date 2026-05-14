import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { admin, type SlackUser, type PresenceHistory, type DurationSummary } from "@/lib/api";
import { PresenceBadge } from "@/components/presence-badge";
import { usePresence } from "@/lib/presence-context";

export const Route = createFileRoute("/users_/$slackId")({
  component: UserDetailPage,
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

  // Future days: no data
  if (windowStart > now) return [];

  // Today: cap at current time
  const windowEnd = Math.min(rawWindowEnd, now);
  const dayMidnight = new Date(y, m, d, 0, 0, 0, 0).getTime();
  const nextMidnight = dayMidnight + 86400000;

  // Events strictly in this calendar day, ascending
  const dayEvents = history
    .filter((e) => {
      const t = new Date(e.recorded_at).getTime();
      return t >= dayMidnight && t < nextMidnight;
    })
    .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

  // State just before window starts
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

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function DayLabel({ date }: { date: Date }) {
  const isToday = new Date().toDateString() === date.toDateString();
  return (
    <span className={`text-xs w-16 flex-shrink-0 ${isToday ? "font-semibold text-gray-800" : "text-gray-400"}`}>
      {date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
    </span>
  );
}

function SegmentColor({ presence }: { presence: "active" | "away" | "unknown" }) {
  if (presence === "active") return "bg-green-400";
  if (presence === "away") return "bg-gray-200";
  return "bg-gray-100";
}

function getWeekRange(weekOffset: number): { from: Date; to: Date } {
  const today = new Date();
  const dow = today.getDay();
  const daysToMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysToMonday + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { from: monday, to: sunday };
}

function getWeekDays(weekOffset: number): Date[] {
  const { from } = getWeekRange(weekOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    return d;
  });
}

function Timeline({
  history,
  weekOffset,
  loading,
  onPrev,
  onNext,
}: {
  history: PresenceHistory[];
  weekOffset: number;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const days = getWeekDays(weekOffset);
  const { from, to } = getWeekRange(weekOffset);
  const isCurrentWeek = weekOffset === 0;

  const hours: number[] = [];
  for (let h = WORK_START; h <= WORK_END; h += 2) hours.push(h);

  const weekLabel = `${from.toLocaleDateString([], { month: "short", day: "numeric" })} – ${to.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-700">Daily Timeline</h3>
          <span className="text-xs text-gray-400">{weekLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{WORK_START}:00 – {WORK_END}:00</span>
          <button
            onClick={onPrev}
            disabled={loading}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <button
            onClick={onNext}
            disabled={isCurrentWeek || loading}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {days.map((date, di) => {
          const segments = buildDaySegments(history, date);
          return (
            <div key={di} className="flex items-center gap-3">
              <DayLabel date={date} />
              <div className="relative flex-1 h-7 bg-gray-100 rounded overflow-hidden">
                {hours.slice(1, -1).map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0 w-px bg-white/60"
                    style={{ left: `${((h - WORK_START) / (WORK_END - WORK_START)) * 100}%` }}
                  />
                ))}
                {segments.map((seg, si) => (
                  <div
                    key={si}
                    className={`absolute top-0 bottom-0 ${SegmentColor({ presence: seg.presence })}`}
                    style={{ left: `${seg.startPct}%`, width: `${seg.widthPct}%` }}
                    title={`${seg.presence}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="flex ml-[76px]">
        {hours.map((h) => (
          <span
            key={h}
            className="text-[10px] text-gray-400 flex-1 text-left"
            style={{ position: "relative", marginLeft: h === WORK_START ? "0" : undefined }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
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
  );
}

function UserDetailPage() {
  const { slackId } = Route.useParams();
  const [user, setUser] = useState<SlackUser | null>(null);
  const [history, setHistory] = useState<PresenceHistory[]>([]);
  const [duration, setDuration] = useState<DurationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const { presenceMap } = usePresence();

  useEffect(() => {
    const isFirst = !user;
    if (isFirst) setLoading(true);
    else setWeekLoading(true);
    const { from, to } = getWeekRange(weekOffset);
    const fromISO = from.toISOString();
    const toISO = to.toISOString();
    const userFetch = user ? Promise.resolve(user) : admin.getUser(slackId);
    Promise.all([
      userFetch,
      admin.getUserPresenceHistory(slackId, fromISO, toISO),
      admin.getUserDuration(slackId, fromISO, toISO),
    ])
      .then(([u, h, d]) => {
        setUser(u);
        setHistory(h);
        setDuration(d);
      })
      .finally(() => {
        setLoading(false);
        setWeekLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slackId, weekOffset]);

  if (loading) return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  if (!user) return <div className="p-6 text-sm text-red-500">User not found</div>;

  // Live presence from SSE overrides DB value if available
  const livePresence = presenceMap[user.slack_id] ?? user.current_presence;

  const activeSec = duration?.durations.find((d) => d.presence === "active")?.total_seconds ?? 0;
  const awaySec = duration?.durations.find((d) => d.presence === "away")?.total_seconds ?? 0;
  const total = activeSec + awaySec;
  const availPct = total > 0 ? ((activeSec / total) * 100).toFixed(1) : "—";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/users" className="text-sm text-gray-400 hover:text-brand">
          ← Users
        </Link>
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
            <PresenceBadge presence={livePresence} showLabel />
          </div>
          {user.email && <p className="text-sm text-gray-400">{user.email}</p>}
          {user.current_status_text && (
            <p className="text-sm text-gray-600 mt-1">
              {user.current_status_emoji} {user.current_status_text}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {user.is_dnd && (
              <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700">DnD</span>
            )}
            {user.is_busy && (
              <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">Busy</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Availability (week)</p>
          <p className="text-2xl font-bold text-brand">{availPct}%</p>
          <p className="text-xs text-gray-400">Active {fmtDuration(activeSec)}</p>
        </div>
      </div>

      {/* Day timeline */}
      <Timeline
        history={history}
        weekOffset={weekOffset}
        loading={weekLoading}
        onPrev={() => setWeekOffset((w) => w - 1)}
        onNext={() => setWeekOffset((w) => Math.min(w + 1, 0))}
      />

      {/* History table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <h3 className="font-medium text-gray-700 px-4 py-3 border-b">Presence Events</h3>
        {history.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No history for this week</p>
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
              {[...history]
                .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
                .slice(0, 100)
                .map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-2 text-gray-500">
                      {new Date(h.recorded_at).toLocaleString()}
                    </td>
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
