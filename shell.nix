# Campus dev shell — NixOS needs nixpkgs' patched playwright/chromium.
# Usage: nix-shell           (then: python -m sync.auth / python -m sync)
# The pip venv (.venv) stays for pure-python deps; browsers come from nixpkgs.
#
# With flakes enabled, flake.nix describes the same environment and is the
# preferred entry point (`nix develop`). This file stays so `nix-shell` keeps
# working on a system without flakes.
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
