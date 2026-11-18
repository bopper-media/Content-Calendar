"use client";

import { useEffect, useState } from "react";
import type { ContentPillar, ContentPlan } from "@/lib/content/types";

const MONO = "var(--font-merchant)";

/* ------------------------------------------------------------------ */
/* Dates. Twins of ContentCalendar's ymd helpers (the twins posture in */
/* that file's header): event_date is a plain calendar day, so nothing */
/* here may touch UTC round trips for DISPLAY; the delta maths below   */
/* rides Date.UTC precisely so DST can never make a day 23 hours.      */
/* ------------------------------------------------------------------ */

function parseYmd(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function shortDate(iso: string): string {
  const d = parseYmd(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts);
}

/** Whole days from one YYYY-MM-DD to another, the plans PATCH route's twin. */
function dayDelta(from: string, to: string): number {
  const [y1, m1, d1] = from.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = to.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

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
  padding: "8px 10px",
  fontSize: 13.5,
};

const capsLabel: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 12.5,
  fontWeight: 500,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--text-muted-2)",
};

/**
 * The Plans manager (Mia, 2026-08-15, migration 0085): every plan the
 * calendar knows, with its event date and item count. Renaming is inline;
 * moving the event date always shows the preview line first ("shifts N
 * scheduled items by +/-D days") because the PATCH rewrites dates across the
 * whole plan and nobody should learn that from the grid jumping. Delete only
 * un-groups: the confirm says so, and the API's ON DELETE SET NULL is why it
 * is true.
 *
 * `plans` stays owned by the parent (ContentCalendar fetches the list), so
 * every successful write calls onChanged, which refetches plans AND the
 * items; each row remounts via its key when its plan row changes, clearing
 * the local drafts against fresh truth.
 */
export function PlansPanel({
  plans,
  pillars,
  onChanged,
  onClose,
}: {
  plans: ContentPlan[];
  /** Active pillars, for the series pillar pick (0105). */
  pillars: ContentPillar[];
  /** The calendar's combined refetch (plans + items), awaited so the grid
   *  behind the panel already shows the slide when the row unbusies. */
  onChanged: () => void | Promise<void>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(0,0,0,.45)" }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Content plans"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(560px, 94vw)",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          zIndex: 96,
          background: "var(--card)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--r-panel)",
          boxShadow: "var(--shadow-panel)",
        }}
      >
        {/* Header: the composer's pinned charcoal band. */}
        <div style={{ flex: "none", background: "var(--elevated)", color: "#fff", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".09em", textTransform: "uppercase" }}>
            Plans
          </span>
          <button onClick={onClose} aria-label="Close" style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>

        <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 10, flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
            A series groups calendar items around one event date. Move the date and every scheduled item in the series shifts by the same number of days. Posts join a series from their composer.
          </div>
          <NewSeriesForm pillars={pillars} onChanged={onChanged} />
          {plans.length === 0 ? (
            <div style={{ ...capsLabel, textAlign: "center", padding: "18px 10px", border: "1px dashed var(--border)", borderRadius: "var(--r-lg)", letterSpacing: ".05em" }}>
              No series yet. Start one above, or generate a full run with the Plan button
            </div>
          ) : (
            plans.map((p) => (
              // Keyed on the row's editable truth, so a successful PATCH
              // remounts the row with fresh values and no stale draft.
              <PlanRow key={`${p.id}:${p.name}:${p.event_date}:${p.pillar_id ?? ""}`} plan={p} pillars={pillars} onChanged={onChanged} />
            ))
          )}
        </div>
      </div>
    </>
  );
}

/** Start a bare series (Mia, 2026-08-27: "i should be able to make a new
 *  series, determine the pillar"): name + event date + pillar, zero members.
 *  Posts then join it from their composer, and the row below moves the run. */
function NewSeriesForm({ pillars, onChanged }: { pillars: ContentPillar[]; onChanged: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [pillarId, setPillarId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (busy) return;
    if (!name.trim()) { setErr("Give the series a name."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setErr("Pick the event date."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/v1/content/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), event_date: date, pillar_id: pillarId || null }),
      });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setErr(j?.error?.message ?? "Couldn't create the series. Try again.");
        return;
      }
      setName(""); setDate(""); setPillarId(""); setOpen(false);
      await onChanged();
    } catch {
      setErr("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost-pill" style={{ height: 32, padding: "0 14px", fontSize: 12.5, alignSelf: "flex-start" }}>
        + New series
      </button>
    );
  }
  return (
    <div style={{ border: "1px dashed var(--border)", borderRadius: "var(--r-lg)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 10 }}>
        <div>
          <label style={labelStyle} htmlFor="new-series-name">Series name</label>
          <input id="new-series-name" value={name} maxLength={120} placeholder="e.g. DIGEST THAT VOL 3" disabled={busy} onChange={(e) => { setName(e.target.value); if (err) setErr(null); }} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="new-series-date">Event date</label>
          <input id="new-series-date" type="date" value={date} disabled={busy} onChange={(e) => { setDate(e.target.value); if (err) setErr(null); }} style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle} htmlFor="new-series-pillar">Pillar</label>
        <select id="new-series-pillar" value={pillarId} disabled={busy} onChange={(e) => setPillarId(e.target.value)} style={{ ...inputStyle, height: 36 }}>
          <option value="">No pillar</option>
          {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {err && <div style={{ fontSize: 13, color: "var(--alert)" }}>{err}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn-ghost-pill" disabled={busy} onClick={() => { setOpen(false); setErr(null); }} style={{ height: 30, padding: "0 12px", fontSize: 12.5, color: "var(--text)" }}>
          Cancel
        </button>
        <button type="button" onClick={() => void create()} disabled={busy}
          style={{ background: "var(--btn-primary)", color: "var(--btn-primary-text)", border: "none", borderRadius: "var(--r-pill)", padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Creating..." : "Create series"}
        </button>
      </div>
    </div>
  );
}

/** One plan: name (inline rename), event date (with the shift preview), item
 *  count, pillar, delete. All writes go through the plans API; the row shows
 *  the server's refusal message when there is one rather than guessing. */
function PlanRow({ plan, pillars, onChanged }: { plan: ContentPlan; pillars: ContentPillar[]; onChanged: () => void | Promise<void> }) {
  const [name, setName] = useState(plan.name);
  const [date, setDate] = useState(plan.event_date.slice(0, 10));
  const [pillarId, setPillarId] = useState(plan.pillar_id ?? "");
  const [busy, setBusy] = useState<"idle" | "saving" | "deleting">("idle");
  const [err, setErr] = useState<string | null>(null);

  const renamed = name.trim().length > 0 && name.trim() !== plan.name;
  const repillared = pillarId !== (plan.pillar_id ?? "");
  const delta = /^\d{4}-\d{2}-\d{2}$/.test(date) ? dayDelta(plan.event_date, date) : 0;
  const moved = delta !== 0;
  const dirty = renamed || moved || repillared;

  async function save() {
    if (!dirty || busy !== "idle") return;
    setBusy("saving");
    setErr(null);
    const body: { name?: string; event_date?: string; pillar_id?: string | null } = {};
    if (renamed) body.name = name.trim();
    if (moved) body.event_date = date;
    if (repillared) body.pillar_id = pillarId || null;
    try {
      const res = await fetch(`/api/v1/content/plans/${plan.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setErr(j?.error?.message ?? "Couldn't save the plan. Try again.");
        return;
      }
      await onChanged();
    } catch {
      setErr("Couldn't reach the server. Try again.");
    } finally {
      setBusy("idle");
    }
  }

  async function remove() {
    if (busy !== "idle") return;
    // The API's ON DELETE SET NULL is what makes this copy true: the plan
    // row goes, the items and their dates all stay on the calendar.
    const sure = window.confirm(
      `Delete the plan "${plan.name}"? Its ${plan.item_count} ${plan.item_count === 1 ? "item stays" : "items stay"} on the calendar with their dates; they just stop moving together.`,
    );
    if (!sure) return;
    setBusy("deleting");
    setErr(null);
    try {
      const res = await fetch(`/api/v1/content/plans/${plan.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setErr(j?.error?.message ?? "Couldn't delete the plan. Try again.");
        return;
      }
      await onChanged();
    } catch {
      setErr("Couldn't reach the server. Try again.");
    } finally {
      setBusy("idle");
    }
  }

  return (
    <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, background: "var(--card)", boxShadow: "var(--shadow-card)", opacity: busy === "deleting" ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...capsLabel, color: "var(--text-muted)" }}>
          {shortDate(plan.event_date)}
        </span>
        <span style={{ ...capsLabel, letterSpacing: ".05em" }}>
          {plan.item_count.toLocaleString("en-GB")} {plan.item_count === 1 ? "item" : "items"}, {plan.scheduled_count.toLocaleString("en-GB")} dated
        </span>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy !== "idle"}
          className="btn-ghost-pill"
          style={{ height: 26, padding: "0 10px", fontSize: 12.5, color: "var(--alert)", marginLeft: "auto" }}
        >
          Delete
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 10 }}>
        <div>
          <label style={labelStyle} htmlFor={`plan-name-${plan.id}`}>Name</label>
          <input id={`plan-name-${plan.id}`} value={name} maxLength={120} disabled={busy !== "idle"} onChange={(e) => { setName(e.target.value); if (err) setErr(null); }} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle} htmlFor={`plan-date-${plan.id}`}>Event date</label>
          <input id={`plan-date-${plan.id}`} type="date" value={date} disabled={busy !== "idle"} onChange={(e) => { setDate(e.target.value); if (err) setErr(null); }} style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle} htmlFor={`plan-pillar-${plan.id}`}>Pillar</label>
        <select id={`plan-pillar-${plan.id}`} value={pillarId} disabled={busy !== "idle"} onChange={(e) => { setPillarId(e.target.value); if (err) setErr(null); }} style={{ ...inputStyle, height: 36 }}>
          <option value="">No pillar</option>
          {pillars.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {/* THE PREVIEW LINE: what confirming will actually do to the calendar,
          in numbers, BEFORE the write. scheduled_count is exactly how many
          rows the API's one-statement shift will touch. */}
      {moved && (
        <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5 }}>
          Shifts {plan.scheduled_count.toLocaleString("en-GB")} scheduled {plan.scheduled_count === 1 ? "item" : "items"} by {delta > 0 ? `+${delta}` : delta} {Math.abs(delta) === 1 ? "day" : "days"}. Items without a date stay put.
        </div>
      )}
      {err && <div style={{ fontSize: 13, color: "var(--alert)" }}>{err}</div>}
      {dirty && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            className="btn-ghost-pill"
            disabled={busy !== "idle"}
            onClick={() => { setName(plan.name); setDate(plan.event_date.slice(0, 10)); setErr(null); }}
            style={{ height: 30, padding: "0 12px", fontSize: 12.5, color: "var(--text)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== "idle" || (renamed && name.trim().length === 0)}
            style={{ background: "var(--btn-primary)", color: "var(--btn-primary-text)", border: "none", borderRadius: "var(--r-pill)", padding: "6px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy === "saving" ? 0.6 : 1 }}
          >
            {busy === "saving" ? "Saving..." : moved ? "Confirm the move" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
