import { SiteNav } from "@/components/site-nav";

import { IntradayView } from "@/components/intraday-view";
import {
  getIntradayBodyBattery,
  getIntradayDates,
  getIntradayStress,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DayPage(props: PageProps<"/day">) {
  const params = await props.searchParams;
  const dates = getIntradayDates();
  const raw = params.date;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  // Only honour a date we actually hold, so a bad query string can't render
  // an empty chart that looks like missing data.
  const selected = requested && dates.includes(requested) ? requested : (dates[0] ?? "");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <SiteNav active="/day" />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Day detail</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {selected ? `Minute-level readings for ${selected}` : "No intraday data yet"}
        </p>
      </header>

      <IntradayView
        dates={dates}
        selected={selected}
        stress={selected ? getIntradayStress(selected) : []}
        battery={selected ? getIntradayBodyBattery(selected) : []}
      />
    </main>
  );
}
