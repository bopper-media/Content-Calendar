/**
 * The app-wide icon set (ticket bbb51964, Mia: "remove emojis across all parts
 * of sous, replace with the icon system we use").
 *
 * One shared vocabulary so a bolt on a contact row and a bolt in the review
 * queue are the same drawing. Same recipe the deck and calendar already use
 * locally: fill none, currentColor stroke, 24 viewBox, round caps. Colour and
 * size come from the caller, so an icon inherits whatever hue its chip sets.
 *
 * Nav keeps its own icons (Rail), and PostDeck / ContentCalendar keep their
 * local channel + medium glyphs: those encode domain meaning, not furniture.
 */
import type { ReactNode } from "react";

export const GLYPH = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export type IconName =
  | "person"
  | "building"
  | "calendar"
  | "envelope"
  | "send"
  | "inbox"
  | "doc"
  | "folder"
  | "search"
  | "tag"
  | "bolt"
  | "download"
  | "upload"
  | "bug"
  | "idea"
  | "phone"
  | "trophy"
  | "link"
  | "ticket"
  | "image"
  | "camera"
  | "trash"
  | "sparkle"
  | "warning"
  | "check"
  | "paperclip"
  | "eye"
  | "comment"
  | "star"
  | "pencil"
  | "refresh"
  | "list"
  | "palette"
  | "chart"
  | "chefHat"
  | "bowl"
  | "gear"
  | "externalLink"
  | "reply"
  | "swap"
  | "sun"
  | "moon"
  | "close"
  | "clock"
  | "target"
  | "dot"
  | "ban"
  | "copy"
  | "play"
  | "chevron";

const PATHS: Record<IconName, ReactNode> = {
  person: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  envelope: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  send: <><path d="M21 3 10.5 13.5" /><path d="M21 3 14.5 21l-4-7.5L3 9.5 21 3z" /></>,
  inbox: <><path d="M3 13h5l2 3h4l2-3h5" /><path d="M5.5 5h13l2.5 8v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2.5-8z" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" /><path d="M14 3v5h5" /></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  tag: <><path d="M11 3H4a1 1 0 0 0-1 1v7l9.5 9.5a1.5 1.5 0 0 0 2.1 0l6-6a1.5 1.5 0 0 0 0-2.1L11 3z" /><path d="M7.5 7.5h.01" /></>,
  bolt: <><path d="M13.5 2 4 14h7l-.5 8L20 10h-7l.5-8z" /></>,
  download: <><path d="M12 3v13M6.5 11 12 16.5 17.5 11" /><path d="M4 20h16" /></>,
  upload: <><path d="M12 20V7M6.5 12 12 6.5 17.5 12" /><path d="M4 20h16" /></>,
  bug: <><rect x="7.5" y="7" width="9" height="13" rx="4.5" /><path d="M7.5 12H3M21 12h-4.5M7.5 16.5 4 19M16.5 16.5 20 19M7.5 8 5 5.5M16.5 8 19 5.5" /></>,
  idea: <><path d="M9.5 18h5M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9V15h7v-1.1A6 6 0 0 0 12 3z" /></>,
  phone: <><path d="M6.5 3h3l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2L21 14.5v3a2.5 2.5 0 0 1-2.7 2.5A16.5 16.5 0 0 1 3.5 5.7 2.5 2.5 0 0 1 6 3z" /></>,
  trophy: <><path d="M8 4h8v6a4 4 0 0 1-8 0V4z" /><path d="M8 5.5H5v1.5a3.5 3.5 0 0 0 3 3.4M16 5.5h3V7a3.5 3.5 0 0 1-3 3.4" /><path d="M12 14v4M8.5 21h7" /></>,
  link: <><path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6" /></>,
  ticket: <><path d="M3 9V6.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6.5V9a3 3 0 0 0 0 6v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V15a3 3 0 0 0 0-6z" /><path d="M14 6.5v11" /></>,
  image: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="9.5" r="1.7" /><path d="m3 16.5 5.5-5 4.5 4 3-2.5 5 4" /></>,
  camera: <><path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.8l1.4-2h6.6l1.4 2h2.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-9z" /><circle cx="12" cy="12.5" r="3.5" /></>,
  trash: <><path d="M4 6.5h16M9.5 6.5V4h5v2.5" /><path d="M6.5 6.5 7.5 20h9l1-13.5" /><path d="M10.5 10v6M13.5 10v6" /></>,
  sparkle: <><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9L4.5 10.8 10.2 9 12 3.5z" /><path d="M18.5 3v3M20 4.5h-3" /></>,
  warning: <><path d="M12 4 2.8 20h18.4L12 4z" /><path d="M12 10v4.5M12 17.5h.01" /></>,
  check: <><path d="m5 13 4.5 4.5L19 7" /></>,
  paperclip: <><path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8-8a3.4 3.4 0 0 1 4.8 4.8l-8 8a1.8 1.8 0 0 1-2.5-2.5l7.3-7.3" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  comment: <><path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-5A7.5 7.5 0 1 1 20.5 12.5z" /></>,
  star: <><path d="m12 3.5 2.7 5.6 6 .8-4.4 4.3 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.3 9.9l6-.8L12 3.5z" /></>,
  pencil: <><path d="m14.5 5.5 4 4L8 20l-5 1 1-5L14.5 5.5z" /><path d="m13 7 4 4" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20.5 4v4h-4" /></>,
  list: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  palette: <><path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-1 2-1.8s-.7-1.3-.7-2.1c0-.8.7-1.4 1.6-1.4h1.6a4 4 0 0 0 4-4c0-4.2-3.8-7.7-8.5-7.7z" /><path d="M8 10h.01M11.5 7.5h.01M15.5 9h.01" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="m7.5 15 3.5-4 3 2.5 5-6.5" /></>,
  chefHat: <><path d="M7 20h10v-6.5a4.5 4.5 0 1 0-3.2-7.7 4 4 0 0 0-7.4 2.2A4.5 4.5 0 0 0 7 13.5V20z" /><path d="M7 17h10" /></>,
  bowl: <><path d="M3 11h18a9 9 0 0 1-18 0z" /><path d="M9 7.5c0-1.5 3-1.5 3-3M14.5 7.5c0-1.5 2-1.5 2-3" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" /></>,
  externalLink: <><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5" /></>,
  reply: <><path d="M9 6 3.5 11.5 9 17" /><path d="M3.5 11.5H14a6.5 6.5 0 0 1 6.5 6.5v1" /></>,
  swap: <><path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" /></>,
  sun: <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" /></>,
  moon: <><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /></>,
  dot: <><circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none" /></>,
  ban: <><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1" /></>,
  play: <><path d="M8 5.5 18.5 12 8 18.5v-13z" /></>,
  chevron: <><path d="m6 9.5 6 6 6-6" /></>,
};

/**
 * A furniture icon. Decorative by default; pass `title` when the icon is the
 * only thing carrying the meaning (a bare icon button), which makes it an
 * announced image instead of a hidden one.
 */
export function Icon({
  name,
  size = 14,
  title,
  style,
}: {
  name: IconName;
  size?: number;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      {...GLYPH}
      width={size}
      height={size}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
