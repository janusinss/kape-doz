# Admin shift review

Both routes require an active owner or manager session for the branch. Staff and unauthenticated clients cannot see expected cash, variance or closing notes.

- `GET /api/v1/admin/shifts` returns `{shifts, truncated}`. Each item contains `id`, `drawerId`, `status`, `version`, `openingCashCentavos`, `countedCashCentavos`, `expectedCashCentavos`, `varianceCentavos`, `openedAt`, `submittedAt` and `note`. Timestamps are Unix milliseconds. Variance is counted minus expected. The list includes submitted, recount and closed shifts and excludes open shifts. It returns the latest 100 by submitted timestamp descending, then ID. `truncated` indicates older results exist.
- `POST /api/v1/shifts/:id/review` uses `{commandId,expectedVersion,decision}` with `approve` or `recount`. Both actions require `awaiting_review`. A stale version returns 409 and the client refreshes the list. An uncertain outcome is retried with the same command ID and payload.

A recount retains the original count and cash lock until the cashier submits the replacement. Closed rows use the final approved figures. The portal labels them separately from counts awaiting a decision.
