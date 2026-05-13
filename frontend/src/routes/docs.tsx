import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/docs")({
  component: DocsPage,
});

interface Endpoint {
  method: "GET" | "POST";
  path: string;
  description: string;
  params?: { name: string; type: string; desc: string }[];
  curl: string;
  example?: string;
}

const BASE = "http://localhost:8000/api/v1";
const AUTH = '-H "X-API-Key: $API_KEY"';

const sections: { title: string; endpoints: Endpoint[] }[] = [
  {
    title: "Health",
    endpoints: [
      {
        method: "GET",
        path: "/health",
        description: "Returns API and RTM connection status. No auth required.",
        curl: `curl ${BASE}/health`,
        example: `{"status":"ok","rtm":"connected"}`,
      },
    ],
  },
  {
    title: "Sync",
    endpoints: [
      {
        method: "POST",
        path: "/admin/sync/slack-users",
        description: "Pull all users from Slack and upsert into the database.",
        curl: `curl -X POST ${BASE}/admin/sync/slack-users ${AUTH}`,
        example: `{"message":"Sync complete: {'created': 2, 'updated': 5, 'deactivated': 0}"}`,
      },
      {
        method: "POST",
        path: "/admin/sync/user-mappings",
        description: "Sync user mappings from the rs-office user management API.",
        curl: `curl -X POST ${BASE}/admin/sync/user-mappings ${AUTH}`,
        example: `{"message":"Sync complete: {'mapped': 12}"}`,
      },
      {
        method: "POST",
        path: "/admin/sync/presence",
        description: "Poll current presence for all active users and reconcile (only writes on change).",
        curl: `curl -X POST ${BASE}/admin/sync/presence ${AUTH}`,
        example: `{"message":"Reconciliation complete: {'checked': 30, 'changed': 2}"}`,
      },
      {
        method: "GET",
        path: "/admin/sync/status",
        description: "Returns scheduled job metadata (next run times).",
        curl: `curl ${BASE}/admin/sync/status ${AUTH}`,
        example: `{"jobs":[{"job_id":"user_sync","last_run":null,"next_run":"2026-05-13T10:15:00"},{"job_id":"presence_reconcile","last_run":null,"next_run":"2026-05-13T10:05:00"}]}`,
      },
    ],
  },
  {
    title: "Events (SSE)",
    endpoints: [
      {
        method: "GET",
        path: "/admin/events/presence",
        description:
          "Server-Sent Events stream of real-time presence changes. Each event is a JSON object. Connection is long-lived; the server sends a keepalive comment every 30 s.",
        curl: `curl -N ${BASE}/admin/events/presence ${AUTH}`,
        example: `data: {"slack_id":"U123","presence":"active","source":"rtm","real_name":"Alice","display_name":"alice","avatar_url":"https://...","ts":"2026-05-13T10:01:00+00:00"}\n\ndata: {"slack_id":"U456","presence":"away","source":"rtm",...}`,
      },
    ],
  },
  {
    title: "Users",
    endpoints: [
      {
        method: "GET",
        path: "/admin/users",
        description: "List Slack users. All params optional.",
        params: [
          { name: "ids", type: "string", desc: "Comma-separated Slack IDs to filter" },
          { name: "presence", type: "active | away", desc: "Filter by current presence" },
          { name: "active_only", type: "boolean", desc: "Only return non-deactivated users (default false)" },
        ],
        curl: `curl "${BASE}/admin/users?presence=active&active_only=true" ${AUTH}`,
        example: `[{"slack_id":"U123","real_name":"Alice","current_presence":"active",...}]`,
      },
      {
        method: "GET",
        path: "/admin/users/:slack_id",
        description: "Get a single user by Slack ID.",
        curl: `curl ${BASE}/admin/users/U123 ${AUTH}`,
      },
      {
        method: "GET",
        path: "/admin/users/:slack_id/presence-history",
        description: "Presence history records for a user.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range (inclusive)" },
          { name: "to", type: "ISO datetime", desc: "End of range (inclusive)" },
        ],
        curl: `curl "${BASE}/admin/users/U123/presence-history?from=2026-05-01" ${AUTH}`,
        example: `[{"id":1,"slack_id":"U123","presence":"active","source":"rtm","recorded_at":"2026-05-01T09:00:00"}]`,
      },
      {
        method: "GET",
        path: "/admin/users/:slack_id/status-history",
        description: "Status history records (status text, emoji, busy, DND).",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/users/U123/status-history?from=2026-05-01" ${AUTH}`,
      },
      {
        method: "GET",
        path: "/admin/users/:slack_id/duration-summary",
        description: "Total seconds spent in each presence state within the window.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/users/U123/duration-summary?from=2026-05-01" ${AUTH}`,
        example: `{"slack_id":"U123","from_dt":"2026-05-01","to_dt":null,"durations":[{"presence":"active","total_seconds":18000},{"presence":"away","total_seconds":7200}]}`,
      },
    ],
  },
  {
    title: "Reports",
    endpoints: [
      {
        method: "GET",
        path: "/admin/reports/currently-active",
        description: "Users whose current_presence is 'active'.",
        curl: `curl ${BASE}/admin/reports/currently-active ${AUTH}`,
        example: `{"count":5,"users":[...]}`,
      },
      {
        method: "GET",
        path: "/admin/reports/presence-summary",
        description: "Per-user total active/away seconds and availability percentage.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/reports/presence-summary?from=2026-05-01" ${AUTH}`,
        example: `[{"slack_id":"U123","real_name":"Alice","active_seconds":28800,"away_seconds":7200,"availability_pct":80.0}]`,
      },
      {
        method: "GET",
        path: "/admin/reports/active-hours",
        description: "Heatmap data: presence count per (day_of_week, hour_of_day).",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/reports/active-hours?from=2026-05-01" ${AUTH}`,
        example: `[{"day_of_week":1,"hour_of_day":9,"count":45},...]`,
      },
      {
        method: "GET",
        path: "/admin/reports/availability",
        description: "Ranked list of users by availability percentage.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/reports/availability?from=2026-05-01" ${AUTH}`,
      },
      {
        method: "GET",
        path: "/admin/reports/dnd-patterns",
        description: "DND frequency and average duration per user.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/reports/dnd-patterns?from=2026-05-01" ${AUTH}`,
      },
      {
        method: "GET",
        path: "/admin/reports/status-trends",
        description: "Most-used status texts/emojis ranked by frequency.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
          { name: "limit", type: "integer", desc: "Max results (default 20)" },
        ],
        curl: `curl "${BASE}/admin/reports/status-trends?limit=10" ${AUTH}`,
        example: `[{"status_text":"In a meeting","status_emoji":":spiral_calendar:","count":42}]`,
      },
      {
        method: "GET",
        path: "/admin/reports/inactive-users",
        description: "Active users with no recent 'active' presence.",
        params: [
          { name: "days", type: "integer", desc: "Inactivity threshold in days (default 7)" },
        ],
        curl: `curl "${BASE}/admin/reports/inactive-users?days=3" ${AUTH}`,
        example: `[{"slack_id":"U789","real_name":"Bob","last_presence_update":"2026-05-10T08:00:00"}]`,
      },
    ],
  },
];

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  return (
    <span
      className={`text-xs font-bold px-1.5 py-0.5 rounded font-mono ${
        method === "GET" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
      }`}
    >
      {method}
    </span>
  );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        <MethodBadge method={ep.method} />
        <code className="text-sm font-mono text-gray-800">{ep.path}</code>
        <span className="ml-2 text-sm text-gray-500 truncate flex-1">{ep.description}</span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t px-4 py-4 space-y-4 bg-gray-50">
          <p className="text-sm text-gray-700">{ep.description}</p>

          {ep.params && ep.params.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Query Parameters</p>
              <table className="text-sm w-full">
                <tbody>
                  {ep.params.map((p) => (
                    <tr key={p.name} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-xs font-medium text-gray-800 whitespace-nowrap">{p.name}</td>
                      <td className="py-1.5 pr-3 text-xs text-gray-500 whitespace-nowrap">{p.type}</td>
                      <td className="py-1.5 text-xs text-gray-600">{p.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Example Request</p>
            <pre className="bg-gray-900 text-green-400 text-xs rounded-lg px-4 py-3 overflow-x-auto whitespace-pre-wrap">
              {ep.curl}
            </pre>
          </div>

          {ep.example && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Example Response</p>
              <pre className="bg-white border text-xs rounded-lg px-4 py-3 overflow-x-auto whitespace-pre-wrap text-gray-800">
                {ep.example}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">API Reference</h1>
        <p className="text-sm text-gray-500 mt-1">
          All endpoints at <code className="bg-gray-100 px-1 rounded">/api/v1</code>. Secured with{" "}
          <code className="bg-gray-100 px-1 rounded">X-API-Key</code> header (except{" "}
          <code className="bg-gray-100 px-1 rounded">/health</code>).
        </p>
      </div>

      {sections.map((sec) => (
        <div key={sec.title} className="space-y-2">
          <h2 className="text-base font-semibold text-gray-700 border-b pb-1">{sec.title}</h2>
          {sec.endpoints.map((ep) => (
            <EndpointCard key={ep.path} ep={ep} />
          ))}
        </div>
      ))}
    </div>
  );
}
