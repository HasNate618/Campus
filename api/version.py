"""Single source of the app version.

A leaf module on purpose: api/main.py imports the routers, so a router
importing `app` from api.main would be a cycle.
"""

VERSION = "0.3.0"
