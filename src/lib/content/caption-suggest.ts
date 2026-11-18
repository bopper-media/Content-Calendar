/**
 * Caption suggested edits (Nikki's lab work, 2026-08-12, "Option 1", ported
 * 2026-08-14): a reviewer proposes a rewrite of a post's caption without
 * overwriting it; the author sees the exact diff and accepts or dismisses,
 * like suggesting mode in a doc.
 *
 * On the platform the ONE open suggestion persists on the content row itself
 * (content_items.caption_suggestion jsonb, migration 0082) rather than in a
 * table of its own: a post carries at most one open proposal at a time, accept
 * and dismiss both clear it, and the durable audit surfaces this module
 * already has (content_comments, content_approvals) stay the record of who
 * said what. The zod shape in api/v1/content/shared.ts is the trust boundary
 * for writes, the post_copy_channels posture; readers hydrate through
 * readCaptionSuggestion below rather than trusting the column, because jsonb
 * is ordinary storage and direct SQL can hold anything.
 */

/** What a suggestion can be waiting on. A fresh proposal is the suggester's to
 *  send for approval; sent means the OTHER person accepts or dismisses. */
export const CAPTION_SUGGESTION_STATUSES = ["proposed", "sent"] as const;
export type CaptionSuggestionStatus = (typeof CAPTION_SUGGESTION_STATUSES)[number];

export interface CaptionSuggestion {
  /** The signed-in suggester's users.id; null when the session could not say.
   *  RECORDED, not enforced: today both surfaces offer the actions by status
   *  alone (the lab's semantics; either person may act on the one open slot),
   *  so this exists for display and so a later build CAN gate mine-vs-theirs
   *  without a migration. Display-scoped like author_name below. */
  author_id: string | null;
  /** Display copy stamped client-side from the signed-in profile (the deck's
   *  TaskUser list / the composer's own-row read). Null renders a neutral
   *  fallback; see the trust note in shared.ts before leaning on it. */
  author_name: string | null;
  /** The caption the suggestion was made against. */
  base: string;
  /** The proposed caption, in full. */
  text: string;
  /** ISO timestamp of the proposal, rendered relative (timeAgo). */
  at: string;
  status: CaptionSuggestionStatus;
}

/**
 * Hydration gate for the jsonb column, the isPostChannel posture: the API
 * validates writes, but the COLUMN is ordinary storage, so renderers read
 * through this and treat anything malformed as "no open suggestion" rather
 * than rendering a half-shaped card.
 */
export function readCaptionSuggestion(v: unknown): CaptionSuggestion | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (typeof s.base !== "string" || typeof s.text !== "string" || typeof s.at !== "string") return null;
  if (!(CAPTION_SUGGESTION_STATUSES as readonly string[]).includes(s.status as string)) return null;
  return {
    author_id: typeof s.author_id === "string" ? s.author_id : null,
    author_name: typeof s.author_name === "string" ? s.author_name : null,
    base: s.base,
    text: s.text,
    at: s.at,
    status: s.status as CaptionSuggestionStatus,
  };
}

export type DiffSeg = { t: "eq" | "del" | "add"; s: string };

/**
 * Word-level diff (LCS) so a caption reads with removals struck through and
 * additions highlighted. Whitespace is kept as its own tokens so spacing and
 * line breaks survive the diff.
 */
export function wordDiff(a: string, b: string): DiffSeg[] {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  const n = A.length, m = B.length;
  // Guard a pathological caption: fall back to a coarse whole-block diff.
  if (n * m > 400_000) return [{ t: "del", s: a }, { t: "add", s: b }];
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffSeg[] = [];
  const push = (t: DiffSeg["t"], s: string) => {
    const last = out[out.length - 1];
    if (last && last.t === t) last.s += s; else out.push({ t, s });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("eq", A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", A[i]); i++; }
    else { push("add", B[j]); j++; }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return out;
}
