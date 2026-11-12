import Link from "next/link";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/recovery", label: "Today" },
  { href: "/activity", label: "Activities" },
  { href: "/running", label: "Running" },
  { href: "/segments", label: "Segments" },
  { href: "/body", label: "Body" },
  { href: "/day", label: "Day detail" },
  { href: "/achievements", label: "Achievements" },
  { href: "/experiments", label: "Experiments" },
  { href: "/matrix", label: "Correlations" },
];

/**
 * Server component: the active link is passed in rather than read from a
 * client-side hook, so no page needs to become interactive just to show nav.
 */
export function SiteNav({ active }: { active: string }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-x-1 gap-y-1 border-b pb-3">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
            l.href === active
              ? "bg-muted text-foreground font-medium"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
