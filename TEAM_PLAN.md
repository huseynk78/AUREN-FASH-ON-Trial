# Day-1 plan to send

**Person 1 — data and admin:** inspect the starter repository; own database schema, migrations/seeding, admin authentication, orders list/search/filter/status changes, Excel export, and deployment configuration.

**Person 2 — customer flow and quality:** own mobile order form, product/quantity UI, AZN/USD display, client validation, responsive styling, notification-event presentation, manual testing, README, and handover note.

**Order of work:** agree schema and status rules first; then Person 1 opens a PR for database/admin foundations while Person 2 opens a separate PR for customer UI; each reviews the other’s PR with concrete comments; integrate, test on a phone, deploy to persistent storage, and run the handover checklist together.

**Git rule:** each person works on a branch, makes small descriptive commits from their own machine, opens a pull request, and waits for the other person’s written review before merge. Keep the review comments—even on good PRs—because the trial explicitly evaluates them.
