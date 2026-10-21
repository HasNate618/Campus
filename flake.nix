{
  description = "Campus development shell: Python 3.12, Node 22, Playwright browsers";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      # Linux only. On NixOS the pip `playwright` wheel cannot download a
      # working chromium (the bundled binary is not patched for the Nix store),
      # so the browsers come from nixpkgs and the two must agree. Darwin has no
      # equivalent guarantee here, so it is left out rather than half-supported.
      systems = [ "x86_64-linux" "aarch64-linux" ];
      eachSystem = f:
        nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = eachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.ffmpeg
            (pkgs.python312.withPackages (ps: [
              ps.playwright
              ps.httpx
              ps.pyyaml
            ]))
          ];
          # Mirrors shell.nix: playwright resolves its browser revision inside
          # this path, which is why the python package and the browser package
          # have to come from the same nixpkgs.
          PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright.browsers}";
        };
      });
    };
}
