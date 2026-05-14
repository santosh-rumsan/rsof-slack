import { useEffect, useRef, useState } from "react";
import { useRouterState, Link } from "@tanstack/react-router";
import { usePresence, type PresenceEvent } from "@/lib/presence-context";
import { PresenceBadge } from "./presence-badge";

interface Toast {
  id: string;
  event: PresenceEvent;
}

export function PresenceToaster() {
  const { events } = usePresence();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenKeys = useRef(new Set<string>());
  const initialized = useRef(false);
  const { location } = useRouterState();
  const isActivity = location.pathname === "/activity";

  useEffect(() => {
    for (const ev of events) {
      const key = `${ev.slack_id}-${ev.ts}`;
      if (seenKeys.current.has(key)) continue;
      seenKeys.current.add(key);

      if (!initialized.current || isActivity) continue;

      const id = key;
      setToasts((prev) => [...prev, { id, event: ev }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    }
    initialized.current = true;
  }, [events, isActivity]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none">
      {toasts.map(({ id, event }) => (
        <Link
          key={id}
          to="/users/$slackId"
          params={{ slackId: event.slack_id }}
          className="flex items-center gap-3 bg-white border rounded-xl shadow-lg px-4 py-3 text-sm min-w-[240px] pointer-events-auto hover:bg-gray-50"
        >
          {event.avatar_url ? (
            <img src={event.avatar_url} className="h-8 w-8 rounded-full flex-shrink-0" alt="" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-xs font-bold text-gray-500">
              {(event.real_name ?? event.display_name ?? "?")[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">
              {event.real_name ?? event.display_name ?? event.slack_id}
            </p>
          </div>
          <PresenceBadge presence={event.presence} showLabel />
        </Link>
      ))}
    </div>
  );
}
