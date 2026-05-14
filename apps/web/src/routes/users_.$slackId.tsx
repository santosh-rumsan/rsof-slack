import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { admin, settings, type SlackUser, type PresenceHistory, type StatusHistory, type DurationSummary } from "@/lib/api";
import { PresenceBadge } from "@/components/presence-badge";
import { usePresence } from "@/lib/presence-context";
import { renderSlackEmoji, SlackText } from "@/lib/slack-emoji";

export const Route = createFileRoute("/users_/$slackId")({
  component: UserDetailPage,
});

const ENV_WORK_START = parseFloat(import.meta.env.VITE_WORK_START_HOUR ?? "7");
const ENV_WORK_END = parseFloat(import.meta.env.VITE_WORK_END_HOUR ?? "23");

interface Segment {
  startPct: number;
  widthPct: number;
  presence: "active" | "away" | "unknown";
  /** Status text active at the start of this segment, if any */
  statusText: string | null;
  statusEmoji: string | null;
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
    : new Date(y, mo, d, Math.floor(workStart), Math.round((workStart % 1) * 60), 0, 0).getTime();
  const rawWindowEnd = timezone
    ? localToUtcMs(dateStr, workEnd, timezone)
    : new Date(y, mo, d, Math.floor(workEnd), Math.round((workEnd % 1) * 60), 0, 0).getTime();

  // Future days: no data
  if (windowStart > now) return [];

  // Today: cap at current time
  const windowEnd = Math.min(rawWindowEnd, now);
  const dayMidnight = timezone
    ? localToUtcMs(dateStr, 0, timezone)
    : new Date(y, mo, d, 0, 0, 0, 0).getTime();
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

function UserLocalClock({ timezone }: { timezone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <>{now.toLocaleTimeString(undefined, { timeZone: timezone, hour: "2-digit", minute: "2-digit" })}</>
  );
}

function fmtDecimalHour(h: number): string {
  const hours = Math.floor(h);
  const minutes = Math.round((h - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
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

function DayLabel({ date }: { date: Date }) {
  const isToday = new Date().toDateString() === date.toDateString();
  const cls = `text-xs flex-shrink-0 ${isToday ? "font-semibold text-gray-800" : "text-gray-400"}`;
  return (
    <>
      <span className={`${cls} w-8 sm:hidden`}>
        {date.toLocaleDateString([], { weekday: "short" })}
      </span>
      <span className={`${cls} w-24 hidden sm:inline`}>
        {date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
      </span>
    </>
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

function TimelineBar({
  segments,
  hours,
  workStart,
  workEnd,
  timezone,
}: {
  segments: Segment[];
  hours: number[];
  workStart: number;
  workEnd: number;
  timezone?: string | null;
}) {
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [clickTooltip, setClickTooltip] = useState<{ pct: number; text: string } | null>(null);

  function pctToTime(pct: number): string {
    const absMin = Math.round(workStart * 60) + Math.round((pct / 100) * (workEnd - workStart) * 60);
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const abbr = timezone ? getShortTzAbbr(timezone) : "";
    return abbr ? `${time} ${abbr}` : time;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPct(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
  }

  function handleSegmentClick(e: React.MouseEvent, seg: Segment) {
    if (!seg.statusText && !seg.statusEmoji) return;
    e.stopPropagation();
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const pct = Math.max(2, Math.min(98, ((e.clientX - rect.left) / rect.width) * 100));
    const emoji = seg.statusEmoji ? renderSlackEmoji(seg.statusEmoji) : "";
    const text = seg.statusText ? renderSlackEmoji(seg.statusText) : "";
    setClickTooltip({ pct, text: `${emoji} ${text}`.trim() });
  }

  return (
    <div className="relative flex-1" onClick={() => setClickTooltip(null)}>
      <div
        className="relative h-7 bg-gray-100 rounded overflow-hidden cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverPct(null)}
      >
        {hours.filter((h) => h > workStart && h < workEnd).map((h) => (
          <div
            key={h}
            className="absolute top-0 bottom-0 w-px bg-white/60"
            style={{ left: `${((h - workStart) / (workEnd - workStart)) * 100}%` }}
          />
        ))}
        {segments.map((seg, si) => (
          <div
            key={si}
            className={`absolute top-0 bottom-0 ${segmentColor(seg.presence)} ${seg.statusText || seg.statusEmoji ? "cursor-pointer" : ""}`}
            style={{ left: `${seg.startPct}%`, width: `${seg.widthPct}%` }}
            title={buildTooltip(seg)}
            onClick={(e) => handleSegmentClick(e, seg)}
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
          className="absolute -translate-x-1/2 pointer-events-none z-20"
          style={{ left: `${hoverPct}%`, bottom: "calc(100% + 2px)" }}
        >
          <span className="text-[10px] bg-gray-800 text-white px-1.5 py-0.5 rounded whitespace-nowrap">
            {pctToTime(hoverPct)}
          </span>
        </div>
      )}
      {clickTooltip && (
        <div
          className="absolute -translate-x-1/2 z-30 bg-white border rounded shadow-md px-2 py-1 text-xs text-gray-700 whitespace-nowrap"
          style={{ left: `${clickTooltip.pct}%`, top: "calc(100% + 4px)" }}
        >
          {clickTooltip.text}
        </div>
      )}
    </div>
  );
}

function Timeline({
  history,
  statusHistory,
  weekOffset,
  loading,
  workStart,
  workEnd,
  timezone,
  onPrev,
  onNext,
}: {
  history: PresenceHistory[];
  statusHistory: StatusHistory[];
  weekOffset: number;
  loading: boolean;
  workStart: number;
  workEnd: number;
  timezone?: string | null;
  onPrev: () => void;
  onNext: () => void;
}) {
  const days = getWeekDays(weekOffset);
  const { from, to } = getWeekRange(weekOffset);
  const isCurrentWeek = weekOffset === 0;

  const hours: number[] = [];
  for (let h = Math.ceil(workStart); h <= Math.floor(workEnd); h += 1) hours.push(h);

  const weekLabel = `${from.toLocaleDateString([], { month: "short", day: "numeric" })} – ${to.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="rounded-xl border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-700">Daily Timeline</h3>
          <span className="text-xs text-gray-400">{weekLabel}</span>
          {timezone && (
            <span className="text-xs text-gray-400 bg-gray-50 border rounded px-1.5 py-0.5">
              {getShortTzAbbr(timezone)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{fmtDecimalHour(workStart)} – {fmtDecimalHour(workEnd)}</span>
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

      <div className="flex items-center gap-3 mb-1">
        <span className="w-8 sm:w-24 flex-shrink-0" />
        <div className="flex-1" />
        <div className="flex gap-2 flex-shrink-0 w-[120px] sm:w-[180px]">
          <span className="text-[10px] text-gray-400 w-14 text-right">Active</span>
          <span className="text-[10px] text-gray-400 w-14 text-right">Away</span>
          <span className="hidden sm:block text-[10px] text-gray-400 w-14 text-right">Active %</span>
        </div>
      </div>

      <div className="space-y-2 overflow-x-auto">
        {days.map((date, di) => {
          const segments = buildDaySegments(history, statusHistory, date, workStart, workEnd, timezone);
          const { activeSec, awaySec } = computeDayDuration(segments, workStart, workEnd);
          const total = activeSec + awaySec;
          const activePct = total > 0 ? `${((activeSec / total) * 100).toFixed(0)}%` : "—";
          return (
            <div key={di} className="flex items-center gap-3">
              <DayLabel date={date} />
              <TimelineBar segments={segments} hours={hours} workStart={workStart} workEnd={workEnd} timezone={timezone} />
              <div className="flex gap-2 flex-shrink-0 w-[120px] sm:w-[180px]">
                <span className="text-xs text-green-600 w-14 text-right font-mono">
                  {activeSec > 0 ? fmtDuration(activeSec) : "—"}
                </span>
                <span className="text-xs text-gray-400 w-14 text-right font-mono">
                  {awaySec > 0 ? fmtDuration(awaySec) : "—"}
                </span>
                <span className="hidden sm:block text-xs text-gray-700 w-14 text-right font-mono font-medium">
                  {activePct}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="relative ml-8 sm:ml-[96px] mr-[132px] sm:mr-[192px] h-4">
        {hours.map((h) => (
          <span
            key={h}
            className="absolute text-[10px] text-gray-400 -translate-x-1/2"
            style={{ left: `${((h - workStart) / (workEnd - workStart)) * 100}%` }}
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

function fmtIdleDuration(lastActiveAt: string): string {
  const ms = Date.now() - new Date(lastActiveAt).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${(secs / 3600).toFixed(1)}h`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

function TimezoneEditor({
  slackId,
  timezone,
  availableTimezones,
  onSaved,
}: {
  slackId: string;
  timezone: string | null;
  availableTimezones: string[];
  onSaved: (tz: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(timezone ?? availableTimezones[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = timezone && !availableTimezones.includes(timezone)
    ? [timezone, ...availableTimezones]
    : availableTimezones;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await admin.updateUserTimezone(slackId, value || null);
      onSaved(result.timezone);
      setEditing(false);
    } catch (e: any) {
      setError(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setValue(timezone ?? availableTimezones[0] ?? ""); setEditing(true); setError(null); }}
        className="text-xs text-gray-400 hover:text-brand underline-offset-2 hover:underline"
      >
        {timezone ? `${timezone} · ` : "Set timezone"}
        {timezone && <UserLocalClock timezone={timezone} />}
        {timezone && <span className="ml-1 text-gray-300">(edit)</span>}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1 flex-wrap">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="text-xs border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-brand"
        disabled={saving}
      >
        {options.map((tz) => (
          <option key={tz} value={tz}>{tz}</option>
        ))}
      </select>
      <button
        onClick={save}
        disabled={saving}
        className="text-xs text-brand font-medium hover:underline disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        onClick={() => setEditing(false)}
        className="text-xs text-gray-400 hover:text-gray-600"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
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
  const [timezone, setTimezone] = useState<string | null>(null);
  const [history, setHistory] = useState<PresenceHistory[]>([]);
  const [statusHistory, setStatusHistory] = useState<StatusHistory[]>([]);
  const [duration, setDuration] = useState<DurationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [weekLoading, setWeekLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const { presenceMap } = usePresence();

  const [workStart, setWorkStart] = useState(ENV_WORK_START);
  const [workEnd, setWorkEnd] = useState(ENV_WORK_END);

  const [availableTimezones, setAvailableTimezones] = useState<string[]>(["Asia/Kathmandu"]);

  useEffect(() => {
    settings.getPublic().then((s) => {
      const start = s.find((x) => x.key === "WORK_START_HOUR");
      const end = s.find((x) => x.key === "WORK_END_HOUR");
      if (start) setWorkStart(parseFloat(start.value));
      if (end) setWorkEnd(parseFloat(end.value));
      const tzSetting = s.find((x) => x.key === "AVAILABLE_TIMEZONES");
      if (tzSetting) {
        const list = tzSetting.value.split("\n").map((t) => t.trim()).filter(Boolean);
        if (list.length > 0) setAvailableTimezones(list);
      }
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
        setTimezone(u.timezone);
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

  // Find when the current presence state began (earliest record in trailing same-state run)
  const lastHistoryRecord = (() => {
    if (history.length === 0) return null;
    const sorted = [...history].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    const last = sorted[sorted.length - 1];
    let stateStart = last;
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (sorted[i].presence !== last.presence) break;
      stateStart = sorted[i];
    }
    return stateStart;
  })();

  const activeSec = duration?.durations.find((d) => d.presence === "active")?.total_seconds ?? 0;
  const awaySec = duration?.durations.find((d) => d.presence === "away")?.total_seconds ?? 0;
  const total = activeSec + awaySec;
  const availPct = total > 0 ? ((activeSec / total) * 100).toFixed(1) : "—";

  // Sort status history ascending for lookup
  const sortedStatusHistory = [...statusHistory].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/users" className="text-sm text-gray-400 hover:text-brand">
          ← Users
        </Link>
      </div>

      {/* User card */}
      <div className="rounded-xl border bg-white p-4 flex flex-col sm:flex-row items-start gap-4">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          {user.avatar_url ? (
            <img src={user.avatar_url} className="h-16 w-16 rounded-full flex-shrink-0" alt="" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-xl font-bold text-gray-400">
              {(user.real_name ?? user.display_name ?? "?")[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-semibold">{user.real_name ?? user.display_name}</h2>
              <PresenceBadge presence={livePresence} showLabel />
            </div>
            {user.email && <p className="text-sm text-gray-400">{user.email}</p>}
            <p className="text-xs text-gray-400 mt-0.5">
              <TimezoneEditor
                slackId={user.slack_id}
                timezone={timezone}
                availableTimezones={availableTimezones}
                onSaved={(tz) => setTimezone(tz)}
              />
            </p>
            {user.current_status_text && (
              <p className="text-sm text-gray-600 mt-1">
                {user.current_status_emoji ? <SlackText text={user.current_status_emoji} /> : null}{" "}
                <SlackText text={user.current_status_text} />
              </p>
            )}
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-xs text-gray-400">Availability (week)</p>
          <p className="text-2xl font-bold text-brand">{availPct}%</p>
          {(lastHistoryRecord || user.last_active_at) && (
            <p className="text-xs mt-0.5 flex sm:flex-col sm:items-end items-center gap-1 flex-wrap">
              {lastHistoryRecord ? (
                lastHistoryRecord.presence === "active" ? (
                  <span className="text-green-600">
                    Active for {fmtIdleDuration(lastHistoryRecord.recorded_at)}
                  </span>
                ) : (
                  <span className="text-amber-500">
                    Idle for {fmtIdleDuration(lastHistoryRecord.recorded_at)}
                  </span>
                )
              ) : livePresence === "away" ? (
                <span className="text-amber-500">
                  Idle {fmtIdleDuration(user.last_active_at!)}
                </span>
              ) : null}
              {user.last_active_at && (
                <span className="text-gray-400">
                  last active{" "}
                  {new Date(user.last_active_at).toLocaleTimeString(undefined, {
                    ...(timezone ? { timeZone: timezone } : {}),
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {timezone && ` ${getShortTzAbbr(timezone)}`}
                </span>
              )}
            </p>
          )}
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
        timezone={timezone}
        onPrev={() => setWeekOffset((w) => w - 1)}
        onNext={() => setWeekOffset((w) => Math.min(w + 1, 0))}
      />

      {/* History table */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <h3 className="font-medium text-gray-700 px-4 py-3 border-b">Presence Events</h3>
        {history.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No history for this week</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[400px]">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">
                    Time{timezone && (
                      <span className="text-gray-300 normal-case font-normal ml-1">
                        ({getShortTzAbbr(timezone)})
                      </span>
                    )}
                  </th>
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
                          {new Date(h.recorded_at).toLocaleString(undefined, {
                            ...(timezone ? { timeZone: timezone } : {}),
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
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
          </div>
        )}
      </div>
    </div>
  );
}
