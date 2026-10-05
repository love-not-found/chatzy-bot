{
  description = "Chatzy <-> Discord bot development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        # The `playwright` version pinned in package.json MUST match this version,
        # otherwise Playwright looks for browser builds that are not in the store.
        playwright = pkgs.playwright-driver;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            typescript-language-server
            # Optional: run the same Xvfb + VNC stack locally as in the container.
            xvfb
            x11vnc
          ];

          PLAYWRIGHT_BROWSERS_PATH = "${playwright.browsers}";
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";

          shellHook = ''
            echo "chatzy-bot dev shell: bun $(bun --version), playwright ${playwright.version}"
            if [ -f package.json ]; then
              have=$(bun --print "const p=require('./package.json'); (p.dependencies?.playwright ?? p.devDependencies?.playwright ?? \"\")" 2>/dev/null)
              if [ -n "$have" ] && [ "$have" != "${playwright.version}" ]; then
                echo "WARNING: package.json pins playwright $have but nixpkgs provides ${playwright.version}" >&2
              fi
            fi
          '';
        };

        formatter = pkgs.nixfmt;
      }
    );
}
