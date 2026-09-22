"""`python -m sync <cmd>` dispatch.

Four places tell the user to run `python -m sync models` (agent/chat.py, the
Config docstring, config.example.yaml, skills/campus-deploy/SKILL.md), so the
command has to exist. The handler used to sit after `return mine_main()` inside
the `mine` branch — unreachable dead code — and `models` fell through to
"Unknown command".
"""

from __future__ import annotations


def test_models_dispatches_to_list_models(monkeypatch, capsys):
    """main() must call sync.extract.list_models() and return its status."""
    import sync.extract
    from sync.__main__ import main

    called: list[bool] = []

    def fake_list_models() -> int:
        called.append(True)
        return 7

    monkeypatch.setattr(sync.extract, "list_models", fake_list_models)
    monkeypatch.setattr("sys.argv", ["sync", "models"])

    assert main() == 7
    assert called == [True]
    assert "Unknown command" not in capsys.readouterr().out
