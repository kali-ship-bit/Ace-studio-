/**
 * Placeholder section — the visible extension point.
 * Kenneth will ask for more sections (e.g. posts, revenue, reports).
 * When he does, follow README.md ("Adding a new section"): this file is
 * replaced by the real section, or a new page is added beside it.
 */

export default function MoreSections() {
  return (
    <section>
      <h2>More sections — ask Kenneth</h2>
      <p>
        Tell Muse what to add here — for example a section for posts, payments, or reports — and it
        will appear in this dashboard.
      </p>
      <p className="muted">
        Adding a section takes three steps: create <code>src/pages/NewSection.tsx</code>, add it to
        the <code>SECTIONS</code> list in <code>src/components/Nav.tsx</code>, and add Row Level
        Security policies if it needs new data. See README.md for the full steps.
      </p>
    </section>
  );
}
