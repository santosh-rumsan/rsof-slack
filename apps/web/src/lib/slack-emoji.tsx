import React from "react";
import { admin } from "./api";

let emojiCache: Record<string, string> = {};
let loaded = false;

export async function loadEmojiMap(): Promise<void> {
  if (loaded) return;
  try {
    const data = await admin.getEmoji();
    emojiCache = data.emoji ?? {};
    loaded = true;
  } catch {
    // noop — emoji render as :name: if fetch fails
  }
}

function resolveEmoji(name: string): string | null {
  const val = emojiCache[name];
  if (!val) return null;
  if (val.startsWith("alias:")) return resolveEmoji(val.slice(6));
  return val;
}

// String renderer for text contexts (e.g. tooltips). URL-based emoji kept as :name:.
export function renderSlackEmoji(text: string): string {
  return text.replace(/:([a-z0-9_+-]+):/gi, (match, name: string) => {
    const resolved = resolveEmoji(name.toLowerCase());
    if (!resolved || resolved.startsWith("http")) return match;
    return resolved;
  });
}

// Component renderer — shows <img> for custom org emoji (URL-based).
export function SlackText({ text }: { text: string }) {
  const parts = text.split(/(:(?:[a-z0-9_+-]+):)/gi);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^:([a-z0-9_+-]+):$/i);
        if (m) {
          const url = resolveEmoji(m[1].toLowerCase());
          if (url?.startsWith("http")) {
            return <img key={i} src={url} alt={part} className="inline h-4 w-4 align-middle" />;
          }
          return <React.Fragment key={i}>{url ?? part}</React.Fragment>;
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}
