import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { admin, type JobStatus, type AppSetting, SETTING_META, hasRole } from "@/lib/api";

const CANONICAL_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "Asia/Kathmandu",
];

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const JOB_LABELS: Record<string, string> = {
  user_sync: "Slack User Sync",
  presence_reconcile: "Presence Reconciliation",
  user_mapping_sync: "User Mapping Sync",
  presence_push: "Presence Push (User Mgmt)",
};

function decimalToTime(val: string): string {
  const num = parseFloat(val);
  if (isNaN(num)) return "";
  const h = Math.floor(num);
  const m = Math.round((num - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToDecimal(val: string): string {
  const [hStr, mStr] = val.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return val;
  return String(h + m / 60);
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "imminent";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function SettingsPage() {
  if (!hasRole("app_admin")) {
    return (
      <div className="p-6 text-sm text-gray-400">
        You don't have permission to access settings.
      </div>
    );
  }
  return <SettingsContent />;
}

function SettingsContent() {
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  const [appSettings, setAppSettings] = useState<AppSetting[]>([]);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    admin.syncStatus()
      .then((s) => setJobs(s.jobs))
      .catch(() => {})
      .finally(() => setJobsLoading(false));

    const timer = setInterval(() => {
      admin.syncStatus().then((s) => setJobs(s.jobs)).catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    admin.getSettings()
      .then((s) => {
        setAppSettings(s);
        const map: Record<string, string> = {};
        for (const { key, value } of s) {
          const meta = SETTING_META[key];
          if (meta?.type === "time") {
            map[key] = decimalToTime(value);
          } else if (meta?.type === "timezone") {
            map[key] = value;
          } else {
            map[key] = value;
          }
        }
        setEdited(map);
      })
      .catch(() => {})
      .finally(() => setSettingsLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const entries = appSettings.map(({ key }) => {
        const meta = SETTING_META[key];
        const val = edited[key] ?? "";
        return { key, value: meta?.type === "time" ? timeToDecimal(val) : val };
      });
      await admin.updateSettings(entries);
      setSaveMsg("Settings saved.");
    } catch (err: any) {
      setSaveMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  const knownKeys = appSettings.filter((s) => SETTING_META[s.key]);
  const unknownKeys = appSettings.filter((s) => !SETTING_META[s.key]);

  return (
    <div className="p-4 sm:p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {/* ── App Settings ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="font-medium text-gray-700">Application Settings</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Stored in the database. Env vars are used only as initial defaults.
          </p>
        </div>

        {settingsLoading ? (
          <p className="p-4 text-sm text-gray-400">Loading…</p>
        ) : (
          <form onSubmit={handleSave} className="divide-y">
            {knownKeys.map(({ key }) => {
              const meta = SETTING_META[key];
              return (
                <div key={key} className="px-4 py-4 grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3 sm:gap-4 items-start">
                  <div>
                    <label className="block text-sm font-medium text-gray-800" htmlFor={key}>
                      {meta.label}
                    </label>
                    <p className="text-xs text-gray-400 mt-0.5">{meta.description}</p>
                    <p className="text-[10px] text-gray-300 font-mono mt-0.5">{key}</p>
                  </div>
                  <div className="relative">
                    {meta.type === "timezone" ? (
                      <select
                        id={key}
                        value={edited[key] ?? ""}
                        onChange={(e) => setEdited((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand/30"
                      >
                        {CANONICAL_TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>{tz}</option>
                        ))}
                      </select>
                    ) : meta.type === "textarea" ? (
                      <textarea
                        id={key}
                        value={edited[key] ?? ""}
                        onChange={(e) => setEdited((prev) => ({ ...prev, [key]: e.target.value }))}
                        rows={4}
                        placeholder="One timezone per line, e.g. Asia/Kathmandu"
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand/30 font-mono resize-y"
                      />
                    ) : meta.type === "time" ? (
                      <input
                        id={key}
                        type="time"
                        step="900"
                        value={edited[key] ?? ""}
                        onChange={(e) => setEdited((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand/30"
                      />
                    ) : (
                      <>
                        <input
                          id={key}
                          type={meta.type === "password" && !revealed[key] ? "password" : meta.type === "number" ? "number" : "text"}
                          step={meta.type === "number" ? (meta.step ?? 1) : undefined}
                          value={edited[key] ?? ""}
                          onChange={(e) => setEdited((prev) => ({ ...prev, [key]: e.target.value }))}
                          className={`rounded-lg border border-gray-200 px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand/30 ${meta.type === "password" ? "pr-8" : ""}`}
                        />
                        {meta.type === "password" && (
                          <button
                            type="button"
                            onClick={() => setRevealed((prev) => ({ ...prev, [key]: !prev[key] }))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            tabIndex={-1}
                          >
                            {revealed[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {unknownKeys.length > 0 && (
              <>
                <div className="px-4 py-2 bg-gray-50">
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Other</p>
                </div>
                {unknownKeys.map(({ key }) => (
                  <div key={key} className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3 sm:gap-4 items-center">
                    <label className="text-sm font-mono text-gray-600" htmlFor={key}>{key}</label>
                    <input
                      id={key}
                      type="text"
                      value={edited[key] ?? ""}
                      onChange={(e) => setEdited((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-brand/30"
                    />
                  </div>
                ))}
              </>
            )}

            <div className="px-4 py-4 flex items-center gap-3 bg-gray-50">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-medium disabled:opacity-50 hover:bg-brand/90 transition-colors"
              >
                {saving ? "Saving…" : "Save Settings"}
              </button>
              {saveMsg && (
                <span className={`text-sm ${saveMsg.startsWith("Error") ? "text-red-600" : "text-green-600"}`}>
                  {saveMsg}
                </span>
              )}
            </div>
          </form>
        )}
      </div>

      {/* ── Scheduled Jobs ───────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="font-medium text-gray-700">Scheduled Jobs</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Background jobs. Presence polling activates only when RTM is disconnected &gt;10s.
          </p>
        </div>

        {jobsLoading ? (
          <p className="p-4 text-sm text-gray-400">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No scheduled jobs found.</p>
        ) : (
          <div className="divide-y">
            {jobs.map((job) => (
              <div key={job.job_id} className="px-4 py-4 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">
                      {JOB_LABELS[job.job_id] ?? job.job_id}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-mono">
                      {job.interval_label}
                    </span>
                  </div>
                  {(job.last_run || job.next_run) && (
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-gray-500">
                      {job.last_run && (
                        <span>
                          <span className="text-gray-400">Last run: </span>
                          {fmtTime(job.last_run)}
                        </span>
                      )}
                      {job.next_run && (
                        <span>
                          <span className="text-gray-400">Next run: </span>
                          {fmtTime(job.next_run)}{" "}
                          <span className="text-gray-400">({timeUntil(job.next_run)})</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{job.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
