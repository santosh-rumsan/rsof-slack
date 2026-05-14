// API client — typed fetch wrapper

const JWT_STORAGE = "rsof_slack_jwt";

export function getJwt(): string {
  return localStorage.getItem(JWT_STORAGE) ?? "";
}

export function setJwt(token: string): void {
  localStorage.setItem(JWT_STORAGE, token);
}

export function clearJwt(): void {
  localStorage.removeItem(JWT_STORAGE);
}

export function isAuthenticated(): boolean {
  return !!getJwt();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getJwt()}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) {
      clearJwt();
      window.dispatchEvent(new Event("rsof:unauthorized"));
    }
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackUser {
  slack_id: string;
  real_name: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  is_active: boolean;
  current_presence: "active" | "away" | null;
  current_status_text: string | null;
  current_status_emoji: string | null;
  last_presence_update: string | null;
  created_at: string;
  updated_at: string;
}

export interface PresenceHistory {
  id: number;
  slack_id: string;
  presence: string;
  source: string;
  recorded_at: string;
}

export interface StatusHistory {
  id: number;
  slack_id: string;
  status_text: string | null;
  status_emoji: string | null;
  recorded_at: string;
}

export interface DurationEntry {
  presence: string;
  total_seconds: number;
}

export interface DurationSummary {
  slack_id: string;
  from_dt: string | null;
  to_dt: string | null;
  durations: DurationEntry[];
}

export interface PresenceSummaryRow {
  slack_id: string;
  real_name: string | null;
  display_name: string | null;
  active_seconds: number;
  away_seconds: number;
  availability_pct: number;
}

export interface ActiveHoursRow {
  day_of_week: number;
  hour_of_day: number;
  count: number;
}

export interface AvailabilityRow {
  slack_id: string;
  real_name: string | null;
  display_name: string | null;
  availability_pct: number;
}

export interface StatusTrendRow {
  status_text: string | null;
  status_emoji: string | null;
  count: number;
}

export interface CurrentlyActive {
  count: number;
  users: SlackUser[];
}

export interface InactiveUserRow {
  slack_id: string;
  real_name: string | null;
  display_name: string | null;
  last_presence_update: string | null;
}

export interface JobStatus {
  job_id: string;
  description: string;
  interval_label: string;
  interval_ms: number;
  last_run: string | null;
  next_run: string | null;
}

export interface SyncStatus {
  jobs: JobStatus[];
}

export interface Health {
  status: string;
  rtm: string;
}

export interface AppSetting {
  key: string;
  value: string;
}

// Human-readable metadata for each setting key
export const SETTING_META: Record<string, { label: string; description: string; type: 'text' | 'number' | 'password' }> = {
  USER_MGMT_API_URL:           { label: 'User Mgmt API URL',          description: 'External user management API endpoint',         type: 'text' },
  USER_MGMT_API_KEY:           { label: 'User Mgmt API Key',          description: 'Bearer token for the user management API',       type: 'password' },
  USER_SYNC_INTERVAL:          { label: 'User Sync Interval (min)',   description: 'How often to sync Slack users (minutes)',         type: 'number' },
  PRESENCE_RECONCILE_INTERVAL: { label: 'Presence Reconcile (min)',   description: 'Poll interval when RTM is disconnected (minutes)', type: 'number' },
  USER_MAPPING_SYNC_INTERVAL:  { label: 'User Mapping Sync (min)',    description: 'How often to sync user mappings (minutes)',       type: 'number' },
  API_KEY:                     { label: 'Admin API Key',              description: 'Secret key for admin API access',                type: 'password' },
  TIMEZONE:                    { label: 'Timezone',                   description: 'Timezone for report calculations (e.g. Asia/Kathmandu)', type: 'text' },
  WORK_START_HOUR:             { label: 'Work Start Hour',            description: 'Start of work day (0–23, used in reports)',      type: 'number' },
  WORK_END_HOUR:               { label: 'Work End Hour',              description: 'End of work day (0–23, exclusive)',              type: 'number' },
};

// ---------------------------------------------------------------------------
// API namespaces
// ---------------------------------------------------------------------------

export const health = {
  get: () => request<Health>("/health"),
};

export const settings = {
  getPublic: () => fetch("/api/v1/settings").then((r) => r.json()) as Promise<AppSetting[]>,
};

export const admin = {
  syncSlackUsers: () => request<{ message: string }>("/admin/sync/slack-users", { method: "POST" }),
  syncUserMappings: () => request<{ message: string }>("/admin/sync/user-mappings", { method: "POST" }),
  syncPresence: () => request<{ message: string }>("/admin/sync/presence", { method: "POST" }),
  syncStatus: () => request<SyncStatus>("/admin/sync/status"),

  syncStreamUrl: (type: "slack-users" | "user-mappings" | "presence") =>
    `/api/v1/admin/sync/${type}/stream`,

  listUsers: (params?: { ids?: string; presence?: string; active_only?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.ids) qs.set("ids", params.ids);
    if (params?.presence) qs.set("presence", params.presence);
    if (params?.active_only !== undefined) qs.set("active_only", String(params.active_only));
    return request<SlackUser[]>(`/admin/users?${qs}`);
  },

  getUser: (slackId: string) => request<SlackUser>(`/admin/users/${slackId}`),

  getUserPresenceHistory: (slackId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request<PresenceHistory[]>(`/admin/users/${slackId}/presence-history?${qs}`);
  },

  getUserStatusHistory: (slackId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request<StatusHistory[]>(`/admin/users/${slackId}/status-history?${qs}`);
  },

  getUserDuration: (slackId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request<DurationSummary>(`/admin/users/${slackId}/duration-summary?${qs}`);
  },

  // Reports
  currentlyActive: () => request<CurrentlyActive>("/admin/reports/currently-active"),
  presenceSummary: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request<PresenceSummaryRow[]>(`/admin/reports/presence-summary?${qs}`);
  },
  activeHours: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request<ActiveHoursRow[]>(`/admin/reports/active-hours?${qs}`);
  },
  availability: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request<AvailabilityRow[]>(`/admin/reports/availability?${qs}`);
  },
  statusTrends: (from?: string, to?: string, limit = 20) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request<StatusTrendRow[]>(`/admin/reports/status-trends?${qs}`);
  },
  inactiveUsers: (days = 7) => request<InactiveUserRow[]>(`/admin/reports/inactive-users?days=${days}`),

  // Settings
  getSettings: () => request<AppSetting[]>('/admin/settings'),
  updateSettings: (entries: AppSetting[]) =>
    request<{ updated: number }>('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(entries),
    }),
};
