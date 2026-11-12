"""Morning job (launchd, 08:30): sync the last 3 days, write the brief, show a macOS notification.

No LLM involved — the brief is the same text the `daily_brief` MCP tool returns, so a
Claude session later in the day can start from data/brief-latest.txt or just call the tool.

Install / remove: see RUNNING.md ("Morning brief").
"""
import contextlib
import datetime as dt
import subprocess
import sys
from pathlib import Path

from garmin_mcp import local_db

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "data" / "briefs"


def notify(title: str, text: str) -> None:
    safe = text.replace("\\", "").replace('"', "'")[:230]
    subprocess.run(["osascript", "-e", f'display notification "{safe}" with title "{title}"'], check=False)


def headline(brief: str) -> str:
    keep = ("Readiness:", "HRV:", "Sleep:", "Load")
    parts = []
    for line in brief.splitlines():
        if line.startswith(keep):
            parts.append(line.split(",")[0].replace("Readiness: ", "Ready ").replace(" ms last night", ""))
    return " · ".join(parts) or "No data yet — the watch may not have synced."


def main() -> int:
    sync = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "sync.py"), "--days", "3", "--refresh-days", "3"],
        cwd=REPO, capture_output=True, text=True, timeout=900,
    )
    with contextlib.closing(local_db._connect()) as conn:
        brief = local_db.build_brief(conn, dt.date.today(), 7)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"brief-{dt.date.today().isoformat()}.txt").write_text(brief + "\n")
    (REPO / "data" / "brief-latest.txt").write_text(brief + "\n")
    if sync.returncode != 0:
        notify("Garmin sync failed", "Run ./.venv/bin/garmin-mcp-auth --verify in garmin_mcp. " + sync.stdout[-120:])
        print(sync.stdout[-2000:], file=sys.stderr)
        return 1
    notify("Garmin morning", headline(brief))
    print(brief)
    return 0


if __name__ == "__main__":
    sys.exit(main())
