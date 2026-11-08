import { describe, expect, it } from "vitest";
import { assertUploadUrl, fetchPublicVideoBytes, isPublicIp, timedFetch } from "./download";

const PUBLIC_IP = ["93.184.216.34"];
const resolvePublic = async () => PUBLIC_IP;

function videoResponse(bytes: Uint8Array, contentType = "video/mp4"): Response {
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("isPublicIp", () => {
  it("accepts public addresses", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"]) {
      expect(isPublicIp(ip)).toBe(true);
    }
  });

  it("rejects private, loopback, link-local, CGNAT and documentation ranges", () => {
    for (const ip of [
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "127.0.0.1",
      "169.254.169.254",
      "0.0.0.0",
      "100.64.0.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd00::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicIp(ip)).toBe(false);
    }
  });
});

describe("fetchPublicVideoBytes — SSRF defence", () => {
  const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

  it("downloads bytes from a public https URL", async () => {
    const fetchImpl = (async () => videoResponse(BYTES)) as typeof fetch;
    const out = await fetchPublicVideoBytes("https://example.com/video.mp4", {
      fetchImpl,
      resolveHost: resolvePublic,
    });
    expect(out).toEqual(BYTES);
  });

  it("rejects http URLs without touching the network", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return videoResponse(BYTES);
    }) as typeof fetch;
    await expect(
      fetchPublicVideoBytes("http://example.com/video.mp4", {
        fetchImpl,
        resolveHost: resolvePublic,
      }),
    ).rejects.toThrow("https");
    expect(called).toBe(false);
  });

  it("rejects hosts that resolve to a private IP", async () => {
    const fetchImpl = (async () => videoResponse(BYTES)) as typeof fetch;
    await expect(
      fetchPublicVideoBytes("https://internal.example/video.mp4", {
        fetchImpl,
        resolveHost: async () => ["169.254.169.254"],
      }),
    ).rejects.toThrow("private or internal");
  });

  it("rejects a redirect to a private host", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://example.com/video.mp4") {
        return new Response("", {
          status: 302,
          headers: { location: "https://169.254.169.254/x" },
        });
      }
      return videoResponse(BYTES);
    }) as typeof fetch;
    await expect(
      fetchPublicVideoBytes("https://example.com/video.mp4", {
        fetchImpl,
        resolveHost: async (host) => (host === "169.254.169.254" ? ["169.254.169.254"] : PUBLIC_IP),
      }),
    ).rejects.toThrow("private or internal");
  });

  it("follows a redirect to another public https host", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://example.com/video.mp4") {
        return new Response("", {
          status: 302,
          headers: { location: "https://cdn.example.com/video.mp4" },
        });
      }
      return videoResponse(BYTES);
    }) as typeof fetch;
    const out = await fetchPublicVideoBytes("https://example.com/video.mp4", {
      fetchImpl,
      resolveHost: resolvePublic,
    });
    expect(out).toEqual(BYTES);
  });

  it("rejects a body larger than the cap", async () => {
    const big = new Uint8Array(100).fill(7);
    const fetchImpl = (async () => videoResponse(big)) as typeof fetch;
    await expect(
      fetchPublicVideoBytes("https://example.com/video.mp4", {
        fetchImpl,
        resolveHost: resolvePublic,
        maxBytes: 50,
      }),
    ).rejects.toThrow("larger than");
  });

  it("rejects a non-video content type", async () => {
    const fetchImpl = (async () => videoResponse(BYTES, "text/html")) as typeof fetch;
    await expect(
      fetchPublicVideoBytes("https://example.com/video.mp4", {
        fetchImpl,
        resolveHost: resolvePublic,
      }),
    ).rejects.toThrow("not a video file");
  });

  it("rejects an empty video", async () => {
    const fetchImpl = (async () => videoResponse(new Uint8Array(0))) as typeof fetch;
    await expect(
      fetchPublicVideoBytes("https://example.com/video.mp4", {
        fetchImpl,
        resolveHost: resolvePublic,
      }),
    ).rejects.toThrow("empty");
  });
});

describe("assertUploadUrl", () => {
  it("accepts the platform's own upload hosts", () => {
    expect(() =>
      assertUploadUrl("https://open-upload.tiktokapis.com/upload/x", ["tiktokapis.com"], "TikTok"),
    ).not.toThrow();
    expect(() =>
      assertUploadUrl(
        "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1",
        ["googleapis.com"],
        "YouTube",
      ),
    ).not.toThrow();
  });

  it("rejects any other host, and non-https URLs", () => {
    expect(() =>
      assertUploadUrl("https://evil.example.com/upload", ["tiktokapis.com"], "TikTok"),
    ).toThrow("unexpected upload host");
    expect(() =>
      assertUploadUrl("http://open-upload.tiktokapis.com/upload/x", ["tiktokapis.com"], "TikTok"),
    ).toThrow("https");
  });
});

describe("timedFetch", () => {
  it("times out a fetch that never resolves", async () => {
    const hanging = (async (_input: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    }) as typeof fetch;
    await expect(timedFetch(hanging, "https://example.com/", {}, 50)).rejects.toThrow();
  });
});
