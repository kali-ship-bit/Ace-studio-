import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleProfileApi, normalizeProfileInput, type ProfileApiDeps } from "./profile-api";
import { issueCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../security/csrf";

const USER_ID = "user-123";
const EMAIL = "kenneth@example.com";
const AVATAR_URL =
  "https://example.supabase.co/storage/v1/object/public/avatars/user-123/avatar.png";

type Row = {
  display_name: string | null;
  username: string | null;
  bio: string | null;
  country: string | null;
  avatar_url: string | null;
};

const ROW: Row = {
  display_name: "Kenneth",
  username: "kenneth",
  bio: "Lagos stories.",
  country: "Nigeria",
  avatar_url: AVATAR_URL,
};

/** A fake Supabase client that records reads and profile updates. */
function mockClient(opts: { row?: Row | null; taken?: boolean; updateError?: unknown } = {}) {
  const { row = ROW, taken = false, updateError = null } = opts;
  const updates: { table: string; values: unknown; id: string }[] = [];
  const client = {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            // The username-taken check selects only "id".
            if (cols === "id") {
              return { data: taken ? { id: "other-user" } : null, error: null };
            }
            return { data: row, error: null };
          },
          neq: (_col2: string, _val2: unknown) => ({
            maybeSingle: async () => ({
              data: taken ? { id: "other-user" } : null,
              error: null,
            }),
          }),
        }),
      }),
      update: (values: unknown) => ({
        eq: (_col: string, id: string) => ({
          // The handler asks for the row back so a no-row update is not
          // mistaken for success.
          select: (_cols: string) => ({
            single: async () => {
              updates.push({ table, values, id });
              if (updateError) return { data: null, error: updateError };
              return { data: { ...(row ?? {}), ...(values as Row) }, error: null };
            },
          }),
        }),
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, updates };
}

function csrfHeaders(): { headers: Record<string, string> } {
  const token = issueCsrfToken();
  return {
    headers: {
      cookie: `${CSRF_COOKIE_NAME}=${token}`,
      [CSRF_HEADER_NAME]: token,
    },
  };
}

function depsWith(client: SupabaseClient, userId: string | null = USER_ID): ProfileApiDeps {
  return {
    getUser: async () =>
      userId ? { id: userId, email: EMAIL, accessToken: "test-access-token" } : null,
    createUserClient: () => client,
    isSupabaseConfigured: () => true,
  };
}

function patchRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = csrfHeaders().headers,
): Request {
  return new Request("http://localhost/api/settings/profile", {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/settings/profile", () => {
  it("returns the profile fields from the user's own row", async () => {
    const { client } = mockClient();
    const res = await handleProfileApi(
      new Request("http://localhost/api/settings/profile", { method: "GET" }),
      depsWith(client),
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({
      email: EMAIL,
      displayName: "Kenneth",
      username: "kenneth",
      bio: "Lagos stories.",
      country: "Nigeria",
      avatarUrl: AVATAR_URL,
    });
  });

  it("returns nulls when the profile row has nothing set yet", async () => {
    const { client } = mockClient({
      row: {
        display_name: null,
        username: null,
        bio: null,
        country: null,
        avatar_url: null,
      },
    });
    const res = await handleProfileApi(
      new Request("http://localhost/api/settings/profile", { method: "GET" }),
      depsWith(client),
    );
    expect(await res?.json()).toEqual({
      email: EMAIL,
      displayName: null,
      username: null,
      bio: null,
      country: null,
      avatarUrl: null,
    });
  });

  it("returns 503 when Supabase is not configured", async () => {
    const { client } = mockClient();
    const res = await handleProfileApi(
      new Request("http://localhost/api/settings/profile", { method: "GET" }),
      { ...depsWith(client), isSupabaseConfigured: () => false },
    );
    expect(res?.status).toBe(503);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "profile_not_configured" }),
    );
  });

  it("returns 401 when nobody is logged in", async () => {
    const { client } = mockClient();
    const res = await handleProfileApi(
      new Request("http://localhost/api/settings/profile", { method: "GET" }),
      depsWith(client, null),
    );
    expect(res?.status).toBe(401);
  });
});

describe("PATCH /api/settings/profile", () => {
  it("updates the sent fields and returns the new profile", async () => {
    const { client, updates } = mockClient();
    const res = await handleProfileApi(
      patchRequest({ displayName: "Kali", bio: "New bio." }),
      depsWith(client),
    );
    expect(res?.status).toBe(200);
    expect(updates).toEqual([
      {
        table: "profiles",
        values: { display_name: "Kali", bio: "New bio." },
        id: USER_ID,
      },
    ]);
    const body = (await res?.json()) as { displayName: string; bio: string };
    expect(body.displayName).toBe("Kali");
    expect(body.bio).toBe("New bio.");
  });

  it("clears a field back to null with an empty string", async () => {
    const { client, updates } = mockClient();
    const res = await handleProfileApi(patchRequest({ bio: "   " }), depsWith(client));
    expect(res?.status).toBe(200);
    expect(updates[0]?.values).toEqual({ bio: null });
  });

  it("answers 409 when the username is already taken", async () => {
    const { client } = mockClient({ taken: true });
    const res = await handleProfileApi(patchRequest({ username: "kenneth" }), depsWith(client));
    expect(res?.status).toBe(409);
    const body = (await res?.json()) as { error: string; message: string };
    expect(body.error).toBe("username_taken");
    expect(body.message).toBe("That username is taken, try another.");
  });

  it("answers 409 when the database itself rejects a duplicate username", async () => {
    const { client } = mockClient({ updateError: { code: "23505" } });
    const res = await handleProfileApi(patchRequest({ username: "kenneth" }), depsWith(client));
    expect(res?.status).toBe(409);
    expect((await res?.json()) as { error: string }).toEqual(
      expect.objectContaining({ error: "username_taken" }),
    );
  });

  it("says the profile could not be found when no row matches the user", async () => {
    const { client } = mockClient({ updateError: { code: "PGRST116" } });
    const res = await handleProfileApi(patchRequest({ displayName: "Kali" }), depsWith(client));
    expect(res?.status).toBe(502);
    expect((await res?.json()) as { message: string }).toEqual(
      expect.objectContaining({
        message: "Your profile could not be found. Sign out and back in, then try again.",
      }),
    );
  });

  it("answers 400 for a username with the wrong shape", async () => {
    const { client } = mockClient();
    const res = await handleProfileApi(patchRequest({ username: "bad name!" }), depsWith(client));
    expect(res?.status).toBe(400);
  });

  it("answers 400 for a bio over 160 characters", async () => {
    const { client } = mockClient();
    const res = await handleProfileApi(patchRequest({ bio: "x".repeat(161) }), depsWith(client));
    expect(res?.status).toBe(400);
  });

  it("answers 400 when nothing was sent to update", async () => {
    const { client } = mockClient();
    const res = await handleProfileApi(patchRequest({}), depsWith(client));
    expect(res?.status).toBe(400);
  });

  it("returns 401 when nobody is logged in", async () => {
    const { client } = mockClient();
    const res = await handleProfileApi(
      patchRequest({ displayName: "Kali" }),
      depsWith(client, null),
    );
    expect(res?.status).toBe(401);
  });

  it("returns 403 without a CSRF token", async () => {
    const { client } = mockClient();
    const res = await handleProfileApi(patchRequest({ displayName: "Kali" }, {}), depsWith(client));
    expect(res?.status).toBe(403);
  });
});

describe("normalizeProfileInput", () => {
  it("lowercases the username and trims the fields", () => {
    expect(
      normalizeProfileInput({
        displayName: "  Kali  ",
        username: "KALI_Stories",
        bio: "  Hello.  ",
      }),
    ).toEqual({
      ok: true,
      value: { displayName: "Kali", username: "kali_stories", bio: "Hello." },
    });
  });

  it("turns empty strings into null (clear the field)", () => {
    expect(normalizeProfileInput({ username: "  " })).toEqual({
      ok: true,
      value: { username: null },
    });
  });

  it("rejects a username under 3 characters", () => {
    const result = normalizeProfileInput({ username: "ab" });
    expect(result.ok).toBe(false);
  });
});
