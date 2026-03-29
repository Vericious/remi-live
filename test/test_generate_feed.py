"""Tests for showcase/generate-feed.py."""

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Import generate-feed.py using importlib (hyphenated filename requires special import)
_import_path = Path(__file__).parent.parent / "showcase" / "generate-feed.py"
_spec = __import__("importlib.util").util.spec_from_file_location("_generate_feed", _import_path)
_generate_feed = __import__("importlib.util").util.module_from_spec(_spec)
_spec.loader.exec_module(_generate_feed)

# Expose functions for tests
DEFAULT_DB_PATH = _generate_feed.DEFAULT_DB_PATH
get_db_path = _generate_feed.get_db_path
load_task_counts_from_db = _generate_feed.load_task_counts_from_db
load_task_counts_from_tasks_md = _generate_feed.load_task_counts_from_tasks_md
generate_feed_metrics = _generate_feed.generate_feed_metrics


class TestDbPath:
    """Test database path resolution."""

    def test_default_db_path(self) -> None:
        """Default path is /home/openclaw/.openclaw/data/tasks.db."""
        # Remove env var if set
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
            # DB doesn't exist, should return None from load_task_counts_from_db
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
