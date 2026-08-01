"""HippoCampus CLI — `python -m sync <command>`.

Commands:
  auth [--status]   Brightspace login (Duo push) or token status check
  sync [--code X]   deterministic Brightspace sync (pilot courses by default)
"""
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 0
    cmd = sys.argv[1]
    rest = sys.argv[2:]
    if cmd == "auth":
        from sync.auth import main as auth_main
        sys.argv = ["sync.auth"] + rest
        return auth_main()
    if cmd == "sync":
        from sync.sync import main as sync_main
        sys.argv = ["sync.sync"] + rest
        return sync_main()
    print(f"Unknown command: {cmd}\n{__doc__}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
