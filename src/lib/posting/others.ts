/**
 * Checklist-only platforms (Phase F). Server-side only.
 *
 * These platforms have NO working post route in the app yet — either there
 * is no public upload API for pre-recorded videos, or the API route is
 * not verified. Nothing here calls a platform API: each entry only
 * describes, honestly, what Kenneth must create first and what is still
 * missing. A post attempt for one of these always fails with the
 * checklist summary, never with a fake success.
 */

import type { PlatformId } from "./registry";

export interface PlatformChecklist {
  id: PlatformId;
  label: string;
  /** Plain-words state of play for this platform. */
  state: string;
  /** What Kenneth must create/set up before a route can exist. */
  needed: string[];
  /** Short public error used when a post is attempted. */
  notReadyMessage: string;
}

export const CHECKLIST_PLATFORMS: readonly PlatformChecklist[] = [
  {
    id: "x",
    label: "X (Twitter)",
    state:
      "Not built yet. X needs OAuth 1.0a or OAuth 2.0 (user context) plus a chunked media upload (INIT, APPEND, FINALIZE, then STATUS) before a post with video can be made.",
    needed: [
      "An X developer account and a developer app (X Developer Portal) with the v2 API and media upload access.",
      "OAuth 1.0a or OAuth 2.0 user tokens for the posting account.",
      "A chunked media upload implementation in the app — not built yet.",
    ],
    notReadyMessage:
      "X posting is not built yet — it needs an X developer app, OAuth user tokens and a chunked media upload implementation.",
  },
  {
    id: "snapchat",
    label: "Snapchat",
    state:
      "Not built yet. Snapchat video goes out as a Spotlight submission from a Business/Creator setup; there is no simple server-side video-post endpoint the way Reels works.",
    needed: [
      "A Snapchat Business/Creator account set up for Spotlight.",
      "Confirmation from Snapchat's developer docs of a server-side posting route for the account type — none is implemented in the app.",
    ],
    notReadyMessage:
      "Snapchat posting is not built yet — it needs a Business/Creator setup and a confirmed Spotlight posting route.",
  },
  {
    id: "twitch",
    label: "Twitch",
    state:
      "Not built as a video post. Twitch is live-streaming: there is no direct uploaded-video API the way Reels works. Recorded content arrives as VODs from streams, not as uploaded files.",
    needed: [
      "A Twitch channel and streaming setup if Kenneth wants the stories as live streams (VODs are created from streams).",
      "No upload route can be built for pre-recorded videos until Twitch offers one.",
    ],
    notReadyMessage:
      "Twitch has no uploaded-video route — it is live-streaming only, and recorded content arrives as VODs from streams.",
  },
  {
    id: "kick",
    label: "Kick",
    state:
      "Not built. Kick has no public upload API for posting pre-recorded videos, so no route can be built until Kick publishes one.",
    needed: [
      "A Kick creator account.",
      "A public Kick upload API — none exists today, so this stays checklist-only.",
    ],
    notReadyMessage:
      "Kick has no public upload API for pre-recorded videos, so posting to Kick is not possible yet.",
  },
  {
    id: "rumble",
    label: "Rumble",
    state:
      "Not built yet. Rumble video upload needs a partner/API arrangement verified with Rumble first — the endpoint shape and approval path are unverified.",
    needed: [
      "A Rumble creator account.",
      "A verified Rumble API/partner arrangement, confirmed in writing with Rumble, before any route is built.",
    ],
    notReadyMessage:
      "Rumble posting is not built yet — it needs a verified Rumble API/partner arrangement first.",
  },
  {
    id: "dailymotion",
    label: "Dailymotion",
    state:
      "Not built yet. Dailymotion video upload needs an approved API key/partner setup verified with Dailymotion first — the endpoint shape and approval path are unverified.",
    needed: [
      "A Dailymotion creator account.",
      "An approved Dailymotion API key/partner setup, confirmed in writing with Dailymotion, before any route is built.",
    ],
    notReadyMessage:
      "Dailymotion posting is not built yet — it needs an approved Dailymotion API key/partner setup first.",
  },
];

export function describeChecklistPlatform(id: string): PlatformChecklist | undefined {
  return CHECKLIST_PLATFORMS.find((p) => p.id === id);
}

/** The public summary used as the failure reason when a post is attempted. */
export function checklistSummary(id: string): string {
  const entry = describeChecklistPlatform(id);
  if (!entry) return "This platform is not supported yet.";
  return `${entry.notReadyMessage} Needed: ${entry.needed.join(" ")}`;
}
