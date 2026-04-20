# Auth / OTP troubleshooting

The sign-in flow is email OTP via Supabase → SMTP → user's inbox. Every link
in that chain can fail in a different, confusing way. This doc covers the
common breakages and the quickest path to unblock.

## The happy path

1. User enters email on `/apply/signin`
2. Frontend → `POST /auth/request-otp` on backend
3. Backend → `supabase.auth.sign_in_with_otp()` on Supabase
4. Supabase generates a 6-digit OTP, asks SMTP provider to email it
5. User receives email, enters code on `/apply/verify`
6. Frontend → `POST /auth/verify-otp` → access + refresh tokens

Any break between steps 3 and 5 lands you on this page.

## Immediate unblock: fetch the OTP without email

Dev-only. Needs the service-role key (already in `backend/.env`):

```bash
cd backend
source .venv/bin/activate
python scripts/dev_get_otp.py dev@artpark.in
```

Output:

```
┌─────────────────────────────────────────────┐
│  OTP code: 273921                           │
└─────────────────────────────────────────────┘

Or click this magic link to sign in directly:
  https://...supabase.co/auth/v1/verify?token=...&type=magiclink
```

Use the 6-digit OTP on `/apply/verify`, **or** click the magic link to
auto-sign-in (bypasses /verify entirely).

The magic link expires after ~1 hour.

**⚠ Never run this in prod.** The service-role key bypasses RLS.

## Reading the backend 500 / 429 / 502

When `/auth/request-otp` fails, the backend tells you exactly why via the
`error.code` field in the JSON response:

| `error.code` | HTTP | What it means | Fix |
|---|---|---|---|
| `supabase_email_rate_limited` | 429 | Supabase project email cap hit (built-in: 2/hr; custom SMTP: whatever you set) | Wait, or raise the limit in Supabase Dashboard → Authentication → Rate Limits |
| `supabase_smtp_failed` | 502 | Supabase called your SMTP provider and got rejected | See "SMTP send failure" below |
| `auth_error` | 500 | Everything else — network error, DNS, unknown | Check Supabase status + your internet |
| `otp_invalid` | 401 | Wrong code on verify-otp | Re-request a fresh code |

## SMTP send failure (most common after initial setup)

Symptoms: `/auth/request-otp` returns 502 `supabase_smtp_failed`, or backend
log shows `AuthApiError: Error sending confirmation email`.

### Cause: sender email not verified with Resend / SES

Supabase will try to send FROM whatever address you put in
**Supabase Dashboard → Authentication → SMTP Settings → Sender email**. If
that address' domain isn't verified in Resend (or SES), the SMTP provider
rejects the send.

### Fix A — use the sandbox sender (fastest)

For Resend: change **Sender email** to `onboarding@resend.dev`. Resend
pre-verifies that address. OTP emails will arrive but look like they're
from Resend's sandbox — fine for dev.

### Fix B — verify your own domain

1. Resend Dashboard → **Domains → Add Domain** → enter `artpark.in`
2. Copy the DNS records Resend shows (SPF, DKIM, DMARC)
3. Add them to your DNS provider (Cloudflare / Route53 / GoDaddy / whatever)
4. Wait 5–60 min for verification
5. Back in Supabase, set Sender email to any address on that domain
   (`noreply@artpark.in`, `auth@artpark.in`, etc.)

### Checking Resend's side

Resend Dashboard → **Emails** (the logs page). Every attempted send shows up,
including failures, with the exact reason. If nothing shows up at all,
Supabase isn't reaching Resend — check SMTP credentials (Username must be
literally `resend`; Password is your `re_...` API key).

## Supabase SMTP config that works (reference)

For Resend:

| Field | Value |
|---|---|
| Enable Custom SMTP | **ON** |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your `re_...` API key |
| Sender email | `onboarding@resend.dev` (dev) or `noreply@artpark.in` (after domain verification) |
| Sender name | `ARTPARK EIR` |
| Minimum interval between emails | 0 (or blank) |

For AWS SES (later):

| Field | Value |
|---|---|
| Host | `email-smtp.ap-south-1.amazonaws.com` |
| Port | `465` |
| Username | SES SMTP username (NOT your IAM access key) |
| Password | SES SMTP password |
| Sender email | verified SES identity |

## Rate limit math (per email)

The backend also enforces its own per-email rate limit separate from Supabase:

- Request OTP: **1 per 30 seconds per email** (matches the UI resend countdown)
- Verify OTP: **10 per 5 minutes per email** (brute-force defence)

Failed sends (network errors, Supabase errors) do **not** count against
request-OTP quota. Only successful sends consume a slot.

If the user gets a 429 from our backend (not Supabase's), wait 30 seconds
and try again. If they get 429 from Supabase surfaced as 429, wait longer
or bump the Supabase rate limit in the dashboard.

## Starting over cleanly

If the backend rate limiter is jammed from a previous flaky session, restart
uvicorn — the counters live in memory.

```bash
# Ctrl+C the uvicorn process, then:
cd backend && source .venv/bin/activate
uvicorn app.main:app --port 8000
```

Supabase's own counters reset on their hourly schedule — no way to force-clear
from the outside (without upgrading the plan's rate-limit ceiling).
