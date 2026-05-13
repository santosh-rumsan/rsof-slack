interface PresenceBadgeProps {
  presence: "active" | "away" | null | undefined;
  showLabel?: boolean;
}

export function PresenceBadge({ presence, showLabel }: PresenceBadgeProps) {
  const isActive = presence === "active";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-2.5 w-2.5 rounded-full ${isActive ? "bg-green-500" : "bg-gray-300"}`}
      />
      {showLabel && (
        <span className={`text-xs font-medium ${isActive ? "text-green-700" : "text-gray-400"}`}>
          {isActive ? "Active" : presence === "away" ? "Away" : "Unknown"}
        </span>
      )}
    </span>
  );
}
