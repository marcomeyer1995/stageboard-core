/**
 * What a Worker of the app must not hand an add-on (docs/36 §5, #964). A browser Worker has the network in its global scope - `fetch`, `XMLHttpRequest`,
 * `WebSocket`, `importScripts` - which the contract says an add-on never holds. This runs **first** in every add-on Worker and removes them from the
 * global object and from every prototype above it (a script could otherwise get the original back with `Object.getPrototypeOf(self).fetch`).
 *
 * It is a guard, not a wall: a dynamic `import('https://…')` is the language, not an API, and cannot be removed this way. What stops that is a
 * Content-Security-Policy for the page (not set yet - docs/36 §5 lists it); until then the honest statement is "an add-on in the app has no
 * network API handed to it", not "it cannot reach the network".
 */
export const NETWORK_APIS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'SharedWorker', 'Worker'] as const

/** The guard as source text, to put in front of an add-on's own code. */
export const WORKER_GUARD = `;(function () {
  var names = ${JSON.stringify(NETWORK_APIS)};
  var scope = self;
  while (scope) {
    for (var i = 0; i < names.length; i++) {
      try { Object.defineProperty(scope, names[i], { value: undefined, writable: false, configurable: false }); } catch (e) { try { scope[names[i]] = undefined; } catch (e2) {} }
    }
    scope = Object.getPrototypeOf(scope);
  }
})();
`

/** The add-on's code behind the guard - what a Worker is started from. */
export const guardedSource = (code: string): string => `${WORKER_GUARD}\n${code}`
