const { contextBridge } = require("electron");

// The only thing the web app learns about the shell. No Node access is exposed.
contextBridge.exposeInMainWorld("cachierShell", {
  platform: "desktop",
  os: process.platform,
  version: require("./package.json").version,
});
