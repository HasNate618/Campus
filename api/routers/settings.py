"""Settings panel API — read the effective config, write the overrides layer.

Gated by require_auth like every other data router, and deliberately NOT added
to api.auth._PUBLIC_PATHS: /api/config is public because the login screen needs
it at boot, but this endpoint can read a masked API key and changes LLM wiring.
"""
from __future__ import annotations

import os

from fastapi import APIRouter

from api.settings_fields import REGISTRY
from api.version import VERSION

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _layers() -> tuple[dict, dict, str | None]:
    """(settings layer, config.yaml mapping, settings error)."""
    from sync.config import DEFAULT_CONFIG_PATH, _read_config_file, read_settings_layer, settings_path

    sp = settings_path()
    layer, err = read_settings_layer(sp)
    return layer, _read_config_file(DEFAULT_CONFIG_PATH), err


def _effective(cfg, field):
    """Read a field, resolving an alias group the way llm_endpoints() does."""
    if field.couples:
        plural = getattr(cfg, field.key, None) or []
        if plural:
            return list(plural)
        singular = getattr(cfg, field.couples[0], None)
        return [singular] if singular else []
    value = getattr(cfg, field.key, None)
    return list(value) if isinstance(value, list) else value


def _supplied_by(keys: tuple[str, ...], layer: dict, env_attrs: set[str],
                 config_data: dict) -> str:
    """Which layer supplied the winning value, in precedence order.

    env_set_attrs() is NOT "effective source": it reports attributes the
    environment supplies a value for even when the settings layer (which now
    outranks env) overrides them. The settings check therefore comes first.
    """
    if any(k in layer for k in keys):
        return "settings"
    if any(k in env_attrs for k in keys):
        return "env"
    if any(k in config_data for k in keys):
        return "config"
    return "default"


def _mask(value) -> str | None:
    """Last 4 characters only. The plaintext never leaves the server."""
    if not value:
        return None
    text = str(value)
    return f"••••{text[-4:]}" if len(text) > 4 else "••••"


def _snapshot() -> dict:
    from api.config import cfg as api_cfg, DB_PATH, SCHOOL_ROOT
    from sync.config import Config, env_set_attrs, settings_path

    layer, config_data, err = _layers()
    env_attrs = env_set_attrs()
    cfg = Config.load()        # effective: the settings layer wins
    base = Config.load_base()  # layers 1-3: what each field inherits without us

    fields = []
    for key, field in REGISTRY.items():
        keys = (key,) + field.couples
        source = _supplied_by(keys, layer, env_attrs, config_data)
        inherited = _effective(base, field)
        inherited_from = None
        for env_key, attr in _env_name_map().items():
            if attr in field.couples or attr == key:
                if attr in env_attrs:
                    inherited_from = env_key
                    break
        if inherited_from is None and any(k in config_data for k in keys):
            inherited_from = "config.yaml"
        value = _effective(cfg, field)
        fields.append({
            "key": key,
            "group": field.group,
            "kind": field.kind,
            "value": _mask(value) if field.secret else value,
            "source": source,
            # A secret is masked here too — this is the second field that could
            # otherwise carry the plaintext out of the process.
            "inherited_value": _mask(inherited) if field.secret else inherited,
            "inherited_from": inherited_from,
            "secret": field.secret,
            "restart": field.restart,
        })

    sp = settings_path()
    return {
        "fields": fields,
        "settings_file": str(sp),
        "settings_writable": os.access(sp.parent, os.W_OK),
        "settings_file_error": err,
        "auth_enabled": bool(api_cfg.web_password),
        "version": VERSION,
        "readonly": {
            # The API's OWN resolved values — they are what the running server
            # serves, and they can differ from the harness cfg (CAMPUS_DB vs
            # CAMPUS_DB_PATH).
            "db_path": {"value": str(DB_PATH), "from": _origin("CAMPUS_DB", "db_path")},
            "data_root": {"value": str(SCHOOL_ROOT),
                          "from": _origin("CAMPUS_DATA_ROOT", "data_root")},
            "token_dir": {"value": str(api_cfg.token_dir),
                          "from": _origin("CAMPUS_TOKEN_DIR", "token_dir")},
        },
    }


def _env_name_map() -> dict[str, str]:
    from sync.config import ENV_EXTRA, ENV_OVERRIDES

    return {**dict(ENV_OVERRIDES), **ENV_EXTRA}


def _origin(env_key: str, attr: str) -> str:
    """Which layer supplied a readonly path value, for the About display."""
    if os.environ.get(env_key):
        return env_key
    from sync.config import DEFAULT_CONFIG_PATH, _read_config_file

    return "config.yaml" if attr in _read_config_file(DEFAULT_CONFIG_PATH) else "default"


@router.get("")
def get_settings():
    return _snapshot()
