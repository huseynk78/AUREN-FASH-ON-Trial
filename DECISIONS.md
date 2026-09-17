# Clarifications and decisions

This note is intentionally brief enough for the handover requirement.

| Ambiguity | Decision | Reason |
|---|---|---|
| The original message says `paid`; clarification names `Confirmed` as a notifying status. | Statuses are New, Confirmed, Processing, Shipped, Delivered, Cancelled. | The later clarification is more specific. `Processing` is an internal, non-notifying status. |
| The original text says to multiply by 1.70 for USD. | The app stores `1 USD = 1.70 AZN` and calculates USD as AZN ÷ rate. | This is the conventional direction of that rate and gives sensible AZN/USD prices. The rate is editable. |
| The original request mentions customer accounts and reorder. | Neither is included. | The clarification explicitly limits trial scope to account-free orders. |
| The original request asks for customer notifications but trial scope excludes real SMS/WhatsApp. | Notification events are recorded and shown in Admin only for Confirmed, Shipped, Delivered, and Cancelled. | It demonstrates the complete trigger path now and leaves one clear adapter seam for a real channel later. |
| Product input was initially phrased as a name field. | Customers choose only existing active products and quantities. | The clarification rules out free text and allows admin-managed pricing. |
| “Excel file” could mean a proprietary `.xlsx` package. | Export uses Excel-compatible SpreadsheetML `.xls`. | It opens directly in Microsoft Excel without adding a dependency; this is suitable for a trial accountant export. |
| Old products may be unavailable later. | Products are hidden/reactivated rather than deleted; past line items retain price/name snapshots. | Keeps historical orders accurate and avoids breaking past records. |
