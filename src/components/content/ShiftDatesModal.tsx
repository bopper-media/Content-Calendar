"use client";

import { useMemo, useState } from "react";
import type { ContentItem, ContentPlan } from "@/lib/content/types";

const MONO = "var(--font-merchant)";

/** Local date helpers, calendar-day domain only (this folder's convention:
 *  tiny helpers copied, never imported, so files stay independently editable;
 *  scheduled_for is a Postgres `date`, UTC instants invite BST off-by-ones). */
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = b.slice(0, 10).split("-").map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86_400_000);
}
function pretty(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function isWeekend(ymd: string): boolean {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

const field: React.CSSProperties = { height: 34, background: "var(--field)", border: "1px solid var(--border)", borderRadius: "var(--r-chip)", padding: "0 9px", color: "var(--text)", fontSize: 13.5 };
const lbl: React.CSSProperties = { fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--text-muted-2)", display: "block", marginBottom: 4 };

/**
 * SHIFT DATES (Mia, 2026-08-27: "how do i move the event date and then all
 * the content readjusts according to the move?", then "not all content is in
 * this series"). Two modes behind one dialog:
 *
 *  - A SERIES: the plan's members move together off its event date, through
 *    the plans PATCH (move_content_plan, one transaction, all-or-nothing).
 *    This is the normal path; the series knows its own anchor.
 *  - AD-HOC WINDOW: any scheduled item in a date range, previewed row by row
 *    with checkboxes, for content that never joined a series.
 */
export function ShiftDatesModal({ items, plans, onClose, onDone }: {
  items: ContentItem[];
  plans: ContentPlan[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const dated = useMemo(
    () => items.filter((i) => i.scheduled_for).sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? "")),
    [items],
  );

  const today = new Date().toLocaleDateString("en-CA");
  // Default to the series whose event is next to come (that is almost always
  // the one being moved); fall back to the ad-hoc window when none exists.
  const defaultPlan = useMemo(() => {
    const upcoming = [...plans].sort((a, b) => a.event_date.localeCompare(b.event_date));
    return upcoming.find((p) => p.event_date >= today) ?? upcoming[upcoming.length - 1] ?? null;
  }, [plans, today]);

  const [planId, setPlanId] = useState<string>(defaultPlan?.id ?? "");
  const plan = plans.find((p) => p.id === planId) ?? null;

  // The anchor defaults to the next upcoming item literally named the event,
  // else the last dated item; the window opens generously around the cluster.
  const guessAnchor = useMemo(() => {
    const ev = dated.find((i) => /\bevent\b/i.test(i.title ?? "") && !/agenda|recap/i.test(i.title ?? ""));
    return (ev?.scheduled_for ?? dated[dated.length - 1]?.scheduled_for ?? new Date().toISOString()).slice(0, 10);
  }, [dated]);

  const [adhocEventDate, setAdhocEventDate] = useState(guessAnchor);
  const [newDate, setNewDate] = useState((defaultPlan?.event_date ?? guessAnchor).slice(0, 10));
  const [from, setFrom] = useState(shiftYmd(guessAnchor, -42));
  const [to, setTo] = useState(shiftYmd(guessAnchor, 10));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const eventDate = plan ? plan.event_date.slice(0, 10) : adhocEventDate;
  const delta = daysBetween(eventDate, newDate);

  const inWindow = useMemo(
    () => (plan
      ? dated.filter((i) => i.plan_id === plan.id)
      : dated.filter((i) => {
          const d = (i.scheduled_for ?? "").slice(0, 10);
          return d >= from && d <= to;
        })),
    [dated, plan, from, to],
  );
  // A series moves as one (the API shift is a single transaction), so the
  // per-row checkboxes only govern the ad-hoc mode.
  const moving = plan ? inWindow : inWindow.filter((i) => !excluded.has(i.id));

  // Standalone event markers riding a series move (ticket 605f8dff, Mia:
  // "the event is on the 29th and all the content has not shifted... only the
  // content has moved but not the placeholders"). A series' members carry its
  // plan_id, but the dashed date markers added by hand (Add event) have none,
  // so move_content_plan left them on the old dates while the posts moved.
  // Any reminder marker outside every series that sits inside this series'
  // own span (earliest member through its event date, whichever way round)
  // is offered in the preview, ticked by default, and shifted by the same
  // delta straight after the plan PATCH lands.
  const markers = useMemo(() => {
    if (!plan) return [];
    const days = dated.filter((i) => i.plan_id === plan.id).map((i) => (i.scheduled_for ?? "").slice(0, 10));
    const ev = plan.event_date.slice(0, 10);
    const lo = [ev, ...days].reduce((a, b) => (a < b ? a : b));
    const hi = [ev, ...days].reduce((a, b) => (a > b ? a : b));
    return dated.filter((i) => {
      if (i.plan_id || i.plan_role !== "reminder") return false;
      const d = (i.scheduled_for ?? "").slice(0, 10);
      return d >= lo && d <= hi;
    });
  }, [dated, plan]);
  const movingMarkers = markers.filter((i) => !excluded.has(i.id));

  function pickPlan(id: string) {
    setPlanId(id);
    const p = plans.find((x) => x.id === id) ?? null;
    setNewDate((p?.event_date ?? adhocEventDate).slice(0, 10));
    setErr(null);
  }

  async function apply() {
    if (busy || delta === 0) return;
    if (!plan && moving.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = plan
        ? await fetch(`/api/v1/content/plans/${plan.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ event_date: newDate }),
          })
        : await fetch("/api/v1/content/shift", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids: moving.map((i) => i.id), delta_days: delta }),
          });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setErr(j?.error?.message ?? "The shift didn't land. Nothing moved.");
        return;
      }
      // The series is moved; now the ticked standalone markers follow it by
      // the same delta. A failure here leaves the series where it now is (the
      // move is real and correct) and says exactly what still needs a drag.
      if (plan && movingMarkers.length > 0) {
        const mk = await fetch("/api/v1/content/shift", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: movingMarkers.map((i) => i.id), delta_days: delta }),
        }).catch(() => null);
        if (!mk || !mk.ok) {
          await onDone();
          setErr(`${plan.name} moved, but ${movingMarkers.length} event marker${movingMarkers.length === 1 ? "" : "s"} did not. Drag ${movingMarkers.length === 1 ? "it" : "them"} on the calendar.`);
          return;
        }
      }
      await onDone();
      onClose();
    } catch {
      setErr("The request didn't reach the server. Nothing moved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Shift dates" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "color-mix(in srgb, var(--text) 26%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      {/* PHONE (Nikki, 2026-09-21, the phone pass): beside the old and new
          dates a title had a dozen letters ("Supper cl..."). On a phone the
          title takes a line of its own and the dates sit under it. */}
      <style>{`
        @media (max-width: 720px) {
          .sd-row { flex-wrap: wrap; row-gap: 2px !important; }
          .sd-row .sd-title { flex: 1 1 calc(100% - 34px) !important; white-space: normal !important; overflow-wrap: anywhere; }
          .sd-row > span:last-child { flex: 1 1 100%; padding-left: 23px; }
        }
      `}</style>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(660px, 96vw)", maxHeight: "88vh", overflow: "auto", background: "var(--card)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-raise)", padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: "-.01em" }}>Shift dates</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <p className="body-copy" style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px" }}>
          Move an event and every piece of content planned around it in one go. A series moves as one unit off its event date; the ad-hoc window covers content that never joined a series.
        </p>

        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>What moves</label>
          <select value={planId} onChange={(e) => pickPlan(e.target.value)} style={{ ...field, height: 36, minWidth: 260 }}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · event {pretty(p.event_date.slice(0, 10))} · {p.scheduled_count} dated</option>
            ))}
            <option value="">Anything in a date window</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <span>
            <label style={lbl}>Event is on</label>
            {plan ? (
              <span style={{ ...field, display: "inline-flex", alignItems: "center", background: "var(--card)", color: "var(--text-muted)" }}>{pretty(eventDate)}</span>
            ) : (
              <input type="date" value={adhocEventDate} onChange={(e) => setAdhocEventDate(e.target.value)} style={field} />
            )}
          </span>
          <span>
            <label style={lbl}>Moving to</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={field} />
          </span>
          <span style={{ alignSelf: "end", fontFamily: MONO, fontSize: 13, fontWeight: 600, letterSpacing: ".04em", color: delta === 0 ? "var(--text-muted-2)" : "var(--accent)", paddingBottom: 8 }}>
            {delta === 0 ? "No move yet" : delta > 0 ? `+${delta} days later` : `${delta} days earlier`}
          </span>
        </div>

        {!plan && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <span>
              <label style={lbl}>Shift content from</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={field} />
            </span>
            <span>
              <label style={lbl}>To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={field} />
            </span>
          </div>
        )}
        {plan && (
          <p className="body-copy" style={{ fontSize: 12.5, color: "var(--text-muted-2)", margin: "0 0 10px" }}>
            A series moves together, including its undated members&apos; anchor. To hold one post back, open it and take it out of the series first.
          </p>
        )}

        <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--r-card)", marginBottom: 12, maxHeight: 300, overflow: "auto" }}>
          {inWindow.length === 0 ? (
            <div className="body-copy" style={{ padding: "12px 13px", fontSize: 13, color: "var(--text-muted-2)" }}>{plan ? "This series has no scheduled items yet." : "Nothing scheduled in this window."}</div>
          ) : inWindow.map((i) => {
            const oldD = (i.scheduled_for ?? "").slice(0, 10);
            const newD = shiftYmd(oldD, delta);
            const off = !plan && excluded.has(i.id);
            return (
              <label key={i.id} className="sd-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 13px", borderBottom: "1px solid var(--hairline)", cursor: plan ? "default" : "pointer", opacity: off ? 0.45 : 1 }}>
                {!plan && (
                  <input type="checkbox" checked={!off} onChange={() => setExcluded((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} />
                )}
                <span className="sd-title" style={{ flex: 1, minWidth: 0, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title?.trim() || "Untitled post"}</span>
                <span style={{ fontFamily: MONO, fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {pretty(oldD)} → <span style={{ color: delta === 0 ? "var(--text-muted)" : "var(--text)", fontWeight: 600 }}>{pretty(newD)}</span>
                  {delta !== 0 && isWeekend(newD) && <span title="Lands on a weekend" style={{ color: "var(--alert)" }}> · wknd</span>}
                </span>
              </label>
            );
          })}
          {/* The standalone date markers inside the series' span (605f8dff):
              ticked they move with it, unticked they stay; the dashed rule
              and the label say these are placeholders, not members. */}
          {plan && markers.length > 0 && (
            <>
              <div style={{ ...lbl, padding: "9px 13px 4px", borderTop: inWindow.length > 0 ? "1px dashed var(--border)" : undefined, marginBottom: 0 }}>
                Event markers in this window
              </div>
              {markers.map((i) => {
                const oldD = (i.scheduled_for ?? "").slice(0, 10);
                const newD = shiftYmd(oldD, delta);
                const off = excluded.has(i.id);
                return (
                  <label key={i.id} className="sd-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 13px", borderBottom: "1px solid var(--hairline)", cursor: "pointer", opacity: off ? 0.45 : 1 }}>
                    <input type="checkbox" checked={!off} onChange={() => setExcluded((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} />
                    <span className="sd-title" style={{ flex: 1, minWidth: 0, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.title?.trim() || "Event"}</span>
                    <span style={{ fontFamily: MONO, fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {pretty(oldD)} → <span style={{ color: delta === 0 ? "var(--text-muted)" : "var(--text)", fontWeight: 600 }}>{pretty(newD)}</span>
                    </span>
                  </label>
                );
              })}
            </>
          )}
        </div>

        {err && <div className="body-copy" role="alert" style={{ fontSize: 13, color: "var(--danger)", marginBottom: 10 }}>{err}</div>}

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={() => void apply()} disabled={busy || delta === 0 || (!plan && moving.length === 0)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 18px", borderRadius: "var(--r-pill)", border: "none", boxShadow: "var(--shadow-card)", background: "var(--btn-primary)", color: "var(--btn-primary-text)", fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase", cursor: busy || delta === 0 || (!plan && moving.length === 0) ? "default" : "pointer", opacity: busy || delta === 0 || (!plan && moving.length === 0) ? 0.55 : 1 }}>
            {busy ? "Moving…" : plan ? `Move ${plan.name}` : `Move ${moving.length} item${moving.length === 1 ? "" : "s"}`}
          </button>
          <button onClick={onClose} disabled={busy}
            style={{ height: 34, padding: "0 14px", borderRadius: "var(--r-pill)", border: "1px solid var(--border)", background: "var(--field)", color: "var(--text-muted)", fontFamily: MONO, fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
