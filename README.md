See [YENILIKLER.md](YENILIKLER.md) for cart price/stock checks, categories, live admin updates and the refreshed interface.

# Instagram Shop Order Manager

Mobile-first guest ordering for a small Instagram clothing store. It uses the SQLite database bundled with Node.js and Nodemailer for Gmail notifications. Run `npm install` before starting.

For Gmail setup with **highweartr@gmail.com**, read [GMAIL-KURULUM.md](GMAIL-KURULUM.md). Messages go to the email address entered on each order. Never share `.env` or commit Gmail credentials.

## Features

- Guest checkout: customers select pre-added products and quantities, then supply name, phone, and delivery address.
- Product prices are shown in AZN and USD; the configurable exchange rate defaults to **1 USD = 1.70 AZN**.
- Password-protected admin area with newest-first orders, name/phone search, status filter, and visible cancelled orders.
- Admin product creation, editing, hiding/reactivating, pricing, and exchange-rate management.
- Status history and a durable email queue in SQLite. Order confirmations and every actual status change create email events. Gmail acceptance and failures are visible in Admin Settings.
- Real `.xlsx` export with typed amounts, dates, filters, an order summary and item detail sheet.
- Seeded demonstration products, responsive phone layout, parameterized SQL, authenticated sessions, CSRF protection on admin changes, and no password in source control.

## Run locally

1. Install Node.js **22.5 or newer**. Node 24 is recommended.
2. In this folder, copy `.env.example` to `.env`.
3. Set a long private password in `.env`:

   ```env
   ADMIN_PASSWORD=use-a-long-random-password-here
   PORT=3000
   ```

4. Start the app:

   ```bash
   npm install
   node server.js
   ```

5. Open `http://localhost:3000` for the customer page or `http://localhost:3000/admin/login` for the admin page.

The app automatically creates `data/shop.sqlite` and seeds inactive example products on its first start. Set prices, stock and visibility in Admin. Keep `data/` private: it contains customer orders. It is intentionally ignored by Git. When updating an existing installation, preserve its `data/`, `uploads/` and `.env`.

## Deploy without GitHub

For a trial deployment, use a host that supports a **persistent disk** (for example Railway with a volume, or Render with a persistent disk). Do not deploy this version to a serverless host or a host whose local disk resets: the SQLite order database would be erased after a restart.

1. Create a new service/project on the host and upload this folder or connect a repository later.
2. Set `ADMIN_PASSWORD` in the host's environment-variable screen; never upload the `.env` file.
3. Set the start command to `node server.js`.
4. Attach a persistent disk and mount it at the app directory so the `data/` folder survives restarts. If the host asks for a mount path, use the folder containing the deployment, then verify that `data/shop.sqlite` remains after a redeploy.
5. Open the public URL, place a test order, restart/redeploy once, and confirm the order is still in Admin.
6. Send the public URL to the client, and send the admin password privately—not in the README, chat history, or repository.

## Routes

| Route | Use |
|---|---|
| `/` | Customer order page |
| `/thank-you?id=…` | Order confirmation |
| `/admin/login` | Admin password login |
| `/admin` | Orders, search, status, notification records, export |
| `/admin/products` | Product and price management |
| `/admin/settings` | Exchange-rate management |
| `/admin/export.xlsx` | Excel workbook export (admin only) |
| `/health` | Plain `ok` health check |

## Database tables

`products`, `settings`, `orders`, `order_items`, `order_status_history`, and `notifications` are all created in `data/shop.sqlite`. `order_items` deliberately keeps the product name and price from the moment the order was placed, so old orders stay accurate after a product or price changes.

## Email notifications

`mail-service.js` owns the Gmail SMTP connection and durable `email_outbox` queue. Checkout and status changes add events in their database transactions. The worker retries transient failures, and Admin Settings displays recent attempts and offers manual retry after five failed attempts. `submitted` means Gmail accepted the message, not confirmed inbox delivery. Existing legacy `notifications` rows are not mailed. Future SMS can be added as a separate channel. See [GMAIL-KURULUM.md](GMAIL-KURULUM.md) for environment variables, limitations and setup.

## Test checklist before handover

1. Create a customer order with two products and quantities.
2. In Admin, search it by name and then by phone.
3. Check Admin Settings for the order confirmation email event.
4. Change its status and confirm a new email event appears. With Gmail configured, verify receipt at the address entered on the order. Repeating the same status must not produce another event.
5. Filter `Ləğv edildi` and confirm the order remains visible.
6. Change a product price and the exchange rate; check the customer page updates.
7. Download `auren-orders-YYYY-MM-DD.xlsx` and open it in Excel.
8. Restart the app and confirm existing orders remain.
