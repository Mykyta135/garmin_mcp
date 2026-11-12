import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One number with its label. Renders an em dash rather than "0" when a metric
 * is missing — a new watch has real gaps, and zero is a lie about them.
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  className,
}: {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  hint?: string | null;
  className?: string;
}) {
  const missing = value === null || value === undefined || value === "";

  return (
    <Card className={cn("gap-0 py-4", className)}>
      <CardContent className="px-4">
        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span
            className={cn(
              "text-2xl font-semibold tabular-nums",
              missing && "text-muted-foreground/50",
            )}
          >
            {missing ? "—" : value}
          </span>
          {!missing && unit ? (
            <span className="text-muted-foreground text-sm">{unit}</span>
          ) : null}
        </div>
        {hint ? (
          <div className="text-muted-foreground mt-1 text-xs">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
