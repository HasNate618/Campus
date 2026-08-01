"""HippoCampus CLI — `python -m sync <command>`.

Commands:
  auth [--status]      Brightspace login (Duo push) or token status check
  sync [--code X]      deterministic Brightspace sync (pilot courses by default)
                       [--model M] override the digest model
                       [--dry-run] enrollments + match only
  extract [--code X]   PDF → markdown via pdf-extractor (keeps originals)
          [--file P]   extract a single file
          [--max-mb N] size cap
  models               list models served by bifrost (for --model / config)
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
    if cmd == "extract":
        from sync.extract import main as extract_main
        sys.argv = ["sync.extract"] + rest
        return extract_main()
    if cmd == "models":
        from sync.extract import list_models
        return list_models()
    print(f"Unknown command: {cmd}\n{__doc__}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
