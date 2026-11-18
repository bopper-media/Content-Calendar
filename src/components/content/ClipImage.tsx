"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icons";
import { isMirroredMediaUrl, isVideoUrl } from "@/lib/content/types";

/**
 * A clip thumbnail that explains itself when the image will not load.
 *
 * WHY. Before the mirror landed (@/lib/content/mirror) the pin route stored the
 * REMOTE image URL, and Instagram's CDN URLs are signed with an `oe=` expiry of
 * roughly 4.5 days. Ten of the eleven image clips on the board had already gone
 * 403 "URL signature expired" by 2026-07-29 and there is no recovering them:
 * the bytes were never held, so there is nothing to back-fill from. What the
 * live surfaces did with that was show the browser's broken-image glyph, which
 * reads as "Sous is broken" rather than "this clip expired", and sent Mia
 * looking for a bug in the board instead of simply clipping the pin again.
 *
 * The pattern is lifted from ContentBoard.tsx's CardTile, which had a failed
 * state all along and is the one surface nothing imports any more. Lifted, not
 * wired in: ContentBoard.tsx and CanvasBoard.tsx stay dead files.
 *
 * WHAT IT SAYS, and why it is two messages and not one. isMirroredMediaUrl
 * splits the two cases because they have different remedies:
 *
 *   unmirrored, i.e. still pointing at pinimg/cdninstagram, so almost certainly
 *   expired: re-clipping it WILL fix it, and now that mirroring is on, the new
 *   clip will keep working.
 *
 *   mirrored, i.e. our own bucket failed: re-clipping fixes nothing, so it must
 *   not be suggested. This is a real fault or an offline browser.
 *
 * One message for both would send the user to the wrong remedy in whichever
 * case it was wrong for, which is the failure the broken glyph already had.
 */

/** Everything a failed clip needs to say, in the two lengths the surfaces use. */
export function clipFailureWords(src: string | null | undefined): { short: string; full: string } {
  return isMirroredMediaUrl(src)
    ? { short: "Image unavailable", full: "This image could not be loaded. It is stored with us, so re-clipping it will not help." }
    : {
        short: "Clip expired",
        full: "This clip expired. It was saved as a link to the original site and that link has run out, so clip it again to keep a permanent copy.",
      };
}

/**
 * The failed tile. `compact` is for the places too small for words (the
 * calendar's day chips run down to 16px, where any label would sit under the
 * legibility floor); there the mark carries it and the words ride the tooltip.
 */
export function ClipFallback({
  src,
  compact = false,
  style,
}: {
  src: string | null | undefined;
  compact?: boolean;
  style?: React.CSSProperties;
}) {
  const words = clipFailureWords(src);
  const expired = !isMirroredMediaUrl(src);
  return (
    <div
      title={words.full}
      role="img"
      aria-label={words.short}
      style={{
        background: "var(--field)",
        border: "1px solid var(--hairline)",
        color: "var(--text-muted-2)",
        textAlign: "center",
        overflow: "hidden",
        // The caller's BOX is welcome (width, height, aspectRatio, radius): the
        // fallback has to occupy exactly the space the image did or the grid
        // reflows the moment one tile fails.
        ...style,
        // Its DISPLAY MODE is not. These are spread last on purpose, because
        // every caller here passes an img style carrying display:block or
        // objectFit, and inheriting that would leave the mark jammed in a
        // corner instead of centred. An inline-flex caller keeps its inline
        // flow though (the calendar's Thumb sits in a text row and would break
        // the line if this forced it block-level).
        display: style?.display === "inline-flex" ? "inline-flex" : "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
      }}
    >
      <Icon name={expired ? "clock" : "image"} size={compact ? 11 : 14} />
      {!compact && (
        <span
          style={{
            fontFamily: "var(--font-merchant)",
            fontWeight: 500,
            // 12.5 is the floor for a Merchant caps label, house rule.
            fontSize: 12.5,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            lineHeight: 1.25,
            padding: "0 6px",
          }}
        >
          {words.short}
        </span>
      )}
    </div>
  );
}

/**
 * An <img> that swaps itself for ClipFallback on error.
 *
 * Deliberately a plain img, the house rule for clip media everywhere: sources
 * are remote (our bucket, pinimg, cdninstagram) and next/image would want a
 * per-host allow-list for each.
 */
export function ClipImage({
  src,
  alt,
  style,
  compact = false,
  draggable,
  loading,
  title,
  onFailed,
}: {
  src: string;
  alt: string;
  /** The image's own box. The fallback reuses it so a failed tile occupies
   *  exactly the space the image did and the grid does not reflow. */
  style?: React.CSSProperties;
  compact?: boolean;
  draggable?: boolean;
  loading?: "lazy" | "eager";
  /** Hover text for the WORKING image only. A failed one wears the failure
   *  words instead: "the clip this post grew from" is not the useful sentence
   *  when the thing on screen is a slab saying the clip expired. */
  title?: string;
  /**
   * Fired once when this src turns out to be dead, so a surface that decorates
   * the tile can stand down and let ClipFallback speak alone.
   *
   * The board's clip rail is the caller: an Instagram clip is BOTH dead and
   * unplaceable, and stacking "clip expired" under a "re-clip" chip would show
   * one clip two badges for what is one situation with one remedy. Reported by
   * SRC, not as a bare boolean, for the same reconciliation reason failedSrc
   * itself is keyed that way, and so the listener can hold its knowledge in a
   * set of URLs that stays true however the list re-renders.
   */
  onFailed?: (src: string) => void;
}) {
  // ABOVE every conditional return, house hooks rule.
  //
  // The failed SRC, not a failed BOOLEAN, and that distinction is the fix for a
  // real defect (2026-07-29). React reconciles by position, so this component
  // instance is reused when its parent re-renders with a different image: the
  // deck's slide, the calendar's day chip and the board's rail all swap src on
  // the same node constantly. A `useState(false)` never resets on that swap, so
  // one expired clip would leave every later image at that position showing
  // "Clip expired", a message that is not merely stale but WRONG, and points
  // the user at re-clipping an image that was fine. Keyed on the src, a swap
  // makes the comparison false by itself, with no effect, no extra render and
  // no key= discipline required of six call sites (which is a rule someone
  // would eventually forget at the seventh).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return <ClipFallback src={src} compact={compact} style={style} />;

  /**
   * A VIDEO GETS A <video> (Mia, ticket b081aa28: "make it so that we can
   * upload videos to the content slides").
   *
   * Video upload was already accepted everywhere it mattered: the picker takes
   * image/*,video/*, the byte sniffer admits mp4 and webm, and the store gives
   * them the right extension. The one missing piece was here. Every surface
   * that shows a slide's media comes through this component, and it only ever
   * rendered an <img>, so an uploaded clip arrived as a broken image: it
   * uploaded, it saved, and it showed as nothing.
   *
   * muted + playsInline so it can be scrubbed in place without a tab suddenly
   * making noise; controls because a slide is something you check, not
   * something that should autoplay at you. preload="metadata" keeps a deck of
   * clips from pulling whole files just to draw a first frame.
   */
  if (isVideoUrl(src)) {
    return (
      <video
        src={src}
        title={title}
        controls
        muted
        playsInline
        preload="metadata"
        onError={() => {
          setFailedSrc(src);
          onFailed?.(src);
        }}
        style={style}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      title={title}
      draggable={draggable}
      loading={loading}
      onError={() => {
        setFailedSrc(src);
        onFailed?.(src);
      }}
      style={style}
    />
  );
}
