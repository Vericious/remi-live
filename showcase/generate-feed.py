#!/usr/bin/env python3
"""Generate feed.json by querying the tasks database.

Supports:
  - SQLite tasks.db for task counts
  - Fallback to TASKS.md regex parsing when DB is unavailable
  - TASKS_DB_PATH environment variable to override the default path
  - Git log parsing for feed entries
"""

import json
import os
import re
import sqlite3
import subprocess
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


def parse_git_log(repo_path: str | Path | None = None, limit: int = 50) -> list[dict]:
    """Parse recent git log to produce feed entries.

    Uses git log --format='%H|%ai|%s|%an' --numstat to get commits with diff stats.

    Returns list of feed entry dicts with: id, timestamp, project, title,
    agent, additions, deletions.
    """
    cmd = [
        "git", "-C", str(repo_path or "."),
        "log", "--format=%H|%ai|%s|%an",
        "--numstat",
        f"-{limit}",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []

    entries = []
    current_commit = None

    for line in result.stdout.splitlines():
        if not line:
            continue  # Skip blank lines
        if "\t" in line:
            # Numstat line: additions<tab>deletions<tab>path
            if current_commit is not None:
                parts = line.split("\t")
                if len(parts) >= 2:
                    add_str, del_str = parts[0], parts[1]
                    if add_str.isdigit():
                        current_commit["additions"] = current_commit.get("additions", 0) + int(add_str)
                    if del_str.isdigit():
                        current_commit["deletions"] = current_commit.get("deletions", 0) + int(del_str)
        elif "|" in line:
            # Commit header: hash|iso_timestamp|subject|author
            parts = line.split("|")
            if len(parts) >= 4:
                _commit_hash, timestamp, subject, author = parts[0], parts[1], parts[2], parts[3]
                # Extract task ID from subject (e.g., "feat(SITE-083): ...", "fix(DRIFT-147): ...")
                id_match = re.search(r"\b((?:SITE|DRIFT|VER|HEALTH|TEST)-\d+)\b", subject)
                task_id = id_match.group(1) if id_match else None

                # Extract project from task ID
                if task_id:
                    project = task_id.split("-")[0].lower()
                    if project == "site":
                        project = "showcase"
                else:
                    project = "unknown"

                # Normalize timestamp to ISO format (e.g., "2026-03-29 14:59:43 +0000" → "2026-03-29T14:59:43Z")
                ts = timestamp.replace(" ", "T", 1)
                # Replace +0000 UTC offset with Z (handle trailing space before offset)
                ts = re.sub(r"\s*[+-]\d{4}$", "Z", ts)

                current_commit = {
                    "id": task_id or subject[:20],
                    "timestamp": ts,
                    "project": project,
                    "title": subject,
                    "summary": None,
                    "agent": author or "unknown",
                    "model": None,
                    "additions": 0,
                    "deletions": 0,
                }
                entries.append(current_commit)

    return entries


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


def generate_feed_json(
    repo_path: str | Path | None = None,
    output_path: str | None = None,
    feed_limit: int = 50,
) -> str:
    """Generate feed.json with metrics and recent git log entries.

    Args:
        repo_path: Path to git repository (defaults to current directory).
        output_path: Path to write feed.json (optional).
        feed_limit: Number of git log entries to include in feed.

    Returns the feed.json as a JSON string.
    """
    metrics = generate_feed_metrics()
    feed_entries = parse_git_log(repo_path, limit=feed_limit)

    feed_data = {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "feed": feed_entries,
    }

    json_str = json.dumps(feed_data, indent=2)

    if output_path:
        Path(output_path).write_text(json_str)

    return json_str


if __name__ == "__main__":
    output = sys.argv[1] if len(sys.argv) > 1 else "/home/openclaw/.openclaw/data/feed.json"
    result = generate_feed_json(output_path=output)
    # Write directly to stdout for interactive use; file write happens inside generate_feed_json
    if output == "-":
        print(result)
    elif output != "/home/openclaw/.openclaw/data/feed.json":
        print(result)
