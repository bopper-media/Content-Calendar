# Sous Content: calendar and post slide

The Content section of Sous as a standalone app: the month and list calendar,
the post slide where a post's copy is written, and everything those screens
open. It runs on its own with no server. Posts are kept in the browser until
you connect a backend.

## What's in it

- **Calendar tab.** Month and list views, today marker, scheduled count,
  Shift dates (move a run of posts by N days), Filters (channel, status,
  pillar...), Select mode for bulk status, channel and medium changes, and the
  **+** menu: Add post, Add plan, Add event.
- **Post slide.** Opens when you add a post or click one on the calendar.
  Title, caption, per-channel copy, concept, first comment, links, images
  (Finalised), source media (Media used), status, content pillar, channels,
  accounts, medium, date, comments, a filmstrip of every post with section
  breaks, and Delete post / Back to calendar.
- **Grid tab.** The Instagram grid preview, with planned posts laid over
  images added by hand.
- **Pillars tab.** Manage content pillars and see the last 30 days against the
  plan.
- **Plans.** Group posts around an event date. Moving the plan's date moves
  its posts with it.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # outputs dist/
```

Node 20 or newer.

## How it's put together

```
src/
  main.tsx                     Entry: installs the local API, renders the page shell + ContentView
  app.css                      Sous "Frosted" design system (Tailwind v4 + CSS variables, light/dark)
  data/local-api.ts            In-browser stand-in for the Sous /api/v1 routes (localStorage)
  shims/next-dynamic.tsx       Stand-in for next/dynamic (only used to lazy-load artboards)
  components/
    content/
      ContentView.tsx          Page: header, tabs, Select mode, the post slide overlay   [trimmed]
      ContentCalendar.tsx      Month/list calendar, filters, + menu, add event
      PostDeck.tsx             The post slide and filmstrip                             [trimmed]
      PostComposer.tsx         The fallback post form
      PlanModal.tsx            Add plan (quick generator, CSV paste, AI planner)
      PlansPanel.tsx           List, rename, re-date and delete plans
      ShiftDatesModal.tsx      Shift dates
      CommentsPanel.tsx        Comments on a post
      IgGrid.tsx               Grid tab
      PillarsView.tsx          Pillars tab
      ClipImage.tsx            Image/video tile
      useArtboardPreview.ts    [stand-in] always "no artboard"
      ExcalidrawBoard.tsx      [stand-in] renders nothing
    artboards/*.tsx            [stand-ins] render nothing
    app-shell/ViewHeader.tsx   Page title row
    ui/icons.tsx               Icon set
  lib/
    content/types.ts           ContentItem and every enum the UI reads (the data contract)
    content/caption-suggest.ts Suggested caption edits (pure helpers)
    content/upload-client.ts   [stand-in] reads uploads into data: URLs in the browser
    tasks/types.ts             TaskUser + initialsOf (used for people chips)
    supabase/client.ts         [stand-in] returns null (no accounts)
```

## What changed from Sous

Unchanged Sous source: everything above not marked [trimmed] or [stand-in].
The comments inside those files are Sous's own development notes and still
refer to Sous tickets, pages and people.

- **ContentView.tsx (trimmed).** The Mock-ups tab and its Excalidraw canvas are
  removed. The tabs are Calendar, Grid, Pillars.
- **PostDeck.tsx (trimmed).** The "Edit artboard" button is removed. Nothing
  else changed.
- **Stand-ins.** Artboard components render nothing, `useArtboardPreview`
  always reports no artboard, `next/dynamic` is shimmed, the Supabase browser
  client returns null (so there is no signed-in user), and uploads become
  `data:` URLs instead of going to a storage bucket.
- **local-api.ts** replaces the server. It starts empty and saves to
  `localStorage` under `sous-content-export.v1`.

## Connecting a real backend

The components only ever call `fetch("/api/v1/...")`. So the cleanest path is
to serve those same routes from your backend and delete the local stand-in:

1. Implement the routes in **API.md**: same paths, same request bodies, same
   JSON responses. `local-api.ts` is a working reference implementation of
   every one of them, so port its logic to your server.
2. Store items with the `ContentItem` shape from `src/lib/content/types.ts`.
   Suggested tables: `content_items`, `content_plans`, `content_pillars`,
   `content_comments`, `content_approvals`, `content_deck_sections`.
3. In `src/main.tsx`, remove the `./data/local-api` import and load the
   initial items from `GET /api/v1/content` (or server-render them, as Sous
   does) before rendering `ContentView`.
4. Replace the stand-ins as the features come back:
   - `src/lib/content/upload-client.ts`: upload to your storage and return the
     public URL.
   - `src/lib/supabase/client.ts`: return your auth client. It's used for the
     signed-in user's id and name (comment edit rights, author names).
   - `GET /api/v1/tasks` returning `{ users: TaskUser[] }` turns on the people
     features (ask for input, @mentions in comments).

If the new app is Next.js, the files move across almost as they are: the `@/`
alias matches, the components already carry `"use client"`, and you delete
`src/shims/next-dynamic.tsx` (and its alias in `vite.config.ts` and
`tsconfig.json`) so the real `next/dynamic` is used.

## Known limits of the standalone build

- **AI planner** ("Preview with AI" in Add plan) needs a server with an
  Anthropic key, so it reports "isn't available". The quick generator and
  pasting a list or CSV work.
- **People features** are empty until `/api/v1/tasks` returns users.
- **Grid** has no live Instagram connection: only images added by hand.
- **Artboards** (Mock-ups canvas and artboard editor) are not included.
- **Storage** is per browser until a backend is connected.

## Theme

Sous is dark by default and light when `<html data-theme="light">`. With no
attribute set, this build follows the OS setting (see the end of
`src/app.css`). Set `data-theme` on `<html>` to force one.

## Fonts

The design uses **Graphik**, a commercial font, which is not included. Without
it the app falls back to the system font, and the layout is unchanged. See
`public/fonts/README.md` for the files the CSS expects.
