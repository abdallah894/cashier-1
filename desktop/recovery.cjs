"use strict";
// A till must come back by itself when its page crashes or freezes, but a page
// that crashes again and again must not reload in a loop forever.
/** Allows at most `max` reloads per `windowMs`; after that the caller shows the offline page instead. */
function createRecoveryGuard(max = 3, windowMs = 60_000, now = () => Date.now()) {
  let times = [];
  return {
    /** true = go ahead and reload, false = give up for now */
    shouldReload() {
      const t = now();
      times = times.filter((at) => t - at < windowMs);
      if (times.length >= max) return false;
      times.push(t);
      return true;
    },
  };
}
module.exports = { createRecoveryGuard };
