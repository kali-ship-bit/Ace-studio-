# Ace Studio — posting credentials (Phase F)

What Kenneth must create, platform by platform, before each one can post
from inside the app. **Nothing on this page is a real credential** — the
values below are placeholder names only. Real values go in the
gitignored `.dev.vars` file for local development, or in the hosting
dashboard's secrets for production. They are never pasted in chat, never
put in code, and never committed.

How a value gets into the app:

1. Copy `.env.example` to `.dev.vars` in the project root (local dev
   only — that file is gitignored).
2. Put the value after `NAME=` — e.g. `IG_ACCESS_TOKEN=...`.
3. Restart the dev server. `GET /api/post/platforms` shows, per platform,
   only `configured: true/false` and the _names_ of missing vars — never
   the values.
4. In production the same names are set as secrets in the hosting
   dashboard (Supabase/Vercel secrets — the Phase F backend is Supabase,
   per the 2026-11-07 direction change).

What is already built in the app, and what is still needed:

- Built: the registry (`src/lib/posting/registry.ts`), the env reader
  (`env.ts`), the Instagram, Facebook, TikTok and YouTube routes
  (`instagram.ts`, `facebook.ts`, `tiktok.ts`, `youtube.ts`), the
  checklist descriptions for the other six platforms (`others.ts`), and
  the API routes (`api.ts`: `GET /api/post/platforms`,
  `POST /api/post/:platform`, `GET /api/post/jobs/:id`).
- Still needed: the credentials below, one platform at a time. Until a
  platform's vars are set, every post attempt fails with a clear
  "not connected yet" message naming the missing vars — nothing is
  posted, nothing is faked.
- Not built yet: any posting UI page, and the wiring in `src/server.ts`
  (another step wires `handlePostingApi` in). No platform is live from
  the app today — Instagram posting still happens through the Instagram
  connector, as before.

---

## Instagram — ready when configured

Needs: `IG_USER_ID`, `IG_ACCESS_TOKEN`.

1. The Instagram account must be a **Business or Creator** account
   (@kahli.stories already is a professional/creator account) and
   connected to a Facebook Page.
2. Meta for Developers → Create App → choose the app type for posting
   (the "Other" / business type). Note the **App ID** and **App Secret**
   — these are `META_APP_ID` and `META_APP_SECRET` (kept for the OAuth
   setup; the posting route itself uses the two vars below).
3. In the app, add the **Instagram Graph API** product and the
   **Facebook Login** product. Add the permission
   `instagram_basic` + `instagram_content_publish` (+ `pages_read_engagement`
   for the Page link).
4. Log in with the Facebook account that owns the Page, grant the
   permissions, and get a **long-lived Page/User access token** for the
   connected Instagram account. That token is `IG_ACCESS_TOKEN`.
   (A short-lived token expires in hours — use the long-lived exchange
   documented under Meta for Developers → "Access Tokens".)
5. Find the Instagram account's numeric id: it is the `id` returned by
   the Graph API call for the Page's connected Instagram business
   account. That number is `IG_USER_ID`.
6. Set both vars in `.dev.vars` / hosting secrets. Test with one Reel
   from a public video URL — Meta's servers fetch the video themselves,
   so the video must be at a **publicly reachable https URL** (for
   example a Supabase Storage signed URL for the finished job output),
   not localhost.

Official docs: Meta for Developers → "Instagram Graph API" reference
and "Create App" — search those exact page names on
developers.facebook.com.

## Facebook — ready when configured

Needs: `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`.

1. A Facebook Page (KHa Li's Page, or the Page linked to @kahli.stories)
   that the Meta app above can manage.
2. In the same Meta app as Instagram, add the permission
   `pages_manage_posts` (and `pages_read_engagement`).
3. Log in with a Page admin account, grant the permissions, and get a
   **long-lived Page access token** for that Page. That is
   `FACEBOOK_PAGE_ACCESS_TOKEN`.
4. The Page's numeric id (shown in the Page's settings / "About") is
   `FACEBOOK_PAGE_ID`.
5. Set both vars. Same public-URL rule as Instagram: Meta fetches the
   video from the URL the app sends.

Official docs: Meta for Developers → "Facebook Graph API" reference,
"Pages API" — search those page names on developers.facebook.com.

## TikTok — ready when configured (verify live before first real post)

Needs: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_ACCESS_TOKEN`.

1. TikTok for Developers → create a developer account and **create an
   app** (TikTok for Developers → "Manage apps" → "Create an app").
   The app gives a **Client key** (`TIKTOK_CLIENT_KEY`) and a **Client
   secret** (`TIKTOK_CLIENT_SECRET`).
2. In the app's settings, add **Login Kit** and request the scope
   `video.upload` (Content Posting API). TikTok must **approve** the app
   and the scope — posting does not work until approval comes through.
3. Set the app's **redirect URI** to the app's login/callback URL and
   complete the Login Kit OAuth flow once as the posting account, to get
   an **access token** (`TIKTOK_ACCESS_TOKEN`) with the `video.upload`
   scope. Access tokens expire — the app will need a refresh flow (not
   built yet) or a fresh token when it lapses.
4. Set all three vars. **Before the first real post**, confirm the init
   body, the upload Content-Range handling and the publish-status values
   against the current TikTok developer docs and run one test upload
   from a throwaway clip — the live flow has not been verified in this
   build (see the note at the top of `tiktok.ts`).

Official docs: TikTok for Developers → "Content Posting API" and
"Login Kit" — search those page names on developers.tiktok.com.

## YouTube — ready when configured

Needs: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.

1. Google Cloud Console → create a project → enable the **YouTube Data
   API v3**.
2. APIs & Services → Credentials → **Create Credentials → OAuth client
   ID** → application type **Web application**. Note the **Client ID**
   (`YOUTUBE_CLIENT_ID`) and **Client secret**
   (`YOUTUBE_CLIENT_SECRET`).
3. In the OAuth consent screen, add the scope
   `https://www.googleapis.com/auth/youtube.upload` and add the
   channel's Google account as a test user (until the app is verified).
4. Set the OAuth client's **authorised redirect URI** to the app's
   callback URL, then run the OAuth flow once as the channel owner,
   requesting **offline access** (`access_type=offline`). The flow
   returns a **refresh token** — that is `YOUTUBE_REFRESH_TOKEN`. The
   app uses it to mint short-lived access tokens itself; the refresh
   token never leaves the server.
5. Set all three vars. Uploads go to the channel of the account that
   granted the refresh token, as public videos.

Official docs: Google Cloud Console → "YouTube Data API v3" quickstart
and "OAuth 2.0 for Web Server Applications" — search those page names
on developers.google.com/youtube and developers.google.com/identity.

## X (Twitter) — checklist only, not built

Needs (when built): `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
`X_ACCESS_TOKEN_SECRET`.

1. X Developer Portal → developer account → create a project/app to get
   an API key and secret.
2. OAuth 1.0a (or OAuth 2.0 user context) tokens for the posting account.
3. The app still needs a **chunked media upload** implementation
   (INIT → APPEND → FINALIZE → STATUS) before a video post can be made.
   No X route exists in the app yet.

Official docs: X Developer Platform → "Post media" / "Upload media"
(chunked upload) — search those page names on developer.x.com.

## Snapchat — checklist only, not built

Needs (when built): `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET`,
`SNAPCHAT_ACCESS_TOKEN`.

1. A Snapchat **Business/Creator** account set up for Spotlight.
2. Confirmation from Snapchat's developer docs of a server-side posting
   route for that account type — none is implemented in the app, because
   there is no simple server-side video-post endpoint the way Reels
   works.

Official docs: Snapchat developer docs → "Spotlight" and "Snap Kit" —
search those page names on developers.snapchat.com.

## Twitch — checklist only, no upload route exists

Needs (if streaming instead): `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`,
`TWITCH_ACCESS_TOKEN`.

Twitch is live-streaming: there is no direct uploaded-video API the way
Reels works. Recorded content arrives as VODs from streams. To use
Twitch at all, Kenneth needs a Twitch channel and a streaming setup;
pre-recorded story videos cannot be "posted" to Twitch the way they can
to Instagram or YouTube.

Official docs: Twitch Developers → "Twitch API" reference — search that
page name on dev.twitch.tv.

## Kick — checklist only, no public upload API

Needs: nothing to configure — **Kick has no public upload API** for
posting pre-recorded videos, so no route can be built until Kick
publishes one. All Kenneth can do today is create a Kick creator
account and wait for Kick to offer an upload API.

Official docs: Kick's creator/developer pages — no upload API is
documented there today.

## Rumble — checklist only, not built

Needs (when built): `RUMBLE_API_KEY`.

1. A Rumble creator account.
2. A **verified Rumble API/partner arrangement**, confirmed in writing
   with Rumble, before any route is built — the endpoint shape and
   approval path are unverified.

Official docs: Rumble's creator/API pages — confirm the arrangement
with Rumble directly; do not build on an undocumented endpoint.

## Dailymotion — checklist only, not built

Needs (when built): `DAILYMOTION_API_KEY`, `DAILYMOTION_API_SECRET`.

1. A Dailymotion creator account.
2. An **approved Dailymotion API key/partner setup**, confirmed in
   writing with Dailymotion, before any route is built — the endpoint
   shape and approval path are unverified.

Official docs: Dailymotion Developers → "API" — search that page name
on developers.dailymotion.com.
