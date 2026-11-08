# Ace Studio — the 6 legal traps (Daily Dev Drops video, 2026-11-08)

Plain-words version of the video "Your vibe-coded app can get sued for
$100,000": six things that get small apps in trouble under US/EU law.
The video itself says it is not legal advice — neither is this file.
Each trap below says what was found in this app, what was changed, and
what is still a decision for Kenneth on launch day.

## 1. No age check on signup (COPPA — kids signing up) — FIXED

**Found:** the signup form asked for email, phone and password only.
Anyone, any age, could create an account.

**Changed:**

- `src/routes/signup.tsx` — required checkbox: "I confirm I am 18 years
  or older." The page refuses to submit without it.
- `src/lib/auth/api.ts` — the signup API now rejects the request
  server-side (`400 age_not_confirmed`) unless the body carries
  `ageConfirmed: true`. The page's checkbox alone is not trusted,
  because anyone can call the API directly. The confirmation is stored
  in the user's Supabase metadata (`age_confirmed: true`); no date of
  birth is collected or stored.
- `src/lib/auth/api.test.ts` — new test: signup with the confirmation
  missing, or `false`, is rejected and creates no account.

**Still open:** this is a self-declared checkbox, not ID verification —
a child can still tick it. That is the normal approach for a small app;
real age verification is a launch-day decision for Kenneth, not a code
change made here. The existing 6–8 password rule and dial-code picker
were left untouched.

## 2. Fonts sending visitor IPs to Google (GDPR) — FIXED

**Found:** every page load pulled two fonts (Bricolage Grotesque,
Plus Jakarta Sans) from Google Fonts — a `<link>` to
`fonts.googleapis.com` plus preconnects to `fonts.googleapis.com` and
`fonts.gstatic.com` in `src/routes/__root.tsx`. Every visitor's IP
address went to Google just to load the page. (The app's own
Content-Security-Policy already blocked the Google stylesheet, so the
fonts were likely falling back to system fonts anyway — but the
preconnects still contacted Google.)

**Changed:**

- Downloaded the same two fonts (variable-font woff2, latin only, weight
  200–800) once and bundled them in `public/fonts/`:
  `bricolage-grotesque.woff2` (41 KB), `plus-jakarta-sans.woff2` (27 KB).
- `src/styles.css` — `@font-face` rules point at the bundled files.
  The font family names (`"Plus Jakarta Sans"`, `"Bricolage Grotesque"`)
  are unchanged, so the look is identical.
- `src/routes/__root.tsx` — the Google Fonts links and preconnects are
  removed. No page now loads anything from Google Fonts.
- Verified after the change: no `<script>` or `<link>` in the app loads
  anything from an outside address. The only `googleapis.com` strings
  left are the server-side YouTube upload endpoints
  (`src/lib/posting/youtube.ts`, `src/lib/posting/download.ts`) — those
  run only when a user posts a video to YouTube, and they are API calls,
  not visitor tracking.

**Still open:** nothing. No third-party font, tracker or CDN script is
loaded by the app.

## 3. Session replay recording keystrokes (California wiretapping) — NONE FOUND

**Found:** nothing. Searched the code and `package.json` for PostHog,
FullStory, Hotjar, LogRocket, Microsoft Clarity, Amplitude, Mixpanel,
Sentry, Heap, Matomo, Plausible, Google Analytics and "session replay".
No such package is installed and no analytics or replay script is
loaded. The only thing that looks like telemetry is
`src/lib/lovable-error-reporting.ts`, which only fires if
`window.__lovableEvents` exists — that only exists inside the Lovable
editor preview, so it is a no-op in the real app.

**Changed:** nothing — there was nothing to remove.

**Still open:** if an analytics or replay tool is ever added, it needs
Kenneth's say-so first, and a replay tool that records keystrokes must
never be added without a proper consent notice.

## 4. Emails with no unsubscribe link (CAN-SPAM) — NOTHING SENT BY THE APP

**Found:** the app itself sends no email at all. Searched for
nodemailer, Resend, SendGrid, Mailgun, SMTP and every other mail
sender — none exists in the code. The only emails a user ever gets are
Supabase Auth's own messages: the account-confirmation email (sent by
`auth.signUp`) and the password-reset email (sent by
`auth.resetPasswordForEmail`). Those are sent by Supabase, and their
wording lives in the Supabase dashboard, not in this code.

**Changed:** nothing — there is no app email to add a link to.

**Still open (launch-day decision for Kenneth):** in the Supabase
dashboard, check the confirmation and reset email templates and add an
unsubscribe/footer line if he wants one. Note that password-reset and
confirmation emails are transactional (the user asked for them), so the
unsubscribe rule mainly matters if the app ever starts sending
marketing emails — which it does not.

## 5. Renewal terms not next to the pay button — NO PAYMENTS EXIST

**Found:** the app has no payments, no subscriptions, no renewal and no
pay button. Searched for Stripe, Paystack, Flutterwave, Paddle, Lemon
Squeezy, checkout, billing and subscription — the only hits are a
comment about Speechify's list price and a description of Twitch's
creator payouts. Nobody can pay for anything in this app, so there is
nothing to put renewal terms next to.

**Changed:** nothing.

**Still open:** if a paid plan is ever added, the price, billing period
and renewal terms must sit next to the pay button before it goes live.

## 6. No $6 DMCA copyright agent — LAUNCH-DAY DECISION, NO CODE CHANGE

**Found:** nothing in the code — this is not a code problem. Under US
law, a site that lets users upload photos (Ace Studio lets users upload
profile pictures, and posting uses user-supplied videos) should register
a DMCA agent with the US Copyright Office (about $6) so it has a
named person to receive takedown notices for copyrighted material a
user uploads. Without it, the site can lose its "safe harbour" and be
treated as if it posted the material itself.

**Changed:** nothing — there is no code to write for this.

**Still open (launch-day decision for Kenneth):** register a DMCA agent
at copyright.gov (US-only, about $6) before the app opens to the
public, and put the agent's contact in the app (footer or a copyright
page) plus a simple takedown process. Until then, user uploads are a
known risk, not a covered one.
