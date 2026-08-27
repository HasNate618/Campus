# Campus dev shell — NixOS needs nixpkgs' patched playwright/chromium.
# Usage: nix-shell           (then: python -m sync.auth / python -m sync)
# The pip venv (.venv) stays for pure-python deps; browsers come from nixpkgs.
{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = [
    pkgs.nodejs_22
    pkgs.ffmpeg
    (pkgs.python3.withPackages (ps: [
      ps.playwright
      ps.httpx
      ps.pyyaml
    ]))
  ];
  shellHook = ''
    export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright.browsers}"
  '';
}
