import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleAvatarApi, type AvatarApiDeps } from "./avatar-api";
import { issueCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../security/csrf";

// jsdom's File/Blob are a different realm from undici's Request: undici's
// multipart parser builds each file part with the global File, then
// rejects it against its own brand check, so request.formData() throws.
// Point the globals at Node's File/Blob so file parts parse in tests.
// (Real browsers are unaffected — they send real multipart bodies.)
globalThis.File = NodeFile as unknown as typeof File;
globalThis.Blob = NodeBlob as unknown as typeof Blob;

const USER_ID = "user-123";
const AVATAR_URL =
  "https://example.supabase.co/storage/v1/object/public/avatars/user-123/avatar.png";

/** A fake Supabase client that records uploads, removals and profile updates. */
function mockClient(profileAvatar: string | null = AVATAR_URL, updateError = false) {
  const uploads: { bucket: string; path: string; file: unknown; opts: unknown }[] = [];
  const removes: { bucket: string; paths: string[] }[] = [];
  const updates: { table: string; values: unknown; id: string }[] = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: unknown, opts: unknown) => {
          uploads.push({ bucket, path, file, opts });
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          removes.push({ bucket, paths });
          return { data: null, error: null };
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}`,
          },
        }),
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { avatar_url: profileAvatar }, error: null }),
        }),
      }),
      update: (values: unknown) => ({
        eq: (_col: string, id: string) => ({
          // The handler asks for the row back so a no-row update is not
          // mistaken for success.
          select: (_cols: string) => ({
            single: async () => {
              updates.push({ table, values, id });
              return {
                data: updateError ? null : { id },
                error: updateError ? new Error("update failed") : null,
              };
            },
          }),
        }),
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, uploads, removes, updates };
}

function csrfHeaders(): { token: string; headers: Record<string, string> } {
  const token = issueCsrfToken();
  return {
    token,
    headers: {
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: token,
    },
  };
}

function depsWith(client: SupabaseClient, userId = USER_ID): AvatarApiDeps {
  return {
    getUser: async () => ({ id: userId, accessToken: "test-access-token" }),
    createUserClient: () => client,
    isSupabaseConfigured: () => true,
  };
}

/**
 * Build a real multipart/form-data body by hand.
 *
 * Why not `new FormData()`? Under vitest's jsdom environment the global
 * FormData is jsdom's, while Request is undici's — handing one to the
 * other makes request.formData() throw. A hand-built body is also what a
 * real browser actually sends, so this tests the true server path.
 */
interface MultipartField {
  name: string;
  value: string | Uint8Array;
  filename?: string;
  type?: string;
}

function multipartBody(fields: MultipartField[]): {
  body: Uint8Array;
  contentType: string;
} {
  const boundary = "----ace-studio-test-boundary";
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const field of fields) {
    let head = `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"`;
    if (field.filename) head += `; filename="${field.filename}"`;
    head += "\r\n";
    if (field.type) head += `Content-Type: ${field.type}\r\n`;
    head += "\r\n";
    parts.push(enc.encode(head));
    parts.push(typeof field.value === "string" ? enc.encode(field.value) : field.value);
    parts.push(enc.encode("\r\n"));
  }
  parts.push(enc.encode(`--${boundary}--\r\n`));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function postAvatar(fields: MultipartField[], headers: Record<string, string>): Request {
  const { body, contentType } = multipartBody(fields);
  return new Request("http://localhost/api/settings/avatar", {
    method: "POST",
    headers: { ...headers, "content-type": contentType },
    body: body as BodyInit,
  });
}

function avatarField(bytes: Uint8Array, filename: string, type: string): MultipartField {
  return { name: "avatar", value: bytes, filename, type };
}

describe("GET /api/settings/avatar", () => {
  it("returns the avatar URL from the user's profile row", async () => {
    const { client } = mockClient();
    const res = await handleAvatarApi(
      new Request("http://localhost/api/settings/avatar", { method: "GET" }),
      depsWith(client),
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ avatarUrl: AVATAR_URL });
  });

  it("returns null when the profile has no picture yet", async () => {
    const { client } = mockClient(null);
    const res = await handleAvatarApi(
      new Request("http://localhost/api/settings/avatar", { method: "GET" }),
      depsWith(client),
    );
    expect(await res?.json()).toEqual({ avatarUrl: null });
  });

  it("returns 503 when Supabase is not configured", async () => {
    const { client } = mockClient();
    const res = await handleAvatarApi(
      new Request("http://localhost/api/settings/avatar", { method: "GET" }),
      { ...depsWith(client), isSupabaseConfigured: () => false },
    );
    expect(res?.status).toBe(503);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "avatar_not_configured" }),
    );
  });

  it("returns 401 when nobody is logged in", async () => {
    const { client } = mockClient();
    const res = await handleAvatarApi(
      new Request("http://localhost/api/settings/avatar", { method: "GET" }),
      { ...depsWith(client), getUser: async () => null },
    );
    expect(res?.status).toBe(401);
  });

  it("returns null for other paths so the server can fall through", async () => {
    const { client } = mockClient();
    const res = await handleAvatarApi(
      new Request("http://localhost/api/settings/avatar/extra", { method: "GET" }),
      depsWith(client),
    );
    expect(res).toBeNull();
  });
});

describe("POST /api/settings/avatar", () => {
  // Real magic bytes: a PNG starts 89 50 4E 47 0D 0A 1A 0A, a WebP starts
  // "RIFF....WEBP". The handler checks them (Phase C) — [1, 2, 3] is not
  // a picture of any kind.
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const WEBP_BYTES = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3,
  ]);

  it("uploads to <userId>/avatar.<ext> and updates the profile row", async () => {
    const { client, uploads, updates } = mockClient();
    const { headers } = csrfHeaders();
    const res = await handleAvatarApi(
      postAvatar([avatarField(PNG_BYTES, "me.png", "image/png")], headers),
      depsWith(client),
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ avatarUrl: AVATAR_URL });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.bucket).toBe("avatars");
    expect(uploads[0]?.path).toBe(`${USER_ID}/avatar.png`);
    expect(uploads[0]?.opts).toEqual({ upsert: true, contentType: "image/png" });
    expect(updates).toEqual([
      { table: "profiles", values: { avatar_url: AVATAR_URL }, id: USER_ID },
    ]);
  });

  it("rejects an oversized file at the body cap and uploads nothing", async () => {
    const { client, uploads } = mockClient();
    const { headers } = csrfHeaders();
    const res = await handleAvatarApi(
      postAvatar([avatarField(new Uint8Array(3 * 1024 * 1024), "big.png", "image/png")], headers),
      depsWith(client),
    );
    // A 3 MB body is over the 2 MB + 64 KB cap, so the streaming cap
    // answers 413 before the file is even parsed or validated.
    expect(res?.status).toBe(413);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "avatar_too_big" }),
    );
    expect(uploads).toHaveLength(0);
  });

  it("rejects a script relabelled as a picture and uploads nothing", async () => {
    const { client, uploads } = mockClient();
    const { headers } = csrfHeaders();
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const res = await handleAvatarApi(
      postAvatar([avatarField(html, "me.png", "image/png")], headers),
      depsWith(client),
    );
    expect(res?.status).toBe(400);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "avatar_invalid" }),
    );
    expect(uploads).toHaveLength(0);
  });

  it("rejects a .exe file and uploads nothing", async () => {
    const { client, uploads } = mockClient();
    const { headers } = csrfHeaders();
    const res = await handleAvatarApi(
      postAvatar(
        [avatarField(new Uint8Array([1, 2, 3]), "run.exe", "application/x-msdownload")],
        headers,
      ),
      depsWith(client),
    );
    expect(res?.status).toBe(400);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "avatar_invalid" }),
    );
    expect(uploads).toHaveLength(0);
  });

  it("rejects the upload when nobody is logged in", async () => {
    const { client, uploads } = mockClient();
    const { headers } = csrfHeaders();
    const res = await handleAvatarApi(
      postAvatar([avatarField(new Uint8Array([1]), "me.png", "image/png")], headers),
      {
        ...depsWith(client),
        getUser: async () => null,
      },
    );
    expect(res?.status).toBe(401);
    expect(uploads).toHaveLength(0);
  });

  it("rejects the upload without a matching CSRF token", async () => {
    const { client, uploads } = mockClient();
    const res = await handleAvatarApi(
      postAvatar([avatarField(new Uint8Array([1]), "me.png", "image/png")], {}),
      depsWith(client),
    );
    expect(res?.status).toBe(403);
    expect(uploads).toHaveLength(0);
  });

  it("accepts the CSRF token from the form field instead of the header", async () => {
    const { client, uploads } = mockClient();
    const { token } = csrfHeaders();
    const res = await handleAvatarApi(
      postAvatar(
        [{ name: "_csrf", value: token }, avatarField(WEBP_BYTES, "me.webp", "image/webp")],
        { cookie: `${CSRF_COOKIE_NAME}=${token}` },
      ),
      depsWith(client),
    );
    expect(res?.status).toBe(200);
    expect(uploads[0]?.path).toBe(`${USER_ID}/avatar.webp`);
  });

  it("returns 400 when no file is attached", async () => {
    const { client } = mockClient();
    const { headers } = csrfHeaders();
    const res = await handleAvatarApi(postAvatar([], headers), depsWith(client));
    expect(res?.status).toBe(400);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "avatar_missing" }),
    );
  });

  it("returns 503 when Supabase is not configured", async () => {
    const { client } = mockClient();
    const { headers } = csrfHeaders();
    const res = await handleAvatarApi(
      postAvatar([avatarField(new Uint8Array([1]), "me.png", "image/png")], headers),
      {
        ...depsWith(client),
        isSupabaseConfigured: () => false,
      },
    );
    expect(res?.status).toBe(503);
  });

  it("removes the uploaded file when the profile update fails", async () => {
    const { client, uploads, removes } = mockClient(AVATAR_URL, true);
    const { headers } = csrfHeaders();
    const res = await handleAvatarApi(
      postAvatar([avatarField(PNG_BYTES, "me.png", "image/png")], headers),
      depsWith(client),
    );
    expect(res?.status).toBe(502);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "profile_update_failed" }),
    );
    // The file went up, then came back down — no orphan left behind.
    expect(uploads).toHaveLength(1);
    expect(removes).toEqual([{ bucket: "avatars", paths: [`${USER_ID}/avatar.png`] }]);
  });

  it("rejects an oversized body from its Content-Length before parsing", async () => {
    const { client, uploads } = mockClient();
    const { headers } = csrfHeaders();
    const res = await handleAvatarApi(
      postAvatar([avatarField(PNG_BYTES, "me.png", "image/png")], {
        ...headers,
        "content-length": String(10 * 1024 * 1024),
      }),
      depsWith(client),
    );
    expect(res?.status).toBe(413);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "avatar_too_big" }),
    );
    expect(uploads).toHaveLength(0);
  });

  it("rejects an oversized chunked upload at the streaming cap, with no Content-Length", async () => {
    const { client, uploads } = mockClient();
    const { headers } = csrfHeaders();
    // A 3 MB file delivered as a stream, the way a chunked upload
    // arrives: no Content-Length, so the header pre-check cannot see
    // the size. The streaming cap must stop it at 413 before the
    // whole body is buffered.
    const { body, contentType } = multipartBody([
      avatarField(new Uint8Array(3 * 1024 * 1024), "big.png", "image/png"),
    ]);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const CHUNK = 64 * 1024;
        for (let i = 0; i < body.length; i += CHUNK) {
          controller.enqueue(body.subarray(i, Math.min(i + CHUNK, body.length)));
        }
        controller.close();
      },
    });
    const res = await handleAvatarApi(
      new Request("http://localhost/api/settings/avatar", {
        method: "POST",
        headers: { ...headers, "content-type": contentType },
        body: stream as unknown as BodyInit,
        duplex: "half",
      } as RequestInit),
      depsWith(client),
    );
    expect(res?.status).toBe(413);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "avatar_too_big" }),
    );
    expect(uploads).toHaveLength(0);
  });
});
