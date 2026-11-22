{
  description = "にしおピアノ教室のWebサイト開発環境";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
    in {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = import ./packages.nix { inherit pkgs; };

            shellHook = ''
              # 初回にこのフォルダへGitリポジトリを作ります。
              if [ ! -e .git ]; then
                git init --initial-branch=main
                git add -- flake.nix flake.lock packages.nix
              fi

              # このプロジェクト内だけに適用する設定です。
              git config --local core.hooksPath .githooks
              git config --local pull.ff only
              git config --local --replace-all credential.https://github.com.helper "!gh auth git-credential"

              for tool in git gh gitleaks node npm rg jq curl shellcheck; do
                tool_path="$(command -v "$tool")"
                case "$tool_path" in
                  /nix/store/*) tool_source="nix/store" ;;
                  *) tool_source="outside nix/store" ;;
                esac
                printf '  %-9s %s (%s)\n' "$tool" "$tool_path" "$tool_source"
              done
            '';
          };
        });
    };
}
