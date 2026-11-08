/**
 * Dashboard navigation.
 *
 * SECTIONS is the single list of dashboard sections. To add a section,
 * see README.md ("Adding a new section"): create src/pages/NewSection.tsx,
 * add one entry here, and add RLS policies if it needs new data.
 */

export type SectionId = "overview" | "users" | "settings" | "more";

export interface Section {
  id: SectionId;
  label: string;
  description: string;
}

export const SECTIONS: Section[] = [
  { id: "overview", label: "Overview", description: "Totals and jobs by status" },
  { id: "users", label: "Users", description: "Every user account" },
  { id: "settings", label: "App settings", description: "Change things in the app" },
  {
    id: "more",
    label: "More sections — ask Kenneth",
    description: "Placeholder for the next section",
  },
];

interface NavProps {
  active: SectionId;
  onSelect: (section: SectionId) => void;
}

export default function Nav({ active, onSelect }: NavProps) {
  return (
    <nav className="nav" aria-label="Dashboard sections">
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          className={active === section.id ? "nav-item active" : "nav-item"}
          onClick={() => onSelect(section.id)}
          aria-current={active === section.id ? "page" : undefined}
          title={section.description}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}
