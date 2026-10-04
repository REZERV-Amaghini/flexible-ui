# Contributing to Flexible UI

Report reproducible issues at https://github.com/REZERV-Amaghini/flexible-ui/issues. Include browser/extension versions and the affected feature. Remove account details, tokens and private messages from screenshots or logs.

Use the existing JavaScript modules and bundled Lucide icons. Preserve the native YouTube player and its actions. Keep settings controls consistent in light/dark modes and accessible by keyboard.

Run `npm run check`, `npm test` and `python scripts/build.py` before submitting a change. Browser tests should use the original fixtures served by `npm run demo`; do not commit captured account pages or local media. Generated packages, browser profiles and tool caches are ignored.

Contributions to the extension source use the MIT license. Third-party icon notices and site trademark notices must be preserved. Do not add remote executable code or telemetry.
