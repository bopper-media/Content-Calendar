# Sous Content: standalone export

This repo is the **Content calendar and post slide from Sous**, lifted out of
the Sous platform (Next.js 16 + Supabase) into a standalone Vite + React 19 +
Tailwind v4 app. The view components are the Sous source files, kept as close
to the original as possible. Read `README.md` and `API.md` before changing
anything.

## Commands

- `npm install`, then `npm run dev`: run it locally (opens empty).
- `npm run typecheck`: must pass (strict TypeScript).
- `npm run build`: type-check and production build to `dist/`.

## How the data works (the one thing to understand first)

Every view talks to the server with `fetch("/api/v1/...")`, exactly as in Sous.
`src/data/local-api.ts` intercepts those calls and answers them from
`localStorage`, returning the same response shapes the Sous routes return.

To connect a real backend, implement the routes in `API.md` on your server
(same paths, same JSON shapes), then remove the `./data/local-api` import from
`src/main.tsx` and pass the server's items into `ContentView`. Do not change the
response shapes without changing the components that read them.

## Rules for working here

- The canonical data shape is `ContentItem` in `src/lib/content/types.ts`. The
  enums there (channels, statuses, mediums, plan roles) drive the UI.
- Styling is the Sous "Frosted" design system in `src/app.css`: CSS variables
  (`--canvas`, `--card`, `--text`, `--hairline`, `--btn-primary`...), light and
  dark. Components use inline styles that read those variables. Keep new UI on
  the same variables.
- Files under `src/components/artboards/`, `ExcalidrawBoard.tsx`,
  `useArtboardPreview.ts`, `src/lib/supabase/client.ts`,
  `src/lib/content/upload-client.ts` and `src/shims/next-dynamic.tsx` are
  stand-ins, not the Sous originals. See README "What changed from Sous".
- Artboards (the Mock-ups canvas and the artboard editor) were left out on
  purpose. Don't add Excalidraw or tldraw back unless asked.
- Fonts: the design uses Graphik, a licensed font that is not included. See
  `public/fonts/README.md`.
