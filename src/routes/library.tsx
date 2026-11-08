import { createFileRoute } from "@tanstack/react-router";
import { Library } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Library — Ace Studio" },
      {
        name: "description",
        content: "All your finished videos and connected accounts in one place.",
      },
      { property: "og:title", content: "Library — Ace Studio" },
      {
        property: "og:description",
        content: "All your finished videos and connected accounts in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ComingSoon
      title="Library"
      blurb="All your finished videos and connected accounts in one place."
      icon={Library}
      titleClassName="text-gradient-library"
    />
  ),
});
