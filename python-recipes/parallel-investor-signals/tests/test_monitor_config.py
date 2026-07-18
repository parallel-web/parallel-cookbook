"""The monitor CLI never substitutes a sample watchlist for user input."""

from pathlib import Path

import pytest

from monitor import config


def test_missing_watchlist_returns_no_investors(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("INVESTORS", raising=False)
    monkeypatch.setattr(config, "_INVESTORS_FILE", tmp_path / "missing.json")

    assert config.load_investors() == []


def test_paid_commands_require_a_real_watchlist(monkeypatch):
    monkeypatch.setattr(config, "INVESTORS", [])

    with pytest.raises(SystemExit, match="No investors configured"):
        config.require_investors()
