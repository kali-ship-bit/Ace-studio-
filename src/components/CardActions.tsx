import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, Scissors, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveToDevice } from "@/lib/download";

type EditTarget = { video: string } | { episode: string };
interface Props {
  title: string;
  cover: string | null | undefined;
  details: string[];
  edit: EditTarget;
  onDelete: () => void;
}

export function CardActions({ title, cover, details, edit, onDelete }: Props) {
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  if (confirm)
    return (
      <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
        <p className="text-sm font-semibold">Delete “{title}”? Demo data only.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            variant="destructive"
            className="h-11 rounded-xl"
            onClick={() => {
              onDelete();
              setConfirm(false);
              toast.success("Deleted from demo data");
            }}
          >
            Yes, delete
          </Button>
          <Button variant="secondary" className="h-11 rounded-xl" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      <Button
        variant="outline"
        className="h-11 rounded-xl border-destructive/40 px-2 text-xs text-destructive"
        onClick={() => setConfirm(true)}
      >
        <Trash2 />
        Delete
      </Button>
      <Button
        variant="outline"
        disabled={saving}
        className="h-auto min-h-11 rounded-xl border-violet/50 whitespace-normal px-2 text-xs leading-tight text-violet"
        onClick={async () => {
          setSaving(true);
          try {
            const { coverIncluded } = await saveToDevice(title, cover, details);
            if (cover && !coverIncluded)
              toast.success("Details saved — cover could not be downloaded");
            else toast.success("Cover and details saved");
          } catch {
            toast.error("Could not save to device. Try again.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Download />
        Save to device
      </Button>
      <Button
        asChild
        className="h-11 rounded-xl bg-pink px-2 text-xs text-pink-foreground hover:bg-pink/90"
      >
        <Link to="/editor" search={edit}>
          <Scissors />
          Manual edit
        </Link>
      </Button>
    </div>
  );
}
