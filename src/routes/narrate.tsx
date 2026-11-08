import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AudioLines, Download, KeyRound, Loader2, Mic, Play, Settings2 } from "lucide-react";
import { getSessionId, sessionHeaders } from "@/lib/jobs/session";
import { fetchWithCsrf } from "@/lib/auth/session";
import {
  SPEECHIFY_FREE_TIER_MONTHLY_CHARS,
  SPEECHIFY_MAX_CHARS_PER_REQUEST,
} from "@/lib/jobs/limits";
import type { Job } from "@/lib/jobs/types";

export const Route = createFileRoute("/narrate")({
  head: () => ({
    meta: [
      { title: "Create a voice — Ace Studio" },
      {
        name: "description",
        content:
          "Type your story lines, pick a voice, and create narration audio to add to your video.",
      },
      { property: "og:title", content: "Create a voice — Ace Studio" },
      {
        property: "og:description",
        content:
          "Type your story lines, pick a voice, and create narration audio to add to your video.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NarratePage,
});

interface VoiceOption {
  id: string;
  displayName: string;
  locale: string;
}

type JobView = Job;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithCsrf(path, {
    ...init,
    headers: { "content-type": "application/json", ...sessionHeaders(), ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data as T;
}

function statusLabel(job: JobView): string {
  if (job.status === "done") return "Done";
  if (job.status === "failed") return "Failed";
  if (job.status === "running") return "Working…";
  return "Waiting…";
}

function NarratePage() {
  const [text, setText] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voicesMock, setVoicesMock] = useState(false);
  const [voiceId, setVoiceId] = useState("");
  const [voicesError, setVoicesError] = useState("");
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [currentJob, setCurrentJob] = useState<JobView | null>(null);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadVoices = useCallback(async () => {
    setVoicesLoading(true);
    setVoicesError("");
    try {
      const data = await api<{ voices: VoiceOption[]; mock?: boolean }>("/api/voices");
      setVoices(data.voices);
      setVoicesMock(Boolean(data.mock));
      // Pick a default only when none is chosen yet — a functional
      // update, so picking a voice does not re-trigger this fetch.
      if (data.voices.length > 0) {
        setVoiceId((current) => current || data.voices[0]?.id || "");
      }
    } catch (error) {
      setVoicesError(error instanceof Error ? error.message : "Could not load voices");
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const data = await api<{ jobs: JobView[] }>("/api/jobs");
      setJobs(data.jobs);
    } catch {
      // Jobs list is a nicety; a failure here must not block narration.
    }
  }, []);

  useEffect(() => {
    void loadVoices();
    void loadJobs();
    const id = window.setInterval(() => void loadJobs(), 5000);
    return () => window.clearInterval(id);
  }, [loadVoices, loadJobs]);

  // Poll the active job until it finishes.
  useEffect(() => {
    if (!currentJob || currentJob.status === "done" || currentJob.status === "failed") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const data = await api<{ job: JobView }>(`/api/jobs/${currentJob.id}`);
        setCurrentJob(data.job);
        if (data.job.status === "done") {
          toast.success("Your voice is ready", {
            description: "Listen below, or download it to add to your video.",
          });
          void loadJobs();
        }
        if (data.job.status === "failed") {
          toast.error("Voice creation failed", { description: data.job.error ?? "Try again." });
          void loadJobs();
        }
      } catch {
        // Keep polling; a single failed poll is usually a blip.
      }
    }, 1500);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [currentJob, loadJobs]);

  const charCount = text.length;
  const tooLong = charCount > SPEECHIFY_MAX_CHARS_PER_REQUEST;

  const generate = async () => {
    if (!text.trim()) {
      toast.error("Type the words first");
      return;
    }
    if (tooLong) {
      toast.error(`Keep it to ${SPEECHIFY_MAX_CHARS_PER_REQUEST} characters per request`);
      return;
    }
    if (!voiceId) {
      toast.error("Pick a voice first");
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ job: JobView }>("/api/narrate", {
        method: "POST",
        body: JSON.stringify({ text, voiceId, sessionId: getSessionId() }),
      });
      setCurrentJob(data.job);
      toast.success("Voice job started", { description: "This usually takes a few seconds." });
    } catch (error) {
      toast.error("Could not start the voice job", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const runDemoJob = async () => {
    setBusy(true);
    try {
      const data = await api<{ job: JobView }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ kind: "demo", label: "Demo job" }),
      });
      setCurrentJob(data.job);
      toast.success("Demo job started", {
        description: "Watch it move from Waiting to Done below.",
      });
    } catch (error) {
      toast.error("Could not start the demo job", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-[480px] px-4 pb-32 pt-5">
      <h1 className="font-display text-3xl font-bold text-gradient-create">Create a voice</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Type your story lines, pick a voice, and Ace Studio creates the narration audio for your
        video.
      </p>

      <div className="mt-5 rounded-2xl border border-border bg-card p-4">
        <label htmlFor="narrate-text" className="text-sm font-bold">
          Your words
        </label>
        <textarea
          id="narrate-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Type or paste your story lines here…"
          className="mt-2 w-full resize-none rounded-2xl border border-input bg-background p-4 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <p
          className={`mt-1 text-xs font-semibold ${tooLong ? "text-destructive" : "text-muted-foreground"}`}
        >
          {charCount} / {SPEECHIFY_MAX_CHARS_PER_REQUEST} characters per request · Speechify free
          tier: {SPEECHIFY_FREE_TIER_MONTHLY_CHARS.toLocaleString("en-US")} characters a month
        </p>
        {tooLong && (
          <p className="mt-1 text-xs text-destructive">
            Split longer scripts into parts of {SPEECHIFY_MAX_CHARS_PER_REQUEST} characters or
            fewer.
          </p>
        )}

        <label htmlFor="narrate-voice" className="mt-4 block text-sm font-bold">
          Voice
        </label>
        {voicesLoading ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading voices…
          </p>
        ) : voicesError ? (
          <div className="mt-2 rounded-2xl bg-primary/10 p-3 text-sm text-primary">
            <p>{voicesError}</p>
            <Link
              to="/settings"
              className="mt-1 inline-flex items-center gap-1 font-semibold text-teal"
            >
              <KeyRound className="h-4 w-4" /> Add your Speechify key in Settings
            </Link>
          </div>
        ) : (
          <select
            id="narrate-voice"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            className="mt-2 h-14 w-full rounded-2xl border border-input bg-background px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring"
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.displayName} · {v.locale}
              </option>
            ))}
          </select>
        )}
        {voicesMock && (
          <p className="mt-1 text-xs font-semibold text-primary">
            Mock voices — no key is set, so this is a test list, not real Speechify voices.
          </p>
        )}

        <button
          onClick={() => void generate()}
          disabled={busy || !text.trim() || tooLong || !voiceId}
          className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-primary font-bold text-primary-foreground shadow-glow disabled:opacity-40"
        >
          <Mic className="h-5 w-5" /> {busy ? "Starting…" : "Create voice"}
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Voices powered by Speechify. AI-generated audio is labelled as such.
        </p>
      </div>

      {currentJob && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-4" aria-live="polite">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">{currentJob.label}</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${currentJob.status === "done" ? "bg-teal/15 text-teal" : currentJob.status === "failed" ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"}`}
            >
              {statusLabel(currentJob)}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-gradient-primary transition-all"
              style={{ width: `${currentJob.progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{currentJob.detail ?? ""}</p>
          {currentJob.mock && (
            <p className="mt-1 text-xs font-semibold text-primary">
              Mock job — made without a real Speechify key, for testing only.
            </p>
          )}
          {currentJob.status === "failed" && currentJob.error && (
            <p className="mt-2 text-sm text-destructive">{currentJob.error}</p>
          )}
          {currentJob.status === "done" && currentJob.output && (
            <div className="mt-3">
              <audio
                controls
                src={`/api/jobs/${currentJob.id}/output`}
                className="w-full"
                preload="metadata"
              />
              <a
                href={`/api/jobs/${currentJob.id}/output`}
                download={currentJob.output.filename}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-secondary text-sm font-semibold"
              >
                <Download className="h-4 w-4" /> Download {currentJob.output.filename} (
                {Math.round(currentJob.output.bytes / 1024)} KB)
              </a>
            </div>
          )}
        </section>
      )}

      <section className="mt-5 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-bold">
            <AudioLines className="h-5 w-5 text-teal" /> Recent jobs
          </h2>
          <button
            onClick={() => void runDemoJob()}
            disabled={busy}
            className="flex h-10 items-center gap-1 rounded-full bg-secondary px-3 text-xs font-semibold disabled:opacity-40"
          >
            <Play className="h-4 w-4" /> Run a demo job
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          A demo job proves the jobs system works: it moves Waiting → Working → Done and writes a
          small file you can download.
        </p>
        {jobs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No jobs yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {jobs.slice(0, 8).map((j) => (
              <li
                key={j.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate font-semibold">{j.label}</span>
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                  {statusLabel(j)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link
        to="/settings"
        className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-secondary font-semibold"
      >
        <Settings2 className="h-5 w-5 text-teal" /> API keys — bring your own key
      </Link>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        Your key is never shown in full and never saved — it stays in the server's memory for this
        session only.
      </p>
    </main>
  );
}
