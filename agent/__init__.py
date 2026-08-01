"""HippoCampus agent harness — the brain over the synced data.

Three layers: context construction (system prompt from live state),
tool registry (harness_*/content_*/mutate_*/web_search), and the
tool-calling loop. The web UI later is a thin shell over this.
"""
from .chat import run_turn, chat_repl

__all__ = ["run_turn", "chat_repl"]
