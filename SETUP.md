# Zoro Luna dashboard — 10-minute setup

The store is a static site, so orders need somewhere to live. This uses a **Google Sheet** as your
order database and a tiny **Google Apps Script** as the connection. It is free, you own the data, and you
get an **email for every new order**.

## 1. Create the Sheet + script
1. Go to <https://sheets.new> and name it **Zoro Luna Orders**.
2. Menu **Extensions → Apps Script**. Delete the sample code and paste the whole of `Code.gs`.
3. Click the ⚙ **Project settings → Script properties → Add property**:
   - `ADMIN_KEY` = a long password you invent (this is your dashboard login)
   - `NOTIFY_EMAIL` = the email that should receive new-order alerts (optional)
4. In the editor choose the function **setup** and click **Run**. Approve the permissions (Sheets + Mail).

## 2. Publish it as a web app
1. **Deploy → New deployment → type: Web app**
2. *Execute as:* **Me** · *Who has access:* **Anyone**
3. Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

## 3. Connect the store
In the **store repo** (`zoro-luna`), open `config.js`, set `const ORDERS_API = "PASTE_THE_URL_HERE";` and push.
New orders now land in the Sheet and you get an email.

## 4. Open the dashboard
This site is the dashboard: `https://www.akashv.site/zoro-luna-admin/`. Paste the same Web app URL, enter your `ADMIN_KEY`.
(Optional: paste the URL into this repo's `config.js` too so the login box is pre-filled.)
Turn on the 🔔 bell to get a sound + desktop notification while the dashboard tab is open.

### Good to know
- The ADMIN_KEY is checked on Google's side — without it nobody can read or change orders.
- Anyone can *place* an order through the public endpoint (that is how checkout works). Totals are not
  re-calculated server-side, so check amounts before shipping.
- If you change `Code.gs` later, use **Deploy → Manage deployments → ✏ → New version**.
