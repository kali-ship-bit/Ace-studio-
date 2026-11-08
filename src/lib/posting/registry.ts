/**
 * Posting platform registry (Phase F). Server-side only.
 *
 * One entry per platform Kenneth may post a finished video to. Nothing
 * here is a credential and nothing here calls a platform: this is the
 * honest catalogue the Settings/UI and GET /api/post/platforms read from.
 *
 * Status meanings:
 * - "ready-when-configured": the app has a real implementation for this
 *   platform (see src/lib/posting/<platform>.ts). It works as soon as the
 *   listed env vars are set; until then every attempt fails with a clear
 *   "not connected yet" message naming the missing vars.
 * - "checklist-only": no direct upload/post API the app can call for this
 *   platform (or the route is not verified yet). The app can only tell
 *   Kenneth what he must create first — see src/lib/posting/others.ts
 *   and CREDENTIALS.md. A post attempt for one of these always fails
 *   with the checklist summary, never with a fake success.
 *
 * Monetisation notes are deliberately generic: payout depends on each
 * platform's own partner/rewards program, region and eligibility, and
 * Nigeria eligibility varies by program. No payout rate is stated here
 * because none was verified for this project.
 */

export type PlatformId =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "x"
  | "snapchat"
  | "twitch"
  | "kick"
  | "rumble"
  | "dailymotion";

export type PlatformStatus = "ready-when-configured" | "checklist-only";

export interface PlatformEntry {
  id: PlatformId;
  label: string;
  description: string;
  /** Honest, generic monetisation note — never a specific payout rate. */
  monetisation: string;
  status: PlatformStatus;
  /** Exact env var names the route needs. Empty when there is no API to configure. */
  requiredEnv: string[];
}

const MONETISATION_GENERIC =
  "Pays creators through its partner/rewards program where eligible; payout depends on the platform's program, region and eligibility — Nigeria eligibility varies.";

export const PLATFORMS: readonly PlatformEntry[] = [
  {
    id: "instagram",
    label: "Instagram",
    description:
      "Post the video as a Reel to the connected Instagram Business/Creator account (@kahli.stories today) via the Instagram Graph API.",
    monetisation:
      "Pays creators through its bonuses/rewards programs where eligible; payout depends on the platform's program, region and eligibility — Nigeria eligibility varies.",
    status: "ready-when-configured",
    requiredEnv: ["IG_USER_ID", "IG_ACCESS_TOKEN"],
  },
  {
    id: "facebook",
    label: "Facebook",
    description:
      "Publish the video to the connected Facebook Page via the Graph API video upload endpoint.",
    monetisation: MONETISATION_GENERIC,
    status: "ready-when-configured",
    requiredEnv: ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN"],
  },
  {
    id: "tiktok",
    label: "TikTok",
    description:
      "Upload the video through the TikTok Content Posting API (initialise, upload the bytes, check publish status). Needs a TikTok developer app with Login Kit and the video.upload scope approved.",
    monetisation:
      "Pays creators through its Creator Rewards / creator fund programs where eligible; payout depends on the platform's program, region and eligibility — Nigeria eligibility varies.",
    status: "ready-when-configured",
    requiredEnv: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_ACCESS_TOKEN"],
  },
  {
    id: "youtube",
    label: "YouTube",
    description:
      "Upload the video to the connected YouTube channel with the YouTube Data API v3 resumable upload, using a stored OAuth refresh token.",
    monetisation:
      "Pays creators through the YouTube Partner Program (ads, Shorts revenue sharing) where eligible; payout depends on the platform's program, region and eligibility — Nigeria eligibility varies.",
    status: "ready-when-configured",
    requiredEnv: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"],
  },
  {
    id: "x",
    label: "X (Twitter)",
    description:
      "X needs OAuth 1.0a or OAuth 2.0 plus a chunked media upload before a post with video can be made. No X route is implemented yet — checklist only.",
    monetisation: MONETISATION_GENERIC,
    status: "checklist-only",
    requiredEnv: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"],
  },
  {
    id: "snapchat",
    label: "Snapchat",
    description:
      "Video goes out as a Spotlight submission from a Business/Creator setup. There is no simple server-side video-post endpoint the way Reels works — checklist only.",
    monetisation:
      "Pays creators through its Spotlight rewards / creator programs where eligible; payout depends on the platform's program, region and eligibility — Nigeria eligibility varies.",
    status: "checklist-only",
    requiredEnv: ["SNAPCHAT_CLIENT_ID", "SNAPCHAT_CLIENT_SECRET", "SNAPCHAT_ACCESS_TOKEN"],
  },
  {
    id: "twitch",
    label: "Twitch",
    description:
      "Twitch is live-streaming: there is no direct uploaded-video API the way Reels works. Recorded content arrives as VODs from streams. Checklist only.",
    monetisation:
      "Pays creators through subscriptions, Bits and ads on streams where eligible; payout depends on the platform's program, region and eligibility — Nigeria eligibility varies.",
    status: "checklist-only",
    requiredEnv: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_ACCESS_TOKEN"],
  },
  {
    id: "kick",
    label: "Kick",
    description:
      "Kick has no public upload API for posting pre-recorded videos. Checklist only — a Kick route cannot be built until Kick publishes one.",
    monetisation: MONETISATION_GENERIC,
    status: "checklist-only",
    requiredEnv: [],
  },
  {
    id: "rumble",
    label: "Rumble",
    description:
      "Rumble video upload needs a partner/API arrangement verified with Rumble first. No Rumble route is implemented yet — checklist only.",
    monetisation: MONETISATION_GENERIC,
    status: "checklist-only",
    requiredEnv: ["RUMBLE_API_KEY"],
  },
  {
    id: "dailymotion",
    label: "Dailymotion",
    description:
      "Dailymotion video upload needs an approved API key/partner setup verified with Dailymotion first. No Dailymotion route is implemented yet — checklist only.",
    monetisation: MONETISATION_GENERIC,
    status: "checklist-only",
    requiredEnv: ["DAILYMOTION_API_KEY", "DAILYMOTION_API_SECRET"],
  },
];

export function getPlatform(id: string): PlatformEntry | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

export function isPlatformId(id: string): id is PlatformId {
  return PLATFORMS.some((p) => p.id === id);
}
