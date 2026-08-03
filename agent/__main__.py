"""Campus agent CLI — `python -m agent <args>`.

Examples:
  python -m agent --one "What's due soon in SE 2250B?" --course "SE 2250B"
  python -m agent --one "extend lab 3 by 2 days" --course "SE 2250B"
  python -m agent                      # interactive REPL
"""
import sys

from .chat import main

if __name__ == "__main__":
    sys.exit(main())
