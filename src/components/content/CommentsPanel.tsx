"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ContentComment } from "@/lib/content/types";
import type { TaskUser } from "@/lib/tasks/types";

/**
 * CommentsPanel (ticket 9f8ba643, Mia 2026-08-18: "change comments to a button
 * on the side like on google docs / slides"): the content_comments thread
 * (0063 + 0081) raised as a right-side slide-in panel over the deck, the
 * Google Docs read. The deck's Comments button toggles it; the { itemId, open,
 * onClose } contract is fixed, the mounting side depends on it.
 *
 * Verbs, per the ticket ("we can edit our own comments, delete or resolve our
 * own or others"): post, edit OWN (the API's author_id where-clause is the
 * real gate, the button here is display gating), delete ANY, resolve or
 * reopen ANY. Resolved comments collapse into a muted group at the top of the
 * list so the live thread stays adjacent to the composer.
 *
 * Mentions: the composer offers an @ picker over the workspace roster (GET
 * /api/v1/tasks answers { users } in the same round trip the Tasks board
 * uses; a failed fetch degrades to the two known first names, which is all
 * the server needs because mentions are re-parsed from the BODY server side,
 * never trusted from the client). The ticket's "they will receive an email"
 * half is deliberately NOT live: the POST route records mentions[] and holds
 * the notify inert behind its own SEND FLAGGED stub. See post() below.
 *
 * Local twins (readErrorMessage, timeAgo, mentionSpans, fieldInput, the
 * identity dot) are deliberate copies of PostDeck's helpers, the PostComposer
 * posture: tiny, and importing them would entangle this file with a component
 * another agent edits.
 */

const MONO = "var(--font-merchant)";

/** Mia's identity pink, the PostDeck inputDot twin (no pink token exists). */
const PINK = "#E85D9E";

/**
 * The two-person workspace, the degraded roster: first names are all the
 * server needs (mentions are matched from the body text server side), and
 * these ids exist only as React keys, they never ride a request.
 */
const FALLBACK_USERS: TaskUser[] = [
  { id: "fallback-mia", full_name: "Mia", email: "" },
  { id: "fallback-nikki", full_name: "Nikki", email: "" },
];

/** Twin of PostDeck's readErrorMessage (house envelope { error: { code, message } }). */
function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

/** Twin of PostDeck's timeAgo: quiet relative stamps, a date past a week. */
function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Twin of PostDeck's mentionSpans: @tokens wear the accent, display only
 *  (the server matched the real names at POST time). */
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

/** The identity dot base colour, the PostDeck inputDot twin. */
function identityDot(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  return first === "mia" ? PINK : first === "nikki" ? "var(--ct-blue-2)" : "var(--text-muted-2)";
}

/**
 * The @handle the picker inserts for a user: the first name unless another
 * teammate shares it, then the compact full name, because the server's
 * mention matcher treats a shared first name as ambiguous for assignment.
 * Lowercase to match the placeholder convention ("@nikki tags a teammate").
 */
function handleOf(u: TaskUser, roster: TaskUser[]): string {
  const first = (u.full_name.trim().split(/\s+/)[0] || "").toLowerCase();
  const shared = roster.some(
    (o) => o.id !== u.id && (o.full_name.trim().split(/\s+/)[0] || "").toLowerCase() === first,
  );
  return shared ? u.full_name.trim().replace(/\s+/g, "").toLowerCase() : first;
}

const fieldInput: React.CSSProperties = {
  width: "100%",
  background: "var(--field)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-chip)",
  padding: "9px 11px",
  fontSize: 14,
};

const quietBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: 12.5,
  color: "var(--text-muted)",
};

const capsHeader: React.CSSProperties = {
  fontFamily: MONO,
  fontWeight: 500,
  fontSize: 12.5,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

export function CommentsPanel({ itemId, open, onClose }: { itemId: string; open: boolean; onClose: () => void }) {
  const [everOpened, setEverOpened] = useState(false);
  const [comments, setComments] = useState<ContentComment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** Display gating only (which cards show Edit); the API is the real gate. */
  const [uid, setUid] = useState<string | null>(null);
  /** null = roster still loading; a failed load lands FALLBACK_USERS. */
  const [users, setUsers] = useState<TaskUser[] | null>(null);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [asAction, setAsAction] = useState(false);
  // Lit only by a response whose action_task_id is real (the SlideComments
  // contract): typing clears it so the line describes the LAST post.
  const [actionNote, setActionNote] = useState(false);

  // The @ picker: caret tracks the textarea's selection, dismissedToken
  // remembers which token Escape hid so typing on re-opens the popup.
  const [caret, setCaret] = useState(0);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  /** Which comment a resolve/reopen/delete is in flight for. */
  const [busyId, setBusyId] = useState<string | null>(null);

  // Writes can settle after a slide turn unmounts this panel; the PostDeck
  // aliveRef posture.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const listRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const bootedRef = useRef(false);

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

  // Every open refetches the thread (cheap, and the other person may have
  // written since); the roster and session load once per mount.
  useEffect(() => {
    if (!open) return;
    setEverOpened(true);
    void load();
    requestAnimationFrame(() => taRef.current?.focus());
    if (bootedRef.current) return;
    bootedRef.current = true;
    // getSession, not getUser: display gating, no network round trip (the
    // PostComposer precedent). A missing session just hides the Edit buttons.
    const supabase = createClient();
    if (supabase) {
      void supabase.auth.getSession().then(({ data }) => {
        if (aliveRef.current) setUid(data.session?.user.id ?? null);
      });
    }
    void (async () => {
      try {
        const res = await fetch("/api/v1/tasks", { cache: "no-store" });
        const body: unknown = await res.json().catch(() => null);
        if (!aliveRef.current) return;
        const raw = (body as { users?: unknown } | null)?.users;
        const list = Array.isArray(raw)
          ? (raw.filter(
              (u) =>
                u &&
                typeof u === "object" &&
                typeof (u as { id?: unknown }).id === "string" &&
                typeof (u as { full_name?: unknown }).full_name === "string",
            ) as TaskUser[])
          : [];
        setUsers(res.ok && list.length > 0 ? list : FALLBACK_USERS);
      } catch {
        if (aliveRef.current) setUsers(FALLBACK_USERS);
      }
    })();
  }, [open, load]);

  // Escape closes the panel (the PostComposer convention). The popup's and
  // the edit box's own Escapes stopPropagation so they win first.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Newest last, so the reading position is the bottom: land there on load
  // and after every post.
  const count = comments?.length ?? 0;
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, count]);

  const roster = users ?? [];

  /** The mention token at the caret ("@ni" -> "ni"), null when none. */
  const mention = useMemo(() => {
    const head = draft.slice(0, caret);
    const m = /(^|[\s([{])@([A-Za-z0-9._-]*)$/.exec(head);
    return m ? m[2].toLowerCase() : null;
  }, [draft, caret]);

  const candidates = useMemo(() => {
    if (mention === null) return [];
    return roster.filter((u) => {
      const full = u.full_name.trim().toLowerCase();
      if (!full) return false;
      return (
        full.startsWith(mention) ||
        full.replace(/\s+/g, "").startsWith(mention) ||
        full.split(/\s+/).some((part) => part.startsWith(mention))
      );
    });
  }, [mention, roster]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mention]);

  const popupVisible = mention !== null && mention !== dismissedToken && candidates.length > 0;

  const insertMention = useCallback(
    (u: TaskUser) => {
      const before = draft.slice(0, caret).replace(/@[A-Za-z0-9._-]*$/, "");
      const next = `${before}@${handleOf(u, roster)} `;
      setDraft(next + draft.slice(caret));
      setDismissedToken(null);
      const pos = next.length;
      setCaret(pos);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(pos, pos);
        }
      });
    },
    [draft, caret, roster],
  );

  const post = useCallback(async () => {
    const clean = draft.trim();
    if (!clean || busy) return;
    setBusy(true);
    setActionNote(false);
    try {
      // The POST route parses @mentions out of the body against the team and
      // records them on the comment (mentions[], 0081). The ticket's "tagged
      // person receives an email" half is HELD at the route's notify point.
      // SEND FLAGGED: needs Mia's approval. Nothing here sends; see the twin
      // stub in /api/v1/content/[id]/comments/route.ts.
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
      setCaret(0);
      setAsAction(false);
      setDismissedToken(null);
      if (typeof (resBody as { action_task_id?: unknown } | null)?.action_task_id === "string") {
        setActionNote(true);
      }
      // Await the refetch so busy holds until the comment is visibly in the
      // thread (the SlideComments reasoning).
      await load();
    } catch {
      if (aliveRef.current) setErr("The request didn't reach the server. Check your connection and try again.");
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [draft, busy, asAction, itemId, load]);

  const saveEdit = useCallback(async () => {
    const clean = editDraft.trim();
    if (!clean || editBusy || editingId === null) return;
    setEditBusy(true);
    try {
      const res = await fetch(`/api/v1/content/${itemId}/comments/${editingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: clean }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!aliveRef.current) return;
      if (!res.ok) {
        setErr(readErrorMessage(body) ?? "The edit did not save. Try again.");
        return;
      }
      setErr(null);
      setEditingId(null);
      await load();
    } catch {
      if (aliveRef.current) setErr("The edit didn't reach the server. Check your connection and try again.");
    } finally {
      if (aliveRef.current) setEditBusy(false);
    }
  }, [editDraft, editBusy, editingId, itemId, load]);

  const toggleResolved = useCallback(
    async (c: ContentComment) => {
      if (busyId !== null) return;
      setBusyId(c.id);
      try {
        const res = await fetch(`/api/v1/content/${itemId}/comments/${c.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resolved: !c.resolved_at }),
        });
        const body: unknown = await res.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!res.ok) {
          setErr(readErrorMessage(body) ?? "That change did not save. Try again.");
          return;
        }
        setErr(null);
        await load();
      } catch {
        if (aliveRef.current) setErr("The request didn't reach the server. Check your connection and try again.");
      } finally {
        if (aliveRef.current) setBusyId(null);
      }
    },
    [busyId, itemId, load],
  );

  // No confirm dialog on purpose, the house delete rule; the API allows any
  // staff in the region (ticket 9f8ba643: "delete ... our own or others").
  const remove = useCallback(
    async (id: string) => {
      if (busyId !== null) return;
      setBusyId(id);
      try {
        const res = await fetch(`/api/v1/content/${itemId}/comments/${id}`, { method: "DELETE" });
        const body: unknown = await res.json().catch(() => null);
        if (!aliveRef.current) return;
        if (!res.ok) {
          setErr(readErrorMessage(body) ?? "The comment could not be deleted. Try again.");
          return;
        }
        setErr(null);
        if (editingId === id) setEditingId(null);
        await load();
      } catch {
        if (aliveRef.current) setErr("The request didn't reach the server. Check your connection and try again.");
      } finally {
        if (aliveRef.current) setBusyId(null);
      }
    },
    [busyId, itemId, editingId, load],
  );

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popupVisible) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(candidates[mentionIndex] ?? candidates[0]);
        return;
      }
      if (e.key === "Escape") {
        // The popup's Escape, not the panel's: stopPropagation keeps the
        // window listener from closing the whole panel.
        e.preventDefault();
        e.stopPropagation();
        setDismissedToken(mention);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void post();
    }
  };

  const onEditKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setEditingId(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void saveEdit();
    }
  };

  // Lazy: nothing renders (or fetches) until the first open; after that the
  // panel stays mounted so the slide transition can play both ways and the
  // thread survives a close/reopen.
  if (!everOpened) return null;

  const active = (comments ?? []).filter((c) => !c.resolved_at);
  const resolved = (comments ?? []).filter((c) => c.resolved_at);

  const renderCard = (c: ContentComment) => {
    const isResolved = Boolean(c.resolved_at);
    const own = uid !== null && c.author_id === uid;
    const rowBusy = busyId === c.id;
    const editing = editingId === c.id;
    return (
      <div key={c.id} style={{ padding: "11px 14px", borderBottom: "1px solid var(--hairline)", opacity: isResolved ? 0.62 : 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
          <span aria-hidden style={{ flex: "none", alignSelf: "center", width: 7, height: 7, borderRadius: "50%", background: identityDot(c.author_name) }} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{c.author_name ?? "Former teammate"}</span>
          <span style={{ fontFamily: MONO, fontSize: 12.5, color: "var(--text-muted-2)" }}>{timeAgo(c.created_at)}</span>
        </div>
        {editing ? (
          <>
            <textarea
              value={editDraft}
              maxLength={4000}
              rows={3}
              autoFocus
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={onEditKey}
              aria-label="Edit comment"
              style={{ ...fieldInput, fontSize: 13, marginTop: 6, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="button"
                className="btn-primary-pill"
                onClick={() => void saveEdit()}
                disabled={editBusy || !editDraft.trim()}
                style={{ height: 26, padding: "0 12px", fontSize: 12.5, opacity: editBusy || !editDraft.trim() ? 0.6 : 1 }}
              >
                {editBusy ? "Saving..." : "Save"}
              </button>
              <button type="button" className="btn-ghost-pill" onClick={() => setEditingId(null)} style={{ height: 26, padding: "0 12px", fontSize: 12.5 }}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginTop: 3 }}>
              {mentionSpans(c.body)}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 5, opacity: rowBusy ? 0.6 : 1 }}>
              <button type="button" style={quietBtn} disabled={rowBusy} onClick={() => void toggleResolved(c)}>
                {isResolved ? "Reopen" : "Resolve"}
              </button>
              {own && !isResolved && (
                <button
                  type="button"
                  style={quietBtn}
                  onClick={() => {
                    setEditingId(c.id);
                    setEditDraft(c.body);
                  }}
                >
                  Edit
                </button>
              )}
              <button type="button" style={{ ...quietBtn, color: "var(--danger)" }} disabled={rowBusy} onClick={() => void remove(c.id)}>
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-label="Comments"
      aria-hidden={!open}
      style={{
        // Fixed over everything including the deck overlay (ContentView
        // raises it at zIndex 94): the panel frosts OVER the slide rather
        // than reflowing it, the BoardHistoryPanel posture.
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(340px, 92vw)",
        zIndex: 120,
        display: "flex",
        flexDirection: "column",
        background: "var(--glass-strong)",
        backdropFilter: "blur(var(--blur))",
        WebkitBackdropFilter: "blur(var(--blur))",
        borderLeft: "1px solid var(--hairline)",
        boxShadow: "var(--shadow-panel)",
        transform: open ? "translateX(0)" : "translateX(105%)",
        transition: "transform .24s ease",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--hairline)", flex: "none" }}>
        <span style={{ ...capsHeader, flex: 1 }}>Comments{active.length > 0 ? ` (${active.length})` : ""}</span>
        <button onClick={onClose} className="btn-ghost-pill" style={{ height: 28, padding: "0 12px", fontSize: 12.5, color: "var(--text-muted)" }}>
          Close
        </button>
      </div>

      <div ref={listRef} style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        {resolved.length > 0 && (
          <details style={{ borderBottom: "1px solid var(--hairline)" }}>
            <summary style={{ ...capsHeader, color: "var(--text-muted-2)", padding: "10px 14px", cursor: "pointer", listStyle: "none" }}>
              Resolved ({resolved.length})
            </summary>
            {resolved.map(renderCard)}
          </details>
        )}
        {comments === null ? (
          !err && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "12px 14px" }}>Loading the comments...</div>
        ) : active.length === 0 ? (
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-muted)", padding: "12px 14px" }}>
            {resolved.length > 0 ? "Every comment here is resolved." : "No comments yet. @ tags a teammate to pull them in."}
          </div>
        ) : (
          active.map(renderCard)
        )}
      </div>

      {err && (
        <div role="alert" style={{ flex: "none", padding: "10px 14px", borderTop: "1px solid var(--hairline)", fontSize: 12.5, lineHeight: 1.5, color: "var(--danger)" }}>
          {err}
        </div>
      )}
      {actionNote && (
        <div role="status" style={{ flex: "none", padding: "8px 14px", fontSize: 12.5, color: "var(--text-muted)" }}>
          Filed on the Tasks board.
        </div>
      )}

      <div style={{ position: "relative", flex: "none", borderTop: "1px solid var(--hairline)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {popupVisible && (
          <div
            role="listbox"
            aria-label="Tag a teammate"
            style={{
              position: "absolute",
              left: 14,
              right: 14,
              bottom: "100%",
              marginBottom: 6,
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-chip)",
              boxShadow: "var(--shadow-raise)",
              overflow: "hidden",
              zIndex: 2,
            }}
          >
            {candidates.map((u, i) => (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                // mousedown, not click: the textarea must keep focus so the
                // caret restore after insert has somewhere to land.
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(u);
                }}
                onMouseEnter={() => setMentionIndex(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 11px",
                  background: i === mentionIndex ? "var(--accent-soft)" : "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <span aria-hidden style={{ flex: "none", width: 7, height: 7, borderRadius: "50%", background: identityDot(u.full_name) }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{u.full_name}</span>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 12.5, color: "var(--text-muted-2)" }}>@{handleOf(u, roster)}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={draft}
          maxLength={4000}
          rows={2}
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            if (actionNote) setActionNote(false);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onComposerKey}
          placeholder="Write a comment. @ tags a teammate"
          aria-label="Write a comment"
          style={{ ...fieldInput, fontSize: 13, resize: "none" }}
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
            className="btn-primary-pill"
            style={{ flex: "none", height: 30, padding: "0 14px", fontSize: 12.5, opacity: busy || !draft.trim() ? 0.6 : 1 }}
          >
            {busy ? "Posting..." : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
