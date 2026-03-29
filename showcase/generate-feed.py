#!/usr/bin/env python3
"""Generate feed.json by querying the tasks database.

Supports:
  - SQLite tasks.db for task counts
  - Fallback to TASKS.md regex parsing when DB is unavailable
  - TASKS_DB_PATH environment variable to override the default path
"""

import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_DB_PATH = "/home/openclaw/.openclaw/data/tasks.db"
TASKS_MD_PATH = Path("/home/openclaw/.openclaw/data/TASKS.md")


def get_db_path() -> str:
    """Return the tasks.db path, checking TASKS_DB_PATH env var first."""
    return os.environ.get("TASKS_DB_PATH", DEFAULT_DB_PATH)


def load_task_counts_from_db(db_path: str) -> dict | None:
    """Query tasks.db for task counts. Returns None if DB unavailable."""
    if not Path(db_path).exists():
        return None

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Total counts by status
        cursor.execute("SELECT status, COUNT(*) FROM tasks GROUP BY status")
        by_status = dict(cursor.fetchall())

        # Counts by tier
        cursor.execute("SELECT tier, COUNT(*) FROM tasks GROUP BY tier")
        by_tier = dict(cursor.fetchall())

        # Counts by project
        cursor.execute("SELECT project, COUNT(*) FROM tasks WHERE project != '' GROUP BY project")
        by_project = dict(cursor.fetchall())

        # Total
        cursor.execute("SELECT COUNT(*) FROM tasks")
        total = cursor.fetchone()[0]

        # Done count (completed)
        done = by_status.get("done", 0)

        # In-progress (claimed + review)
        in_progress = by_status.get("claimed", 0) + by_status.get("review", 0)

        conn.close()

        return {
            "total": total,
            "done": done,
            "in_progress": in_progress,
            "by_status": by_status,
            "by_tier": by_tier,
            "by_project": by_project,
        }
    except (sqlite3.Error, OSError):
        return None


def load_task_counts_from_tasks_md(path: Path) -> dict | None:
    """Parse TASKS.md for task counts using regex.

    TASKS.md format expected (markdown checkbox style):
      - [ ] task-name
      - [x] completed-task

    Returns dict with total, done, in_progress or None if file not found.
    """
    if not path.exists():
        return None

    try:
        content = path.read_text()
    except OSError:
        return None

    # Match checkbox items: - [ ] or - [x] (case-insensitive)
    pattern = re.compile(r"^\s*-\s*\[\s*([x ])\s*\]", re.IGNORECASE | re.MULTILINE)
    matches = pattern.findall(content)

    total = len(matches)
    done = sum(1 for m in matches if m.lower() == "x")
    in_progress = total - done  # simplified: remaining are in-progress

    return {
        "total": total,
        "done": done,
        "in_progress": in_progress,
        "by_status": {"done": done, "ready": in_progress},
        "by_tier": {},
        "by_project": {},
        "source": "TASKS.md",
    }


def generate_feed_metrics() -> dict:
    """Generate feed metrics from tasks.db with TASKS.md fallback."""
    db_path = get_db_path()

    counts = load_task_counts_from_db(db_path)
    if counts is None:
        counts = load_task_counts_from_tasks_md(TASKS_MD_PATH)
        source = "TASKS.md fallback"
    else:
        source = "tasks.db"

    if counts is None:
        counts = {"total": 0, "done": 0, "in_progress": 0, "by_status": {}, "by_tier": {}, "by_project": {}}
        source = "no data"

    return {
        "source": source,
        "tasksCompleted": counts.get("done", 0),
        "tasksInProgress": counts.get("in_progress", 0),
        "tasksTotal": counts.get("total", 0),
        "tasksByStatus": counts.get("by_status", {}),
        "tasksByTier": counts.get("by_tier", {}),
        "tasksByProject": counts.get("by_project", {}),
    }


def generate_feed_json(output_path: str | None = None) -> str:
    """Generate feed.json and optionally write to disk."""
    metrics = generate_feed_metrics()

    feed_data = {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "feed": [],  # Feed entries populated by caller (git log, etc.)
    }

    json_str = json.dumps(feed_data, indent=2)

    if output_path:
        Path(output_path).write_text(json_str)

    return json_str


if __name__ == "__main__":
    output = sys.argv[1] if len(sys.argv) > 1 else "/home/openclaw/.openclaw/data/feed.json"
    result = generate_feed_json(output)
    # Write directly to stdout for interactive use; file write happens inside generate_feed_json
    if output == "-":
        print(result)
    elif output != "/home/openclaw/.openclaw/data/feed.json":
        print(result)
