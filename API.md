# API contract

The routes the Content views call. `src/data/local-api.ts` answers all of them
in the browser; a real backend must answer them with the same shapes.

- All bodies are JSON. Successful responses wrap results in `data` unless noted.
- Errors use `{ "error": { "code": string, "message": string } }` with a 4xx/5xx
  status. The views show `message` to the user, so write it as plain advice.
- Dates are calendar days, `"YYYY-MM-DD"`. Timestamps are ISO 8601 strings.
- Types (`ContentItem`, `ContentPlan`, `ContentPillar`, `ContentComment`,
  `ContentApproval`) are in `src/lib/content/types.ts`. `TaskUser` is in
  `src/lib/tasks/types.ts`.

## Items

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/content` | | `{ data: ContentItem[] }` |
| POST | `/api/v1/content` | partial `ContentItem` (no id, region, creator, timestamps) | `201 { data: ContentItem }` |
| GET | `/api/v1/content/:id` | | `{ data: ContentItem }` |
| PATCH | `/api/v1/content/:id` | partial `ContentItem` (at least one field) | `{ data: ContentItem }` |
| DELETE | `/api/v1/content/:id` | | `{ ok: true }` |

New items default to `kind: "card"`, `source: "manual"`, `status: "idea"`,
empty arrays for `post_channels`, `post_links`, `post_images`, `source_media`,
`post_tags`, `post_accounts`, and `{}` for `post_copy_channels`.
`post_channel` mirrors the first member of `post_channels`. A post shows on the
calendar when it is a planned post (see `isPlannedPost`) with a
`scheduled_for` date.

## Bulk date shift

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/v1/content/shift` | `{ ids: string[], delta_days: number }` (non-zero) | `{ moved, skipped, failed: string[] }` |

Only items that already have a `scheduled_for` move.

## Plans

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/content/plans` | | `{ data: ContentPlan[] }` (with `item_count`, `scheduled_count`) |
| POST | `/api/v1/content/plans` | `{ name, event_date, pillar_id? }` | `201 { data: ContentPlan }` |
| PATCH | `/api/v1/content/plans/:id` | any of `{ name, event_date, pillar_id }` | `{ data: ContentPlan, shifted: number }` |
| DELETE | `/api/v1/content/plans/:id` | | `{ ok: true }` |
| POST | `/api/v1/content/plan` | `{ text?, prompt?, images? }` | `{ data: PlanItem[] }` (AI planner) |

Changing a plan's `event_date` moves every member item's `scheduled_for` by the
same number of days. Deleting a plan un-groups its items (`plan_id` to null)
and never deletes them. The AI planner returns `503 not_configured` here.

## Pillars

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/content/pillars` | | `{ data: ContentPillar[] }` |
| POST | `/api/v1/content/pillars` | `{ name, color?, description? }` | `201 { data: ContentPillar }` |
| PATCH | `/api/v1/content/pillars/:id` | partial pillar, or `{ archived: boolean }` | `{ data: ContentPillar }` |
| DELETE | `/api/v1/content/pillars/:id` | | `{ ok: true }` |

## Comments

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/content/:id/comments` | | `{ data: ContentComment[] }` (oldest first) |
| POST | `/api/v1/content/:id/comments` | `{ body, asAction? }` | `201 { data: ContentComment, action_task_id: string \| null }` |
| PATCH | `/api/v1/content/:id/comments/:commentId` | `{ body?, resolved? }` | `{ data: ContentComment }` |
| DELETE | `/api/v1/content/:id/comments/:commentId` | | `{ ok: true }` |

## Review (approval)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/content/:id/approval` | | `{ data: { latest: ContentApproval \| null, history: ContentApproval[] } }` |
| POST | `/api/v1/content/:id/approval` | `{ action: "request" }` | `201 { data: ContentApproval }` |
| POST | `/api/v1/content/:id/approval` | `{ action: "decide", decision: "approved" \| "changes_requested", note? }` | `{ data: ContentApproval }` |

In Sous a person can't decide their own request. The local store allows it
because there is only one user.

## Input request ("Awaiting input")

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/v1/content/:id/input-request` | `{ user_id, what }` | `201 { data: { item: ContentItem, task: object \| null } }` |
| DELETE | `/api/v1/content/:id/input-request` | | `{ data: ContentItem }` |

## Deck section breaks

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/content/deck-sections` | | `{ data: DeckSection[] }` |
| POST | `/api/v1/content/deck-sections` | `{ label, position }` | `201 { data: DeckSection }` |
| PATCH | `/api/v1/content/deck-sections/:id` | `{ label?, position? }` | `{ data: DeckSection }` |
| DELETE | `/api/v1/content/deck-sections/:id` | | `{ ok: true }` |

`DeckSection` is `{ id, region_id, label, position, created_at }`.

## Grid

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/v1/content/ig-grid` | | `{ data: { images, reels, profile, layout, hidden_coming, live, live_failure, live_stale } }` |
| PUT | `/api/v1/content/ig-grid` | partial grid | `{ data: grid }` |

`live` is the connected Instagram account's posts, or null. The local store
always returns null.

## People

| Method | Path | Response |
|---|---|---|
| GET | `/api/v1/tasks` | `{ users: TaskUser[] }` |

Returns an empty list here, which hides the people features.

## Answered empty (artboards are not in this export)

`GET /api/v1/content/canvas` returns `{ data: { snapshot: null } }`.
`/api/v1/content/artboard-pages`, `artboard-templates` and `fonts` return
`{ data: [] }`.
