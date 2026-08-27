import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
// NixOS: Remotion's downloaded Chrome Headless Shell lacks libnspr4.so;
// use nixpkgs chromium instead (provided via shell.nix)
if (process.env.REMOTION_CHROMIUM_PATH) {
  Config.setBrowserExecutable(process.env.REMOTION_CHROMIUM_PATH);
}
