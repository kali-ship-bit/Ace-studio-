import JSZip from "jszip";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "video";

/** Demo "Save to device": a zip with the cover image and a details text file. No video file exists yet. Returns whether the requested cover actually made it into the zip. */
export async function saveToDevice(
  title: string,
  cover: string | null | undefined,
  details: string[],
): Promise<{ coverIncluded: boolean }> {
  const zip = new JSZip();
  zip.file(
    "details.txt",
    [
      `Ace Studio — ${title}`,
      "",
      ...details,
      "",
      "Demo only: no real video file has been generated yet.",
    ].join("\n"),
  );
  let coverIncluded = false;
  if (cover) {
    try {
      const blob = await (await fetch(cover)).blob();
      const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
      zip.file(`cover.${ext}`, blob);
      coverIncluded = true;
    } catch {
      /* cover unavailable — details still save */
    }
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `${slug(title)}.zip`);
  return { coverIncluded };
}
