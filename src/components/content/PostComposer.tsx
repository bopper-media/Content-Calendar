"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONTENT_STATUSES,
  PLAN_ROLE_LABELS,
  POST_CHANNELS,
  SECTION_COLORS,
  STATUS_LABELS,
  isContentStatus,
  isPlanRole,
  isPostChannel,
  type ApprovalDecision,
  type ContentApproval,
  type ContentComment,
  type ContentItem,
  type ContentItemInput,
  type ContentPillar,
  type ContentStatus,
  type PostChannel, POST_ACCOUNT_SUGGESTIONS } from "@/lib/content/types";
import { readCaptionSuggestion, wordDiff, type CaptionSuggestion } from "@/lib/content/caption-suggest";
import { initialsOf } from "@/lib/tasks/types";
import { ClipImage } from "@/components/content/ClipImage";
import { createClient } from "@/lib/supabase/client";
import { uploadContentFile } from "@/lib/content/upload-client";

/**
 * PostComposer (Mia, 2026-07-21): "on the calendar i should be able to click
 * add post and then input a title, channel, post concept, post copy, links,
 * placeholder images, colour code, tagging etc."
 *
 * A centred Frosted modal over the calendar. Creating (item null) POSTs
 * /api/v1/content as kind 'card', source 'manual'; editing PATCHes
 * /api/v1/content/:id with the same field set. The calendar wiring imports this
 * and nothing else: the component owns the whole draft and reports back only
 * through onSaved (refetch) and onClose.
 *
 * Deliberately NOT imported from ContentBoard even where the code is a twin
 * (upload, error envelope): the board is mid-edit by another agent and this
 * file must not create a dependency on its internals. The twins are small and
 * commented as such below.
 */

const MONO = "var(--font-merchant)";

// Merchant micro-label. 12.5px is the floor (house rule), not a style choice.
const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: MONO,
  fontWeight: 500,
  fontSize: 12.5,
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--field)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-chip)",
  padding: "9px 11px",
  fontSize: 14,
};

/** Display names for the channel pills. POST_CHANNELS stays lowercase because
 *  that is what the column stores; only the label dresses up. */
const CHANNEL_LABELS: Record<PostChannel, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  email: "Email",
  website: "Website",
  other: "Other",
};

// Caption suggested-edit UI bits (Nikki's lab, 2026-08-12, "Option 1").
// initialsOf is the tasks module's avatar helper, so the chip matches the
// comment thread's glyphs below it.
const suggestPrimaryBtn: React.CSSProperties = { background: "var(--btn-primary)", color: "var(--btn-primary-text)", border: "none", borderRadius: "var(--r-pill)", padding: "6px 15px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" };
const suggestGhostBtn: React.CSSProperties = { background: "transparent", color: "var(--text-muted)", border: "none", padding: "6px 8px", fontSize: 12.5, cursor: "pointer" };

function SuggestAvatar({ name }: { name: string | null }) {
  return (
    <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--btn-primary)", color: "var(--btn-primary-text)", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
      {initialsOf(name)}
    </span>
  );
}

/** Matches the server's ceiling in api/v1/content/shared.ts (post_copy). Named
 *  here so the live count can show the real limit rather than a guess. */
const COPY_MAX = 10_000;

/** Mirrors the API's post_first_comment cap, which is Instagram's own comment
 *  limit (migration 0063). Same reasoning as COPY_MAX: the count shows the
 *  real ceiling, not a guess. */
const FIRST_COMMENT_MAX = 2_200;

/** Mirrors the comment route's zod cap so the box refuses character 4001 with
 *  a maxLength instead of a 422 after typing it. */
const COMMENT_MAX = 4_000;

/** Mirrors the approval route's note cap (decide action). */
const APPROVAL_NOTE_MAX = 2_000;

/**
 * Twin of isHttpUrl in api/v1/content/shared.ts, kept local so a client
 * component does not import a server route helper (and its zod) into the
 * bundle. Same reasoning as there: links land in <a href> and images in
 * <img src>, so allow-list the two safe schemes by parsing, which is what the
 * browser will do to the value anyway.
 */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** The house error envelope is { error: { code, message } } and `message` is
 *  written server-side to be safe to show (lib/api/response.ts). Walked by hand
 *  because a parsed response body is unknown until proven otherwise. */
function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

/** Unwrap a { data: [...] } list body (pillars, comments). Null when the shape
 *  is not that, so callers degrade instead of trusting a cast. */
function readDataArray(body: unknown): unknown[] | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? data : null;
}

/** Unwrap GET .../approval's { data: { latest, history } }. history proves the
 *  shape; latest is history[0] by the route's contract so it needs no probe. */
function readApprovalState(body: unknown): { latest: ContentApproval | null; history: ContentApproval[] } | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const history = (data as { history?: unknown }).history;
  if (!Array.isArray(history)) return null;
  const latest = (data as { latest?: unknown }).latest ?? null;
  return { latest: latest as ContentApproval | null, history: history as ContentApproval[] };
}

/**
 * Relative timestamps for the discussion and approval trail. Computed at
 * render (no ticking interval): the modal is short-lived and "5m ago" going
 * stale by a minute costs nothing. Falls back to a plain date past a week,
 * where "9d ago" starts making the reader do arithmetic.
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

/**
 * Put one image file in the bucket and hand back the stored link, the board's
 * pattern (POST /api/v1/content/upload, multipart `file`). Throws rather than
 * returning null because every failure has a DIFFERENT cause the user can act
 * on (too big, wrong type, storage down) and the message is the whole point.
 * The ceilings live in the route on purpose: a copied 10MB here would drift.
 */
async function uploadImage(file: File): Promise<string> {
  // The transport lives in lib/content/upload-client now (2026-09-22): a file
  // over 4MB goes straight to storage, smaller ones take the multipart route.
  const url = await uploadContentFile(file, "Couldn't upload that image. Try again.");
  // The save underneath validates post_images as http(s) capped at 2000 chars
  // (api/v1/content/shared.ts). Checking here turns a later 422 into a sentence
  // now, on the action that actually failed.
  if (!isHttpUrl(url) || url.length > 2000) {
    throw new Error("That upload came back without a usable link, so it isn't attached.");
  }
  return url;
}

// Client-side mirrors of the server's array caps (shared.ts), so the composer
// refuses the 13th link with a sentence instead of a 422 at save time.
const MAX_LINKS = 12;
const MAX_IMAGES = 12;
const MAX_TAGS = 20;

export function PostComposer({
  item,
  defaultDate,
  onSaved,
  onClose,
}: {
  /** null = creating a new post. */
  item: ContentItem | null;
  /** YYYY-MM-DD when opened from a day cell, prefills the date field. */
  defaultDate: string | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  // Multi-select (Mia, 2026-07-22, migration 0065): the SET of channels, each
  // member gated by isPostChannel rather than cast, because the column members
  // are ordinary text and an unheard-of value drops to "no pill lit" instead
  // of a phantom selection. Saving then writes the honest reading of the
  // pills. The scalar fallback covers rows written before the dual-write
  // existed (0065 backfilled the live rows, but an old client mid-deploy can
  // still produce a scalar-only row).
  const [channels, setChannels] = useState<PostChannel[]>(() => {
    const stored = (item?.post_channels ?? []).filter(isPostChannel);
    if (stored.length > 0) return stored;
    return isPostChannel(item?.post_channel) ? [item.post_channel] : [];
  });
  const [scheduledFor, setScheduledFor] = useState(item?.scheduled_for ?? defaultDate ?? "");
  const [concept, setConcept] = useState(item?.post_concept ?? "");
  const [copy, setCopy] = useState(item?.post_copy ?? "");
  const [links, setLinks] = useState<string[]>(item?.post_links ?? []);
  const [linkDraft, setLinkDraft] = useState("");
  const [images, setImages] = useState<string[]>(item?.post_images ?? []);
  const [pendingUploads, setPendingUploads] = useState(0);
  // Same guard as channel: colour reaches the DOM, so only a value from the
  // allow-list may light a swatch (and the server enforces the same enum).
  const [color, setColor] = useState<(typeof SECTION_COLORS)[number] | null>(
    item?.color && (SECTION_COLORS as readonly string[]).includes(item.color) ? (item.color as (typeof SECTION_COLORS)[number]) : null,
  );
  const [tags, setTags] = useState<string[]>(item?.post_tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  /** ACCOUNTS the post goes out on (Nikki, ticket 8003f057): multi-select
   *  over the suggestions, and any handle typed in. Free text, like tags. */
  const [accounts, setAccounts] = useState<string[]>(item?.post_accounts ?? []);
  const [accountDraft, setAccountDraft] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"idle" | "saving" | "deleting">("idle");

  // ── the workflow layer (migration 0063) ──────────────────────────────────
  // isContentStatus, same posture as channel above: the column is plain text,
  // so an unheard-of value drops to 'idea' rather than a phantom pill.
  const [status, setStatus] = useState<ContentStatus>(item && isContentStatus(item.status) ? item.status : "idea");
  const [statusBusy, setStatusBusy] = useState(false);
  const [pillars, setPillars] = useState<ContentPillar[] | null>(null);
  const [pillarsFailed, setPillarsFailed] = useState(false);
  const [pillarId, setPillarId] = useState<string | null>(item?.pillar_id ?? null);
  const [firstComment, setFirstComment] = useState(item?.post_first_comment ?? "");
  // Who am I? UI gating ONLY (delete-own-comment, waiting-on-review): the auth
  // user id IS users.id (lib/auth/session.ts resolves the profile row by it),
  // so it compares cleanly against author_id / requested_by. The server
  // re-checks everything; a missing id here only mis-hides buttons, and the
  // approval panel then shows Decide buttons whose 403 message we surface.
  const [uid, setUid] = useState<string | null>(null);
  // The signed-in name, for the caption suggested-edit stamp (Nikki's lab,
  // 2026-08-12): the browser client reading the caller's OWN users row, the
  // BoardHistoryPanel precedent (RLS lets a user read it; 0002 grants
  // authed_read). Null only blanks the stamp, never blocks the flow.
  const [myName, setMyName] = useState<string | null>(null);

  // Series membership (migration 0085; editable since 2026-08-27, Mia: "not
  // all content is in this series... i should be able to make a new series").
  // The select assigns this post to a series (or none); membership is what the
  // series' event-date move slides. One list read on open; a failed read
  // degrades to a read-only chip for an item already in a series.
  const [planId, setPlanId] = useState<string | null>(item?.plan_id ?? null);
  const [planChoices, setPlanChoices] = useState<{ id: string; name: string; pillar_id: string | null }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/content/plans");
        if (!res.ok) return;
        const j = (await res.json()) as { data?: { id: string; name: string; pillar_id?: string | null }[] };
        if (!cancelled && Array.isArray(j?.data)) {
          setPlanChoices(j.data.map((p) => ({ id: p.id, name: p.name, pillar_id: p.pillar_id ?? null })));
        }
      } catch {
        /* the select just stays empty-optioned */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const planName = planChoices.find((p) => p.id === planId)?.name ?? null;

  // Caption suggested edits (Nikki's lab, 2026-08-12, "Option 1"): a reviewer
  // proposes a caption rewrite; the author sees the word diff and accepts or
  // dismisses. Persisted on the row (caption_suggestion, 0082) so the other
  // person actually receives it, and hydrated from the item through
  // readCaptionSuggestion because jsonb is ordinary storage. Only offered ON
  // an existing item: a suggestion is a message to the post's author, and an
  // unsaved post has no row to carry it and no author to receive it.
  const [suggestion, setSuggestion] = useState<CaptionSuggestion | null>(() => readCaptionSuggestion(item?.caption_suggestion ?? null));
  const [suggesting, setSuggesting] = useState(false);
  const [suggestDraft, setSuggestDraft] = useState("");
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [comments, setComments] = useState<ContentComment[] | null>(null);
  const [commentsErr, setCommentsErr] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  // One comment-row action (resolve/delete) in flight at a time; holds its id
  // so only that row's buttons dim.
  const [commentActionId, setCommentActionId] = useState<string | null>(null);
  const [approval, setApproval] = useState<{ latest: ContentApproval | null; history: ContentApproval[] } | null>(null);
  const [approvalErr, setApprovalErr] = useState<string | null>(null);
  const [approvalBusy, setApprovalBusy] = useState<"idle" | "requesting" | "approving" | "changes">("idle");
  const [decisionNote, setDecisionNote] = useState("");

  const titleRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Guards setState after the modal is gone: Escape can close mid-upload or
  // mid-save, and the settled fetch must not touch dead state.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Escape closes; focus lands on the title and goes back where it came from
  // when the modal unmounts (the BookingDrawer idiom).
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // getSession, not getUser: this is display gating, not auth, so the locally
  // stored session is enough and costs no network round trip. The follow-on
  // read resolves the caller's display name for the suggestion stamp (see
  // myName above); its failure leaves the neutral fallback.
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    void supabase.auth.getSession().then(async ({ data }) => {
      const id = data.session?.user.id ?? null;
      if (aliveRef.current) setUid(id);
      if (!id) return;
      const { data: me } = await supabase.from("users").select("full_name").eq("id", id).maybeSingle();
      // trim-or-null: the zod contract (author_name min 1 after trim) refuses
      // an empty stamp, so a blank users.full_name must travel as null.
      const raw = (me as { full_name?: string | null } | null)?.full_name?.trim();
      if (aliveRef.current) setMyName(raw || null);
    });
  }, []);

  // Pillars load once per open. On failure the picker degrades to a sentence
  // (pillarsFailed) rather than claiming "no pillars yet", and the post still
  // saves without one.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/content/pillars");
        const body: unknown = await res.json().catch(() => null);
        if (!aliveRef.current) return;
        const list = res.ok ? readDataArray(body) : null;
        if (!list) {
          setPillarsFailed(true);
          setPillars([]);
          return;
        }
        setPillars(list as ContentPillar[]);
      } catch {
        if (!aliveRef.current) return;
        setPillarsFailed(true);
        setPillars([]);
      }
    })();
  }, []);

  /** (Re)load the discussion. Refetch-after-write everywhere below instead of
   *  local list surgery: the thread is shared state and a teammate may be
   *  typing into it right now, so the server's ordering is the truth worth
   *  showing after every action. */
  const fetchComments = useCallback(async () => {
    if (!item) return;
    try {
      const res = await fetch(`/api/v1/content/${item.id}/comments`);
      const body: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      const list = res.ok ? readDataArray(body) : null;
      if (!list) {
        setCommentsErr(readErrorMessage(body) ?? "The discussion didn't load. Try again.");
        return;
      }
      setCommentsErr(null);
      setComments(list as ContentComment[]);
    } catch {
      if (aliveRef.current) setCommentsErr("The discussion didn't load. Check your connection and try again.");
    }
  }, [item]);

  /** (Re)load { latest, history }. */
  const fetchApproval = useCallback(async () => {
    if (!item) return;
    try {
      const res = await fetch(`/api/v1/content/${item.id}/approval`);
      const body: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      const state = res.ok ? readApprovalState(body) : null;
      if (!state) {
        setApprovalErr(readErrorMessage(body) ?? "The review state didn't load. Try again.");
        return;
      }
      setApprovalErr(null);
      setApproval(state);
    } catch {
      if (aliveRef.current) setApprovalErr("The review state didn't load. Check your connection and try again.");
    }
  }, [item]);

  useEffect(() => {
    if (!item) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off fetch on mount; both fetchers only set state after their awaits resolve, never synchronously
    void fetchComments();
    void fetchApproval();
  }, [item, fetchComments, fetchApproval]);

  /**
   * Status is a state switch, not a draft field: on an existing post a pill
   * click PATCHes immediately and only lights on success, so the row never
   * shows a stage the server refused. On an UNSAVED post the pill is local
   * draft state like everything else. save() therefore only sends `status`
   * on create; see the payload below. Any stage may be picked directly: the
   * approval gate that used to block Scheduled/Posted was removed (ticket
   * 656935b3; approvals stay as records, they just no longer block).
   */
  const selectStatus = useCallback(
    async (next: ContentStatus) => {
      if (next === status || statusBusy || busy !== "idle") return;
      if (!item) {
        setStatus(next);
        return;
      }
      setStatusBusy(true);
      try {
        const res = await fetch(`/api/v1/content/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        const body: unknown = await res.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!res.ok) {
          setErr(readErrorMessage(body) ?? "The status could not be changed. Try again.");
          return;
        }
        setStatus(next);
        setErr(null);
        // The calendar and board may badge the stage, so a status write
        // refetches like any other successful write. The modal stays open.
        onSaved();
      } catch {
        if (aliveRef.current) setErr("The request didn't reach the server. Check your connection and try again.");
      } finally {
        if (aliveRef.current) setStatusBusy(false);
      }
    },
    [status, statusBusy, busy, item, onSaved],
  );

  // Caption suggested edits (Nikki's lab, 2026-08-12): every action goes
  // through one pessimistic PATCH door, the selectStatus posture (state only
  // lights on success, so the panel never shows a proposal the server
  // refused). onSaved() refetches like any other successful write.
  const diffSegs = useMemo(() => (suggestion ? wordDiff(suggestion.base, suggestion.text) : []), [suggestion]);
  const patchSuggestion = useCallback(
    async (body: ContentItemInput): Promise<boolean> => {
      if (!item || suggestBusy) return false;
      setSuggestBusy(true);
      try {
        const res = await fetch(`/api/v1/content/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const resBody: unknown = await res.json().catch(() => null);
        if (!aliveRef.current) return false;
        if (!res.ok) {
          setErr(readErrorMessage(resBody) ?? "The suggestion could not be saved. Try again.");
          return false;
        }
        setErr(null);
        onSaved();
        return true;
      } catch {
        if (aliveRef.current) setErr("The request didn't reach the server. Check your connection and try again.");
        return false;
      } finally {
        if (aliveRef.current) setSuggestBusy(false);
      }
    },
    [item, suggestBusy, onSaved],
  );
  const enterSuggesting = () => {
    setSuggestDraft(copy);
    setSuggesting(true);
  };
  const submitSuggestion = async () => {
    if (suggestDraft.trim() === copy.trim()) {
      setSuggesting(false);
      return;
    }
    // A fresh suggestion is the suggester's to send for approval first.
    const next: CaptionSuggestion = { author_id: uid, author_name: myName, base: copy, text: suggestDraft, at: new Date().toISOString(), status: "proposed" };
    if (await patchSuggestion({ caption_suggestion: next })) {
      setSuggestion(next);
      setSuggesting(false);
    }
  };
  const sendForApproval = async () => {
    if (!suggestion || suggestion.status === "sent") return;
    const next: CaptionSuggestion = { ...suggestion, status: "sent" };
    if (await patchSuggestion({ caption_suggestion: next })) setSuggestion(next);
  };
  const dismissSuggestion = async () => {
    if (await patchSuggestion({ caption_suggestion: null })) setSuggestion(null);
  };
  // Accept writes the proposed caption and clears the suggestion in the SAME
  // patch, so the two can never land apart; the local `copy` then mirrors
  // what was just saved, keeping the eventual Save an ordinary no-op echo.
  const acceptSuggestion = async () => {
    if (!suggestion) return;
    const text = suggestion.text;
    if (await patchSuggestion({ post_copy: text.trim() || null, caption_suggestion: null })) {
      setCopy(text);
      setSuggestion(null);
    }
  };

  const postComment = useCallback(async () => {
    if (!item || commentBusy) return;
    const bodyText = commentDraft.trim();
    if (!bodyText) return;
    setCommentBusy(true);
    try {
      const res = await fetch(`/api/v1/content/${item.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: bodyText }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!res.ok) {
        setCommentsErr(readErrorMessage(body) ?? "The comment could not be posted. Try again.");
        return;
      }
      setCommentDraft("");
      // Await the refetch so the busy state holds until the comment is
      // visibly in the thread; released earlier it reads as the app eating it.
      await fetchComments();
    } catch {
      if (aliveRef.current) setCommentsErr("The request didn't reach the server. Check your connection and try again.");
    } finally {
      if (aliveRef.current) setCommentBusy(false);
    }
  }, [item, commentBusy, commentDraft, fetchComments]);

  const toggleResolve = useCallback(
    async (c: ContentComment) => {
      if (!item || commentActionId) return;
      setCommentActionId(c.id);
      try {
        const res = await fetch(`/api/v1/content/${item.id}/comments/${c.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resolved: !c.resolved_at }),
        });
        const body: unknown = await res.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!res.ok) {
          setCommentsErr(readErrorMessage(body) ?? "That comment could not be updated. Try again.");
          return;
        }
        await fetchComments();
      } catch {
        if (aliveRef.current) setCommentsErr("The request didn't reach the server. Check your connection and try again.");
      } finally {
        if (aliveRef.current) setCommentActionId(null);
      }
    },
    [item, commentActionId, fetchComments],
  );

  /** Own comments only (the API 403s anyone else's); immediate with no confirm,
   *  the same house posture as deleting the post itself. */
  const deleteComment = useCallback(
    async (c: ContentComment) => {
      if (!item || commentActionId) return;
      setCommentActionId(c.id);
      try {
        const res = await fetch(`/api/v1/content/${item.id}/comments/${c.id}`, { method: "DELETE" });
        const body: unknown = await res.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!res.ok) {
          setCommentsErr(readErrorMessage(body) ?? "That comment could not be deleted. Try again.");
          return;
        }
        await fetchComments();
      } catch {
        if (aliveRef.current) setCommentsErr("The request didn't reach the server. Check your connection and try again.");
      } finally {
        if (aliveRef.current) setCommentActionId(null);
      }
    },
    [item, commentActionId, fetchComments],
  );

  const requestReview = useCallback(async () => {
    if (!item || approvalBusy !== "idle") return;
    setApprovalBusy("requesting");
    try {
      const res = await fetch(`/api/v1/content/${item.id}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!res.ok) {
        const msg = readErrorMessage(body) ?? "The review request didn't go through. Try again.";
        // 409 = a teammate's request beat this one in; the refreshed panel is
        // the real answer, the sentence sits on top of it.
        if (res.status === 409) await fetchApproval();
        if (aliveRef.current) setApprovalErr(msg);
        return;
      }
      await fetchApproval();
    } catch {
      if (aliveRef.current) setApprovalErr("The request didn't reach the server. Check your connection and try again.");
    } finally {
      if (aliveRef.current) setApprovalBusy("idle");
    }
  }, [item, approvalBusy, fetchApproval]);

  /** Decide the open request. The API owns the two-person rule: if uid was
   *  unknowable and the caller is the requester, the 403's message (a second
   *  pair of eyes is the whole point) surfaces right here in the panel. */
  const decideReview = useCallback(
    async (decision: ApprovalDecision) => {
      if (!item || approvalBusy !== "idle") return;
      setApprovalBusy(decision === "approved" ? "approving" : "changes");
      try {
        const res = await fetch(`/api/v1/content/${item.id}/approval`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "decide", decision, note: decisionNote.trim() || null }),
        });
        const body: unknown = await res.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!res.ok) {
          const msg = readErrorMessage(body) ?? "The decision didn't go through. Try again.";
          // already_decided / nothing_open: the panel is stale, so refresh the
          // truth before saying what happened.
          if (res.status === 409) await fetchApproval();
          if (aliveRef.current) setApprovalErr(msg);
          return;
        }
        setDecisionNote("");
        // Status is client state the approval write cannot have changed, so
        // the approval state is the only thing to re-read.
        await fetchApproval();
      } catch {
        if (aliveRef.current) setApprovalErr("The request didn't reach the server. Check your connection and try again.");
      } finally {
        if (aliveRef.current) setApprovalBusy("idle");
      }
    },
    [item, approvalBusy, decisionNote, fetchApproval],
  );

  /** Commit the link draft into the list. Validated on commit, not on every
   *  keystroke, so a half-typed url is not shouted at. Returns whether the
   *  draft was consumable (save uses this to refuse silently losing text). */
  const commitLink = useCallback((): boolean => {
    const raw = linkDraft.trim();
    if (!raw) return true;
    if (!isHttpUrl(raw)) {
      setErr("Links must start with http:// or https://");
      return false;
    }
    if (links.length >= MAX_LINKS) {
      setErr(`A post holds up to ${MAX_LINKS} links.`);
      return false;
    }
    if (!links.includes(raw)) setLinks((l) => [...l, raw]);
    setLinkDraft("");
    setErr(null);
    return true;
  }, [linkDraft, links]);

  /** Commit the tag draft into the chips. Same posture as commitLink. */
  const commitTag = useCallback((): boolean => {
    const raw = tagDraft.trim().slice(0, 40);
    if (!raw) return true;
    if (tags.length >= MAX_TAGS) {
      setErr(`A post holds up to ${MAX_TAGS} tags.`);
      return false;
    }
    if (!tags.includes(raw)) setTags((t) => [...t, raw]);
    setTagDraft("");
    setErr(null);
    return true;
  }, [tagDraft, tags]);

  /** Commit the account draft into the chips, a leading @ dropped. */
  const commitAccount = useCallback((): boolean => {
    const raw = accountDraft.trim().replace(/^@+/, "").slice(0, 60);
    if (!raw) return true;
    if (accounts.length >= 10) {
      setErr("A post goes out on up to 10 accounts.");
      return false;
    }
    if (!accounts.includes(raw)) setAccounts((a) => [...a, raw]);
    setAccountDraft("");
    setErr(null);
    return true;
  }, [accountDraft, accounts]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    for (const file of list) {
      // Checked per file against live state inside the updater below is racy to
      // read here, so count optimistically: n in-flight plus what is attached.
      setPendingUploads((n) => n + 1);
      uploadImage(file)
        .then((url) => {
          if (!aliveRef.current) return;
          setImages((imgs) => {
            if (imgs.length >= MAX_IMAGES) {
              setErr(`A post holds up to ${MAX_IMAGES} images.`);
              return imgs;
            }
            return imgs.includes(url) ? imgs : [...imgs, url];
          });
        })
        .catch((e: unknown) => {
          if (!aliveRef.current) return;
          setErr(e instanceof Error ? e.message : "Couldn't upload that image. Try again.");
        })
        .finally(() => {
          if (aliveRef.current) setPendingUploads((n) => n - 1);
        });
    }
  }, []);

  async function save() {
    if (busy !== "idle" || pendingUploads > 0) return;
    // Text still sitting in the link or tag box counts: losing it silently on
    // save would read as the app eating input, so commit it first and stop if
    // it will not commit (commitLink already surfaced why).
    if (!commitLink() || !commitTag() || !commitAccount()) return;
    // The commits above queue their state; the payload below is built now,
    // so what was still in the tag or account box is folded in here as well.
    const pendingTag = tagDraft.trim().slice(0, 40);
    const nextTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;
    const pendingAccount = accountDraft.trim().replace(/^@+/, "").slice(0, 60);
    const nextAccounts = pendingAccount && !accounts.includes(pendingAccount) ? [...accounts, pendingAccount] : accounts;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setErr("Give the post a title.");
      return;
    }

    // The full editable set every time, not a diff: null (or []) is how a field
    // is cleared, and the PATCH schema treats absent and null differently.
    // EXCEPT status on an existing item: pill clicks already PATCHed it (see
    // selectStatus), so repeating it here would only duplicate a write that
    // already stands.
    const payload: ContentItemInput = {
      title: cleanTitle,
      scheduled_for: scheduledFor || null,
      color,
      pillar_id: pillarId,
      // Series membership rides the same full-set posture: null leaves a series.
      plan_id: planId,
      // Dual-write (0065): the array is the truth, the scalar mirrors its
      // first member (or null) so every reader built against post_channel
      // keeps working unchanged.
      post_channels: channels,
      post_channel: channels[0] ?? null,
      post_concept: concept.trim() || null,
      post_copy: copy.trim() || null,
      post_first_comment: firstComment.trim() || null,
      post_links: links,
      post_images: images,
      post_tags: nextTags,
      post_accounts: nextAccounts,
    };
    if (!item) {
      // A new post is an ordinary board card underneath, so the board shows it
      // too (at the canvas origin, the column defaults from 0057). 'manual'
      // because a person typed it, the same source as a card made on the board.
      payload.kind = "card";
      payload.source = "manual";
      payload.status = status;
    }

    setBusy("saving");
    setErr(null);
    try {
      const res = await fetch(item ? `/api/v1/content/${item.id}` : "/api/v1/content", {
        method: item ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!res.ok) {
        setErr(readErrorMessage(body) ?? "The post could not be saved. Try again.");
        setBusy("idle");
        return;
      }
      onSaved();
      onClose();
    } catch {
      if (!aliveRef.current) return;
      setErr("The request didn't reach the server. Check your connection and try again.");
      setBusy("idle");
    }
  }

  /** Immediate, no confirm, by explicit instruction (Mia: "i should also be
   *  able to delete things by just pressing delete, not having to press ok"). */
  async function remove() {
    if (!item || busy !== "idle") return;
    setBusy("deleting");
    setErr(null);
    try {
      const res = await fetch(`/api/v1/content/${item.id}`, { method: "DELETE" });
      const body: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!res.ok) {
        setErr(readErrorMessage(body) ?? "The post could not be deleted. Try again.");
        setBusy("idle");
        return;
      }
      onSaved();
      onClose();
    } catch {
      if (!aliveRef.current) return;
      setErr("The request didn't reach the server. Check your connection and try again.");
      setBusy("idle");
    }
  }

  const copyNearLimit = copy.length > COPY_MAX - 500;
  const firstCommentNearLimit = firstComment.length > FIRST_COMMENT_MAX - 200;

  // Archived pillars stay OUT of the picker (the whole point of archiving)
  // UNLESS this post already wears one: hiding it would make the select lie
  // and a save would silently strip it.
  const pillarChoices = (pillars ?? []).filter((p) => !p.archived_at || p.id === pillarId);
  const selectedPillar = pillarChoices.find((p) => p.id === pillarId) ?? null;

  // Unresolved points first, each group oldest first (the API's order).
  const orderedComments =
    comments === null ? null : [...comments.filter((c) => !c.resolved_at), ...comments.filter((c) => c.resolved_at)];

  const openRequest = approval?.latest && approval.latest.decision === null ? approval.latest : null;
  const openIsMine = Boolean(openRequest && uid && openRequest.requested_by === uid);
  const decidedHistory = approval?.history.filter((a) => a.decision !== null) ?? [];

  /** Small text action inside a comment row (Resolve / Reopen / Delete). */
  const commentActionStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontFamily: MONO,
    fontSize: 12.5,
    letterSpacing: ".04em",
    padding: 2,
    color: "var(--text-muted)",
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(0,0,0,.45)" }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item ? "Edit post" : "Add post"}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(560px, 94vw)",
          // The workflow sections made the composer tall: the shell is now a
          // column whose BODY scrolls while the header and save row stay
          // pinned, so the actions never leave the screen. overflow hidden
          // keeps the pinned bands clipped to the panel radius.
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          zIndex: 96,
          // Frosted modal: panel radius + shadow, hairline edge (AddBookingModal's shell).
          background: "var(--card)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--r-panel)",
          boxShadow: "var(--shadow-panel)",
        }}
      >
        {/* header: dark charcoal band, white text (Frosted), pinned */}
        <div style={{ flex: "none", background: "var(--elevated)", color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".09em", textTransform: "uppercase" }}>
            {item ? "Edit post" : "Add post"}
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>

        {/* the scrolling body; overscroll contained so a long thread does not
            start scrolling the calendar behind the overlay */}
        <div style={{ padding: "18px 20px 22px", display: "flex", flexDirection: "column", gap: 14, flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
          {/* Series membership (migration 0085): which series this item
              slides with, now editable here (Mia, 2026-08-27). Picking a
              series with a pillar fills the post's pillar when it has none. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--text-muted)" }} htmlFor="post-series">Series</label>
            <select
              id="post-series"
              value={planId ?? ""}
              onChange={(e) => {
                const next = e.target.value || null;
                setPlanId(next);
                const p = planChoices.find((x) => x.id === next);
                if (p?.pillar_id && !pillarId) setPillarId(p.pillar_id);
              }}
              style={{ height: 32, background: "var(--field)", border: "1px solid var(--border)", borderRadius: "var(--r-chip)", padding: "0 9px", color: "var(--text)", fontSize: 13 }}
            >
              <option value="">No series</option>
              {planChoices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {/* An item whose series failed to load still shows honestly. */}
              {planId && !planChoices.some((p) => p.id === planId) && <option value={planId}>In a series</option>}
            </select>
            {planId && (
              <span style={{ fontSize: 12.5, color: "var(--text-muted-2)" }}>
                {item && isPlanRole(item.plan_role) && item.plan_role !== "post" ? `${PLAN_ROLE_LABELS[item.plan_role]} in ${planName ?? "the series"}. ` : ""}
                Moves with the series&apos; event date
              </span>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="post-title">Title</label>
            <input
              id="post-title"
              ref={titleRef}
              value={title}
              maxLength={300}
              onChange={(e) => { setTitle(e.target.value); if (err) setErr(null); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(); }}
              placeholder="What is this post?"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Channels</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {POST_CHANNELS.map((c) => {
                const active = channels.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={active}
                    // Each pill toggles independently (multi-select, 0065);
                    // unlighting them all takes the post back to channel-less,
                    // matching the clearable date below.
                    onClick={() => setChannels((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]))}
                    style={{
                      fontFamily: MONO,
                      fontWeight: 500,
                      fontSize: 12.5,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      padding: "6px 12px",
                      borderRadius: 999,
                      cursor: "pointer",
                      border: active ? "1px solid var(--text)" : "1px solid var(--border)",
                      background: active ? "var(--elevated)" : "var(--field)",
                      color: active ? "#fff" : "var(--text-muted)",
                    }}
                  >
                    {CHANNEL_LABELS[c]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Status</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {CONTENT_STATUSES.map((s) => {
                const active = status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    // No unset toggle, unlike channel: a post always has a
                    // stage. Clicking the lit pill is a no-op in selectStatus.
                    onClick={() => void selectStatus(s)}
                    disabled={statusBusy}
                    style={{
                      fontFamily: MONO,
                      fontWeight: 500,
                      fontSize: 12.5,
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                      padding: "6px 12px",
                      borderRadius: 999,
                      cursor: statusBusy ? "wait" : "pointer",
                      border: active ? "1px solid var(--text)" : "1px solid var(--border)",
                      background: active ? "var(--elevated)" : "var(--field)",
                      color: active ? "#fff" : "var(--text-muted)",
                      opacity: statusBusy ? 0.6 : 1,
                    }}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="post-pillar">Pillar</label>
            {pillars === null ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading pillars...</div>
            ) : pillarsFailed ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>The pillars didn&apos;t load. The post still saves without one.</div>
            ) : pillarChoices.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No pillars yet. Create them in the Pillars tab.</div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* The selected pillar's colour dot; a dashed hollow when none
                    is picked (or the pillar has no colour), so the slot reads
                    as deliberately empty rather than broken. */}
                <span
                  aria-hidden
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    flex: "none",
                    background: selectedPillar?.color ?? "transparent",
                    border: selectedPillar?.color ? "1px solid var(--hairline)" : "1px dashed var(--border)",
                  }}
                />
                <select
                  id="post-pillar"
                  value={pillarId ?? ""}
                  onChange={(e) => setPillarId(e.target.value || null)}
                  style={{ ...inputStyle, flex: 1, cursor: "pointer" }}
                >
                  <option value="">No pillar</option>
                  {pillarChoices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.archived_at ? `${p.name} (archived)` : p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle} htmlFor="post-date">Scheduled date</label>
            {/* Wraps (Nikki, 2026-09-21, the phone pass): beside the date the
                Clear pill ran off the dialog's right edge on a phone and gave
                the whole form a sideways scroll. */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                id="post-date"
                type="date"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                style={{ ...inputStyle, width: "auto", flex: "0 1 200px" }}
              />
              {scheduledFor && (
                <button
                  type="button"
                  onClick={() => setScheduledFor("")}
                  className="btn-ghost-pill"
                  style={{ height: 32, padding: "0 12px", fontSize: 12.5, color: "var(--text-muted)" }}
                >
                  Clear, keep unscheduled
                </button>
              )}
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="post-concept">Post concept</label>
            <textarea
              id="post-concept"
              value={concept}
              maxLength={2000}
              onChange={(e) => setConcept(e.target.value)}
              rows={3}
              placeholder="The idea in a couple of lines"
              style={{ ...inputStyle, resize: "vertical", minHeight: 66, fontSize: 13.5, lineHeight: 1.45 }}
            />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <label style={labelStyle} htmlFor="post-copy">Post copy</label>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* A reviewer proposes changes instead of overwriting (Nikki's
                    lab, 2026-08-12, "Option 1"). Existing posts only: an
                    unsaved post has no row to carry the proposal. */}
                {item && !suggesting && !suggestion && (
                  <button
                    type="button"
                    onClick={enterSuggesting}
                    style={{ fontFamily: MONO, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Suggest an edit
                  </button>
                )}
                {/* Live count: captions have platform limits, so the length is
                    information, not decoration. Warms up near the API ceiling. */}
                <span aria-live="polite" style={{ fontFamily: MONO, fontSize: 12.5, color: copyNearLimit ? "var(--danger)" : "var(--text-muted-2)" }}>
                  {(suggesting ? suggestDraft : copy).length.toLocaleString()} / {COPY_MAX.toLocaleString()}
                </span>
              </div>
            </div>

            {suggesting ? (
              // Suggesting mode: edits go to a draft, not the saved caption.
              <div style={{ border: "1px solid var(--accent)", borderRadius: "var(--r-card)", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", background: "var(--accent-soft)", fontSize: 12.5, color: "var(--text-muted)" }}>
                  <SuggestAvatar name={myName} />
                  <span>Suggesting as {myName ?? "you"}. Your changes are proposed, not saved.</span>
                </div>
                <textarea
                  id="post-copy"
                  value={suggestDraft}
                  maxLength={COPY_MAX}
                  onChange={(e) => setSuggestDraft(e.target.value)}
                  rows={6}
                  autoFocus
                  style={{ ...inputStyle, border: "none", borderRadius: 0, resize: "vertical", minHeight: 120, fontSize: 13.5, lineHeight: 1.45 }}
                />
                <div style={{ display: "flex", gap: 8, padding: "9px 11px", borderTop: "1px solid var(--divider)" }}>
                  <button type="button" onClick={() => void submitSuggestion()} disabled={suggestBusy} style={{ ...suggestPrimaryBtn, opacity: suggestBusy ? 0.6 : 1 }}>Submit suggestion</button>
                  <button type="button" onClick={() => setSuggesting(false)} style={suggestGhostBtn}>Cancel</button>
                </div>
              </div>
            ) : suggestion ? (
              // Open suggestion: show the diff, accept or dismiss.
              <div style={{ border: "1px solid var(--accent)", borderRadius: "var(--r-card)", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", background: "var(--accent-soft)" }}>
                  <SuggestAvatar name={suggestion.author_name} />
                  <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                    <strong style={{ color: "var(--text)", fontWeight: 600 }}>{suggestion.author_name ?? "A teammate"}</strong> suggested an edit &middot; {timeAgo(suggestion.at)}
                  </span>
                  {suggestion.status === "sent" && (
                    <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--alert)", background: "color-mix(in srgb, var(--alert) 13%, transparent)", border: "1px solid color-mix(in srgb, var(--alert) 34%, transparent)", borderRadius: "var(--r-pill)", padding: "1px 8px" }}>Needs approval</span>
                  )}
                </div>
                <div style={{ padding: "11px 13px", fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text)", maxHeight: 280, overflowY: "auto" }}>
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
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderTop: "1px solid var(--divider)" }}>
                  {suggestion.status === "proposed" ? (
                    <>
                      <button type="button" onClick={() => void sendForApproval()} disabled={suggestBusy} style={{ ...suggestPrimaryBtn, opacity: suggestBusy ? 0.6 : 1 }}>Send for approval</button>
                      <button type="button" onClick={() => void dismissSuggestion()} disabled={suggestBusy} style={suggestGhostBtn}>Dismiss</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => void acceptSuggestion()} disabled={suggestBusy} style={{ ...suggestPrimaryBtn, opacity: suggestBusy ? 0.6 : 1 }}>Accept</button>
                      <button type="button" onClick={() => void dismissSuggestion()} disabled={suggestBusy} style={suggestGhostBtn}>Dismiss</button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <textarea
                id="post-copy"
                value={copy}
                maxLength={COPY_MAX}
                onChange={(e) => setCopy(e.target.value)}
                rows={6}
                placeholder="The caption or body text, ready to paste"
                style={{ ...inputStyle, resize: "vertical", minHeight: 120, fontSize: 13.5, lineHeight: 1.45 }}
              />
            )}
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <label style={labelStyle} htmlFor="post-first-comment">First comment</label>
              {/* Its own live count against Instagram's 2200 comment cap, the
                  same information-not-decoration reasoning as Post copy. */}
              <span aria-live="polite" style={{ fontFamily: MONO, fontSize: 12.5, color: firstCommentNearLimit ? "var(--danger)" : "var(--text-muted-2)" }}>
                {firstComment.length.toLocaleString()} / {FIRST_COMMENT_MAX.toLocaleString()}
              </span>
            </div>
            <textarea
              id="post-first-comment"
              value={firstComment}
              maxLength={FIRST_COMMENT_MAX}
              onChange={(e) => setFirstComment(e.target.value)}
              rows={3}
              placeholder="#thehashtags and the follow-up line"
              style={{ ...inputStyle, resize: "vertical", minHeight: 66, fontSize: 13.5, lineHeight: 1.45 }}
            />
            <div style={{ fontSize: 12, color: "var(--text-muted-2)", marginTop: 4 }}>
              Hashtags perform better in the first comment than the caption.
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="post-link">Links</label>
            {links.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {links.map((url) => (
                  <div key={url} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--field)", border: "1px solid var(--hairline)", borderRadius: "var(--r-chip)", padding: "6px 10px" }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--text-muted)" }}>{url}</span>
                    <button
                      type="button"
                      onClick={() => setLinks((l) => l.filter((u) => u !== url))}
                      aria-label={`Remove link ${url}`}
                      style={{ background: "transparent", border: "none", color: "var(--text-muted-2)", cursor: "pointer", fontSize: 13, padding: 2 }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="post-link"
                value={linkDraft}
                maxLength={2000}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitLink(); } }}
                placeholder="https://..."
                style={{ ...inputStyle, flex: 1 }}
              />
              <button type="button" onClick={commitLink} className="btn-ghost-pill" style={{ height: 38, padding: "0 14px", color: "var(--text)" }}>
                Add
              </button>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Placeholder images</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {images.map((url) => (
                <div key={url} style={{ position: "relative", width: 72, height: 72 }}>
                  {/* ClipImage, not a bare img: PostDeck's addImage fills
                      post_images straight from the clip library, so one of these
                      can be an unmirrored pinimg or cdninstagram URL that will
                      403 once its signature expires. A bare img renders that as
                      the browser's broken glyph, which reads as a broken app
                      rather than an expired clip. */}
                  <ClipImage src={url} alt="Post placeholder" compact style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "var(--r-chip)", border: "1px solid var(--hairline)", display: "block", maxWidth: "100%" }} />
                  <button
                    type="button"
                    onClick={() => setImages((imgs) => imgs.filter((u) => u !== url))}
                    aria-label="Remove image"
                    style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "1px solid var(--hairline)", background: "var(--elevated)", color: "#fff", cursor: "pointer", fontSize: 11, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {pendingUploads > 0 && (
                <div aria-label="Uploading" style={{ width: 72, height: 72, borderRadius: "var(--r-chip)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span aria-hidden style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid color-mix(in srgb, currentColor 35%, transparent)", borderTopColor: "currentColor", display: "inline-block", color: "var(--text-muted)", animation: "ctSpin .7s linear infinite" }} />
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Add images"
                style={{ width: 72, height: 72, borderRadius: "var(--r-chip)", border: "1px dashed var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 22 }}
              >
                +
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
              style={{ display: "none" }}
            />
          </div>

          <div>
            <label style={labelStyle}>Colour code</label>
            <div style={{ display: "flex", gap: 8 }}>
              {SECTION_COLORS.map((c) => {
                const active = color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={active}
                    aria-label={`Colour ${c}`}
                    // Toggle off on a second click: null is "no colour", the
                    // default frosted card, and needs to be reachable.
                    onClick={() => setColor(active ? null : c)}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      cursor: "pointer",
                      background: c,
                      border: active ? "2px solid var(--text)" : "1px solid var(--hairline)",
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="post-tag">Tags</label>
            {tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTags((all) => all.filter((x) => x !== t))}
                    aria-label={`Remove tag ${t}`}
                    title="Click to remove"
                    style={{ fontFamily: MONO, fontSize: 12.5, letterSpacing: ".04em", padding: "4px 10px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--field)", color: "var(--text)", cursor: "pointer" }}
                  >
                    {t} ✕
                  </button>
                ))}
              </div>
            )}
            <input
              id="post-tag"
              value={tagDraft}
              maxLength={40}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitTag(); } }}
              placeholder="Type a tag and press Enter"
              style={inputStyle}
            />
          </div>

          {/* ── Account (Nikki, ticket 8003f057): which handles the post goes
              out on. The suggestions are pills that toggle, like Channels;
              any other handle is typed in and kept as a chip, like Tags. ── */}
          <div>
            <label style={labelStyle} htmlFor="post-account">Account</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 8 }}>
              {Array.from(new Set<string>([...POST_ACCOUNT_SUGGESTIONS, ...accounts])).map((a) => {
                const active = accounts.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setAccounts((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a]))}
                    title={active ? "Click to take it off" : "Click to post on this account"}
                    style={{
                      fontFamily: MONO,
                      fontWeight: 500,
                      fontSize: 12.5,
                      letterSpacing: ".05em",
                      padding: "6px 12px",
                      borderRadius: 999,
                      cursor: "pointer",
                      border: active ? "1px solid var(--text)" : "1px solid var(--border)",
                      background: active ? "var(--elevated)" : "var(--field)",
                      color: active ? "#fff" : "var(--text-muted)",
                    }}
                  >
                    @{a}
                  </button>
                );
              })}
            </div>
            <input
              id="post-account"
              value={accountDraft}
              maxLength={60}
              onChange={(e) => setAccountDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitAccount(); } }}
              placeholder="Another account name, then Enter"
              style={inputStyle}
            />
          </div>

          {/* ── Discussion (0063): the comment thread on this post ─────────── */}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
            <label style={labelStyle} htmlFor="post-comment-draft">Discussion</label>
            {!item ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Save the post first to start a discussion.</div>
            ) : (
              <>
                {orderedComments === null ? (
                  !commentsErr && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading the discussion...</div>
                ) : orderedComments.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>No comments yet.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                    {orderedComments.map((c) => (
                      <div
                        key={c.id}
                        style={{
                          background: "var(--field)",
                          border: "1px solid var(--hairline)",
                          borderRadius: "var(--r-chip)",
                          padding: "8px 10px",
                          // Resolved points stay readable but recede; they sort
                          // below the open ones already.
                          opacity: c.resolved_at ? 0.62 : 1,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{c.author_name ?? "Former teammate"}</span>
                          <span style={{ fontFamily: MONO, fontSize: 12.5, color: "var(--text-muted-2)" }}>{timeAgo(c.created_at)}</span>
                          {c.resolved_at && (
                            <span style={{ fontFamily: MONO, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-muted)" }}>Resolved</span>
                          )}
                          <span style={{ flex: 1 }} />
                          <button
                            type="button"
                            onClick={() => void toggleResolve(c)}
                            disabled={commentActionId !== null}
                            style={{ ...commentActionStyle, opacity: commentActionId === c.id ? 0.5 : 1 }}
                          >
                            {c.resolved_at ? "Reopen" : "Resolve"}
                          </button>
                          {uid !== null && c.author_id === uid && (
                            <button
                              type="button"
                              onClick={() => void deleteComment(c)}
                              disabled={commentActionId !== null}
                              style={{ ...commentActionStyle, color: "var(--danger)", opacity: commentActionId === c.id ? 0.5 : 1 }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--text)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 3 }}>
                          {c.body}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {commentsErr && (
                  <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>{commentsErr}</div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <textarea
                    id="post-comment-draft"
                    value={commentDraft}
                    maxLength={COMMENT_MAX}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void postComment();
                      }
                    }}
                    rows={2}
                    placeholder="Write a comment"
                    style={{ ...inputStyle, flex: 1, resize: "vertical", minHeight: 44, fontSize: 13.5, lineHeight: 1.45 }}
                  />
                  <button
                    type="button"
                    onClick={() => void postComment()}
                    disabled={commentBusy || !commentDraft.trim()}
                    className="btn-ghost-pill"
                    style={{ height: 38, padding: "0 14px", color: "var(--text)", opacity: commentBusy ? 0.6 : 1 }}
                  >
                    {commentBusy ? "Posting..." : "Comment"}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted-2)", marginTop: 4 }}>Cmd Enter or Ctrl Enter posts.</div>
              </>
            )}
          </div>

          {/* ── Approval (0063): request, decide, history. Advisory only since
              ticket 656935b3: a review is a record of who signed off, it no
              longer blocks scheduling or posting. ─────────────────────────── */}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
            <label style={labelStyle}>Approval</label>
            {!item ? (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Save the post first to request a review.</div>
            ) : approval === null ? (
              approvalErr ? (
                <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{approvalErr}</div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading the review state...</div>
              )
            ) : (
              <>
                {openRequest ? (
                  openIsMine ? (
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>Waiting on review</div>
                      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                        You asked {timeAgo(openRequest.requested_at)}. A teammate has to make the call on this one.
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
                        {openRequest.requested_by_name ?? "A teammate"} asked for review {timeAgo(openRequest.requested_at)}.
                      </div>
                      <textarea
                        value={decisionNote}
                        maxLength={APPROVAL_NOTE_MAX}
                        onChange={(e) => setDecisionNote(e.target.value)}
                        rows={2}
                        placeholder="Optional note to go with the decision"
                        style={{ ...inputStyle, resize: "vertical", minHeight: 44, fontSize: 13.5, lineHeight: 1.45 }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={() => void decideReview("approved")}
                          disabled={approvalBusy !== "idle"}
                          className="btn-primary-pill"
                          style={{ height: 34, padding: "0 16px", opacity: approvalBusy === "approving" ? 0.7 : 1 }}
                        >
                          {approvalBusy === "approving" ? "Approving..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void decideReview("changes_requested")}
                          disabled={approvalBusy !== "idle"}
                          className="btn-ghost-pill"
                          style={{ height: 34, padding: "0 14px", color: "var(--text)", opacity: approvalBusy === "changes" ? 0.7 : 1 }}
                        >
                          {approvalBusy === "changes" ? "Sending..." : "Request changes"}
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => void requestReview()}
                    disabled={approvalBusy !== "idle"}
                    className="btn-ghost-pill"
                    style={{ height: 34, padding: "0 14px", color: "var(--text)", opacity: approvalBusy === "requesting" ? 0.7 : 1 }}
                  >
                    {approvalBusy === "requesting" ? "Requesting..." : "Request review"}
                  </button>
                )}
                {approvalErr && (
                  <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{approvalErr}</div>
                )}
                {/* Compact trail, newest first (the API's order): who decided
                    what, when, and for whom. The current state IS the top
                    line, so no separate summary repeats it. */}
                {decidedHistory.length > 0 && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                    {decidedHistory.map((a) => (
                      <div key={a.id} style={{ fontFamily: MONO, fontSize: 12.5, color: "var(--text-muted-2)", lineHeight: 1.5, overflowWrap: "anywhere" }}>
                        {a.decision === "approved" ? "Approved" : "Changes requested"} by {a.decided_by_name ?? "a teammate"}{" "}
                        {timeAgo(a.decided_at ?? a.requested_at)}, asked by {a.requested_by_name ?? "a teammate"}
                        {a.note ? <span style={{ color: "var(--text-muted)" }}> : {a.note}</span> : null}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* pinned save row: the body above scrolls, this band does not, so the
            actions never leave the screen however long the discussion gets.
            The error slot rides here for the same reason. */}
        <div style={{ flex: "none", borderTop: "1px solid var(--hairline)", background: "var(--card)", padding: "12px 20px 14px" }}>
          {err && (
            <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>
              {err}
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {item && (
              // Quiet danger, immediate, and deliberately NO confirm step:
              // Mia asked to delete without pressing ok. onSaved() afterwards
              // so the calendar refetches the gap.
              <button
                onClick={() => void remove()}
                disabled={busy !== "idle"}
                className="btn-ghost-pill"
                style={{ height: 36, padding: "0 14px", color: "var(--danger)", opacity: busy === "deleting" ? 0.6 : 1 }}
              >
                {busy === "deleting" ? "Deleting..." : "Delete post"}
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={onClose} className="btn-ghost-pill" style={{ height: 36, padding: "0 16px", color: "var(--text)" }}>
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={busy !== "idle" || pendingUploads > 0}
              className="btn-primary-pill"
              style={{ height: 36, padding: "0 18px", cursor: busy === "saving" || pendingUploads > 0 ? "wait" : "pointer", opacity: busy === "saving" ? 0.85 : 1 }}
            >
              {busy === "saving" ? "Saving..." : pendingUploads > 0 ? "Uploading images..." : item ? "Save post" : "Add post"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
