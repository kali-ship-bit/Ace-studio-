// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Nitro preset: node-server by default, NOT Cloudflare. The backend moved to
  // Supabase (see REELKALI_BACKEND_REPORT.md) and the app must run on
  // any plain Node host — the config's cloudflare-module default would
  // build a Worker bundle this app can no longer use (node:fs job store,
  // node:crypto session ids). Set NITRO_PRESET=vercel to build the Vercel
  // output instead (the env var wins over the default below); any other
  // value, or no value, keeps node-server.
  nitro: {
    preset: (process.env["NITRO_PRESET"] as "vercel" | "node-server" | undefined) ?? "node-server",
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
