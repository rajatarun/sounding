/**
 * config.js — whether this build has accounts at all.
 *
 * The pool id, client id and API url are not baked into the bundle. The deploy
 * writes them to `auth-config.json` beside the game from the CloudFormation
 * stack outputs, and this fetches that file the first time anybody asks.
 *
 * Three things follow, and the third is the important one:
 *
 *  - rotating the pool needs no rebuild;
 *  - a player who never opens the account screen never fetches it, which
 *    matters on a phone on mobile data in a dark room;
 *  - **the file's absence is the off switch.** No file, no accounts offered,
 *    which is exactly how the game ships today. Nothing about this is an
 *    error path, so a 404 here is quiet.
 */
import { configure as configureCognito } from './cognito.js';
import { configure as configureSync } from './sync.js';

let promise = null;
let loaded = null;

/**
 * Resolve the account configuration, or null if this build has none.
 * Memoised on the promise, so concurrent callers share one request and a
 * failed load is not retried on every keystroke.
 */
export function accountConfig() {
  if (promise) return promise;
  promise = (async () => {
    try {
      // Relative: the game is served from its own origin and the file sits
      // beside index.html, so this is correct at the domain root and under a
      // subdirectory without either being named here.
      const res = await fetch('auth-config.json', { cache: 'no-store' });
      if (!res.ok) return null;
      const cfg = await res.json();
      if (!cfg || !cfg.userPoolId || !cfg.userPoolClientId || !cfg.progressApiUrl) return null;
      configureCognito(cfg);
      configureSync(cfg);
      loaded = cfg;
      return cfg;
    } catch (e) {
      // Offline, blocked, or no such file. All mean the same thing here.
      return null;
    }
  })();
  return promise;
}

/** What accountConfig() last resolved to, without starting a fetch. */
export function loadedConfig() { return loaded; }
