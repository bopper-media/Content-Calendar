"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ViewHeader } from "@/components/app-shell/ViewHeader";
import { IgGrid } from "@/components/content/IgGrid";
import { ContentCalendar } from "@/components/content/ContentCalendar";
import { PillarsView } from "@/components/content/PillarsView";
import { PostDeck } from "@/components/content/PostDeck";
// Type only, so naming the board's surface union here costs no bundle: the
// component itself still arrives through the dynamic import below.
import {
  CHANNEL_TINTS,
  CONTENT_STATUSES,
  MEDIUM_LABELS,
  POST_CHANNELS,
  POST_MEDIUMS,
  STATUS_LABELS,
  isPlannedPost,
  isPostChannel,
  isPostMedium,
  type ContentItem,
  type ContentItemInput,
  type PostChannel,
} from "@/lib/content/types";

/**
 * The board is the Excalidraw engine now (ExcalidrawBoard): tldraw was
 * rejected over its post-trial licence cost, Excalidraw is MIT and free for
 * commercial use, and CanvasBoard.tsx stays on disk unimported as reference.
 * The engine is browser-only code (it touches window at import time), so
 * ssr:false from THIS client component is the sanctioned Next 16 pattern for
 * it. Module scope so the chunk is fetched once, not per render.
 */

/** The page is THREE top-level tabs now (ticket 84f0b047, Mia: "ideation
 *  should sit within the mockups section as a tab. not visible on the content
 *  nav page"): Ideation leaves the top strip and lives as a secondary tab
 *  INSIDE Mock-ups. The two canvas surfaces are still separate (ticket
 *  a0856f21), they just switch one level down. */
type Tab = "calendar" | "grid" | "pillars";
/** The secondary strip inside Mock-ups: which canvas surface is up. */

/** Per-surface copy (the PipelineView idea): the header describes what is
 *  actually on screen, ideation included even though it is no longer a
 *  top-level tab, because the header line follows the sub-tab too. */
const DESCRIPTIONS: Record<Tab, string> = {
  calendar:
    "When they ship. Every idea that has been given a date, on its date, as a month or a list. Click a scheduled post to open its slide.",
  grid:
    "How it lands. Your Instagram grid three across, with everything in the plan that is not posted yet laid over the top, newest first, so you can see a new post beside the ones it will sit next to.",
  pillars:
    "What they add up to. The recurring themes posts are filed under: manage the vocabulary, and check the last 30 days of work against the plan.",
};

/** The header line while select mode is up (ticket 96724b9a). */
const SELECT_DESCRIPTION =
  "Bulk edit. Tick the posts to change, then set their status, channels or medium in the action bar below, all in one go.";

export function ContentView({ initialItems }: { initialItems: ContentItem[] }) {
  // Calendar first and default (ticket e794511f): the everyday question is
  // "what ships when", so the page opens on it; the Board is the making
  // surface you step into deliberately.
  const [tab, setTab] = useState<Tab>("calendar");
  // Which canvas surface the Mock-ups tab shows (ticket 84f0b047). Sticky
  // across a visit elsewhere on purpose: leaving for the Calendar and coming
  // back should land where the work was left.
  // SELECT MODE (ticket 96724b9a, Mia: "make it so that we can multi select
  // posts and change their status, channel, etc."): while up, the Calendar
  // pane swaps for the selectable post list plus its bulk action bar.
  const [selecting, setSelecting] = useState(false);
  // The deck's View-artboard jump (Mia, 2026-07-22): the frame the Board
  // should centre on when it next mounts. Set together with the tab switch,
  // cleared when the board reports the focus consumed (or gave up on a
  // missing frame), so a later MANUAL visit to the Board never re-zooms.
  // THE DECK OVERLAY (the restructure spec): the id of the scheduled post the
  // deck should open staged on, null while the overlay is down. Set by
  // clicking a scheduled post in the Calendar (a day chip or a list row);
  // cleared by the deck's back affordances, by View artboard (which lands on
  // the Board instead), or by switching tabs, so the overlay can never sit
  // over a pane the user just asked for.
  const [deckItemId, setDeckItemId] = useState<string | null>(null);
  const openTab = useCallback((t: Tab) => {
    setDeckItemId(null);
    // Switching tabs stands select mode down too: it is a Calendar posture,
    // and re-entering the Calendar should show the calendar, not the picker.
    setSelecting(false);
    setTab(t);
  }, []);
  // The planning tabs' list. The canvas self-manages now (its document lives
  // in content_canvases and its clip library refetches /api/v1/content
  // itself), so items and refresh serve the Calendar and Pillars tabs and the
  // deck overlay; switching between them refetches nothing but stays live
  // through their own onChange edits.
  const [items, setItems] = useState(initialItems);

  // Handed to the planning tabs as onChange. Refetching the list (rather than
  // patching state locally) keeps the client honest about what the server
  // actually stored, which matters once the browser extension is clipping in
  // behind us.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/content");
      if (!res.ok) return;
      const j = (await res.json()) as { data?: ContentItem[] };
      if (Array.isArray(j?.data)) setItems(j.data);
    } catch {
      /* keep what is on screen on a failed refresh, the edit still applied */
    }
  }, []);

  // THE DEEP LINK (ticket e794511f): other pages (the Tasks agent's links)
  // point at /content?post=<id>, and this is the receiving side: read the
  // param once on mount, raise the deck overlay staged on that post, then
  // clean the URL via history.replaceState so refresh, back and copied links
  // do not re-open the deck later. window.location rather than
  // useSearchParams on purpose: the hook would demand a Suspense boundary
  // around the whole view for a one-shot read. A stale or wrong id degrades
  // safely, the deck stages its first slide when the id matches nothing
  // (PostDeck's stagedIndex derivation).
  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("post");
    if (!id) return;
    setDeckItemId(id);
    url.searchParams.delete("post");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);

  /** Which board surface is on screen, or null when the Mock-ups tab is not
   *  the lit one at all. Derived from tab + boardTab rather than tracked
   *  beside them, so the strip and the canvas can never disagree. */

  return (
    <>
      {/* PHONE (Nikki, 2026-09-21: "make the content page and everything within
          that mobile friendly"). The header's own half: the four tabs stay on
          ONE line (Mock-ups was breaking in two), Select moves down into the
          calendar's toolbar to leave them the room, the post opened from the
          calendar fills the whole screen with no margin to lose, and the
          canvas strip and the bulk-edit pane take the phone gutter. Each tab's
          own phone rules live in its own file. */}
      <style>{`
        @media (max-width: 720px) {
          .cv-head-actions { justify-content: flex-start !important; flex-wrap: nowrap !important; width: 100%; }
          .cv-tabs { flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; }
          .cv-tabs::-webkit-scrollbar { display: none; }
          .cv-tab { flex: 1 0 auto; padding: 7px 10px !important; letter-spacing: .04em !important; white-space: nowrap; }
          .cv-select-head[aria-pressed="false"] { display: none !important; }
          .cv-deck-dialog { inset: 0 !important; border: 0 !important; border-radius: 0 !important; }
          .cv-board-strip { padding: 8px 12px 6px !important; }
          .cv-select-pane { padding: 12px 12px 12px !important; }
          /* SELECT MODE's rows on a phone: one long line squeezed the title to
             "Ne..." and pushed the status off the screen. The title takes the
             first line beside the tick, and the date, channels, medium and
             status sit on a second line under it. */
          .cv-sel-row { position: relative; flex-wrap: wrap !important; row-gap: 4px !important; padding: 11px 12px 11px 40px !important; align-items: flex-start !important; }
          /* The tick hangs in the gutter, so every line of the row, however it wraps, starts under the title. */
          .cv-sel-row > span:first-child { position: absolute; left: 13px; top: 13px; }
          .cv-sel-title { order: 1; flex: 1 1 100% !important; white-space: normal !important; overflow-wrap: anywhere; line-height: 1.35; }
          .cv-sel-date { order: 2; flex: 0 0 auto !important; }
          .cv-sel-row > span:nth-child(n+4) { order: 3; flex: 0 0 auto !important; text-align: left !important; }
          /* The action bar's chips wrap to many rows on a phone; past half the
             screen it scrolls inside itself, so the list it acts on keeps room. */
          .cv-sel-actions { max-height: 46vh; overflow-y: auto; flex: none; }
        }
      `}</style>
      <ViewHeader
        crumb="Content"
        title="Content"
        // The deck overlay covers the header now (ticket 2afa5e36: it fills
        // the browser), so there is no deck line to show up here any more.
        description={tab === "calendar" && selecting ? SELECT_DESCRIPTION : DESCRIPTIONS[tab]}
        actions={
          // justify flex-end keeps the cluster hugging the RIGHT edge even
          // when it wraps at narrow widths.
          <div className="cv-head-actions" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
            <div className="frosted-chip cv-tabs" style={{ padding: 3, gap: 3 }}>
              {/* Calendar leads (ticket e794511f): the segment order matches
                  the default so the lit segment is the first one on open.
                  Ideation is no longer up here (ticket 84f0b047): it lives as
                  a secondary tab inside Mock-ups. */}
              <TabButton active={tab === "calendar"} onClick={() => openTab("calendar")}>Calendar</TabButton>
              <TabButton active={tab === "grid"} onClick={() => openTab("grid")}>Grid</TabButton>
              <TabButton active={tab === "pillars"} onClick={() => openTab("pillars")}>Pillars</TabButton>
            </div>
            {/* SELECT (ticket 96724b9a): a Calendar-only mode toggle. While
                the picker is up the pill goes primary and reads Done, the one
                way back out it needs. */}
            {tab === "calendar" && (
              <button
                // On a phone this pill only shows as Done: starting a selection
                // is the calendar toolbar's Select there (see the rules above).
                className={`${selecting ? "btn-primary-pill" : "btn-ghost-pill"} cv-select-head`}
                style={{ padding: "7px 15px" }}
                aria-pressed={selecting}
                onClick={() => {
                  setDeckItemId(null);
                  setSelecting((s) => !s);
                }}
              >
                {selecting ? "Done" : "Select"}
              </button>
            )}
          </div>
        }
      />
      {/* position:relative makes this pane the deck overlay's anchor: the
          overlay paints over whatever tab is underneath (which stays mounted,
          so closing the deck returns to it exactly as left). */}
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "calendar" && selecting ? (
          // SELECT MODE (ticket 96724b9a): the pane manages its own scroll
          // (list scrolls, action bar stays put), so it is not the plain
          // overflow:auto pane the other two get.
          <SelectPostsPane items={items} onChange={refresh} />
        ) : (
          // Calendar and Pillars are ordinary scrolling views, so they take the
          // standard pane padding every other view uses.
          <div className="view-pane" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 26px 26px" }}>
            {tab === "calendar" ? (
              <ContentCalendar
                items={items}
                onChange={refresh}
                onOpenDeck={setDeckItemId}
                onSelectPosts={() => {
                  setDeckItemId(null);
                  setSelecting(true);
                }}
              />
            ) : tab === "grid" ? (
              // The Grid owns its own padding (the tiles run to the edge of
              // their column), so it sits inside the pane rather than taking
              // the pane's own inset twice.
              <IgGrid items={items} />
            ) : (
              <PillarsView items={items} onChange={refresh} />
            )}
          </div>
        )}
        {/* THE DECK OVERLAY (the restructure spec): clicking a scheduled post,
            or starting a new one, opens its slide OVER the app. Opaque
            var(--canvas) because the deck is a full working surface, not a
            dialog; the underlying tab keeps its state and simply shows again
            when the deck closes. The deck owns its own layout (stage +
            filmstrip), the old deck-tab posture. The jump to Mock-ups that used to live
            here went with View artboard (Mia, 2026-09-18): the deck's one
            door to the canvas is Edit artboard, which opens over the slide.

            FIXED, NOT PANE-BOUND (ticket 2afa5e36, Nikki: "can this be a pop
            up that really filled the browser"): inset 12 puts it over the
            header and the rail too, keeping only enough margin to show what
            it is covering. z 94 sits under the composer's 95 (the two never
            share a screen, but if they ever did the small dialog belongs on
            top) and over the feedback bubble's 90. Escape still closes it,
            from the deck's own key handler; the margin doubles as the click
            target that dismisses it. */}
        {deckItemId && (
          <>
            <div
              aria-hidden
              onClick={() => setDeckItemId(null)}
              style={{ position: "fixed", inset: 0, zIndex: 93, background: "rgba(0, 0, 0, .45)" }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Post slide"
              className="cv-deck-dialog"
              style={{
                position: "fixed",
                inset: 12,
                zIndex: 94,
                background: "var(--canvas)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--r-lg)",
                boxShadow: "var(--shadow-panel)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <PostDeck
                items={items}
                onChange={refresh}
                initialItemId={deckItemId}
                onBack={() => setDeckItemId(null)}
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}

/* ================================================================== */
/* Select mode (ticket 96724b9a)                                       */
/* ================================================================== */

/** The calendar toolbar's merchant caps, shared by the picker's labels. */
const CAPS: React.CSSProperties = {
  fontFamily: "var(--font-merchant)",
  fontSize: 12.5,
  fontWeight: 500,
  letterSpacing: ".09em",
  textTransform: "uppercase",
  color: "var(--text-muted-2)",
};

/** Split by hand: new Date("2026-07-07") is parsed as UTC midnight and renders
 *  as the 6th west of Greenwich (the calendar's standing idiom). */
function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Channel labels, the ContentCalendar/PostDeck twin. Deliberately a local
 *  copy, the file's standing no-cross-dependency posture. */
const CHANNEL_LABELS: Record<PostChannel, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  email: "Email",
  website: "Website",
  other: "Other",
};

/**
 * The multi-select pane (ticket 96724b9a, Mia: "make it so that we can multi
 * select posts and change their status, channel, etc."). Every planned post as
 * one checkbox row, dated first in ship order then the undated tail (the
 * calendar list's own order), and a bulk action bar that appears once
 * anything is ticked.
 *
 * Writes go through the EXISTING per-item PATCH in a plain loop, one request
 * per selected post, no new endpoint: sequential on purpose so a refusal can
 * be counted and named while the rest still land. The one refusal worth
 * expecting is the lifecycle rule (CONTENT_STATUSES): 'scheduled' and
 * 'posted' 422 without an approved approval, and the server's own message is
 * shown for it rather than a paraphrase.
 *
 * Channels are a SET on the post, so they draft locally (toggle chips) and
 * land on an explicit Apply that REPLACES the selection's channel sets, with
 * the composer's dual-write (post_channel mirrors the first member). Status
 * and medium are single values and apply on click.
 */
function SelectPostsPane({ items, onChange }: { items: ContentItem[]; onChange: () => Promise<void> | void }) {
  const posts = useMemo(() => {
    // Same population as the calendar: cards and notes someone has declared a
    // post (isPlannedPost), never sections or canvas furniture, and clipped
    // inspiration stays out until it graduates.
    const planned = items.filter((i) => (i.kind === "card" || i.kind === "note") && isPlannedPost(i));
    const dated = planned
      .filter((i) => i.scheduled_for)
      .sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? "") || a.created_at.localeCompare(b.created_at));
    const undated = planned.filter((i) => !i.scheduled_for).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return [...dated, ...undated];
  }, [items]);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [chanDraft, setChanDraft] = useState<PostChannel[]>([]);

  const toggle = useCallback((id: string) => {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const applyToSelected = useCallback(
    async (input: ContentItemInput, did: string) => {
      // Walk `posts`, not the raw set: a selected id whose row vanished in a
      // refetch (deleted elsewhere) silently drops out instead of 404ing.
      const ids = posts.filter((p) => sel.has(p.id)).map((p) => p.id);
      if (ids.length === 0 || busy) return;
      setBusy(true);
      setNotice(null);
      let ok = 0;
      let refused = 0;
      let firstMessage: string | null = null;
      for (const id of ids) {
        try {
          const res = await fetch(`/api/v1/content/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          });
          if (res.ok) {
            ok += 1;
            continue;
          }
          // One dead session refuses the whole loop the same way, so stop and
          // go to login rather than counting the rest as refusals.
          if (res.status === 401) {
            window.location.assign("/login?next=/content");
            return;
          }
          refused += 1;
          firstMessage ??= readErrorMessage(await res.json().catch(() => null));
        } catch {
          refused += 1;
          firstMessage ??= "The request didn't reach the server.";
        }
      }
      // One resync for the whole batch, whatever happened: the refetch is what
      // keeps this pane honest about what the server actually stored.
      await onChange();
      setBusy(false);
      setNotice(
        refused === 0
          ? `${did} on ${ok} ${ok === 1 ? "post" : "posts"}.`
          : `${did} on ${ok} of ${ids.length} posts. ${refused} refused: ${firstMessage ?? "the server said no."}`,
      );
    },
    [busy, onChange, posts, sel],
  );

  const applyChannels = useCallback(
    (channels: PostChannel[]) =>
      applyToSelected(
        // The composer's dual-write: post_channel mirrors the first member so
        // every reader built against the scalar keeps working.
        { post_channels: channels, post_channel: channels[0] ?? null },
        channels.length === 0 ? "Cleared channels" : "Set channels",
      ),
    [applyToSelected],
  );

  return (
    <div className="view-pane cv-select-pane" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px 26px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.02em", color: "var(--text)" }}>Select posts</div>
        <span style={{ ...CAPS, letterSpacing: ".06em", background: "var(--field)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: "3px 10px" }}>
          {sel.size.toLocaleString("en-GB")} selected
        </span>
        <button
          className="btn-ghost-pill"
          style={{ height: 26, padding: "0 11px", fontSize: 12.5, color: "var(--text)" }}
          disabled={busy || posts.length === 0}
          onClick={() => setSel(new Set(posts.map((p) => p.id)))}
        >
          Select all
        </button>
        {sel.size > 0 && (
          <button
            className="btn-ghost-pill"
            style={{ height: 26, padding: "0 11px", fontSize: 12.5, color: "var(--text)" }}
            disabled={busy}
            onClick={() => setSel(new Set())}
          >
            Clear selection
          </button>
        )}
      </div>

      {/* The list scrolls on its own; the action bar below never scrolls away
          with it (the shell scroll rule: flex column, minHeight:0 on the
          scroller, overflow inside it). Rows wear the calendar list's
          card-on-hairline look so the mode reads as the same posts reshaped.
          The 120px floor is the shell-scroll rule's other half: a flex-1
          scroller with no floor collapses to a sliver when the action bar
          stacks its rows at narrow widths. */}
      <div style={{ flex: 1, minHeight: 120, overflowY: "auto", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-card)" }}>
        {posts.length === 0 ? (
          <div style={{ ...CAPS, textAlign: "center", padding: "26px 16px", letterSpacing: ".05em", lineHeight: 1.5 }}>
            No planned posts yet. Done goes back to the calendar
          </div>
        ) : (
          posts.map((p) => <SelectPostRow key={p.id} item={p} checked={sel.has(p.id)} onToggle={() => toggle(p.id)} />)
        )}
      </div>

      {/* THE ACTION BAR (the ticket's floating bar): only while something is
          selected, docked under the list so it can never cover the rows it
          acts on. */}
      {sel.size > 0 && (
        <div className="glass-panel cv-sel-actions" style={{ marginTop: 12, padding: "12px 14px", borderRadius: "var(--r-lg)", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span style={{ ...CAPS, letterSpacing: ".06em", minWidth: 66 }}>Status</span>
            {CONTENT_STATUSES.map((s) => (
              <ActionChip
                key={s}
                disabled={busy}
                title={
                  s === "scheduled" || s === "posted"
                    ? `Set ${STATUS_LABELS[s]} on the selected posts. Posts without an approval are refused and counted`
                    : `Set ${STATUS_LABELS[s]} on the selected posts`
                }
                onClick={() => void applyToSelected({ status: s }, `Set ${STATUS_LABELS[s]}`)}
              >
                {STATUS_LABELS[s]}
              </ActionChip>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span style={{ ...CAPS, letterSpacing: ".06em", minWidth: 66 }}>Channels</span>
            {POST_CHANNELS.map((c) => (
              <ActionChip
                key={c}
                active={chanDraft.includes(c)}
                dot={CHANNEL_TINTS[c]}
                disabled={busy}
                title={`Include ${CHANNEL_LABELS[c]} in the channel set to apply`}
                onClick={() => setChanDraft((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]))}
              >
                {CHANNEL_LABELS[c]}
              </ActionChip>
            ))}
            <button
              className="btn-primary-pill"
              style={{ padding: "5px 13px", fontSize: 12.5, opacity: busy || chanDraft.length === 0 ? 0.55 : 1 }}
              disabled={busy || chanDraft.length === 0}
              title="Replace the selected posts' channels with the ticked set"
              onClick={() => void applyChannels(chanDraft)}
            >
              Apply channels
            </button>
            <button
              className="btn-ghost-pill"
              style={{ padding: "5px 13px", fontSize: 12.5, color: "var(--text)", opacity: busy ? 0.55 : 1 }}
              disabled={busy}
              title="Remove every channel from the selected posts"
              onClick={() => void applyChannels([])}
            >
              Clear channels
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span style={{ ...CAPS, letterSpacing: ".06em", minWidth: 66 }}>Medium</span>
            {POST_MEDIUMS.map((m) => (
              <ActionChip key={m} disabled={busy} title={`Set ${MEDIUM_LABELS[m]} on the selected posts`} onClick={() => void applyToSelected({ post_medium: m }, `Set ${MEDIUM_LABELS[m]}`)}>
                {MEDIUM_LABELS[m]}
              </ActionChip>
            ))}
          </div>
          {(busy || notice) && (
            <span role="status" style={{ fontSize: 13, lineHeight: 1.45, color: "var(--text-muted)" }}>
              {busy ? "Applying..." : notice}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** One selectable post: the whole row is the checkbox (aria-pressed carries
 *  the state), so ticking never demands a 16px target. */
function SelectPostRow({ item, checked, onToggle }: { item: ContentItem; checked: boolean; onToggle: () => void }) {
  // The array first, the scalar as fallback for rows written before the
  // dual-write existed, each member gated because the column is ordinary text.
  const set = (item.post_channels ?? []).filter(isPostChannel);
  const channels = set.length > 0 ? set : isPostChannel(item.post_channel) ? [item.post_channel] : [];
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onToggle}
      className="cv-sel-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "9px 14px",
        border: "none",
        borderBottom: "1px solid var(--divider)",
        background: checked ? "var(--table-header)" : "var(--card)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16,
          height: 16,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 4,
          border: checked ? "1px solid var(--btn-primary)" : "1px solid var(--border)",
          background: checked ? "var(--btn-primary)" : "var(--field)",
        }}
      >
        {checked && (
          // Drawn, not typed: a tick glyph in the Merchant family would sink
          // under the 12.5px floor at this size.
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="var(--btn-primary-text)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
        )}
      </span>
      <span className="cv-sel-date" style={{ ...CAPS, letterSpacing: ".05em", flex: "0 0 92px", color: item.scheduled_for ? "var(--text-muted)" : "var(--text-muted-2)" }}>
        {item.scheduled_for ? dayLabel(item.scheduled_for) : "No date"}
      </span>
      <span className="cv-sel-title" style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13.5, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.title?.trim() || item.post_concept?.trim() || "Untitled post"}
      </span>
      {channels.length > 0 && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }} title={channels.map((c) => CHANNEL_LABELS[c]).join(", ")}>
          {channels.map((c) => (
            <span key={c} aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: CHANNEL_TINTS[c] }} />
          ))}
        </span>
      )}
      {isPostMedium(item.post_medium) && (
        <span style={{ ...CAPS, letterSpacing: ".05em", flexShrink: 0 }}>{MEDIUM_LABELS[item.post_medium]}</span>
      )}
      <span style={{ ...CAPS, letterSpacing: ".05em", flex: "0 0 84px", textAlign: "right", color: "var(--text-muted)" }}>
        {STATUS_LABELS[item.status] ?? item.status}
      </span>
    </button>
  );
}

/** The calendar FilterChip idiom with a disabled posture, for the action bar. */
function ActionChip({
  active,
  dot,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  dot?: string;
  disabled: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active ?? false}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-merchant)",
        fontWeight: 500,
        fontSize: 12.5,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        padding: "4px 11px",
        borderRadius: "var(--r-pill)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        border: active ? "1px solid var(--text)" : "1px solid var(--border)",
        background: active ? "var(--elevated)" : "var(--field)",
        color: active ? "var(--on-elevated)" : "var(--text-muted)",
        transition: "background .12s, color .12s, border-color .12s",
      }}
    >
      {dot && <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />}
      {children}
    </button>
  );
}

/** The house error envelope is { error: { code, message } }. Local twin of
 *  ExcalidrawBoard's reader, same no-cross-dependency posture as its own
 *  twins: these helpers are tiny and the boards stay unentangled. */
function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="cv-tab"
      style={{
        fontFamily: "var(--font-merchant)",
        fontWeight: 500,
        // The Merchant caps floor is 12.5, not 12 (the standing rule, and what
        // the calendar's own ModeButton twin already uses).
        fontSize: 12.5,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        padding: "6px 15px",
        borderRadius: "var(--r-pill)",
        border: "none",
        cursor: "pointer",
        // Active segment = the solid primary pill (black light / off-white dark).
        background: active ? "var(--btn-primary)" : "transparent",
        color: active ? "var(--btn-primary-text)" : "var(--text-muted)",
        boxShadow: active ? "var(--shadow-card)" : "none",
      }}
    >
      {children}
    </button>
  );
}
