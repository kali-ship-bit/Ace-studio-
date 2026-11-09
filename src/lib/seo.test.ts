import { describe, expect, it } from "vitest";
import { getRouter } from "../router";
import {
  buildSitemapXml,
  canonicalUrl,
  KNOWN_PATHS,
  PRIVATE_PATHS,
  resolveSiteBase,
  siteBaseUrl,
} from "./seo";

describe("resolveSiteBase", () => {
  it("accepts an https URL and returns its origin", () => {
    expect(resolveSiteBase("https://ace-studio.example.com/some/path")).toBe(
      "https://ace-studio.example.com",
    );
  });

  it("accepts plain http only for a local host", () => {
    expect(resolveSiteBase("http://localhost:3101")).toBe("http://localhost:3101");
    expect(resolveSiteBase("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(resolveSiteBase("http://evil.example.com")).toBeUndefined();
  });

  it("rejects garbage and empty values", () => {
    expect(resolveSiteBase("not-a-url")).toBeUndefined();
    expect(resolveSiteBase("")).toBeUndefined();
    expect(resolveSiteBase(undefined)).toBeUndefined();
  });
});

describe("canonicalUrl", () => {
  it("builds an absolute URL for a known page", () => {
    expect(canonicalUrl("/stories", "https://ace-studio.example.com")).toBe(
      "https://ace-studio.example.com/stories",
    );
  });

  it("keeps the trailing slash on the home page", () => {
    expect(canonicalUrl("/", "https://ace-studio.example.com")).toBe(
      "https://ace-studio.example.com/",
    );
  });

  it("strips a trailing slash from other pages", () => {
    expect(canonicalUrl("/stories/", "https://ace-studio.example.com")).toBe(
      "https://ace-studio.example.com/stories",
    );
  });

  it("returns undefined for an unknown path", () => {
    expect(canonicalUrl("/no-such-page", "https://ace-studio.example.com")).toBeUndefined();
  });

  it("returns undefined without a base — never invents a domain", () => {
    expect(canonicalUrl("/stories", undefined)).toBeUndefined();
  });
});

describe("siteBaseUrl", () => {
  it("uses the browser origin where a window exists", () => {
    expect(siteBaseUrl()).toBe(window.location.origin);
  });
});

describe("buildSitemapXml", () => {
  it("lists every known page under the base", () => {
    const xml = buildSitemapXml("https://ace-studio.example.com");
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<urlset");
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    for (const path of KNOWN_PATHS) {
      expect(xml).toContain(`<loc>https://ace-studio.example.com${path}</loc>`);
    }
    expect(xml).toContain("<loc>https://ace-studio.example.com/</loc>");
  });

  it("never points at a path that is not a real page", () => {
    const xml = buildSitemapXml("https://ace-studio.example.com");
    expect(xml).not.toContain("/no-such-page");
  });
});

describe("known paths match the route table", () => {
  it("every known or private path is a registered route and every route is known or private", () => {
    const router = getRouter();
    const paths = Object.keys(router.routesByPath).filter((p) => p !== "__root__");
    const listed = [...KNOWN_PATHS, ...PRIVATE_PATHS];
    for (const path of listed) {
      expect(paths).toContain(path);
    }
    for (const path of paths) {
      expect(listed).toContain(path);
    }
  });

  it("private pages never appear in the sitemap or get a canonical URL", () => {
    const xml = buildSitemapXml("https://ace-studio.example.com");
    for (const path of PRIVATE_PATHS) {
      expect(xml).not.toContain(`<loc>https://ace-studio.example.com${path}</loc>`);
    }
    expect(canonicalUrl("/profile", "https://ace-studio.example.com")).toBeUndefined();
  });
});
