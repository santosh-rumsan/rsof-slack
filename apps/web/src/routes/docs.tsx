import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/docs")({
  component: DocsPage,
});

interface Endpoint {
  method: "GET" | "POST" | "PUT";
  path: string;
  description: string;
  auth: "api-key-or-jwt" | "jwt" | "none";
  params?: { name: string; type: string; desc: string }[];
  curl: string;
  example?: string;
}

const BASE = "http://localhost:8000/api/v1";
const API_KEY_AUTH = '-H "X-API-Key: $API_KEY"';
const JWT_AUTH = '-H "Authorization: Bearer $JWT_TOKEN"';

const sections: { title: string; endpoints: Endpoint[] }[] = [
  {
    title: "Health",
    endpoints: [
      {
        method: "GET",
        path: "/health",
        auth: "none",
        description: "Returns API and RTM connection status. No auth required.",
        curl: `curl ${BASE}/health`,
        example: `{"status":"ok","rtm":"connected"}`,
      },
    ],
  },
  {
    title: "Me (own data)",
    endpoints: [
      {
        method: "GET",
        path: "/me",
        auth: "jwt",
        description: "Get your own Slack user profile. Resolved via the sub claim in your JWT.",
        curl: `curl ${BASE}/me ${JWT_AUTH}`,
        example: `{"slack_id":"U123","real_name":"Alice","current_presence":"active",...}`,
      },
      {
        method: "GET",
        path: "/me/presence-history",
        auth: "jwt",
        description: "Your own presence history records.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range (inclusive)" },
          { name: "to", type: "ISO datetime", desc: "End of range (inclusive)" },
        ],
        curl: `curl "${BASE}/me/presence-history?from=2026-05-01" ${JWT_AUTH}`,
        example: `[{"id":1,"slack_id":"U123","presence":"active","source":"rtm","recorded_at":"2026-05-01T09:00:00"}]`,
      },
      {
        method: "GET",
        path: "/me/status-history",
        auth: "jwt",
        description: "Your own status history (status text, emoji).",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/me/status-history?from=2026-05-01" ${JWT_AUTH}`,
      },
      {
        method: "GET",
        path: "/me/duration-summary",
        auth: "jwt",
        description: "Your own total seconds spent in each presence state within the window.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/me/duration-summary?from=2026-05-01" ${JWT_AUTH}`,
        example: `{"slack_id":"U123","from_dt":"2026-05-01","to_dt":null,"durations":[{"presence":"active","total_seconds":18000}]}`,
      },
    ],
  },
  {
    title: "Sync",
    endpoints: [
      {
        method: "POST",
        path: "/admin/sync/slack-users",
        auth: "api-key-or-jwt",
        description: "Pull all users from Slack and upsert into the database.",
        curl: `curl -X POST ${BASE}/admin/sync/slack-users ${API_KEY_AUTH}`,
        example: `{"message":"Sync complete: {'created': 2, 'updated': 5, 'deactivated': 0}"}`,
      },
      {
        method: "POST",
        path: "/admin/sync/user-mappings",
        auth: "api-key-or-jwt",
        description: "Sync user mappings from the rs-office user management API.",
        curl: `curl -X POST ${BASE}/admin/sync/user-mappings ${API_KEY_AUTH}`,
        example: `{"message":"Sync complete: {'mapped': 12}"}`,
      },
      {
        method: "POST",
        path: "/admin/sync/presence",
        auth: "api-key-or-jwt",
        description: "Poll current presence for all active users and reconcile (only writes on change).",
        curl: `curl -X POST ${BASE}/admin/sync/presence ${API_KEY_AUTH}`,
        example: `{"message":"Reconciliation complete: {'checked': 30, 'changed': 2}"}`,
      },
      {
        method: "GET",
        path: "/admin/sync/status",
        auth: "api-key-or-jwt",
        description: "Returns scheduled job metadata (next run times).",
        curl: `curl ${BASE}/admin/sync/status ${API_KEY_AUTH}`,
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
        auth: "api-key-or-jwt",
        description:
          "Server-Sent Events stream of real-time presence changes. Each event is a JSON object. Connection is long-lived; the server sends a keepalive comment every 30 s.",
        curl: `curl -N ${BASE}/admin/events/presence ${JWT_AUTH}`,
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
        auth: "api-key-or-jwt",
        description: "List Slack users. All params optional.",
        params: [
          { name: "ids", type: "string", desc: "Comma-separated Slack IDs to filter" },
          { name: "presence", type: "active | away", desc: "Filter by current presence" },
          { name: "active_only", type: "boolean", desc: "Only return non-deactivated users (default false)" },
        ],
        curl: `curl "${BASE}/admin/users?presence=active&active_only=true" ${API_KEY_AUTH}`,
        example: `[{"slack_id":"U123","real_name":"Alice","current_presence":"active",...}]`,
      },
      {
        method: "GET",
        path: "/admin/users/:slack_id",
        auth: "api-key-or-jwt",
        description: "Get a single user by Slack ID.",
        curl: `curl ${BASE}/admin/users/U123 ${API_KEY_AUTH}`,
      },
      {
        method: "GET",
        path: "/admin/users/:slack_id/presence-history",
        auth: "api-key-or-jwt",
        description: "Presence history records for a user.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range (inclusive)" },
          { name: "to", type: "ISO datetime", desc: "End of range (inclusive)" },
        ],
        curl: `curl "${BASE}/admin/users/U123/presence-history?from=2026-05-01" ${API_KEY_AUTH}`,
        example: `[{"id":1,"slack_id":"U123","presence":"active","source":"rtm","recorded_at":"2026-05-01T09:00:00"}]`,
      },
      {
        method: "GET",
        path: "/admin/users/:slack_id/status-history",
        auth: "api-key-or-jwt",
        description: "Status history records (status text, emoji).",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/users/U123/status-history?from=2026-05-01" ${API_KEY_AUTH}`,
      },
      {
        method: "GET",
        path: "/admin/users/:slack_id/duration-summary",
        auth: "api-key-or-jwt",
        description: "Total seconds spent in each presence state within the window.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/users/U123/duration-summary?from=2026-05-01" ${API_KEY_AUTH}`,
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
        auth: "api-key-or-jwt",
        description: "Users whose current_presence is 'active'.",
        curl: `curl ${BASE}/admin/reports/currently-active ${API_KEY_AUTH}`,
        example: `{"count":5,"users":[...]}`,
      },
      {
        method: "GET",
        path: "/admin/reports/presence-summary",
        auth: "api-key-or-jwt",
        description: "Per-user total active/away seconds and availability percentage.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/reports/presence-summary?from=2026-05-01" ${API_KEY_AUTH}`,
        example: `[{"slack_id":"U123","real_name":"Alice","active_seconds":28800,"away_seconds":7200,"availability_pct":80.0}]`,
      },
      {
        method: "GET",
        path: "/admin/reports/active-hours",
        auth: "api-key-or-jwt",
        description: "Heatmap data: presence count per (day_of_week, hour_of_day).",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/reports/active-hours?from=2026-05-01" ${API_KEY_AUTH}`,
        example: `[{"day_of_week":1,"hour_of_day":9,"count":45},...]`,
      },
      {
        method: "GET",
        path: "/admin/reports/availability",
        auth: "api-key-or-jwt",
        description: "Ranked list of users by availability percentage.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
        ],
        curl: `curl "${BASE}/admin/reports/availability?from=2026-05-01" ${API_KEY_AUTH}`,
      },
      {
        method: "GET",
        path: "/admin/reports/status-trends",
        auth: "api-key-or-jwt",
        description: "Most-used status texts/emojis ranked by frequency.",
        params: [
          { name: "from", type: "ISO datetime", desc: "Start of range" },
          { name: "to", type: "ISO datetime", desc: "End of range" },
          { name: "limit", type: "integer", desc: "Max results (default 20)" },
        ],
        curl: `curl "${BASE}/admin/reports/status-trends?limit=10" ${API_KEY_AUTH}`,
        example: `[{"status_text":"In a meeting","status_emoji":":spiral_calendar:","count":42}]`,
      },
      {
        method: "GET",
        path: "/admin/reports/inactive-users",
        auth: "api-key-or-jwt",
        description: "Active users with no recent 'active' presence.",
        params: [
          { name: "days", type: "integer", desc: "Inactivity threshold in days (default 7)" },
        ],
        curl: `curl "${BASE}/admin/reports/inactive-users?days=3" ${API_KEY_AUTH}`,
        example: `[{"slack_id":"U789","real_name":"Bob","last_presence_update":"2026-05-10T08:00:00"}]`,
      },
    ],
  },
  {
    title: "Settings",
    endpoints: [
      {
        method: "GET",
        path: "/admin/settings",
        auth: "api-key-or-jwt",
        description: "Get all application settings (including sensitive values). Values are sourced from the database, falling back to environment variables.",
        curl: `curl ${BASE}/admin/settings ${API_KEY_AUTH}`,
        example: `[{"key":"WORK_START_HOUR","value":"7"},{"key":"WORK_END_HOUR","value":"23"},{"key":"TIMEZONE","value":"Asia/Kathmandu"}]`,
      },
      {
        method: "PUT",
        path: "/admin/settings",
        auth: "api-key-or-jwt",
        description: "Update one or more application settings. Pass an array of key/value pairs. Only provided keys are updated.",
        curl: `curl -X PUT ${BASE}/admin/settings ${API_KEY_AUTH} \\\n  -H "Content-Type: application/json" \\\n  -d '[{"key":"WORK_START_HOUR","value":"8"},{"key":"WORK_END_HOUR","value":"18"}]'`,
        example: `{"updated":2}`,
      },
    ],
  },
];

function AuthBadge({ auth }: { auth: Endpoint["auth"] }) {
  if (auth === "none") return null;
  if (auth === "jwt")
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium whitespace-nowrap">
        JWT
      </span>
    );
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium whitespace-nowrap">
      API Key or JWT
    </span>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" | "PUT" }) {
  return (
    <span
      className={`text-xs font-bold px-1.5 py-0.5 rounded font-mono ${
        method === "GET" ? "bg-blue-100 text-blue-700" : method === "PUT" ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700"
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
        <AuthBadge auth={ep.auth} />
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
          All endpoints at <code className="bg-gray-100 px-1 rounded">/api/v1</code>.
        </p>
      </div>

      {/* Auth explanation */}
      <div className="rounded-xl border bg-gray-50 p-5 space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Authentication</h2>

        <div className="space-y-3 text-sm text-gray-700">
          <p>
            This API supports two authentication methods. The badge on each endpoint indicates which are accepted.
          </p>

          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium mt-0.5 whitespace-nowrap">
                API Key or JWT
              </span>
              <div>
                <p className="font-medium text-gray-800">Admin endpoints</p>
                <p className="text-gray-600">
                  Pass <code className="bg-gray-100 px-1 rounded">X-API-Key: &lt;key&gt;</code> for server-to-server
                  use, or <code className="bg-gray-100 px-1 rounded">Authorization: Bearer &lt;token&gt;</code> with a
                  JWT that has the <code className="bg-gray-100 px-1 rounded">{"{APP_ID}|admin"}</code> role.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium mt-0.5 whitespace-nowrap">
                JWT
              </span>
              <div>
                <p className="font-medium text-gray-800">User endpoints (/me)</p>
                <p className="text-gray-600">
                  Requires <code className="bg-gray-100 px-1 rounded">Authorization: Bearer &lt;token&gt;</code>. The
                  user is identified by the <code className="bg-gray-100 px-1 rounded">sub</code> claim in the JWT,
                  which is mapped to a Slack user via the UserMapping table.
                </p>
              </div>
            </div>
          </div>

          <div className="border-t pt-3">
            <p className="font-medium text-gray-800 mb-2">Google login & token exchange (web UI)</p>
            <p className="text-gray-600 mb-2">
              The web UI authenticates via Google Sign-In. After Google returns an{" "}
              <code className="bg-gray-100 px-1 rounded">id_token</code>, the frontend exchanges it for an app JWT:
            </p>
            <pre className="bg-gray-900 text-green-400 text-xs rounded-lg px-4 py-3 overflow-x-auto whitespace-pre-wrap">{`POST https://rsoffice-users-api.rumsan.xyz/auth/google
X-App-Id: <APP_ID>
Content-Type: application/json

{"id_token": "<google-id-token>"}

→ 200 OK
{
  "success": true,
  "data": {
    "token": "<jwt>",
    "user": { "cuid": "...", "email": "..." }
  }
}`}</pre>
            <p className="text-gray-600 mt-2">
              The returned <code className="bg-gray-100 px-1 rounded">token</code> is an RS256 JWT verified using the{" "}
              <code className="bg-gray-100 px-1 rounded">JWT_PUBLIC_KEY_PEM</code> environment variable. Roles are
              encoded as <code className="bg-gray-100 px-1 rounded">{"{app_id}|{role_name}"}</code> in the{" "}
              <code className="bg-gray-100 px-1 rounded">roles</code> array claim.
            </p>
          </div>
        </div>
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
