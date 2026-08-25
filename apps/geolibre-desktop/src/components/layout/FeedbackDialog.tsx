import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@geolibre/ui";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Placeholder for the feature spec's feedback surface (§13): reachable from
 * every surface via the console rail's feedback action, not wired to a backend
 * yet. Replace the body with the real survey form in a later phase.
 */
export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Feedback</DialogTitle>
          <DialogDescription>
            The feedback form isn't built yet -- this is a placeholder so the action is reachable
            from every mode, per the product spec.
          </DialogDescription>
        </DialogHeader>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
