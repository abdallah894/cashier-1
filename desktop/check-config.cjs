// Refuses to build an installer that still points at placeholders.
//   node check-config.cjs            -> the app URL must be real
//   node check-config.cjs --release  -> the release repo must be real too (auto-update reads it)
const { appUrl } = require("./app-config.json");
const pkg = require("./package.json");
try {
  const u = new URL(appUrl);
  if (u.protocol !== "https:" || u.hostname.endsWith("example.com")) throw new Error("placeholder or non-https");
  console.log("desktop: app URL", u.origin);
} catch (e) {
  console.error(`desktop/app-config.json: set "appUrl" to your deployed https URL (${e.message}).`);
  process.exit(1);
}
if (process.argv.includes("--release")) {
  const target = (pkg.build.publish || [])[0] || {};
  if (!target.owner || !target.repo || /^YOUR-/i.test(target.owner)) {
    console.error('desktop/package.json: set build.publish "owner" and "repo" to the public releases repository (see docs/desktop-printing.md).');
    process.exit(1);
  }
  console.log("desktop: releases go to", `${target.owner}/${target.repo}`);
}
