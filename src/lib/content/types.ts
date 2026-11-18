import type { CaptionSuggestion } from "@/lib/content/caption-suggest";

/**
 * Marketing > Content (Mia, 2026-07-16). Shared contract for the board, the
 * calendar tab and the browser extension, so all three agree on one shape.
 */

/** 'card' = an idea (usually an image). 'section' = a mindmap frame drawn behind
 *  cards. 'note' = text only. 'text' and 'shape' are canvas furniture; their
 *  column conventions are documented at SHAPE_VARIANTS below. */
export const CONTENT_KINDS = ["card", "section", "note", "text", "shape"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const CONTENT_SOURCES = ["pinterest", "instagram", "manual", "upload", "web"] as const;
export type ContentSource = (typeof CONTENT_SOURCES)[number];

/**
 * Channels a post can be planned for (Mia, 2026-07-21: the calendar's Add post
 * composer). The COLUMN (post_channel, migration 0061) is unconstrained text on
 * purpose, same reasoning as `kind` above: adding a channel is an edit to this
 * list and never DDL. So unlike SECTION_COLORS this is NOT a hard allow-list at
 * the database, it is the set the UI offers and the API accepts today; renderers
 * should still treat the column as ordinary text and fall back for values this
 * build has never heard of, exactly the isShapeVariant() posture below.
 *
 * MULTI-CHANNEL (Mia, 2026-07-22, migration 0065): post_channels text[] is the
 * SET a post is planned for; post_channel stays as its first member (or null),
 * dual-written by the composer so every reader built against the scalar keeps
 * working. Readers should prefer the array and fall back to the scalar for
 * rows written before the dual-write existed.
 */
export const POST_CHANNELS = ["instagram", "tiktok", "linkedin", "email", "website", "other"] as const;
export type PostChannel = (typeof POST_CHANNELS)[number];

/**
 * ACCOUNTS a post goes out on (Nikki, ticket 8003f057): the handles, offered
 * as suggestions and kept as free text, because a new account should not
 * need a deploy. Multi-select: one post can go out on two accounts.
 */
export const POST_ACCOUNT_SUGGESTIONS = ["cometogether_official", "cometogether_studio", "nikki_chadwick"] as const;

/**
 * One colour identity per channel (Mia, 2026-07-22: "colour coded / visual
 * iconicised"), SHARED by the Calendar's channel filter chips and the Post
 * deck's icon chips so the two views can never drift apart. Brand-adjacent
 * hexes rather than theme tokens on purpose, the SECTION_COLORS posture: a
 * channel's colour is its identity in both modes, and every renderer
 * color-mixes it into theme surfaces so it stays legible in light and dark.
 * Keyed on PostChannel so adding a channel is a compile error here; unknown
 * column values never reach the map because isPostChannel gates every render.
 */
export const CHANNEL_TINTS: Record<PostChannel, string> = {
  instagram: "#C13584",
  tiktok: "#12A5C9",
  linkedin: "#0A66C2",
  email: "#F0810F",
  website: "#0E9F6E",
  other: "#64748B",
};

/**
 * Status lifecycle (Mia, 2026-07-22: the workflow layer, migration 0063). The
 * COLUMN is unconstrained text with default 'idea', the same posture as `kind`
 * and `post_channel` above: this list is the contract, adding a stage is an
 * edit here and never DDL, and renderers fall back for values they have never
 * heard of.
 *
 * LIFECYCLE RULE: moving an item to 'scheduled' or 'posted' requires the
 * item's LATEST approval row (content_approvals, newest requested_at) to carry
 * decision 'approved'. Enforced at the API (the item PATCH answers 422
 * approval_required otherwise) and surfaced in the UI, which should disable or
 * explain those two options until an approval has landed. The other statuses
 * move freely in any order; the lifecycle is a checklist, not a state machine.
 */
export const CONTENT_STATUSES = ["idea", "drafting", "in_review", "approved", "scheduled", "posted"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** UI copy for each status. Plain words, no dashes. */
export const STATUS_LABELS: Record<ContentStatus, string> = {
  idea: "Idea",
  drafting: "Drafting",
  in_review: "In review",
  approved: "Approved",
  scheduled: "Scheduled",
  posted: "Posted",
};

/**
 * What a decided approval can say. Null on the row while the request is still
 * open. Contract-enforced like CONTENT_STATUSES; the column is plain text.
 */
export const APPROVAL_DECISIONS = ["approved", "changes_requested"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/**
 * The medium a post runs as (Mia, 2026-07-22: the Post deck, migration 0067).
 * The COLUMN (post_medium) is unconstrained text, the same posture as `kind`,
 * `post_channel` and `status` above: this list is the contract, adding a medium
 * is an edit here and never DDL, and renderers gate with isPostMedium().
 */
export const POST_MEDIUMS = ["paid", "email", "organic"] as const;
export type PostMedium = (typeof POST_MEDIUMS)[number];

/** UI copy for each medium. Plain words, no dashes. */
export const MEDIUM_LABELS: Record<PostMedium, string> = {
  paid: "Paid",
  email: "Email",
  organic: "Organic social",
};

/**
 * THE DECK'S SLIDE-STATUS VOCABULARY (Mia, 2026-07-22) is DERIVED, not stored.
 * Mia's words are WIP / Awaiting Mia input / Awaiting Nikki input / Approved /
 * Scheduled / Live, and they map onto what the item already carries:
 *
 *   WIP        = status 'idea' or 'drafting' (and the fallback for any status
 *                without a deck word of its own, e.g. 'in_review': it is still
 *                work in progress until an approval lands).
 *   Awaiting X = input_needed_from is set; X is that user's name and
 *                input_needed_what says what they are being asked for. This is
 *                an OVERLAY on top of the status, not a status: the post keeps
 *                its lifecycle stage while it waits, and clearing the request
 *                never has to guess which stage to restore.
 *   Approved   = status 'approved'.
 *   Scheduled  = status 'scheduled'.
 *   Live       = status 'posted'. Mia's deck word "Live" IS the existing
 *                'posted' status; there is no separate 'live' value, so
 *                nothing here widens CONTENT_STATUSES.
 *
 * No new status column, no new enum: the deck reads status + the input_needed
 * overlay and renders the word. STATUS_LABELS stays the board's vocabulary.
 */

export interface ContentItem {
  id: string;
  region_id: string;
  kind: ContentKind;
  title: string | null;
  note: string | null;
  image_url: string | null;
  source_url: string | null;
  source: ContentSource;
  /** Canvas geometry, in board coordinates (not screen pixels). */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  color: string | null;
  /** YYYY-MM-DD, or null while the idea is unscheduled. Drives the Calendar tab. */
  scheduled_for: string | null;
  /** Workflow stage (migration 0063). Defaults to 'idea'; see the LIFECYCLE
   *  RULE at CONTENT_STATUSES before offering 'scheduled' or 'posted'. */
  status: ContentStatus;
  /** The content pillar this item is filed under, or null for none. */
  pillar_id: string | null;
  /** Which side of the business the post speaks to (Nikki, 2026-08-12,
   *  migration 0082), set in the deck beside the pillar. Plain text gated by
   *  isEventCategory(), null for none. See CONTENT_EVENT_CATEGORIES. */
  event_category: string | null;
  /** The ONE open caption suggested edit (Nikki, 2026-08-12, migration 0082),
   *  or null. jsonb on the row rather than a table because a post carries at
   *  most one open proposal and accept/dismiss both clear it; readers hydrate
   *  through readCaptionSuggestion(), the isPostChannel posture, because the
   *  column is ordinary storage. See @/lib/content/caption-suggest. */
  caption_suggestion: CaptionSuggestion | null;
  /** Instagram first comment (the hashtag stash). Capped at 2200 chars,
   *  Instagram's own limit. */
  post_first_comment: string | null;
  /** Planned-post fields (migration 0061, the calendar's Add post composer).
   *  All null / empty on a plain board card; the scalars are nullable columns
   *  and the arrays are `not null default '{}'`, so they are non-null here. */
  post_channel: string | null;
  /** The full channel set (migration 0065); post_channel mirrors its first
   *  member for old readers. Members are ordinary text like the scalar, so
   *  renderers gate each one with isPostChannel(). */
  post_channels: string[];
  post_concept: string | null;
  post_copy: string | null;
  /** Per-channel copy OVERRIDES (migration 0069, Mia, 2026-07-22: "different
   *  tabs for channel platform copy"): channel -> the copy that channel runs
   *  INSTEAD of post_copy. post_copy stays the CANONICAL copy (the deck's
   *  first selected channel edits it directly); a channel absent here simply
   *  runs the canonical. Keys are ordinary text in jsonb, the post_channels
   *  posture, so readers gate each with isPostChannel(); an entry for a
   *  channel no longer in post_channels is a harmless stash that returns if
   *  the channel is re-added. The column is `not null default '{}'`, so the
   *  map is non-null here. */
  post_copy_channels: Record<string, string>;
  post_links: string[];
  post_images: string[];
  /** Media used (migration 0132, ticket 972a9ea8): the source images and
   *  video Nikki needs to make the work, downloadable at full resolution. */
  source_media: SourceMedia[];
  post_tags: string[];
  /** Account handles the post goes out on (migration 0134, ticket 8003f057). */
  post_accounts: string[];
  /** Post deck fields (migration 0067). post_medium is ordinary text narrowed
   *  by POST_MEDIUMS at the API; renderers gate with isPostMedium(). */
  post_medium: string | null;
  /** The "Awaiting X input" overlay (see the slide-status comment above):
   *  who is being asked, joined name for the chip, and what is needed. */
  input_needed_from: string | null;
  /** Joined from users by the API (the created_by_name pattern); null when
   *  nobody is being asked or the account is gone. */
  input_needed_from_name: string | null;
  input_needed_what: string | null;
  /** The task the input request auto-created in /tasks. SERVER-MANAGED: only
   *  the input-request endpoint writes it (so a tag and its task move
   *  together); it is read-only to clients and absent from ContentItemInput. */
  input_task_id: string | null;
  /** The Excalidraw FRAME element on the content board that is this post's
   *  ideation artboard (migration 0068), or null before the board has made
   *  one. An OPAQUE element id into the board's jsonb snapshot, NOT a FK:
   *  the frame is not a row anywhere. An id that no longer resolves to a
   *  live frame just means someone deleted the frame on the board; the
   *  board's reconcile pass recreates it and rewrites this field on the
   *  next load. Deleting the post never deletes the frame (the ideation
   *  work survives on the canvas), so a dangling id dies with the row. */
  board_frame_id: string | null;
  /** The clip library folder this item is filed in (migration 0071), or null
   *  for unfiled. A plain label, not a FK: a folder exists while a clip
   *  carries its name (see the migration's reasoning). Capped at 60 chars by
   *  the API; renderers trim and treat blank as unfiled. */
  clip_folder: string | null;
  /** The content plan this item belongs to (migration 0085), or null for a
   *  free-standing item. Members of a plan slide together when the plan's
   *  event date moves (see ContentPlan). ON DELETE SET NULL at the database:
   *  deleting the plan un-groups the item, never deletes it. */
  plan_id: string | null;
  /** What a plan item IS (Mia's taxonomy, migration 0085): 'post',
   *  'newsletter' or 'reminder'. Plain text gated by isPlanRole(), the
   *  event_category posture: the list is fixed by the taxonomy, so it carries
   *  a DB CHECK as well as the PLAN_ROLES enum at the API. Null reads as an
   *  ordinary post. */
  plan_role: string | null;
  created_by: string | null;
  /** Joined from users by the API (the ContentComment author_name pattern);
   *  null when the creator's account is gone or the row predates accounts. */
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

/** What a client may send. Server owns id, region_id, created_by and timestamps. */
export type ContentItemInput = Partial<
  Pick<
    ContentItem,
    | "kind"
    | "title"
    | "note"
    | "image_url"
    | "source_url"
    | "source"
    | "x"
    | "y"
    | "w"
    | "h"
    | "z"
    | "color"
    | "scheduled_for"
    | "status"
    | "pillar_id"
    | "event_category"
    | "caption_suggestion"
    | "post_first_comment"
    | "post_channel"
    | "post_channels"
    | "post_concept"
    | "post_copy"
    | "post_copy_channels"
    | "post_links"
    | "post_images"
    | "source_media"
    | "post_tags"
    | "post_accounts"
    | "post_medium"
    | "input_needed_from"
    | "input_needed_what"
    | "board_frame_id"
    | "clip_folder"
    | "plan_id"
    | "plan_role"
  >
>;

/** One Media used file: where it is, and what it was called when uploaded. */
export interface SourceMedia {
  url: string;
  name: string;
}

/** Default tile size for a freshly clipped or created card. */
export const CARD_W = 220;
export const CARD_H = 220;
/** A new mindmap section starts big enough to drop a few cards into. */
export const SECTION_W = 640;
export const SECTION_H = 460;

/** Section tints. Deliberately muted so the imagery stays the loudest thing on
 *  the board. Kept as an allow-list so a stray value can't inject a style. */
export const SECTION_COLORS = ["#2F6FEB", "#7A5AF8", "#0E9F6E", "#F0810F", "#E5484D", "#64748B"] as const;

/**
 * The 'text' and 'shape' kinds reuse existing columns instead of adding new
 * ones. content_items.kind is unconstrained text (migration 0057: no CHECK, no
 * enum), so introducing a kind is purely a contract change here, never a
 * migration. The reuse convention, so nobody goes hunting for a column that
 * does not exist:
 *
 *   'text'  : a free-standing text block on the canvas. The text itself lives
 *             in `note` (same ceiling as every note) and its colour in `color`.
 *             title and image_url stay null.
 *   'shape' : a drawn shape. `note` holds the variant, exactly one of
 *             SHAPE_VARIANTS, and `color` is the fill.
 *
 * For shapes the variant decides which element gets rendered, so it is an
 * allow-list like SECTION_COLORS above: the API rejects anything else when a
 * payload names kind 'shape' (see contentInputSchema), and renderers should
 * still guard with isShapeVariant() and fall back rather than trust the column,
 * because in the database `note` is ordinary text.
 */
export const SHAPE_VARIANTS = ["rect", "ellipse"] as const;
export type ShapeVariant = (typeof SHAPE_VARIANTS)[number];

/**
 * Content event category (Nikki, 2026-08-12, ported from her lab work): which
 * side of the business a post speaks to, set in the deck beside the pillar.
 * The three booking categories (studio / corporate / special_occasions, the
 * SAME values and fixed chip colours as the pipeline, Frosted design law) plus
 * evergreen for posts tied to no one event. A fixed list, not a table like
 * pillars: these mirror the pipeline's categories rather than being invented
 * per region, which is also why the column gets a CHECK constraint (0082)
 * where post_channel and status stay unconstrained.
 */
export const CONTENT_EVENT_CATEGORIES = [
  { value: "studio", label: "Studio", color: "#46CFE6" },
  { value: "corporate", label: "Corporate", color: "#5B7CFF" },
  { value: "special_occasions", label: "Special occasions", color: "#FF74C4" },
  { value: "evergreen", label: "Evergreen content", color: "#6E7B8B" },
] as const;
export type ContentEventCategory = (typeof CONTENT_EVENT_CATEGORIES)[number]["value"];
export const CONTENT_EVENT_CATEGORY_VALUES = CONTENT_EVENT_CATEGORIES.map((c) => c.value) as [
  ContentEventCategory,
  ...ContentEventCategory[],
];
export function isEventCategory(v: unknown): v is ContentEventCategory {
  return typeof v === "string" && CONTENT_EVENT_CATEGORIES.some((c) => c.value === v);
}
export function eventCategoryMeta(v: string | null): (typeof CONTENT_EVENT_CATEGORIES)[number] | null {
  return CONTENT_EVENT_CATEGORIES.find((c) => c.value === v) ?? null;
}

/**
 * Plan roles (Mia, 2026-08-15, migration 0085): what a plan item IS. 'post'
 * is a normal content post, 'newsletter' is newsletter copy, 'reminder' is a
 * milestone date or attendee-only email copy ("which we need in the calendar
 * as reminders, but no posts attached to them"). A fixed list like
 * CONTENT_EVENT_CATEGORIES, not a UI-editable set, which is why the column
 * gets a CHECK constraint (0085) where post_channel and status stay
 * unconstrained. Renderers gate the column with isPlanRole() and fall back to
 * the ordinary post treatment for anything unheard of.
 */
export const PLAN_ROLES = ["post", "newsletter", "reminder"] as const;
export type PlanRole = (typeof PLAN_ROLES)[number];

/** UI copy for each plan role. Plain words, no dashes. */
export const PLAN_ROLE_LABELS: Record<PlanRole, string> = {
  post: "Post",
  newsletter: "Newsletter",
  reminder: "Reminder",
};

export function isPlanRole(v: unknown): v is PlanRole {
  return typeof v === "string" && (PLAN_ROLES as readonly string[]).includes(v);
}

/**
 * A content plan (migration 0085): a named group of calendar items anchored
 * to ONE event date. The group is the point: when the event date moves, the
 * API shifts every dated member by the same day delta in a single update, so
 * the whole run slides and the relative spacing is preserved. Deleting a plan
 * only un-groups its items (plan_id nulls out via the FK); the posts and
 * their dates survive.
 *
 * item_count and scheduled_count are computed by the API on the list read
 * (they live on no column): scheduled_count is how many members actually
 * carry a date, i.e. how many rows a date move will shift, which is what the
 * management UI's preview line states before a PATCH.
 */
export interface ContentPlan {
  id: string;
  region_id: string | null;
  name: string;
  /** YYYY-MM-DD, a plain calendar day like scheduled_for. */
  event_date: string;
  /** The pillar this series belongs to (0105); members without one inherit it. */
  pillar_id: string | null;
  created_by: string | null;
  created_at: string;
  item_count: number;
  scheduled_count: number;
}

/**
 * A content pillar (migration 0063): a recurring theme posts are filed under.
 * Shared vocabulary, so it is a table, not a text tag: renaming a pillar
 * renames it everywhere at once. `color` is a SECTION_COLORS member (API
 * enforced); `archived_at` non-null means hidden from pickers but kept on the
 * posts that already reference it.
 */
export interface ContentPillar {
  id: string;
  region_id: string;
  name: string;
  color: string | null;
  description: string | null;
  sort: number;
  archived_at: string | null;
  created_at: string;
}

/**
 * A comment on a content item (migration 0063). `author_name` is joined from
 * users by the API (null when the author's account is gone); `resolved_at`
 * non-null means the thread point was marked handled, kept as a timestamp so
 * resolving remembers when.
 */
export interface ContentComment {
  id: string;
  item_id: string;
  region_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
  resolved_at: string | null;
}

/**
 * One approval request on a content item (migration 0063). A LOG row, not a
 * flag: `decision` is null while the request is open, then 'approved' or
 * 'changes_requested' once someone ELSE decides it (the API refuses
 * self-approval). The `*_name` fields are joined from users by the API. The
 * newest row by requested_at is the item's current approval state; see the
 * LIFECYCLE RULE at CONTENT_STATUSES.
 */
export interface ContentApproval {
  id: string;
  item_id: string;
  region_id: string;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision: ApprovalDecision | null;
  note: string | null;
}

/**
 * VIDEO CLIPS (Mia, 2026-07-22, ticket cf94bb9e). A video clip stores its URL
 * in image_url exactly like an image clip: same column, same routes, same
 * card. The renderer's way of knowing it holds a video is THIS helper, which
 * keys on the URL's file extension, and that choice over a media_kind column
 * is deliberate: every video URL the system can hold today carries its
 * extension (uploads get .mp4/.webm from the sniffer in
 * @/lib/content/image-store, and the extension only pins page videos whose
 * src is a direct http(s) media file, which on Pinterest/IG means an
 * extensioned CDN path; extensionless blob:/MSE streams are not pinnable and
 * fall back to the poster image). So a column would only ever restate what
 * the URL already says, while costing DDL, a CONTENT_COLUMNS bump and a 503
 * window. If an extensionless video source ever becomes pinnable, add the
 * column then and let this helper read it first.
 *
 * The list mirrors what the upload sniffer admits (mp4, webm) plus m4v/mov,
 * which are mp4-family files browsers play in a <video>; renderers that get
 * it wrong degrade to a broken thumb, never an injected anything, because
 * image_url stays http(s)-allow-listed either way.
 */
const VIDEO_EXTENSIONS = /\.(mp4|webm|m4v|mov)$/i;

export function isVideoUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    // pathname only, so a query string (signed CDN URLs) never hides or
    // fakes the extension.
    return VIDEO_EXTENSIONS.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

/**
 * MIRRORED CLIPS (2026-07-29). A clip whose bytes live in our own content-media
 * bucket, as opposed to one still pointing at the site it was clipped from.
 *
 * Why this matters enough to have a helper: Instagram serves SIGNED CDN URLs
 * that carry an `oe=` expiry and stop resolving about 4.5 days later ("URL
 * signature expired", HTTP 403). Every clip taken before the mirror landed is
 * therefore a card that renders for a few days and then rots. Renderers use
 * this to tell the two failure stories apart, which is the whole point: an
 * unmirrored clip that fails to load has EXPIRED and the remedy is to clip it
 * again, while a mirrored clip that fails to load is a genuine fault and
 * re-clipping would fix nothing. "Image unavailable" on both would send the
 * user to the wrong remedy in whichever case it was wrong for.
 *
 * Derived from the URL rather than stored in a column, and that is the same
 * call isVideoUrl documents right above: a mirrored URL is one this system
 * minted itself, so its shape is ours to rely on, and a column would restate
 * what the URL already says at the cost of DDL, a CONTENT_COLUMNS bump and a
 * 503 window. It also reads CORRECTLY for the rows that predate the mirror,
 * which a column defaulted at migration time would not: those rows are
 * genuinely unmirrored and this says so with no backfill.
 *
 * The match is on the bucket's object path, not on the project hostname, so it
 * holds across environments (local, preview, production) without threading an
 * env var into client components. That makes it spoofable by a remote URL that
 * mimics the path, which is fine because this is NEVER a trust decision: the
 * worst such a URL can earn is the wrong one of two failure captions, and it
 * is still http(s)-allow-listed by isHttpUrl like every other image_url.
 */
const MIRRORED_MEDIA_PATH = "/storage/v1/object/public/content-media/";

export function isMirroredMediaUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).pathname.startsWith(MIRRORED_MEDIA_PATH);
  } catch {
    return false;
  }
}

export function isContentKind(v: unknown): v is ContentKind {
  return typeof v === "string" && (CONTENT_KINDS as readonly string[]).includes(v);
}

export function isContentSource(v: unknown): v is ContentSource {
  return typeof v === "string" && (CONTENT_SOURCES as readonly string[]).includes(v);
}

/**
 * A board item is a PLANNED POST only when someone has said so, not merely
 * because it exists (tickets d30da879 + 8944d73d: "these are not unscheduled...
 * they are just images we pull inspiration from"). Clipped pins and dragged-in
 * images live on the Board as inspiration and must stay out of the Pipeline
 * kanban, the Post deck and the Calendar's unscheduled rail.
 *
 * Post intent means either the item was typed in by hand (source 'manual':
 * the Add post composer and board-made cards/notes) or ANY post signal has
 * been set on it: a date, a pillar, channels, concept/copy, a medium, tags or
 * an input request. A clip that Mia later schedules or fills in graduates to a
 * post automatically; until then it is inspiration.
 */
export function isPlannedPost(item: ContentItem): boolean {
  return (
    item.source === "manual" ||
    item.scheduled_for != null ||
    item.pillar_id != null ||
    item.post_channels.length > 0 ||
    item.post_channel != null ||
    item.post_concept != null ||
    item.post_copy != null ||
    item.post_medium != null ||
    item.post_tags.length > 0 ||
    item.input_needed_from != null ||
    item.status !== "idea"
  );
}

export function isPostChannel(v: unknown): v is PostChannel {
  return typeof v === "string" && (POST_CHANNELS as readonly string[]).includes(v);
}

export function isShapeVariant(v: unknown): v is ShapeVariant {
  return typeof v === "string" && (SHAPE_VARIANTS as readonly string[]).includes(v);
}

export function isContentStatus(v: unknown): v is ContentStatus {
  return typeof v === "string" && (CONTENT_STATUSES as readonly string[]).includes(v);
}

export function isApprovalDecision(v: unknown): v is ApprovalDecision {
  return typeof v === "string" && (APPROVAL_DECISIONS as readonly string[]).includes(v);
}

export function isPostMedium(v: unknown): v is PostMedium {
  return typeof v === "string" && (POST_MEDIUMS as readonly string[]).includes(v);
}
