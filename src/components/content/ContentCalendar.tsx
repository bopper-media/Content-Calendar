"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlanModal } from "@/components/content/PlanModal";
import { PlansPanel } from "@/components/content/PlansPanel";
import { PostComposer } from "@/components/content/PostComposer";
import { ShiftDatesModal } from "@/components/content/ShiftDatesModal";
import { ClipImage } from "@/components/content/ClipImage";
import { Icon } from "@/components/ui/icons";
import {
  CHANNEL_TINTS,
  CONTENT_STATUSES,
  MEDIUM_LABELS,
  PLAN_ROLE_LABELS,
  POST_CHANNELS,
  SECTION_COLORS,
  STATUS_LABELS,
  isPlanRole,
  isPlannedPost,
  isPostChannel,
  isPostMedium,
  type ContentItem,
  type ContentItemInput,
  type ContentPillar,
  type ContentPlan,
  type ContentStatus,
  type PlanRole,
  type PostChannel,
  type PostMedium,
} from "@/lib/content/types";

const MONO = "var(--font-merchant)";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Chips past this many in one day fold behind a "+N more" button, otherwise a
 *  busy day grows the whole row and the month stops being scannable at a
 *  glance. The button expands that day in place (ticket ad2839b9), so nothing
 *  is ever out of reach. */
const CHIPS_PER_DAY = 3;

/** Where the Month | List choice persists per device (the restructure spec).
 *
 *  The ".2" suffix retires the pre-2026-07-30 key ON PURPOSE (ticket c70372cc,
 *  Mia: "the calendar should show this view by default. not the list."). The
 *  default flipped from list to month, and a device that had ever tapped List
 *  under the old default carried a stored "list" that would have kept serving
 *  her the very screen the ticket is about. Retiring the key is one forgotten
 *  choice, once; keeping it would have been the fix silently not landing. */
const VIEW_MODE_KEY = "sous.content.calendar.view.2";

/** Where the filter accordion's open/closed choice persists per device
 *  (tickets 9680df0b + 294a75a6: the always-open STATUS and EVENT pill rows
 *  collapsed into one Filters control). Collapsed is the default; active
 *  selections surface as removable chips on the collapsed bar, so closed
 *  never hides state. */
const FILTERS_OPEN_KEY = "sous.content.calendar.filters.open";

/** The List view's column tracks (ticket e794511f: Date, Description, Format,
 *  Channels, Status), shared by the header row and every PostListRow so the
 *  labels sit exactly over their columns. Fixed sides plus a flexed
 *  Description is the ~700px bleed guard: the description cell absorbs every
 *  squeeze, so the row narrows and the page never scrolls sideways. */
const LIST_COLS = {
  date: { flex: "0 0 86px", minWidth: 0 } as React.CSSProperties,
  desc: { flex: "1 1 0", minWidth: 0 } as React.CSSProperties,
  format: { flex: "0 0 100px", minWidth: 0 } as React.CSSProperties,
  channels: { flex: "0 0 84px" } as React.CSSProperties,
  status: { flex: "0 0 96px" } as React.CSSProperties,
};

/** Twin of PostDeck's deck-word layer (the twins posture in that file's
 *  header: tiny helpers copied, never imported, so the two files other agents
 *  edit stay unentangled): status -> the four deck words and their WORD_TINTS
 *  colour identities, so the list's read-only status chip matches the deck
 *  foot it opens onto exactly. */
type DeckWordKey = "wip" | "approved" | "scheduled" | "live";
const WORD_LABELS: Record<DeckWordKey, string> = { wip: "WIP", approved: "Approved", scheduled: "Scheduled", live: "Live" };
const WORD_TINTS: Record<DeckWordKey, { base: string; solid: boolean }> = {
  wip: { base: "var(--alert)", solid: false },
  approved: { base: "var(--accent)", solid: false },
  scheduled: { base: "var(--ct-blue-2)", solid: false },
  live: { base: "var(--accent)", solid: true },
};

/** Twin of PostDeck's deckWordOf: the wip fallback IS the contract, anything
 *  without a deck word of its own is still work in progress. */
function deckWordOf(status: string): DeckWordKey {
  if (status === "approved") return "approved";
  if (status === "scheduled") return "scheduled";
  if (status === "posted") return "live";
  return "wip";
}

/** Twin of PostDeck's GLYPH + ChannelGlyph (the twins rule above): the list
 *  rows wear the same channel icon chips as the deck foot. */
const GLYPH = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

function ChannelGlyph({ c, size = 12 }: { c: PostChannel; size?: number }) {
  const p = { ...GLYPH, width: size, height: size, "aria-hidden": true };
  switch (c) {
    case "instagram": // the rounded-square camera
      return <svg {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="3.8" /><path d="M17.2 6.8h.01" /></svg>;
    case "tiktok": // the musical note
      return <svg {...p}><circle cx="9" cy="17" r="3.2" /><path d="M12.2 17V4.5c1 2.6 3 4.3 5.3 4.8" /></svg>;
    case "linkedin": // the briefcase
      return <svg {...p}><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></svg>;
    case "email": // the envelope
      return <svg {...p}><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m4.5 7.5 7.5 5.5 7.5-5.5" /></svg>;
    case "website": // the globe
      return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17" /><ellipse cx="12" cy="12" rx="3.8" ry="8.5" /></svg>;
    default: // other: three dots
      return <svg {...p}><path d="M5.5 12h.01M12 12h.01M18.5 12h.01" /></svg>;
  }
}

/** Channel names for the Filter by channel dropdown (ticket 7862e20a; the day
 *  chips do not name channels at all, ticket 76e5ff92, a chip's channels live
 *  in its title attribute). Keyed on PostChannel so adding a channel is a
 *  compile error here, and unknown column values never reach this map because
 *  isPostChannel gates the render (the column is ordinary text, see
 *  POST_CHANNELS in lib/content/types). Twin of PostDeck's CHANNEL_LABELS,
 *  the twins posture noted above. */
const CHANNEL_LABELS: Record<PostChannel, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  email: "Email",
  website: "Website",
  other: "Other",
};

/** Day-chip tint by MEDIUM (ticket f3c02210, Mia: "a post is green, email is
 *  pink, paid social is blue"). The CHANNEL_TINTS posture: fixed hexes already
 *  in the app's palette (the SECTION_COLORS green and blue, the pipeline's
 *  special-occasions pink), color-mixed into theme surfaces at render so both
 *  modes stay legible. Keyed on PostMedium so adding a medium is a compile
 *  error here; unknown column values never reach the map because isPostMedium
 *  gates every read. A chip without a medium falls back to its card colour. */
const MEDIUM_TINTS: Record<PostMedium, string> = {
  organic: "#0E9F6E",
  email: "#FF74C4",
  paid: "#2F6FEB",
};

/* ------------------------------------------------------------------ */
/* Dates. scheduled_for is a Postgres `date`, a plain calendar day with */
/* no time and no zone, so it must never touch UTC. Round-tripping     */
/* through toISOString() would shift the day for anyone east of GMT     */
/* (London is BST in July), landing a card on the wrong cell.           */
/* ------------------------------------------------------------------ */

/** A local Date to its YYYY-MM-DD calendar day. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD to a Date at LOCAL midnight. new Date("2026-07-04") would parse as
 *  UTC per spec, which reads back a day early once rendered locally. */
function parseYmd(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

/** The List view's Date cell: a short local day ("26 Jul", the year added
 *  only when it is not this year), through parseYmd so the day can never
 *  shift across a zone (the date block above). */
function shortDate(iso: string): string {
  const d = parseYmd(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts);
}

/** What a chip is called. Notes carry no title, so the note text stands in. */
function labelOf(item: ContentItem): string {
  return item.title?.trim() || item.note?.trim() || "Untitled";
}

/** The channel set an item is planned for (0065): the array is the truth,
 *  each member gated by isPostChannel because members are ordinary text; the
 *  scalar stands in as a one-member set for rows written before the
 *  dual-write existed. */
function channelsOf(item: ContentItem): PostChannel[] {
  const set = (item.post_channels ?? []).filter(isPostChannel);
  if (set.length > 0) return set;
  return isPostChannel(item.post_channel) ? [item.post_channel] : [];
}

/** Card tint, gated to the SECTION_COLORS allow-list for the reason the contract
 *  states: a stray `color` value must not be able to inject a style. */
function tintOf(item: ContentItem): string | null {
  const c = item.color;
  if (!c) return null;
  return (SECTION_COLORS as readonly string[]).includes(c) ? c : null;
}

/** Pillar chip dot, gated like tintOf above; a colourless pillar keeps a
 *  neutral dot so the chip row scans evenly. */
function pillarDot(p: ContentPillar): string {
  return p.color && (SECTION_COLORS as readonly string[]).includes(p.color) ? p.color : "var(--text-muted-2)";
}

/** Toggle one value in a multi-select chip group. */
function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** The id out of the create response ({ data: ContentItem }, the house
 *  envelope). Null for any shape that is not that, which is what sends Add
 *  post down its composer fallback instead of opening a deck on nothing. */
function readNewId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id ? id : null;
}

/**
 * One in-flight drop. `was` is the scheduled_for the server was last known to
 * hold, `now` is what we optimistically moved it to.
 *
 * Keeping `was` is what lets the override expire without an effect: it applies
 * only while the incoming item still reads `was`. Once the refetch lands the
 * item reads `now` and the entry becomes inert on its own, and if a teammate
 * moves the same card in the meantime the item reads neither, so their date
 * wins instead of being masked by ours forever.
 */
interface Override {
  was: string | null;
  now: string | null;
}

/**
 * Marketing > Content, the Calendar tab (Mia, 2026-07-16): "the board is WHERE
 * ideas form, the calendar is WHEN they ship". Ideas arrive here unscheduled and
 * get dragged onto a day, which is the only write the grid itself makes:
 * scheduled_for. Everything else a post carries is edited in PostComposer
 * (Mia, 2026-07-21), opened from an empty run of day cell; it owns its whole
 * draft and reports back only through onSaved, which maps straight onto the
 * same onChange refetch as a drop. The unscheduled rail is GONE (ticket
 * 1c2951e3, Mia: "remove this."): undated posts live on the board and in the
 * List view's undated tail.
 *
 * The Mia+Nikki restructure (2026-07-26) added the Month | List toggle, and
 * ticket e794511f made List the first-visit default: every planned post one
 * line each in to-do order (upcoming first, past below a divider, undated
 * last), and the SAME filter row governs both shapes. Clicking a SCHEDULED post (a
 * day chip or a list row) now opens the deck overlay staged on it through
 * onOpenDeck.
 *
 * Nikki's 2026-07-28 round:
 * - ADD POST opens the SLIDE, not the form (ticket 2afa5e36). Slides are
 *   derived from dated posts, so there has to BE a post: the button creates an
 *   empty one dated today, waits for the refetch, then raises the deck on it.
 *   The composer stays the door for an empty day cell (which is also the only
 *   place a post can be deleted from), and as the fallback whenever the
 *   create or onOpenDeck is not available.
 * - THREE FILTERS across both shapes (tickets 7862e20a, 91cba88b, d0fb449b):
 *   Filter by channel as a dropdown by name, Status and Event as chip groups.
 *   They compose (channel AND status AND event), Clear filters empties all
 *   three at once, and either shape says so in words when nothing matches
 *   rather than drawing an empty grid. "Event" IS the pillar association: the
 *   pill Nikki screenshotted, Special occasions, is a pillar row, so the group
 *   is the pillar vocabulary under the word she uses for it.
 *
 * Sections are excluded throughout. They are board furniture, a frame drawn
 * behind cards, so there is nothing to ship on a date.
 *
 * `items` stays owned by the parent (it also feeds the board tab), so a drop
 * writes through the API and calls onChange() to refetch. The override map below
 * covers the gap between the two so the chip does not snap back mid-flight.
 */
export function ContentCalendar({
  items,
  onChange,
  onOpenDeck,
  onSelectPosts,
}: {
  items: ContentItem[];
  /** PHONE ONLY (Nikki, 2026-09-21): the header has no room for Select beside
   *  the four tabs on a phone, so the calendar's own toolbar carries it there.
   *  ContentView hands over the same toggle its header pill uses. */
  onSelectPosts?: () => void;
  /** The parent's refetch. Awaitable on purpose (ticket 2afa5e36): Add post
   *  has to know the new row is IN `items` before it asks for the deck, or
   *  the overlay opens on somebody else's slide for a round trip. A caller
   *  that refetches synchronously can still hand over a plain void function. */
  onChange: () => void | Promise<void>;
  /** Wired by ContentView to raise the deck overlay staged on this post (the
   *  restructure spec); optional so the calendar stands alone, in which case
   *  scheduled posts fall back to opening in the composer. */
  onOpenDeck?: (id: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  // Optimistic scheduled_for per item id, so a dropped chip lands on the new day
  // immediately rather than after the parent's refetch round-trip.
  const [override, setOverride] = useState<Record<string, Override>>({});
  // The composer mount. { item: null } is a from-scratch post; a non-null item
  // edits it. defaultDate only matters when item is null (a click on an empty
  // day cell), an existing item always shows its own scheduled_for. Add post
  // no longer lands here (ticket 2afa5e36, see addPost below).
  const [composer, setComposer] = useState<{ item: ContentItem | null; defaultDate: string | null } | null>(null);
  // Add post is one round trip now (create, refetch, open the slide), so the
  // button says what it is doing and refuses a second click meanwhile.
  const [creating, setCreating] = useState(false);

  // Month | List (the restructure spec), persisted per device: which shape of
  // the calendar you like is a device habit, not team data, so localStorage,
  // not the DB. THE MONTH GRID is the first-visit default (ticket c70372cc,
  // Mia: "the calendar should show this view by default. not the list."): the
  // Calendar tab should open as a calendar, and the list is the shape you
  // switch to. This is a DEFAULT, not a lock: the moment she taps either
  // segment that choice is stored and wins on every later visit (see setMode,
  // and VIEW_MODE_KEY for why the old key was retired).
  // Mounted as "month" and read back in an effect rather than in the
  // initializer, because localStorage does not exist during SSR and the
  // hydrated markup must match what the server drew.
  const [viewMode, setViewMode] = useState<"month" | "list">("month");
  // PHONE (Nikki, 2026-09-21: "make the content page and everything within
  // that mobile friendly"). Seven columns of titled chips cannot fit 375px,
  // and the first pass let the month keep its desktop width and scroll
  // sideways, which on a phone means you never see a whole week. Under 720px
  // the month is now drawn to FIT: a day is its number and a dot per post,
  // and the day you tap lists its posts underneath (PhoneMonth below). A hook
  // rather than CSS because it is a different layout, not a restyled one.
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  /** The day the phone month has open, as yyyy-mm-dd; null = pick for me. */
  const [phoneDay, setPhoneDay] = useState<string | null>(null);
  // Shift dates (Mia: "move the event date and then all the content readjusts").
  const [shiftOpen, setShiftOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIEW_MODE_KEY) === "list") setViewMode("list");
    } catch {
      /* private mode etc: the toggle still works, it just forgets */
    }
  }, []);
  const setMode = (m: "month" | "list") => {
    setViewMode(m);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, m);
    } catch {
      /* ditto */
    }
  };

  // The filter accordion (tickets 9680df0b + 294a75a6): open/closed is a
  // device habit like viewMode above, so localStorage with the same SSR-safe
  // effect read. Selections themselves stay component state, the existing
  // idiom for the filter groups.
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(FILTERS_OPEN_KEY) === "1") setFiltersOpen(true);
    } catch {
      /* private mode etc: the toggle still works, it just forgets */
    }
  }, []);
  const toggleFilters = () => {
    const next = !filtersOpen;
    setFiltersOpen(next);
    try {
      window.localStorage.setItem(FILTERS_OPEN_KEY, next ? "1" : "0");
    } catch {
      /* ditto */
    }
  };
  // Type-to-filter over the Event options (event lists will grow); a scratch
  // input, deliberately not persisted.
  const [pillarQuery, setPillarQuery] = useState("");

  // The Plan modal (ticket 7077ab09): quick-generate or import a run of
  // placeholder posts.
  const [planOpen, setPlanOpen] = useState(false);

  // The Add event dialog (ticket c5f5b05c): one dated marker, title + date,
  // written with the PlanModal reminder shape so it renders as the same
  // dashed calendar marker the plan generator makes.
  const [eventOpen, setEventOpen] = useState(false);

  // Which day cell is expanded past CHIPS_PER_DAY (ticket ad2839b9): the
  // "+N more" line is a button now, and this is the one day it opened.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Content plans (migration 0085): the groups whose event date slides their
  // members together. Fetched like pillars (a failed read degrades to no
  // Plans affordance rather than an error state), and re-read on a version
  // bump: after the Plan modal creates one, after any PlansPanel write, and
  // whenever the panel opens, so its item counts are fresh truth.
  const [plans, setPlans] = useState<ContentPlan[]>([]);
  const [plansVersion, setPlansVersion] = useState(0);
  const [plansOpen, setPlansOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/content/plans");
        if (!res.ok) return;
        const j = (await res.json()) as { data?: ContentPlan[] };
        if (!cancelled && Array.isArray(j?.data)) setPlans(j.data);
      } catch {
        /* the Plans button just doesn't render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plansVersion]);
  const refetchPlans = () => setPlansVersion((v) => v + 1);

  /** Where a clicked post goes (the restructure contract): a DATED post opens
   *  the deck overlay staged on itself, because the deck only holds slides
   *  with dates; an undated one still opens the composer, which is where a
   *  date lands. The onOpenDeck fallback keeps the calendar standalone. */
  const openItem = (item: ContentItem) => {
    // A reminder/event marker opens its small title+date editor, never the
    // post deck (Mia, 2026-09-10 + the 18d7e7e0 rule that markers are not
    // posts).
    if (isPlanRole(item.plan_role) && item.plan_role === "reminder") { setEditEvent(item); return; }
    if (item.scheduled_for && onOpenDeck) onOpenDeck(item.id);
    else setComposer({ item, defaultDate: null });
  };
  // The event marker being edited (click on a dashed chip), null when closed.
  const [editEvent, setEditEvent] = useState<ContentItem | null>(null);

  // Sections are board-only furniture (see the file header).
  const schedulable = useMemo(
    () => items.filter((i) => i.kind === "card" || i.kind === "note"),
    [items],
  );

  // What the calendar actually draws. An override applies only while the server
  // still reads the value it was taken against, so it expires by derivation
  // rather than needing an effect to prune it.
  const view = useMemo(
    () => schedulable.map((i) => {
      const o = override[i.id];
      return o && i.scheduled_for === o.was ? { ...i, scheduled_for: o.now } : i;
    }),
    [schedulable, override],
  );

  // ---- Filters (Mia, 2026-07-22: the workflow layer). Multi-select within a
  // group, AND across groups: a post must match one lit chip in EVERY active
  // group to stay visible. They gate the day cells AND the list (both derive
  // from `filtered` below) so the two shapes always tell one story; `view`
  // itself stays unfiltered, so schedule() and the drag path write the same
  // rows whatever the chips are doing.
  const [chanFilter, setChanFilter] = useState<PostChannel[]>([]);
  const [pillarFilter, setPillarFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<ContentStatus[]>([]);
  // Pillar chips need names and colours, which live on the pillar rows rather
  // than the items, so the calendar reads them once. A failure degrades to no
  // pillar group instead of an error state: filtering is a convenience layer.
  const [pillars, setPillars] = useState<ContentPillar[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/content/pillars");
        if (!res.ok) return;
        const j = (await res.json()) as { data?: ContentPillar[] };
        if (!cancelled && Array.isArray(j?.data)) setPillars(j.data);
      } catch {
        /* the pillar chips just don't render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Archived pillars stay filterable posts elsewhere but are retired from
  // pickers (the ContentPillar contract), and a filter row is a picker.
  const activePillars = pillars.filter((p) => !p.archived_at);
  // What the Event section actually offers: the search narrows OPTIONS only;
  // an active selection stays a chip on the collapsed bar regardless.
  const shownPillars = pillarQuery.trim()
    ? activePillars.filter((p) => p.name.toLowerCase().includes(pillarQuery.trim().toLowerCase()))
    : activePillars;

  const anyFilter = chanFilter.length > 0 || pillarFilter.length > 0 || statusFilter.length > 0;
  // What the Filters BUTTON reports. Status folded back into the accordion
  // (ticket 319dfee5, Mia: "status should fold into filters too", reversing
  // 6116c5dc's header-row placement), so all three groups count.
  const accordionFilterCount = chanFilter.length + pillarFilter.length + statusFilter.length;
  const filtered = useMemo(
    () =>
      view.filter((i) => {
        // channelsOf gates each member the way it gates the chip render: an
        // unknown value can never match a chip, so it simply hides while a
        // channel filter is active. ANY overlap keeps a multi-channel post
        // visible: a filter narrows to posts going to that channel, and a
        // post going to two channels goes to both.
        if (chanFilter.length > 0 && !channelsOf(i).some((c) => chanFilter.includes(c))) return false;
        if (pillarFilter.length > 0 && !(i.pillar_id && pillarFilter.includes(i.pillar_id))) return false;
        if (statusFilter.length > 0 && !statusFilter.includes(i.status)) return false;
        return true;
      }),
    [view, chanFilter, pillarFilter, statusFilter],
  );
  // What the chips are eating right now, scheduled and unscheduled alike.
  const hiddenCount = view.length - filtered.length;

  // The List view's undated tail (the unscheduled rail itself is gone, ticket
  // 1c2951e3: unscheduled posts live on the board and in the list). Clipped
  // pins are inspiration, not prospective posts (ticket 8944d73d), so only
  // items with post intent count; scheduling a pin happens by filling it in
  // (a channel, a pillar, a date), which graduates it here.
  const unscheduled = useMemo(() => filtered.filter((i) => !i.scheduled_for && isPlannedPost(i)), [filtered]);

  const todayKey = ymd(now);

  // Where a brand new post lands: today while the current month is on screen,
  // otherwise the 1st of the month being viewed, so planning ahead does not
  // silently date the post in the past.
  const newPostDate =
    year === now.getFullYear() && month === now.getMonth() ? todayKey : ymd(new Date(year, month, 1));

  // The List view's rows (ticket e794511f): a to-do reading. What still has
  // to ship comes first, soonest at the top (today counts as upcoming, it
  // has not shipped yet); what is already past drops below a quiet divider,
  // most recent first, so both halves keep closest-to-today at their top;
  // the undated tail is last, the rail's isPlannedPost gate keeping clipped
  // pins out (ticket 8944d73d). Derived from `filtered`, so the one chips
  // row governs both shapes of the calendar; the calendar-day string compare
  // is the file's standing idiom (scheduled_for is a plain date, never a UTC
  // instant).
  const listRows = useMemo(() => {
    const dated = filtered
      .filter((i) => i.scheduled_for)
      .sort(
        (a, b) =>
          (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? "") || a.created_at.localeCompare(b.created_at),
      );
    const upcoming = dated.filter((i) => (i.scheduled_for ?? "").slice(0, 10) >= todayKey);
    // reverse() on the fresh ascending copy = newest past first.
    const past = dated.filter((i) => (i.scheduled_for ?? "").slice(0, 10) < todayKey).reverse();
    return { upcoming, past, undated: unscheduled };
  }, [filtered, unscheduled, todayKey]);
  const listCount = listRows.upcoming.length + listRows.past.length + listRows.undated.length;

  // The list rows carry the pillar's name and colour, which live on the
  // pillar rows already fetched above for the filter chips.
  const pillarById = useMemo(() => new Map(pillars.map((p) => [p.id, p])), [pillars]);

  const byDay = useMemo(() => {
    const m = new Map<string, ContentItem[]>();
    for (const i of filtered) {
      if (!i.scheduled_for) continue;
      const key = i.scheduled_for.slice(0, 10); // already a calendar day, no Date needed
      m.set(key, [...(m.get(key) ?? []), i]);
    }
    return m;
  }, [filtered]);

  // 6-week grid starting Monday, built with the local Date constructor so the
  // cell keys and the scheduled_for keys are the same calendar day.
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Mon=0
    const start = new Date(year, month, 1 - startOffset);
    // Day-of-month arithmetic rolls over months and years on its own, which is
    // what keeps the 31st to 1st boundary honest.
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [year, month]);

  // Counted over `filtered` so the pill agrees with the cells it sits above.
  const monthCount = useMemo(
    () => filtered.filter((i) => {
      if (!i.scheduled_for) return false;
      const d = parseYmd(i.scheduled_for);
      return d.getFullYear() === year && d.getMonth() === month;
    }).length,
    [filtered, year, month],
  );

  // How many matching posts carry a date at all. Read only by the month's
  // empty message, which shows when monthCount is 0, so this is exactly the
  // count sitting in OTHER months: the difference between "nothing matches"
  // and "nothing matches here" (the tickets' say-it-in-words rule).
  const datedMatches = useMemo(() => filtered.filter((i) => i.scheduled_for).length, [filtered]);

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setPhoneDay(null);
  };
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth()); setPhoneDay(null); };

  /** The one write the grid makes directly (the composer owns the rest).
   *  `date` is a YYYY-MM-DD, or null to unschedule. */
  async function schedule(id: string, date: string | null) {
    const item = view.find((i) => i.id === id);
    if (!item || item.scheduled_for === date) return; // dropped where it already was
    // Taken against the server's value, not the view's, so a second drag before
    // the first refetch lands still expires against what the server will send.
    const was = schedulable.find((i) => i.id === id)?.scheduled_for ?? null;
    setOverride((prev) => {
      // Sweep entries the server has already caught up on, so a long session of
      // dragging does not accumulate inert keys.
      const next: Record<string, Override> = {};
      for (const [key, o] of Object.entries(prev)) {
        const live = schedulable.find((i) => i.id === key);
        if (live && live.scheduled_for === o.was) next[key] = o;
      }
      next[id] = { was, now: date };
      return next;
    });
    const revert = () => setOverride((prev) => {
      const next = { ...prev };
      delete next[id]; // fall back to the prop, whatever the server still holds
      return next;
    });
    const body: ContentItemInput = { scheduled_for: date };
    try {
      const res = await fetch(`/api/v1/content/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        revert();
        window.alert(`Couldn't ${date ? "schedule" : "unschedule"} "${labelOf(item)}". Try again.`);
        return;
      }
      onChange();
    } catch {
      revert();
      window.alert(`Couldn't ${date ? "schedule" : "unschedule"} "${labelOf(item)}", the request didn't reach the server.`);
    }
  }

  /**
   * ADD POST, the slide path (ticket 2afa5e36, Nikki: "when clicking on New
   * Post, can this come up instead of that form"). The deck derives its slides
   * from posts that HAVE a date, so the button creates the post first: an
   * empty card dated today, which is what puts a slide in the deck to open. No
   * title on purpose, so the slide's title field opens on its placeholder and
   * the first thing typed is the post's name.
   *
   * Every failure falls back to the composer rather than dead-ending: a
   * calendar mounted without onOpenDeck (standalone), a refused create, a
   * server that never answered. window.alert is this file's existing way of
   * saying a write did not land (see schedule).
   */
  async function addPost() {
    if (creating) return;
    if (!onOpenDeck) {
      setComposer({ item: null, defaultDate: null });
      return;
    }
    setCreating(true);
    const body: ContentItemInput = {
      // An ordinary board card underneath, the composer's own create shape, so
      // the Board shows it too; 'manual' because a person started it.
      kind: "card",
      source: "manual",
      status: "idea",
      title: null,
      // The month being VIEWED, not always today: planning August from the
      // August grid and getting a post dated in July is the bug. Today when the
      // viewed month is the current one, otherwise the 1st of what is on screen.
      scheduled_for: newPostDate,
    };
    try {
      const res = await fetch("/api/v1/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j: unknown = await res.json().catch(() => null);
      const id = res.ok ? readNewId(j) : null;
      if (!id) {
        window.alert("Couldn't start a new post. Opening the form instead.");
        setComposer({ item: null, defaultDate: todayKey });
        return;
      }
      // The deck reads `items` from the parent, so the new row has to be in
      // that list before the overlay opens or it stages someone else's slide
      // for a round trip. Awaiting the refetch is the whole reason onChange is
      // typed awaitable.
      await onChange();
      onOpenDeck(id);
    } catch {
      window.alert("Couldn't start a new post, the request didn't reach the server. Opening the form instead.");
      setComposer({ item: null, defaultDate: todayKey });
    } finally {
      setCreating(false);
    }
  }

  // preventDefault matters here in a way it does not on the outreach board: these
  // cards wrap an <img>, so the browser seeds dataTransfer with the image URL and
  // an unhandled drop can navigate away to it.
  function drop(e: React.DragEvent, key: string, date: string | null) {
    e.preventDefault();
    if (dragId) schedule(dragId, date);
    setDragId(null);
    setOverKey((k) => (k === key ? null : k));
  }

  // Toolbar buttons, matching the month view on the bookings calendar.
  const navBtn: React.CSSProperties = { height: 32, minWidth: 32, padding: "0 12px", background: "var(--field)", border: "1px solid var(--border)", borderRadius: "var(--r-chip)", color: "var(--text-muted)", cursor: "pointer", fontFamily: MONO, fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase", display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "background .12s, color .12s, border-color .12s" };
  const navIcon: React.CSSProperties = { ...navBtn, padding: 0, width: 32, fontSize: 16, letterSpacing: 0 };
  const hoverIn = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "var(--rail-hover)"; e.currentTarget.style.borderColor = "var(--text-muted-2)"; e.currentTarget.style.color = "var(--text)"; };
  const hoverOut = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "var(--field)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; };
  const capsLabel: React.CSSProperties = { fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-muted-2)" };

  return (
    <div className="flex cc-root" style={{ gap: 14, alignItems: "flex-start", minHeight: 0 }}>
      {/* PHONE (Nikki, 2026-09-11: "make this content section mobile
          friendly"). globals.css already turns the rail into a drawer under
          900px; this is Content's own half, and it lives here rather than in
          that file because the rules are this view's alone.

          The LIST is what a phone gets: Format and Channels stand down, which
          hands their 184px back to the description, and Date and Status keep
          the row readable. Both are on the post when you open it, so nothing
          is lost, only deferred.

          The MONTH grid cannot honestly fit: seven columns on a 390px screen
          is 55px a day. It keeps its real width and scrolls sideways inside
          its own box, so a swipe moves the weeks and the PAGE never slides. */}
      <style>{`
        .cc-only-phone { display: none !important; }
        @media (max-width: 720px) {
          .cc-only-phone { display: inline-flex !important; }
          .cc-col-format, .cc-col-channels { display: none !important; }
          .cc-bar { gap: 8px !important; margin-bottom: 10px !important; }
          .cc-bar-title { font-size: 17px !important; }
          /* Controls wrap onto their own line rather than squeezing the title,
             and the + sits at the far end where a thumb finds it. */
          .cc-bar-actions { flex-wrap: wrap; justify-content: flex-start; width: 100%; }
          .cc-bar-actions > :last-child { margin-left: auto; }
          /* THE LIST on a phone (2026-09-21): the title was cut to a dozen
             letters ("Digest That V2: s..."). It now takes two lines, the date
             column gives back its slack, and the row lines up on its first line. */
          .cc-list-row { align-items: flex-start !important; gap: 8px !important; }
          .cc-col-date { flex-basis: 60px !important; padding-top: 1px; }
          .cc-list-title { white-space: normal !important; display: -webkit-box !important; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
          .cc-list-title-row { align-items: flex-start !important; }
          .cc-list-title-row > span:first-child { margin-top: 6px; }
        }
        @media (max-width: 480px) {
          .cc-list-row { padding-left: 10px !important; padding-right: 10px !important; }
        }
      `}</style>
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div className="flex items-center justify-between cc-bar" style={{ marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
          <div className="flex items-center" style={{ gap: 10 }}>
            {viewMode === "month" ? (
              <>
                <div className="cc-bar-title" style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.02em", color: "var(--text)" }}>{MONTHS[month]} {year}</div>
                <span style={{ ...capsLabel, display: "inline-flex", alignItems: "center", background: "var(--field)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: "3px 10px", letterSpacing: ".06em" }}>
                  {monthCount} scheduled
                </span>
              </>
            ) : (
              // The list spans every date at once, so the month heading and
              // its nav stand down and the count pill counts the whole list.
              <>
                <div className="cc-bar-title" style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.02em", color: "var(--text)" }}>Planned posts</div>
                <span style={{ ...capsLabel, display: "inline-flex", alignItems: "center", background: "var(--field)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: "3px 10px", letterSpacing: ".06em" }}>
                  {listCount.toLocaleString("en-GB")} planned
                </span>
              </>
            )}
          </div>
          <div className="flex items-center cc-bar-actions" style={{ gap: 6, flexWrap: "wrap" }}>
            {viewMode === "month" && (
              <>
                <button onClick={() => step(-1)} style={navIcon} onMouseEnter={hoverIn} onMouseLeave={hoverOut} aria-label="Previous month">‹</button>
                <button onClick={goToday} style={navBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut}>Today</button>
                <button onClick={() => step(1)} style={navIcon} onMouseEnter={hoverIn} onMouseLeave={hoverOut} aria-label="Next month">›</button>
              </>
            )}
            {/* Move an event + every piece of content planned around it in one
                go (Mia: "all the content readjusts according to the move"). */}
            <button onClick={() => setShiftOpen(true)} style={navBtn} onMouseEnter={hoverIn} onMouseLeave={hoverOut} title="Move an event and shift all its planned content by the same number of days">
              Shift dates
            </button>
            {/* The Month | List segmented pill (the restructure spec), the
                ContentView TabButton idiom sized to this toolbar's 32px row. */}
            <div className="frosted-chip" style={{ padding: 3, gap: 3 }}>
              <ModeButton active={viewMode === "month"} onClick={() => setMode("month")}>Month</ModeButton>
              <ModeButton active={viewMode === "list"} onClick={() => setMode("list")}>List</ModeButton>
            </div>
            {/* The ONE + button (ticket be527ba7): the Plans, Plan and Add
                post pills condensed into a round primary with a dropdown, plus
                Add event (ticket c5f5b05c). Each entry keeps the exact action
                its pill had; Plans still only appears once a plan exists,
                because before that the panel would open empty. */}
            <AddMenu
              creating={creating}
              hasPlans={plans.length > 0}
              onAddPost={() => void addPost()}
              onAddPlan={() => setPlanOpen(true)}
              onAddEvent={() => setEventOpen(true)}
              onOpenPlans={() => { refetchPlans(); setPlansOpen(true); }}
            />
          </div>
        </div>

        {/* THE FILTER BAR, collapsed by default (tickets 9680df0b + 294a75a6:
            the always-open pill rows fold into one Filters control). Carries
            the Event / Channel / Status sections (status rejoined the
            accordion in ticket 319dfee5), with a type-to-filter search
            over the Event options because pillar lists will grow. Active
            accordion selections surface as removable chips on the collapsed
            bar, so closing it never hides what is filtering. Option
            vocabularies are unchanged (POST_CHANNELS + CHANNEL_TINTS,
            CONTENT_STATUSES, the pillar rows);
            multi-select within a group, AND across groups (see `filtered`
            above), and the filters gate the month grid and the list
            together. */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={toggleFilters}
              title={filtersOpen ? "Hide the filter options" : "Show the filter options"}
              style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 26, padding: "0 11px", borderRadius: "var(--r-pill)", cursor: "pointer", fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", border: accordionFilterCount > 0 ? "1px solid var(--text)" : "1px solid var(--border)", background: accordionFilterCount > 0 ? "var(--elevated)" : "var(--field)", color: accordionFilterCount > 0 ? "var(--on-elevated)" : "var(--text-muted)" }}
            >
              Filters{accordionFilterCount > 0 ? ` (${accordionFilterCount})` : ""}
              {/* Drawn, not typed: a glyph in the Merchant family would sit
                  under the 12.5px floor at this size. */}
              <svg {...GLYPH} width={11} height={11} aria-hidden style={{ flex: "none" }}>
                <path d={filtersOpen ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
              </svg>
            </button>
            {/* SELECT on a phone lives here (see onSelectPosts): the header
                keeps the four tabs on one line and has no room for it. */}
            {onSelectPosts && (
              <button type="button" onClick={onSelectPosts} className="btn-ghost-pill cc-only-phone" style={{ height: 26, padding: "0 11px", fontSize: 12.5, alignItems: "center" }}>
                Select
              </button>
            )}
            {chanFilter.map((c) => (
              <ActiveFilterChip key={`chan-${c}`} dot={CHANNEL_TINTS[c]} label={CHANNEL_LABELS[c]} onRemove={() => setChanFilter((l) => l.filter((x) => x !== c))} />
            ))}
            {pillarFilter.map((id) => {
              const p = pillars.find((x) => x.id === id);
              return (
                <ActiveFilterChip
                  key={`pillar-${id}`}
                  dot={p ? pillarDot(p) : "var(--text-muted-2)"}
                  label={p?.name ?? "Unknown event"}
                  onRemove={() => setPillarFilter((l) => l.filter((x) => x !== id))}
                />
              );
            })}
            {statusFilter.map((s) => (
              <ActiveFilterChip key={`status-${s}`} label={STATUS_LABELS[s]} onRemove={() => setStatusFilter((l) => l.filter((x) => x !== s))} />
            ))}
            {anyFilter && (
              <>
                <span style={{ ...capsLabel, letterSpacing: ".05em", marginLeft: 4 }}>
                  {hiddenCount.toLocaleString("en-GB")} hidden
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setChanFilter([]);
                    setPillarFilter([]);
                    setStatusFilter([]);
                  }}
                  className="btn-ghost-pill"
                  style={{ height: 26, padding: "0 11px", fontSize: 12.5, color: "var(--text)" }}
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
          {filtersOpen && (
            <div style={{ marginTop: 8, padding: "12px 14px", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-card)", display: "flex", flexDirection: "column", gap: 10 }}>
              {/* EVENT = the pillar association (ticket d0fb449b): the pill
                  Nikki screenshotted, Special occasions, is a pillar row.
                  Archived pillars stay filterable data but are retired from
                  pickers (the ContentPillar contract), and a filter row is a
                  picker. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ ...capsLabel, letterSpacing: ".06em", minWidth: 62 }}>Event</span>
                  <input
                    value={pillarQuery}
                    onChange={(e) => setPillarQuery(e.target.value)}
                    placeholder="Search events"
                    aria-label="Search event filters"
                    style={{ width: 190, height: 26, padding: "0 9px", background: "var(--field)", border: "1px solid var(--border)", borderRadius: "var(--r-chip)", color: "var(--text)", fontSize: 13 }}
                  />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, paddingLeft: 70 }}>
                  {activePillars.length === 0 ? (
                    <span style={{ fontSize: 12.5, color: "var(--text-muted-2)" }}>None set up yet</span>
                  ) : shownPillars.length === 0 ? (
                    <span style={{ fontSize: 12.5, color: "var(--text-muted-2)" }}>No events match that search</span>
                  ) : (
                    shownPillars.map((p) => (
                      <FilterChip key={p.id} active={pillarFilter.includes(p.id)} dot={pillarDot(p)} title={`Only posts under ${p.name}`} onClick={() => setPillarFilter((l) => toggleIn(l, p.id))}>
                        {p.name}
                      </FilterChip>
                    ))
                  )}
                </div>
              </div>
              {/* CHANNEL joins the accordion as a chip group wearing the
                  CHANNEL_TINTS dots (the shared colour identity), replacing
                  the standalone dropdown so all three groups filter the same
                  way. Multi-select underneath is unchanged: a post going to
                  two channels still matches either. */}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <span style={{ ...capsLabel, letterSpacing: ".06em", minWidth: 62 }}>Channel</span>
                {POST_CHANNELS.map((c) => (
                  <FilterChip key={c} active={chanFilter.includes(c)} dot={CHANNEL_TINTS[c]} title={`Only posts going to ${CHANNEL_LABELS[c]}`} onClick={() => setChanFilter((l) => toggleIn(l, c))}>
                    {CHANNEL_LABELS[c]}
                  </FilterChip>
                ))}
              </div>
              {/* STATUS rejoined from the header row (ticket 319dfee5):
                  identical statusFilter state, so it still composes AND with
                  Event and Channel and Clear filters still empties it. */}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <span style={{ ...capsLabel, letterSpacing: ".06em", minWidth: 62 }}>Status</span>
                {CONTENT_STATUSES.map((s) => (
                  <FilterChip key={s} active={statusFilter.includes(s)} title={`Only ${STATUS_LABELS[s]} posts`} onClick={() => setStatusFilter((l) => toggleIn(l, s))}>
                    {STATUS_LABELS[s]}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}
        </div>

        {viewMode === "list" ? (
          // THE LIST (the restructure spec): every planned post one line each
          // in to-do order, the undated tail last (see listRows). Rows share
          // the month grid's card-on-hairline look so the toggle reads as the
          // same calendar reshaped, not a different page.
          <div style={{ background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
            {/* The column header (ticket e794511f), the month grid's DOW
                header idiom: merchant caps on the table-header wash, sharing
                LIST_COLS with every row so each label sits exactly over its
                column. The gap must stay equal to the rows' gap for the same
                reason. */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "var(--table-header)", borderBottom: "1px solid var(--divider)" }}>
              <span className="cc-col-date" style={{ ...capsLabel, ...LIST_COLS.date }}>Date</span>
              <span style={{ ...capsLabel, ...LIST_COLS.desc }}>Description</span>
              <span className="cc-col-format" style={{ ...capsLabel, ...LIST_COLS.format }}>Format</span>
              <span className="cc-col-channels" style={{ ...capsLabel, ...LIST_COLS.channels }}>Channels</span>
              <span style={{ ...capsLabel, ...LIST_COLS.status }}>Status</span>
            </div>
            {listCount === 0 ? (
              <div style={{ ...capsLabel, textAlign: "center", padding: "26px 16px", letterSpacing: ".05em", lineHeight: 1.5 }}>
                {anyFilter
                  ? "No planned posts match these filters. Clear filters shows them all again"
                  : "No planned posts yet. Add post starts one"}
              </div>
            ) : (
              <>
                {listRows.upcoming.map((item) => (
                  <PostListRow
                    key={item.id}
                    item={item}
                    pillar={item.pillar_id ? (pillarById.get(item.pillar_id) ?? null) : null}
                    onOpen={() => openItem(item)}
                  />
                ))}
                {/* The quiet divider (ticket e794511f): everything above
                    still has to ship, everything below is already past. The
                    rail wash keeps it a shading, not a headline. */}
                {listRows.past.length > 0 && (
                  <div style={{ ...capsLabel, letterSpacing: ".05em", padding: "7px 14px", background: "var(--rail)", borderBottom: "1px solid var(--divider)" }}>
                    Past posts
                  </div>
                )}
                {listRows.past.map((item) => (
                  <PostListRow
                    key={item.id}
                    item={item}
                    pillar={item.pillar_id ? (pillarById.get(item.pillar_id) ?? null) : null}
                    onOpen={() => openItem(item)}
                  />
                ))}
                {/* Undated last: their No date cells mark them, no second
                    divider needed. */}
                {listRows.undated.map((item) => (
                  <PostListRow
                    key={item.id}
                    item={item}
                    pillar={item.pillar_id ? (pillarById.get(item.pillar_id) ?? null) : null}
                    onOpen={() => openItem(item)}
                  />
                ))}
              </>
            )}
          </div>
        ) : anyFilter && monthCount === 0 ? (
          // A filtered month with nothing left in it SAYS so (the tickets'
          // rule): an empty seven-by-six grid reads as a broken page rather
          // than a filter doing its job. The month nav and Clear filters both
          // stay above, so the way out is one click either way.
          <div style={{ background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-card)", padding: "34px 18px", textAlign: "center" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
              No posts in {MONTHS[month]} {year} match these filters.
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {datedMatches > 0
                ? `${datedMatches.toLocaleString("en-GB")} matching ${datedMatches === 1 ? "post sits" : "posts sit"} in other months. Step through the months, or clear the filters.`
                : "Clear the filters to see the whole month again."}
            </div>
          </div>
        ) : (
          <>
        {/* minmax(0, 1fr), not bare 1fr: 1fr means minmax(auto, 1fr), and
            `auto` lets a long unbroken chip title push its whole COLUMN wider.
            Zeroing the floor fixes every cell at an equal seventh; titles wrap
            inside it instead (the DayChip line clamp below). */}
        {phone ? (
          <PhoneMonth
            cells={cells}
            month={month}
            byDay={byDay}
            todayKey={todayKey}
            selected={phoneDay}
            onSelect={setPhoneDay}
            pillarById={pillarById}
            onOpen={openItem}
            onAdd={(key) => setComposer({ item: null, defaultDate: key })}
          />
        ) : (
        <div className="cc-month-wrap">
        <div className="cc-month" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 1, background: "var(--divider)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-card)", overflow: "hidden" }}>
          {DOW.map((d) => (
            <div key={d} style={{ ...capsLabel, background: "var(--table-header)", padding: "9px 10px", letterSpacing: ".1em" }}>{d}</div>
          ))}
          {cells.map((d) => {
            const key = ymd(d);
            const chips = byDay.get(key) ?? [];
            const today = key === todayKey;
            const inMonth = d.getMonth() === month;
            const isOver = overKey === key;
            const expanded = expandedDay === key;
            const shown = expanded ? chips : chips.slice(0, CHIPS_PER_DAY);
            // Today reads as a faint accent wash on the cell, not just a marked
            // number, matching the bookings month view.
            const cellBg = isOver
              ? "var(--accent-soft)"
              : today && inMonth
                ? "color-mix(in srgb, var(--accent) 7%, var(--card))"
                : inMonth ? "var(--card)" : "var(--rail)";
            return (
              <div
                key={key}
                onDragOver={(e) => { e.preventDefault(); setOverKey(key); }}
                onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
                onDrop={(e) => drop(e, key, key)}
                // Empty cell space starts a post on that day. The target check is
                // what "empty" means: the day number, the chips and "+N more" are
                // children, so clicks on them never fall through to here, and a
                // real drag never fires click at all.
                onClick={(e) => { if (e.target === e.currentTarget) setComposer({ item: null, defaultDate: key }); }}
                style={{ background: cellBg, minHeight: 104, padding: "7px 8px", opacity: inMonth ? 1 : 0.55, display: "flex", flexDirection: "column", gap: 3, boxShadow: isOver ? "inset 0 0 0 1px var(--accent)" : "none", transition: "background .12s" }}
              >
                <div style={{ fontSize: 12.5, fontWeight: today ? 700 : 500, color: today ? "var(--btn-primary-text)" : "var(--text-muted)", alignSelf: "flex-start", minWidth: today ? 20 : 0, height: today ? 20 : "auto", padding: today ? "0 6px" : 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-pill)", background: today ? "var(--btn-primary)" : "transparent" }}>
                  {d.getDate()}
                </div>
                {shown.map((item) => (
                  <DayChip
                    key={item.id}
                    item={item}
                    dragging={dragId === item.id}
                    // Day chips are dated by construction, so this opens the
                    // deck overlay staged on the post (the restructure spec);
                    // the composer stays Add post's fallback door.
                    onOpen={() => openItem(item)}
                    onDragStart={() => setDragId(item.id)}
                    onDragEnd={() => { setDragId(null); setOverKey(null); }}
                  />
                ))}
                {/* "+N more" is a BUTTON (ticket ad2839b9): it expands this
                    day in place so every chip shows, each clickable as
                    normal, and folds back on Show less. stopPropagation so
                    the cell's empty-space click can never see it. */}
                {chips.length > CHIPS_PER_DAY && (
                  <button
                    type="button"
                    aria-expanded={expanded}
                    title={expanded ? "Fold this day back down" : `Show all ${chips.length} items on this day`}
                    onClick={(e) => { e.stopPropagation(); setExpandedDay(expanded ? null : key); }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted-2)"; }}
                    style={{ ...capsLabel, fontSize: 12.5, letterSpacing: ".05em", padding: "1px 2px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", alignSelf: "flex-start", borderRadius: "var(--r-chip)", transition: "color .12s" }}
                  >
                    {expanded ? "Show less" : `+${chips.length - CHIPS_PER_DAY} more`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        </div>
        )}
          </>
        )}
      </div>

      {/* Mounted conditionally per its contract: the composer owns its overlay,
          Escape and focus restore. onSaved fires before onClose on POST, PATCH
          and DELETE success and means "refetch", so it maps straight onto
          onChange; delete is immediate with no confirm, and the refetch is
          naturally tolerant of the row being gone because everything above is
          derived from `items`. A date cleared in the composer comes back as
          scheduled_for null, which is exactly how a chip leaves its cell. */}
      {composer && (
        <PostComposer
          item={composer.item}
          defaultDate={composer.defaultDate}
          onSaved={onChange}
          onClose={() => setComposer(null)}
        />
      )}

      {/* Shift dates: one shared day-delta over every scheduled item in a
          chosen window, previewed before anything moves. Fed the RAW items
          list, not `filtered`: an active status chip must not silently hold
          half a campaign back from the move. */}
      {shiftOpen && (
        <ShiftDatesModal
          items={items}
          plans={plans}
          onClose={() => setShiftOpen(false)}
          onDone={async () => { refetchPlans(); await onChange(); }}
        />
      )}

      {/* The Plan modal (ticket 7077ab09): quick-generate or import a run of
          placeholders. It creates through the ordinary content POST route,
          one row per request, and awaits onChange before closing (the addPost
          posture), so the new rows are in `items` when the grid re-renders.
          The plans refetch rides along (0085): a confirm may have created a
          plan, and the Plans button should exist the moment one does. */}
      {planOpen && (
        <PlanModal
          pillars={activePillars}
          onCreated={async () => { refetchPlans(); await onChange(); }}
          onClose={() => setPlanOpen(false)}
        />
      )}

      {/* The Add event dialog (ticket c5f5b05c): one dated marker with a
          title, created through the ordinary content POST wearing the
          PlanModal reminder shape, so it lands as the same dashed amber
          calendar marker the plan generator writes. */}
      {eventOpen && (
        <AddEventDialog
          defaultDate={newPostDate}
          onCreated={onChange}
          onClose={() => setEventOpen(false)}
        />
      )}

      {/* Edit an existing event marker (Mia, 2026-09-10: "drag and edit these
          date placeholders"): the same two-field dialog in edit mode, with a
          Delete. */}
      {editEvent && (
        <AddEventDialog
          defaultDate={(editEvent.scheduled_for ?? newPostDate).slice(0, 10)}
          editItem={editEvent}
          onCreated={onChange}
          onClose={() => setEditEvent(null)}
        />
      )}

      {/* The Plans manager (migration 0085): rename, move the event date
          (with the shift preview), delete (items stay, the confirm says so).
          Every write refetches plans AND items, because a date move rewrote
          scheduled_for across the whole plan. */}
      {plansOpen && (
        <PlansPanel
          plans={plans}
          pillars={activePillars}
          onChanged={async () => { refetchPlans(); await onChange(); }}
          onClose={() => setPlansOpen(false)}
        />
      )}
    </div>
  );
}

/** A scheduled card sitting in its day cell. Draggable to another day; a
 *  plain click (which a real drag suppresses) opens the deck overlay staged
 *  on it (the restructure spec; the composer is reached from empty day cells
 *  now). Tags stay out of the cell on purpose, a month at three chips a day
 *  is too dense for them. */
function DayChip({
  item,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  item: ContentItem;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const tint = tintOf(item);
  const label = labelOf(item);
  // Channels stay OUT of the visible label (ticket 76e5ff92: "dont show the
  // channel in the label name"): the title attribute carries the full list
  // and the tint stripe carries the visual signal. channelsOf gates every
  // member (the columns are ordinary text) so an unknown value never reaches
  // the tooltip.
  const channels = channelsOf(item);
  // Plan role (migration 0085), gated because the column is checked at the DB
  // but is still ordinary text to a renderer: unheard-of values read as an
  // ordinary post.
  const role: PlanRole | null = isPlanRole(item.plan_role) ? item.plan_role : null;
  const tipParts = [role && role !== "post" ? PLAN_ROLE_LABELS[role] : null, channels.length > 0 ? channels.join(", ") : null].filter(Boolean);
  const tip = tipParts.length > 0 ? `${label} (${tipParts.join("; ")})` : label;

  // A REMINDER is a date to heed, not a post to draft (Mia's taxonomy: "no
  // posts attached to them"): no thumb, no colour tint, merchant caps on the
  // alert family with a dashed edge. It keeps the dashed look, but is now
  // DRAGGABLE to a new day and CLICKS INTO a small title+date editor (Mia,
  // 2026-09-10: "make it so that i can drag and edit these date
  // placeholders") - superseding the earlier inert treatment (18d7e7e0).
  // Clicking still never opens the post deck; the editor is title+date only.
  if (role === "reminder") {
    return (
      <div
        draggable
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title={`${tip} — drag to move, click to edit`}
        style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 7px", minWidth: 0, overflow: "hidden", borderRadius: "var(--r-chip)", background: "color-mix(in srgb, var(--alert) 8%, var(--card))", border: "1px dashed color-mix(in srgb, var(--alert) 45%, var(--border))", cursor: "grab", opacity: dragging ? 0.4 : 1 }}
      >
        {/* Merchant caps at the 12.5 floor; the line clamp is the same bleed
            guard as the ordinary chip below. */}
        <span style={{ flex: "1 1 auto", minWidth: 0, fontFamily: MONO, fontWeight: 500, fontSize: 12.5, lineHeight: 1.35, letterSpacing: ".04em", textTransform: "uppercase", color: "color-mix(in srgb, var(--alert) 60%, var(--text))", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{label}</span>
      </div>
    );
  }

  // The chip tint follows the MEDIUM now (ticket f3c02210): organic green,
  // email pink, paid blue, the soft 9% mix into the card that the colour
  // treatments below already use, so the shape never changes. isPostMedium
  // gates the read because the column is ordinary text.
  const mediumTint = isPostMedium(item.post_medium) ? MEDIUM_TINTS[item.post_medium] : null;
  // NEWSLETTER keeps the post shape (it IS copy being drafted) under a subtle
  // accent tint, so the run of newsletters reads as its own thread through
  // the month. Tint rank: medium first (the ticket's rule), then newsletter,
  // then the card colour, then plain.
  const newsletter = role === "newsletter";
  return (
    <div
      draggable
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={tip}
      // flex-start, not center: the title wraps to two lines now, and the
      // thumb belongs beside its first line, not floating in the middle of
      // the block. minWidth 0 + overflow hidden are the bleed guard at the
      // ~700px floor: anything too wide clips at the chip's own border,
      // never painting over the next day. The tooltip carries the full
      // story whenever the cell cannot.
      style={{ display: "flex", alignItems: "flex-start", gap: 5, padding: "3px 7px 3px 3px", minWidth: 0, overflow: "hidden", borderRadius: "var(--r-pill)", background: mediumTint ? `color-mix(in srgb, ${mediumTint} 9%, var(--card))` : newsletter ? "color-mix(in srgb, var(--accent) 9%, var(--card))" : tint ? `color-mix(in srgb, ${tint} 9%, var(--card))` : "var(--card)", border: "1px solid var(--hairline)", borderLeft: mediumTint ? `3px solid ${mediumTint}` : newsletter ? "3px solid var(--accent)" : tint ? `3px solid ${tint}` : "1px solid var(--hairline)", cursor: "grab", opacity: dragging ? 0.4 : 1 }}
    >
      <Thumb item={item} size={16} />
      {/* Wraps to at most two lines INSIDE the fixed cell width (the grid's
          minmax(0,1fr) is the other half of the fix): -webkit-box line clamp
          is the only clamp with an ellipsis, and overflowWrap anywhere lets an
          unbroken string (a pasted URL as a title) break instead of pushing
          the column wider. */}
      <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12.5, lineHeight: 1.35, color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>{label}</span>
    </div>
  );
}

/** One filter chip. Lit = the composer's channel-pill idiom (solid elevated
 *  pill), unlit = quiet field chip; the colour dot survives both states so
 *  pillar identity stays legible either way. Width-capped with an ellipsis so
 *  a long pillar name cannot push the row past the ~700px floor. */
function FilterChip({
  active,
  dot,
  title,
  onClick,
  children,
}: {
  active: boolean;
  dot?: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 190, fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", padding: "4px 11px", borderRadius: "var(--r-pill)", cursor: "pointer", border: active ? "1px solid var(--text)" : "1px solid var(--border)", background: active ? "var(--elevated)" : "var(--field)", color: active ? "var(--on-elevated)" : "var(--text-muted)", transition: "background .12s, color .12s, border-color .12s" }}
    >
      {dot && <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
    </button>
  );
}

/** A live selection shown on the COLLAPSED filter bar (tickets 9680df0b +
 *  294a75a6): the accordion may be closed, but what it is filtering by never
 *  hides. Wears the lit-chip look (the FilterChip active state) because it IS
 *  an active filter; the x removes just that selection. */
function ActiveFilterChip({ dot, label, onRemove }: { dot?: string; label: string; onRemove: () => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 190, fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", padding: "4px 7px 4px 11px", borderRadius: "var(--r-pill)", border: "1px solid var(--text)", background: "var(--elevated)", color: "var(--on-elevated)" }}>
      {dot && <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <button
        type="button"
        aria-label={`Remove the ${label} filter`}
        title={`Remove the ${label} filter`}
        onClick={onRemove}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, padding: 0, background: "transparent", border: "none", color: "var(--on-elevated)", cursor: "pointer", borderRadius: "50%" }}
      >
        {/* Drawn, not typed: the x must not sink under the merchant floor. */}
        <svg {...GLYPH} width={10} height={10} aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </span>
  );
}

/** One segment of the Month | List pill: a twin of ContentView's TabButton
 *  (the twins posture: tiny, copied, unentangled), sized to the calendar's
 *  32px toolbar row. */
function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        fontFamily: MONO,
        fontWeight: 500,
        fontSize: 12.5, // the merchant floor (standing rule: merchant caps never under 12.5)
        letterSpacing: ".08em",
        textTransform: "uppercase",
        padding: "5px 13px",
        borderRadius: "var(--r-pill)",
        border: "none",
        cursor: "pointer",
        background: active ? "var(--btn-primary)" : "transparent",
        color: active ? "var(--btn-primary-text)" : "var(--text-muted)",
        boxShadow: active ? "var(--shadow-card)" : "none",
      }}
    >
      {children}
    </button>
  );
}

/**
 * THE MONTH ON A PHONE (Nikki, 2026-09-21: "make the content page and
 * everything within that mobile friendly"). Seven columns of titled chips need
 * about 680px, so the first pass kept that width and let the grid scroll
 * sideways, and on a phone you never saw a whole week. Here the month FITS the
 * screen, the way a phone's own calendar does it: a day is its number with a
 * dot per post (three, then "+2"), in the post's own colour, and the day you
 * tap lists its posts underneath at full width, where a title has room to be
 * read. Tap a post to open it; Add post starts one on that day.
 *
 * The day open by default is today when this is today's month, else the first
 * day with anything on it, else the 1st. Dragging a post to another day is a
 * mouse gesture and stays on the desktop grid; on a phone the date is changed
 * from the post itself.
 */
function PhoneMonth({
  cells,
  month,
  byDay,
  todayKey,
  selected,
  onSelect,
  pillarById,
  onOpen,
  onAdd,
}: {
  cells: Date[];
  month: number;
  byDay: Map<string, ContentItem[]>;
  todayKey: string;
  selected: string | null;
  onSelect: (key: string) => void;
  pillarById: Map<string, ContentPillar>;
  onOpen: (item: ContentItem) => void;
  onAdd: (key: string) => void;
}) {
  const inMonth = cells.filter((d) => d.getMonth() === month);
  const fallback =
    inMonth.some((d) => ymd(d) === todayKey) ? todayKey : ymd(inMonth.find((d) => (byDay.get(ymd(d)) ?? []).length > 0) ?? inMonth[0] ?? cells[0]);
  const openKey = selected && inMonth.some((d) => ymd(d) === selected) ? selected : fallback;
  const openDate = parseYmd(openKey);
  const dayItems = byDay.get(openKey) ?? [];
  // Trailing weeks that belong wholly to next month are dropped: five rows is a shorter scroll than six.
  const weeks = Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7)).filter((week) => week.some((d) => d.getMonth() === month));

  const dotOf = (item: ContentItem): string => {
    if (isPlanRole(item.plan_role) && item.plan_role === "reminder") return "var(--alert)";
    if (isPostMedium(item.post_medium)) return MEDIUM_TINTS[item.post_medium];
    const pillar = item.pillar_id ? pillarById.get(item.pillar_id) : null;
    return pillar ? pillarDot(pillar) : "var(--text-muted-2)";
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 1, background: "var(--divider)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
        {DOW.map((d) => (
          <div key={d} style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted-2)", background: "var(--table-header)", padding: "7px 0", textAlign: "center" }}>
            {d.slice(0, 3)}
          </div>
        ))}
        {weeks.flat().map((d) => {
          const key = ymd(d);
          const posts = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isOpen = key === openKey;
          const here = d.getMonth() === month;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isOpen}
              aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]}, ${posts.length === 0 ? "nothing planned" : posts.length === 1 ? "1 item" : `${posts.length} items`}`}
              onClick={() => onSelect(key)}
              style={{ font: "inherit", border: 0, margin: 0, cursor: "pointer", minHeight: 52, padding: "6px 0 5px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: isOpen ? "color-mix(in srgb, var(--text) 9%, var(--card))" : here ? "var(--card)" : "var(--rail)", opacity: here ? 1 : 0.5, boxShadow: isOpen ? "inset 0 0 0 1.5px var(--text)" : "none", color: "var(--text)" }}
            >
              <span style={{ fontSize: 13.5, fontWeight: isToday ? 700 : 500, lineHeight: "22px", minWidth: 22, height: 22, borderRadius: 999, textAlign: "center", background: isToday ? "var(--btn-primary)" : "transparent", color: isToday ? "var(--btn-primary-text)" : here ? "var(--text)" : "var(--text-muted)" }}>
                {d.getDate()}
              </span>
              <span aria-hidden style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 8 }}>
                {posts.slice(0, 3).map((item) => (
                  <span key={item.id} style={{ width: 6, height: 6, borderRadius: "50%", background: dotOf(item) }} />
                ))}
                {posts.length > 3 && <span style={{ fontSize: 12, lineHeight: 1, color: "var(--text-muted)" }}>+{posts.length - 3}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "14px 2px 8px" }}>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.01em", color: "var(--text)" }}>
          {openDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </span>
        <button type="button" onClick={() => onAdd(openKey)} className="btn-ghost-pill" style={{ height: 30, padding: "0 13px", fontSize: 12.5, flex: "none" }}>
          Add post
        </button>
      </div>
      {dayItems.length === 0 ? (
        <p style={{ margin: "0 2px", fontSize: 13.5, lineHeight: 1.5, color: "var(--text-muted)" }}>Nothing planned for this day.</p>
      ) : (
        <div style={{ background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
          {dayItems.map((item, i) => {
            const reminder = isPlanRole(item.plan_role) && item.plan_role === "reminder";
            const channels = channelsOf(item);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpen(item)}
                style={{ font: "inherit", width: "100%", textAlign: "left", border: 0, borderTop: i === 0 ? 0 : "1px solid var(--divider)", background: "transparent", color: "var(--text)", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px", minHeight: 52 }}
              >
                {reminder ? (
                  <span aria-hidden style={{ width: 30, height: 30, flex: "none", borderRadius: 8, border: "1px dashed color-mix(in srgb, var(--alert) 55%, transparent)", background: "color-mix(in srgb, var(--alert) 8%, var(--card))" }} />
                ) : (
                  <span style={{ flex: "none", marginTop: 1 }}><Thumb item={item} size={30} /></span>
                )}
                <span style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, letterSpacing: "-.01em", overflowWrap: "anywhere", color: reminder ? "color-mix(in srgb, var(--alert) 60%, var(--text))" : "var(--text)" }}>
                    {labelOf(item)}
                  </span>
                  {!reminder && (
                    <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5 }}>
                      <StatusWordChip word={deckWordOf(item.status)} />
                      {channels.map((c) => (
                        <span key={c} title={`Going to ${c}`} style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 7, background: `color-mix(in srgb, ${CHANNEL_TINTS[c]} 20%, var(--card))`, border: `1px solid color-mix(in srgb, ${CHANNEL_TINTS[c]} 45%, transparent)`, color: CHANNEL_TINTS[c] }}>
                          <ChannelGlyph c={c} />
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One line of the List view (ticket e794511f, Nikki's columns): Date,
 *  Description (the pillar dot ahead of the title, the concept clamped
 *  underneath), Format, Channels, Status, sharing LIST_COLS with the header
 *  row so the cells stay one grid. minWidth 0 + an ellipsis on every text
 *  cell is the ~700px bleed guard: the row squeezes, it never scrolls the
 *  page sideways. */
function PostListRow({ item, pillar, onOpen }: { item: ContentItem; pillar: ContentPillar | null; onOpen: () => void }) {
  const channels = channelsOf(item);
  const word = deckWordOf(item.status);
  const concept = item.post_concept?.trim() ?? "";
  // Plan role (migration 0085), the DayChip gate: the unusual roles wear a
  // chip beside the title (reminder on the alert family so it never reads as
  // a draftable post, newsletter on the accent tint); plain posts stay bare.
  const role: PlanRole | null = isPlanRole(item.plan_role) ? item.plan_role : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      title={item.scheduled_for ? `${labelOf(item)}, ships ${item.scheduled_for.slice(0, 10)}` : `${labelOf(item)}, not scheduled yet`}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--rail-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      className="cc-list-row"
      style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, padding: "9px 14px", borderBottom: "1px solid var(--divider)", cursor: "pointer", transition: "background .12s" }}
    >
      {/* Date: the short calendar day in merchant caps, No date for the
          undated tail (which is what sorts it last, so the quieter ink). */}
      <span className="cc-col-date" style={{ ...LIST_COLS.date, fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".05em", textTransform: "uppercase", color: item.scheduled_for ? "var(--text-muted)" : "var(--text-muted-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.scheduled_for ? shortDate(item.scheduled_for) : "No date"}
      </span>
      {/* Description: the pillar dot stays ahead of the title (it carries
          pillar context without a column of its own; hover it for the name),
          the concept as the clamped second line. */}
      <span style={{ ...LIST_COLS.desc, display: "flex", flexDirection: "column", gap: 1 }}>
        <span className="cc-list-title-row" style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span aria-hidden title={pillar?.name} style={{ width: 7, height: 7, borderRadius: "50%", background: pillar ? pillarDot(pillar) : "var(--text-muted-2)", flexShrink: 0 }} />
          <span className="cc-list-title" style={{ minWidth: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: "-.01em", color: role === "reminder" ? "var(--text-muted)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {labelOf(item)}
          </span>
          {role && role !== "post" && <PlanRoleChip role={role} />}
        </span>
        {concept && (
          // paddingLeft 13 = the dot (7) plus its gap (6): the concept lines
          // up under the title, not under the dot.
          <span style={{ paddingLeft: 13, fontSize: 12.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {concept}
          </span>
        )}
      </span>
      {/* Format: the medium word, quiet text, empty when unset. isPostMedium
          gates because the column is ordinary text (see POST_MEDIUMS in
          lib/content/types). */}
      <span className="cc-col-format" style={{ ...LIST_COLS.format, fontSize: 12.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {isPostMedium(item.post_medium) ? MEDIUM_LABELS[item.post_medium] : ""}
      </span>
      {/* Channels: the deck foot's glyph chips. The cell renders even when
          empty so Status stays a straight column, and flexWrap lets a
          4+ channel post take a second chip row inside its own cell instead
          of widening it. */}
      <span className="cc-col-channels" style={{ ...LIST_COLS.channels, display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
        {channels.map((c) => (
          <span
            key={c}
            title={`Going to ${c}`}
            style={{ width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 7, background: `color-mix(in srgb, ${CHANNEL_TINTS[c]} 20%, var(--card))`, border: `1px solid color-mix(in srgb, ${CHANNEL_TINTS[c]} 50%, var(--border))`, color: `color-mix(in srgb, ${CHANNEL_TINTS[c]} 70%, var(--text))` }}
          >
            <ChannelGlyph c={c} />
          </span>
        ))}
      </span>
      <span style={{ ...LIST_COLS.status, display: "inline-flex" }}>
        <StatusWordChip word={word} />
      </span>
    </div>
  );
}

/** The plan role as a small read-only chip (migration 0085), the PlanModal
 *  RoleChip's twin (the twins posture: tiny, copied, unentangled): reminder
 *  wears the alert family, newsletter the accent tint. Only rendered for the
 *  unusual roles; plain posts carry no chip. Merchant caps at the 12.5
 *  floor. */
function PlanRoleChip({ role }: { role: PlanRole }) {
  const base = role === "reminder" ? "var(--alert)" : "var(--accent)";
  return (
    <span style={{ flex: "none", fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", padding: "1px 8px", borderRadius: "var(--r-pill)", background: `color-mix(in srgb, ${base} 12%, var(--card))`, border: `1px solid color-mix(in srgb, ${base} 45%, var(--border))`, color: `color-mix(in srgb, ${base} 65%, var(--text))` }}>
      {PLAN_ROLE_LABELS[role]}
    </span>
  );
}

/** The deck word as a read-only chip in WORD_TINTS colours (the restructure
 *  spec), the deck foot's wordChipStyle recipe: Live solid, Approved on the
 *  soft accent wash, the rest a 16% mix of their base into the card. */
function StatusWordChip({ word }: { word: DeckWordKey }) {
  const t = WORD_TINTS[word];
  const colours: React.CSSProperties = t.solid
    ? { background: t.base, border: `1px solid ${t.base}`, color: "#fff" }
    : {
        background: word === "approved" ? "var(--accent-soft)" : `color-mix(in srgb, ${t.base} 16%, var(--card))`,
        border: `1px solid color-mix(in srgb, ${t.base} 50%, var(--border))`,
        color: `color-mix(in srgb, ${t.base} 60%, var(--text))`,
      };
  return (
    <span style={{ flex: "none", fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", padding: "3px 10px", borderRadius: "var(--r-pill)", ...colours }}>
      {WORD_LABELS[word]}
    </span>
  );
}

/** The ONE + button and its dropdown (ticket be527ba7, Mia: "these should be
 *  all condensed into a + icon and then a drop down"): the Plans, Plan and
 *  Add post pills folded into a round primary opening a small menu, with Add
 *  event alongside (ticket c5f5b05c). Each entry closes the menu and fires
 *  the exact action its pill had; Plans only lists once a plan exists,
 *  because before that the panel would open empty. The menu wears the filter
 *  accordion's card-on-hairline look. */
function AddMenu({
  creating,
  hasPlans,
  onAddPost,
  onAddPlan,
  onAddEvent,
  onOpenPlans,
}: {
  creating: boolean;
  hasPlans: boolean;
  onAddPost: () => void;
  onAddPlan: () => void;
  onAddEvent: () => void;
  onOpenPlans: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  // The replaced pills were merchant caps, so the entries stay merchant caps
  // at the 12.5 floor; the hover wash is the toolbar's rail-hover.
  const itemStyle: React.CSSProperties = { display: "block", width: "100%", textAlign: "left", padding: "8px 13px", background: "transparent", border: "none", borderRadius: "var(--r-chip)", cursor: "pointer", fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text)", whiteSpace: "nowrap", transition: "background .12s" };
  const itemIn = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "var(--rail-hover)"; };
  const itemOut = (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "transparent"; };
  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to the calendar"
        title={creating ? "Starting a post" : "Add to the calendar"}
        onClick={() => setOpen((o) => !o)}
        // The black pill primary as a circle, sized to the toolbar's 32px row.
        style={{ width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--btn-primary)", color: "var(--btn-primary-text)", border: "none", borderRadius: "50%", cursor: "pointer", opacity: creating ? 0.6 : 1, transition: "opacity .12s" }}
      >
        {/* Drawn, not typed (the file's glyph rule). */}
        <svg {...GLYPH} width={14} height={14} aria-hidden style={{ transform: open ? "rotate(45deg)" : "none", transition: "transform .12s" }}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {open && (
        <div role="menu" aria-label="Add to the calendar" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60, minWidth: 172, padding: 5, background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-panel)", display: "flex", flexDirection: "column" }}>
          <button type="button" role="menuitem" disabled={creating} onClick={() => pick(onAddPost)} onMouseEnter={itemIn} onMouseLeave={itemOut} style={{ ...itemStyle, opacity: creating ? 0.5 : 1 }}>
            {creating ? "Starting post..." : "Add post"}
          </button>
          <button type="button" role="menuitem" onClick={() => pick(onAddPlan)} onMouseEnter={itemIn} onMouseLeave={itemOut} style={itemStyle}>
            Add plan
          </button>
          <button type="button" role="menuitem" onClick={() => pick(onAddEvent)} onMouseEnter={itemIn} onMouseLeave={itemOut} style={itemStyle}>
            Add event
          </button>
          {hasPlans && (
            <>
              <div aria-hidden style={{ height: 1, margin: "4px 8px", background: "var(--divider)" }} />
              <button type="button" role="menuitem" onClick={() => pick(onOpenPlans)} onMouseEnter={itemIn} onMouseLeave={itemOut} style={itemStyle}>
                Plans
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The Add event dialog (ticket c5f5b05c, Mia: "make it so that we can add
 *  the EVENTS which are the orange markers in the cal"): one title and one
 *  date, created through the ordinary content POST wearing the PlanModal
 *  reminder shape (its createAll body: kind card, source manual, status idea,
 *  plan_role "reminder", no plan_id needed, a reminder is a reminder whether
 *  or not it is grouped), so it lands as exactly the dashed amber marker the
 *  plan generator writes and stays inert on its day (ticket 18d7e7e0). The
 *  overlay idiom is PlanModal's, sized down to the two fields. */
function AddEventDialog({
  defaultDate,
  editItem = null,
  onCreated,
  onClose,
}: {
  /** Where the date field starts: the calendar's newPostDate, so planning a
   *  future month prefills a day in that month, not today. */
  defaultDate: string;
  /** When set, the dialog EDITS that marker (prefilled, PATCH + Delete)
   *  instead of creating a new one (Mia, 2026-09-10). */
  editItem?: ContentItem | null;
  /** The calendar's refetch, awaited before close so the marker is in. */
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const editing = editItem !== null;
  const [title, setTitle] = useState(editItem?.title ?? "");
  const [date, setDate] = useState(defaultDate);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  async function create() {
    if (saving) return;
    const t = title.trim();
    if (!t) {
      setErr("Give the event a name.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setErr("Pick the event's date.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      // Edit mode PATCHes title + date on the existing marker; create mode
      // POSTs a fresh reminder-shaped item.
      const res = editing
        ? await fetch(`/api/v1/content/${editItem.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: t.slice(0, 300), scheduled_for: date }),
          })
        : await fetch("/api/v1/content", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kind: "card", source: "manual", status: "idea", title: t.slice(0, 300), scheduled_for: date, plan_role: "reminder" } as ContentItemInput),
          });
      if (!res.ok) {
        setErr(editing ? "Couldn't save the event. Try again." : "Couldn't add the event. Try again.");
        return;
      }
      await onCreated();
      onClose();
    } catch {
      setErr("Couldn't reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing || deleting || saving) return;
    setDeleting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/content/${editItem.id}`, { method: "DELETE" });
      if (!res.ok) { setErr("Couldn't delete the event. Try again."); return; }
      await onCreated();
      onClose();
    } catch {
      setErr("Couldn't reach the server. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  // PlanModal's field idiom, copied (the twins posture).
  const labelStyle: React.CSSProperties = { display: "block", fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: "100%", background: "var(--field)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--r-chip)", padding: "9px 11px", fontSize: 14 };
  return (
    <>
      <div onClick={() => { if (!saving) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(0,0,0,.45)" }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add event"
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(420px, 94vw)", zIndex: 96, background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-panel)", boxShadow: "var(--shadow-panel)", overflow: "hidden" }}
      >
        {/* Header: the composer's pinned charcoal band (PlanModal's twin). */}
        <div style={{ background: "var(--elevated)", color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".09em", textTransform: "uppercase" }}>{editing ? "Edit event" : "Add event"}</span>
          <button onClick={() => { if (!saving) onClose(); }} aria-label="Close" style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", fontSize: 15, opacity: saving ? 0.5 : 1 }}>✕</button>
        </div>
        <div style={{ padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="cal-event-title">Event</label>
            <input id="cal-event-title" ref={nameRef} value={title} maxLength={300} disabled={saving} onChange={(e) => { setTitle(e.target.value); if (err) setErr(null); }} placeholder="e.g. Waitlist opens" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="cal-event-date">Date</label>
            <input id="cal-event-date" type="date" value={date} disabled={saving} onChange={(e) => { setDate(e.target.value); if (err) setErr(null); }} style={inputStyle} />
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted-2)", lineHeight: 1.5 }}>
            Shows on its day as a dashed marker. A date to heed, not a post to draft.
          </div>
          {err && <div style={{ fontSize: 13, color: "var(--alert)" }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: editing ? "space-between" : "flex-end", alignItems: "center" }}>
            {editing && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={saving || deleting}
                style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: saving || deleting ? "default" : "pointer", opacity: saving || deleting ? 0.6 : 1 }}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void create()}
              disabled={saving || deleting}
              style={{ background: "var(--btn-primary)", color: "var(--btn-primary-text)", border: "none", borderRadius: "var(--r-pill)", padding: "9px 18px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", opacity: saving || deleting ? 0.6 : 1 }}
            >
              {saving ? "Saving..." : editing ? "Save event" : "Add event"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Card thumbnail. A clipped card leads with its own image; a composed post has
 *  none, so its first placeholder (post_images) stands in. Notes carry neither
 *  and fall back to a well, so the chip keeps its shape either way. */
function Thumb({ item, size }: { item: ContentItem; size: number }) {
  const box: React.CSSProperties = { width: size, height: size, flexShrink: 0, borderRadius: size > 20 ? 7 : 4, background: "var(--field)", border: "1px solid var(--hairline)", objectFit: "cover", display: "inline-flex", alignItems: "center", justifyContent: "center" };
  const src = item.image_url ?? item.post_images[0] ?? null;
  if (src) {
    // Clipped media is remote (Pinterest/IG/uploads), which next/image would need
    // a per-host allow-list for, so this stays a plain img (inside ClipImage).
    // ClipImage gives it the failed state: a clip whose original link expired
    // reads as an expired clip here, not as a broken picture. compact because
    // this box runs down to 16px on a day chip, well under the size any caps
    // label could legibly sit in, so the words ride the tooltip instead.
    return <ClipImage src={src} alt="" style={box} compact />;
  }
  // The glyph only earns its place at rail size. Shrinking it to fit a day chip
  // would push it under the 12px legibility floor, so the small well stays plain.
  return (
    <span aria-hidden style={{ ...box, fontSize: 12.5, color: "var(--text-muted-2)" }}>
      {size >= 24 ? <Icon name={item.kind === "note" ? "pencil" : "image"} size={13} /> : null}
    </span>
  );
}
