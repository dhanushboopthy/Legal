# Razorpay setup — from zero to production

The code side of this is already done: `app/services/payment_service.py`
creates orders and verifies webhook signatures, `app/routers/webhooks.py`
handles `payment.captured`/`payment.failed`/`refund.processed`, and the
frontend (`src/hooks/use-razorpay.ts`) opens Razorpay's own hosted checkout
— card/UPI details never touch our server, so there's no PCI-DSS burden on
this app. What's left is entirely account and infrastructure setup, in this
order.

## 1. Create a Razorpay account

1. Sign up at https://dashboard.razorpay.com/signup.
2. You land in **Test Mode** immediately — no KYC/business verification
   needed for this. Everything below works in Test Mode.
3. KYC (business PAN, bank account, etc.) is only required to switch to
   **Live Mode** and actually settle real money — see §5.

## 2. Get Test API keys

Dashboard → **Settings → API Keys** → **Generate Test Key**. You'll get a
`Key Id` (starts `rzp_test_...`) and a `Key Secret` — the secret is shown
once, save it now.

Put them in `.env`:

```bash
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
```

## 3. Set up the webhook

The webhook is how a payment actually gets marked paid in this app —
`docs/workflow.md`'s rule that "payments are webhook-driven, never
client-confirmed" means nothing happens on the frontend's checkout success
callback alone. Razorpay needs a **public HTTPS URL** to call; `localhost`
won't work, which is why you need a tunnel until you have a real domain.

**Local testing now (no domain needed):**

ngrok requires a free account now (sign up at https://ngrok.com, then
`ngrok config add-authtoken <token>` from your dashboard's setup page,
once):

```bash
# with the api running on :8000 (or via docker compose)
npx ngrok http 8000
```

ngrok prints a URL like `https://abcd1234.ngrok-free.app`. In the Razorpay
Dashboard → **Settings → Webhooks → Add New Webhook**:

- **URL**: `https://abcd1234.ngrok-free.app/webhooks/razorpay`
- **Secret**: generate any random string (`openssl rand -hex 32`) — this is
  the shared secret Razorpay signs the payload with, not an API key
- **Active events**: check `payment.captured`, `payment.failed`,
  `refund.processed` (exactly the three this app handles)

Put the same secret in `.env`:

```bash
RAZORPAY_WEBHOOK_SECRET=<the random string you generated above>
```

Restart the api service after editing `.env` so it picks up all three
values.

## 4. Test the full flow

Razorpay's test cards/UPI (Test Mode only, never real money):

| Method | Test values |
|---|---|
| Card | `4111 1111 1111 1111`, any future expiry, any 3-digit CVV |
| UPI | VPA `success@razorpay` (always succeeds) or `failure@razorpay` (always fails — useful for testing the `payment.failed` path) |

End-to-end check:
1. Register a junior lawyer, verify the email OTP, get an admin to
   approve them.
2. Submit a case, click **Pay now** on the review-fee panel.
3. Pay with the test card/UPI above.
4. Watch the api logs (or ngrok's request inspector at
   `http://127.0.0.1:4040`) for the incoming webhook call and a
   `payment.captured`/`payment.failed` log line from
   `app/services/payment_service.py`.
5. The case-detail page should flip to the next status within a few
   seconds — it polls `GET /cases/{id}` after checkout closes rather than
   trusting the client-side callback (see `case-detail-page.tsx`'s
   `awaitingStatus` logic).
6. As `super_admin`, try `POST /payments/{id}/refund` (the Refund button on
   `/admin/payments`) against the now-`paid` payment and confirm the
   `refund.processed` webhook lands and flips it to `refunded`.

## 5. Going live

Once you've picked a host and have a real domain with HTTPS:

1. **Complete KYC** in the Razorpay Dashboard (business PAN, bank account
   for settlements, address proof — Razorpay walks you through it) to
   unlock Live Mode.
2. **Generate Live API keys** (Dashboard → Settings → API Keys → switch to
   Live Mode). These start `rzp_live_...`. Never commit them — set them
   directly in your production host's environment/secrets, the same way
   `SECRET_KEY` is handled today.
3. **Add a second webhook** in Live Mode pointing at
   `https://yourdomain.com/api/webhooks/razorpay` (through nginx's `/api/`
   proxy — see `frontend/web/nginx.conf`), same three events, a new
   random secret. Test-mode and live-mode webhooks are configured
   separately in the dashboard.
4. **TLS**: `frontend/web/nginx.conf` currently only serves plain HTTP —
   Razorpay's live webhooks require HTTPS. The easiest path depends on
   where you host:
   - A platform with built-in TLS (Render, Railway, Fly.io, an AWS
     ALB+ACM, a VPS behind Cloudflare's proxy) — nothing to change here,
     the platform terminates TLS in front of the `web` container.
   - A bare VPS — add Certbot/Let's Encrypt in front of nginx (a small,
     well-documented addition; ask when you're at this step and I'll wire
     it into `nginx.conf` for your specific setup).
5. Set the production `.env`: `ENVIRONMENT=production`, `DEBUG=false`
   (this also disables `/docs` and `/redoc` per `app/main.py`), the live
   `RAZORPAY_*` values, and update `CORS_ORIGINS`/`GOOGLE_CLIENT_ID` for
   the real domain if not already done.
6. Re-run the §4 checklist once against Live Mode with a small real
   payment before considering it done — Test Mode success doesn't
   guarantee Live Mode webhook delivery (different secret, different URL).

## Notes / gotchas already handled in code

- Amounts are paise (`int(amount_inr * 100)` in `payment_service.py`) —
  Razorpay's API always wants the smallest currency unit.
- Webhook signature verification (`verify_webhook_signature`) uses
  `hmac.compare_digest`, not `==` — timing-safe by design already.
- The webhook route is exempted from the global rate limiter
  (`app/routers/webhooks.py`) since it's Razorpay calling in, not a user —
  don't add a per-user limit there.
- `payment.captured` handling is idempotent (checks `status == PAID`
  first) — Razorpay retries webhook delivery on non-2xx responses, so this
  matters.
