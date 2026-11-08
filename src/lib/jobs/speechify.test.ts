import { describe, expect, it } from "vitest";
import {
  listSpeechifyVoices,
  SpeechifyError,
  synthesizeSpeech,
  validateSpeechifyKey,
} from "./speechify";

const FAKE_KEY = "test-key-placeholder";

/** Mock fetch returning a Speechify-style voices list. */
function voicesFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

/** Mock fetch returning a Speechify-style synthesis response. */
function synthFetch(audioBytes: Uint8Array, billable = 12): typeof fetch {
  const b64 = Buffer.from(audioBytes).toString("base64");
  return (async () =>
    new Response(
      JSON.stringify({ audio_data: b64, audio_format: "mp3", billable_characters_count: billable }),
      { status: 200 },
    )) as typeof fetch;
}

describe("Speechify client", () => {
  it("validates a key with the cheap voices call", async () => {
    await expect(validateSpeechifyKey(FAKE_KEY, voicesFetch({ voices: [] }))).resolves.toBe(true);
    await expect(
      validateSpeechifyKey(FAKE_KEY, voicesFetch({ message: "Unauthorized" }, 401)),
    ).resolves.toBe(false);
  });

  it("lists voices with only public metadata", async () => {
    const voices = await listSpeechifyVoices(
      FAKE_KEY,
      voicesFetch({
        voices: [{ id: "elijah", display_name: "Elijah", locale: "en-NG", gender: "male" }],
      }),
    );
    expect(voices).toEqual([
      {
        id: "elijah",
        displayName: "Elijah",
        locale: "en-NG",
        gender: "male",
        previewAudio: undefined,
      },
    ]);
  });

  it("synthesizes speech and returns raw MP3 bytes plus billable chars", async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    const result = await synthesizeSpeech({
      input: "Hello world",
      voiceId: "elijah",
      apiKey: FAKE_KEY,
      fetchImpl: synthFetch(audio, 11),
    });
    expect([...result.audio]).toEqual([0xff, 0xfb, 0x90, 0x00]);
    expect(result.audioFormat).toBe("mp3");
    expect(result.billableCharacters).toBe(11);
  });

  it("sanitises a 401 into a clean error that never contains the key", async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ message: "Invalid API key" }), {
        status: 401,
      })) as typeof fetch;
    let caught: unknown;
    try {
      await synthesizeSpeech({
        input: "Hello",
        voiceId: "elijah",
        apiKey: FAKE_KEY,
        fetchImpl: failing,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SpeechifyError);
    expect((caught as SpeechifyError).status).toBe(401);
    expect((caught as Error).message).toContain("Invalid API key");
    expect((caught as Error).message).not.toContain("test-key-placeholder");
    expect((caught as Error).message).not.toContain("test-key-placeholder");
  });

  it("rejects empty narration text", async () => {
    await expect(
      synthesizeSpeech({
        input: "   ",
        voiceId: "elijah",
        apiKey: FAKE_KEY,
        fetchImpl: synthFetch(new Uint8Array()),
      }),
    ).rejects.toThrow(/empty/);
  });

  it("never sends user text as raw SSML — it is escaped inside <speak>", async () => {
    const bodies: string[] = [];
    const capturing = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      const b64 = Buffer.from(new Uint8Array([0xff, 0xfb])).toString("base64");
      return new Response(
        JSON.stringify({ audio_data: b64, audio_format: "mp3", billable_characters_count: 5 }),
        { status: 200 },
      );
    }) as typeof fetch;
    await synthesizeSpeech({
      input: '<speak><voice name="other">Hello</voice></speak>',
      voiceId: "elijah",
      apiKey: FAKE_KEY,
      fetchImpl: capturing,
    });
    const sent = JSON.parse(bodies[0] as string) as { input?: string };
    expect(sent.input).toContain("&lt;speak&gt;");
    expect(sent.input).not.toContain("<voice");
    expect(sent.input).toContain("Hello");
  });

  it("wraps a valid pace in a prosody tag", async () => {
    const bodies: string[] = [];
    const capturing = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      const b64 = Buffer.from(new Uint8Array([0xff, 0xfb])).toString("base64");
      return new Response(
        JSON.stringify({ audio_data: b64, audio_format: "mp3", billable_characters_count: 5 }),
        { status: 200 },
      );
    }) as typeof fetch;
    await synthesizeSpeech({
      input: "Hello world",
      voiceId: "elijah",
      rate: "-5%",
      apiKey: FAKE_KEY,
      fetchImpl: capturing,
    });
    const sent = JSON.parse(bodies[0] as string) as { input?: string };
    expect(sent.input).toBe('<speak><prosody rate="-5%">Hello world</prosody></speak>');
  });

  it("rejects a pace value that breaks out of the prosody tag", async () => {
    await expect(
      synthesizeSpeech({
        input: "Hello world",
        voiceId: "elijah",
        rate: '-5%"><break time="10s"/>',
        apiKey: FAKE_KEY,
        fetchImpl: synthFetch(new Uint8Array([0xff, 0xfb])),
      }),
    ).rejects.toThrow(/Invalid narration pace/);
  });

  it("clamps the pace to plus or minus 50 percent", async () => {
    const ok = synthFetch(new Uint8Array([0xff, 0xfb]));
    await expect(
      synthesizeSpeech({
        input: "Hello world",
        voiceId: "elijah",
        rate: "50%",
        apiKey: FAKE_KEY,
        fetchImpl: ok,
      }),
    ).resolves.toBeDefined();
    await expect(
      synthesizeSpeech({
        input: "Hello world",
        voiceId: "elijah",
        rate: "-50%",
        apiKey: FAKE_KEY,
        fetchImpl: ok,
      }),
    ).resolves.toBeDefined();
    await expect(
      synthesizeSpeech({
        input: "Hello world",
        voiceId: "elijah",
        rate: "51%",
        apiKey: FAKE_KEY,
        fetchImpl: ok,
      }),
    ).rejects.toThrow(/Invalid narration pace/);
    await expect(
      synthesizeSpeech({
        input: "Hello world",
        voiceId: "elijah",
        rate: "-999%",
        apiKey: FAKE_KEY,
        fetchImpl: ok,
      }),
    ).rejects.toThrow(/Invalid narration pace/);
  });

  it("rejects a voice id or language that is not a plain identifier", async () => {
    const ok = synthFetch(new Uint8Array([0xff, 0xfb]));
    await expect(
      synthesizeSpeech({
        input: "Hello world",
        voiceId: 'elijah"><audio src="http://example.com/x.mp3"/>',
        apiKey: FAKE_KEY,
        fetchImpl: ok,
      }),
    ).rejects.toThrow(/Invalid voice/);
    await expect(
      synthesizeSpeech({
        input: "Hello world",
        voiceId: "elijah",
        language: "en-US; DROP TABLE",
        apiKey: FAKE_KEY,
        fetchImpl: ok,
      }),
    ).rejects.toThrow(/Invalid language/);
    // A normal voice id and language still pass.
    await expect(
      synthesizeSpeech({
        input: "Hello world",
        voiceId: "beatrice_32",
        language: "en-GB",
        apiKey: FAKE_KEY,
        fetchImpl: ok,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects audio that decodes to zero bytes", async () => {
    const empty = (async () =>
      new Response(
        JSON.stringify({ audio_data: "!!!", audio_format: "mp3", billable_characters_count: 5 }),
        { status: 200 },
      )) as typeof fetch;
    await expect(
      synthesizeSpeech({
        input: "Hello world",
        voiceId: "elijah",
        apiKey: FAKE_KEY,
        fetchImpl: empty,
      }),
    ).rejects.toThrow(/no audio/i);
  });
});
