import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { admin, type PresenceSummaryRow, type ActiveHoursRow, type DndPatternRow, type StatusTrendRow } from "@/lib/api";
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

type Tab = "availability" | "active-hours" | "dnd" | "status-trends";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ReportsPage() {
  const [tab, setTab] = useState<Tab>("availability");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Reports</h1>

      {/* Date range */}
      <div className="flex gap-3 items-center">
        <label className="text-sm text-gray-500">From</label>
        <input type="date" className="rounded-lg border px-2 py-1 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label className="text-sm text-gray-500">To</label>
        <input type="date" className="rounded-lg border px-2 py-1 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(["availability", "active-hours", "dnd", "status-trends"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? "border-brand text-brand" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "availability" ? "Availability" : t === "active-hours" ? "Active Hours" : t === "dnd" ? "DnD Patterns" : "Status Trends"}
          </button>
        ))}
      </div>

      <div>
        {tab === "availability" && <AvailabilityTab from={from} to={to} />}
        {tab === "active-hours" && <ActiveHoursTab from={from} to={to} />}
        {tab === "dnd" && <DndTab from={from} to={to} />}
        {tab === "status-trends" && <StatusTrendsTab from={from} to={to} />}
      </div>
    </div>
  );
}

function AvailabilityTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<PresenceSummaryRow[]>([]);
  useEffect(() => {
    admin.presenceSummary(from || undefined, to || undefined).then(setData);
  }, [from, to]);

  const chartData = data.slice(0, 30).map((r) => ({
    name: r.display_name ?? r.real_name ?? r.slack_id,
    pct: r.availability_pct,
  }));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Bar dataKey="pct" fill="#4A154B" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <table className="w-full text-sm border rounded-xl overflow-hidden">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2 text-left">User</th>
            <th className="px-4 py-2 text-right">Active</th>
            <th className="px-4 py-2 text-right">Away</th>
            <th className="px-4 py-2 text-right">Availability</th>
          </tr>
        </thead>
        <tbody className="divide-y bg-white">
          {data.map((r) => (
            <tr key={r.slack_id}>
              <td className="px-4 py-2">{r.display_name ?? r.real_name ?? r.slack_id}</td>
              <td className="px-4 py-2 text-right text-gray-500">{fmtDuration(r.active_seconds)}</td>
              <td className="px-4 py-2 text-right text-gray-500">{fmtDuration(r.away_seconds)}</td>
              <td className="px-4 py-2 text-right font-medium">{r.availability_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
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

function DndTab({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<DndPatternRow[]>([]);
  useEffect(() => {
    admin.dndPatterns(from || undefined, to || undefined).then(setData);
  }, [from, to]);

  const chartData = data.slice(0, 20).map((r) => ({
    name: r.display_name ?? r.real_name ?? r.slack_id,
    count: r.dnd_count,
    avg: r.avg_duration_seconds ? Math.round(r.avg_duration_seconds / 60) : 0,
  }));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="count" name="DnD sessions" fill="#f97316" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <table className="w-full text-sm border rounded-xl overflow-hidden">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2 text-left">User</th>
            <th className="px-4 py-2 text-right">Sessions</th>
            <th className="px-4 py-2 text-right">Avg Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y bg-white">
          {data.map((r) => (
            <tr key={r.slack_id}>
              <td className="px-4 py-2">{r.display_name ?? r.real_name ?? r.slack_id}</td>
              <td className="px-4 py-2 text-right">{r.dnd_count}</td>
              <td className="px-4 py-2 text-right text-gray-500">
                {r.avg_duration_seconds ? fmtDuration(r.avg_duration_seconds) : "—"}
              </td>
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
      <table className="w-full text-sm border rounded-xl overflow-hidden">
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

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
