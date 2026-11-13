# cdp - evaluate, navigate, screenshot over the DevTools Protocol

```
node tools/cdp/cdp.mjs eval Redmi "location.href"
node tools/cdp/cdp.mjs eval Fire "window.__sbNativeOutput?.state?.()" 10000
node tools/cdp/cdp.mjs shot Redmi redmi.png
node tools/cdp/cdp.mjs eval 9400 "document.title"        # any CDP port, e.g. tools/phone-check
```

A device name (from `tools/devices.json`) forwards the app's WebView DevTools socket over adb
first: `adb forward tcp:<port> localabstract:webview_devtools_remote_<pid>`. Only debuggable
builds expose it - the dev app (`de.stageboard.app.dev`), not the release app.

For a tab in Chrome on the tablet (not the app), `scripts/tablet-debug.mjs` lists tabs and
watches the console.

Expressions run in the app's page: `window.__sbRunAction({ kind: 'show', op: 'play-pause' })`
drives the app like a key press; the debug hooks are described in docs/09, docs/10, docs/19.
