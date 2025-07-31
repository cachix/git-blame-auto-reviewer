{ pkgs, ... }:

{
  languages = {
    typescript.enable = true;
    javascript.enable = true;
    # Sync with the node version used by Github Actions
    javascript.package = pkgs.nodejs_20;
    javascript.npm = {
      enable = true;
      install.enable = true;
    };
  };

  git-hooks.hooks = {
    prettier.enable = true;
    prettier.excludes = [ "dist" ];
  };
}
