import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown in place of a chart that lacks the data to mean anything.
 *
 * Deliberately explicit about how many days exist vs. how many are needed: a
 * new watch produces genuinely thin history, and an empty axis reads as a bug
 * when it is really just "not yet".
 */
export function NotEnoughData({
  have,
  need,
  what,
}: {
  have: number;
  need: number;
  what: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex min-h-[180px] flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium">Not enough data yet</p>
        <p className="text-muted-foreground max-w-sm text-xs">
          {what} needs about {need} days to be meaningful — there {have === 1 ? "is" : "are"}{" "}
          {have} so far. This fills in as the watch collects more.
        </p>
      </CardContent>
    </Card>
  );
}
