import type { ReactNode } from "react";

/**
 * Frosted view header shown on every view. Compact single-line layout
 * (#c2e2df45, Mia: "a lot more info is bought above the fold"): the top row
 * carries the single "Sous" crumb, so this row is just the page title (26px
 * Graphik semibold, -.8px tracking). Descriptions are no longer rendered
 * anywhere (ticket 83321921); the prop survives so call sites need no sweep.
 * `actions` unchanged, right-hand side (e.g. the Outreach/Booking tab toggle
 * on Pipeline).
 */
export function ViewHeader({
  title,
  titleNode,
  actions,
}: {
  /** Accepted for call-site compatibility but no longer rendered here; the top row shows the single "Sous" crumb (#c2e2df45). */
  crumb?: string;
  title: string;
  /** Optional replacement for the plain <h1>, e.g. an inline-editable title. Falls back to `title` when omitted. */
  titleNode?: ReactNode;
  /** Accepted for call-site compatibility but no longer rendered (ticket
   *  83321921: "delete the page descriptions across all sections"). */
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className="view-header"
      style={{
        flex: "0 0 auto",
        // Half the old vertical footprint (#c2e2df45): one row, no eyebrow.
        padding: "13px 26px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        flexWrap: "wrap", // actions drop below the title on narrow/half windows instead of bleeding
        borderBottom: "1px solid var(--hairline)",
      }}
    >
      {/* minWidth:0 lets this group shrink so a long title/description can't force horizontal overflow (#4) */}
      <div style={{ minWidth: 0, flex: "1 1 260px", display: "flex", alignItems: "baseline", gap: 14 }}>
        <div style={{ flex: "0 1 auto", minWidth: 0 }}>
          {titleNode ?? (
            <h1
              style={{
                fontSize: "clamp(21px, 3.6vw, 26px)",
                fontWeight: 600,
                letterSpacing: "-.8px",
                lineHeight: 1.15,
                color: "var(--text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              }}
            >
              {title}
            </h1>
          )}
        </div>
      </div>
      {actions}
    </div>
  );
}
