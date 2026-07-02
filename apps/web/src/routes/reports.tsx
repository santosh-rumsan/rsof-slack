import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { admin, settings, type ActiveHoursRow, type StatusTrendRow, type AppSetting } from "@/lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export const Route = createFileRoute("/reports")({
  component: ReportsPage,
});

type Tab = "active-hours" | "status-trends";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getSettingValue(s: AppSetting[], key: string, defaultValue: string): string {
  return s.find((x) => x.key === key)?.value ?? defaultValue;
}

function getCurrentWeekRange(): { from: string; to: string } {
  const today = new Date();
  const dow = today.getDay();
  const daysToMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysToMonday);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: monday.toISOString().split("T")[0],
    to: sunday.toISOString().split("T")[0],
  };
}

function ReportsPage() {
  const [tab, setTab] = useState<Tab>("active-hours");
  const defaultRange = getCurrentWeekRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [publicSettings, setPublicSettings] = useState<AppSetting[]>([]);

  useEffect(() => {
    settings.getPublic().then(setPublicSettings).catch(() => {});
  }, []);

  const timezone = getSettingValue(publicSettings, "TIMEZONE", "UTC");
  const workStart = parseInt(getSettingValue(publicSettings, "WORK_START_HOUR", "0"), 10);
  const workEnd = parseInt(getSettingValue(publicSettings, "WORK_END_HOUR", "24"), 10);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Reports</h1>

      {publicSettings.length > 0 && (
        <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 inline-block">
          Work window: <span className="font-medium text-gray-600">{workStart}:00–{workEnd}:00</span>
          {" "}in <span className="font-medium text-gray-600">{timezone}</span>
          {" "}· Data filtered to work hours only
        </div>
      )}

      {/* Date range */}
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-sm text-gray-500">From</label>
        <input type="date" className="rounded-lg border px-2 py-1 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label className="text-sm text-gray-500">To</label>
        <input type="date" className="rounded-lg border px-2 py-1 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {(["active-hours", "status-trends"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? "border-brand text-brand" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "active-hours" ? "Active Hours" : "Status Trends"}
          </button>
        ))}
      </div>

      <div>
        {tab === "active-hours" && <ActiveHoursTab from={from} to={to} />}
        {tab === "status-trends" && <StatusTrendsTab from={from} to={to} />}
      </div>
    </div>
  );
}

function ActiveHoursTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<ActiveHoursRow[]>([]);
  useEffect(() => {
    admin.activeHours(from || undefined, to || undefined).then(setData);
  }, [from, to]);

  // Build a 7×24 grid
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxVal = 1;
  for (const row of data) {
    grid[row.day_of_week][row.hour_of_day] = row.count;
    if (row.count > maxVal) maxVal = row.count;
  }

  return (
    <div className="overflow-x-auto">
      <p className="text-xs text-gray-400 mb-3">Each cell = number of presence-active events in that hour slot</p>
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="w-12" />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="w-7 text-center text-gray-400 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((day, d) => (
            <tr key={d}>
              <td className="pr-2 text-right text-gray-500 font-medium">{day}</td>
              {Array.from({ length: 24 }, (_, h) => {
                const v = grid[d][h];
                const intensity = Math.round((v / maxVal) * 255);
                const bg = v === 0 ? "#f3f4f6" : `rgb(${255 - Math.round(intensity * 0.7)}, ${255 - intensity}, ${255 - Math.round(intensity * 0.7)})`;
                return (
                  <td key={h} title={`${day} ${h}:00 — ${v} events`} className="w-7 h-7 border border-white rounded" style={{ backgroundColor: bg }} />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusTrendsTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<StatusTrendRow[]>([]);
  useEffect(() => {
    admin.statusTrends(from || undefined, to || undefined).then(setData);
  }, [from, to]);

  const COLORS = ["#4A154B", "#611f69", "#7c3aed", "#9333ea", "#a855f7", "#c084fc"];

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data.slice(0, 15)} margin={{ bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey={(r: StatusTrendRow) => `${r.status_emoji ?? ""} ${r.status_text ?? "(no text)"}`.trim()}
            tick={{ fontSize: 11 }}
            angle={-40}
            textAnchor="end"
            interval={0}
          />
          <YAxis />
          <Tooltip />
          <Bar dataKey="count" name="Times used" radius={[4, 4, 0, 0]}>
            {data.slice(0, 15).map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <table className="w-full text-sm border rounded-xl overflow-hidden min-w-[300px]">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-right">Count</th>
          </tr>
        </thead>
        <tbody className="divide-y bg-white">
          {data.map((r, i) => (
            <tr key={i}>
              <td className="px-4 py-2">{r.status_emoji} {r.status_text ?? <span className="text-gray-400">(no text)</span>}</td>
              <td className="px-4 py-2 text-right">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
