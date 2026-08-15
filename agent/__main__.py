"""Campus agent CLI — `python -m agent <args>`.

Examples:
  python -m agent --one "What's due soon in CS 1100A?" --course "CS 1100A"
  python -m agent --one "extend lab 3 by 2 days" --course "CS 1100A"
  python -m agent                      # interactive REPL
"""
import sys

from .chat import main

if __name__ == "__main__":
    sys.exit(main())
