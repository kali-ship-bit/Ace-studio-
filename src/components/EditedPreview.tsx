import { captionLeft, clipAt, clipFilterCss, type Project } from "@/lib/editor-rules";

export function EditedPreview({ project, elapsed }: { project: Project; elapsed: number }) {
  const current = clipAt(project, elapsed);
  const clip = project.clips[current.index];
  const colors = { white: "text-on-video", yellow: "text-primary", teal: "text-teal" };
  return (
    <>
      {clip?.image && (
        <img
          key={clip.id}
          src={clip.image}
          alt={`Edited clip ${current.index + 1}`}
          className={`h-full w-full object-cover ${clip.transitionIn === "fade" ? "motion-safe:animate-in motion-safe:fade-in duration-500" : clip.transitionIn === "slide" ? "motion-safe:animate-in motion-safe:slide-in-from-right duration-500" : ""}`}
          style={{
            filter: clipFilterCss(clip),
          }}
        />
      )}
      {clip?.effect === "vignette" && (
        <div className="editor-vignette pointer-events-none absolute inset-0" />
      )}
      {clip?.effect === "grain" && (
        <div className="editor-grain pointer-events-none absolute inset-0" />
      )}
      {clip?.effect === "glow" && (
        <div className="pointer-events-none absolute inset-0 bg-primary/10 mix-blend-soft-light" />
      )}
      {project.texts
        .filter((t) => !t.clipId || t.clipId === clip?.id)
        .map((t) => (
          <p
            key={t.id}
            className={`absolute w-[84%] -translate-x-1/2 whitespace-normal [overflow-wrap:anywhere] -translate-y-1/2 break-words text-center font-bold leading-tight text-shadow-video ${colors[t.color]} ${t.kind === "caption" ? "glass rounded-lg p-1.5" : "font-display"}`}
            style={{ left: `${captionLeft(t.x)}%`, top: `${t.y}%`, fontSize: t.size }}
          >
            {t.text}
          </p>
        ))}
      {project.overlays.map((o) => (
        <div
          key={o.id}
          className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
          style={{ left: `${o.x}%`, top: `${o.y}%`, width: `${o.size}%` }}
        >
          {o.kind === "sticker" ? (
            <span style={{ fontSize: o.size * 1.6 }}>{o.content}</span>
          ) : (
            <img src={o.content} alt="Edited overlay" className="w-full rounded-lg" />
          )}
        </div>
      ))}
      <span className="glass absolute left-2 top-2 rounded-full px-2 py-1 text-xs text-on-video">
        AI-generated · Demo
      </span>
    </>
  );
}
