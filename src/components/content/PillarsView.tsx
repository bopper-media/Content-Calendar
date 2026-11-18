"use client";

import { useEffect, useMemo, useState } from "react";
import { SECTION_COLORS, isPlannedPost, type ContentItem, type ContentPillar } from "@/lib/content/types";

/**
 * Marketing > Content, the Pillars tab (Mia, 2026-07-22: the workflow layer,
 * migration 0063). Two jobs on one screen because they are one decision:
 * LEFT manages the vocabulary (create, rename inline, recolour, describe,
 * archive, delete), RIGHT is the strategist's balance check: of the PLANNED
 * POSTS touched in the last 30 days (isPlannedPost; clipped inspiration never
 * counts, ticket 6bf7111d), how many sat under each pillar, with an Unassigned
 * row whenever a real post is missing one so the gap is a bar you can see
 * rather than an absence you would have to infer.
 *
 * Pillars are fetched here (GET /api/v1/content/pillars; archived rows are
 * included by contract and told apart by archived_at). The balance reads
 * straight off the `items` prop, no endpoint of its own: the parent already
 * holds every item for the calendar and pipeline tabs, and updated_at is on
 * every row.
 */

const MONO = "var(--font-merchant)";
type PillarColor = (typeof SECTION_COLORS)[number];

/** Balance window in days. A constant, not an input: the question this view
 *  answers is "what have we ACTUALLY been making lately", and a month is the
 *  cadence the content plan runs on. */
const BALANCE_WINDOW_DAYS = 30;

// Merchant micro-label, 12.5px floor (house rule).
const capsLabel: React.CSSProperties = { fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-muted-2)" };

// Twin of PostComposer's field style, local for the same reason every twin in
// this folder is: sibling views are mid-edit and must not depend on each
// other's internals.
const inputStyle: React.CSSProperties = { width: "100%", background: "var(--field)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--r-chip)", padding: "9px 11px", fontSize: 14 };

/** The house error envelope is { error: { code, message } }, `message` written
 *  server-side to be safe to show (lib/api/response.ts). Twin of
 *  PostComposer's readErrorMessage. */
function readErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== "object") return null;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

/** The pillar routes answer { data: ContentPillar }; walked by hand because a
 *  parsed body is unknown until proven otherwise (the readUploadUrl posture). */
function readPillar(body: unknown): ContentPillar | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  return data as ContentPillar;
}

/** Gate a stored colour to the allow-list before it reaches the DOM (the
 *  SECTION_COLORS contract: a stray value must not inject a style). */
function gateColor(c: string | null): PillarColor | null {
  return c && (SECTION_COLORS as readonly string[]).includes(c) ? (c as PillarColor) : null;
}

/** The GET orders sort asc then name asc; local edits keep the same order so a
 *  rename never shuffles the list differently from the next page load. */
function sortPillars(list: ContentPillar[]): ContentPillar[] {
  return [...list].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export function PillarsView({ items, onChange }: { items: ContentItem[]; onChange: () => void }) {
  // null = still loading, kept apart from loadError so an empty region shows
  // the create form rather than a spinner forever.
  const [pillars, setPillars] = useState<ContentPillar[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // One notice for every mutation: the API writes its refusals to be shown
  // (duplicate names, the pillar-in-use 409) so they land here verbatim.
  const [notice, setNotice] = useState<string | null>(null);
  // Which pillar row has its editor open. One at a time keeps the list calm.
  const [openId, setOpenId] = useState<string | null>(null);

  // The create form.
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState<PillarColor | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/content/pillars");
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          // The 503 not_provisioned names migration 0063; show the server's words.
          setLoadError(readErrorMessage(body) ?? "Pillars could not be loaded. Refresh to try again.");
          return;
        }
        const data = (body as { data?: unknown }).data;
        setPillars(Array.isArray(data) ? sortPillars(data as ContentPillar[]) : []);
      } catch {
        if (!cancelled) setLoadError("Pillars could not be loaded, the request didn't reach the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function create() {
    const name = draftName.trim();
    if (!name) {
      setNotice("Give the pillar a name.");
      return;
    }
    if (creating) return;
    setCreating(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/content/pillars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, color: draftColor }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        // duplicate_name lands here as the API's own sentence.
        setNotice(readErrorMessage(body) ?? "The pillar could not be created. Try again.");
        return;
      }
      const made = readPillar(body);
      if (made) setPillars((prev) => sortPillars([...(prev ?? []), made]));
      setDraftName("");
      setDraftColor(null);
    } catch {
      setNotice("The request didn't reach the server. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  /** Shared PATCH for rename, recolour, describe and archive. Returns whether
   *  the change stuck so inline editors can reset their drafts on refusal (the
   *  notice already says why it was refused). */
  async function patchPillar(id: string, body: { name?: string; color?: PillarColor | null; description?: string | null; archived?: boolean }): Promise<boolean> {
    try {
      const res = await fetch(`/api/v1/content/pillars/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setNotice(readErrorMessage(parsed) ?? "The change could not be saved. Try again.");
        return false;
      }
      const updated = readPillar(parsed);
      if (updated) setPillars((prev) => (prev ? sortPillars(prev.map((p) => (p.id === id ? updated : p))) : prev));
      setNotice(null);
      return true;
    } catch {
      setNotice("The request didn't reach the server. Check your connection and try again.");
      return false;
    }
  }

  /** No confirm step, the house delete posture (PostComposer: delete without
   *  pressing ok). The API is the guard rail: while any item still references
   *  the pillar it answers the pillar_in_use 409, whose message (move or clear
   *  those first, or archive instead) lands in the notice verbatim. */
  async function removePillar(id: string) {
    try {
      const res = await fetch(`/api/v1/content/pillars/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const parsed: unknown = await res.json().catch(() => null);
        setNotice(readErrorMessage(parsed) ?? "The pillar could not be deleted. Try again.");
        return;
      }
      setPillars((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
      setNotice(null);
      // A delete only succeeds when nothing references the pillar, so items
      // did not change server-side; the refetch still runs so the shared list
      // picks up anything a teammate edited in the meantime.
      onChange();
    } catch {
      setNotice("The request didn't reach the server. Check your connection and try again.");
    }
  }

  // ---- Balance, read straight off the items prop. Cards and notes only:
  // sections, text and shapes are board furniture, not content that ships.
  // Gated to PLANNED POSTS on top of that (ticket 6bf7111d: clipped pins were
  // piling into "Unassigned", but clips are inspiration, not content pillars).
  // isPlannedPost is the same rule the pipeline, deck and calendar apply, so
  // this tab counts exactly what those surfaces show. A clip that graduates
  // (gets a date, pillar, copy...) starts counting automatically.
  // The window boundary is frozen at mount (a lazy initializer, so the memo
  // below stays pure): it does not need to tick while the tab is open, and a
  // fresh mount is what "come back tomorrow" already does.
  const [cutoff] = useState(() => new Date().getTime() - BALANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const balance = useMemo(() => {
    const recent = items.filter((i) => {
      if (i.kind !== "card" && i.kind !== "note") return false;
      if (!isPlannedPost(i)) return false;
      const t = Date.parse(i.updated_at);
      return !Number.isNaN(t) && t >= cutoff;
    });
    const byPillar = new Map<string, number>();
    let unassigned = 0;
    const known = new Set((pillars ?? []).map((p) => p.id));
    for (const i of recent) {
      // A pillar_id the fetched list has never heard of (a load failure, a
      // mid-session delete race) counts as unassigned rather than vanishing:
      // the total must always equal the bars.
      if (i.pillar_id && known.has(i.pillar_id)) byPillar.set(i.pillar_id, (byPillar.get(i.pillar_id) ?? 0) + 1);
      else unassigned += 1;
    }
    return { total: recent.length, byPillar, unassigned };
  }, [items, pillars, cutoff]);

  // Bar rows: every live pillar (a zero IS the finding: a promised theme the
  // month did not deliver), archived ones only while old posts still sit under
  // them. Unassigned earns its row last, and ONLY while a genuine planned post
  // is missing a pillar (ticket 6bf7111d): with clips gated out above, a zero
  // there is silence, not a finding.
  const rows = useMemo(() => {
    const list = (pillars ?? [])
      .filter((p) => !p.archived_at || (balance.byPillar.get(p.id) ?? 0) > 0)
      .map((p) => ({
        key: p.id,
        name: p.archived_at ? `${p.name} (archived)` : p.name,
        fill: gateColor(p.color) ?? "var(--text-muted-2)",
        count: balance.byPillar.get(p.id) ?? 0,
      }));
    if (balance.unassigned > 0) list.push({ key: "unassigned", name: "Unassigned", fill: "var(--text-muted-2)", count: balance.unassigned });
    return list;
  }, [pillars, balance]);

  return (
    // Two columns that wrap instead of bleeding: at ~700px the balance drops
    // below the manager and both keep their full width.
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ---- LEFT: manage the vocabulary ---- */}
      <section style={{ flex: "1 1 360px", minWidth: 0, maxWidth: 620, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="flex items-center justify-between" style={{ gap: 8 }}>
          <span style={capsLabel}>Pillars</span>
          {pillars && <span className="count-pill" style={{ fontFamily: MONO }}>{pillars.length.toLocaleString("en-GB")}</span>}
        </div>

        {notice && (
          <div
            role="alert"
            style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "color-mix(in srgb, var(--danger) 9%, var(--card))", border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)", borderRadius: "var(--r-card)", padding: "10px 14px", color: "var(--text)", fontSize: 13, lineHeight: 1.45 }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{notice}</span>
            <button
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 2, flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
        )}

        {loadError ? (
          <div role="alert" style={{ color: "var(--danger)", fontSize: 13, lineHeight: 1.5 }}>{loadError}</div>
        ) : pillars === null ? (
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading pillars...</span>
        ) : (
          <>
            {/* Create. Name is the only requirement; colour is optional and
                clearable, matching the composer's swatch idiom. */}
            <div style={{ background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-card)", boxShadow: "var(--shadow-card)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
              <label htmlFor="pillar-name" style={{ ...capsLabel, color: "var(--text-muted)" }}>New pillar</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="pillar-name"
                  value={draftName}
                  maxLength={80}
                  onChange={(e) => {
                    setDraftName(e.target.value);
                    if (notice) setNotice(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void create();
                    }
                  }}
                  placeholder="Name the theme, e.g. Behind the scenes"
                  style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                />
                <button
                  onClick={() => void create()}
                  disabled={creating}
                  className="btn-primary-pill"
                  style={{ height: 38, padding: "0 16px", flexShrink: 0, opacity: creating ? 0.7 : 1, cursor: creating ? "wait" : "pointer" }}
                >
                  {creating ? "Adding..." : "Add"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {SECTION_COLORS.map((c) => {
                  const active = draftColor === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={active}
                      aria-label={`Colour ${c}`}
                      // Second click clears: colourless is a real state.
                      onClick={() => setDraftColor(active ? null : c)}
                      style={{ width: 22, height: 22, borderRadius: "50%", cursor: "pointer", background: c, border: active ? "2px solid var(--text)" : "1px solid var(--hairline)" }}
                    />
                  );
                })}
                <span style={{ fontFamily: MONO, fontSize: 12.5, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted-2)" }}>
                  {draftColor ? "Colour picked" : "Optional colour"}
                </span>
              </div>
            </div>

            {pillars.map((p) => (
              <PillarRow
                // The server-held name and description ride in the key so a
                // committed (or teammate) change remounts the row and reseeds
                // its local drafts; no resync effects needed. The id prefix
                // keeps keys unique whatever the text contains.
                key={`${p.id}:${p.name}:${p.description ?? ""}`}
                pillar={p}
                open={openId === p.id}
                onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
                onPatch={(body) => patchPillar(p.id, body)}
                onDelete={() => void removePillar(p.id)}
              />
            ))}
            {pillars.length === 0 && (
              <div style={{ fontFamily: MONO, fontSize: 12.5, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted-2)", textAlign: "center", padding: "14px 8px", border: "1px dashed var(--border)", borderRadius: "var(--r-chip)", lineHeight: 1.6 }}>
                No pillars yet. Name the first recurring theme above.
              </div>
            )}
          </>
        )}
      </section>

      {/* ---- RIGHT: the balance ---- */}
      <section style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 10, gap: 8 }}>
          <span style={capsLabel}>Balance, last {BALANCE_WINDOW_DAYS} days</span>
          <span className="count-pill" style={{ fontFamily: MONO }}>{balance.total.toLocaleString("en-GB")}</span>
        </div>
        <div style={{ background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-card)", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 13 }}>
          <p style={{ fontSize: 12.5, color: "var(--text-muted-2)", margin: 0, lineHeight: 1.5 }}>
            Every planned post updated in the last {BALANCE_WINDOW_DAYS} days, by pillar. Clipped inspiration is not counted. A pillar sitting at zero is a theme the plan promised and the month did not deliver.
          </p>
          {balance.total === 0 && (
            <div style={{ fontFamily: MONO, fontSize: 12.5, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted-2)", textAlign: "center", padding: "12px 8px", border: "1px dashed var(--border)", borderRadius: "var(--r-chip)" }}>
              No posts touched in the window yet
            </div>
          )}
          {rows.map((row) => (
            <BalanceRow key={row.key} name={row.name} fill={row.fill} count={row.count} total={balance.total} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** One pillar in the manager. The name is always an inline editor (click and
 *  type, commit on blur or Enter, Escape restores); the chevron opens the rest
 *  of the controls so the resting list stays a quiet roll call. */
function PillarRow({
  pillar,
  open,
  onToggle,
  onPatch,
  onDelete,
}: {
  pillar: ContentPillar;
  open: boolean;
  onToggle: () => void;
  onPatch: (body: { name?: string; color?: PillarColor | null; description?: string | null; archived?: boolean }) => Promise<boolean>;
  onDelete: () => void;
}) {
  // Local drafts so typing does not PATCH per keystroke; committed on blur.
  // Reseeding when the server value changes is the parent's job: name and
  // description ride in this row's key, so a committed change remounts it
  // (the sanctioned alternative to a setState-in-effect resync).
  const [name, setName] = useState(pillar.name);
  const [desc, setDesc] = useState(pillar.description ?? "");

  const archived = pillar.archived_at !== null;
  const tint = gateColor(pillar.color);

  function commitName() {
    const clean = name.trim();
    if (!clean || clean === pillar.name) {
      setName(pillar.name); // empty or unchanged: put the stored name back
      return;
    }
    void onPatch({ name: clean }).then((ok) => {
      // A refusal (duplicate name) already explained itself in the notice;
      // the field falls back to what the server still holds.
      if (!ok) setName(pillar.name);
    });
  }

  function commitDesc() {
    const clean = desc.trim();
    if (clean === (pillar.description ?? "")) return;
    void onPatch({ description: clean || null }).then((ok) => {
      if (!ok) setDesc(pillar.description ?? "");
    });
  }

  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-card)", boxShadow: "var(--shadow-card)", padding: "9px 12px", opacity: archived ? 0.65 : 1 }}>
      <div className="flex items-center" style={{ gap: 9 }}>
        {/* Colourless pillars keep the dot's footprint as a dashed ring, so
            names stay aligned down the list. */}
        <span aria-hidden style={{ width: 11, height: 11, borderRadius: "50%", flexShrink: 0, background: tint ?? "transparent", border: tint ? "1px solid transparent" : "1px dashed var(--border)" }} />
        <input
          value={name}
          maxLength={80}
          aria-label={`Rename ${pillar.name}`}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setName(pillar.name);
              e.currentTarget.blur();
            }
          }}
          style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", fontSize: 14, fontWeight: 600, letterSpacing: "-.01em", color: "var(--text)", padding: "3px 2px" }}
        />
        {archived && (
          <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--text-muted-2)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: "1px 9px", flexShrink: 0 }}>
            Archived
          </span>
        )}
        <button
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? "Close" : "Edit"} ${pillar.name}`}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12.5, padding: "2px 5px", flexShrink: 0 }}
        >
          {open ? "▾" : "▸"}
        </button>
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--divider)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {SECTION_COLORS.map((c) => {
              const active = pillar.color === c;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  aria-label={`Colour ${c}`}
                  // Recolour writes immediately; a second click on the lit
                  // swatch clears back to colourless (the composer idiom).
                  onClick={() => void onPatch({ color: active ? null : c })}
                  style={{ width: 22, height: 22, borderRadius: "50%", cursor: "pointer", background: c, border: active ? "2px solid var(--text)" : "1px solid var(--hairline)" }}
                />
              );
            })}
          </div>
          <textarea
            value={desc}
            maxLength={1000}
            rows={2}
            aria-label={`Describe ${pillar.name}`}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={commitDesc}
            placeholder="What belongs under this pillar?"
            style={{ ...inputStyle, fontSize: 13, lineHeight: 1.45, resize: "vertical", minHeight: 52 }}
          />
          <div className="flex items-center" style={{ gap: 8 }}>
            <button onClick={() => void onPatch({ archived: !archived })} className="btn-ghost-pill" style={{ height: 30, padding: "0 12px", fontSize: 12.5, color: "var(--text)" }}>
              {archived ? "Unarchive" : "Archive"}
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={onDelete} className="btn-ghost-pill" style={{ height: 30, padding: "0 12px", fontSize: 12.5, color: "var(--danger)" }}>
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One share bar. The track is always full width so bars compare by eye; the
 *  fill is the pillar's gated colour, neutral for Unassigned. */
function BalanceRow({ name, fill, count, total }: { name: string; fill: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between" style={{ gap: 8, marginBottom: 4 }}>
        <span className="flex items-center" style={{ gap: 6, minWidth: 0 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: fill, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12.5, color: "var(--text-muted-2)", flexShrink: 0 }}>
          {count.toLocaleString("en-GB")} · {pct}%
        </span>
      </div>
      <div style={{ height: 10, background: "var(--field)", border: "1px solid var(--hairline)", borderRadius: "var(--r-pill)", overflow: "hidden" }}>
        <div style={{ width: `${total > 0 ? (count / total) * 100 : 0}%`, height: "100%", background: fill, borderRadius: "var(--r-pill)", transition: "width .25s" }} />
      </div>
    </div>
  );
}
