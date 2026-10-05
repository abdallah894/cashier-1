// Refuses to sync or build a mobile app that points at the placeholder URL.
const { server } = require("./capacitor.config.json");
try {
  const u = new URL(server.url);
  if (u.protocol !== "https:" || u.hostname.endsWith("example.com")) throw new Error("placeholder or non-https");
  console.log("mobile: app URL", u.origin);
} catch (e) {
  console.error(`mobile/capacitor.config.json: set server.url to your deployed https URL (${e.message}).`);
  process.exit(1);
}
