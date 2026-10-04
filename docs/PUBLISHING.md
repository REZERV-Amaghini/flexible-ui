# Publishing Flexible UI

Current development release: 3.1.3. New Firefox identity: flexible-ui@rezerv-amaghini.github.io. Do not upload this ZIP as an update of YouTube Ambient Canvas.

Run `npm run check`, `npm test`, `python scripts/build.py`, and `web-ext lint --source-dir dist/firefox`. Inspect SHA256SUMS.txt and both browser manifests. Build outputs are unsigned until Mozilla signs the Firefox submission.

Upload `dist/flexible-ui-firefox-3.1.3.zip` as a new listed add-on at https://addons.mozilla.org/developers/addon/submit/. Use docs/LISTING.md for the listing, reviewer steps, source/support/privacy URLs and MIT license. Use only current original demonstration screenshots; personal captures and local videos are excluded.

The source archive is an explicit public allowlist. It excludes private caches, profiles, local media, personal instruction files, predecessor history and captured site pages. No generated dependency tree is required to reproduce it.

The public GitHub repository is https://github.com/REZERV-Amaghini/flexible-ui. Tag releases v3.1.3 and identify unsigned developer packages clearly. A submission, successful validation and store approval are different states. Record the actual AMO result after submission rather than claiming approval in advance.
