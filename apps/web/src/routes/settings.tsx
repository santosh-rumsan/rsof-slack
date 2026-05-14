import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { admin, type JobStatus } from "@/lib/api";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const JOB_LABELS: Record<string, string> = {
  user_sync: "Slack User Sync",
  presence_reconcile: "Presence Reconciliation",
  user_mapping_sync: "User Mapping Sync",
};

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
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    admin.syncStatus()
      .then((s) => setJobs(s.jobs))
      .catch(() => {})
      .finally(() => setLoading(false));

    const timer = setInterval(() => {
      admin.syncStatus().then((s) => setJobs(s.jobs)).catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="font-medium text-gray-700">Scheduled Jobs</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Background jobs that run automatically. Intervals are set via environment variables.
          </p>
        </div>

        {loading ? (
          <p className="p-4 text-sm text-gray-400">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No scheduled jobs found.</p>
        ) : (
          <div className="divide-y">
            {jobs.map((job) => (
              <div key={job.job_id} className="px-4 py-4 space-y-1.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">
                      {JOB_LABELS[job.job_id] ?? job.job_id}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-mono">
                      {job.interval_label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
                    <span>
                      <span className="text-gray-400">Last run: </span>
                      {fmtTime(job.last_run)}
                    </span>
                    <span>
                      <span className="text-gray-400">Next run: </span>
                      {fmtTime(job.next_run)}{" "}
                      <span className="text-gray-400">({timeUntil(job.next_run)})</span>
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{job.description}</p>
                <p className="text-[10px] text-gray-400 font-mono">
                  env key:{" "}
                  {job.job_id === "user_sync"
                    ? "USER_SYNC_INTERVAL (minutes, default 30)"
                    : job.job_id === "presence_reconcile"
                    ? "PRESENCE_RECONCILE_INTERVAL (minutes, default 5)"
                    : "USER_MAPPING_SYNC_INTERVAL (minutes, default 60)"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
