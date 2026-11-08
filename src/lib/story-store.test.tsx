import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { StoryProvider, useStories } from "./story-store";
import type { Episode } from "./story-rules";

describe("saveEpisode reports whether persistence really succeeded", () => {
  it("returns true when localStorage accepts the save", async () => {
    localStorage.clear();
    let save: ((ep: Episode) => boolean) | null = null;
    let first: Episode | undefined;
    function Probe() {
      const store = useStories();
      save = store.saveEpisode;
      first = store.episodes[0];
      return null;
    }
    render(
      <StoryProvider>
        <Probe />
      </StoryProvider>,
    );
    expect(first).toBeDefined();
    if (!first || !save) throw new Error("probe did not mount");
    const episode = { ...first, title: "Saved title" };
    let ok = false;
    await act(async () => {
      ok = save!(episode);
    });
    expect(ok).toBe(true);
    const stored = JSON.parse(localStorage.getItem("ace-studio.stories.v1") ?? "{}") as {
      episodes: { title: string }[];
    };
    expect(stored.episodes.some((e) => e.title === "Saved title")).toBe(true);
  });

  it("returns false when localStorage throws, instead of claiming success", async () => {
    localStorage.clear();
    const failing = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    try {
      let save: ((ep: Episode) => boolean) | null = null;
      let first: Episode | undefined;
      function Probe() {
        const store = useStories();
        save = store.saveEpisode;
        first = store.episodes[0];
        return null;
      }
      render(
        <StoryProvider>
          <Probe />
        </StoryProvider>,
      );
      // Wait a tick so the provider finishes loading before saving.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      if (!first || !save) throw new Error("probe did not mount");
      const episode = { ...first, title: "Never persisted" };
      let ok = true;
      await act(async () => {
        ok = save!(episode);
      });
      expect(ok).toBe(false);
    } finally {
      failing.mockRestore();
    }
  });
});
