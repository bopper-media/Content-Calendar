/**
 * Standalone export: an in-browser stand-in for the Sous content API.
 *
 * The real ContentView / ContentCalendar / PostDeck / PostComposer components
 * call /api/v1/... exactly as they do in Sous. This module answers those calls
 * from a small store kept in this browser (localStorage, falling back to memory),
 * returning the same response shapes the real routes return. It starts EMPTY:
 * no Sous data travels with the export.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const KEY = "sous-content-export.v1";
const REGION = "local";
const ME = { id: "00000000-0000-4000-8000-000000000001", full_name: "You", email: "" };

interface Db {
  items: Json[];
  plans: Json[];
  pillars: Json[];
  comments: Json[];
  sections: Json[];
  approvals: Json[];
  igGrid: Json;
}

const EMPTY_GRID = { images: [], reels: [], profile: null, layout: [], hidden_coming: [] };

function emptyDb(): Db {
  return { items: [], plans: [], pillars: [], comments: [], sections: [], approvals: [], igGrid: { ...EMPTY_GRID } };
}

let memory: Db | null = null;

function load(): Db {
  if (memory) return memory;
  let db = emptyDb();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) db = { ...db, ...(JSON.parse(raw) as Partial<Db>) };
  } catch {
    /* private window or blocked storage: run in memory */
  }
  memory = db;
  return db;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* quota or blocked storage: the session still works in memory */
  }
}

export function loadItems(): Json[] {
  return load().items.slice();
}

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
    return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
  }
}

const now = () => new Date().toISOString();

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = b.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

function blankItem(): Json {
  const t = now();
  return {
    id: uuid(),
    region_id: REGION,
    kind: "card",
    title: null,
    note: null,
    image_url: null,
    source_url: null,
    source: "manual",
    x: 0,
    y: 0,
    w: 240,
    h: 160,
    z: 0,
    color: null,
    scheduled_for: null,
    status: "idea",
    pillar_id: null,
    event_category: null,
    caption_suggestion: null,
    post_first_comment: null,
    post_channel: null,
    post_channels: [],
    post_concept: null,
    post_copy: null,
    post_copy_channels: {},
    post_links: [],
    post_images: [],
    source_media: [],
    post_tags: [],
    post_accounts: [],
    post_medium: null,
    input_needed_from: null,
    input_needed_from_name: null,
    input_needed_what: null,
    input_task_id: null,
    board_frame_id: null,
    clip_folder: null,
    plan_id: null,
    plan_role: null,
    created_by: ME.id,
    created_by_name: ME.full_name,
    created_at: t,
    updated_at: t,
  };
}

/** Undefined keys are dropped so a partial PATCH never blanks a field. */
function merge(target: Json, patch: Json): Json {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v !== undefined) target[k] = v;
  }
  return target;
}

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function err(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function planOut(db: Db, plan: Json): Json {
  const members = db.items.filter((i) => i.plan_id === plan.id);
  return { ...plan, item_count: members.length, scheduled_count: members.filter((i) => i.scheduled_for).length };
}

async function readBody(init?: RequestInit): Promise<Json> {
  const b = init?.body;
  if (b == null) return {};
  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return {};
}

async function handle(path: string, method: string, init?: RequestInit): Promise<Response> {
  const db = load();
  const seg = path.replace(/^\/api\/v1\//, "").replace(/\/+$/, "").split("/");
  const body = method === "GET" || method === "DELETE" ? {} : await readBody(init);

  // ---- /api/v1/tasks: the team list the deck and comments read --------------
  if (seg[0] === "tasks") {
    if (method === "GET") return json({ data: [], users: [] });
    return err(404, "not_found", "Tasks are not part of this export.");
  }
  if (seg[0] !== "content") return err(404, "not_found", "Not found.");

  const [, a, b, c] = seg;

  // ---- collection -----------------------------------------------------------
  if (a === undefined) {
    if (method === "GET") return json({ data: db.items });
    if (method === "POST") {
      const item = merge(blankItem(), body);
      db.items.push(item);
      save();
      return json({ data: item }, 201);
    }
  }

  // ---- plans ----------------------------------------------------------------
  if (a === "plans") {
    if (b === undefined) {
      if (method === "GET") return json({ data: db.plans.map((p) => planOut(db, p)) });
      if (method === "POST") {
        if (!body?.name || !body?.event_date) return err(422, "validation_failed", "Give the plan a name and an event date.");
        const plan = { id: uuid(), region_id: REGION, name: String(body.name).trim(), event_date: body.event_date, pillar_id: body.pillar_id ?? null, created_by: ME.id, created_at: now() };
        db.plans.push(plan);
        save();
        return json({ data: { ...plan, item_count: 0, scheduled_count: 0 } }, 201);
      }
    } else {
      const plan = db.plans.find((p) => p.id === b);
      if (!plan) return err(404, "not_found", "Plan not found.");
      if (method === "PATCH") {
        let shifted = 0;
        if (body.event_date && body.event_date !== plan.event_date) {
          const delta = daysBetween(plan.event_date, body.event_date);
          for (const it of db.items) {
            if (it.plan_id === plan.id && it.scheduled_for) {
              it.scheduled_for = shiftYmd(it.scheduled_for, delta);
              it.updated_at = now();
              shifted += 1;
            }
          }
        }
        merge(plan, { name: body.name, event_date: body.event_date, pillar_id: body.pillar_id });
        save();
        return json({ data: plan, shifted });
      }
      if (method === "DELETE") {
        db.plans = db.plans.filter((p) => p.id !== b);
        for (const it of db.items) if (it.plan_id === b) it.plan_id = null;
        save();
        return json({ ok: true });
      }
    }
  }

  // ---- AI plan generator: needs the Sous server, so it reports unavailable ----
  if (a === "plan") {
    return err(503, "not_configured", "AI planning isn't available right now. Use the quick generator or paste a CSV instead.");
  }

  // ---- bulk date shift ------------------------------------------------------
  if (a === "shift" && method === "POST") {
    const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
    const delta = Number(body.delta_days) || 0;
    if (!ids.length || !delta) return err(422, "validation_failed", "A zero-day shift moves nothing.");
    let moved = 0;
    for (const it of db.items) {
      if (ids.includes(it.id) && it.scheduled_for) {
        it.scheduled_for = shiftYmd(it.scheduled_for, delta);
        it.updated_at = now();
        moved += 1;
      }
    }
    save();
    return json({ moved, skipped: ids.length - moved, failed: [] });
  }

  // ---- pillars --------------------------------------------------------------
  if (a === "pillars") {
    if (b === undefined) {
      if (method === "GET") return json({ data: db.pillars });
      if (method === "POST") {
        if (!body?.name) return err(422, "validation_failed", "Give the pillar a name.");
        const pillar = { id: uuid(), region_id: REGION, name: String(body.name).trim(), color: body.color ?? null, description: body.description ?? null, sort: db.pillars.length, archived_at: null, created_at: now() };
        db.pillars.push(pillar);
        save();
        return json({ data: pillar }, 201);
      }
    } else {
      const pillar = db.pillars.find((p) => p.id === b);
      if (!pillar) return err(404, "not_found", "Pillar not found.");
      if (method === "PATCH") {
        const { archived, ...rest } = body ?? {};
        merge(pillar, rest);
        if (archived !== undefined) pillar.archived_at = archived ? now() : null;
        save();
        return json({ data: pillar });
      }
      if (method === "DELETE") {
        db.pillars = db.pillars.filter((p) => p.id !== b);
        for (const it of db.items) if (it.pillar_id === b) it.pillar_id = null;
        save();
        return json({ ok: true });
      }
    }
  }

  // ---- deck section breaks --------------------------------------------------
  if (a === "deck-sections") {
    if (b === undefined) {
      if (method === "GET") return json({ data: db.sections });
      if (method === "POST") {
        const section = { id: uuid(), region_id: REGION, label: String(body.label ?? "").trim() || "Section", position: Number(body.position) || 0, created_at: now() };
        db.sections.push(section);
        save();
        return json({ data: section }, 201);
      }
    } else {
      const section = db.sections.find((x) => x.id === b);
      if (!section) return err(404, "not_found", "Section not found.");
      if (method === "PATCH") {
        merge(section, body);
        save();
        return json({ data: section });
      }
      if (method === "DELETE") {
        db.sections = db.sections.filter((x) => x.id !== b);
        save();
        return json({ ok: true });
      }
    }
  }

  // ---- artboards / canvas: not part of this export, answered empty ----------
  if (a === "canvas") return json({ data: { snapshot: null } });
  if (a === "artboard-pages" || a === "artboard-templates" || a === "fonts") return json({ data: [] });

  // ---- Instagram grid: the hand-built grid only, no live account -----------
  if (a === "ig-grid") {
    if (method === "PUT") {
      db.igGrid = { ...EMPTY_GRID, ...db.igGrid, ...body };
      save();
      return json({ data: db.igGrid });
    }
    return json({ data: { ...EMPTY_GRID, ...db.igGrid, live: null, live_failure: null, live_stale: false } });
  }

  // ---- one item and its sub-resources ---------------------------------------
  const item = db.items.find((i) => i.id === a);
  if (!item) return err(404, "not_found", "Content item not found.");

  if (b === undefined) {
    if (method === "GET") return json({ data: item });
    if (method === "PATCH") {
      if (!body || Object.keys(body).length === 0) return err(422, "validation_failed", "Nothing to update.");
      merge(item, body);
      item.updated_at = now();
      save();
      return json({ data: item });
    }
    if (method === "DELETE") {
      db.items = db.items.filter((i) => i.id !== a);
      db.comments = db.comments.filter((x) => x.item_id !== a);
      db.approvals = db.approvals.filter((x) => x.item_id !== a);
      save();
      return json({ ok: true });
    }
  }

  if (b === "comments") {
    if (c === undefined) {
      if (method === "GET") {
        const list = db.comments.filter((x) => x.item_id === a).sort((x, y) => x.created_at.localeCompare(y.created_at));
        return json({ data: list });
      }
      if (method === "POST") {
        const text = String(body.body ?? "").trim();
        if (!text) return err(422, "validation_failed", "Comment can't be empty.");
        const comment = { id: uuid(), item_id: a, region_id: REGION, author_id: ME.id, author_name: ME.full_name, body: text, created_at: now(), resolved_at: null };
        db.comments.push(comment);
        save();
        return json({ data: comment, action_task_id: null }, 201);
      }
    } else {
      const comment = db.comments.find((x) => x.id === c && x.item_id === a);
      if (!comment) return err(404, "not_found", "Comment not found.");
      if (method === "PATCH") {
        if (typeof body.body === "string") comment.body = body.body.trim();
        if (body.resolved !== undefined) comment.resolved_at = body.resolved ? now() : null;
        save();
        return json({ data: comment });
      }
      if (method === "DELETE") {
        db.comments = db.comments.filter((x) => x.id !== c);
        save();
        return json({ ok: true });
      }
    }
  }

  if (b === "approval") {
    const history = db.approvals.filter((x) => x.item_id === a).sort((x, y) => y.requested_at.localeCompare(x.requested_at));
    if (method === "GET") return json({ data: { latest: history[0] ?? null, history } });
    if (method === "POST") {
      if (body.action === "request") {
        const approval = { id: uuid(), item_id: a, region_id: REGION, requested_by: ME.id, requested_by_name: ME.full_name, requested_at: now(), decided_by: null, decided_by_name: null, decided_at: null, decision: null, note: null };
        db.approvals.push(approval);
        save();
        return json({ data: approval }, 201);
      }
      if (body.action === "decide") {
        const open = history.find((x) => x.decision === null);
        if (!open) return err(409, "conflict", "There is no open review request to decide.");
        merge(open, { decision: body.decision, note: body.note ?? null, decided_by: ME.id, decided_by_name: ME.full_name, decided_at: now() });
        save();
        return json({ data: open });
      }
      return err(422, "validation_failed", "Unknown approval action.");
    }
  }

  if (b === "input-request") {
    if (method === "POST") {
      merge(item, { input_needed_from: body.user_id ?? null, input_needed_from_name: null, input_needed_what: body.what ?? null, input_task_id: null });
      item.updated_at = now();
      save();
      return json({ data: { item, task: null } }, 201);
    }
    if (method === "DELETE") {
      merge(item, { input_needed_from: null, input_needed_from_name: null, input_needed_what: null, input_task_id: null });
      item.updated_at = now();
      save();
      return json({ data: item });
    }
  }

  return err(404, "not_found", "Not found.");
}

// Route every /api/v1 call to the store above; anything else (data:, blob:,
// other sites) goes to the real fetch untouched.
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // Relative /api/v1 paths are matched as text: the artifact frame's own
  // location may not be a URL base that new URL() accepts.
  let pathname: string | null = null;
  if (raw.startsWith("/api/v1/")) {
    pathname = raw.split(/[?#]/)[0];
  } else {
    try {
      const url = new URL(raw);
      if (url.origin === window.location.origin && url.pathname.startsWith("/api/v1/")) pathname = url.pathname;
    } catch {
      /* not a URL we own */
    }
  }
  if (!pathname) return realFetch(input as RequestInfo, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  try {
    return await handle(pathname, method, init);
  } catch (e) {
    return err(500, "local_store_failed", e instanceof Error ? e.message : "The local store failed.");
  }
};
