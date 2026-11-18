"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  isPlanRole,
  CHANNEL_TINTS,
  MEDIUM_LABELS,
  POST_CHANNELS,
  POST_MEDIUMS,
  SECTION_COLORS,
  isPlannedPost,
  isPostChannel,
  isPostMedium,
  type ContentComment,
  type ContentItem,
  type ContentItemInput,
  type ContentPillar,
  type ContentSource,
  type ContentStatus,
  type PostChannel,
  type PostMedium,
  type SourceMedia, POST_ACCOUNT_SUGGESTIONS } from "@/lib/content/types";
import { readCaptionSuggestion, wordDiff, type CaptionSuggestion } from "@/lib/content/caption-suggest";
import { initialsOf, type TaskUser } from "@/lib/tasks/types";
import { ClipImage } from "@/components/content/ClipImage";
import { CommentsPanel } from "@/components/content/CommentsPanel";
import { useArtboardPreview, type ArtboardPreview, type ArtboardSibling, type BoardImage } from "@/components/content/useArtboardPreview";
import { uploadContentFile } from "@/lib/content/upload-client";

/**
 * The Mock-ups editor raised as a dialog OVER the slide (ticket 07e8115a,
 * Mia: edit the artboard "as a pop up window ... so we can flick between the
 * artboard and the copy"): the SAME ExcalidrawBoard the Mock-ups tab mounts,
 * so drawing and saving flow through the board's own autosave and API path.
 * ssr:false because the engine touches window at import time (the ContentView
 * pattern); module scope so the chunk is fetched once, not per open.
 */
/**
 * THE DESIGN TOOL (Mia, 2026-09-18: "i dont want excalidraw i want a design
 * tool"). Edit artboard opens THIS now. The whiteboard below is still
 * mounted, one click away inside it, because every artboard drawn so far
 * lives there and the new editor imports from it on first open — a door to
 * walk back through while both exist, not a second way of working.
 */
const SlideArtboard = dynamic(
  () => import("@/components/artboards/SlideArtboard").then((m) => m.SlideArtboard),
  { ssr: false, loading: () => null },
);

const ArtboardDesigner = dynamic(
  () => import("@/components/artboards/ArtboardEditorNext").then((m) => m.ArtboardEditorNext),
  { ssr: false, loading: () => null },
);

const ArtboardEditor = dynamic(
  () => import("@/components/content/ExcalidrawBoard").then((m) => m.ExcalidrawBoard),
  {
    ssr: false,
    loading: () => (
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>Loading the canvas...</span>
      </div>
    ),
  },
);

/**
 * Marketing > Content, the deck (Mia, 2026-07-22; overlay since the Mia+Nikki
 * restructure, 2026-07-26): no longer a tab of its own. ContentView mounts it
 * as a click-through OVERLAY over the Content pane, opened by clicking a
 * scheduled post on the Calendar (a day chip or a list row); initialItemId
 * stages the clicked post's slide and onBack (the toolbar's ghost button, or
 * Escape outside fullscreen) drops the overlay back onto the underlying tab.
 * Every scheduled post becomes one full slide, styled after Mia's own copy
 * deck (COPY DECK SAMPLE.pdf: 16:9 frames, a big date leading the eye, imagery
 * carrying the left of the frame and the words the right), so the tab reads
 * like the agency deck she already presents from rather than another list.
 *
 * SLIDES ARE DERIVED FROM THE CALENDAR, never stored: a slide is any card or
 * note with a scheduled_for date, in date order. That derivation IS the
 * ordering model, so changing a post's date on the Calendar tab reorders the
 * deck automatically and there is no slide-order state here to drift.
 *
 * The slide-status vocabulary (WIP / Awaiting X input / Approved / Scheduled /
 * Live) is derived too, per the contract comment above POST_MEDIUMS in
 * lib/content/types: the four words read from `status`, and "Awaiting X" is
 * the input_needed_from overlay, written only through the input-request route
 * (which auto-creates the matching task in /tasks).
 *
 * 2026-07-22 second round, Mia's direct note ("the UI isnt close enough to a
 * slide deck... make it closer to the sample deck or a figma deck"): the
 * stage is now a true PowerPoint edit view.
 * - The slide is sized FROM THE VIEWPORT: a ResizeObserver measures the stage
 *   and the slide is the largest 16:9 rect that fits minus small gutters, so
 *   it dominates the pane at any window size instead of stopping at a capped
 *   max-width. Type inside the slide scales with a factor derived from the
 *   measured slide width (scale = width / 1150, clamped), so a bigger stage
 *   means bigger deck-like type, never a stretched card.
 * - The stage floor is a RECESSED canvas (a color-mix wash of --canvas and
 *   --border, deeper in dark mode by construction because the tokens are) and
 *   the slide sits on it as a white sheet under --shadow-panel, the
 *   PowerPoint sheet-on-desk read.
 * - All chrome collapses into ONE compact toolbar row above the stage
 *   (group-by, position, calendar door, fullscreen; the pillar FILTER chips
 *   left in ticket 29847a0f, Group by Pillar covers slicing); it scrolls
 *   sideways rather than wrapping so the vertical space stays with the slide,
 *   and in fullscreen it AUTO-HIDES, reappearing while the pointer is near
 *   the top edge, the Figma present-mode gesture.
 * - Prev/next float as quiet circular buttons OVER the canvas at the slide's
 *   edges, not in the toolbar.
 * - The filmstrip is a real deck navigator: 16:9 thumbs ~100px tall, number
 *   and date on each, the active thumb outlined in --accent, divider chips
 *   still the collapsible group headers.
 *
 * 2026-07-28, Nikki's tickets 9b599621 + 2afa5e36: the slide face is the
 * two-column frame she asked to have back (artwork LEFT, caption RIGHT) with
 * THREE stage tabs across the top, Idea / Storyboard-mockup / Finalised, which
 * page the artwork column through the post's imagery stages (see POST_STAGES).
 * The old IDEATION | FINAL ASSET tabs inside the imagery panel are gone: the
 * stage row above the columns replaces them, so the panel keeps the whole
 * column. The no-scroll contract survives untouched, and the deck itself is
 * now raised as a near-fullscreen overlay by ContentView, from a calendar post
 * OR from Add post (which creates the post first, because slides are derived
 * from dated posts and there has to BE one).
 *
 * Local twins (readErrorMessage, readErrorCode, isTyping, parseYmd,
 * channelsOf, CHANNEL_LABELS) are deliberate copies of the neighbours'
 * helpers, the PostComposer posture: they are tiny, and importing them would
 * entangle this file with components other agents edit.
 */

const MONO = "var(--font-merchant)";

/** No pink token exists in globals.css, so Mia's tag colour is this family
 *  mixed into theme surfaces via color-mix below: the wash tracks the theme's
 *  own card and text, which is what keeps it legible in both modes. */
const PINK = "#E85D9E";

/** Client mirror of the input-request route's zod cap on `what`. */
const ASK_MAX = 500;

/** The slide's design width: the scale factor is measured width over this,
 *  so type at 1150px reads exactly as the first build did and grows or
 *  shrinks proportionally either side. Clamped so a phone-narrow pane stays
 *  legible and a cinema display does not turn the date into a poster. */
const SLIDE_BASE_W = 1150;

/** Breathing room between the slide sheet and the recessed canvas edge. */
const STAGE_GUTTER = 24;

/**
 * The deck's four status words and the stored status each one writes when
 * clicked. WIP covers 'idea', 'drafting' and any status without a deck word
 * of its own (e.g. 'in_review'), so clicking WIP writes 'drafting', the
 * representative working stage; the other three map one-to-one. Any word may
 * be clicked directly: the approval gate that used to 422 Scheduled and Live
 * was removed (ticket 656935b3), and a refused write of any kind still
 * surfaces inline beside the row.
 */
const DECK_WORDS = [
  { key: "wip", label: "WIP", status: "drafting" },
  { key: "approved", label: "Approved", status: "approved" },
  { key: "scheduled", label: "Scheduled", status: "scheduled" },
  { key: "live", label: "Live", status: "posted" },
] as const satisfies readonly { key: string; label: string; status: ContentStatus }[];

type DeckWordKey = (typeof DECK_WORDS)[number]["key"];

/** Each deck word's colour identity (the ticket's mapping): WIP the warning
 *  amber, Approved the soft accent wash, Scheduled the CT blue token (which
 *  the Frosted rebuild keeps as a token NAME), Live the solid accent. Bases
 *  are theme tokens, mixed into surfaces so both modes stay legible. */
const WORD_TINTS: Record<DeckWordKey, { base: string; solid: boolean }> = {
  wip: { base: "var(--alert)", solid: false },
  approved: { base: "var(--accent)", solid: false },
  scheduled: { base: "var(--ct-blue-2)", solid: false },
  live: { base: "var(--accent)", solid: true },
};

/** status -> deck word. The fallback IS the contract: anything without a deck
 *  word of its own (in_review, or a value this build has never heard of) is
 *  still work in progress until an approval lands. */
function deckWordOf(status: string): DeckWordKey {
  if (status === "approved") return "approved";
  if (status === "scheduled") return "scheduled";
  if (status === "posted") return "live";
  return "wip";
}

/**
 * THE POST'S THREE STAGES (ticket 9b599621, Nikki: "3 tabs at the top, the
 * first one being idea, the second being storyboard/mockup and the third being
 * finalised"). A tab swaps the LEFT column's imagery and nothing else: it is
 * the same post throughout, so the copy on the right never changes with the
 * tab. Nothing new is stored for this, the stages read off what a post already
 * carries: the clipped image it grew from IS the idea, the Mock-ups artboard
 * IS the storyboard, and post_images are the finalised assets.
 *
 * The wording says Mock-ups, not "the Board" (ticket a0856f21): the Board is
 * two tabs now, Ideation and Mock-ups, and an artboard only ever lives on the
 * second. A line that still said "the Board" would be pointing at a tab that
 * no longer exists.
 */
const POST_STAGES = [
  // The IDEA tab left with ticket bdc51c6d (Mia: "dont show idea, only show
  // mockup & finalised"): the clip a post grew from stays on the row
  // (image_url is untouched, and dedupe still reads it), it just no longer
  // gets a stage of its own.
  { key: "mockup", label: "Storyboard / mockup", hint: "The artboard designed on Mock-ups" },
  { key: "final", label: "Finalised", hint: "The final imagery attached to this post" },
  // MEDIA USED (Mia, ticket 972a9ea8, 2026-09-28: "another section here
  // called 'MEDIA USED' where I can upload images that Nikki needs to make
  // the work and she can download them full resolution"). Its own column
  // (0132 source_media), so the source files never mix with the stills.
  { key: "media", label: "Media used", hint: "The source images and video Nikki needs to make the work, at full resolution" },
] as const;

type PostStage = (typeof POST_STAGES)[number]["key"];

/** Twin of PostComposer's CHANNEL_LABELS (see the file header on twins). */
const CHANNEL_LABELS: Record<PostChannel, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  email: "Email",
  website: "Website",
  other: "Other",
};

/** The drag payload's own mime for a library thumb (Mia, 2026-07-22: "drop
 *  images from the board & our clips into the slide"): carrying the image URL
 *  under a custom key means the slide only lights its drop-ring for OUR
 *  drags, never for a stray file or text selection dragged across it. */
const IMAGE_MIME = "application/x-sous-image";
/** The stills row's reorder drag (ticket 857bbea0). Its own mime, NOT
 *  IMAGE_MIME, so the sheet-level drop handler (which adds imagery) and the
 *  drop ring both ignore a reorder in flight. */
const STILL_REORDER_MIME = "application/x-sous-still-reorder";

/** The IMAGE_MIME payload for a board image that has no http URL yet (a board
 *  not re-saved under the urlRef storage shape carries only dataURLs, and
 *  post_images stores http(s) URLs only): `sous-file:<fileId>`, which the
 *  slide's drop handler resolves through the hook's upload-and-cache path
 *  before calling addImage. A plain URL payload keeps working unchanged. */
const BOARD_FILE_PREFIX = "sous-file:";

/** The library rail's small source word per clip origin. Keyed on
 *  ContentSource so adding a source is a compile error here. */
const SOURCE_WORDS: Record<ContentSource, string> = {
  pinterest: "Pinterest",
  instagram: "Instagram",
  manual: "Manual",
  upload: "Upload",
  web: "Web",
};

/** Twin of shared.ts's isHttpUrl (the twins rule in the file header): a drop
 *  payload crosses the same trust boundary as a clipped pin, because ANY page
 *  in a drag can write dataTransfer, and the value lands in an <img src>. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Twin of ContentBoard's isTyping: arrow keys must never steal a caret move
 *  from the title input or the copy textarea. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true;
}

/** Twin of ContentCalendar's parseYmd: scheduled_for is a plain calendar day,
 *  and new Date("YYYY-MM-DD") would parse UTC and render a day early east of
 *  GMT (London is BST in July). */
function parseYmd(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

/** The big date header, per Mia's deck: the weekday small above, the date
 *  large. Falls back to the raw string on an unparseable value. */
function slideDate(iso: string): { weekday: string; date: string } {
  const d = parseYmd(iso);
  if (Number.isNaN(d.getTime())) return { weekday: "", date: iso };
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "long" }),
    date: d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
  };
}

/** The filmstrip's short date ("12 Jul"), same parseYmd rules. */
function shortDate(iso: string): string {
  const d = parseYmd(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Twin of ContentCalendar's channelsOf: the array is the truth (0065), each
 *  member gated because the column members are ordinary text; the scalar is
 *  the fallback for rows written before the dual-write existed. */
function channelsOf(item: ContentItem): PostChannel[] {
  const set = (item.post_channels ?? []).filter(isPostChannel);
  if (set.length > 0) return set;
  return isPostChannel(item.post_channel) ? [item.post_channel] : [];
}

/** Twin of ContentCalendar's labelOf. */
function labelOf(item: ContentItem): string {
  return item.title?.trim() || item.note?.trim() || "Untitled";
}

/** The filmstrip thumb's image: the FINISHED imagery first, the idea clip
 *  behind it. Same order the stage tabs open on (ticket 9b599621: a post with
 *  final assets opens on Finalised), so a thumb previews the stage its slide
 *  actually stages rather than an early clip the post has moved past. */
function leadImageOf(item: ContentItem): string | null {
  const all = [...item.post_images, item.image_url].filter((u): u is string => Boolean(u));
  return all[0] ?? null;
}

/** Pillar colour gated to the SECTION_COLORS allow-list (the tintOf posture):
 *  a stray column value must not be able to inject a style. */
function pillarColorOf(p: ContentPillar | null): string | null {
  if (!p?.color) return null;
  return (SECTION_COLORS as readonly string[]).includes(p.color) ? p.color : null;
}

function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || null;
}

/**
 * The "Awaiting X input" tint, per Mia's spec: HER tag is pink, Nikki's is CT
 * blue. Matched by first name from the users list the tasks API returns (the
 * same set the input-request route validates assignees against), never by
 * hardcoded uuids; anyone else gets the neutral field tint. Everything is
 * color-mixed into theme surfaces so both modes stay legible.
 */
function inputTint(name: string | null | undefined): { bg: string; border: string; fg: string } {
  const first = firstNameOf(name)?.toLowerCase();
  const base = first === "mia" ? PINK : first === "nikki" ? "var(--ct-blue-2)" : null;
  if (!base) return { bg: "var(--field)", border: "var(--border)", fg: "var(--text-muted)" };
  return {
    bg: `color-mix(in srgb, ${base} 16%, var(--card))`,
    border: `color-mix(in srgb, ${base} 45%, var(--border))`,
    fg: `color-mix(in srgb, ${base} 55%, var(--text))`,
  };
}

/** The awaiting dot-chip's raw base colour (the dot itself, undiluted): Mia
 *  pink, Nikki CT blue, neutral for anyone else. inputTint above carries the
 *  mixed washes; the dot wants the identity colour straight. */
function inputDot(name: string | null | undefined): string {
  const first = firstNameOf(name)?.toLowerCase();
  return first === "mia" ? PINK : first === "nikki" ? "var(--ct-blue-2)" : "var(--text-muted-2)";
}

/** Twin of PostComposer's readErrorMessage (house envelope { error: { code, message } }). */
function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

/** Twin of PostComposer's readErrorCode, the machine half of the envelope. */
function readErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && code ? code : null;
}

/**
 * Twin of PostComposer's uploadImage: one file to the content-media bucket
 * through POST /api/v1/content/upload (multipart `file`), the storable http
 * URL back. Throws rather than returning null because every failure has a
 * DIFFERENT cause the user can act on (too big, wrong type, storage down) and
 * the message is the whole point. The size/type ceilings live in the route on
 * purpose: a copied limit here would drift.
 */
async function uploadMedia(file: File): Promise<string> {
  // The transport lives in lib/content/upload-client now (2026-09-22): a file
  // over 4MB cannot pass through a Vercel function at all, so it goes straight
  // to storage there, and everything smaller still takes the multipart route.
  const url = await uploadContentFile(file, "Couldn't upload that file. Try again.");
  // post_images validates as http(s) capped at 2000 chars (shared.ts);
  // checking here turns a later 422 into a sentence on the action that failed.
  if (!isHttpUrl(url) || url.length > 2000) {
    throw new Error("That upload came back without a usable link, so it isn't attached.");
  }
  return url;
}

type PatchResult = { ok: true } | { ok: false; code: string | null; message: string };

/** Twin of the deck-sections route's DeckSection (the twins rule in the file
 *  header): one MANUAL labelled break, stored per region (migration 0072),
 *  its `position` a point in the dayKeyOf numeric space below. */
type DeckSection = { id: string; label: string; position: number; created_at: string };

/**
 * A slide's sortable DAY KEY: whole days since the Unix epoch, straight from
 * the scheduled_for string (never through Date parsing, the parseYmd
 * timezone rule). This is the numeric space content_deck_sections.position
 * lives in too, FRACTIONAL: a break at K - 0.5 sits just before day K, and
 * inserting between two breaks is midpoint arithmetic. Keying a break
 * against day keys rather than slide indexes means dates moving on the
 * Calendar reorder slides around the break instead of orphaning it; the
 * trade, documented in migration 0072, is day granularity (a break cannot
 * sit between two slides sharing one day).
 */
function dayKeyOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return 0;
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** A deck position: a post slide, a derived group divider when grouping, or a
 *  stored MANUAL section break in the ungrouped deck (ticket fbe2f5d5).
 *  groupKey ties the first two kinds to their group so the filmstrip can
 *  collapse a divider's slides; a section has none (nothing collapses). */
type Slide =
  | { kind: "post"; item: ContentItem; number: number; groupKey: string | null }
  | { kind: "divider"; name: string; color: string | null; count: number; groupKey: string }
  | { kind: "section"; section: DeckSection; count: number; groupKey: null };

/** The grouping axes (the old Group-by-pillar toggle, generalised). The
 *  pills that chose one left with the toolbar row (ticket 0f562676); the
 *  deck now always groups by "none", the machinery stays for a return. */
type GroupBy = "none" | "pillar" | "status" | "channel";

/** Where the filmstrip's folded/open choice lives between visits (ticket
 *  10461678): browser furniture like the board's collapsed groups, so
 *  localStorage, never a column. */
const STRIP_KEY = "sous-deck-filmstrip";

/** Whether the deck is showing comments at all (Mia, 2026-09-15: "make it so
 *  that the comments hide on default and there's a button that says 'show
 *  comments' so we can send to the designer without the comments visible but
 *  they're still there"). Browser furniture like the filmstrip's fold, so
 *  localStorage; DEFAULT OFF, because the shareable state is the clean one. */
const COMMENTS_KEY = "sous-deck-comments";

const capsLabel: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 12.5,
  fontWeight: 500,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--text-muted-2)",
};

const fieldInput: React.CSSProperties = {
  width: "100%",
  background: "var(--field)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-chip)",
  padding: "9px 11px",
  fontSize: 14,
};

/** The composer's channel-pill idiom, shared by every pill row on a slide. */
function pillStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: MONO,
    fontWeight: 500,
    fontSize: 12.5,
    letterSpacing: ".05em",
    textTransform: "uppercase",
    padding: "5px 11px",
    borderRadius: 999,
    cursor: "pointer",
    border: active ? "1px solid var(--text)" : "1px solid var(--border)",
    background: active ? "var(--elevated)" : "var(--field)",
    color: active ? "#fff" : "var(--text-muted)",
  };
}

/** A deck word's pill: neutral until it is the slide's word, then its own
 *  colour identity from WORD_TINTS (Live goes solid, the others wash). */
function wordChipStyle(key: DeckWordKey, active: boolean): React.CSSProperties {
  if (!active) return pillStyle(false);
  const t = WORD_TINTS[key];
  if (t.solid) {
    return { ...pillStyle(true), background: t.base, border: `1px solid ${t.base}`, color: "#fff" };
  }
  return {
    ...pillStyle(true),
    background: key === "approved" ? "var(--accent-soft)" : `color-mix(in srgb, ${t.base} 16%, var(--card))`,
    border: `1px solid color-mix(in srgb, ${t.base} 50%, var(--border))`,
    color: `color-mix(in srgb, ${t.base} 60%, var(--text))`,
  };
}

/**
 * Inline stroke glyphs, the nav.tsx icon idiom (2px round strokes on a 24
 * grid, currentColor): one per channel, medium and deck word, so the foot's
 * collapsed chips read visually instead of as word lists (Mia, 2026-07-22:
 * "colour coded / visual iconicised"). Local to the deck for the twin reason
 * in the file header: nav's icons are nav's.
 */
const GLYPH = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

function ChannelGlyph({ c, size = 14 }: { c: PostChannel; size?: number }) {
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

function MediumGlyph({ m, size = 14 }: { m: PostMedium; size?: number }) {
  const p = { ...GLYPH, width: size, height: size, "aria-hidden": true };
  if (m === "paid") return <svg {...p}><path d="M4 4h7l9 9-7 7-9-9V4z" /><path d="M8 8h.01" /></svg>; // the price tag
  if (m === "email") return <svg {...p}><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="m4.5 7.5 7.5 5.5 7.5-5.5" /></svg>;
  return <svg {...p}><path d="M5 21C5 12 9.5 6.5 19 5c-.8 9.5-5.5 14.2-14 16z" /><path d="M5 21c2.8-5.5 6.5-9.5 10-12" /></svg>; // organic: the leaf
}

function WordGlyph({ w, size = 13 }: { w: DeckWordKey; size?: number }) {
  const p = { ...GLYPH, width: size, height: size, "aria-hidden": true };
  if (w === "wip") return <svg {...p}><path d="m14.5 5.5 4 4L8 20l-5 1 1-5L14.5 5.5z" /></svg>; // the pencil
  if (w === "approved") return <svg {...p}><path d="m5 13 4.5 4.5L19 7" /></svg>; // the check
  if (w === "scheduled") return <svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>; // the clock
  return <svg {...p}><circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none" /></svg>; // live: the filled dot
}

/** A selected channel as a small square icon chip wearing the channel's own
 *  CHANNEL_TINTS identity, color-mixed into theme surfaces so both modes
 *  stay legible (the inputTint recipe). */
function channelChipStyle(c: PostChannel): React.CSSProperties {
  const base = CHANNEL_TINTS[c];
  return {
    width: 26,
    height: 26,
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    borderRadius: 8,
    cursor: "pointer",
    background: `color-mix(in srgb, ${base} 20%, var(--card))`,
    border: `1px solid color-mix(in srgb, ${base} 50%, var(--border))`,
    color: `color-mix(in srgb, ${base} 70%, var(--text))`,
  };
}

/** One row inside a foot popover. Buttons, so the menus stay keyboard
 *  reachable; the active row sits on the field wash. */
function menuItemStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "7px 9px",
    borderRadius: "var(--r-chip)",
    border: "none",
    background: active ? "var(--field)" : "transparent",
    color: "var(--text)",
    fontSize: 13,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

/**
 * The foot's popover primitive, the NotificationsBell posture: the trigger
 * button and, while open, a frosted card absolutely positioned ABOVE it (the
 * foot is the slide's last row, so up is where the room is and the card stays
 * inside the sheet's overflow:hidden). Closes on outside mousedown and on
 * Escape; children get `close` so a one-shot action can shut the card behind
 * itself while multi-select menus simply never call it.
 */
function FootPopover({
  trigger,
  ariaLabel,
  title,
  triggerStyle,
  disabled,
  children,
}: {
  trigger: React.ReactNode;
  ariaLabel: string;
  title?: string;
  triggerStyle: React.CSSProperties;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        title={title ?? ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={triggerStyle}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            zIndex: 40,
            minWidth: 180,
            padding: 5,
            background: "color-mix(in srgb, var(--card) 92%, transparent)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-lg)",
            boxShadow: "var(--shadow-panel)",
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

/** The slide's quiet icon buttons (ticket 39c34c33: the four worded
 *  add/download pills collapsed into a plus and a download icon, each
 *  opening its little menu). Squarer and smaller than the toolbar circles
 *  because they sit inside the artwork column, not on chrome. */
const slideIconBtn: React.CSSProperties = {
  flex: "none",
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  borderRadius: "50%",
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text-muted)",
  cursor: "pointer",
};

/** The toolbar's round icon buttons (the NotificationsBell glass circle),
 *  replacing the worded Calendar and Fullscreen pills (Mia, 2026-07-22). */
const toolbarIconBtn: React.CSSProperties = {
  flex: "none",
  width: 30,
  height: 30,
  borderRadius: "50%",
  background: "var(--glass)",
  border: "1px solid var(--hairline)",
  color: "var(--text)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

/** The artboard pager's flick arrows (ticket 6b565b4f): the deck's frosted
 *  arrow circles shrunk into the storyboard panel, vertically centred over
 *  the render's edges. Ends disable rather than vanish, the move-control
 *  idiom, so the pair always reads as one control. */
function artboardArrowStyle(side: "left" | "right", disabled: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    ...(side === "left" ? { left: 6 } : { right: 6 }),
    zIndex: 2,
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: "1px solid var(--hairline)",
    background: "color-mix(in srgb, var(--card) 84%, transparent)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    boxShadow: "var(--shadow-card)",
    color: "var(--text-muted)",
    cursor: disabled ? "default" : "pointer",
    fontSize: 15,
    lineHeight: 1,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: disabled ? 0.3 : 1,
  };
}

/** The floating prev/next buttons over the recessed canvas: quiet frosted
 *  circles at the slide's edges, the Figma-viewer idiom. */
function arrowStyle(disabled: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 5,
    width: 42,
    height: 42,
    borderRadius: "50%",
    border: "1px solid var(--hairline)",
    background: "color-mix(in srgb, var(--card) 84%, transparent)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    boxShadow: "var(--shadow-card)",
    color: "var(--text-muted)",
    cursor: disabled ? "default" : "pointer",
    fontSize: 18,
    lineHeight: 1,
    opacity: disabled ? 0.3 : 1,
  };
}

export function PostDeck({
  items,
  onChange,
  initialItemId,
  onBack,
}: {
  items: ContentItem[];
  onChange: () => void;
  /** The post the overlay was opened FROM (the restructure spec): the deck
   *  stages the slide whose item carries this id. Optional so the deck still
   *  compiles standalone, opening on slide one. */
  initialItemId?: string | null;
  /** The overlay's way back to the underlying tab: the toolbar's quiet
   *  "Back to calendar" ghost button and Escape (outside fullscreen) both
   *  call it. Optional so the deck stands alone, hiding the affordance. */
  onBack?: () => void;
}) {
  const [index, setIndex] = useState(0);
  // The Group-by pills left with the toolbar row (ticket 0f562676, Mia:
  // "remove this bar when we have the post copy deck open. we dont need
  // it"), so the deck stays in calendar order; the grouping machinery below
  // is kept intact behind this one constant should a grouped view return.
  const [groupBy] = useState<GroupBy>("none");
  // Which groups the filmstrip has folded shut, by groupKey. Collapse is
  // strip furniture, so switching the grouping axis resets it.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // The whole filmstrip folds (ticket 10461678, Mia: "make it so this is
  // collapsible"): a slim header row stays with the position, the thumbs
  // come and go under it, and the choice survives a reload via localStorage.
  const [stripOpen, setStripOpen] = useState(() => {
    try {
      return typeof window === "undefined" || window.localStorage.getItem(STRIP_KEY) !== "shut";
    } catch {
      return true; // storage blocked: the strip simply starts open
    }
  });
  // Comments off until asked for, so a deck opened in front of a designer
  // carries no internal notes. Nothing is deleted: the threads are untouched
  // and one click brings every one of them back.
  const [commentsShown, setCommentsShown] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(COMMENTS_KEY) === "shown";
    } catch {
      return false; // storage blocked: stay on the safe, clean default
    }
  });
  const toggleComments = () =>
    setCommentsShown((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(COMMENTS_KEY, next ? "shown" : "hidden");
      } catch {
        /* storage blocked: the choice lasts this visit only */
      }
      return next;
    });
  const toggleStrip = () =>
    setStripOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STRIP_KEY, next ? "open" : "shut");
      } catch {
        /* storage blocked: the choice lasts this visit only */
      }
      return next;
    });
  // The image library rail (Mia, 2026-07-22: "drop images from the board &
  // our clips into the slide"). Open state lives at the deck because the rail
  // sits BESIDE the stage: opening it narrows the canvas and the
  // ResizeObserver refits the 16:9 sheet; closed it renders nothing at all,
  // so the slide keeps every pixel.
  const [libraryOpen, setLibraryOpen] = useState(false);

  // SHARE THIS POST (Mia, 12 Aug): the toolbar's Copy-link button puts
  // /content?post=<id> on the clipboard; the receiving side already exists
  // (ContentView reads and clears the param). Confirmation is the transient
  // label-swap idiom (ConnectionsPanel's Copy), not an alert: linkCopied
  // lights a caps chip beside the button for a beat, and the timer rides a
  // ref so a re-render never orphans a pending reset.
  const [linkCopied, setLinkCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );
  const copyPostLink = useCallback(async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/content?post=${id}`);
      setLinkCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setLinkCopied(false), 2200);
    } catch {
      // Clipboard blocked (permissions, insecure context): the ConnectionsPanel
      // Copy posture, the button simply does not confirm.
    }
  }, []);

  // Pillars, the ContentCalendar idiom: the deck reads them for the slide
  // tags and the divider slides; a failure degrades to no pillar layer rather
  // than an error state. A callback rather than a one-shot effect (Nikki's
  // lab, 2026-08-12) so the slide's Content pillar picker can refetch after
  // creating a new pillar.
  const [pillars, setPillars] = useState<ContentPillar[]>([]);
  const loadPillars = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/content/pillars");
      if (!res.ok) return;
      const j = (await res.json()) as { data?: ContentPillar[] };
      if (Array.isArray(j?.data)) setPillars(j.data);
    } catch {
      /* the pillar layer just does not render */
    }
  }, []);
  useEffect(() => {
    void loadPillars();
  }, [loadPillars]);

  // Who can be asked for input: the tasks module's own assignable-users list
  // (GET /api/v1/tasks returns { users }), the same set the input-request
  // route validates assignees against, so ids resolve here instead of being
  // hardcoded. A failure just hides the ask chips; the deck still reads.
  const [users, setUsers] = useState<TaskUser[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/tasks", { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { users?: TaskUser[] };
        if (!cancelled && Array.isArray(j?.users)) setUsers(j.users);
      } catch {
        /* the ask chips just do not render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // MANUAL section breaks (ticket fbe2f5d5): labelled separators the team
  // drops between slides when the deck is ungrouped, stored per region
  // (migration 0072) so both edit the same deck. Loaded once and refetched
  // after every mutation; a failure, or the migration not applied yet,
  // degrades to a deck without breaks, the pillars posture above.
  const [sections, setSections] = useState<DeckSection[]>([]);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState("");
  const [sectionBusy, setSectionBusy] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const [sectionErr, setSectionErr] = useState<string | null>(null);
  // Section mutations can settle after the tab unmounts; the PostSlide
  // aliveRef posture, hoisted to the deck for its own fetches.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const loadSections = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/content/deck-sections", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { data?: DeckSection[] };
      if (aliveRef.current && Array.isArray(j?.data)) setSections(j.data);
    } catch {
      /* the breaks just do not render */
    }
  }, []);
  useEffect(() => {
    // The IIFE keeps the analyzer sure no setState runs before the await
    // (the pillars effect's shape); aliveRef covers the unmount race.
    (async () => {
      await loadSections();
    })();
  }, [loadSections]);

  // Sections are board furniture (the calendar's rule), so they are filtered
  // out; posts are not, dated or not.
  //
  // Undated posts USED to be excluded here, which meant taking a date off a
  // post made it vanish from the deck with nowhere to see it (Nikki,
  // 2026-09-11: "so that I can see them undated and just there as a WIP /
  // Idea for now"). They now ride along at the end of the deck. Grouping by
  // pillar or status never looked at the date, so those modes are unaffected.
  //
  // Reminder markers (the amber "12pm tickets open to waitlist" chips, plan
  // role "reminder") are dates to heed, not posts to draft: the calendar never
  // opens them in the deck (18d7e7e0), and they get no copy slide here either
  // (ticket 4aa3b813, Mia: "the yellow placeholders shouldn't have copy
  // slides associated with them").
  const scheduled = useMemo(
    () => items.filter((i) => (i.kind === "card" || i.kind === "note") && !(isPlanRole(i.plan_role) && i.plan_role === "reminder")),
    [items],
  );
  // The library's clips: everything with imagery that is NOT itself a planned
  // post (the board tickets' inspiration rule: pins, clips, dragged-in board
  // images), newest first. The predicate narrows image_url to a string so the
  // rail never re-checks it.
  const clips = useMemo(
    () =>
      items
        .filter((i): i is ContentItem & { image_url: string } => Boolean(i.image_url) && !isPlannedPost(i))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [items],
  );

  const byId = useMemo(() => new Map(pillars.map((p) => [p.id, p])), [pillars]);

  const slides = useMemo<Slide[]>(() => {
    // Date ascending; created_at breaks ties so two posts on one day keep a
    // stable order between refetches. String compare is safe: both are
    // ISO-shaped and same-length within a field.
    // Undated sorts LAST, not first: an empty string would lead the deck with
    // the ideas and bury the plan. The sentinel is past any real date, and the
    // strings are same-shaped so a plain compare is safe.
    const UNDATED_LAST = "9999-12-31";
    const dated = [...scheduled].sort(
      (a, b) =>
        (a.scheduled_for || UNDATED_LAST).localeCompare(b.scheduled_for || UNDATED_LAST) ||
        a.created_at.localeCompare(b.created_at),
    );
    // Numbers run over the WHOLE deck in deck order, so a slide keeps its
    // number when a group folds shut and "slide 7" stays meaningful; manual
    // breaks never take a number.
    let n = 0;
    const post = (item: ContentItem, groupKey: string | null): Slide => ({ kind: "post", item, number: ++n, groupKey });
    if (groupBy === "none") {
      // The ungrouped deck interleaves the MANUAL breaks (ticket fbe2f5d5):
      // a break lands before the first slide whose day key is >= its
      // position (a tie means the break opens that day). Grouped decks get
      // their own derived dividers, so the manual ones stand down there.
      if (sections.length === 0) return dated.map((item) => post(item, null));
      const ordered = [...sections].sort(
        (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
      );
      const out: Slide[] = [];
      let si = 0;
      for (const item of dated) {
        const key = dayKeyOf(item.scheduled_for ?? "");
        while (si < ordered.length && ordered[si].position <= key) {
          out.push({ kind: "section", section: ordered[si], count: 0, groupKey: null });
          si += 1;
        }
        out.push(post(item, null));
      }
      for (; si < ordered.length; si += 1) out.push({ kind: "section", section: ordered[si], count: 0, groupKey: null });
      // Each break's count is the slides under it down to the next break,
      // filled in one backwards pass over the finished order.
      let tally = 0;
      for (let i = out.length - 1; i >= 0; i--) {
        const s = out[i];
        if (s.kind === "post") tally += 1;
        else if (s.kind === "section") {
          s.count = tally;
          tally = 0;
        }
      }
      return out;
    }
    // Grouped: each section opened by a divider slide (the agency deck
    // section break), date order within. An empty group renders nothing.
    const out: Slide[] = [];
    const push = (groupKey: string, name: string, color: string | null, members: ContentItem[]) => {
      if (members.length === 0) return;
      out.push({ kind: "divider", name, color, count: members.length, groupKey });
      for (const item of members) out.push(post(item, groupKey));
    };
    if (groupBy === "pillar") {
      const ordered = [...pillars].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
      const placed = new Set<string>();
      for (const p of ordered) {
        const mine = dated.filter((i) => i.pillar_id === p.id);
        for (const i of mine) placed.add(i.id);
        push(`pillar:${p.id}`, p.name, pillarColorOf(p), mine);
      }
      // Posts with no pillar (or a pillar row that failed to load) close the
      // deck under their own break, so nothing silently disappears.
      push("pillar:none", "No pillar", null, dated.filter((i) => !placed.has(i.id)));
    } else if (groupBy === "status") {
      // Deck-word order IS the lifecycle order; dividers wear the word's colour.
      for (const w of DECK_WORDS) {
        push(`status:${w.key}`, w.label, WORD_TINTS[w.key].base, dated.filter((i) => deckWordOf(i.status) === w.key));
      }
    } else {
      // Channel: a post lives under its FIRST channel only, so a multi-channel
      // post appears exactly once and numbering never double-counts.
      for (const c of POST_CHANNELS) {
        push(`channel:${c}`, CHANNEL_LABELS[c], null, dated.filter((i) => channelsOf(i)[0] === c));
      }
      push("channel:none", "No channel", null, dated.filter((i) => channelsOf(i).length === 0));
    }
    return out;
  }, [scheduled, groupBy, pillars, sections]);

  // What the deck actually pages through: a collapsed group keeps its divider
  // but hides its post slides, so arrows and the strip skip them together.
  const visible = useMemo(
    () => slides.filter((s) => s.kind === "divider" || !s.groupKey || !collapsed.has(s.groupKey)),
    [slides, collapsed],
  );

  // THE STAGED SLIDE (the overlay contract): the deck opens ON the clicked
  // calendar post. Derived, not an effect: pillars and sections load async
  // and re-splice the deck, so an index taken once at mount would drift;
  // following the id keeps the right slide staged however the deck reshapes,
  // until the first navigation clears it and plain index paging takes over.
  const [stagedId, setStagedId] = useState<string | null>(initialItemId ?? null);
  const stagedIndex = useMemo(
    () => (stagedId ? visible.findIndex((s) => s.kind === "post" && s.item.id === stagedId) : -1),
    [visible, stagedId],
  );
  // Clamp by derivation, not effect: slides shrink when a date clears or a
  // filter lands, and the current position must stay inside the deck.
  const current = stagedIndex >= 0 ? stagedIndex : visible.length > 0 ? Math.min(index, visible.length - 1) : 0;

  /** Every navigation lands here: taking a position releases the staged id,
   *  otherwise the derivation above would snap the deck back to it. */
  const goTo = useCallback((i: number) => {
    setStagedId(null);
    setIndex(i);
  }, []);

  const step = useCallback(
    (delta: number) => {
      goTo(Math.max(0, Math.min(visible.length - 1, current + delta)));
    },
    [visible.length, current, goTo],
  );

  /**
   * PREV / NEXT ARTBOARD (Mia, ticket ade67446, 2026-09-18: "a button on the
   * bottom right that should say next artboard / prev artboard and then
   * navigate to the next collection in the same order as the post slides").
   * The neighbouring POST slides in deck order, dividers skipped; landing on
   * one with the editor wanted open re-opens the designer on that post, since
   * the slide remounts on every page turn.
   */
  const [artboardWanted, setArtboardWanted] = useState(false);
  const neighbourPost = useCallback(
    (delta: number): number | null => {
      let i = current + delta;
      while (i >= 0 && i < visible.length) {
        if (visible[i].kind === "post") return i;
        i += delta;
      }
      return null;
    },
    [visible, current],
  );
  const artboardNav = useMemo(
    () => ({
      hasPrev: neighbourPost(-1) !== null,
      hasNext: neighbourPost(1) !== null,
      step: (delta: number) => {
        const target = neighbourPost(delta);
        if (target === null) return;
        setArtboardWanted(true);
        goTo(target);
      },
    }),
    [neighbourPost, goTo],
  );

  /** Fold a group shut or open from its divider thumb, landing on the divider
   *  so the stage never sits on a slide the strip just hid. */
  const toggleGroup = useCallback(
    (groupKey: string) => {
      const next = new Set(collapsed);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      setCollapsed(next);
      const di = slides
        .filter((s) => s.kind === "divider" || !s.groupKey || !next.has(s.groupKey))
        .findIndex((s) => s.kind === "divider" && s.groupKey === groupKey);
      if (di >= 0) goTo(di);
    },
    [collapsed, slides, goTo],
  );

  // Fullscreen presentation mode: the deck pane itself goes fullscreen, so
  // the filters, the filmstrip and the foot popovers (DOM children) stay
  // usable.
  // Escape is the Fullscreen API's own exit; fullscreenchange is the truth
  // either way, so state never drifts from what the browser actually did.
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === paneRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        /* the browser said no; the button simply does nothing */
      });
    } else {
      paneRef.current?.requestFullscreen().catch(() => {
        /* ditto: some contexts (iframes without allowfullscreen) refuse */
      });
    }
  }, []);

  // The old top toolbar row (and its fullscreen peek-on-hover) is GONE
  // (ticket 0f562676): what it held that still matters (position, copy link,
  // delete post, the way back) now rides the filmstrip's slim header row at
  // the foot of the deck, which is the row Mia asked to be able to fold.

  // Arrow keys page the deck, F toggles fullscreen and Escape closes the
  // overlay, EXCEPT while typing (the board's isTyping guard) or with a
  // modifier held (Cmd+F is find, not ours).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "f" || e.key === "F") toggleFullscreen();
      else if (e.key === "Escape" && onBack) {
        // Fullscreen keeps Escape as the browser's own exit, an open foot
        // popover owns it too (role=menu is FootPopover's card, which closes
        // itself on this same event), and so does any dialog over the slide
        // (the artboard editor, the comments panel); only otherwise is Escape
        // the overlay's quiet way back (the ContentView contract).
        if (document.fullscreenElement || document.querySelector('[role="menu"], [role="dialog"]')) return;
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, toggleFullscreen, onBack]);

  // Keep the lit thumbnail in view as the deck pages past the strip's edge.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stripRef.current?.children[current] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  // THE STAGE MEASURE: the slide is sized from the viewport, not a capped
  // max-width. A ResizeObserver watches the recessed canvas and the slide is
  // the largest 16:9 rect that fits inside it minus the gutters; the type
  // scale rides the result. contentRect over getBoundingClientRect because
  // the observer already hands it over and it excludes the border.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageBox, setStageBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setStageBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // On a phone the 24px desk round the sheet is a fifth of the screen spent
  // on nothing (Nikki, 2026-09-21), so the sheet takes the stage edge to edge
  // there. Decided from the raw stage width, before the gutter is taken off.
  const phoneStage = stageBox.w > 0 && stageBox.w < 640;
  const stageGutter = phoneStage ? 0 : STAGE_GUTTER;
  const availW = Math.max(0, stageBox.w - stageGutter * 2);
  const availH = Math.max(0, stageBox.h - stageGutter * 2);
  // On a phone the fixed 16:9 sheet becomes an unreadable strip (~358x201),
  // with no room for the stacked artwork+caption, so it renders near-empty.
  // Below a narrow stage the slide goes PORTRAIT (full width, tall) and the
  // deck scrolls instead of fitting no-scroll, so the whole slide is legible
  // and editable (Mia 2026-09-11: "need to be able to see the full slide").
  const isMobile = stageBox.w > 0 && stageBox.w < 640;
  // The 320 floor keeps the first unmeasured frame (and absurdly small
  // panes) from collapsing the sheet to nothing.
  const slideW = isMobile
    ? Math.max(320, availW)
    : Math.max(320, Math.min(availW, (availH * 16) / 9));
  const slideH = isMobile ? Math.round(slideW * 1.45) : (slideW * 9) / 16;
  const slideScale = Math.min(1.6, Math.max(0.7, slideW / SLIDE_BASE_W));
  // The floating arrows sit just outside the sheet when the canvas has slack,
  // hugging the stage edge when it does not.
  const arrowInset = Math.max(10, (stageBox.w - slideW) / 2 - 54);

  /** One PATCH door for every inline edit on a slide, refetching on success
   *  (the ContentView refresh contract). Errors come back to the caller so
   *  they surface beside the control that asked, never in an alert. */
  const patchItem = useCallback(
    async (id: string, body: ContentItemInput): Promise<PatchResult> => {
      try {
        const res = await fetch(`/api/v1/content/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const j: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          return { ok: false, code: readErrorCode(j), message: readErrorMessage(j) ?? "That change did not save. Try again." };
        }
        onChange();
        return { ok: true };
      } catch {
        return { ok: false, code: null, message: "The request didn't reach the server. Check your connection and try again." };
      }
    },
    [onChange],
  );

  /** The staged slide's addImage AND its inline error setter, surfaced
   *  through a ref: the library rail is the DECK's child, not the slide's, so
   *  its click fallback reaches whichever post slide is on stage through this
   *  channel, and a board-image upload that fails in the rail words itself
   *  through the slide's existing err line. A divider or an empty stage
   *  leaves it null and the rail's buttons disable themselves. */
  const addToSlideRef = useRef<{ add: (url: string) => void; fail: (message: string) => void } | null>(null);

  const slide = visible[current];

  // THE ARTBOARD PAGER'S SELECTION (ticket 6b565b4f): which sibling artboard
  // the staged slide is showing. Deck level like the hook itself, because the
  // slide remounts on every page turn. The selection remembers WHICH ITEM it
  // was made on and simply reads as null for any other, so paging the deck
  // always lands on the next post's own board with no reset effect.
  const stagedItemId = slide?.kind === "post" ? slide.item.id : null;
  const [paged, setPaged] = useState<{ itemId: string; frameId: string } | null>(null);
  const pagedFrameId = paged && paged.itemId === stagedItemId ? paged.frameId : null;
  const shownFrameId = pagedFrameId ?? (slide?.kind === "post" ? slide.item.board_frame_id : null);

  // The staged slide's ideation-artboard preview (Mia, 2026-07-22: the Board
  // "draws straight into the image section") plus the board-image inventory
  // for the library rail. The hook lives HERE, not in PostSlide, because the
  // slide is keyed by item id and remounts on every page turn, which would
  // throw away the hook's one-fetch-per-mount snapshot and its per-frame
  // export cache; see useArtboardPreview for the contract. libraryOpen is the
  // inventory trigger: a closed rail costs nothing. The frame handed in is
  // the PAGER's selection, so flicking a sibling re-exports that sibling
  // through the same cache.
  const { preview: artboard, artboards, boardImages, resolveBoardImage, invalidate: invalidateArtboards } = useArtboardPreview(
    shownFrameId,
    libraryOpen,
  );

  /** The house fetch wrapper for the three section mutations: same error
   *  surfacing (the envelope message into sectionErr), same refetch-on-ok,
   *  so create, move and delete stay three one-liners. */
  const sectionRequest = async (path: string, init: RequestInit) => {
    if (sectionBusy) return false;
    setSectionBusy(true);
    setSectionErr(null);
    try {
      const res = await fetch(path, init);
      const j: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return false;
      if (!res.ok) {
        setSectionErr(readErrorMessage(j) ?? "That change did not save. Try again.");
        return false;
      }
      await loadSections();
      return true;
    } catch {
      if (aliveRef.current) setSectionErr("The request didn't reach the server. Check your connection and try again.");
      return false;
    } finally {
      if (aliveRef.current) setSectionBusy(false);
    }
  };

  /** "+ Section" lands the new break just before the STAGED post slide's day
   *  (navigate to where the section should start, then add it, the tooltip's
   *  wording); a staged break or an empty stage appends after the last
   *  slide. Day keys, not indexes: see dayKeyOf. */
  const createSection = async () => {
    const label = sectionDraft.trim();
    if (!label) return;
    let position: number;
    if (slide?.kind === "post") {
      position = dayKeyOf(slide.item.scheduled_for ?? "") - 0.5;
    } else {
      let lastKey: number | null = null;
      for (const s of slides) if (s.kind === "post") lastKey = dayKeyOf(s.item.scheduled_for ?? "");
      position = lastKey !== null ? lastKey + 0.5 : 0;
    }
    const ok = await sectionRequest("/api/v1/content/deck-sections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, position }),
    });
    if (ok && aliveRef.current) {
      setSectionDraft("");
      setAddingSection(false);
    }
  };

  /** Reorder a break one deck position up or down: the new position is the
   *  midpoint of the keys either side of the target slot (dayKeyOf for
   *  slides, position for breaks). Two slides sharing a day share a key, so
   *  a move across them clears the whole day in one step; that is the day
   *  granularity the storage model trades for date-anchoring, not a bug. */
  const moveSection = async (section: DeckSection, dir: -1 | 1) => {
    const i = slides.findIndex((s) => s.kind === "section" && s.section.id === section.id);
    if (i < 0) return;
    const keyOf = (s: Slide): number =>
      s.kind === "post" ? dayKeyOf(s.item.scheduled_for ?? "") : s.kind === "section" ? s.section.position : 0;
    let position: number;
    if (dir === -1) {
      if (i === 0) return;
      const right = keyOf(slides[i - 1]);
      const left = i >= 2 ? keyOf(slides[i - 2]) : right - 1;
      // Equal neighbours (a same-day run): step to just before the run.
      position = left < right ? (left + right) / 2 : right - 0.5;
    } else {
      if (i >= slides.length - 1) return;
      const left = keyOf(slides[i + 1]);
      const right = i + 2 < slides.length ? keyOf(slides[i + 2]) : left + 1;
      position = left < right ? (left + right) / 2 : left + 0.5;
    }
    await sectionRequest(`/api/v1/content/deck-sections/${section.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ position }),
    });
  };

  const deleteSection = async (section: DeckSection) => {
    await sectionRequest(`/api/v1/content/deck-sections/${section.id}`, { method: "DELETE" });
  };

  /** Delete the post this slide is staging. Confirmed because it removes the
   *  post from the calendar AND the board, unlike the section delete beside it
   *  which only drops a divider. Mirrors PostComposer.remove(). */
  const deletePost = async (id: string) => {
    if (deletingPost) return;
    if (!window.confirm("Delete this post? It goes from the calendar and the board. This cannot be undone.")) return;
    setDeletingPost(true);
    try {
      const res = await fetch(`/api/v1/content/${id}`, { method: "DELETE" });
      if (!res.ok) {
        window.alert("The post could not be deleted. Try again.");
        return;
      }
      onChange();
      // Nothing left to stage on this slide, so hand the screen back.
      if (onBack) onBack();
    } catch {
      window.alert("The request didn't reach the server. Check your connection and try again.");
    } finally {
      setDeletingPost(false);
    }
  };

  return (
    <div
      ref={paneRef}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: isFullscreen ? "14px 22px" : isMobile ? "8px 12px 16px" : "8px 26px 12px",
        background: isFullscreen ? "var(--canvas)" : undefined,
        // Mobile drops the no-scroll contract: the portrait sheet is taller
        // than the pane, so the whole deck scrolls (desktop stays no-scroll).
        overflowY: isMobile ? "auto" : undefined,
        WebkitOverflowScrolling: isMobile ? "touch" : undefined,
      }}
    >
      {/* The top toolbar row that sat here (Back, Delete post, Group by,
          position, copy link) is GONE (ticket 0f562676, Mia: "remove this
          bar when we have the post copy deck open. we dont need it"). The
          group-by pills went with it (calendar order only); Back, Delete,
          position and copy link live on the filmstrip's header row below.
          Escape and the backdrop still close the deck. */}

      {/* THE PHONE BAR (Nikki, 2026-09-21: "make the content page and everything
          within that mobile friendly"). The phone view sheds the filmstrip and
          the slide arrows, and with them went Back: a post opened on a phone
          could only be left by Escape, which a phone does not have, or by
          hitting the thin margin round the sheet, which is now gone too (the
          deck fills the screen there). So the phone gets one slim bar, pinned
          while the sheet scrolls under it: Back, where you are in the run, and
          the two arrows. Nothing else comes back; the rest of the chrome stays
          a desktop matter, as Mia set it on 2026-09-11. */}
      {isMobile && (
        <div
          style={{
            position: "sticky",
            top: -8,
            zIndex: 6,
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "-8px -12px 0",
            padding: "10px 12px 8px",
            background: "var(--canvas)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          {onBack && (
            <button type="button" onClick={onBack} className="btn-ghost-pill" style={{ height: 34, padding: "0 13px 0 9px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 5, flex: "none" }}>
              <svg {...GLYPH} width={14} height={14} aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
              Back
            </button>
          )}
          <span style={{ ...capsLabel, flex: "1 1 auto", minWidth: 0, textAlign: "center", letterSpacing: ".06em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {visible.length > 0 ? `${current + 1} of ${visible.length}` : ""}
          </span>
          <button type="button" onClick={() => step(-1)} disabled={current === 0} aria-label="Previous post" className="btn-ghost-pill" style={{ width: 34, height: 34, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", opacity: current === 0 ? 0.4 : 1 }}>
            <svg {...GLYPH} width={15} height={15} aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button type="button" onClick={() => step(1)} disabled={current >= visible.length - 1} aria-label="Next post" className="btn-ghost-pill" style={{ width: 34, height: 34, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", opacity: current >= visible.length - 1 ? 0.4 : 1 }}>
            <svg {...GLYPH} width={15} height={15} aria-hidden><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      )}

      {/* THE RECESSED CANVAS: the desk under the slide. A color-mix of the
          theme's own canvas and border tokens, so light mode gets a muted
          wash and dark mode a deeper one from the same recipe; the measured
          slide sits on it as a sheet under the panel shadow, and the arrows
          float over the wash at its edges. The row wrapper exists for the
          image library rail: open, the rail takes its width and the
          ResizeObserver refits the sheet; closed, the canvas keeps the whole
          row and the slide never shrinks. */}
      <div style={{ flex: isMobile ? "none" : 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 8 }}>
      <div
        ref={stageRef}
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          // Mobile: a fixed portrait height (the sheet is taller than the pane)
          // pinned to the top, and no clipping — the deck scrolls to reveal it.
          ...(isMobile ? { height: slideH + stageGutter * 2, alignSelf: "flex-start" } : {}),
          borderRadius: "var(--r-lg)",
          // No desk on a phone: the sheet IS the screen there, so the wash and
          // its edge stand down with the gutter.
          border: isMobile ? "0" : "1px solid var(--hairline)",
          background: isMobile ? "transparent" : "color-mix(in srgb, var(--canvas) 78%, var(--border))",
          overflow: isMobile ? "visible" : "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!slide ? (
          <div style={{ textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.5 }}>
              No scheduled posts yet. Give a post a date on the Calendar and its slide appears here.
            </div>
          </div>
        ) : slide.kind === "section" ? (
          // A manual break wears the divider-slide visual with its own label
          // (ticket fbe2f5d5), plus the quiet reorder and delete controls: up
          // and down recompute `position` (see moveSection), the x deletes.
          <DividerSlide
            name={slide.section.label}
            color={null}
            count={slide.count}
            width={slideW}
            height={slideH}
            scale={slideScale}
            controls={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void moveSection(slide.section, -1)}
                  disabled={sectionBusy}
                  aria-label="Move this section earlier"
                  title="Move this section earlier in the deck"
                  style={{ ...toolbarIconBtn, color: "var(--text-muted)", opacity: sectionBusy ? 0.5 : 1 }}
                >
                  <svg {...GLYPH} width={14} height={14} aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => void moveSection(slide.section, 1)}
                  disabled={sectionBusy}
                  aria-label="Move this section later"
                  title="Move this section later in the deck"
                  style={{ ...toolbarIconBtn, color: "var(--text-muted)", opacity: sectionBusy ? 0.5 : 1 }}
                >
                  <svg {...GLYPH} width={14} height={14} aria-hidden><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => void deleteSection(slide.section)}
                  disabled={sectionBusy}
                  aria-label="Delete this section"
                  title="Delete this section break (the slides under it stay)"
                  style={{ ...toolbarIconBtn, color: "var(--text-muted)", opacity: sectionBusy ? 0.5 : 1 }}
                >
                  <svg {...GLYPH} width={13} height={13} aria-hidden><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </div>
            }
          />
        ) : slide.kind === "divider" ? (
          <DividerSlide name={slide.name} color={slide.color} count={slide.count} width={slideW} height={slideH} scale={slideScale} />
        ) : (
          <PostSlide
            // Keyed by id so navigating between slides resets the drafts to
            // that slide's stored values; a refetch keeps the same key, so
            // mid-edit text survives its own save.
            key={slide.item.id}
            item={slide.item}
            number={slide.number}
            artboard={artboard}
            artboards={artboards}
            shownFrameId={shownFrameId}
            onPageArtboard={(frameId) => setPaged({ itemId: slide.item.id, frameId })}
            onArtboardMutated={invalidateArtboards}
            resolveBoardImage={resolveBoardImage}
            pillar={slide.item.pillar_id ? (byId.get(slide.item.pillar_id) ?? null) : null}
            pillars={pillars}
            onPillarsChanged={loadPillars}
            users={users}
            patchItem={patchItem}
            registerAdd={addToSlideRef}
            onOpenLibrary={() => setLibraryOpen(true)}
            onChange={onChange}
            width={slideW}
            height={slideH}
            scale={slideScale}
            mobile={isMobile}
            showComments={commentsShown}
            artboardNav={artboardNav}
            openArtboard={artboardWanted}
            onArtboardOpened={() => setArtboardWanted(false)}
          />
        )}
        {/* Slide arrows are chrome; on mobile the stripped view shows just the
            artboard + copy, and slides are reached from the calendar. */}
        {visible.length > 0 && !isMobile && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={current === 0}
              aria-label="Previous slide"
              style={{ ...arrowStyle(current === 0), left: arrowInset }}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={current >= visible.length - 1}
              aria-label="Next slide"
              style={{ ...arrowStyle(current >= visible.length - 1), right: arrowInset }}
            >
              ›
            </button>
          </>
        )}
      </div>
      {libraryOpen && (
        <ImageLibraryRail
          clips={clips}
          boardImages={boardImages}
          canAdd={slide?.kind === "post"}
          onAdd={(url) => addToSlideRef.current?.add(url)}
          onAddFail={() => addToSlideRef.current?.fail("The image could not be uploaded. Try again.")}
          resolve={resolveBoardImage}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      </div>

      {/* The filmstrip, sized like a real deck navigator: 16:9 thumbs ~100px
          tall, each a mini visual of its slide (the lead image cover-fit
          under a number+date scrim; no-image slides show the FULL post title
          clamped to two lines over the pillar tint, ticket b2a22e87), the
          ACTIVE thumb outlined in the accent. Divider thumbs stay washed
          name chips AND act as group headers: clicking one folds that
          group's thumbs shut, and arrow navigation skips the hidden slides.
          Manual section chips just stage their break; the "+ Section"
          affordance at the strip's end asks inline for a label (ticket
          fbe2f5d5, ungrouped deck only). */}
      {/* Filmstrip is chrome — hidden in the mobile artboard+copy view. */}
      {visible.length > 0 && !isMobile && (
        <div style={{ flex: "none", display: "flex", flexDirection: "column", gap: 2 }}>
          {/* The strip's slim header (ticket 10461678): the fold toggle wears
              the position ("Slide 3 of 12"), and the right side carries what
              the removed top bar used to hold. Folded, this row is all that
              remains of the strip, so nothing here is ever out of reach. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 30 }}>
            <button
              type="button"
              onClick={toggleStrip}
              aria-expanded={stripOpen}
              title={stripOpen ? "Fold the slide strip away" : "Show the slide strip"}
              style={{ ...capsLabel, display: "inline-flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", padding: "4px 2px", letterSpacing: ".06em", color: "var(--text-muted)" }}
            >
              <span aria-hidden style={{ fontSize: 11 }}>{stripOpen ? "▾" : "▸"}</span>
              Slide {current + 1} of {visible.length}
            </button>
            <span style={{ flex: 1, minWidth: 12 }} />
            {/* Show comments (Mia, 2026-09-15): the one switch for every
                comment surface on the slide. Deck chrome, not slide chrome,
                so it never appears in a screenshot of the sheet itself. */}
            <button
              type="button"
              onClick={toggleComments}
              aria-pressed={commentsShown}
              title={commentsShown ? "Hide the comments so the deck is clean to share" : "Show the comments on every slide"}
              style={{ ...capsLabel, flex: "none", display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: "4px 2px", letterSpacing: ".06em", color: commentsShown ? "var(--accent)" : "var(--text-muted)" }}
            >
              <svg {...GLYPH} width={13} height={13} aria-hidden><path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /></svg>
              {commentsShown ? "Hide comments" : "Show comments"}
            </button>
            {linkCopied && (
              <span role="status" style={{ ...capsLabel, flex: "none", letterSpacing: ".06em", color: "var(--accent)" }}>
                Link copied, opens this post directly
              </span>
            )}
            {/* Copy link (Mia, 12 Aug: "share this post"), post slides only
                because the link names a post id. */}
            {slide?.kind === "post" && (
              <button
                type="button"
                onClick={() => void copyPostLink(slide.item.id)}
                title="Copy a link that opens this post directly"
                aria-label="Copy a link to this post"
                style={toolbarIconBtn}
              >
                {linkCopied ? (
                  <svg {...GLYPH} width={15} height={15} aria-hidden><path d="m5 13 4.5 4.5L19 7" /></svg>
                ) : (
                  <svg {...GLYPH} width={15} height={15} aria-hidden><path d="M10.5 13.5a3.6 3.6 0 0 0 5.1 0l3.3-3.3a3.6 3.6 0 0 0-5.1-5.1l-1.6 1.6" /><path d="M13.5 10.5a3.6 3.6 0 0 0-5.1 0l-3.3 3.3a3.6 3.6 0 0 0 5.1 5.1l1.6-1.6" /></svg>
                )}
              </button>
            )}
            {/* Delete the staged post. "Add post" CREATES the row before the
                slide opens (ticket 2afa5e36), so without this an abandoned
                post is stranded: the deck is its one removal surface. */}
            {slide?.kind === "post" && (
              <button
                type="button"
                onClick={() => void deletePost(slide.item.id)}
                disabled={deletingPost}
                title="Delete this post. It goes from the calendar and the board."
                className="btn-ghost-pill"
                style={{ flex: "none", height: 28, padding: "0 12px", color: "var(--danger)", opacity: deletingPost ? 0.5 : 1 }}
              >
                {deletingPost ? "Deleting..." : "Delete post"}
              </button>
            )}
            {/* The quiet way back: a ghost pill, because the deck is the
                star and the calendar is simply underneath waiting. Escape
                and the backdrop do the same. */}
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                title="Close the deck and return to the calendar (Esc)"
                className="btn-ghost-pill"
                style={{ flex: "none", height: 28, padding: "0 12px", color: "var(--text-muted)" }}
              >
                Back to calendar
              </button>
            )}
          </div>
          {stripOpen && (
        <div ref={stripRef} style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, overflowX: "auto", padding: "4px 2px 6px" }}>
          {visible.map((s, i) => {
            const active = i === current;
            if (s.kind === "divider") {
              const wash = s.color ? `color-mix(in srgb, ${s.color} 18%, var(--field))` : "var(--rail)";
              const shut = collapsed.has(s.groupKey);
              return (
                <button
                  key={s.groupKey}
                  type="button"
                  onClick={() => toggleGroup(s.groupKey)}
                  title={`${s.name}, ${s.count} ${s.count === 1 ? "slide" : "slides"}. Click to ${shut ? "expand" : "collapse"}.`}
                  aria-expanded={!shut}
                  aria-current={active ? "true" : undefined}
                  style={{ flex: "none", height: 40, padding: "0 13px", borderRadius: "var(--r-chip)", cursor: "pointer", background: wash, border: active ? "2px solid var(--accent)" : "1px solid var(--hairline)", fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  <span aria-hidden style={{ marginRight: 6 }}>{shut ? "▸" : "▾"}</span>
                  {s.name}
                  {shut ? ` (${s.count})` : ""}
                </button>
              );
            }
            if (s.kind === "section") {
              return (
                <button
                  key={s.section.id}
                  type="button"
                  onClick={() => goTo(i)}
                  title={`${s.section.label}: a section break. Its controls sit on the staged slide.`}
                  aria-current={active ? "true" : undefined}
                  style={{ flex: "none", height: 40, padding: "0 13px", borderRadius: "var(--r-chip)", cursor: "pointer", background: "var(--rail)", border: active ? "2px solid var(--accent)" : "1px solid var(--hairline)", fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {s.section.label}
                </button>
              );
            }
            const img = leadImageOf(s.item);
            const tint = pillarColorOf(s.item.pillar_id ? (byId.get(s.item.pillar_id) ?? null) : null);
            return (
              <button
                key={s.item.id}
                type="button"
                onClick={() => goTo(i)}
                title={labelOf(s.item)}
                aria-current={active ? "true" : undefined}
                style={{ flex: "none", position: "relative", width: 178, height: 100, padding: 0, borderRadius: "var(--r-chip)", overflow: "hidden", cursor: "pointer", border: active ? "2px solid var(--accent)" : "1px solid var(--border)", boxShadow: active ? "var(--shadow-card)" : "none", background: tint ? `color-mix(in srgb, ${tint} 18%, var(--field))` : "var(--field)" }}
              >
                {img ? (
                  // Remote media (Pinterest/IG/uploads), the PostSlide rule:
                  // plain img, no per-host allow-list. Inside ClipImage, so an
                  // expired clip says so in the filmstrip instead of putting a
                  // broken glyph under the post's own title.
                  <ClipImage src={img} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  // No lead image: the FULL title carries the thumb (ticket
                  // b2a22e87, "either a visual or has the full post title"),
                  // small and clamped to two lines on the pillar tint; the
                  // button's title tooltip still holds the uncut words.
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 10px 24px" }}>
                    <span style={{ fontSize: 12, lineHeight: 1.35, fontWeight: 600, textAlign: "center", color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" }}>
                      {labelOf(s.item)}
                    </span>
                  </span>
                )}
                {/* The scrim: only imagery needs the dark wash for white text;
                    an image is theme-independent, so the wash is too. Plain
                    thumbs sit on theme surfaces and use theme text. */}
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                    padding: "14px 8px 5px",
                    ...(img
                      ? { background: "linear-gradient(to top, rgba(0, 0, 0, 0.66), rgba(0, 0, 0, 0))", color: "#fff" }
                      : { color: "var(--text-muted)" }),
                  }}
                >
                  <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600 }}>{s.number}</span>
                  <span style={{ fontSize: 11.5, letterSpacing: ".02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.item.scheduled_for ? shortDate(s.item.scheduled_for) : "No date"}
                  </span>
                </span>
              </button>
            );
          })}
          {/* "+ Section" (ticket fbe2f5d5): ungrouped deck only, because the
              grouped dividers are derived and would swallow a manual break.
              Clicking swaps the chip for the inline label input; Enter
              creates the break before the staged slide, Escape backs out. */}
          {groupBy === "none" &&
            (addingSection ? (
              <input
                value={sectionDraft}
                maxLength={80}
                autoFocus
                onChange={(e) => setSectionDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void createSection();
                  } else if (e.key === "Escape") {
                    setAddingSection(false);
                    setSectionDraft("");
                  }
                }}
                onBlur={() => {
                  // An abandoned empty input folds itself away; typed words
                  // stay so a stray click cannot eat the label.
                  if (!sectionDraft.trim()) setAddingSection(false);
                }}
                placeholder="Section label, then Enter"
                aria-label="New section label"
                disabled={sectionBusy}
                style={{ ...fieldInput, flex: "none", width: 190, height: 40, padding: "0 11px", fontSize: 13 }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingSection(true)}
                title="Add a labelled section break before the current slide"
                style={{ flex: "none", height: 40, padding: "0 13px", borderRadius: "var(--r-chip)", cursor: "pointer", background: "transparent", border: "1px dashed var(--border)", fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-muted-2)", whiteSpace: "nowrap" }}
              >
                + Section
              </button>
            ))}
        </div>
          )}
        </div>
      )}
      {sectionErr && (
        <div role="alert" style={{ flex: "none", color: "var(--danger)", fontSize: 12.5, lineHeight: 1.4 }}>
          {sectionErr}
        </div>
      )}
    </div>
  );
}

/**
 * The image library rail (Mia, 2026-07-22: "drop images from the board & our
 * clips into the slide"): every clip and board image that is not itself a
 * planned post, newest first, as draggable thumbs. Dragging writes the image
 * URL under IMAGE_MIME for the slide's drop targets; the "+ Add to slide"
 * button is the click fallback, because half-screen windows make dragging
 * awkward. It sits BESIDE the stage (see the row wrapper in PostDeck), so
 * opening it narrows the canvas and the ResizeObserver refits the sheet.
 */
function ImageLibraryRail({
  clips,
  boardImages,
  canAdd,
  onAdd,
  onAddFail,
  resolve,
  onClose,
}: {
  clips: (ContentItem & { image_url: string })[];
  /** The board's image inventory from useArtboardPreview: everything drawn or
   *  dropped on the Board, whether or not it ever became a clip (Mia,
   *  2026-07-22: "they might not be in the clip library but we still need to
   *  reference the ones outside of that"). */
  boardImages: BoardImage[];
  /** False while the stage shows a divider or nothing: the drop targets only
   *  exist on a post slide, so the click fallback explains itself instead. */
  canAdd: boolean;
  onAdd: (url: string) => void;
  /** Words a failed board-image upload through the staged slide's inline err
   *  line, where every other imagery failure already reads. */
  onAddFail: () => void;
  /** The hook's upload-and-cache door: fileId in, storable http URL out, null
   *  when the upload failed. */
  resolve: (fileId: string) => Promise<string | null>;
  /** Close the rail. Lives IN the rail (ticket 6fd76c9d): the toolbar toggle
   *  that used to close it is one of the icons Mia removed. */
  onClose: () => void;
}) {
  // Which board image's on-demand upload is travelling, by fileId: its add
  // affordance shows the brief busy state and refuses a second click.
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  // The rail unmounts freely (toggled shut, deck left) while an upload is in
  // flight; the settled promise must not touch dead state (the aliveRef
  // posture, PostSlide's twin).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Dedupe: a clip inserted onto the board carries the clip's own URL as its
  // urlRef, so without this it would appear twice in one rail. Exact-match on
  // src against the clips listed above is the whole rule.
  const clipUrls = useMemo(() => new Set(clips.map((c) => c.image_url)), [clips]);
  const board = boardImages.filter((b) => !clipUrls.has(b.src));

  /** The board section's click fallback: urlRef images attach directly,
   *  dataURL-only ones upload through the hook first (cached there, so drags
   *  and repeats reuse the minted URL). Failure changes nothing on the slide;
   *  it only words itself through onAddFail. */
  const addBoard = async (b: BoardImage) => {
    // A urlRef image attaches instantly, so it never waits on someone else's
    // upload; only the upload path holds the one-at-a-time gate.
    if (isHttpUrl(b.src)) {
      onAdd(b.src);
      return;
    }
    if (busyFileId) return;
    setBusyFileId(b.fileId);
    const url = await resolve(b.fileId);
    if (!aliveRef.current) return;
    setBusyFileId(null);
    if (url) onAdd(url);
    else onAddFail();
  };

  return (
    <aside
      aria-label="Image library"
      style={{
        flex: "none",
        width: 178,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        borderRadius: "var(--r-lg)",
        border: "1px solid var(--hairline)",
        background: "color-mix(in srgb, var(--card) 92%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow: "var(--shadow-panel)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ ...capsLabel, letterSpacing: ".08em" }}>Image library</span>
        {/* The rail's own closer (ticket 6fd76c9d): the toolbar toggle that
            used to close it is gone, so the x moved in here. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the image library"
          title="Close the image library"
          style={{ flex: "none", width: 18, height: 18, padding: 0, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 2 }}>
        {clips.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--text-muted-2)", lineHeight: 1.5 }}>
            Nothing clipped yet. Pin from the board or the browser extension.
          </div>
        ) : (
          clips.map((c) => (
            <div
              key={c.id}
              title={labelOf(c)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(IMAGE_MIME, c.image_url);
                e.dataTransfer.effectAllowed = "copy";
              }}
              style={{ flex: "none", display: "flex", flexDirection: "column", gap: 4, cursor: "grab" }}
            >
              {/* Remote media (Pinterest/IG/uploads), the PostSlide rule:
                  plain img, no per-host allow-list. ClipImage wraps it so a
                  clip whose original link has expired says so in the rail
                  rather than sitting there as a broken glyph. */}
              <ClipImage src={c.image_url} alt={labelOf(c)} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: "var(--r-chip)", border: "1px solid var(--hairline)", display: "block" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <span style={{ ...capsLabel, letterSpacing: ".06em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {SOURCE_WORDS[c.source]}
                </span>
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => onAdd(c.image_url)}
                  title={canAdd ? "Add this image to the current slide" : "Open a post slide first"}
                  style={{ flex: "none", border: "none", background: "transparent", color: canAdd ? "var(--accent)" : "var(--text-muted-2)", fontSize: 12, fontWeight: 600, cursor: canAdd ? "pointer" : "default", padding: "2px 0" }}
                >
                  + Add to slide
                </button>
              </div>
            </div>
          ))
        )}
        {/* THE CANVAS SECTION (Mia, 2026-07-22: pull images from the board
            into the slides, clip library or not). Same thumb idiom as the
            clips above; dataURL srcs render fine in an <img> and only pay
            their upload when actually added to a slide. No canvas images means
            NO section at all, never an empty-state line.

            "Canvas", not "Board" (ticket a0856f21): this inventory is read off
            the one stored canvas document, so it spans BOTH surfaces, and
            naming either tab here would be a lie about half the tiles. */}
        {board.length > 0 && (
          <>
            <div style={{ ...capsLabel, letterSpacing: ".08em", paddingTop: 4, borderTop: "1px solid var(--hairline)" }}>
              On the canvas
            </div>
            {board.map((b) => {
              const busy = busyFileId === b.fileId;
              return (
                <div
                  key={b.fileId}
                  title="An image from the canvas"
                  draggable
                  onDragStart={(e) => {
                    // A urlRef image drags as its plain URL (the clip path,
                    // unchanged); a dataURL-only one drags as the sentinel the
                    // slide's drop handler resolves through the upload cache.
                    e.dataTransfer.setData(IMAGE_MIME, isHttpUrl(b.src) ? b.src : BOARD_FILE_PREFIX + b.fileId);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  style={{ flex: "none", display: "flex", flexDirection: "column", gap: 4, cursor: "grab" }}
                >
                  {/* Bucket URLs or embedded dataURLs, either way not
                      next/image material, the clips-thumb rule. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.src} alt="An image from the canvas" style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: "var(--r-chip)", border: "1px solid var(--hairline)", display: "block" }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ ...capsLabel, letterSpacing: ".06em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Canvas
                    </span>
                    <button
                      type="button"
                      disabled={!canAdd || busy}
                      onClick={() => void addBoard(b)}
                      title={canAdd ? "Add this image to the current slide" : "Open a post slide first"}
                      style={{ flex: "none", border: "none", background: "transparent", color: canAdd && !busy ? "var(--accent)" : "var(--text-muted-2)", fontSize: 12, fontWeight: 600, cursor: canAdd && !busy ? "pointer" : "default", padding: "2px 0" }}
                    >
                      {busy ? "Adding..." : "+ Add to slide"}
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}

/** A section break between groups: the group's name over its colour wash,
 *  sized exactly like a post slide (the measured sheet) so the deck keeps
 *  its rhythm; type rides the same scale factor. `controls` is the manual
 *  breaks' slot (reorder + delete); derived group dividers pass nothing. */
function DividerSlide({ name, color, count, width, height, scale, controls }: { name: string; color: string | null; count: number; width: number; height: number; scale: number; controls?: React.ReactNode }) {
  const wash = color ? `color-mix(in srgb, ${color} 14%, var(--card))` : "var(--rail)";
  return (
    <section
      aria-label={`Section: ${name}`}
      style={{ width, height, flex: "none", background: wash, border: "1px solid var(--border)", borderRadius: "var(--r-card)", boxShadow: "var(--shadow-panel)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: Math.round(12 * scale), padding: 24, overflow: "hidden" }}
    >
      {color && <span aria-hidden style={{ width: Math.round(13 * scale), height: Math.round(13 * scale), borderRadius: "50%", background: color }} />}
      <div style={{ fontSize: Math.round(42 * scale), fontWeight: 700, letterSpacing: "-.02em", color: "var(--text)", textAlign: "center", overflowWrap: "anywhere", lineHeight: 1.1 }}>{name}</div>
      <div style={{ ...capsLabel, fontSize: Math.max(12, 12.5 * scale), letterSpacing: ".1em" }}>
        {count.toLocaleString("en-GB")} {count === 1 ? "slide" : "slides"}
      </div>
      {controls}
    </section>
  );
}

// Caption suggested-edit UI bits (Nikki's lab, 2026-08-12, "Option 1"),
// shared by the slide below. initialsOf is the tasks module's avatar helper,
// the same glyph the comment chips draw from.
const deckSuggestPrimary: React.CSSProperties = { background: "var(--btn-primary)", color: "var(--btn-primary-text)", border: "none", borderRadius: "var(--r-pill)", padding: "5px 13px", fontWeight: 500, cursor: "pointer" };
const deckSuggestGhost: React.CSSProperties = { background: "transparent", color: "var(--text-muted)", border: "none", padding: "5px 7px", cursor: "pointer" };
function SuggestDot({ name }: { name: string | null }) {
  return <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--btn-primary)", color: "var(--btn-primary-text)", display: "grid", placeItems: "center", fontSize: 8.5, fontWeight: 700, flexShrink: 0 }}>{initialsOf(name)}</span>;
}

/**
 * One post as a full slide at the measured sheet size, the PowerPoint copy
 * deck frame: the date is the slide title (weekday small above) behind a rule,
 * the THREE STAGE TABS run under it (ticket 9b599621, see POST_STAGES), the
 * artwork and the caption sit as two clear columns on a wide sheet and stack
 * on a narrow one, and the pinned foot is the working rail,
 * ONE row of two labelled clusters (Mia, 2026-07-22: "collapse these better
 * and visualise them better"): STATUS bottom LEFT (the current deck word as a
 * coloured glyph chip opening a menu of the other states plus the Ask
 * actions, the awaiting dot-chip while a request is open, and the read-only
 * pillar tag, ticket 74b7d901), then CHANNEL
 * (one CHANNEL_TINTS icon chip per selected channel, a quiet plus popover to
 * toggle the set, and the medium as one glyph chip opening its three-way
 * menu), with the page number quiet BOTTOM RIGHT.
 * Every font and margin that shapes the frame multiplies by `scale`
 * (measured width over the 1150 design width), so a bigger stage means
 * bigger deck-like type rather than a stretched card; merchant caps clamp at
 * the 12.5px floor. Title, copy and first comment autosave on blur (a blur
 * always precedes an arrow or filmstrip click, so paging away never loses an
 * edit); drafts live here keyed by item id, so a refetch that echoes our own
 * save leaves them untouched.
 */
function PostSlide({
  item,
  number,
  artboard,
  artboards,
  shownFrameId,
  onPageArtboard,
  onArtboardMutated,
  resolveBoardImage,
  pillar,
  pillars,
  onPillarsChanged,
  users,
  patchItem,
  registerAdd,
  onOpenLibrary,
  onChange,
  width,
  height,
  scale,
  mobile,
  showComments,
  artboardNav,
  openArtboard = false,
  onArtboardOpened,
}: {
  item: ContentItem;
  number: number;
  /** The neighbouring post slides, for the designer's prev/next artboard buttons (ticket ade67446). */
  artboardNav?: { hasPrev: boolean; hasNext: boolean; step: (delta: number) => void };
  /** Open the designer as soon as this slide mounts: how prev/next artboard lands. */
  openArtboard?: boolean;
  onArtboardOpened?: () => void;
  /** The item's ideation-frame render from the deck-level useArtboardPreview
   *  (cached up there because this slide remounts on every page turn); null
   *  means no frame, still exporting, or fail-soft, all of which render
   *  nothing extra here. */
  artboard: ArtboardPreview | null;
  /** The artboard SET the pager flicks through (ticket 6b565b4f): every live
   *  frame sharing the linked frame's naming stem, in `_N` order. One entry
   *  (or none) hides the pager and the stage reads exactly as before. */
  artboards: ArtboardSibling[];
  /** Which of `artboards` the stage is showing right now: the deck's pager
   *  selection, falling back to the item's own board_frame_id. */
  shownFrameId: string | null;
  /** Flick the stage to a sibling artboard (the deck re-exports it). */
  onPageArtboard: (frameId: string) => void;
  /** Drop the deck-level artboard snapshot and export cache and re-read the
   *  live board: called when the popup editor closes (its edits fire no
   *  visibility event in this tab) and after New page adds a sibling. */
  onArtboardMutated: () => void;
  /** The hook's upload-and-cache door for a dropped BOARD_FILE_PREFIX
   *  sentinel: fileId in, storable http URL out, null on upload failure. */
  resolveBoardImage: (fileId: string) => Promise<string | null>;
  pillar: ContentPillar | null;
  /** Every pillar, for the Content pillar picker (select or create; Nikki's
   *  lab, 2026-08-12). */
  pillars: ContentPillar[];
  /** Refetch pillars after the picker creates a new one. */
  onPillarsChanged: () => void | Promise<void>;
  users: TaskUser[];
  patchItem: (id: string, body: ContentItemInput) => Promise<PatchResult>;
  /** The deck's ref channel for the library rail (see addToSlideRef): this
   *  slide registers its addImage and its inline error line while mounted. */
  registerAdd: React.MutableRefObject<{ add: (url: string) => void; fail: (message: string) => void } | null>;
  /** Opens the deck's image library rail (the header toggle's other door):
   *  the Finalised tab's Add-imagery affordance needs a way in from the slide
   *  itself, because the empty state used to offer nothing clickable at all
   *  (Mia, 12 Aug). */
  onOpenLibrary: () => void;
  onChange: () => void;
  width: number;
  height: number;
  scale: number;
  /** Phone view (Mia 2026-09-11: "only show the artboard and the copy"): hides
   *  the stage tabs, concept, first comment, comments and the status/pillar/
   *  channel foot, leaving the artwork + the copy. */
  mobile?: boolean;
  /** Deck-level switch (Mia, 2026-09-15): with this off the slide shows no
   *  comment surface at all, so the deck can be shared as work, not notes. */
  showComments?: boolean;
}) {
  const [titleDraft, setTitleDraft] = useState(item.title ?? "");
  const [copyDraft, setCopyDraft] = useState(item.post_copy ?? "");
  // PER-CHANNEL COPY (Mia, 2026-07-22: "different tabs for channel platform
  // copy"). copyTab is which channel's tab is lit (null or a channel no
  // longer selected falls back to the FIRST channel, whose tab edits
  // post_copy itself, the canonical). overrides is the local mirror of
  // post_copy_channels, drafts and stored values together: saves rebuild the
  // whole map from HERE, not from item.post_copy_channels, which lags one
  // refetch behind when two tabs are edited back to back. Keyed-by-id
  // mounting resets both on navigation, the copyDraft contract above.
  const [copyTab, setCopyTab] = useState<PostChannel | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({ ...item.post_copy_channels });

  // Caption suggested edits (Nikki's lab, 2026-08-12, "Option 1"), on the
  // MAIN copy only (not per-channel overrides): a reviewer proposes a
  // rewrite, the author sees the diff and accepts or dismisses. Persisted on
  // the row (caption_suggestion, 0082) so the other person actually receives
  // it; hydrated through readCaptionSuggestion because jsonb is ordinary
  // storage. The effect re-syncs when a refetch echoes the truth back (the
  // imgDraft posture), which is also how the OTHER person's accept or
  // dismiss lands here.
  const [suggestion, setSuggestion] = useState<CaptionSuggestion | null>(() => readCaptionSuggestion(item.caption_suggestion));
  useEffect(() => {
    setSuggestion(readCaptionSuggestion(item.caption_suggestion));
  }, [item.caption_suggestion]);
  // The comments panel over the slide (ticket c909e86c): toggled by the
  // Comments button where Suggest an edit used to sit. Keyed-by-id mounting
  // resets it per slide, the copyDraft contract.
  const [commentsOpen, setCommentsOpen] = useState(false);
  // The artboard editor dialog (ticket 07e8115a): the Mock-ups board raised
  // over the slide so the copy deck stays open beneath it.
  const [editingArtboard, setEditingArtboard] = useState(openArtboard);
  // Landed here from prev/next artboard: the request is spent on arrival.
  const openedOnMount = useRef(openArtboard);
  useEffect(() => {
    if (openedOnMount.current) {
      openedOnMount.current = false;
      onArtboardOpened?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** false = the new design tool, true = the old whiteboard behind it. */
  const [onTheBoard, setOnTheBoard] = useState(false);
  /** Whether this post has been moved onto the new artboards. null while we
   *  are still asking, so neither renderer flashes before we know. */
  const [nativeArtboard, setNativeArtboard] = useState<boolean | null>(null);
  const [artboardStamp, setArtboardStamp] = useState(0);
  /**
   * NEW PAGE WITHOUT LEAVING THE ARTBOARD (Mia, 2026-09-18: "when i press new
   * page it takes me back to the slide and then i have to click into the
   * artboard view again. this isn't right. it should always stay open").
   *
   * Adding a page is a SERVER write to the stored row, so the order still has
   * to be: this canvas saved, then the page added, then the document re-read.
   * What has changed is that none of that needs the editor shut any more. The
   * board saves on request and says when it is done, so the three steps happen
   * underneath a view that never closes.
   */
  const [flushSignal, setFlushSignal] = useState(0);
  const [reloadSignal, setReloadSignal] = useState(0);
  const flushWaiter = useRef<(() => void) | null>(null);
  const saveBoardNow = () =>
    new Promise<void>((resolve) => {
      flushWaiter.current = resolve;
      setFlushSignal((n) => n + 1);
      // Never hang the button on a board that cannot answer (unmounted
      // mid-press, or a save that never settles).
      window.setTimeout(() => {
        if (flushWaiter.current === resolve) {
          flushWaiter.current = null;
          resolve();
        }
      }, 4000);
    });
  /** Closing refetches BOTH truths: the item row (onChange) and the board
   *  snapshot the storyboard render actually draws from (onArtboardMutated) —
   *  the popup edits in THIS tab, so the preview hook's visibility listener
   *  never fires for it and the stage kept showing pre-edit pixels (Mia,
   *  2026-09-10: "i just mocked something up but its not showing???"). */
  const closeArtboardEditor = useCallback(() => {
    setEditingArtboard(false);
    setOnTheBoard(false);
    setArtboardStamp((n) => n + 1);
    onChange();
    onArtboardMutated();
  }, [onChange, onArtboardMutated]);
  /** New page (Mia, 2026-09-10: "need to be able to add multiple artboards to
   *  a post... a new page button and it mocks everything up there"): the API
   *  clones the shown frame as the next `_N` sibling beside it on Mock-ups,
   *  then the pager flicks to it and the popup editor opens ready to draw.
   *  The pager already existed for `_N`-named siblings (6b565b4f); this is
   *  the button that mints them. */
  const [pagingBusy, setPagingBusy] = useState(false);
  const addArtboardPage = async () => {
    const anchor = shownFrameId ?? item.board_frame_id;
    if (pagingBusy || !anchor) return;
    setPagingBusy(true);
    /**
     * CLOSE THE EDITOR FIRST when New page is pressed from inside it (Mia,
     * 2026-09-18: "when i tried to add another artboard this happened, it
     * doesnt link to the current slide i was working on", over the board's
     * "changed in another tab" notice).
     *
     * This route adds the frame SERVER SIDE, to the stored row. With the
     * editor open, that row is the one the open board loaded, so the write
     * landed underneath it: the board saw its version move, said so, and went
     * on showing a scene with no new frame in it. Harmless before today,
     * because the button lived on the copy slide where the editor was shut.
     *
     * The board now saves ON REQUEST and says when it is done, so the wait is
     * a handshake rather than a guessed delay, and the editor stays open
     * throughout. The 1500ms sleep and the close/reopen it went with are gone.
     */
    if (editingArtboard) await saveBoardNow();
    try {
      const res = await fetch("/api/v1/content/artboard-pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frame_id: anchor }),
      });
      const j = (await res.json().catch(() => null)) as { frame_id?: string; error?: { message?: string } } | null;
      if (!res.ok || !j?.frame_id) {
        setErr(j?.error?.message ?? "Couldn't add a page. Try again.");
        return;
      }
      onArtboardMutated();
      onPageArtboard(j.frame_id);
      // Already open: re-read the row so the new frame is on canvas, and leave
      // the view exactly where it is. Only closed (New page pressed from the
      // slide) does this have to open it.
      if (editingArtboard) setReloadSignal((n) => n + 1);
      else setEditingArtboard(true);
    } catch {
      setErr("The request didn't reach the server. Check your connection and try again.");
    } finally {
      setPagingBusy(false);
    }
  };
  /** Reorder (Mia, 2026-09-10: "be able to reorder mockups on the slide"):
   *  swap the shown page's number with its neighbour's. Names change on the
   *  board, nothing moves; the pager re-derives and the shown frame keeps
   *  its id, so the page you moved stays selected in its new position. */
  // Drag a page widget onto another slot (Mia, 2026-09-10: "mini tiny
  // artboard views underneath each one as widgets and make it so that we can
  // reorder by dragging"). One PATCH with the target index; the API
  // renumbers the whole run and re-points the post's default page.
  const [dragPage, setDragPage] = useState<number | null>(null);
  const reorderArtboardTo = async (frameId: string, toIndex: number) => {
    if (pagingBusy) return;
    setPagingBusy(true);
    try {
      const res = await fetch("/api/v1/content/artboard-pages", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ frame_id: frameId, to_index: toIndex }),
      });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setErr(j?.error?.message ?? "Couldn't reorder the pages. Try again.");
        return;
      }
      onArtboardMutated();
      onChange();
      onPageArtboard(frameId);
    } catch {
      setErr("The request didn't reach the server. Check your connection and try again.");
    } finally {
      setPagingBusy(false);
    }
  };
  // Escape closes the editor popup, captured on window BEFORE the deck's own
  // Escape (which would drop the whole overlay) and before Excalidraw's; the
  // dialog swallows the key entirely while it is up.
  useEffect(() => {
    if (!editingArtboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape inside a field belongs to the field: it ends typing on the
      // artboard (Mia, ticket 17d7f6a1) or in the properties, and must not
      // throw the whole designer away mid-sentence.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
      e.stopPropagation();
      closeArtboardEditor();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editingArtboard, closeArtboardEditor]);
  const diffSegs = useMemo(() => (suggestion ? wordDiff(suggestion.base, suggestion.text) : []), [suggestion]);
  // The concept travels with the slide too (Mia, 2026-07-22: "pull the post
  // concept from the calendar view into the post creation slide underneath the
  // post copy"): same field the calendar composer edits, so the two views are
  // one draft apart, never two sources.
  const [conceptDraft, setConceptDraft] = useState(item.post_concept ?? "");
  const [leadIdx, setLeadIdx] = useState(0);
  // post_images with the optimistic layer (Mia, 2026-07-22: drop clips into
  // the slide): adds and removes land here first and the PATCH follows, so a
  // drop feels instant; a failed write restores the stored array and the
  // error reads inline. The effect re-syncs the draft when a refetch echoes
  // the truth back (same key, new prop reference).
  const [imgDraft, setImgDraftState] = useState<string[]>(item.post_images);
  const imgDraftRef = useRef<string[]>(item.post_images);
  const setImgDraft = (next: string[]) => {
    imgDraftRef.current = next;
    setImgDraftState(next);
  };
  useEffect(() => {
    imgDraftRef.current = item.post_images;
    setImgDraftState(item.post_images);
  }, [item.post_images]);
  // Media used (ticket 972a9ea8): the same optimistic posture as imgDraft,
  // its own array. `?? []` because an optimistic item built before 0132
  // may not carry the field yet.
  const [mediaDraft, setMediaDraftState] = useState<SourceMedia[]>(item.source_media ?? []);
  // The LATEST list, for a settle that lands after other batches (a slow
  // video after a quick image): an add reads the ref, never the array the
  // drop's render happened to close over, so two overlapping drops keep
  // both. Same posture for the stills below.
  const mediaDraftRef = useRef<SourceMedia[]>(item.source_media ?? []);
  const setMediaDraft = (next: SourceMedia[]) => {
    mediaDraftRef.current = next;
    setMediaDraftState(next);
  };
  useEffect(() => {
    mediaDraftRef.current = item.source_media ?? [];
    setMediaDraftState(item.source_media ?? []);
  }, [item.source_media]);
  const mediaFileRef = useRef<HTMLInputElement | null>(null);
  // Whether an IMAGE_MIME or desktop-file drag is over the sheet: the WHOLE
  // section accepts the drop, the imagery panel wears the visible ring.
  const [dragOver, setDragOver] = useState(false);
  // Desktop uploads in flight (the composer's counter idiom): the Finalised
  // tab shows the spinner while any file is still travelling, and the count
  // survives overlapping drops because every settle decrements exactly once.
  const [pendingUploads, setPendingUploads] = useState(0);
  // The hidden file input behind "Upload from computer" (Mia, 12 Aug: the
  // empty state had no way to add by click).
  const fileRef = useRef<HTMLInputElement | null>(null);
  // WHICH STAGE THE ARTWORK COLUMN IS SHOWING (ticket 9b599621, minus the
  // Idea tab per bdc51c6d): the tabs across the top of the slide, replacing
  // the two that used to live inside the imagery panel. It opens on the
  // FURTHEST stage the post has actually reached, so a finished post shows
  // its final asset and everything else opens on the mockup; keyed-by-id
  // mounting resets it per slide, the copyDraft contract.
  const [stage, setStage] = useState<PostStage>(item.post_images.length > 0 ? "final" : "mockup");
  const [err, setErr] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState(false);
  /** A handle being typed into the Account popover (ticket 8003f057). */
  const [accountDraft, setAccountDraft] = useState("");
  // The inline ask: which teammate is being asked, and for what.
  const [asking, setAsking] = useState<string | null>(null);
  const [askText, setAskText] = useState("");
  const [askBusy, setAskBusy] = useState(false);

  // Paging away unmounts this slide mid-save; the settled fetch must not
  // touch dead state (the composer's aliveRef posture).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // The scale rulers: fz for type and gaps, capsFz for merchant caps (which
  // must never dip under the 12.5px Frosted floor, the standing house rule).
  // Rounded to a decimal so the computed styles stay stable across resize
  // jitter.
  const fz = (n: number) => Math.round(n * scale * 10) / 10;
  const capsFz = (n = 12.5) => Math.max(12.5, fz(n));
  // The column break is decided from the MEASURED width, not flex-wrap: a
  // sheet under 760px stacks concept over copy, wider sits them side by side.
  const stacked = width < 760;
  const padX = Math.round(fz(34));

  // THE STAGES' IMAGERY, split so each tab shows its own layer (ticket
  // 9b599621). The artboard render (the deck's hook, passed in) is the
  // STORYBOARD; the attached post_images are the FINALISED assets. The
  // clipped image the card arrived with (its idea) lost its tab in ticket
  // bdc51c6d but still feeds `allImages`, which is what dedupe reads, so
  // adding a clip that already sits on the row as image_url can never store
  // the same url twice. (The raw-URL Files list `allImages` also fed is
  // gone, ticket 857bbea0: the Download menu replaced it.)
  const ideaImage = item.image_url;
  const finalImages = useMemo(() => Array.from(new Set(imgDraft)), [imgDraft]);
  const lead = finalImages.length > 0 ? finalImages[Math.min(leadIdx, finalImages.length - 1)] : null;
  const allImages = useMemo(
    () => Array.from(new Set([ideaImage, ...finalImages].filter((u): u is string => Boolean(u)))),
    [ideaImage, finalImages],
  );

  // ONE thumb row (the no-scroll rework): how many thumbs fit is COMPUTED
  // from the imagery column's resolvable width, not clipped by CSS, so the
  // quiet +N chip can say exactly how many are out of sight. Side by side
  // both columns share flex-shrink 1, which distributes the gap's overshoot
  // by basis ratio, so the column resolves to EXACTLY 0.55 * (rowW - gap)
  // (the wider visual, ticket b2ae46ff); stacked it takes the full face
  // width. One 8px gap rides each thumb, and an overflowing row gives one
  // slot up to the chip.
  const imgColW = stacked ? width - padX * 2 : (width - padX * 2 - fz(28)) * 0.55;
  const thumbPx = Math.round(fz(54));
  const fitThumbs = Math.max(1, Math.floor((imgColW + 8) / (thumbPx + 8)));
  const shownThumbs = finalImages.length > fitThumbs ? finalImages.slice(0, Math.max(1, fitThumbs - 1)) : finalImages;
  const hiddenThumbs = finalImages.length - shownThumbs.length;

  const channels = channelsOf(item);
  const accounts = item.post_accounts ?? [];
  // Which OVERRIDE tab is active, or null when the copy area is editing the
  // canonical post_copy (single channel, no channels, the first channel's
  // tab, or a lit tab whose channel was deselected in the foot). Derived,
  // not stored, so a channel change can never strand the textarea on a tab
  // that no longer renders.
  const overrideTab = channels.length >= 2 && copyTab && channels.includes(copyTab) && copyTab !== channels[0] ? copyTab : null;
  const medium = isPostMedium(item.post_medium) ? item.post_medium : null;
  const word = deckWordOf(item.status);
  // deckWordOf can only return DECK_WORDS keys, so the find always lands; the
  // fallback keeps the compiler honest without a non-null assertion.
  const currentWord = DECK_WORDS.find((w) => w.key === word) ?? DECK_WORDS[0];
  const { weekday, date } = slideDate(item.scheduled_for ?? "");
  // The date popover (Nikki, 2026-09-11).
  const [dateOpen, setDateOpen] = useState(false);

  const report = (r: PatchResult) => {
    if (!aliveRef.current) return;
    setErr(r.ok ? null : r.message);
  };

  /** Move the post to another day, or take the date off so it waits as an
   *  idea. null is a real value here, not a missing one: the API stores
   *  scheduled_for null and the calendar List gathers those under No date. */
  const saveDate = async (next: string | null) => {
    setDateOpen(false);
    if ((item.scheduled_for ?? null) === next) return;
    report(await patchItem(item.id, { scheduled_for: next }));
  };

  /** Blur-save for the three text fields. Only a real change travels; an
   *  emptied title reverts instead of saving (the composer refuses empty
   *  titles, so the deck does too). */
  const saveTitle = async () => {
    const clean = titleDraft.trim();
    if (clean === (item.title ?? "").trim()) return;
    if (!clean) {
      setTitleDraft(item.title ?? "");
      return;
    }
    report(await patchItem(item.id, { title: clean }));
  };
  // WHY the sent-value refs: switching copy tabs calls the leaving tab's
  // save directly (nothing may be lost in the swap), but the textarea's blur
  // has usually just fired the SAME save. Comparing against the last value
  // actually sent, not the stored prop (which only updates after the
  // refetch), makes the second call a no-op instead of a duplicate PATCH; a
  // failed save resets its ref so the next blur retries.
  /** The durability layer (Mia, 2026-09-10: "i started writing copy into my
   *  slide and went back in and it disappeared. fix this permanently."). The
   *  text fields saved on BLUR only, and React fires no blur when the slide
   *  unmounts - a page turn, Escape, or Back to calendar mid-type dropped
   *  everything since the last blur. Three layers now: blur (unchanged), a
   *  debounce while typing, and an unmount flush. Every save reads these
   *  refs, so all three layers save what was ACTUALLY typed, never a stale
   *  closure; the sent-value refs below keep the layers from duplicating
   *  each other's PATCHes. */
  const draftsRef = useRef({ copy: copyDraft, overrides, overrideTab, concept: conceptDraft });
  draftsRef.current = { copy: copyDraft, overrides, overrideTab, concept: conceptDraft };
  // The copy currently in the box, and whether to collapse it: on mobile, an
  // empty copy box shrinks to a single line so the artboard + concept keep the
  // room, and it grows back the moment there are words (Mia 2026-09-11).
  const copyShown = overrideTab ? (overrides[overrideTab] ?? "") : copyDraft;
  const collapseCopy = Boolean(mobile) && !copyShown.trim();
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queueSave = (key: string, fn: () => void) => {
    clearTimeout(saveTimersRef.current[key]);
    saveTimersRef.current[key] = setTimeout(fn, 1200);
  };
  const sentCopyRef = useRef((item.post_copy ?? "").trim());
  const saveCopy = async () => {
    const clean = draftsRef.current.copy.trim();
    if (clean === sentCopyRef.current) return;
    sentCopyRef.current = clean;
    const r = await patchItem(item.id, { post_copy: clean || null });
    if (!r.ok) sentCopyRef.current = (item.post_copy ?? "").trim();
    report(r);
  };
  const sentOverridesRef = useRef<Record<string, string>>(
    Object.fromEntries(Object.entries(item.post_copy_channels).map(([k, v]) => [k, v.trim()])),
  );
  /** Blur-save for an override tab, the saveCopy idiom over the map. The
   *  PATCH rebuilds the WHOLE map from the local mirror (see overrides
   *  above); an emptied value drops its key, so clearing a tab's text
   *  deletes the override and the tab reads canonical again. Entries for
   *  channels REMOVED from the picker ride along on purpose: the stash is
   *  harmless and the words come back if the channel is re-added. Keys gate
   *  through isPostChannel because the jsonb column is ordinary text and the
   *  API refuses unknown keys. */
  const saveOverride = async (c: PostChannel) => {
    const clean = (draftsRef.current.overrides[c] ?? "").trim();
    if (clean === (sentOverridesRef.current[c] ?? "")) return;
    const before = sentOverridesRef.current;
    sentOverridesRef.current = { ...before, [c]: clean };
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...draftsRef.current.overrides, [c]: clean })) {
      const t = v.trim();
      if (t && isPostChannel(k)) next[k] = t;
    }
    const r = await patchItem(item.id, { post_copy_channels: next });
    if (!r.ok) sentOverridesRef.current = before;
    report(r);
  };
  /** A copy tab click: flush the LEAVING tab's draft before swapping so
   *  nothing is lost (the blur that preceded this click usually already did;
   *  the sent-value refs make this a no-op then), and only then light the
   *  new tab. */
  const switchCopyTab = async (c: PostChannel) => {
    if (c === (overrideTab ?? channels[0])) return;
    if (overrideTab) await saveOverride(overrideTab);
    else await saveCopy();
    if (aliveRef.current) setCopyTab(c);
  };
  const saveConcept = async () => {
    const clean = draftsRef.current.concept.trim();
    if (clean === (item.post_concept ?? "").trim()) return;
    report(await patchItem(item.id, { post_concept: clean || null }));
  };
  // The unmount flush: pending debounces are cancelled (their work happens
  // right now) and every field saves once from the refs. This is what makes
  // a page turn, Escape or Back to calendar mid-type lossless; fields the
  // blur layer already saved no-op via the sent-value refs.
  useEffect(() => {
    return () => {
      for (const t of Object.values(saveTimersRef.current)) clearTimeout(t);
      const tab = draftsRef.current.overrideTab;
      void saveCopy();
      if (tab) void saveOverride(tab);
      void saveConcept();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-scoped flush: every input it reads is a ref, and the save fns are stable for the mount
  }, []);

  /** Append library or freshly-uploaded imagery to post_images,
   *  optimistically. BATCHED on purpose: a multi-file upload settles as one
   *  list, and one PATCH from one read of imgDraft cannot lose members the
   *  way N single adds racing the same closure base would. Dedupe reads the
   *  DERIVED allImages list, so a clip that already leads the slide as its
   *  idea image cannot be stored again; the 12 cap mirrors
   *  contentInputSchema's ceiling, worded here instead of arriving as a
   *  server refusal. */
  const addImages = async (urls: string[]) => {
    // Read at settle time (the ref), so a slow upload landing after a quick
    // one appends to what is there now rather than to what was there when
    // the drop began.
    const current = imgDraftRef.current;
    const have = new Set([ideaImage, ...current].filter(Boolean));
    const fresh = Array.from(new Set(urls.filter((u) => isHttpUrl(u) && !have.has(u))));
    if (fresh.length === 0) return;
    const room = 12 - current.length;
    if (room <= 0) {
      setErr("A post holds up to 12 images. Remove one first.");
      return;
    }
    const next = [...current, ...fresh.slice(0, room)];
    setImgDraft(next);
    // Dropped imagery IS the finalised asset, so wherever the stage tabs were
    // the column flips to Finalised and the add is seen the moment it happens.
    setStage("final");
    const r = await patchItem(item.id, { post_images: next });
    if (!r.ok && aliveRef.current) setImgDraft(item.post_images);
    report(r);
    if (fresh.length > room && aliveRef.current) {
      setErr(`A post holds up to 12 images, so only the first ${room === 1 ? "one" : room} attached.`);
    }
  };

  /** The single-image door the library rail and the internal drag still use. */
  const addImage = async (url: string) => {
    await addImages([url]);
  };

  /** Reorder the finalised stills by DRAG (ticket 857bbea0, Mia: "people can
   *  just do this intuitively", so the arrow circles are gone): the dragged
   *  thumb takes the drop target's position and everything between shifts.
   *  post_images order IS the display order (0061, array order), so a
   *  reorder is a splice and a PATCH of the whole array, optimistic like
   *  every other imagery edit here (server truth re-syncs imgDraft through
   *  the effect above on refetch). */
  const reorderImage = async (from: string, to: string) => {
    const i = imgDraft.indexOf(from);
    const j = imgDraft.indexOf(to);
    if (i < 0 || j < 0 || i === j) return;
    const next = [...imgDraft];
    next.splice(i, 1);
    next.splice(j, 0, from);
    setImgDraft(next);
    const r = await patchItem(item.id, { post_images: next });
    if (!r.ok && aliveRef.current) setImgDraft(item.post_images);
    report(r);
  };
  /** Which still a thumb drag is carrying, by url. A ref, not dataTransfer
   *  alone: getData is empty during dragover by spec, so the target test
   *  needs a place to look while the drag is in flight. */
  const dragStillRef = useRef<string | null>(null);

  /** Fetch-then-anchor download (ticket 857bbea0: "download still" replaces
   *  the raw URL list). The blob round trip is what makes the browser SAVE
   *  rather than navigate: the download attribute is ignored cross-origin,
   *  and every still lives on the storage host, not ours. Failure falls back
   *  to opening the still in a new tab, which is what the old link did. */
  const fileNameOf = (url: string): string => {
    try {
      const last = new URL(url).pathname.split("/").pop();
      return last && last.includes(".") ? decodeURIComponent(last) : "still.png";
    } catch {
      return "still.png";
    }
  };
  const downloadStill = async (url: string, as?: string) => {
    const name = as || fileNameOf(url);
    try {
      const blob = await (await fetch(url)).blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on a delay: revoking synchronously can cancel the save the
      // click just started in some engines.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };
  /** Sequential on purpose (no dependencies, no zip): one anchor download per
   *  still with a small gap, because a burst of same-tick downloads gets all
   *  but the first swallowed by popup heuristics. */
  const [downloadBusy, setDownloadBusy] = useState(false);
  const downloadAll = async (files: { url: string; name?: string }[]) => {
    if (downloadBusy) return;
    setDownloadBusy(true);
    try {
      for (const { url, name } of files) {
        await downloadStill(url, name);
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        if (!aliveRef.current) return;
      }
    } finally {
      if (aliveRef.current) setDownloadBusy(false);
    }
  };
  const downloadAllStills = () => downloadAll(finalImages.map((url) => ({ url })));
  const downloadAllMedia = () => downloadAll(mediaDraftRef.current);

  /** Media used (ticket 972a9ea8): append source files, optimistic, the
   *  addImages posture with its own cap. Stored as uploaded, so the download
   *  is the original bytes. */
  const addMedia = async (files: SourceMedia[]) => {
    const current = mediaDraftRef.current;
    const have = new Set(current.map((f) => f.url));
    const fresh: SourceMedia[] = [];
    for (const f of files) {
      if (!isHttpUrl(f.url) || have.has(f.url)) continue;
      have.add(f.url);
      fresh.push({ url: f.url, name: (f.name || fileNameOf(f.url)).slice(0, 200) });
    }
    if (fresh.length === 0) return;
    const room = 24 - current.length;
    if (room <= 0) {
      setErr("Media used holds up to 24 files. Remove one first.");
      return;
    }
    const next = [...current, ...fresh.slice(0, room)];
    setMediaDraft(next);
    setStage("media");
    const r = await patchItem(item.id, { source_media: next });
    if (!r.ok && aliveRef.current) setMediaDraft(item.source_media ?? []);
    report(r);
    if (fresh.length > room && aliveRef.current) {
      setErr(`Media used holds up to 24 files, so only the first ${room === 1 ? "one" : room} attached.`);
    }
  };
  const removeMedia = async (url: string) => {
    const next = mediaDraftRef.current.filter((f) => f.url !== url);
    setMediaDraft(next);
    const r = await patchItem(item.id, { source_media: next });
    if (!r.ok && aliveRef.current) setMediaDraft(item.source_media ?? []);
    report(r);
  };

  /** Desktop files (the hidden input OR a Finder drag) through the existing
   *  upload route, then ONE batched append. The stage flips to the target
   *  first so the spinner is visible while the bytes travel; per-file settles
   *  decrement the counter individually so a slow video cannot pin the whole
   *  row on "uploading". Failures word the inline err AFTER the append so a
   *  partial success still attaches everything that made it. The target is
   *  the tab that is up: files dropped while Media used is showing are
   *  source files, not stills (ticket 972a9ea8). */
  const uploadFiles = async (list: FileList | File[], target: "final" | "media" = stage === "media" ? "media" : "final") => {
    // The server sniffs bytes and is the real gate; this filter only keeps
    // obvious non-media (a .txt drag) from paying a round trip to a 415.
    const media = Array.from(list).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (media.length === 0) return;
    setStage(target);
    setPendingUploads((n) => n + media.length);
    const settled = await Promise.allSettled(
      media.map((f) =>
        uploadMedia(f).finally(() => {
          if (aliveRef.current) setPendingUploads((n) => n - 1);
        }),
      ),
    );
    if (!aliveRef.current) return;
    // Each result sits at its file's index, so a source keeps the name it
    // was uploaded with (storage itself never keeps a client filename).
    const landed = settled.flatMap((s, i) => (s.status === "fulfilled" ? [{ url: s.value, name: media[i].name }] : []));
    if (landed.length > 0) await (target === "media" ? addMedia(landed) : addImages(landed.map((l) => l.url)));
    const firstFail = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    if (firstFail && aliveRef.current) {
      setErr(firstFail.reason instanceof Error ? firstFail.reason.message : "Couldn't upload that file. Try again.");
    }
  };

  /** The thumb row's quiet x: PATCH post_images without the url. Only
   *  post_images members get an x; image_url is the clip's own field and is
   *  not this control's to clear. */
  const removeImage = async (url: string) => {
    const next = imgDraft.filter((u) => u !== url);
    setImgDraft(next);
    const r = await patchItem(item.id, { post_images: next });
    if (!r.ok && aliveRef.current) setImgDraft(item.post_images);
    report(r);
  };

  /** A dropped or clicked board image that has no URL yet: resolve the
   *  fileId through the hook's upload-and-cache path, then the ordinary
   *  addImage. Failure surfaces the existing inline err and changes nothing
   *  on the slide, the same posture as a failed PATCH. */
  const addBoardFile = async (fileId: string) => {
    const url = await resolveBoardImage(fileId);
    if (!aliveRef.current) return;
    if (!url) {
      setErr("The image could not be uploaded. Try again.");
      return;
    }
    void addImage(url);
  };

  // The library rail's click fallback and its upload-failure wording ride
  // this channel (addToSlideRef at the deck). Re-registered every render,
  // deliberately without deps, so the closure always sees the current
  // imgDraft; cleared on unmount so a divider on stage leaves the rail's
  // buttons disabled.
  useEffect(() => {
    registerAdd.current = {
      add: (url: string) => void addImage(url),
      fail: (message: string) => setErr(message),
    };
    return () => {
      registerAdd.current = null;
    };
  });

  /** A deck word writes its mapped status (see DECK_WORDS); a refused write
   *  lands inline right below the row. */
  const clickWord = async (w: (typeof DECK_WORDS)[number]) => {
    if (rowBusy || w.key === word) return;
    setRowBusy(true);
    report(await patchItem(item.id, { status: w.status }));
    if (aliveRef.current) setRowBusy(false);
  };

  /** Channel pills PATCH directly, dual-writing the 0065 pair: the array is
   *  the truth, the scalar mirrors its first member for old readers. */
  const toggleChannel = async (c: PostChannel) => {
    if (rowBusy) return;
    setRowBusy(true);
    const next = channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c];
    report(await patchItem(item.id, { post_channels: next, post_channel: next[0] ?? null }));
    if (aliveRef.current) setRowBusy(false);
  };

  /** ACCOUNTS (Nikki, ticket 8003f057): the handles the post goes out on,
   *  multi-select over the suggestions plus anything typed in. */
  const saveAccounts = async (next: string[]) => {
    if (rowBusy) return;
    setRowBusy(true);
    report(await patchItem(item.id, { post_accounts: next }));
    if (aliveRef.current) setRowBusy(false);
  };
  const toggleAccount = (a: string) => void saveAccounts(accounts.includes(a) ? accounts.filter((x) => x !== a) : [...accounts, a]);
  const addAccount = () => {
    const raw = accountDraft.trim().replace(/^@+/, "").slice(0, 60);
    if (!raw || rowBusy) return;
    if (accounts.includes(raw)) {
      setAccountDraft("");
      return;
    }
    if (accounts.length >= 10) {
      setErr("A post goes out on up to 10 accounts.");
      return;
    }
    setAccountDraft("");
    void saveAccounts([...accounts, raw]);
  };

  /** Medium is single-choice; the lit pill toggles off to null. */
  const clickMedium = async (m: (typeof POST_MEDIUMS)[number]) => {
    if (rowBusy) return;
    setRowBusy(true);
    report(await patchItem(item.id, { post_medium: medium === m ? null : m }));
    if (aliveRef.current) setRowBusy(false);
  };

  // Content pillar picker (Nikki's lab, 2026-08-12): file the post under a
  // pillar, or make a new one, to start categorising. Selecting patches
  // pillar_id; creating POSTs a pillar then files the post under it.
  const [pillarDraft, setPillarDraft] = useState("");
  const [pillarBusy, setPillarBusy] = useState(false);
  const selectPillar = async (id: string | null) => {
    if (id === (item.pillar_id ?? null)) return;
    report(await patchItem(item.id, { pillar_id: id }));
  };
  // Archived pillars stay OUT of the picker (the composer's pillarChoices
  // posture: hiding is the whole point of archiving) UNLESS this post already
  // wears one, so the list never lies about the current tag. The prod GET
  // includes archived rows deliberately (PillarsView manages them there).
  const pillarChoices = pillars.filter((p) => !p.archived_at || p.id === (item.pillar_id ?? null));
  const createPillar = async (close: () => void) => {
    const name = pillarDraft.trim();
    if (!name || pillarBusy) return;
    setPillarBusy(true);
    try {
      const res = await fetch("/api/v1/content/pillars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j: unknown = await res.json().catch(() => null);
      if (res.ok) {
        await onPillarsChanged();
        const id = (j as { data?: { id?: string } } | null)?.data?.id;
        if (id) report(await patchItem(item.id, { pillar_id: id }));
        setPillarDraft("");
        close();
      } else if (aliveRef.current) {
        // A refused create (409 duplicate name, 422) words itself through the
        // slide's err line, the report() surface; the popover stays open so
        // the name can be corrected and retried.
        setErr(readErrorMessage(j) ?? "The pillar could not be created. Try again.");
      }
    } catch {
      if (aliveRef.current) setErr("The request didn't reach the server. Check your connection and try again.");
    } finally {
      if (aliveRef.current) setPillarBusy(false);
    }
  };

  // Caption suggested edits (Nikki's lab, 2026-08-12): each action writes the
  // row (caption_suggestion, 0082) optimistically, the imgDraft posture, and
  // a failed PATCH restores what was there. The deck's ENTRY into suggesting
  // left with ticket c909e86c (the Comments button took its place); a pending
  // suggestion made in the composer still renders here so it can be sent,
  // accepted or dismissed.
  const sendForApproval = async () => {
    if (!suggestion || suggestion.status === "sent") return;
    const next: CaptionSuggestion = { ...suggestion, status: "sent" };
    const before = suggestion;
    setSuggestion(next);
    const r = await patchItem(item.id, { caption_suggestion: next });
    if (!r.ok && aliveRef.current) setSuggestion(before);
    report(r);
  };
  const dismissSuggestion = async () => {
    if (!suggestion) return;
    const before = suggestion;
    setSuggestion(null);
    const r = await patchItem(item.id, { caption_suggestion: null });
    if (!r.ok && aliveRef.current) setSuggestion(before);
    report(r);
  };
  // Accept writes the proposed caption straight through and clears the
  // suggestion in the SAME patch, so the two can never land apart (saveCopy
  // reads the stale draft, so the accepted text patches directly, the
  // saveCopy idiom over its ref).
  const acceptSuggestion = async () => {
    if (!suggestion) return;
    const before = suggestion;
    const text = suggestion.text;
    setCopyDraft(text);
    setSuggestion(null);
    const clean = text.trim();
    sentCopyRef.current = clean;
    const r = await patchItem(item.id, { post_copy: clean || null, caption_suggestion: null });
    if (!r.ok) {
      sentCopyRef.current = (item.post_copy ?? "").trim();
      if (aliveRef.current) setSuggestion(before);
    }
    report(r);
  };

  /** POST the input request: tags the slide AND creates the matching task in
   *  /tasks (the route's contract). Re-asking replaces the open one. */
  const submitAsk = async () => {
    const what = askText.trim();
    if (!what || !asking || askBusy) return;
    setAskBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/content/${item.id}/input-request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: asking, what }),
      });
      const j: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!res.ok) {
        setErr(readErrorMessage(j) ?? "The ask did not go through. Try again.");
        return;
      }
      setAsking(null);
      setAskText("");
      onChange();
    } catch {
      if (aliveRef.current) setErr("The request didn't reach the server. Check your connection and try again.");
    } finally {
      if (aliveRef.current) setAskBusy(false);
    }
  };

  /** Clear the open request (completes its task server-side). A 409 means the
   *  screen was stale, so the refetch is the real answer either way. */
  const clearAsk = async () => {
    if (askBusy) return;
    setAskBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/content/${item.id}/input-request`, { method: "DELETE" });
      const j: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!res.ok && res.status !== 409) {
        setErr(readErrorMessage(j) ?? "The request could not be cleared. Try again.");
        return;
      }
      onChange();
    } catch {
      if (aliveRef.current) setErr("The request didn't reach the server. Check your connection and try again.");
    } finally {
      if (aliveRef.current) setAskBusy(false);
    }
  };

  const awaitingName = firstNameOf(item.input_needed_from_name) ?? "teammate";
  const awaitingTint = inputTint(item.input_needed_from_name);
  // Teammates who can still be asked: everyone assignable except whoever the
  // open request already names (re-asking THEM would only replace like for
  // like; re-asking someone else replaces the request wholesale, the route's
  // contract, and stays offered).
  const askable = users.filter((u) => u.id !== item.input_needed_from);
  const pillarDot = pillarColorOf(pillar);
  // A const capture so the View-artboard onClick keeps the narrowed string
  // (property narrowing does not survive into a closure; a const's does).
  const boardFrameId = item.board_frame_id;
  // THE ARTBOARD PAGER (ticket 6b565b4f): where the shown frame sits in the
  // post's derived artboard set. The pager renders only when the set really
  // holds several boards AND the shown frame is one of them, so a stale
  // selection (a frame deleted on the board mid-session) degrades to the
  // plain single-artboard stage rather than dead arrows.
  const shownBoardId = shownFrameId ?? boardFrameId;
  const artIdx = shownBoardId ? artboards.findIndex((a) => a.frameId === shownBoardId) : -1;
  /**
   * EVERY PAGE OF THIS POST'S CAROUSEL (Mia, 2026-09-18: "it shows all the
   * multiple carousel artboards associated with that slide, at the moment,
   * it's only showing the one").
   *
   * The pager already knows the run: `artboards` is the post's frame and its
   * `_N` siblings, which is exactly what a carousel is. Isolation takes the
   * whole run so the pages sit beside each other the way they will be swiped,
   * and the camera still opens on the one page the deck is showing.
   */
  const carouselFrameIds = useMemo(() => {
    const anchor = shownBoardId ?? boardFrameId;
    const ids = artboards.map((a) => a.frameId).filter(Boolean);
    if (!anchor) return ids;
    /**
     * NEVER MIX TWO POSTS (Mia, 2026-09-18: applying a template planted it on
     * "17 Sept, Creative Drop #2", a post she was not looking at).
     *
     * This used to PUSH the anchor on when the list did not contain it, which
     * reads as defensive and is the opposite. `artboards` comes from the
     * preview hook and can still describe the PREVIOUS slide for a moment
     * after switching; pushing this post's frame onto that post's list makes
     * one set out of two posts. Isolation then lit both, and a template aimed
     * at "the artboards in view" planted onto whichever sorted first, which
     * was the other post's.
     *
     * A list that does not contain the anchor does not belong to this post, so
     * it is not this post's carousel and is dropped. One artboard is a correct
     * answer; a mixture is never one.
     */
    return ids.includes(anchor) ? ids : [anchor];
  }, [artboards, shownBoardId, boardFrameId]);
  // The board-derived pager steps aside once a post is on the new artboards:
  // SlideArtboard pages the DOCUMENT, which is the only thing that knows about
  // a card she added or reordered in the editor.
  const hasPager = artboards.length > 1 && artIdx >= 0 && nativeArtboard !== true;
  // The stage holds the ARTBOARD's shape (Mia, 2026-09-10: "make sure the
  // boarder is the canvas size"): the shown frame's own w/h, falling back to
  // the Instagram Portrait default the board provisions with.
  const shownSibling = artIdx >= 0 ? artboards[artIdx] : (artboards.find((a) => a.frameId === shownBoardId) ?? null);
  const stageRatio = `${shownSibling?.width ?? 1080} / ${shownSibling?.height ?? 1350}`;
  const pageArtboard = (dir: -1 | 1) => {
    const next = artboards[artIdx + dir];
    if (next) onPageArtboard(next.frameId);
  };

  return (
    <section
      aria-label={`Slide: ${labelOf(item)}`}
      // The WHOLE sheet is the drop target (a half-screen drag should not
      // have to land on the panel exactly); the imagery panel below is just
      // the ring's anchor. Handlers gate on IMAGE_MIME (the library rail's
      // internal drag) OR "Files" (a real Finder/desktop drag, Mia 12 Aug:
      // "drag to screen doesnt work" because only the internal mime was
      // admitted); plain text drags still pass straight through untouched.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(IMAGE_MIME) && !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // Leaving into a child fires dragleave too; only a real exit clears.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        // IMAGE_MIME first and exclusively, byte-compatible with the clips
        // panel drag; only a drop that never carried our mime reads as files.
        if (e.dataTransfer.types.includes(IMAGE_MIME)) {
          e.preventDefault();
          setDragOver(false);
          const payload = e.dataTransfer.getData(IMAGE_MIME);
          if (!payload) return;
          // A board image without a URL yet drags as the sentinel and uploads
          // on landing; a plain URL payload is the original path, unchanged.
          // With Media used up, a library clip or board image is a SOURCE,
          // not a still (ticket 972a9ea8): the tab that is showing is the
          // one being dropped into.
          if (stage === "media") {
            if (payload.startsWith(BOARD_FILE_PREFIX)) {
              void resolveBoardImage(payload.slice(BOARD_FILE_PREFIX.length)).then((url) => {
                if (!aliveRef.current) return;
                if (url) void addMedia([{ url, name: fileNameOf(url) }]);
                else setErr("The image could not be uploaded. Try again.");
              });
            } else {
              void addMedia([{ url: payload, name: fileNameOf(payload) }]);
            }
            return;
          }
          if (payload.startsWith(BOARD_FILE_PREFIX)) void addBoardFile(payload.slice(BOARD_FILE_PREFIX.length));
          else void addImage(payload);
          return;
        }
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(false);
          void uploadFiles(e.dataTransfer.files);
        }
      }}
      style={{ width, height, flex: "none", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r-card)", boxShadow: "var(--shadow-panel)", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      {/* The slide's face, NO LONGER a scroller (Mia: "i dont like the fact
          you have to scroll DOWN ON THE SLIDE... it all fits in one slide
          container neatly"): overflow hidden plus a column flex, so the
          title block sits fixed and the columns row below gets exactly the
          leftover height. FLEX MATHS, verified at both ends: the sheet is a
          fixed 16:9 rect (height = width * 9/16 from the stage measure), the
          foot is flex none, so this face gets sheetH - footH exactly; its
          overflow hidden means nothing inside can grow the sheet or push the
          foot off it. At full size (1150 x 647, scale 1): foot ~59 + face
          padding 40 + title block ~60 + the stage tab row ~40 + the columns
          row's 12 top margin leave that row ~436px, all of which the artwork
          column and the copy column fill (both minHeight 0, so neither can
          demand more). The stage row costs the columns nothing net: it is the
          old in-panel tab row moved up a level (ticket 9b599621). At the
          320 floor (320 x 180, scale 0.7): the same subtraction leaves a few
          dozen pixels, the flexed children shrink to their minHeights and
          the excess CLIPS inside this box; the foot stays pinned because it
          is flex none and the section's own overflow hidden bounds it. At no
          computed size does any scrollbar appear on the slide itself, only
          inside textareas and the files list, which own their scroll. */}
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", padding: `${fz(24)}px ${padX}px ${fz(16)}px` }}>
        {/* The title block, Mia's deck: weekday quiet, date as the slide
            title (fz(25), ticket 78a1b670: "make it a bit smaller"), ruled
            off like a slide heading. The old top-right pill row is GONE
            (ticket 74b7d901: it doubled the foot clusters up); the pillar
            now rides the foot's bottom-left STATUS cluster instead. */}
        {/* The date is now the CONTROL, not a caption (Nikki, 2026-09-11:
            "select a new date, but also select no date, so that I can see
            them undated and just there as a WIP / Idea"). Click it to move
            the post, or take the date off entirely and let it sit as an
            idea. On mobile the post's name sits beside it (ticket bfb73ea4,
            Mia: "the post name is next to the date on mobile"): the
            filmstrip that named the slide is hidden there, so the title
            would otherwise be nowhere on the stripped view. */}
        <div style={{ flex: "none", borderBottom: "1px solid var(--hairline)", paddingBottom: fz(14), position: "relative" }}>
          <div style={{ ...capsLabel, fontSize: capsFz(), letterSpacing: ".14em" }}>{weekday || "No date"}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: fz(10), flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setDateOpen((o) => !o)}
            aria-expanded={dateOpen}
            title="Change the date, or take it off and leave this as an idea"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: fz(8),
              background: "transparent",
              border: "none",
              padding: 0,
              margin: 0,
              cursor: "pointer",
              font: "inherit",
              fontSize: fz(25),
              fontWeight: 700,
              letterSpacing: "-.02em",
              color: "var(--text)",
              lineHeight: 1.12,
              textAlign: "left",
            }}
          >
            {date || "Undated"}
            <span aria-hidden style={{ fontSize: fz(12), color: "var(--text-muted-2)", fontWeight: 500 }}>▾</span>
          </button>
          {mobile && (
            <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: fz(15), fontWeight: 500, color: "var(--text-muted)", lineHeight: 1.3, overflowWrap: "anywhere" }}>
              {labelOf(item)}
            </div>
          )}
          </div>
          {dateOpen && (
            <div
              role="dialog"
              aria-label="Post date"
              style={{ position: "absolute", top: "100%", left: 0, zIndex: 70, marginTop: 6, padding: 10, display: "flex", flexDirection: "column", gap: 8, background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-panel)", minWidth: 232 }}
            >
              <label style={{ ...capsLabel, fontSize: 12 }} htmlFor={`deck-date-${item.id}`}>
                Post date
              </label>
              <input
                id={`deck-date-${item.id}`}
                type="date"
                value={(item.scheduled_for ?? "").slice(0, 10)}
                onChange={(e) => void saveDate(e.target.value || null)}
                style={{ width: "100%", background: "var(--field)", border: "1px solid var(--border)", borderRadius: "var(--r-chip)", padding: "7px 9px", color: "var(--text)", fontSize: 13.5, fontFamily: "inherit" }}
              />
              {/* Taking the date off moves the post out of the dated deck and
                  into the calendar List's undated tail, where it reads as an
                  idea rather than a plan. Saying so beats it vanishing. */}
              <button
                type="button"
                onClick={() => void saveDate(null)}
                disabled={!item.scheduled_for}
                style={{ ...capsLabel, fontSize: 12, textAlign: "left", background: "transparent", border: "1px solid var(--border)", borderRadius: "var(--r-chip)", padding: "7px 9px", cursor: item.scheduled_for ? "pointer" : "default", opacity: item.scheduled_for ? 1 : 0.5, color: "var(--text-muted)" }}
              >
                No date, keep as an idea
              </button>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--text-muted-2)" }}>
                Undated posts leave this deck and wait in the calendar List under No date.
              </p>
            </div>
          )}
        </div>

        {/* THE THREE STAGE TABS (ticket 9b599621, Nikki): Idea, Storyboard /
            mockup, Finalised, across the top of the slide. They page the
            ARTWORK column below them through the post's imagery stages and
            touch nothing else, because it is one post either way: the caption
            side stays exactly as it is whichever tab is lit. This row is the
            old in-panel tab row moved up a level, so the sheet's no-scroll
            maths above nets out unchanged. overflow hidden, never a scroller:
            at the 320 sheet floor the labels clip like everything else on the
            face rather than putting a bar inside the slide. */}
        <div
          role="tablist"
          aria-label="Post stage"
          // On a phone the row stays (Mia, 2026-11-02: the slides must work on
          // the mobile) and wraps instead of clipping.
          style={{ flex: "none", display: "flex", alignItems: "center", gap: 2, minWidth: 0, overflow: mobile ? "visible" : "hidden", flexWrap: mobile ? "wrap" : undefined, marginTop: fz(10), borderBottom: "1px solid var(--hairline)" }}
        >
          {POST_STAGES.map((s) => {
            const on = stage === s.key;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setStage(s.key)}
                title={`${s.label}. ${s.hint}`}
                // flex 0 1 auto, not none: the row is overflow:hidden, so at the
                // 320 sheet floor fixed-width tabs would push "Finalised" off
                // the edge and out of reach entirely. Shrinking to an ellipsis
                // keeps every tab clickable at every size; the title carries
                // the full label.
                style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", padding: "5px 11px 6px", border: "none", borderBottom: on ? "2px solid var(--text)" : "2px solid transparent", borderRadius: 0, cursor: "pointer", background: "transparent", color: on ? "var(--text)" : "var(--text-muted)", fontFamily: MONO, fontSize: capsFz(), fontWeight: 500, letterSpacing: ".05em", textTransform: "uppercase", whiteSpace: "nowrap" }}
              >
                {s.label}
              </button>
            );
          })}
          <span style={{ flex: 1, minWidth: 6 }} />
          {/* Edit artboard (ticket 07e8115a): the Mock-ups editor as a popup
              OVER the slide, so the copy deck stays open beneath and the two
              are one click apart. Offered whenever the storyboard stage is up
              and the item carries a frame, same gate as View artboard minus
              the tab-jump callback it does not need. */}
          {/* Standalone export: Edit artboard removed, artboards are not part of this export. */}
          {/* New page and View artboard are GONE from the copy slide (Mia,
              2026-09-18: "remove 'new page' and 'view artboard' from the copy
              slide sections"). Edit artboard is the one door now, and New page
              lives inside it, where a new artboard is actually drawn. */}
        </div>

        {/* The two columns of the copy-deck frame (ticket 9b599621: "the
            artwork on the left and the caption on the right"): artwork left,
            words right. The break rides the MEASURED sheet width; the row is
            flex 1 1 auto + minHeight 0 so it takes the face's leftover height
            exactly (the no-scroll maths above), and stacked mode splits that
            height 55/45 the way wide mode splits width. The artwork's share
            grew from 42% (ticket b2ae46ff, Mia: "visual view should be
            larger"); imgColW's factor above tracks this number. */}
        <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: stacked ? "column" : "row", gap: stacked ? fz(14) : fz(28), marginTop: fz(12) }}>
          <div style={{ flex: stacked ? "1 1 55%" : "0 1 55%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {/* THE ARTWORK PANEL (the no-scroll rework): ONE fixed-height
                panel that IS the column, showing whichever stage the tabs
                above have lit. minHeight 0 rides the whole chain (columns
                row -> column -> panel), so the panel's height is the
                column's share of the face's leftover height, NEVER its
                content height, and every stage body contains its imagery
                inside it (object-fit contain). The panel also wears the drop
                ring while an IMAGE_MIME drag is anywhere over the sheet,
                whichever stage is up; the drop itself lands through the
                section handlers unchanged, into the finalised assets. */}
            <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 8, borderRadius: "var(--r-card)", ...(dragOver ? { outline: "2px dashed var(--accent)", outlineOffset: 3 } : {}) }}>
              {stage === "mockup" ? (
                // THE ARTBOARD PAGER's wrapper (ticket 6b565b4f): relative so
                // the flick arrows can float at the panel's edges, a column so
                // the dots row rides under the render without stealing its
                // contain maths. With one artboard (or none) the pager hides
                // and this is exactly the old single-render stage.
                <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Drawn from the document, in the real fonts, by the same
                      component the designer uses — see SlideArtboard. Mounted
                      always so it can answer whether there IS one; it renders
                      nothing until there is. */}
                  <SlideArtboard
                    itemId={item.id}
                    pageIndex={artIdx}
                    refreshKey={artboardStamp}
                    onFound={setNativeArtboard}
                  />
                  {nativeArtboard === null ? null : nativeArtboard ? null : artboard?.kind === "image" ? (
                    // The artboard render CONTAINED in the panel's height (the
                    // no-scroll contract): flex 1 + minHeight 0 sizes the img
                    // box to whatever the tab row and files leave, and contain
                    // letterboxes the portrait export on the field wash instead
                    // of cropping. The src is a local object URL minted by
                    // useArtboardPreview, so next/image has nothing to
                    // optimize, the plain-img rule.
                    // eslint-disable-next-line @next/next/no-img-element
                    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={artboard.url}
                        alt={hasPager ? `Artboard: ${artboards[artIdx].name}` : "The artboard design from Mock-ups"}
                        title={hasPager ? artboards[artIdx].name : "Designed on Mock-ups"}
                        style={{ height: "100%", maxWidth: "100%", aspectRatio: stageRatio, objectFit: "contain", background: "var(--field)", borderRadius: "var(--r-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-card)", display: "block" }}
                      />
                    </div>
                  ) : (
                    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div
                      title="Designed on Mock-ups"
                      style={{ height: "100%", maxWidth: "100%", aspectRatio: stageRatio, borderRadius: "var(--r-card)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted-2)", fontSize: fz(13.5), padding: 12, textAlign: "center", overflow: "hidden" }}
                    >
                      {/* Failures wear a tile too (the fail-visibly rework in
                          useArtboardPreview); a null preview (no frame linked,
                          or still exporting) gets its own quiet wording. */}
                      {artboard?.kind === "unavailable"
                        ? "Artboard preview unavailable. Open Mock-ups to see it."
                        : artboard?.kind === "empty"
                          ? "Artboard empty. Design it on Mock-ups."
                          : "No artboard yet. Design one on Mock-ups."}
                    </div>
                    </div>
                  )}
                  {hasPager && (
                    <>
                      {/* Left and right flick arrows (Mia: "MAKE A WAY THAT
                          YOU CAN FLICK THROUGH ALL ARTBOARDS"): the deck's
                          own arrow idiom shrunk to the panel, ends disabled
                          rather than hidden so the pair reads as one
                          control. */}
                      <button
                        type="button"
                        onClick={() => pageArtboard(-1)}
                        disabled={artIdx === 0}
                        aria-label="Previous artboard"
                        title={artIdx > 0 ? `Show ${artboards[artIdx - 1].name}` : "This is the first artboard"}
                        style={artboardArrowStyle("left", artIdx === 0)}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        onClick={() => pageArtboard(1)}
                        disabled={artIdx === artboards.length - 1}
                        aria-label="Next artboard"
                        title={artIdx < artboards.length - 1 ? `Show ${artboards[artIdx + 1].name}` : "This is the last artboard"}
                        style={artboardArrowStyle("right", artIdx === artboards.length - 1)}
                      >
                        ›
                      </button>
                      {/* Page widgets (Mia, 2026-09-10): a mini artboard per
                          page, aspect-correct, the current one lit. Click to
                          page; DRAG onto another to reorder (drops before the
                          target, or at the end past the last). Replaces the
                          old position dots. */}
                      <div role="tablist" aria-label="Artboards on this post" style={{ flex: "none", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 8, paddingBottom: 2, opacity: pagingBusy ? 0.6 : 1 }}>
                        {artboards.map((a, i) => {
                          const isDragging = dragPage === i;
                          return (
                            <button
                              key={a.frameId}
                              type="button"
                              role="tab"
                              aria-selected={i === artIdx}
                              aria-label={`Artboard ${i + 1} of ${artboards.length}: ${a.name}`}
                              title={`${a.name} — click to view, drag to reorder`}
                              draggable={!pagingBusy}
                              onClick={() => onPageArtboard(a.frameId)}
                              onDragStart={(e) => { setDragPage(i); e.dataTransfer.effectAllowed = "move"; }}
                              onDragEnd={() => setDragPage(null)}
                              onDragOver={(e) => { if (dragPage !== null && dragPage !== i) e.preventDefault(); }}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (dragPage === null || dragPage === i) return;
                                const dragged = artboards[dragPage];
                                // Dropping onto a slot to the RIGHT of the drag
                                // origin lands after it shifts back by one.
                                const toIndex = dragPage < i ? i - 1 : i;
                                setDragPage(null);
                                void reorderArtboardTo(dragged.frameId, toIndex);
                              }}
                              style={{
                                flex: "none",
                                width: 26,
                                height: Math.round(26 * ((a.height || 1350) / (a.width || 1080))),
                                maxHeight: 40,
                                padding: 0,
                                borderRadius: 3,
                                border: i === artIdx ? "1.5px solid var(--text)" : "1px solid var(--border)",
                                background: "var(--field)",
                                cursor: pagingBusy ? "default" : "grab",
                                position: "relative",
                                opacity: isDragging ? 0.4 : 1,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontFamily: MONO,
                                fontSize: 10,
                                color: i === artIdx ? "var(--text)" : "var(--text-muted-2)",
                              }}
                            >
                              {i + 1}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : stage === "media" ? (
                <>
                  {/* MEDIA USED (Mia, ticket 972a9ea8): the source files for
                      the work, in a scrolling grid inside the panel's fixed
                      height, each one a click from the original bytes. */}
                  {mediaDraft.length > 0 ? (
                    <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(fz(112))}px, 1fr))`, gap: 8, alignContent: "start", paddingRight: 2 }}>
                      {mediaDraft.map(({ url, name }) => {
                        const video = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || /\.(mp4|webm|mov|m4v)$/i.test(name);
                        return (
                          <div key={url} style={{ position: "relative", borderRadius: "var(--r-chip)", border: "1px solid var(--hairline)", background: "var(--field)", overflow: "hidden", aspectRatio: "1 / 1" }}>
                            {video ? (
                              <video src={url} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            ) : (
                              <ClipImage src={url} alt={name} compact style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            )}
                            <button
                              type="button"
                              onClick={() => void downloadStill(url, name)}
                              title={`Download ${name} at full resolution`}
                              aria-label={`Download ${name}`}
                              style={{ position: "absolute", left: 6, bottom: 6, height: 24, padding: "0 9px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", boxShadow: "var(--shadow-card)" }}
                            >
                              <svg {...GLYPH} width={12} height={12} aria-hidden><path d="M12 4v11m0 0 5-5m-5 5-5-5M4.5 19.5h15" /></svg>
                              Download
                            </button>
                            <span title={name} style={{ position: "absolute", left: 0, right: 0, top: 0, padding: "4px 26px 4px 6px", fontSize: 11, lineHeight: 1.3, color: "#fff", background: "linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,0))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>
                              {name}
                            </span>
                            <button
                              type="button"
                              onClick={() => void removeMedia(url)}
                              aria-label={`Remove ${name} from Media used`}
                              title="Remove from Media used"
                              style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, padding: 0, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "var(--shadow-card)" }}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ flex: "1 1 auto", minHeight: 0, borderRadius: "var(--r-card)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted-2)", fontSize: fz(13.5), padding: 12, textAlign: "center", overflow: "hidden" }}>
                      Nothing here yet. Drop the images or video Nikki needs to make this post, or upload them below. They download at full resolution.
                    </div>
                  )}
                  <div style={{ flex: "none", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, paddingTop: 6 }}>
                    <button
                      type="button"
                      className="btn-ghost-pill"
                      onClick={() => mediaFileRef.current?.click()}
                      title="Upload images or video from this computer, kept at full resolution"
                      style={{ height: 26, padding: "0 11px", fontSize: 12.5 }}
                    >
                      Upload from computer
                    </button>
                    {mediaDraft.length > 1 && (
                      <button
                        type="button"
                        className="btn-ghost-pill"
                        disabled={downloadBusy}
                        onClick={() => void downloadAllMedia()}
                        title={`Save all ${mediaDraft.length} files to this computer`}
                        style={{ height: 26, padding: "0 11px", fontSize: 12.5, opacity: downloadBusy ? 0.55 : 1 }}
                      >
                        {downloadBusy ? "Downloading..." : "Download all"}
                      </button>
                    )}
                    <span style={{ fontFamily: MONO, fontSize: capsFz(), letterSpacing: ".05em", color: "var(--text-muted-2)" }}>
                      {mediaDraft.length} {mediaDraft.length === 1 ? "FILE" : "FILES"}
                    </span>
                    {pendingUploads > 0 && (
                      <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12.5 }}>
                        <span aria-hidden style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid color-mix(in srgb, currentColor 35%, transparent)", borderTopColor: "currentColor", display: "inline-block", animation: "ctSpin .7s linear infinite" }} />
                        {pendingUploads === 1 ? "Uploading..." : `Uploading ${pendingUploads}...`}
                      </span>
                    )}
                  </div>
                  <input
                    ref={mediaFileRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={(e) => {
                      if (e.target.files) void uploadFiles(e.target.files, "media");
                      e.target.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                </>
              ) : (
                <>
                  {/* FINALISED: the lead fills whatever the thumbs and
                      files leave (flex 1 + minHeight 0), contained rather
                      than the old fixed 4:3 crop so it can never demand more
                      height than the panel holds. */}
                  {lead ? (
                    // Clipped media is remote (Pinterest/IG/uploads); next/image
                    // would need a per-host allow-list, so plain img, the Thumb
                    // rule, inside ClipImage for the expired-clip wording.
                    <ClipImage src={lead} alt={labelOf(item)} style={{ flex: "1 1 auto", minHeight: 0, width: "100%", maxWidth: "100%", objectFit: "contain", background: "var(--field)", borderRadius: "var(--r-card)", border: "1px solid var(--hairline)", display: "block" }} />
                  ) : (
                    <div style={{ flex: "1 1 auto", minHeight: 0, borderRadius: "var(--r-card)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted-2)", fontSize: fz(13.5), padding: 12, textAlign: "center", overflow: "hidden" }}>
                      No final imagery yet. Drop a clip or a file here, or add one below.
                    </div>
                  )}
                  {/* The thumb row shows whenever a final asset exists (even
                      a lone one, which still needs its x reachable), ONE
                      computed row deep (see shownThumbs): overflow reads as
                      the quiet +N chip, never a second line. The x rides a
                      wrapper span, a button cannot nest in a button; the
                      wrapper is ALSO the drag handle, because reordering is
                      by drag now (ticket 857bbea0: the arrow circles were
                      "arrows which show that you can", and they are gone).
                      The drag payload rides its own mime so the sheet-level
                      drop handler (IMAGE_MIME and Files only) never mistakes
                      a reorder for an add. The 6px paddings keep the
                      floating x inside the row's own box. */}
                  {finalImages.length > 0 && (
                    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, paddingTop: 6, paddingBottom: 6 }}>
                      {shownThumbs.map((url, i) => (
                        <span
                          key={url}
                          draggable
                          onDragStart={(e) => {
                            dragStillRef.current = url;
                            e.dataTransfer.setData(STILL_REORDER_MIME, url);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            dragStillRef.current = null;
                          }}
                          onDragOver={(e) => {
                            if (dragStillRef.current && dragStillRef.current !== url) {
                              e.preventDefault();
                              e.stopPropagation();
                              e.dataTransfer.dropEffect = "move";
                            }
                          }}
                          onDrop={(e) => {
                            const from = dragStillRef.current;
                            dragStillRef.current = null;
                            if (!from || from === url) return;
                            e.preventDefault();
                            e.stopPropagation();
                            void reorderImage(from, url);
                          }}
                          title="Drag onto another still to reorder"
                          style={{ position: "relative", display: "inline-flex", flex: "none", cursor: "grab" }}
                        >
                          <button
                            type="button"
                            onClick={() => setLeadIdx(i)}
                            aria-label={`Show image ${i + 1}`}
                            aria-pressed={url === lead}
                            style={{ padding: 0, width: thumbPx, height: thumbPx, borderRadius: "var(--r-chip)", overflow: "hidden", cursor: "pointer", border: url === lead ? "2px solid var(--text)" : "1px solid var(--hairline)", background: "var(--field)" }}
                          >
                            {/* compact: the thumb is ~54px square, well under
                                what a 12.5px Merchant label needs, so the mark
                                carries it and the words ride the tooltip. */}
                            <ClipImage src={url} alt="" compact style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeImage(url)}
                            aria-label="Remove this image from the post"
                            title="Remove from the post"
                            style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, padding: 0, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "var(--shadow-card)" }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      {hiddenThumbs > 0 && (
                        <span
                          title={`${hiddenThumbs} more ${hiddenThumbs === 1 ? "image" : "images"} on this post`}
                          style={{ flex: "none", fontFamily: MONO, fontSize: capsFz(), fontWeight: 500, letterSpacing: ".05em", color: "var(--text-muted-2)" }}
                        >
                          +{hiddenThumbs}
                        </span>
                      )}
                    </div>
                  )}
                  {/* ADD + DOWNLOAD (ticket 39c34c33): the four worded pills
                      collapsed into two icon menus, a plus for the add paths
                      (the library rail and the desktop picker) and a download
                      for the save paths, the same actions unchanged behind
                      them. flex none like the thumb row, so the lead keeps
                      absorbing whatever height this row does not take. */}
                  <div style={{ flex: "none", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, paddingTop: 6 }}>
                    <FootPopover
                      ariaLabel="Add imagery to this post"
                      title="Add imagery"
                      triggerStyle={slideIconBtn}
                      trigger={<svg {...GLYPH} width={14} height={14} aria-hidden><path d="M12 5v14M5 12h14" /></svg>}
                    >
                      {(close) => (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            title="Open the image library and add a clip to this post"
                            onClick={() => { close(); onOpenLibrary(); }}
                            style={menuItemStyle(false)}
                          >
                            Add from library
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            title="Upload images or video from this computer"
                            onClick={() => { close(); fileRef.current?.click(); }}
                            style={menuItemStyle(false)}
                          >
                            Upload from computer
                          </button>
                        </>
                      )}
                    </FootPopover>
                    {lead && (
                      <FootPopover
                        ariaLabel="Download stills"
                        title="Download stills"
                        triggerStyle={slideIconBtn}
                        trigger={<svg {...GLYPH} width={14} height={14} aria-hidden><path d="M12 4v11m0 0 5-5m-5 5-5-5M4.5 19.5h15" /></svg>}
                      >
                        {(close) => (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              title="Save the opened still to this computer"
                              onClick={() => { close(); void downloadStill(lead); }}
                              style={menuItemStyle(false)}
                            >
                              Download still
                            </button>
                            {finalImages.length > 1 && (
                              <button
                                type="button"
                                role="menuitem"
                                disabled={downloadBusy}
                                title={`Save all ${finalImages.length} stills to this computer`}
                                onClick={() => { close(); void downloadAllStills(); }}
                                style={{ ...menuItemStyle(false), opacity: downloadBusy ? 0.55 : 1 }}
                              >
                                {downloadBusy ? "Downloading..." : "Download all"}
                              </button>
                            )}
                          </>
                        )}
                      </FootPopover>
                    )}
                    {pendingUploads > 0 && (
                      <span role="status" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12.5 }}>
                        <span aria-hidden style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid color-mix(in srgb, currentColor 35%, transparent)", borderTopColor: "currentColor", display: "inline-block", animation: "ctSpin .7s linear infinite" }} />
                        {pendingUploads === 1 ? "Uploading..." : `Uploading ${pendingUploads}...`}
                      </span>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={(e) => {
                      if (e.target.files) void uploadFiles(e.target.files);
                      // Cleared so picking the same file twice still fires
                      // change (the composer's idiom).
                      e.target.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                  {/* The post's ATTACHED LINKS (post_links, the composer's
                      Links field) kept from the old Files list: the raw
                      supabase image URLs left with the ticket, but a link Mia
                      typed in on purpose must still be reachable from the
                      slide. Same bounded-scroll idiom the Files list wore. */}
                  {item.post_links.length > 0 && (
                    <div style={{ flex: "none" }}>
                      <div style={{ ...capsLabel, fontSize: capsFz(), marginBottom: 3 }}>Links</div>
                      <div style={{ maxHeight: fz(52), overflowY: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                        {item.post_links.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ flex: "none", fontSize: fz(12.5), color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline", textUnderlineOffset: 2 }}
                          >
                            {url}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* The words column, minHeight 0 like its sibling (the no-scroll
              maths): the title, tabs, ghost button and first comment are
              flex none so they can never be squashed, the COPY textarea is
              the one flexible member and absorbs whatever height remains,
              scrolling internally when the words outgrow it. */}
          <div style={{ flex: "1 1 45%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: fz(12) }}>
            <input
              value={titleDraft}
              maxLength={300}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              placeholder="What is this post?"
              aria-label="Post title"
              style={{ ...fieldInput, flex: "none", fontSize: fz(18), fontWeight: 600, letterSpacing: "-.01em" }}
            />
            {/* PER-CHANNEL COPY TABS (Mia, 2026-07-22: "different tabs for
                channel platform copy"): with 2+ channels selected, one
                compact tab per channel in selection order sits right above
                the copy box, glyph + short name, the active one underlined
                in its CHANNEL_TINTS identity. The FIRST channel's tab edits
                post_copy itself (the canonical every other surface reads);
                each other tab edits its post_copy_channels override, same
                blur-save idiom. One channel selected means no tabs at all,
                exactly the old single textarea. */}
            {channels.length >= 2 && (
              <div role="tablist" aria-label="Copy per channel" style={{ flex: "none", display: "flex", alignItems: "stretch", gap: 2, overflowX: "auto", whiteSpace: "nowrap", borderBottom: "1px solid var(--hairline)", marginBottom: -4 }}>
                {channels.map((c) => {
                  const on = c === (overrideTab ?? channels[0]);
                  const base = CHANNEL_TINTS[c];
                  return (
                    <button
                      key={c}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => void switchCopyTab(c)}
                      title={c === channels[0] ? `${CHANNEL_LABELS[c]}: the main copy` : `Copy adapted for ${CHANNEL_LABELS[c]}`}
                      style={{
                        flex: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "5px 10px 6px",
                        border: "none",
                        borderBottom: on ? `2px solid ${base}` : "2px solid transparent",
                        borderRadius: 0,
                        cursor: "pointer",
                        background: on ? `color-mix(in srgb, ${base} 10%, transparent)` : "transparent",
                        color: on ? `color-mix(in srgb, ${base} 60%, var(--text))` : "var(--text-muted)",
                        fontFamily: MONO,
                        fontSize: capsFz(),
                        fontWeight: 500,
                        letterSpacing: ".05em",
                        textTransform: "uppercase",
                      }}
                    >
                      <ChannelGlyph c={c} size={12} />
                      {CHANNEL_LABELS[c]}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Comments (ticket c909e86c): the Suggest-an-edit entry gave
                this spot to the comments panel; the button toggles the panel
                over the slide, same quiet caps style the old trigger wore. */}
            {showComments && (
            <button
              type="button"
              onClick={() => setCommentsOpen((o) => !o)}
              aria-expanded={commentsOpen}
              style={{ flex: "none", alignSelf: "flex-end", background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)", fontFamily: MONO, fontSize: capsFz(), letterSpacing: ".05em", textTransform: "uppercase", padding: 0, marginBottom: -4 }}
            >
              Comments
            </button>
            )}
            {!overrideTab && suggestion ? (
              // Open suggestion: show the diff, accept or dismiss.
              <div style={{ ...fieldInput, flex: "1 1 auto", minHeight: fz(56), padding: 0, display: "flex", flexDirection: "column", overflow: "hidden", borderColor: "var(--accent)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 9px", background: "var(--accent-soft)", flex: "none" }}>
                  <SuggestDot name={suggestion.author_name} />
                  <span style={{ fontSize: fz(12.5), color: "var(--text-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <strong style={{ color: "var(--text)", fontWeight: 600 }}>{suggestion.author_name ?? "A teammate"}</strong> suggested an edit &middot; {timeAgo(suggestion.at)}
                  </span>
                  {suggestion.status === "sent" && (
                    <span style={{ marginLeft: "auto", flex: "none", fontFamily: MONO, fontSize: capsFz(10.5), letterSpacing: ".05em", textTransform: "uppercase", color: "var(--alert)", background: "color-mix(in srgb, var(--alert) 13%, transparent)", border: "1px solid color-mix(in srgb, var(--alert) 34%, transparent)", borderRadius: "var(--r-pill)", padding: "1px 7px" }}>Needs approval</span>
                  )}
                </div>
                <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "8px 10px", fontSize: fz(14), lineHeight: 1.55, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                  {diffSegs.map((seg, i) =>
                    seg.t === "eq" ? (
                      <span key={i}>{seg.s}</span>
                    ) : seg.t === "del" ? (
                      <span key={i} style={{ textDecoration: "line-through", textDecorationColor: "color-mix(in srgb, var(--danger) 55%, transparent)", color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 12%, transparent)", borderRadius: 3 }}>{seg.s}</span>
                    ) : (
                      <span key={i} style={{ color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 3, boxShadow: "inset 0 -2px 0 color-mix(in srgb, var(--accent) 40%, transparent)" }}>{seg.s}</span>
                    ),
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 9px", borderTop: "1px solid var(--divider)", flex: "none" }}>
                  {suggestion.status === "proposed" ? (
                    // The suggester's view: send it on, the other person accepts.
                    <>
                      <button type="button" onClick={() => void sendForApproval()} style={{ ...deckSuggestPrimary, fontSize: fz(12.5) }}>Send for approval</button>
                      <button type="button" onClick={() => void dismissSuggestion()} style={{ ...deckSuggestGhost, fontSize: fz(12.5) }}>Dismiss</button>
                    </>
                  ) : (
                    // The approver's view: accept applies it, or dismiss it.
                    <>
                      <button type="button" onClick={() => void acceptSuggestion()} style={{ ...deckSuggestPrimary, fontSize: fz(12.5) }}>Accept</button>
                      <button type="button" onClick={() => void dismissSuggestion()} style={{ ...deckSuggestGhost, fontSize: fz(12.5) }}>Dismiss</button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <textarea
                value={overrideTab ? (overrides[overrideTab] ?? "") : copyDraft}
                maxLength={10_000}
                onChange={(e) => {
                  const v = e.target.value;
                  if (overrideTab) {
                    setOverrides((m) => ({ ...m, [overrideTab]: v }));
                    queueSave("override", () => void saveOverride(overrideTab));
                  } else {
                    setCopyDraft(v);
                    queueSave("copy", () => void saveCopy());
                  }
                }}
                onBlur={() => void (overrideTab ? saveOverride(overrideTab) : saveCopy())}
                rows={collapseCopy ? 1 : 7}
                placeholder={overrideTab ? "Starts from the main copy" : "The caption or body text, ready to paste"}
                aria-label={overrideTab ? `Post copy for ${CHANNEL_LABELS[overrideTab]}` : "Post copy"}
                // The column's one flexible member (the no-scroll maths): it
                // takes the leftover height and scrolls its own words. resize
                // none, not vertical, because a hand-dragged height would
                // punch through the fixed sheet and clip the concept below.
                // Collapsed on mobile when empty: one quiet line until she writes.
                style={{ ...fieldInput, flex: collapseCopy ? "none" : "1 1 auto", minHeight: collapseCopy ? fz(30) : fz(56), resize: "none", fontSize: fz(14), lineHeight: 1.55 }}
              />
            )}
            {/* An untouched override starts from the main copy anyway, so the
                ghost prefill just hands the words over for adapting: draft
                only, saved on blur like any typing. copyDraft, not
                item.post_copy, so unsaved canonical edits come along. */}
            {overrideTab && (overrides[overrideTab] ?? "").trim() === "" && (
              <button
                type="button"
                onClick={() => setOverrides((m) => ({ ...m, [overrideTab]: copyDraft }))}
                disabled={!copyDraft.trim()}
                className="btn-ghost-pill"
                style={{ flex: "none", alignSelf: "flex-start", height: 26, padding: "0 11px", fontSize: 12.5, color: copyDraft.trim() ? "var(--text-muted)" : "var(--text-muted-2)", marginTop: -2 }}
              >
                Copy from {CHANNEL_LABELS[channels[0]]}
              </button>
            )}
            {/* Concept, folded shut by default on every screen (ticket
                11769374, Mia: "concept should be minimised"): the summary
                line says whether there is one, the box opens on a click. The
                First comment field that sat under it is DELETED outright
                ("and first comment deleted. we don't need that"); the
                post_first_comment column stays, untouched, for anything
                older that still holds one. */}
            <details style={{ flex: "none" }}>
              <summary style={{ ...capsLabel, fontSize: capsFz(), cursor: "pointer", listStyle: "none", color: "var(--text-muted)" }}>
                Concept {conceptDraft.trim() ? "" : "(empty)"}
              </summary>
              <textarea
                value={conceptDraft}
                maxLength={5_000}
                onChange={(e) => {
                  setConceptDraft(e.target.value);
                  queueSave("concept", () => void saveConcept());
                }}
                onBlur={() => void saveConcept()}
                rows={3}
                placeholder="The idea behind this post, from the calendar composer"
                aria-label="Post concept"
                style={{ ...fieldInput, minHeight: fz(40), resize: "none", fontSize: fz(13.5), lineHeight: 1.5, marginTop: 6 }}
              />
            </details>
            {showComments && <SlideComments itemId={item.id} fz={fz} capsFz={capsFz} />}
          </div>
        </div>
      </div>

      {/* The slide's foot, pinned: ONE wrapping row of two labelled clusters
          (Mia, 2026-07-22: "collapse these better... organised by channel /
          status / colour coded / visual iconicised"). STATUS bottom LEFT: the
          current deck word as a coloured glyph chip whose menu holds the other
          states and the Ask actions, plus the awaiting dot-chip while a
          request is open. Then CHANNEL: one tinted icon chip per selected
          channel, the plus popover toggling the set, and the medium as one
          glyph chip with its three-way menu. The page number stays quiet
          bottom RIGHT. This rail is the ONE place the tags live (ticket
          74b7d901 removed the header's duplicate pill row). */}
      <div style={{ flex: "none", borderTop: "1px solid var(--hairline)", padding: `${fz(10)}px ${padX}px ${fz(14)}px`, display: "flex", flexDirection: "column", gap: 8 }}>
        {asking && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={askText}
              maxLength={ASK_MAX}
              onChange={(e) => setAskText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitAsk();
                }
              }}
              placeholder={`What do you need from ${firstNameOf(users.find((u) => u.id === asking)?.full_name ?? null) ?? "them"}?`}
              aria-label="What the escalation is for"
              autoFocus
              style={{ ...fieldInput, flex: "1 1 220px", minWidth: 0, width: "auto", fontSize: 13 }}
            />
            <button type="button" onClick={() => void submitAsk()} disabled={askBusy || !askText.trim()} className="btn-primary-pill" style={{ height: 34, padding: "0 15px", opacity: askBusy || !askText.trim() ? 0.6 : 1 }}>
              {askBusy ? "Escalating..." : "Escalate"}
            </button>
            <button type="button" onClick={() => { setAsking(null); setAskText(""); }} className="btn-ghost-pill" style={{ height: 34, padding: "0 12px", color: "var(--text-muted)" }}>
              Cancel
            </button>
          </div>
        )}

        {err && (
          <div role="alert" style={{ color: "var(--danger)", fontSize: 13, lineHeight: 1.45 }}>{err}</div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, rowGap: 8 }}>
          {/* STATUS cluster, bottom left. */}
          <span style={{ ...capsLabel, fontSize: capsFz(), letterSpacing: ".08em" }}>Status</span>
          <FootPopover
            ariaLabel={`Status: ${currentWord.label}. Change the status`}
            title="Change the status"
            disabled={rowBusy}
            triggerStyle={{ ...wordChipStyle(word, true), display: "inline-flex", alignItems: "center", gap: 6, opacity: rowBusy ? 0.6 : 1 }}
            trigger={
              <>
                <WordGlyph w={word} />
                {currentWord.label}
              </>
            }
          >
            {(close) => (
              <>
                {DECK_WORDS.filter((w) => w.key !== word).map((w) => (
                  <button
                    key={w.key}
                    type="button"
                    role="menuitem"
                    disabled={rowBusy}
                    onClick={() => {
                      close();
                      void clickWord(w);
                    }}
                    style={menuItemStyle(false)}
                  >
                    <span aria-hidden style={{ display: "inline-flex", color: WORD_TINTS[w.key].base }}>
                      <WordGlyph w={w.key} />
                    </span>
                    {w.label}
                  </button>
                ))}
                {askable.length > 0 && (
                  <>
                    <div aria-hidden style={{ height: 1, background: "var(--divider)", margin: "5px 4px" }} />
                    {/* Mia's word for this flow is ESCALATE (2026-07-22), so the
                        menu says so out loud: a labelled section, not two quiet
                        rows. Same input-request flow underneath: the escalation
                        lands as an assigned task in /tasks and emails them. */}
                    <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted-2)", padding: "4px 10px 2px" }}>
                      Escalate
                    </div>
                  </>
                )}
                {askable.map((u) => {
                  const first = firstNameOf(u.full_name) ?? u.full_name;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      role="menuitem"
                      title={`Escalate to ${first}: adds a task to their list and emails them`}
                      onClick={() => {
                        close();
                        setAsking(u.id);
                        setAskText("");
                      }}
                      style={menuItemStyle(false)}
                    >
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: inputDot(u.full_name), flexShrink: 0 }} />
                      Escalate to {first}
                    </button>
                  );
                })}
              </>
            )}
          </FootPopover>
          {/* The awaiting overlay, collapsed to a dot-chip: identity dot plus
              first name; the full wording and the ask itself live in the
              title tooltip, the x clears the request (completing its task). */}
          {item.input_needed_from ? (
            <span
              title={`Awaiting ${awaitingName} input${item.input_needed_what ? `: ${item.input_needed_what}` : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: awaitingTint.bg, border: `1px solid ${awaitingTint.border}`, borderRadius: "var(--r-pill)", padding: "3px 4px 3px 10px" }}
            >
              <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: inputDot(item.input_needed_from_name), flexShrink: 0 }} />
              <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".06em", textTransform: "uppercase", color: awaitingTint.fg }}>
                {awaitingName}
              </span>
              <button
                type="button"
                onClick={() => void clearAsk()}
                disabled={askBusy}
                aria-label={`Clear the input request for ${awaitingName}`}
                style={{ background: "transparent", border: "none", color: awaitingTint.fg, cursor: "pointer", fontSize: 13, padding: "0 4px", opacity: askBusy ? 0.5 : 1 }}
              >
                ✕
              </button>
            </span>
          ) : null}
          {/* Content pillar picker (Nikki's lab, 2026-08-12): file the post
              under a pillar to categorise it, or make a new one. Was the
              read-only chip (ticket 74b7d901 made this foot the one place the
              tag lives, which still holds); now a FootPopover to select or
              create, like the channel picker. */}
          <span style={{ ...capsLabel, fontSize: capsFz(), letterSpacing: ".08em" }}>Content pillar</span>
          <FootPopover
            ariaLabel="Set the content pillar"
            title="Content pillar"
            triggerStyle={{ display: "inline-flex", alignItems: "center", gap: 7, maxWidth: 200, background: "var(--field)", border: "1px solid var(--hairline)", borderRadius: "var(--r-pill)", padding: "4px 11px", cursor: "pointer" }}
            trigger={
              <>
                <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: pillar ? (pillarDot ?? "var(--text-muted-2)") : "transparent", border: pillar ? "none" : "1px solid var(--border)", flexShrink: 0 }} />
                <span style={{ ...capsLabel, fontSize: capsFz(), color: pillar ? "var(--text-muted)" : "var(--text-muted-2)", letterSpacing: ".06em", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pillar ? pillar.name : "Set pillar"}
                </span>
              </>
            }
          >
            {(close) => (
              <div style={{ display: "flex", flexDirection: "column", minWidth: 208, maxWidth: 260 }}>
                <div style={{ ...capsLabel, fontSize: 12.5, color: "var(--text-muted-2)", padding: "2px 10px 6px" }}>File under a pillar</div>
                <div style={{ display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "auto" }}>
                  {pillarChoices.map((p) => {
                    const on = p.id === (item.pillar_id ?? null);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { void selectPillar(p.id); close(); }}
                        style={{ display: "flex", alignItems: "center", gap: 8, background: on ? "var(--field)" : "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: "7px 10px", borderRadius: 8, color: "var(--text)" }}
                      >
                        <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: pillarColorOf(p) ?? "var(--text-muted-2)", flexShrink: 0 }} />
                        <span style={{ fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.name}</span>
                        {on && <span aria-hidden style={{ color: "var(--accent)", fontSize: 13 }}>✓</span>}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => { void selectPillar(null); close(); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: "7px 10px", borderRadius: 8, color: "var(--text-muted)" }}
                  >
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", border: "1px solid var(--border)", flexShrink: 0 }} />
                    <span style={{ fontSize: 13 }}>No pillar</span>
                    {item.pillar_id == null && <span aria-hidden style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 13 }}>✓</span>}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 6, padding: "8px 8px 4px", borderTop: "1px solid var(--divider)", marginTop: 4 }}>
                  <input
                    value={pillarDraft}
                    onChange={(e) => setPillarDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void createPillar(close); }}
                    placeholder="New pillar"
                    disabled={pillarBusy}
                    style={{ flex: 1, minWidth: 0, height: 30, padding: "0 9px", fontSize: 13, background: "var(--field)", border: "1px solid var(--hairline)", borderRadius: 8, color: "var(--text)" }}
                  />
                  <button
                    type="button"
                    onClick={() => void createPillar(close)}
                    disabled={pillarBusy || !pillarDraft.trim()}
                    style={{ flex: "none", height: 30, padding: "0 12px", fontSize: 13, fontWeight: 500, borderRadius: 8, border: "none", cursor: pillarDraft.trim() ? "pointer" : "default", background: "var(--btn-primary)", color: "var(--btn-primary-text)", opacity: pillarDraft.trim() && !pillarBusy ? 1 : 0.5 }}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </FootPopover>
          {/* The Event category picker left this rail with ticket 0045391d
              (Mia: "remove event from filters on the post mock up view"):
              event_category stays on the row and adding posts within an
              event still lives where it always did, the pill just no longer
              rides the post view's filter band. */}
          <span aria-hidden style={{ width: 1, height: 18, background: "var(--divider)", margin: "0 2px" }} />
          {/* CHANNEL cluster: selected channels as tinted icon chips, the
              plus popover to toggle the set, the medium as one glyph chip. */}
          <span style={{ ...capsLabel, fontSize: capsFz(), letterSpacing: ".08em" }}>Channel</span>
          {channels.map((c) => (
            <button
              key={c}
              type="button"
              disabled={rowBusy}
              onClick={() => void toggleChannel(c)}
              title={`${CHANNEL_LABELS[c]}. Click to remove.`}
              aria-label={`Remove ${CHANNEL_LABELS[c]}`}
              style={{ ...channelChipStyle(c), opacity: rowBusy ? 0.6 : 1 }}
            >
              <ChannelGlyph c={c} />
            </button>
          ))}
          <FootPopover
            ariaLabel="Add or remove channels"
            title="Add or remove channels"
            triggerStyle={{ width: 26, height: 26, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px dashed var(--border)", color: "var(--text-muted)" }}
            trigger={<svg {...GLYPH} width={13} height={13} aria-hidden><path d="M12 5v14M5 12h14" /></svg>}
          >
            {() =>
              // Multi-select, so toggling never calls close: the card stays
              // put while a post is planned onto several channels at once.
              POST_CHANNELS.map((c) => {
                const on = channels.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    disabled={rowBusy}
                    onClick={() => void toggleChannel(c)}
                    style={{ ...menuItemStyle(on), opacity: rowBusy ? 0.6 : 1 }}
                  >
                    <span aria-hidden style={{ ...channelChipStyle(c), width: 22, height: 22, cursor: "inherit" }}>
                      <ChannelGlyph c={c} size={12} />
                    </span>
                    <span style={{ flex: 1 }}>{CHANNEL_LABELS[c]}</span>
                    {on && <svg {...GLYPH} width={13} height={13} aria-hidden><path d="m5 13 4.5 4.5L19 7" /></svg>}
                  </button>
                );
              })
            }
          </FootPopover>
          <span aria-hidden style={{ width: 1, height: 18, background: "var(--divider)", margin: "0 2px" }} />
          {/* ACCOUNT cluster (Nikki, ticket 8003f057): which handles the post
              goes out on. The lit chips toggle off; the plus lists the
              suggestions and takes a new handle typed in. */}
          <span style={{ ...capsLabel, fontSize: capsFz(), letterSpacing: ".08em" }}>Account</span>
          {accounts.map((a) => (
            <button
              key={a}
              type="button"
              disabled={rowBusy}
              onClick={() => toggleAccount(a)}
              title={`@${a}. Click to remove.`}
              aria-label={`Remove @${a}`}
              style={{ ...pillStyle(true), opacity: rowBusy ? 0.6 : 1 }}
            >
              @{a}
            </button>
          ))}
          <FootPopover
            ariaLabel="Add or remove accounts"
            title="Add or remove accounts"
            triggerStyle={{ width: 26, height: 26, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, borderRadius: 8, cursor: "pointer", background: "transparent", border: "1px dashed var(--border)", color: "var(--text-muted)" }}
            trigger={<svg {...GLYPH} width={13} height={13} aria-hidden><path d="M12 5v14M5 12h14" /></svg>}
          >
            {() => (
              <>
                {Array.from(new Set<string>([...POST_ACCOUNT_SUGGESTIONS, ...accounts])).map((a) => {
                  const on = accounts.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      disabled={rowBusy}
                      onClick={() => toggleAccount(a)}
                      style={{ ...menuItemStyle(on), opacity: rowBusy ? 0.6 : 1 }}
                    >
                      <span style={{ flex: 1 }}>@{a}</span>
                      {on && <svg {...GLYPH} width={13} height={13} aria-hidden><path d="m5 13 4.5 4.5L19 7" /></svg>}
                    </button>
                  );
                })}
                <div style={{ padding: "6px 8px 4px", borderTop: "1px solid var(--divider)", marginTop: 4 }}>
                  <input
                    value={accountDraft}
                    maxLength={60}
                    disabled={rowBusy}
                    placeholder="Another account, then Enter"
                    aria-label="Add an account"
                    onChange={(e) => setAccountDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAccount(); } }}
                    style={{ width: 200, height: 28, background: "var(--field)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px", fontSize: 12.5, color: "var(--text)", fontFamily: "inherit" }}
                  />
                </div>
              </>
            )}
          </FootPopover>
          <FootPopover
            ariaLabel={medium ? `Medium: ${MEDIUM_LABELS[medium]}. Change the medium` : "Set the medium"}
            title={medium ? `Medium: ${MEDIUM_LABELS[medium]}` : "Set the medium (paid, email marketing or organic social)"}
            disabled={rowBusy}
            triggerStyle={{ ...pillStyle(false), display: "inline-flex", alignItems: "center", gap: 6, opacity: rowBusy ? 0.6 : 1, ...(medium ? {} : { borderStyle: "dashed", background: "transparent" }) }}
            trigger={
              medium ? (
                <>
                  <MediumGlyph m={medium} size={13} />
                  {MEDIUM_LABELS[medium]}
                </>
              ) : (
                "Medium"
              )
            }
          >
            {(close) =>
              POST_MEDIUMS.map((m) => {
                const on = medium === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    disabled={rowBusy}
                    title={on ? "Click to clear the medium" : undefined}
                    onClick={() => {
                      close();
                      void clickMedium(m);
                    }}
                    style={menuItemStyle(on)}
                  >
                    <MediumGlyph m={m} size={13} />
                    <span style={{ flex: 1 }}>{MEDIUM_LABELS[m]}</span>
                    {on && <svg {...GLYPH} width={13} height={13} aria-hidden><path d="m5 13 4.5 4.5L19 7" /></svg>}
                  </button>
                );
              })
            }
          </FootPopover>
          <span style={{ flex: 1 }} />
          <span aria-label={`Slide ${number}`} style={{ fontFamily: MONO, fontSize: capsFz(13), fontWeight: 500, letterSpacing: ".08em", color: "var(--text-muted-2)", alignSelf: "flex-end" }}>
            {String(number).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* The comments panel over the slide (ticket c909e86c): toggled by the
          Comments button that took Suggest-an-edit's spot. Always mounted so
          the panel owns its own open/closed presentation. */}
      <CommentsPanel itemId={item.id} open={commentsOpen && Boolean(showComments)} onClose={() => setCommentsOpen(false)} />

      {/* The artboard editor as a popup OVER the slide (ticket 07e8115a): the
          SAME Mock-ups board (zone 'mockups'), centred on this post's frame,
          so the copy deck stays open beneath and drawing flows through the
          board's own autosave and API path. Closing refetches (onChange) so
          the slide's storyboard render catches the edit. position fixed, so
          the sheet's overflow:hidden cannot clip it; it stays visible in
          fullscreen too because it is a descendant of the fullscreened pane. */}
      {/* THE DESIGN TOOL. Its own document, its own row: a save here reaches
          this post and nothing else, which is the other half of leaving a
          shared canvas where one bad write was everybody's work. */}
      {editingArtboard && !onTheBoard && (
        <>
          <ArtboardDesigner
            itemId={item.id}
            title={item.title ?? undefined}
            onClose={() => closeArtboardEditor()}
            nav={
              artboardNav
                ? {
                    hasPrev: artboardNav.hasPrev,
                    hasNext: artboardNav.hasNext,
                    // Moving on is closing this one (which refreshes the
                    // slide behind it) and opening the next post's.
                    onPrev: () => { closeArtboardEditor(); artboardNav.step(-1); },
                    onNext: () => { closeArtboardEditor(); artboardNav.step(1); },
                  }
                : undefined
            }
          />
          <button
            type="button"
            onClick={() => setOnTheBoard(true)}
            title="Open this post's frames on the old whiteboard"
            className="btn-ghost-pill"
            style={{ position: "fixed", left: 14, bottom: 58, zIndex: 98, height: 28, padding: "0 12px", fontSize: 12.5, background: "var(--card)" }}
          >
            Open on the board
          </button>

        </>
      )}

      {editingArtboard && onTheBoard && boardFrameId && (
        <>
          {/* The canvas IS the workspace, full-bleed on a grey ground (Mia,
              2026-09-10: "just a canvas sitting on a greyed out background vs.
              the artboard sitting within an additional workspace pop up... not
              framed by another white box"). No inner card, no header band;
              the editor's own toolbar sits at the top and a single floating ✕
              closes it. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit artboard"
            style={{
              position: "fixed",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              zIndex: 96,
              background: "var(--rail)",
            }}
          >
            <button
              type="button"
              onClick={() => setOnTheBoard(false)}
              aria-label="Back to the artboard designer"
              title="Back to the designer"
              style={{ position: "fixed", top: 12, right: 14, zIndex: 98, background: "var(--card)", border: "1px solid var(--hairline)", boxShadow: "var(--shadow-card)", color: "var(--text)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              ✕
            </button>
            {/* Isolated to THIS post's artboard (Mia, 2026-09-18: "the only
                artboard that should be visible are the ones connected to the
                actual slide"), with New page moved in here off the copy
                slide. The board MASKS everything else rather than filtering
                it, so the document underneath stays whole and a save from
                this view can never write a smaller board than it read. */}
            <ArtboardEditor
              zone="mockups"
              focusFrameId={shownBoardId ?? boardFrameId}
              isolateFrameIds={carouselFrameIds}
              onNewPage={() => void addArtboardPage()}
              newPageBusy={pagingBusy}
              /* Applying a template longer than this post: make the pages it
                 needs, one at a time and in order, awaiting each so the board
                 has really come back with it before the next is asked for.
                 Sequential on purpose: each add flushes, writes and re-reads
                 the same row, and firing them together would have them landing
                 on each other. */
              onEnsurePages={async (needed) => {
                for (let i = 0; i < needed; i += 1) await addArtboardPage();
              }}
              flushSignal={flushSignal}
              onFlushed={() => {
                const waiting = flushWaiter.current;
                flushWaiter.current = null;
                waiting?.();
              }}
              reloadSignal={reloadSignal}
            />
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Twin of PostComposer's timeAgo (the twins rule in the file header): relative
 * stamps computed at render, no ticking interval, a plain date past a week.
 */
function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** @tokens in a comment body wear the accent (the Google-Slides read). A
 *  display convention only: the SERVER matched the real names at POST time,
 *  so this colours what the author typed rather than re-deciding who was
 *  tagged. Strings ride the array unkeyed on purpose, only elements key. */
function mentionSpans(body: string): React.ReactNode[] {
  return body.split(/(@[A-Za-z0-9._-]+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} style={{ color: "var(--accent)", fontWeight: 600 }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * The slide's discussion (Mia, 12 Aug: "be able to tag nikki in it and add an
 * action on it. maybe thats a comment like in google slides"): the SAME
 * content_comments thread the calendar composer already shows (0063 + 0081,
 * one post one discussion), raised onto the slide face because the Copy-link
 * share lands its reader HERE. @first-name mentions are matched server-side
 * against the team and email the tagged person through the task-comment path
 * with post words; "Add as action" files the comment onto the Tasks board
 * too, and the confirmation line only speaks when the response's
 * action_task_id proves the server really did (the checkbox fails soft).
 * Mention autocomplete is deliberately absent this pass: typing @nikki
 * plainly is the contract. Fetch on mount (keyed-by-id remount per slide)
 * plus refetch-after-write, the PostComposer thread posture; the list owns
 * its scroll (the files-list rule), so a long thread can never grow the
 * fixed sheet, and the whole section is a collapsed details like First
 * comment above it, so the no-scroll maths only pay while it is open.
 */
function SlideComments({
  itemId,
  fz,
  capsFz,
}: {
  itemId: string;
  fz: (n: number) => number;
  capsFz: (n?: number) => number;
}) {
  const [comments, setComments] = useState<ContentComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [asAction, setAsAction] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Lit only by a response whose action_task_id is real; typing clears it so
  // the line always describes the LAST post, never a stale one.
  const [actionNote, setActionNote] = useState(false);

  // Posting can settle after a page turn unmounts this slide; the PostSlide
  // aliveRef posture.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/content/${itemId}/comments`, { cache: "no-store" });
      const body: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!res.ok) {
        setErr(readErrorMessage(body) ?? "The comments didn't load. Try again.");
        return;
      }
      const list = (body as { data?: ContentComment[] } | null)?.data;
      if (Array.isArray(list)) {
        setErr(null);
        setComments(list);
      }
    } catch {
      if (aliveRef.current) setErr("The comments didn't load. Check your connection and try again.");
    }
  }, [itemId]);
  useEffect(() => {
    // The IIFE keeps the analyzer sure no setState runs before the await (the
    // deck's loadSections shape); aliveRef covers the unmount race.
    (async () => {
      await load();
    })();
  }, [load]);

  const post = useCallback(async () => {
    const clean = draft.trim();
    if (!clean || busy) return;
    setBusy(true);
    setActionNote(false);
    try {
      const res = await fetch(`/api/v1/content/${itemId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: clean, asAction }),
      });
      const resBody: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!res.ok) {
        setErr(readErrorMessage(resBody) ?? "The comment could not be posted. Try again.");
        return;
      }
      setErr(null);
      setDraft("");
      setAsAction(false);
      if (typeof (resBody as { action_task_id?: unknown } | null)?.action_task_id === "string") {
        setActionNote(true);
      }
      // Await the refetch so busy holds until the comment is visibly in the
      // thread (the composer's postComment reasoning).
      await load();
    } catch {
      if (aliveRef.current) setErr("The request didn't reach the server. Check your connection and try again.");
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [draft, busy, asAction, itemId, load]);

  const count = comments?.length ?? 0;
  return (
    <details style={{ flex: "none" }}>
      <summary style={{ ...capsLabel, fontSize: capsFz(), cursor: "pointer", listStyle: "none", color: "var(--text-muted)" }}>
        Comments{count > 0 ? ` (${count})` : ""}
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
        {comments === null ? (
          !err && <div style={{ fontSize: fz(12.5), color: "var(--text-muted)" }}>Loading the comments...</div>
        ) : comments.length === 0 ? (
          <div style={{ fontSize: fz(12.5), color: "var(--text-muted)" }}>No comments yet. @mention Nikki to pull her in.</div>
        ) : (
          <div style={{ maxHeight: fz(150), overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {comments.map((c) => (
              <div
                key={c.id}
                style={{ flex: "none", background: "var(--field)", border: "1px solid var(--hairline)", borderRadius: "var(--r-chip)", padding: "6px 9px", opacity: c.resolved_at ? 0.62 : 1 }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: fz(12.5), fontWeight: 600, color: "var(--text)" }}>{c.author_name ?? "Former teammate"}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, color: "var(--text-muted-2)" }}>{timeAgo(c.created_at)}</span>
                </div>
                <div style={{ fontSize: fz(13), lineHeight: 1.5, color: "var(--text)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 2 }}>
                  {mentionSpans(c.body)}
                </div>
              </div>
            ))}
          </div>
        )}
        {err && (
          <div role="alert" style={{ color: "var(--danger)", fontSize: 12.5 }}>{err}</div>
        )}
        {actionNote && (
          <div role="status" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Filed on the Tasks board.</div>
        )}
        <input
          value={draft}
          maxLength={4000}
          onChange={(e) => {
            setDraft(e.target.value);
            if (actionNote) setActionNote(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void post();
            }
          }}
          placeholder="Write a comment. @nikki tags a teammate"
          aria-label="Write a comment"
          style={{ ...fieldInput, fontSize: fz(13) }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={asAction} onChange={(e) => setAsAction(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
            Add as action
          </label>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void post()}
            disabled={busy || !draft.trim()}
            className="btn-ghost-pill"
            style={{ flex: "none", height: 26, padding: "0 12px", fontSize: 12.5, color: "var(--text)", opacity: busy || !draft.trim() ? 0.6 : 1 }}
          >
            {busy ? "Posting..." : "Comment"}
          </button>
        </div>
      </div>
    </details>
  );
}
