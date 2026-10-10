# Zoro Luna dashboard — 10-minute setup

The store is a static site, so orders need somewhere to live. This uses a **Google Sheet** as your
order database and a tiny **Google Apps Script** as the connection. It is free, you own the data, and you
get an **email for every new order**.

## 1. Create the Sheet + script
1. Go to <https://sheets.new> and name it **Zoro Luna Orders**.
2. Menu **Extensions → Apps Script**. Delete the sample code and paste the whole of `Code.gs`.
3. Click the ⚙ **Project settings → Script properties → Add property**:
   - `ADMIN_EMAIL` = the email you will sign in with
   - `ADMIN_PASSWORD` = a long password you invent
   - `NOTIFY_EMAIL` = the email that should receive new-order alerts (optional)
4. In the editor choose the function **setup** and click **Run**. Approve the permissions (Sheets + Mail).

## 2. Publish it as a web app
1. **Deploy → New deployment → type: Web app**
2. *Execute as:* **Me** · *Who has access:* **Anyone**
3. Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

## 3. Connect the store
Put the URL in **both** repos' `config.js` as `const ORDERS_API = "PASTE_THE_URL_HERE";` and push:
- the store (`zoro-luna`) — so checkout sends orders to your Sheet (you get an email for each one)
- the dashboard (`zoro-luna-admin`) — so the sign-in page knows where to log in

## 4. Open the dashboard
This site is the dashboard: `https://admin.zoroluna.shop`. Sign in with your `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
Turn on the 🔔 bell to get a sound + desktop notification while the dashboard tab is open.

### Good to know
- Your email + password are checked on Google's side and never stored in the page. After 8 wrong tries sign-in locks for 15 minutes. "Keep me signed in" lasts 30 days; Sign out ends the session.
- Anyone can *place* an order through the public endpoint (that is how checkout works). Totals are not
  re-calculated server-side, so check amounts before shipping.
- If you change `Code.gs` later, use **Deploy → Manage deployments → ✏ → New version**.
