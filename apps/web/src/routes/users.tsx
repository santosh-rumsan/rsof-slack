import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { admin, type SlackUser } from "@/lib/api";
import { PresenceBadge } from "@/components/presence-badge";
import { SlackText } from "@/lib/slack-emoji";

export const Route = createFileRoute("/users")({
  component: UsersPage,
});

function UsersPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<SlackUser[]>([]);
  const [search, setSearch] = useState("");
  const [presenceFilter, setPresenceFilter] = useState<"" | "active" | "away">("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    admin
      .listUsers({ active_only: true, presence: presenceFilter || undefined })
      .then(setUsers)
      .finally(() => setLoading(false));
  }, [presenceFilter]);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      !q ||
      u.real_name?.toLowerCase().includes(q) ||
      u.display_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>

      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
        <input
          type="search"
          placeholder="Search by name or email…"
          className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-lg border px-3 py-2 text-sm"
          value={presenceFilter}
          onChange={(e) => setPresenceFilter(e.target.value as "" | "active" | "away")}
        >
          <option value="">All presence</option>
          <option value="active">Active</option>
          <option value="away">Away</option>
        </select>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No users found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">User</th>
                  <th className="px-4 py-3 text-left hidden sm:table-cell">Status</th>
                  <th className="px-4 py-3 text-left">Presence</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">Last Update</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((u) => (
                  <tr
                    key={u.slack_id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate({ to: "/users/$slackId", params: { slackId: u.slack_id } })}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} className="h-8 w-8 rounded-full" alt="" />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500">
                            {(u.real_name ?? u.display_name ?? "?")[0].toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="font-medium">{u.real_name ?? u.display_name}</p>
                          {u.email && <p className="text-xs text-gray-400">{u.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate hidden sm:table-cell">
                      {u.current_status_emoji ? <SlackText text={u.current_status_emoji} /> : null}{" "}
                      {u.current_status_text ? <SlackText text={u.current_status_text} /> : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <PresenceBadge presence={u.current_presence} />
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden md:table-cell">
                      {u.last_presence_update ? new Date(u.last_presence_update).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to="/users/$slackId"
                        params={{ slackId: u.slack_id }}
                        className="text-brand text-xs hover:underline"
                      >
                        Details →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
