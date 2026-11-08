# Missing binaries — ReelKali Studio local pull (2026-11-07)

The Lovable connector is text-only, so binary files could not be pulled.
None of these could be copied from the 2026-10-30 backup either — that
backup contains **no binary files at all** (its `public/` holds only
`robots.txt`; it has no `src/assets/` directory).

## Missing entirely (13 files listed as binary in the Lovable tree)

| Path                            | Used by                                                 |
| ------------------------------- | ------------------------------------------------------- |
| `public/favicon.ico`            | `src/routes/__root.tsx` (`rel: "icon"`, `/favicon.ico`) |
| `src/assets/cover-comedy.jpg`   | `src/lib/feed-data.ts` (Home feed covers)               |
| `src/assets/cover-exam.jpg`     | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-food.jpg`     | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-grandma.jpg`  | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-market.jpg`   | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-music.jpg`    | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-nightbus.jpg` | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-phone.jpg`    | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-science.jpg`  | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-sports.jpg`   | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-tech.jpg`     | `src/lib/feed-data.ts`                                  |
| `src/assets/cover-traffic.jpg`  | `src/lib/feed-data.ts`                                  |

These 12 covers are the sample/demo feed images. Until they are replaced
(regenerated or placeholder images put in their place), the Home feed and
any screen importing `src/lib/feed-data.ts` will fail to build/run locally.

## Sample narration audio (3 files — not present as files in the Lovable tree)

The Lovable agent bundled three sample narration MP3s on 2026-11-07, but
they do **not appear as files** in the Lovable file tree at all. Only
their JSON manifests were pulled:

- `src/assets/audio/ep1_narration.mp3.asset.json` — 73,197 bytes, created 2026-11-07T14:57:28Z
- `src/assets/audio/ep2_narration.mp3.asset.json` — 81,453 bytes, created 2026-11-07T14:57:31Z
- `src/assets/audio/feed_narration.mp3.asset.json` — 55,533 bytes, created 2026-11-07T14:57:35Z

Each manifest records a Lovable-hosted URL (`/__l5e/assets-v1/<asset_id>/<name>.mp3`)
and an R2 key. `src/lib/demo-audio.ts` imports these `.asset.json` manifests
and uses their URLs. The MP3 bytes themselves were **not** pulled and were
**not** invented — the local build will need the real MP3s downloaded from
Lovable's asset hosting, or new narration audio generated, before the
Play/Mute sound feature works offline.

## Copied from the 2026-10-30 backup

None. The old backup had no matching binary files to copy.
