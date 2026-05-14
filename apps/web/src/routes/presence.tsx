import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { admin, settings, type SlackUser, type PresenceHistory } from "@/lib/api";
import { PresenceBadge } from "@/components/presence-badge";
import { usePresence } from "@/lib/presence-context";

export const Route = createFileRoute("/presence")({
  component: PresenceOverviewPage,
});

const ENV_WORK_START = parseInt(import.meta.env.VITE_WORK_START_HOUR ?? "7");
const ENV_WORK_END = parseInt(import.meta.env.VITE_WORK_END_HOUR ?? "23");

interface Segment {
  startPct: number;
  widthPct: number;
  presence: "active" | "away" | "unknown";
}

function localToUtcMs(dateStr: string, hour: number, tz: string): number {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
  try {
    const approx = new Date(`${dateStr}T${timeStr}Z`);
    const tzName = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "longOffset",
    }).formatToParts(approx).find((p) => p.type === "timeZoneName")?.value ?? "";
    const match = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return approx.getTime();
    const sign = match[1] === "+" ? 1 : -1;
    const offsetMs = sign * (parseInt(match[2]) * 60 + parseInt(match[3] ?? "0")) * 60000;
    return approx.getTime() - offsetMs;
  } catch {
    return new Date(`${dateStr}T${timeStr}`).getTime();
  }
}

function buildDaySegments(
  history: PresenceHistory[],
  date: Date,
  workStart: number,
  workEnd: number,
  timezone?: string | null,
): Segment[] {
  const now = Date.now();
  const workDurationMs = (workEnd - workStart) * 60 * 60 * 1000;
  const y = date.getFullYear();
  const mo = date.getMonth();
  const d = date.getDate();
  const dateStr = `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const windowStart = timezone
    ? localToUtcMs(dateStr, workStart, timezone)
    : new Date(y, mo, d, workStart, 0, 0, 0).getTime();
  const rawWindowEnd = timezone
    ? localToUtcMs(dateStr, workEnd, timezone)
    : new Date(y, mo, d, workEnd, 0, 0, 0).getTime();

  if (windowStart > now) return [];

  const windowEnd = Math.min(rawWindowEnd, now);
  const dayMidnight = timezone
    ? localToUtcMs(dateStr, 0, timezone)
    : new Date(y, mo, d, 0, 0, 0, 0).getTime();
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
        startPct: ((cursor - windowStart) / workDurationMs) * 100,
        widthPct: ((segEnd - cursor) / workDurationMs) * 100,
        presence: state,
      });
    }
    state = ev.presence as "active" | "away";
    cursor = evMs;
    if (cursor >= windowEnd) break;
  }

  if (cursor < windowEnd) {
    segments.push({
      startPct: ((cursor - windowStart) / workDurationMs) * 100,
      widthPct: ((windowEnd - cursor) / workDurationMs) * 100,
      presence: state,
    });
  }

  return segments;
}

function computeDayDuration(
  segments: Segment[],
  workStart: number,
  workEnd: number,
): { activeSec: number; awaySec: number } {
  const workDurationSec = (workEnd - workStart) * 3600;
  let activeSec = 0;
  let awaySec = 0;
  for (const seg of segments) {
    const sec = (seg.widthPct / 100) * workDurationSec;
    if (seg.presence === "active") activeSec += sec;
    else if (seg.presence === "away") awaySec += sec;
  }
  return { activeSec, awaySec };
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function getShortTzAbbr(timezone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

function segmentColor(presence: "active" | "away" | "unknown") {
  if (presence === "active") return "bg-green-400";
  if (presence === "away") return "bg-gray-200";
  return "bg-gray-100";
}

function UserPresenceBar({
  segments,
  workStart,
  workEnd,
  timezone,
  hours,
}: {
  segments: Segment[];
  workStart: number;
  workEnd: number;
  timezone?: string | null;
  hours: number[];
}) {
  const [hoverPct, setHoverPct] = useState<number | null>(null);

  function pctToTime(pct: number): string {
    const absMin = Math.round(workStart * 60) + Math.round((pct / 100) * (workEnd - workStart) * 60);
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const abbr = timezone ? getShortTzAbbr(timezone) : "";
    return abbr ? `${time} ${abbr}` : time;
  }

  return (
    <div className="relative flex-1 h-6">
      <div
        className="absolute inset-0 bg-gray-100 rounded overflow-hidden cursor-crosshair"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverPct(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
        }}
        onMouseLeave={() => setHoverPct(null)}
      >
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
            title={seg.presence}
          />
        ))}
        {hoverPct !== null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-gray-600 pointer-events-none z-10"
            style={{ left: `${hoverPct}%` }}
          />
        )}
      </div>
      {hoverPct !== null && (
        <div
          className="absolute pointer-events-none z-20"
          style={{ left: `${hoverPct}%`, bottom: "calc(100% + 2px)", transform: "translateX(-50%)" }}
        >
          <span className="text-[10px] bg-gray-800 text-white px-1.5 py-0.5 rounded whitespace-nowrap">
            {pctToTime(hoverPct)}
          </span>
        </div>
      )}
    </div>
  );
}

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

  const hours = useMemo(() => {
    const h: number[] = [];
    for (let i = workStart; i <= workEnd; i += 2) h.push(i);
    return h;
  }, [workStart, workEnd]);

  useEffect(() => {
    load(selectedDate);
  }, [selectedDate]);

  async function load(date: Date) {
    setLoading(true);
    try {
      const allUsers = await admin.listUsers();
      setUsers(allUsers);

      // UTC midnight of selected date ±14h covers all timezones (UTC-12 to UTC+14)
      const dayMs = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
      const from = new Date(dayMs - 14 * 3600000).toISOString();
      const to = new Date(dayMs + 38 * 3600000).toISOString();

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
    <div className="p-4 sm:p-6 space-y-4">
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
        <div className="rounded-xl border bg-white p-4 overflow-x-auto">
          {/* Header row */}
          <div className="flex items-center gap-3 mb-1">
            <div className="w-[192px] flex-shrink-0" />
            <div className="relative flex-1 ml-0">
              <div className="flex">
                {hours.map((h) => (
                  <span key={h} className="text-[10px] text-gray-400 flex-1">
                    {h}:00
                  </span>
                ))}
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0 w-[180px]">
              <span className="text-[10px] text-gray-400 w-14 text-right">Active</span>
              <span className="text-[10px] text-gray-400 w-14 text-right">Away</span>
              <span className="text-[10px] text-gray-400 w-14 text-right">Active %</span>
            </div>
          </div>

          {/* User rows */}
          <div className="space-y-1">
            {sortedUsers.map((user) => {
              const history = historyMap[user.slack_id] ?? [];
              const segments = buildDaySegments(history, selectedDate, workStart, workEnd, user.timezone);
              const livePresence = presenceMap[user.slack_id] ?? user.current_presence;
              const { activeSec, awaySec } = computeDayDuration(segments, workStart, workEnd);
              const total = activeSec + awaySec;
              const activePct = total > 0 ? `${((activeSec / total) * 100).toFixed(0)}%` : "—";

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

                  <UserPresenceBar
                    segments={segments}
                    workStart={workStart}
                    workEnd={workEnd}
                    timezone={user.timezone}
                    hours={hours}
                  />

                  <div className="flex gap-2 flex-shrink-0 w-[180px]">
                    <span className="text-xs text-green-600 w-14 text-right font-mono">
                      {activeSec > 0 ? fmtDuration(activeSec) : "—"}
                    </span>
                    <span className="text-xs text-gray-400 w-14 text-right font-mono">
                      {awaySec > 0 ? fmtDuration(awaySec) : "—"}
                    </span>
                    <span className="text-xs text-gray-700 w-14 text-right font-mono font-medium">
                      {activePct}
                    </span>
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
            <span className="ml-auto text-gray-300">{workStart}:00 – {workEnd}:00</span>
          </div>
        </div>
      )}
    </div>
  );
}
