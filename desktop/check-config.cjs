// Refuses to build an installer that points at the placeholder URL.
const { appUrl } = require("./app-config.json");
try {
  const u = new URL(appUrl);
  if (u.protocol !== "https:" || u.hostname.endsWith("example.com")) throw new Error("placeholder or non-https");
  console.log("desktop: app URL", u.origin);
} catch (e) {
  console.error(`desktop/app-config.json: set "appUrl" to your deployed https URL (${e.message}).`);
  process.exit(1);
}
