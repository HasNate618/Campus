"""Office → PDF via LibreOffice headless. Sibling artifacts only."""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

OFFICE_SUFFIXES = {".pptx", ".docx"}
CONVERT_TIMEOUT_S = 120


def is_office_source(path: Path) -> bool:
    return path.suffix.lower() in OFFICE_SUFFIXES


def converted_pdf_path(path: Path) -> Path:
    return path.with_suffix(".pdf")


def _run_soffice(src: Path, out_dir: Path, timeout_s: int) -> subprocess.CompletedProcess:
    # LibreOffice needs a writable HOME for its user profile
    import os
    env = os.environ.copy()
    env["HOME"] = "/tmp/lo-profile"
    os.makedirs(env["HOME"], exist_ok=True)
    return subprocess.run(
        ["soffice", "--headless", "--nologo", "--nolockcheck",
         "--convert-to", "pdf", "--outdir", str(out_dir), str(src)],
        capture_output=True, text=True, timeout=timeout_s, env=env,
    )


def convert_office_to_pdf(src: Path, timeout_s: int = CONVERT_TIMEOUT_S) -> Path | None:
    """Convert .pptx/.docx → sibling .pdf. Returns pdf path or None."""
    src = Path(src)
    if not is_office_source(src) or not src.exists():
        return None
    dest = converted_pdf_path(src)
    try:
        if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime and dest.stat().st_size > 0:
            return dest
    except OSError:
        pass
    if shutil.which("soffice") is None:
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="campus-soffice-") as td:
            out_dir = Path(td)
            r = _run_soffice(src, out_dir, timeout_s)
            if r.returncode != 0:
                return None
            produced = out_dir / (src.stem + ".pdf")
            if not produced.exists() or produced.stat().st_size == 0:
                return None
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp_dest = dest.with_suffix(".pdf.tmp")
            shutil.copyfile(produced, tmp_dest)
            tmp_dest.replace(dest)
            return dest
    except Exception:
        return None
