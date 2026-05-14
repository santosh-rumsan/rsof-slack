import React from "react";

const EMOJI_MAP: Record<string, string> = {
  spiral_calendar_pad: "🗓",
  calendar: "📅",
  date: "📅",
  clock1: "🕐",
  clock2: "🕑",
  clock3: "🕒",
  clock4: "🕓",
  clock5: "🕔",
  clock6: "🕕",
  clock7: "🕖",
  clock8: "🕗",
  clock9: "🕘",
  clock10: "🕙",
  clock11: "🕚",
  clock12: "🕛",
  house: "🏠",
  house_with_garden: "🏡",
  office: "🏢",
  computer: "💻",
  laptop: "💻",
  phone: "📞",
  telephone: "📞",
  mobile_phone: "📱",
  iphone: "📱",
  coffee: "☕",
  lunch: "🍴",
  fork_and_knife: "🍴",
  pizza: "🍕",
  car: "🚗",
  airplane: "✈️",
  train: "🚂",
  bike: "🚲",
  walking: "🚶",
  running: "🏃",
  swimmer: "🏊",
  muscle: "💪",
  dart: "🎯",
  tada: "🎉",
  fire: "🔥",
  star: "⭐",
  zap: "⚡",
  warning: "⚠️",
  no_entry: "⛔",
  checkered_flag: "🏁",
  white_check_mark: "✅",
  x: "❌",
  heavy_check_mark: "✔️",
  red_circle: "🔴",
  large_green_circle: "🟢",
  large_yellow_circle: "🟡",
  large_blue_circle: "🔵",
  sleeping: "😴",
  zzz: "💤",
  clock: "🕐",
  bulb: "💡",
  speech_balloon: "💬",
  mega: "📣",
  loudspeaker: "📢",
  mute: "🔇",
  bell: "🔔",
  no_bell: "🔕",
  eyes: "👀",
  wave: "👋",
  raised_hands: "🙌",
  clap: "👏",
  pray: "🙏",
  point_right: "👉",
  point_left: "👈",
  point_up: "☝️",
  point_down: "👇",
  thumbsup: "👍",
  thumbsdown: "👎",
  ok_hand: "👌",
  heart: "❤️",
  blue_heart: "💙",
  green_heart: "💚",
  yellow_heart: "💛",
  purple_heart: "💜",
  black_heart: "🖤",
  broken_heart: "💔",
  brain: "🧠",
  nerd_face: "🤓",
  sunglasses: "😎",
  partying_face: "🥳",
  thinking_face: "🤔",
  face_with_monocle: "🧐",
  exploding_head: "🤯",
  sick: "🤢",
  face_with_thermometer: "🤒",
  medical: "🏥",
  pill: "💊",
  syringe: "💉",
};

const FALLBACK_EMOJI = "🔹"; // 🔹

export function renderSlackEmoji(text: string): string {
  return text.replace(/:([a-z0-9_+-]+):/gi, (_match, name: string) => {
    return EMOJI_MAP[name.toLowerCase()] ?? FALLBACK_EMOJI;
  });
}

export function SlackText({ text }: { text: string }) {
  const parts = text.split(/(:(?:[a-z0-9_+-]+):)/gi);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^:([a-z0-9_+-]+):$/i);
        if (m) {
          return (
            <React.Fragment key={i}>
              {EMOJI_MAP[m[1].toLowerCase()] ?? FALLBACK_EMOJI}
            </React.Fragment>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}
