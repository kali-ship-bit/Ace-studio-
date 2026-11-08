import { describe, expect, it } from "vitest";
import { FEED, filterFeed } from "./feed-data";

describe("feed filters", () => {
  it("For You shows all videos (at least 15)", () => {
    expect(filterFeed(FEED, "foryou", null).length).toBe(FEED.length);
    expect(FEED.length).toBeGreaterThanOrEqual(15);
  });
  it("My Videos shows only Kenneth's videos", () => {
    const mine = filterFeed(FEED, "mine", null);
    expect(mine.map((v) => v.id)).toEqual(["v1", "v8"]);
  });
  it("Following shows only sample creators", () => {
    expect(filterFeed(FEED, "following", null).some((v) => v.creator.isOwner)).toBe(false);
  });
  it("Following with a followed set shows only followed creators", () => {
    expect(
      filterFeed(FEED, "following", null, new Set(["Ada's Stories"])).map((v) => v.id),
    ).toEqual(["v2"]);
    expect(
      filterFeed(FEED, "following", null, new Set(["Ada's Stories", "Lagos Tales"])).map(
        (v) => v.id,
      ),
    ).toEqual(["v2", "v3"]);
    expect(filterFeed(FEED, "following", null, new Set())).toEqual([]);
  });
  it("Following with a followed set still honours the category filter", () => {
    expect(
      filterFeed(FEED, "following", "Comedy", new Set(["Laugh Lagos"])).map((v) => v.id),
    ).toEqual(["v9"]);
    expect(
      filterFeed(FEED, "following", "Food", new Set(["Laugh Lagos"])).map((v) => v.id),
    ).toEqual([]);
  });
  it("Category filter narrows to that category", () => {
    expect(filterFeed(FEED, "foryou", "Food").map((v) => v.id)).toEqual(["v13"]);
  });
});
