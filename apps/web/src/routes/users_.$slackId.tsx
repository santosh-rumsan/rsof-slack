import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { admin, settings, type SlackUser, type PresenceHistory, type StatusHistory, type DurationSummary } from "@/lib/api";
import { PresenceBadge } from "@/components/presence-badge";
import { usePresence } from "@/lib/presence-context";
import { renderSlackEmoji, SlackText } from "@/lib/slack-emoji";

export const Route = createFileRoute("/users_/$slackId")({
  component: UserDetailPage,
});

const ENV_WORK_START = parseInt(import.meta.env.VITE_WORK_START_HOUR ?? "7");
const ENV_WORK_END = parseInt(import.meta.env.VITE_WORK_END_HOUR ?? "23");

interface Segment {
  startPct: number;
  widthPct: number;
  presence: "active" | "away" | "unknown";
  /** Status text active at the start of this segment, if any */
  statusText: string | null;
  statusEmoji: string | null;
}

/** Find what status was active at a given timestamp, using the status history sorted ascending. */
function statusAtTime(statusHistory: StatusHistory[], ts: number): { text: string | null; emoji: string | null } {
  let text: string | null = null;
  let emoji: string | null = null;
  for (const s of statusHistory) {
    if (new Date(s.recorded_at).getTime() <= ts) {
      text = s.status_text;
      emoji = s.status_emoji;
    } else {
      break;
    }
  }
  return { text, emoji };
}

function buildDaySegments(
  history: PresenceHistory[],
  statusHistory: StatusHistory[],
  date: Date,
  workStart: number,
  workEnd: number,
): Segment[] {
  const now = Date.now();
  const workDurationMs = (workEnd - workStart) * 60 * 60 * 1000;
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const windowStart = new Date(y, m, d, workStart, 0, 0, 0).getTime();
  const rawWindowEnd = new Date(y, m, d, workEnd, 0, 0, 0).getTime();

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
      const { text, emoji } = statusAtTime(statusHistory, cursor);
      segments.push({
        startPct: ((cursor - windowStart) / workDurationMs) * 100,
        widthPct: ((segEnd - cursor) / workDurationMs) * 100,
        presence: state,
        statusText: text,
        statusEmoji: emoji,
      });
    }
    state = ev.presence as "active" | "away";
    cursor = evMs;
    if (cursor >= windowEnd) break;
  }

  if (cursor < windowEnd) {
    const { text, emoji } = statusAtTime(statusHistory, cursor);
    segments.push({
      startPct: ((cursor - windowStart) / workDurationMs) * 100,
      widthPct: ((windowEnd - cursor) / workDurationMs) * 100,
      presence: state,
      statusText: text,
      statusEmoji: emoji,
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
    <span className={`text-xs w-24 flex-shrink-0 ${isToday ? "font-semibold text-gray-800" : "text-gray-400"}`}>
      {date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
    </span>
  );
}

function segmentColor(presence: "active" | "away" | "unknown"): string {
  if (presence === "active") return "bg-green-400";
  if (presence === "away") return "bg-gray-200";
  return "bg-gray-100";
}

function buildTooltip(seg: Segment): string {
  const parts: string[] = [seg.presence];
  if (seg.presence === "away" && (seg.statusText || seg.statusEmoji)) {
    const emoji = seg.statusEmoji ? renderSlackEmoji(seg.statusEmoji) : "";
    const text = seg.statusText ? renderSlackEmoji(seg.statusText) : "";
    parts.push(`${emoji} ${text}`.trim());
  }
  return parts.join(" — ");
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
  statusHistory,
  weekOffset,
  loading,
  workStart,
  workEnd,
  onPrev,
  onNext,
}: {
  history: PresenceHistory[];
  statusHistory: StatusHistory[];
  weekOffset: number;
  loading: boolean;
  workStart: number;
  workEnd: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const days = getWeekDays(weekOffset);
  const { from, to } = getWeekRange(weekOffset);
  const isCurrentWeek = weekOffset === 0;

  const hours: number[] = [];
  for (let h = workStart; h <= workEnd; h += 2) hours.push(h);

  const weekLabel = `${from.toLocaleDateString([], { month: "short", day: "numeric" })} – ${to.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-700">Daily Timeline</h3>
          <span className="text-xs text-gray-400">{weekLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{workStart}:00 – {workEnd}:00</span>
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
          const segments = buildDaySegments(history, statusHistory, date, workStart, workEnd);
          return (
            <div key={di} className="flex items-center gap-3">
              <DayLabel date={date} />
              <div className="relative flex-1 h-7 bg-gray-100 rounded overflow-hidden">
                {hours.slice(1, -1).map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 bottom-0 w-px bg-white/60"
                    style={{ left: `${((h - workStart) / (workEnd - workStart)) * 100}%` }}
                  />
                ))}
                {segments.map((seg, si) => (
                  <div
                    key={si}
                    className={`absolute top-0 bottom-0 ${segmentColor(seg.presence)}`}
                    style={{ left: `${seg.startPct}%`, width: `${seg.widthPct}%` }}
                    title={buildTooltip(seg)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="flex ml-[96px]">
        {hours.map((h) => (
          <span
            key={h}
            className="text-[10px] text-gray-400 flex-1 text-left"
            style={{ position: "relative", marginLeft: h === workStart ? "0" : undefined }}
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

/** Find what status was active at a given ISO timestamp from a sorted-ascending status history. */
function statusAtTimestamp(statusHistory: StatusHistory[], iso: string): { text: string | null; emoji: string | null } {
  const ts = new Date(iso).getTime();
  return statusAtTime(statusHistory, ts);
}

function UserDetailPage() {
  const { slackId } = Route.useParams();
  const [user, setUser] = useState<SlackUser | null>(null);
  const [history, setHistory] = useState<PresenceHistory[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([]);
  const [duration, setDuration] = useState<DurationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const { presenceMap } = usePresence();

  const [workStart, setWorkStart] = useState(ENV_WORK_START);
  const [workEnd, setWorkEnd] = useState(ENV_WORK_END);

  useEffect(() => {
    settings.getPublic().then((s) => {
      const start = s.find((x) => x.key === "WORK_START_HOUR");
      const end = s.find((x) => x.key === "WORK_END_HOUR");
      if (start) setWorkStart(parseInt(start.value, 10));
      if (end) setWorkEnd(parseInt(end.value, 10));
    }).catch(() => {});
  }, []);

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
      admin.getUserStatusHistory(slackId, fromISO, toISO),
      admin.getUserDuration(slackId, fromISO, toISO),
    ])
      .then(([u, h, sh, d]) => {
        setUser(u);
        setHistory(h);
        setStatusHistory(sh);
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

  // Sort status history ascending for lookup
  const sortedStatusHistory = [...statusHistory].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );

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
              {user.current_status_emoji ? <SlackText text={user.current_status_emoji} /> : null}{" "}
              <SlackText text={user.current_status_text} />
            </p>
          )}
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
        statusHistory={sortedStatusHistory}
        weekOffset={weekOffset}
        loading={weekLoading}
        workStart={workStart}
        workEnd={workEnd}
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
                <th className="px-4 py-2 text-left">Status at event</th>
                <th className="px-4 py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...history]
                .sort((a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime())
                .slice(0, 100)
                .map((h) => {
                  const { text, emoji } = statusAtTimestamp(sortedStatusHistory, h.recorded_at);
                  return (
                    <tr key={h.id}>
                      <td className="px-4 py-2 text-gray-500">
                        {new Date(h.recorded_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <PresenceBadge presence={h.presence as "active" | "away"} showLabel />
                      </td>
                      <td className="px-4 py-2 text-gray-600 text-xs">
                        {(text || emoji) ? (
                          <>
                            {emoji ? <SlackText text={emoji} /> : null}{" "}
                            {text ? <SlackText text={text} /> : null}
                          </>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-400 text-xs">{h.source}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
