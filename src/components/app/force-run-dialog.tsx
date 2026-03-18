import { Button } from "@/components/ui/button";
import type { ForceRunConfirm } from "./types";

type ForceRunDialogProps = {
  confirm: ForceRunConfirm | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ForceRunDialog({ confirm, onCancel, onConfirm }: ForceRunDialogProps) {
  if (!confirm) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-sm border border-border bg-card p-4 shadow-xl">
        <p className="text-sm font-medium text-foreground">Force run required</p>
        <p className="mt-2 text-xs text-muted-foreground">
          This process already has output. Running with force will overwrite it.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Force run
          </Button>
        </div>
      </div>
    </div>
  );
}
