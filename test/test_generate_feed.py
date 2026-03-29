"""Tests for showcase/generate-feed.py.

SITE-062 tests: DB path config, SQLite query, TASKS.md fallback.
SITE-073 tests: Feed schema, git log parsing, feed entry sorting.
"""

import os
import re
import sys
import tempfile
from pathlib import Path

import pytest

# Import generate-feed.py using importlib (hyphenated filename requires special import)
_import_path = Path(__file__).parent.parent / "showcase" / "generate-feed.py"
_spec = __import__("importlib.util").util.spec_from_file_location("_generate_feed", _import_path)
_generate_feed = __import__("importlib.util").util.module_from_spec(_spec)
_spec.loader.exec_module(_generate_feed)
sys.modules["_generate_feed"] = _generate_feed  # Make available for tests

# Expose functions for tests
DEFAULT_DB_PATH = _generate_feed.DEFAULT_DB_PATH
get_db_path = _generate_feed.get_db_path
load_task_counts_from_db = _generate_feed.load_task_counts_from_db
load_task_counts_from_tasks_md = _generate_feed.load_task_counts_from_tasks_md
parse_git_log = _generate_feed.parse_git_log
generate_feed_metrics = _generate_feed.generate_feed_metrics
generate_feed_json = _generate_feed.generate_feed_json


# ─────────────────────────────────────────────────────────────────────────────
# SITE-062: DB path, SQLite query, TASKS.md fallback
# ─────────────────────────────────────────────────────────────────────────────

class TestDbPath:
    """Test database path resolution."""

    def test_default_db_path(self) -> None:
        """Default path is /home/openclaw/.openclaw/data/tasks.db."""
        os.environ.pop("TASKS_DB_PATH", None)
        assert get_db_path() == DEFAULT_DB_PATH

    def test_db_path_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """TASKS_DB_PATH env var overrides the default path."""
        monkeypatch.setenv("TASKS_DB_PATH", "/custom/path/tasks.db")
        assert get_db_path() == "/custom/path/tasks.db"

    def test_db_path_is_configurable_via_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """DB path is configurable via TASKS_DB_PATH environment variable."""
        with tempfile.TemporaryDirectory() as tmpdir:
            custom_path = str(Path(tmpdir) / "custom.db")
            monkeypatch.setenv("TASKS_DB_PATH", custom_path)
            assert get_db_path() == custom_path
            # DB doesn't exist, should return None
            result = load_task_counts_from_db(get_db_path())
            assert result is None


class TestTaskCountFromSqlite:
    """Test SQLite task count queries."""

    def test_task_count_from_sqlite(self) -> None:
        """load_task_counts_from_db returns correct counts from real tasks.db."""
        counts = load_task_counts_from_db(DEFAULT_DB_PATH)
        assert counts is not None
        assert counts["total"] == 136
        assert counts["done"] == 51
        assert counts["in_progress"] == 9  # claimed (3) + review (6)
        assert "blocked" in counts["by_status"]
        assert "ready" in counts["by_status"]
        assert counts["by_status"]["done"] == 51
        assert "drift" in counts["by_project"]
        assert "showcase" in counts["by_project"]

    def test_task_count_from_sqlite_nonexistent(self) -> None:
        """Returns None when database file does not exist."""
        result = load_task_counts_from_db("/nonexistent/path/tasks.db")
        assert result is None

    def test_task_count_from_sqlite_wrong_path(self) -> None:
        """Returns None when path points to a non-database file."""
        with tempfile.NamedTemporaryFile(suffix=".db") as f:
            result = load_task_counts_from_db(f.name)
            assert result is None


class TestFallbackToTasksMd:
    """Test TASKS.md fallback when SQLite DB is unavailable."""

    def test_fallback_to_tasks_md_when_db_missing(self) -> None:
        """Falls back to TASKS.md when tasks.db does not exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_db_path = str(Path(tmpdir) / "nonexistent.db")

            # Create a TASKS.md file
            tasks_md = Path(tmpdir) / "TASKS.md"
            tasks_md.write_text(
                "- [ ] Task one\n"
                "- [ ] Task two\n"
                "- [x] Completed task\n"
            )

            # Verify DB doesn't exist
            db_result = load_task_counts_from_db(fake_db_path)
            assert db_result is None

            # TASKS.md fallback should work
            fallback_result = load_task_counts_from_tasks_md(tasks_md)
            assert fallback_result is not None
            assert fallback_result["total"] == 3
            assert fallback_result["done"] == 1
            assert fallback_result["in_progress"] == 2

    def test_fallback_returns_none_when_no_source(self) -> None:
        """Returns None when neither DB nor TASKS.md exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            missing_md = Path(tmpdir) / "TASKS.md"
            assert load_task_counts_from_tasks_md(missing_md) is None


class TestGenerateFeedMetrics:
    """Test feed metrics generation."""

    def test_metrics_have_required_fields(self) -> None:
        """generate_feed_metrics returns all required fields."""
        metrics = generate_feed_metrics()
        assert "tasksCompleted" in metrics
        assert "tasksInProgress" in metrics
        assert "tasksTotal" in metrics
        assert "tasksByStatus" in metrics
        assert "tasksByTier" in metrics
        assert "tasksByProject" in metrics
        assert "source" in metrics

    def test_metrics_source_is_tasks_db(self) -> None:
        """Source is 'tasks.db' when database is available."""
        metrics = generate_feed_metrics()
        assert metrics["source"] == "tasks.db"
        assert metrics["tasksCompleted"] == 51
        assert metrics["tasksTotal"] == 136

    def test_tasks_by_project_has_showcase(self) -> None:
        """tasksByProject includes showcase."""
        metrics = generate_feed_metrics()
        assert "showcase" in metrics["tasksByProject"]
        assert metrics["tasksByProject"]["showcase"] == 72


# ─────────────────────────────────────────────────────────────────────────────
# SITE-073: Feed schema, git log parsing, feed entry sorting
# ─────────────────────────────────────────────────────────────────────────────

class TestFeedJsonSchema:
    """Test that generated feed.json has the correct schema."""

    def test_feed_json_has_correct_schema(self) -> None:
        """Top-level feed.json has lastUpdated, metrics, and feed fields."""
        feed_json = generate_feed_json(repo_path=".")
        import json
        data = json.loads(feed_json)
        assert set(data.keys()) == {"lastUpdated", "metrics", "feed"}
        assert isinstance(data["lastUpdated"], str)
        assert isinstance(data["metrics"], dict)
        assert isinstance(data["feed"], list)

    def test_feed_entry_has_required_fields(self) -> None:
        """Each feed entry has required fields: id, timestamp, project, title."""
        entries = parse_git_log(".")
        if entries:
            entry = entries[0]
            assert "id" in entry
            assert "timestamp" in entry
            assert "project" in entry
            assert "title" in entry
            assert "additions" in entry
            assert "deletions" in entry
            assert "agent" in entry

    def test_metrics_totals_correct(self) -> None:
        """Metrics totals match actual task counts from database."""
        metrics = generate_feed_metrics()
        assert metrics["tasksCompleted"] == 51
        assert metrics["tasksTotal"] == 136
        assert metrics["tasksInProgress"] == 9

    def test_per_project_metrics_populated(self) -> None:
        """tasksByProject includes both drift and showcase with correct counts."""
        metrics = generate_feed_metrics()
        by_project = metrics["tasksByProject"]
        assert by_project["drift"] == 60
        assert by_project["showcase"] == 72
        assert by_project["system"] == 4


class TestGitLogParsing:
    """Test git log parsing for feed entries."""

    def test_git_log_parsing(self) -> None:
        """parse_git_log extracts commit info, additions, deletions."""
        entries = parse_git_log(".", limit=5)
        assert len(entries) > 0

        # Check first entry (most recent)
        entry = entries[0]
        assert entry["id"] == "SITE-062"
        assert entry["project"] == "showcase"
        assert "generate-feed.py" in entry["title"] or "generate" in entry["title"]
        assert entry["additions"] > 0  # Should have additions

    def test_git_log_extracts_task_id_from_commit_message(self) -> None:
        """Task ID is extracted from commit subject (e.g., SITE-062, DRIFT-147)."""
        entries = parse_git_log(".", limit=20)
        ids = [e["id"] for e in entries]
        # Should have at least one properly extracted task ID
        assert any(re.match(r"^(SITE|DRIFT)-\d+$", tid) for tid in ids)

    def test_git_log_extracts_project_from_task_id(self) -> None:
        """Project is correctly derived from task ID prefix (SITE→showcase, DRIFT→drift)."""
        entries = parse_git_log(".", limit=20)
        for e in entries:
            if e["id"].startswith("SITE-"):
                assert e["project"] == "showcase"
            elif e["id"].startswith("DRIFT-"):
                assert e["project"] == "drift"

    def test_feed_entries_sorted_by_timestamp(self) -> None:
        """Feed entries are sorted by timestamp, newest first."""
        import json
        feed_json = generate_feed_json(repo_path=".", feed_limit=10)
        data = json.loads(feed_json)
        entries = data["feed"]

        timestamps = [e["timestamp"] for e in entries]
        assert timestamps == sorted(timestamps, reverse=True)


class TestFallbackToTasksMdIntegration:
    """Integration: full feed generation with TASKS.md fallback."""

    def test_fallback_to_tasks_md(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """generate_feed_metrics uses TASKS.md when tasks.db is unavailable."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a fake TASKS.md
            tasks_md = Path(tmpdir) / "TASKS.md"
            tasks_md.write_text(
                "- [ ] Item A\n"
                "- [x] Item B\n"
                "- [ ] Item C\n"
            )

            # Point DB to non-existent path and TASKS_MD_PATH to our temp file
            monkeypatch.setenv("TASKS_DB_PATH", str(Path(tmpdir) / "no.db"))

            # Temporarily override TASKS_MD_PATH in the module
            # We access the module via sys.modules since we loaded it with importlib
            gf_module = sys.modules.get("_generate_feed")
            assert gf_module is not None
            original_tasks_md = gf_module.TASKS_MD_PATH
            gf_module.TASKS_MD_PATH = tasks_md

            try:
                metrics = gf_module.generate_feed_metrics()
                assert metrics["source"] == "TASKS.md fallback"
                assert metrics["tasksTotal"] == 3
                assert metrics["tasksCompleted"] == 1
            finally:
                gf_module.TASKS_MD_PATH = original_tasks_md
