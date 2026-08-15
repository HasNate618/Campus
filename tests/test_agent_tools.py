"""Agent tool-surface sanity: terminal_run blocklist + mutate safety rules.

The blocklist is the security boundary between the chat agent and the
host/container — a regression here is a real vulnerability, so the rules
deserve tests. TERMINAL_BLOCKLIST holds regex STRINGS; terminal_run compiles
them at call time, so the tests compile the same way.
"""

from __future__ import annotations

import re

import pytest


@pytest.fixture()
def compiled():
    from agent.tools import TERMINAL_BLOCKLIST
    return [re.compile(p) for p in TERMINAL_BLOCKLIST]


def test_blocklist_rejects_dangerous_commands(compiled):
    dangerous = [
        "sudo rm -rf /",
        "systemctl stop campus",
        "nixos-rebuild switch",
        "docker exec campus bash",
        "cat ~/.campus/token.json",
        "python -m sync auth",
        "chmod 777 /etc/passwd",
    ]
    for cmd in dangerous:
        assert any(r.search(cmd) for r in compiled), cmd


def test_blocklist_allows_benign_commands(compiled):
    benign = [
        "ls -la notes/",
        "rg 'deadline' content/",
        "echo hello",
        "cd work && mkdir lab3",
    ]
    for cmd in benign:
        assert not any(r.search(cmd) for r in compiled), cmd
