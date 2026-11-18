"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONTENT_EVENT_CATEGORIES,
  PLAN_ROLE_LABELS,
  POST_CHANNELS,
  isEventCategory,
  isPlanRole,
  isPostChannel,
  type ContentEventCategory,
  type ContentItemInput,
  type ContentPillar,
  type PlanRole,
  type PostChannel,
} from "@/lib/content/types";

const MONO = "var(--font-merchant)";

/** Twin of the calendar's CHANNEL_LABELS (the twins posture in that file's
 *  header: tiny helpers copied, never imported, so the files stay
 *  unentangled). */
const CHANNEL_LABELS: Record<PostChannel, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  email: "Email",
  website: "Website",
  other: "Other",
};

/** The hard ceiling on one Plan run, shared by every path into the preview. */
const MAX_ITEMS = 60;

/* ------------------------------------------------------------------ */
/* Dates. Twins of ContentCalendar's ymd/parseYmd: scheduled_for is a  */
/* plain calendar day, so nothing here may touch UTC round trips.      */
/* ------------------------------------------------------------------ */

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** The Monday of the week `d` sits in, at local midnight. */
function mondayOf(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // Mon=0
  return addDays(d, -offset);
}

/** Short local day for the preview rows ("22 Oct", year only when not this
 *  year), the calendar's shortDate twin. */
function shortDate(iso: string): string {
  const d = parseYmd(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts);
}

/**
 * Which weekdays (Mon=0) a week's posts land on, per posts-per-week. Chosen so
 * a light week reads like a real content schedule (midweek posts, spaced out)
 * rather than a Monday pile-up.
 */
const WEEKDAY_PATTERNS: Record<number, number[]> = {
  1: [1],
  2: [1, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

/** One row of the preview, the exact fields a confirm will create with. */
interface PlanDraft {
  date: string; // YYYY-MM-DD
  title: string;
  channels: PostChannel[];
  pillar_id: string | null;
  event_category: ContentEventCategory | null;
  /** Mia's plan taxonomy (migration 0085): post | newsletter | reminder.
   *  Everything defaults to 'post'; only a CSV cell or an AI cue says
   *  otherwise. */
  role: PlanRole;
}

/* ------------------------------------------------------------------ */
/* Deterministic CSV parsing (must work with zero AI): date,title      */
/* [,channel][,pillar] per line, quoted cells respected.               */
/* ------------------------------------------------------------------ */

/** Split one CSV line into cells, honouring double-quoted cells. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Read a date cell into YYYY-MM-DD, or null. Accepts ISO (2026-10-22), UK
 * numeric (22/10/2026, 22/10/26), and day-month words ("22 Oct", "22 October
 * 2026", "Oct 22"). A year-less date means the next occurrence on or after
 * today, matching how the plan brief reads ("the 22nd of october").
 */
function parseDateCell(raw: string, todayYmd: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : ymd(d);
  }

  const uk = s.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/);
  if (uk) {
    const day = Number(uk[1]);
    const month = Number(uk[2]) - 1;
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    if (uk[3]) {
      const year = uk[3].length === 2 ? 2000 + Number(uk[3]) : Number(uk[3]);
      const d = new Date(year, month, day);
      return d.getMonth() === month ? ymd(d) : null;
    }
    return nextOccurrence(day, month, todayYmd);
  }

  // "22 Oct", "22nd October 2026", "Oct 22"
  const dayFirst = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-zA-Z]+)(?:\s+(\d{4}))?$/);
  const monthFirst = s.match(/^([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/);
  const m = dayFirst ?? monthFirst;
  if (m) {
    const day = Number(dayFirst ? m[1] : m[2]);
    const monthWord = (dayFirst ? m[2] : m[1]).toLowerCase().slice(0, 4);
    const month = MONTH_NAMES[monthWord] ?? MONTH_NAMES[monthWord.slice(0, 3)];
    if (month === undefined || day < 1 || day > 31) return null;
    if (m[3]) {
      const d = new Date(Number(m[3]), month, day);
      return d.getMonth() === month ? ymd(d) : null;
    }
    return nextOccurrence(day, month, todayYmd);
  }
  return null;
}

/** The next day-and-month on or after today, rolling to next year if past. */
function nextOccurrence(day: number, month: number, todayYmd: string): string | null {
  const today = parseYmd(todayYmd);
  let d = new Date(today.getFullYear(), month, day);
  if (d.getMonth() !== month) return null; // e.g. 31 Feb
  if (ymd(d) < todayYmd) d = new Date(today.getFullYear() + 1, month, day);
  return d.getMonth() === month ? ymd(d) : null;
}

/** A channel cell to a PostChannel, matching value or label case-blind. */
function parseChannelCell(raw: string): PostChannel | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (isPostChannel(s)) return s;
  const byLabel = POST_CHANNELS.find((c) => CHANNEL_LABELS[c].toLowerCase() === s);
  return byLabel ?? null;
}

/** A role cell to a PlanRole (migration 0085), exact token case-blind. Kept
 *  strict on purpose, this is the deterministic path: cue words like
 *  "deadline" belong to the AI path, not here. */
function parseRoleCell(raw: string): PlanRole | null {
  const s = raw.trim().toLowerCase();
  return isPlanRole(s) ? s : null;
}

/* ------------------------------------------------------------------ */
/* Styles: the PostComposer's field idiom, copied (twins posture).     */
/* ------------------------------------------------------------------ */

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

const primaryBtn: React.CSSProperties = {
  background: "var(--btn-primary)",
  color: "var(--btn-primary-text)",
  border: "none",
  borderRadius: "var(--r-pill)",
  padding: "9px 18px",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
};

/** The role as a small chip on a preview row (migration 0085): reminder wears
 *  the alert family (it is a date to heed, not a post to draft), newsletter a
 *  subtle accent tint, and plain posts stay quiet so the unusual roles are
 *  the ones that stand out. Merchant caps at the 12.5 floor. */
function RoleChip({ role }: { role: PlanRole }) {
  const colours: React.CSSProperties =
    role === "reminder"
      ? { background: "color-mix(in srgb, var(--alert) 12%, var(--card))", border: "1px solid color-mix(in srgb, var(--alert) 45%, var(--border))", color: "color-mix(in srgb, var(--alert) 65%, var(--text))" }
      : role === "newsletter"
        ? { background: "color-mix(in srgb, var(--accent) 12%, var(--card))", border: "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))", color: "color-mix(in srgb, var(--accent) 65%, var(--text))" }
        : { background: "var(--field)", border: "1px solid var(--border)", color: "var(--text-muted-2)" };
  return (
    <span style={{ flex: "none", fontFamily: MONO, fontWeight: 500, fontSize: 12.5, letterSpacing: ".05em", textTransform: "uppercase", padding: "1px 8px", borderRadius: "var(--r-pill)", ...colours }}>
      {PLAN_ROLE_LABELS[role]}
    </span>
  );
}

const channelPill = (active: boolean): React.CSSProperties => ({
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
  color: active ? "var(--on-elevated)" : "var(--text-muted)",
  transition: "background .12s, color .12s, border-color .12s",
});

/**
 * The Plan modal (Mia's ticket 7077ab09): two ways to fill a stretch of the
 * calendar with post placeholders in one sitting.
 *
 * QUICK GENERATOR is fully deterministic (works with zero AI): event name +
 * date, weeks of run-up, posts per week, channels, optional pillar and event
 * category. Placeholders spread across the run-up weeks on sensible weekdays.
 *
 * IMPORT / PROMPT takes pasted lists or CSV, calendar/GTM screenshots, and an
 * optional freeform brief. CSV parses deterministically client-side; anything
 * else goes through POST /api/v1/content/plan (the shared AI plumbing).
 *
 * BOTH paths land in the same preview, and NOTHING is created until the
 * confirm: each confirmed row is POSTed through the ordinary /api/v1/content
 * create route (the Add post path), so validation and defaults stay one story.
 */
export function PlanModal({
  pillars,
  onCreated,
  onClose,
}: {
  /** Active pillars for the pillar pick and for mapping AI/CSV names to ids. */
  pillars: ContentPillar[];
  /** The calendar's refetch, awaited before close so the new rows are in. */
  onCreated: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"generate" | "import">("generate");

  // Quick generator fields.
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [weeks, setWeeks] = useState(4);
  const [perWeek, setPerWeek] = useState(2);
  const [channels, setChannels] = useState<PostChannel[]>([]);
  const [pillarId, setPillarId] = useState<string>("");
  const [category, setCategory] = useState<string>("");

  // Import / prompt fields.
  const [pasted, setPasted] = useState("");
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<{ name: string; media_type: string; data: string }[]>([]);
  const [aiBusy, setAiBusy] = useState(false);

  // The shared preview-confirm-create tail.
  const [drafts, setDrafts] = useState<PlanDraft[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState(0);

  // The PLAN the confirm will group these items under (migration 0085): a
  // name and THE event date, so a slipped event slides every member together.
  // The quick generator prefills both from its own fields; the import path
  // starts them blank and both stay editable on the preview. Blank name or no
  // date = no plan, items land free-standing exactly as before.
  const [planName, setPlanName] = useState("");
  const [planDate, setPlanDate] = useState("");

  const todayYmd = ymd(new Date());
  const pillarById = useMemo(() => new Map(pillars.map((p) => [p.id, p])), [pillars]);
  const pillarByName = useMemo(() => new Map(pillars.map((p) => [p.name.toLowerCase(), p.id])), [pillars]);

  const nameRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [creating, onClose]);

  /** GENERATE: the deterministic run-up spread. Weeks count back from (and
   *  include) the event's own week; days on/after the event or before today
   *  are dropped, so what lands is exactly the usable run-up. */
  function generate() {
    setErr(null);
    const name = eventName.trim();
    if (!name) { setErr("Give the event a name."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) { setErr("Pick the event date."); return; }
    if (eventDate <= todayYmd) { setErr("The event date needs to be in the future."); return; }
    const pattern = WEEKDAY_PATTERNS[Math.min(7, Math.max(1, perWeek))];
    const eventMonday = mondayOf(parseYmd(eventDate));
    const dates: string[] = [];
    for (let w = Math.min(12, Math.max(1, weeks)) - 1; w >= 0; w--) {
      const weekMonday = addDays(eventMonday, -7 * w);
      for (const off of pattern) {
        const day = ymd(addDays(weekMonday, off));
        if (day < todayYmd || day >= eventDate) continue;
        dates.push(day);
        if (dates.length >= MAX_ITEMS) break;
      }
      if (dates.length >= MAX_ITEMS) break;
    }
    if (dates.length === 0) {
      setErr("That run-up has no usable days before the event. Try more weeks or a later date.");
      return;
    }
    setSkipped(0);
    // The generator IS an event with a date, so the plan fields prefill from
    // it; quick-generated placeholders are ordinary posts by definition.
    // Sliced to the plans API's 120 ceiling: the event name field admits 200,
    // and the input's own maxLength only stops TYPING, not a prefill, so an
    // unsliced long name would 422 the whole confirm later.
    setPlanName(name.slice(0, 120));
    setPlanDate(eventDate);
    setDrafts(dates.map((date, i) => ({
      date,
      title: `${name} - post ${i + 1}`,
      channels: [...channels],
      pillar_id: pillarId || null,
      event_category: isEventCategory(category) ? category : null,
      role: "post",
    })));
  }

  /** IMPORT, deterministic path: parse the pasted lines as CSV. */
  function parseCsv() {
    setErr(null);
    const lines = pasted.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) { setErr("Paste some rows first (date, title, optional channel, optional pillar)."); return; }
    const out: PlanDraft[] = [];
    let dropped = 0;
    for (const [i, line] of lines.entries()) {
      const cells = splitCsvLine(line);
      // A header row names its columns rather than dating them.
      if (i === 0 && /date/i.test(cells[0] ?? "") && /title|post|desc/i.test(cells[1] ?? "")) continue;
      const date = parseDateCell(cells[0] ?? "", todayYmd);
      const title = (cells[1] ?? "").trim().slice(0, 300);
      if (!date || !title) { dropped++; continue; }
      // The optional cells after title carry channel, pillar and/or role in
      // any order (a reminders-only CSV is naturally "date, title, reminder").
      // Role tokens are matched first because a pillar could be NAMED
      // "Newsletter", and the exact taxonomy word should win over a name
      // collision; each slot takes its first hit only.
      let channel: PostChannel | null = null;
      let pillar: string | null = null;
      let role: PlanRole | null = null;
      for (const cell of cells.slice(2)) {
        const c = cell.trim();
        if (!c) continue;
        const asRole = parseRoleCell(c);
        if (asRole && !role) { role = asRole; continue; }
        const asChannel = parseChannelCell(c);
        if (asChannel && !channel) { channel = asChannel; continue; }
        if (!pillar) pillar = pillarByName.get(c.toLowerCase()) ?? null;
      }
      out.push({ date, title, channels: channel ? [channel] : [], pillar_id: pillar, event_category: null, role: role ?? "post" });
      if (out.length >= MAX_ITEMS) break;
    }
    if (out.length === 0) { setErr("No rows had a readable date and title. Expected: date, title, optional channel, optional pillar."); return; }
    setSkipped(dropped);
    setDrafts(out);
  }

  /** IMPORT, AI path: text and/or images plus the brief through the server. */
  async function parseWithAi() {
    setErr(null);
    if (!pasted.trim() && !prompt.trim() && images.length === 0) {
      setErr("Paste some text, write a prompt, or attach a screenshot first.");
      return;
    }
    // The request has to fit the serverless body ceiling (the route enforces
    // the same total), so say so here rather than 422ing after the upload.
    if (images.reduce((sum, img) => sum + img.data.length, 0) > 4_200_000) {
      setErr("Those screenshots are too large together. Keep the total under about 3MB, or send fewer at once.");
      return;
    }
    setAiBusy(true);
    try {
      const res = await fetch("/api/v1/content/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: pasted.trim() || null,
          prompt: prompt.trim() || null,
          images: images.map((img) => ({ media_type: img.media_type, data: img.data })),
        }),
      });
      const j = (await res.json().catch(() => null)) as
        | { data?: Array<{ date: string; title: string; channel: string | null; pillar: string | null; event_category: string | null; role: string | null }>; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setErr(j?.error?.message ?? "The AI import didn't come back. Try again, or use the CSV path.");
        return;
      }
      const items = Array.isArray(j?.data) ? j.data : [];
      if (items.length === 0) {
        setErr("Nothing plannable came back. Add more detail to the prompt or check the pasted material.");
        return;
      }
      setSkipped(0);
      setDrafts(items.slice(0, MAX_ITEMS).map((it) => ({
        date: it.date,
        title: it.title,
        channels: isPostChannel(it.channel) ? [it.channel] : [],
        pillar_id: it.pillar ? (pillarByName.get(it.pillar.toLowerCase()) ?? null) : null,
        event_category: isEventCategory(it.event_category) ? it.event_category : null,
        // The server pins role to PLAN_ROLES already; the gate here is the
        // ordinary don't-trust-the-wire posture, and null means 'post'.
        role: isPlanRole(it.role) ? it.role : "post",
      })));
    } catch {
      setErr("The AI import didn't reach the server. Try again.");
    } finally {
      setAiBusy(false);
    }
  }

  /** Attach files: CSVs land in the textarea (deterministic path), images are
   *  base64d for the AI path. */
  function onFiles(files: FileList | null) {
    if (!files) return;
    setErr(null);
    for (const file of Array.from(files)) {
      if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
        void file.text().then((text) => {
          setPasted((prev) => (prev.trim() ? `${prev.trimEnd()}\n${text.trim()}` : text.trim()));
        });
        continue;
      }
      if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
        if (file.size > 3_000_000) {
          setErr(`${file.name} is over 3MB. Screenshot a smaller area or compress it.`);
          continue;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const url = String(reader.result ?? "");
          const comma = url.indexOf(",");
          if (comma < 0) return;
          setImages((prev) =>
            prev.length >= 3 ? prev : [...prev, { name: file.name, media_type: file.type, data: url.slice(comma + 1) }],
          );
        };
        reader.readAsDataURL(file);
        continue;
      }
      setErr(`${file.name} isn't a CSV or an image.`);
    }
  }

  /** CONFIRM: create every remaining draft through the ordinary content
   *  create route, one row per request, so validation and defaults are the
   *  same as Add post. Sequential on purpose: 60 parallel inserts is a spike
   *  the preview never warned anyone about.
   *
   *  When the plan fields are filled, the PLAN is created FIRST (migration
   *  0085) and every item is stamped with plan_id + its role, which is what
   *  lets a slipped event date slide the whole run later. A refused plan
   *  create stops the whole confirm rather than quietly landing ungrouped
   *  items: the grouping is the point, and un-grouped rows would need
   *  re-creating to get it back. */
  async function createAll() {
    if (!drafts || drafts.length === 0 || creating) return;
    const nameFilled = planName.trim().length > 0;
    const wantPlan = nameFilled && /^\d{4}-\d{2}-\d{2}$/.test(planDate);
    // A named plan NEEDS its event date: quietly creating ungrouped items when
    // only the date box was missed would throw away the grouping the name
    // asked for, and re-creating the run is the only way to get it back.
    if (nameFilled && !wantPlan) {
      setErr("Pick the plan's event date, or clear the plan name to create the items without one.");
      return;
    }
    setCreating(true);
    setErr(null);
    let planId: string | null = null;
    if (wantPlan) {
      try {
        const res = await fetch("/api/v1/content/plans", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: planName.trim(), event_date: planDate }),
        });
        const j: unknown = await res.json().catch(() => null);
        const data = j && typeof j === "object" ? (j as { data?: { id?: unknown } }).data : null;
        planId = res.ok && data && typeof data.id === "string" ? data.id : null;
      } catch {
        planId = null;
      }
      if (!planId) {
        setErr("Couldn't create the plan, so nothing was created. Try again, or clear the plan name to create the items without one.");
        setCreating(false);
        return;
      }
    }
    let failed = 0;
    for (const [i, d] of drafts.entries()) {
      setProgress(i + 1);
      const body: ContentItemInput = {
        kind: "card",
        source: "manual",
        status: "idea",
        title: d.title,
        scheduled_for: d.date,
        post_channels: d.channels,
        post_channel: d.channels[0] ?? null,
        pillar_id: d.pillar_id,
        event_category: d.event_category,
        // Stamped even without a plan: a reminder is a reminder whether or
        // not it is grouped. plan_id only when the plan create succeeded.
        plan_id: planId,
        plan_role: d.role,
      };
      try {
        const res = await fetch("/api/v1/content", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
    }
    await onCreated();
    setCreating(false);
    if (failed > 0) {
      setErr(`${drafts.length - failed} created, ${failed} failed. The calendar shows what landed.`);
      setDrafts(null);
      return;
    }
    onClose();
  }

  const sortedDrafts = useMemo(
    () => (drafts ? [...drafts].sort((a, b) => a.date.localeCompare(b.date)) : null),
    [drafts],
  );

  const tabBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: MONO,
    fontWeight: 500,
    fontSize: 12.5,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    padding: "5px 13px",
    borderRadius: "var(--r-pill)",
    border: "none",
    cursor: "pointer",
    background: active ? "var(--btn-primary)" : "transparent",
    color: active ? "var(--btn-primary-text)" : "var(--text-muted)",
    boxShadow: active ? "var(--shadow-card)" : "none",
  });

  return (
    <>
      <div onClick={() => { if (!creating) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(0,0,0,.45)" }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Plan posts"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(620px, 94vw)",
          maxHeight: "90vh",
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
            {sortedDrafts ? "Preview the plan" : "Plan posts"}
          </span>
          <button onClick={() => { if (!creating) onClose(); }} aria-label="Close" style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", width: 28, height: 28, borderRadius: "50%", cursor: "pointer", fontSize: 15, opacity: creating ? 0.5 : 1 }}>✕</button>
        </div>

        <div style={{ padding: "18px 20px 22px", display: "flex", flexDirection: "column", gap: 14, flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain" }}>
          {sortedDrafts ? (
            <>
              {/* THE PREVIEW: what a confirm will create, nothing else. */}
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                {sortedDrafts.length} placeholder {sortedDrafts.length === 1 ? "item" : "items"}, status Idea. Nothing is created until you confirm.
                {skipped > 0 && ` ${skipped} pasted ${skipped === 1 ? "line was" : "lines were"} skipped (no readable date and title).`}
              </div>
              {/* THE PLAN (migration 0085): group what lands under one event
                  date so the whole run slides if that date moves. Prefilled
                  by the quick generator; optional on the import path. Blank
                  name or no date = no plan, items land free-standing. */}
              <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
                  <div>
                    <label style={labelStyle} htmlFor="plan-group-name">Plan name</label>
                    <input id="plan-group-name" value={planName} maxLength={120} disabled={creating} onChange={(e) => { setPlanName(e.target.value); if (err) setErr(null); }} placeholder="Leave blank for no plan" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle} htmlFor="plan-group-date">Event date</label>
                    <input id="plan-group-date" type="date" value={planDate} disabled={creating} onChange={(e) => { setPlanDate(e.target.value); if (err) setErr(null); }} style={inputStyle} />
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted-2)", lineHeight: 1.5 }}>
                  Items in a plan move together: change the plan&apos;s event date later and every dated item shifts by the same number of days.
                </div>
              </div>
              <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
                <div style={{ maxHeight: "44vh", overflowY: "auto" }}>
                  {sortedDrafts.map((d, i) => (
                    <div key={`${d.date}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: i < sortedDrafts.length - 1 ? "1px solid var(--divider)" : "none" }}>
                      <span style={{ flex: "0 0 96px", fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                        {shortDate(d.date)}
                      </span>
                      <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: 13.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.title}
                      </span>
                      <RoleChip role={d.role} />
                      <span style={{ flex: "0 0 auto", fontFamily: MONO, fontSize: 12.5, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted-2)" }}>
                        {[
                          d.channels.map((c) => CHANNEL_LABELS[c]).join(" + "),
                          d.pillar_id ? pillarById.get(d.pillar_id)?.name : null,
                        ].filter(Boolean).join(" / ")}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${d.title}`}
                        disabled={creating}
                        onClick={() => setDrafts((prev) => (prev ? prev.filter((x) => x !== d) : prev))}
                        style={{ flex: "none", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: "var(--text-muted-2)", cursor: "pointer", fontSize: 13, borderRadius: "var(--r-chip)" }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              {err && <div style={{ fontSize: 13, color: "var(--alert)" }}>{err}</div>}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <button
                  type="button"
                  className="btn-ghost-pill"
                  disabled={creating}
                  onClick={() => { setDrafts(null); setErr(null); }}
                  style={{ height: 34, padding: "0 14px", color: "var(--text)", opacity: creating ? 0.5 : 1 }}
                >
                  Back
                </button>
                <button type="button" onClick={() => void createAll()} disabled={creating || sortedDrafts.length === 0} style={{ ...primaryBtn, opacity: creating ? 0.6 : 1 }}>
                  {creating ? `Creating ${progress} of ${sortedDrafts.length}...` : `Create ${sortedDrafts.length} ${sortedDrafts.length === 1 ? "item" : "items"}`}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="frosted-chip" style={{ padding: 3, gap: 3, alignSelf: "flex-start" }}>
                <button type="button" aria-pressed={tab === "generate"} onClick={() => { setTab("generate"); setErr(null); }} style={tabBtn(tab === "generate")}>Quick generator</button>
                <button type="button" aria-pressed={tab === "import"} onClick={() => { setTab("import"); setErr(null); }} style={tabBtn(tab === "import")}>Import or prompt</button>
              </div>

              {tab === "generate" ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={labelStyle} htmlFor="plan-event-name">Event name</label>
                      <input id="plan-event-name" ref={nameRef} value={eventName} maxLength={200} onChange={(e) => { setEventName(e.target.value); if (err) setErr(null); }} placeholder="What are we marketing?" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle} htmlFor="plan-event-date">Event date</label>
                      <input id="plan-event-date" type="date" value={eventDate} min={todayYmd} onChange={(e) => { setEventDate(e.target.value); if (err) setErr(null); }} style={inputStyle} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <label style={labelStyle} htmlFor="plan-weeks">Weeks</label>
                        <input id="plan-weeks" type="number" min={1} max={12} value={weeks} onChange={(e) => setWeeks(Math.min(12, Math.max(1, Number(e.target.value) || 1)))} style={inputStyle} />
                      </div>
                      <div>
                        <label style={labelStyle} htmlFor="plan-per-week">Posts / week</label>
                        <input id="plan-per-week" type="number" min={1} max={7} value={perWeek} onChange={(e) => setPerWeek(Math.min(7, Math.max(1, Number(e.target.value) || 1)))} style={inputStyle} />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label style={labelStyle}>Channels</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {POST_CHANNELS.map((c) => {
                        const active = channels.includes(c);
                        return (
                          <button key={c} type="button" aria-pressed={active} onClick={() => setChannels((l) => (l.includes(c) ? l.filter((x) => x !== c) : [...l, c]))} style={channelPill(active)}>
                            {CHANNEL_LABELS[c]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={labelStyle} htmlFor="plan-pillar">Content pillar</label>
                      <select id="plan-pillar" value={pillarId} onChange={(e) => setPillarId(e.target.value)} style={inputStyle}>
                        <option value="">None</option>
                        {pillars.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle} htmlFor="plan-category">Event category</label>
                      <select id="plan-category" value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                        <option value="">None</option>
                        {CONTENT_EVENT_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {err && <div style={{ fontSize: 13, color: "var(--alert)" }}>{err}</div>}
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" onClick={generate} style={primaryBtn}>Preview the plan</button>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label style={labelStyle} htmlFor="plan-pasted">Paste a list or CSV</label>
                    <textarea
                      id="plan-pasted"
                      value={pasted}
                      onChange={(e) => { setPasted(e.target.value); if (err) setErr(null); }}
                      rows={5}
                      placeholder={"date, title, channel (optional), pillar (optional), role (optional: post, newsletter, reminder)\n2026-10-01, Launch teaser, instagram\n15 Oct, October newsletter, newsletter\n22 Oct, Bookings close, reminder"}
                      style={{ ...inputStyle, resize: "vertical", fontSize: 13, lineHeight: 1.5 }}
                    />
                  </div>

                  <div>
                    <label style={labelStyle} htmlFor="plan-files">Attach a CSV or calendar screenshots</label>
                    <input id="plan-files" type="file" multiple accept=".csv,text/csv,image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} style={{ fontSize: 13, color: "var(--text-muted)" }} />
                    {images.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                        {images.map((img, i) => (
                          <span key={`${img.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", background: "var(--field)", border: "1px solid var(--border)", borderRadius: "var(--r-chip)", fontSize: 12.5, color: "var(--text-muted)" }}>
                            {img.name}
                            <button type="button" aria-label={`Remove ${img.name}`} onClick={() => setImages((prev) => prev.filter((_, x) => x !== i))} style={{ background: "transparent", border: "none", color: "var(--text-muted-2)", cursor: "pointer", fontSize: 12.5, padding: 0 }}>✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={labelStyle} htmlFor="plan-prompt">Prompt (optional)</label>
                    <textarea
                      id="plan-prompt"
                      value={prompt}
                      onChange={(e) => { setPrompt(e.target.value); if (err) setErr(null); }}
                      rows={3}
                      placeholder="e.g. the event we're marketing is on the 22nd of October. Work this 5 week plan into the calendar leading up to that, 2 posts a week."
                      style={{ ...inputStyle, resize: "vertical", fontSize: 13, lineHeight: 1.5 }}
                    />
                  </div>

                  {err && <div style={{ fontSize: 13, color: "var(--alert)" }}>{err}</div>}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                    {/* The CSV path stays deterministic and free; the AI path
                        reads screenshots and follows the brief. */}
                    <button type="button" className="btn-ghost-pill" onClick={parseCsv} disabled={aiBusy} style={{ height: 34, padding: "0 14px", color: "var(--text)" }}>
                      Preview from CSV
                    </button>
                    <button type="button" onClick={() => void parseWithAi()} disabled={aiBusy} style={{ ...primaryBtn, opacity: aiBusy ? 0.6 : 1 }}>
                      {aiBusy ? "Reading the plan..." : "Preview with AI"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
