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

---

## 5. Razorpay online payments (UPI, cards, netbanking)

Customers who pick "UPI / Cards / Net banking" at checkout now pay through Razorpay's secure window.
The order is priced on **Google's side** (from `https://zoroluna.shop/prices.json`), the payment is
verified with Razorpay's signature, and the order is marked **Paid** in the dashboard automatically.

1. In your Razorpay dashboard open **Account & Settings → API Keys → Generate Test Key**.
   Copy the **Key Id** (`rzp_test_…`) and **Key Secret**.
2. In Apps Script → **Project settings → Script properties** add
   - `RAZORPAY_KEY_ID` = the key id
   - `RAZORPAY_KEY_SECRET` = the key secret (never put this in the website or GitHub)
3. Paste the latest `Code.gs`, choose the function **setup**, click **Run** and approve the new
   permission ("connect to an external service").
4. **Deploy → Manage deployments → ✏ → New version → Deploy.**
5. Place a test order at https://zoroluna.shop and pay with Razorpay's test UPI `success@razorpay`
   (or test card `4111 1111 1111 1111`, any future date, any CVV). It should show **Paid** in the dashboard.
6. To go live: complete Razorpay's KYC/activation, generate **Live** keys, and replace the two script properties.
   No website change is needed.

If a customer pays but closes the tab before confirmation, open the order in the dashboard and click
**Check payment with Razorpay** — it will mark the order Paid if the money arrived.

### When you change a price or coupon
Edit `site.js` in the store repo, run `node tools/build-prices.js`, and push both `site.js` and `prices.json`.
The backend always charges from `prices.json`, so the customer can never pay a tampered price.
