"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipImage } from "@/components/content/ClipImage";
import type { ContentItem } from "@/lib/content/types";
import { uploadContentFile } from "@/lib/content/upload-client";

/**
 * THE GRID (Mia, 2026-09-18: "can you make a grid section of the content area
 * where we can add our IG grid and we can see how a new post is going to look
 * mocked up"; 2026-09-29: "this needs to pull from our IG and also be in the
 * shape of an iphone in the centre of the screen. and the draft content in
 * our calendar also mocked up on grid too, but not everything from our
 * pinned").
 *
 * A PHONE, IN THE MIDDLE. The profile is drawn the way Instagram draws it on
 * an iPhone: status bar, the handle, the avatar and the three counts, the
 * tabs, then three across with hairline gaps, and the bar at the foot. It is
 * a mock-up of the thing people actually see, so a new post can be judged
 * against it rather than against a spreadsheet of squares.
 *
 * THREE SOURCES, IN ORDER OF TRUTH. The COMING posts are read live from the
 * content plan: only cards with a date, so the sixty-odd pinned ideas on the
 * board stay off it. The LIVE profile comes from Instagram's own API once the
 * account is connected in Settings (cached a quarter of an hour, refresh on
 * demand); until then the tiles added by hand stand in for it, the way they
 * always have. The coming posts wear a dashed edge and a number, because on
 * the real profile they are not there yet.
 */

const MONO = "var(--font-merchant)";
const CAPS: React.CSSProperties = { fontFamily: MONO, fontSize: 12.5, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted-2)" };

/** iPhone 15 points. Everything inside is drawn at this size and scaled to fit. */
const PHONE_W = 390;
const PHONE_H = 844;
const HANDLE = "cometogether_official";

interface LiveTile { id: string; url: string; permalink: string | null; type: string; timestamp: string | null; caption: string | null }
interface LiveProfile { username: string; name: string | null; picture: string | null; posts: number | null; followers: number | null; following: number | null; bio: string | null }
interface LiveGrid { fetched_at: string; profile: LiveProfile; tiles: LiveTile[] }
type LiveFailure = "not_configured" | "not_connected" | "expired" | "fetch_failed" | null;
/** The head as kept by hand (see lib/content/ig-grid.ts) until the account is connected. */
interface HandProfile { name: string; bio: string; link: string; posts: number | null; followers: number | null; following: number | null; picture: string; highlights: { label: string; image: string }[] }

/** Instagram's grid today is 3:4, not square, so the mock-up is too. */
const TILE = "3 / 4";
/** Instagram's link colour on the dark profile. */
const LINK = "#e0f1ff";

/** The reel mark a clip's tile carries on the profile. */
const ReelMark = () => (
  <svg style={{ position: "absolute", top: 6, right: 6, filter: "drop-shadow(0 0 2px rgba(0,0,0,.6))" }} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} aria-label="Reel">
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="M3 8.5h18M8 3l3 5.5M13 3l3 5.5M10.5 12.5l4.5 2.8-4.5 2.8z" />
  </svg>
);

/** @mentions and links read in Instagram's link colour, as they do in a bio. */
function bioLines(text: string) {
  // A handle ends on a word character, so "with @nikki_chadwick." keeps its
  // full stop plain; a blank line keeps its height, as it does on the profile.
  return text.split("\n").map((line, i) => (
    <div key={i} style={{ minHeight: "1.35em" }}>
      {line.split(/(@[\w.]*\w|https?:\/\/[^\s]+?(?=[.,;:!?)]*(?:\s|$))|www\.[^\s]+?(?=[.,;:!?)]*(?:\s|$)))/).map((part, n) =>
        /^(@|https?:|www\.)/.test(part) ? <span key={n} style={{ color: LINK }}>{part}</span> : <span key={n}>{part}</span>,
      )}
    </div>
  ));
}

/** The image a post would go out with: its finalised still, else the clip it grew from. */
function tileImage(item: ContentItem): string | null {
  const still = item.post_images.find((u) => u.trim());
  return still ?? (item.image_url?.trim() ? item.image_url : null);
}

/** Newest first, the way a profile reads. */
function byWhenDesc(a: ContentItem, b: ContentItem): number {
  return (b.scheduled_for ?? "").localeCompare(a.scheduled_for ?? "");
}

const compact = (n: number | null): string => (n == null ? "–" : n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : n.toLocaleString("en-GB"));

export function IgGrid({ items }: { items: ContentItem[] }) {
  const [manual, setManual] = useState<string[]>([]);
  const [reels, setReels] = useState<string[]>([]);
  const [handProfile, setHandProfile] = useState<HandProfile | null>(null);
  const [live, setLive] = useState<LiveGrid | null>(null);
  const [liveFailure, setLiveFailure] = useState<LiveFailure>(null);
  const [liveStale, setLiveStale] = useState(false);
  const [loading, setLoading] = useState(true);
  /** True once a read has actually come back: nothing is saved over a grid
   *  that was never loaded, or the first save would write an empty one. */
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showComing, setShowComing] = useState(true);
  /** The grid's own order and the coming posts taken off it (tickets b13f9aba, d91cdd3a). */
  const [layout, setLayout] = useState<string[]>([]);
  const [hiddenComing, setHiddenComing] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dragFrom = useRef<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    try {
      const res = await fetch(`/api/v1/content/ig-grid${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as { data?: { images?: string[]; reels?: string[]; profile?: HandProfile | null; layout?: string[]; hidden_coming?: string[]; live?: LiveGrid | null; live_failure?: LiveFailure; live_stale?: boolean } } | null;
      if (!res.ok || !j?.data) {
        // A failed read leaves whatever is on screen alone, and nothing saves
        // until a read lands: an empty grid must never be a symptom of a 500.
        setErr("Could not load the grid.");
        return;
      }
      setManual(j.data.images ?? []);
      setReels(j.data.reels ?? []);
      setHandProfile(j.data.profile ?? null);
      setLayout(j.data.layout ?? []);
      setHiddenComing(j.data.hidden_coming ?? []);
      setLive(j.data.live ?? null);
      setLiveFailure(j.data.live_failure ?? null);
      setLiveStale(Boolean(j.data.live_stale));
      setReady(true);
      setErr(null);
    } catch {
      setErr("Could not load the grid.");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void load(false).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  /** Only what is in the calendar and not yet posted, with something to show:
   *  a date is what makes a card a post rather than a pinned idea. */
  const comingAll = useMemo(
    () => items.filter((i) => i.kind === "card" && Boolean(i.scheduled_for) && i.status !== "posted" && tileImage(i) !== null).sort(byWhenDesc),
    [items],
  );
  // Less the ones taken off the mock-up (ticket d91cdd3a): the calendar and
  // the slides still have them, only this grid forgets them.
  const coming = useMemo(() => comingAll.filter((i) => !hiddenComing.includes(i.id)), [comingAll, hiddenComing]);
  const hiddenCount = comingAll.length - coming.length;

  const usingInstagram = Boolean(live && live.tiles.length > 0);

  /**
   * THE TILES IN THE ORDER THEY SIT (ticket b13f9aba). Coming posts and
   * hand-added tiles are one list here, laid as the saved order says; a tile
   * the order does not know yet goes in front, newest first.
   */
  type Tile = { key: string; kind: "coming"; item: ContentItem } | { key: string; kind: "manual"; url: string };
  /** EVERY key the grid knows, in order: every coming post (hidden or not,
   *  shown or not) and every hand-added tile. A drag reorders THIS list and
   *  saves it whole, so a post that is off the grid for the moment keeps its
   *  slot for when it is back. What is drawn is a view of it. */
  const fullOrder = useMemo<string[]>(() => {
    const all = [...comingAll.map((i) => `item:${i.id}`), ...manual.map((u) => `img:${u}`)];
    const present = new Set(all);
    const known = new Set(layout);
    return [...all.filter((k) => !known.has(k)), ...layout.filter((k) => present.has(k))];
  }, [comingAll, manual, layout]);
  const tiles = useMemo<Tile[]>(() => {
    const byKey = new Map<string, Tile>();
    if (showComing) coming.forEach((item) => byKey.set(`item:${item.id}`, { key: `item:${item.id}`, kind: "coming", item }));
    for (const url of manual) byKey.set(`img:${url}`, { key: `img:${url}`, kind: "manual", url });
    return fullOrder.map((k) => byKey.get(k)).filter((t): t is Tile => Boolean(t));
  }, [fullOrder, coming, manual, showComing]);

  async function save(patch: { images?: string[]; layout?: string[]; hidden_coming?: string[] }) {
    if (!ready) return;
    // Only what changed goes up; the row keeps its reel marks (trimmed to
    // the tiles that remain), its hand-kept head and whatever else the body
    // leaves out, so a tab that loaded before any of it existed cannot wipe
    // it with a drag.
    const images = patch.images ?? manual;
    if (patch.images) {
      setManual(patch.images);
      setReels((r) => r.filter((u) => images.includes(u)));
    }
    if (patch.layout) setLayout(patch.layout);
    if (patch.hidden_coming) setHiddenComing(patch.hidden_coming);
    setErr(null);
    try {
      const res = await fetch("/api/v1/content/ig-grid", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...patch, images }) });
      if (!res.ok) setErr("That did not save. Try again.");
    } catch {
      setErr("That did not reach the server.");
    }
  }

  /** Drop one tile on another: the whole order is written, so it sticks. */
  function dropOnKey(toKey: string) {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === toKey) return;
    const fromIdx = fullOrder.indexOf(from);
    const toIdx = fullOrder.indexOf(toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...fullOrder];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    void save({ layout: next });
  }

  /** Take a coming post off the grid. The list is trimmed to posts that still
   *  exist, so it never fills with ids of things long deleted. */
  function hideComing(id: string) {
    const alive = new Set(items.map((i) => i.id));
    void save({ hidden_coming: [...hiddenComing.filter((x) => alive.has(x)), id] });
  }

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    setErr(null);
    const added: string[] = [];
    for (const file of Array.from(list)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        added.push(await uploadContentFile(file));
      } catch {
        /* one bad file does not stop the rest */
      }
    }
    setBusy(false);
    if (added.length === 0) {
      setErr("Nothing uploaded. Try a jpg or png.");
      return;
    }
    await save({ images: [...added, ...manual] });
  }

  /* ── the phone fits whatever height the pane has ── */
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.8);
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.35, Math.min(1, (el.clientHeight - 120) / PHONE_H, (el.clientWidth - 48) / PHONE_W)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const profile = live?.profile ?? null;
  const liveCount = usingInstagram ? live!.tiles.length : manual.length;
  // Instagram's own read wins; the hand-kept head fills what it does not
  // carry (highlights, always), and stands in whole until it is connected.
  const head = {
    name: profile?.name || handProfile?.name || "Come Together",
    bio: profile?.bio || handProfile?.bio || "",
    link: handProfile?.link || "",
    picture: profile?.picture || handProfile?.picture || null,
    posts: profile?.posts ?? handProfile?.posts ?? liveCount,
    followers: profile?.followers ?? handProfile?.followers ?? null,
    following: profile?.following ?? handProfile?.following ?? null,
    highlights: handProfile?.highlights ?? [],
  };

  // What the tiles are and how fresh: a failure always wins the line, even
  // when a cached read is still painted, so a lapsed connection can never
  // hide behind last week's grid.
  const readAt = live ? new Date(live.fetched_at) : null;
  const readLabel = readAt
    ? readAt.toDateString() === new Date().toDateString()
      ? `read ${readAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
      : `read ${readAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
    : "";
  const needsConnect = liveFailure === "not_connected" || liveFailure === "not_configured" || liveFailure === "expired";
  const sourceLine =
    liveFailure === "expired"
      ? `Instagram connection has lapsed: reconnect it in Settings${usingInstagram ? ` · tiles are from the last ${readLabel}` : ""}`
      : liveFailure === "fetch_failed"
        ? usingInstagram
          ? `Instagram did not answer just now · showing the ${readLabel}`
          : "Instagram did not answer just now: the live tiles are the ones added by hand"
        : usingInstagram
          ? `Instagram · @${profile?.username || HANDLE} · ${readLabel}${liveStale ? " (older read)" : ""}`
          : liveFailure === "not_connected" || liveFailure === "not_configured"
            ? "Instagram not connected yet: the live tiles are the ones added by hand"
            : "";

  return (
    <div ref={paneRef} className="view-pane" style={{ flex: 1, overflow: "auto", padding: "14px 26px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, minHeight: 0 }}>
      {/* ── the controls, above the phone ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center", width: "100%", maxWidth: 820 }}>
        <span style={{ ...CAPS, color: "var(--text-muted)" }}>
          {coming.length} coming {coming.length === 1 ? "post" : "posts"} over {liveCount} live
        </span>
        <button type="button" onClick={() => setShowComing((v) => !v)} className="btn-ghost-pill" style={{ height: 28, padding: "0 12px", fontSize: 12.5, color: showComing ? "var(--text)" : "var(--text-muted)" }} title="Take the coming posts off to see the profile as it stands today">
          {showComing ? "Hide coming posts" : "Show coming posts"}
        </button>
        {needsConnect && (
          <a href="/settings" className="btn-ghost-pill" style={{ height: 28, padding: "0 12px", fontSize: 12.5, textDecoration: "none", display: "inline-flex", alignItems: "center", color: liveFailure === "expired" ? "var(--danger)" : undefined }} title="Connect the Instagram account so the real profile is read from Instagram">
            {liveFailure === "expired" ? "Reconnect Instagram" : "Connect Instagram"}
          </a>
        )}
        {usingInstagram ? (
          <button
            type="button"
            onClick={() => { setRefreshing(true); void load(true).finally(() => setRefreshing(false)); }}
            disabled={refreshing || liveFailure === "expired"}
            className="btn-ghost-pill"
            style={{ height: 28, padding: "0 12px", fontSize: 12.5, opacity: refreshing || liveFailure === "expired" ? 0.5 : 1 }}
            title={liveFailure === "expired" ? "Reconnect Instagram first" : "Read the profile from Instagram again now"}
          >
            {refreshing ? "Reading Instagram..." : "Refresh from Instagram"}
          </button>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || !ready} className="btn-ghost-pill" style={{ height: 28, padding: "0 12px", fontSize: 12.5, opacity: busy || !ready ? 0.6 : 1 }} title={ready ? "Add the posts already on your profile, newest first" : "Waiting for the grid to load"}>
              {busy ? "Adding..." : "Add to grid"}
            </button>
          </>
        )}
        {ready && hiddenCount > 0 && (
          <button type="button" onClick={() => void save({ hidden_coming: [] })} className="btn-ghost-pill" style={{ height: 28, padding: "0 12px", fontSize: 12.5, color: "var(--text-muted)" }} title="Put back the coming posts taken off this grid">
            Bring back {hiddenCount} hidden {hiddenCount === 1 ? "post" : "posts"}
          </button>
        )}
      </div>
      {sourceLine && <span style={{ ...CAPS, fontSize: 11.5 }}>{sourceLine}</span>}
      {err && (
        <p role="alert" style={{ fontSize: 13, color: "var(--danger)", margin: 0 }}>
          {err}
        </p>
      )}

      {/* ── the phone ── */}
      <div style={{ width: PHONE_W * scale, height: PHONE_H * scale, flex: "none", position: "relative" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: PHONE_W, height: PHONE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <div style={{ width: PHONE_W, height: PHONE_H, borderRadius: 58, background: "#101010", padding: 11, boxSizing: "border-box", boxShadow: "0 30px 60px rgba(0,0,0,.35), inset 0 0 0 2px #2a2a2a" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 48, background: "#000", color: "#f5f5f5", overflow: "hidden", position: "relative", display: "flex", flexDirection: "column", fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
              {/* status bar + island */}
              <div style={{ height: 54, flex: "none", position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 30px 6px", fontSize: 15, fontWeight: 600 }}>
                <span>9:41</span>
                <div style={{ position: "absolute", top: 11, left: "50%", transform: "translateX(-50%)", width: 122, height: 36, borderRadius: 20, background: "#000", border: "1px solid #141414" }} />
                <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
                  <svg width={17} height={11} viewBox="0 0 17 11" fill="#fff" aria-hidden><rect x="0" y="7" width="3" height="4" rx=".6" /><rect x="4.5" y="5" width="3" height="6" rx=".6" /><rect x="9" y="2.5" width="3" height="8.5" rx=".6" /><rect x="13.5" y="0" width="3" height="11" rx=".6" /></svg>
                  <svg width={16} height={11} viewBox="0 0 16 11" fill="none" stroke="#fff" strokeWidth={1.6} aria-hidden><path d="M1.5 4a9 9 0 0 1 13 0M4 6.6a5.5 5.5 0 0 1 8 0M6.5 9a2.2 2.2 0 0 1 3 0" strokeLinecap="round" /></svg>
                  <svg width={27} height={12} viewBox="0 0 27 12" aria-hidden><rect x=".5" y=".5" width="23" height="11" rx="3" fill="none" stroke="#fff" strokeOpacity=".5" /><rect x="2" y="2" width="20" height="8" rx="1.8" fill="#fff" /><rect x="25" y="4" width="1.6" height="4" rx=".6" fill="#fff" fillOpacity=".5" /></svg>
                </span>
              </div>

              {/* THE SCREEN SCROLLS AS ONE (Mia, ticket 196dd2e5: "as we scroll
                  up, the grid images should take up the page of the phone"):
                  the head goes up and away, the tab strip sticks under the
                  status bar, and the grid has the whole screen, as on the
                  profile itself. */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }}>
              {/* profile head */}
              <div style={{ padding: "2px 16px 0" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 40 }}>
                  <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em" }}>{profile?.username || HANDLE} <span style={{ fontSize: 12, opacity: 0.8 }}>▾</span></span>
                  <span style={{ display: "inline-flex", gap: 20, fontSize: 22, lineHeight: 1 }}>
                    <span aria-hidden>＋</span>
                    <span aria-hidden>≡</span>
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 6 }}>
                  <div style={{ width: 86, height: 86, borderRadius: "50%", flex: "none", background: "#1c1c1c", border: "1px solid #2a2a2a", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {head.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={head.picture} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    ) : (
                      <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".1em", color: "#777" }}>CT</span>
                    )}
                  </div>
                  {[
                    [head.posts, "posts"],
                    [head.followers, "followers"],
                    [head.following, "following"],
                  ].map(([n, label]) => (
                    <div key={String(label)} style={{ flex: 1, textAlign: "center" }}>
                      <div style={{ fontSize: 17, fontWeight: 700 }}>{compact(n as number | null)}</div>
                      <div style={{ fontSize: 13 }}>{label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.35 }}>
                  <div style={{ fontWeight: 600 }}>{head.name}</div>
                  {head.bio && <div style={{ opacity: 0.92 }}>{bioLines(head.bio)}</div>}
                  {head.link && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, color: LINK, fontWeight: 600 }}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={LINK} strokeWidth={2.2} strokeLinecap="round" aria-hidden><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{head.link}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                  {["Edit profile", "Share profile"].map((b) => (
                    <div key={b} style={{ flex: 1, height: 32, borderRadius: 8, background: "#262626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600 }}>{b}</div>
                  ))}
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "#262626", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }} aria-hidden>+</div>
                </div>
                {head.highlights.length > 0 && (
                  <div style={{ display: "flex", gap: 14, marginTop: 14, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
                    {head.highlights.map((h, i) => (
                      <div key={`${h.label}-${i}`} style={{ flex: "none", width: 64, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 62, height: 62, borderRadius: "50%", border: "1.5px solid #3a3a3a", padding: 2, boxSizing: "border-box" }}>
                          <div style={{ width: "100%", height: "100%", borderRadius: "50%", overflow: "hidden", background: "#1c1c1c" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {h.image && <img src={h.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                          </div>
                        </div>
                        <span style={{ fontSize: 11.5, maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.label}</span>
                      </div>
                    ))}
                    <div style={{ flex: "none", width: 64, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 62, height: 62, borderRadius: "50%", border: "1.5px solid #3a3a3a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 300, color: "#bbb", boxSizing: "border-box" }} aria-hidden>+</div>
                      <span style={{ fontSize: 11.5 }}>New</span>
                    </div>
                  </div>
                )}
              </div>
                <div style={{ display: "flex", margin: "14px 0 0", padding: "0 16px", borderBottom: "1px solid #262626", position: "sticky", top: 0, background: "#000", zIndex: 2 }}>
                  {["grid", "reels", "tag"].map((t, i) => (
                    <div key={t} style={{ flex: 1, height: 40, display: "flex", alignItems: "center", justifyContent: "center", borderBottom: i === 0 ? "1.5px solid #f5f5f5" : "1.5px solid transparent", opacity: i === 0 ? 1 : 0.45 }}>
                      {t === "grid" && <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} aria-hidden><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M9 3v18M15 3v18M3 9h18M3 15h18" /></svg>}
                      {t === "reels" && <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} aria-hidden><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M3 8.5h18M8 3l3 5.5M13 3l3 5.5M10.5 12.5l4.5 2.8-4.5 2.8z" /></svg>}
                      {t === "tag" && <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} aria-hidden><path d="M12 2.5 21 7v10l-9 4.5L3 17V7z" /><circle cx="12" cy="10.5" r="2.6" /><path d="M7.5 17.5c1-2.4 2.6-3.6 4.5-3.6s3.5 1.2 4.5 3.6" /></svg>}
                    </div>
                  ))}
                </div>

              {/* the grid */}
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1.5, padding: "1.5px 0 0" }}>
                  {usingInstagram && showComing &&
                    coming.map((item) => {
                      const src = tileImage(item);
                      return (
                        <div key={`c-${item.id}`} className="ig-tile" style={{ position: "relative", aspectRatio: TILE, background: "#161616", overflow: "hidden", outline: "2px dashed var(--accent, #2b6cff)", outlineOffset: -2 }} title={item.title ?? "Coming post"}>
                          {src && <ClipImage src={src} alt={item.title ?? "Coming post"} compact style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                          <button type="button" className="ig-x" onClick={() => hideComing(item.id)} aria-label="Take this coming post off the grid" title="Take it off this grid (the calendar and the slides keep it)">&times;</button>
                        </div>
                      );
                    })}
                  {usingInstagram
                    ? live!.tiles.map((t) => (
                        <a key={`ig-${t.id}`} href={t.permalink ?? undefined} target="_blank" rel="noreferrer noopener" title={t.caption ?? undefined} style={{ position: "relative", aspectRatio: TILE, background: "#161616", overflow: "hidden", display: "block" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={t.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} loading="lazy" />
                          {t.type === "VIDEO" && <ReelMark />}
                          {t.type === "CAROUSEL_ALBUM" && (
                            <svg style={{ position: "absolute", top: 6, right: 6 }} width={16} height={16} viewBox="0 0 24 24" fill="#fff" aria-label="Carousel"><path d="M7 7h14v14H7z" opacity=".95" /><path d="M3 3h14v3H6v11H3z" opacity=".7" /></svg>
                          )}
                        </a>
                      ))
                    : tiles.map((t) => (
                        /* EVERY TILE DRAGS, ALWAYS (ticket b13f9aba): coming
                           posts and hand-added tiles alike, anywhere on the
                           grid, and each carries a cross on hover. A coming
                           post's cross takes it off this mock-up only. */
                        <div
                          key={t.key}
                          className="ig-tile"
                          style={{ position: "relative", aspectRatio: TILE, background: "#161616", overflow: "hidden", cursor: "grab", ...(t.kind === "coming" ? { outline: "2px dashed var(--accent, #2b6cff)", outlineOffset: -2 } : {}) }}
                          title={t.kind === "coming" ? (t.item.title ?? "Coming post") : undefined}
                          draggable
                          // Firefox starts a drag only when dragstart carries
                          // data; dragend clears the source so a drop off the
                          // grid leaves nothing behind for the next drop.
                          onDragStart={(e) => { dragFrom.current = t.key; e.dataTransfer.setData("text/plain", t.key); e.dataTransfer.effectAllowed = "move"; }}
                          onDragEnd={() => { dragFrom.current = null; }}
                          onDragOver={(e) => { if (dragFrom.current !== null) e.preventDefault(); }}
                          onDrop={(e) => { e.preventDefault(); dropOnKey(t.key); }}
                        >
                          {t.kind === "coming" ? (
                            <>
                              {/* No number on the tile (Mia, ticket 6e3b8eb8): the dashed edge alone says it is still to come. */}
                              {tileImage(t.item) && <ClipImage src={tileImage(t.item)!} alt={t.item.title ?? "Coming post"} compact style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />}
                              <button type="button" className="ig-x" onClick={() => hideComing(t.item.id)} aria-label="Take this coming post off the grid" title="Take it off this grid (the calendar and the slides keep it)">&times;</button>
                            </>
                          ) : (
                            <>
                              <ClipImage src={t.url} alt="" compact style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }} />
                              {reels.includes(t.url) && <ReelMark />}
                              <button type="button" className="ig-x" onClick={() => void save({ images: manual.filter((u) => u !== t.url) })} aria-label="Remove from the grid" title="Remove from the grid">&times;</button>
                            </>
                          )}
                        </div>
                      ))}
                </div>
                {ready && !loading && coming.length === 0 && liveCount === 0 && (
                  <p style={{ fontSize: 13, color: "#888", lineHeight: 1.5, padding: "26px 24px", textAlign: "center", margin: 0 }}>
                    Nothing on the grid yet. Connect Instagram in Settings to read the real profile, or add the posts already on it by hand. Dated posts in the plan lay over the top.
                  </p>
                )}
              </div>

              </div>

              {/* the bar at the foot, with the home indicator */}
              <div style={{ flex: "none", height: 78, borderTop: "1px solid #1e1e1e", display: "flex", alignItems: "flex-start", justifyContent: "space-around", padding: "12px 18px 0" }}>
                <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} aria-hidden><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z" strokeLinejoin="round" /></svg>
                <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} aria-hidden><circle cx="10.5" cy="10.5" r="7" /><path d="m21 21-5.2-5.2" strokeLinecap="round" /></svg>
                <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} aria-hidden><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M12 8v8M8 12h8" strokeLinecap="round" /></svg>
                <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} aria-hidden><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M3 8.5h18M8 3l3 5.5M13 3l3 5.5M10.5 12.5l4.5 2.8-4.5 2.8z" /></svg>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#2a2a2a", border: "1.5px solid #fff", overflow: "hidden" }}>
                  {head.picture && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={head.picture} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  )}
                </div>
                <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", width: 134, height: 5, borderRadius: 3, background: "#fff", opacity: 0.9 }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="body-copy" style={{ fontSize: 12.5, color: "var(--text-muted-2)", margin: 0, maxWidth: 560, lineHeight: 1.6, textAlign: "center" }}>
        Dashed tiles are coming posts, read from the calendar (dated posts only). Drag any tile to move it; the cross on a coming post takes it off this grid only. Nothing here posts anything.
      </p>
      <style>{`.ig-x{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:none;cursor:pointer;background:rgba(0,0,0,.65);color:#fff;font-size:13px;line-height:22px;padding:0;opacity:0;transition:opacity .12s}.ig-tile:hover .ig-x,.ig-x:focus-visible{opacity:1}`}</style>
    </div>
  );
}
