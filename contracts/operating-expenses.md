# Operating expense ledger

Owner and manager sessions can enter and read expenses for their branch. Records use PHP centavos and calendar dates in Asia/Manila. The authority assigns the branch, author, entry ID and recorded time. Expense records have no effect on drawer balances, payments or stock.

## Record an expense

`POST /api/v1/admin/expenses` accepts `{commandId,category,description,amountCentavos,startsOn,endsOn}`. Use a UUID command ID, a trimmed category of 1–80 characters, a trimmed description of 1–240 characters, and an integer amount of 1–1,000,000,000 centavos. Dates are valid ISO calendar dates (years 0001–9999) and the end is on or after the start. Identical start and end dates represent one-time expenses. Reject unknown fields.

The response is `{commandId,expense:{id,category,description,amountCentavos,startsOn,endsOn,recordedAt}}`. `recordedAt` is epoch milliseconds. The expense, acceptance receipt, audit and outbox commit together. An exact retry returns the original response. Reuse with a changed request returns 409.

## Read a period

`GET /api/v1/admin/expenses?from=YYYY-MM-DD&through=YYYY-MM-DD` requires both dates and includes the entire last day. The response is `{from,through,allocatedCentavos,expenses,truncated}`. Details include the recorded expense fields and `allocatedCentavos`, ordered by recorded time descending, then ID ascending. At most 100 overlapping details are returned. The allocated total includes all overlaps. The server rejects invalid dates, reversed ranges and unknown query fields.

Allocate each expense evenly across the days it covers. For an overlap starting `s` days from the expense start and ending just before offset `e`, allocate `floor(amountCentavos * e / days) - floor(amountCentavos * s / days)`. Adjacent reports add up exactly to the recorded centavos. An expense of 30,001 centavos for November 1–30 allocates 15,000 centavos to November 1–15 and 15,001 to November 16–30.

This ledger totals entered expenses. Estimated operating profit requires reconciled sales, dated settlement, ingredient valuation and expense completeness. Correction and period coverage workflows are separate acceptance work.
