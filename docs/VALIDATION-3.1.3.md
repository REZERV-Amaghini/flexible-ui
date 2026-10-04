# Flexible UI 3.1.3 validation

Date: 2026-10-04

The release uses the new public name Flexible UI and a distinct Firefox ID,
flexible-ui@rezerv-amaghini.github.io. Internal storage keys remain compatible
with the preceding local implementation. The predecessor is unchanged.

`npm run check`, `npm run check:design` and all 22 `npm test` suites passed
under Node.js 24.19.0. Channel tests cover URL/image-host validation, inert JSON
parsing, old/modern channel metadata, author identification, cache expiry,
aborted requests, failed requests and login redirects.

Browser checks used the actual channel-card module in original local fixtures:
parent comments, replies, creator badges, live-chat frames, Escape/focus return,
light theme, overview expansion, skeleton loading, failed requests, subsequent
authors and a 360x640 viewport. The current watch URL remained unchanged.
An isolated-world iframe test confirmed that the page-world bridge exposes only
the public channel URL even when the renderer data is inaccessible to the
content script; its temporary result attribute is removed after reading.

The production loader fetched public metadata from an actual YouTube channel
and parsed its name, handle, avatar, subscriber/video counts and six videos.
No fetched script was evaluated. Firefox UI behavior with the new feature has
not been tested end to end; Android is not validated.

Mozilla web-ext 10.7.0 lint reported no errors and one Android minimum-version
warning for the inherited desktop minimum of Firefox 140. The distribution
target is Firefox desktop. Source and both browser ZIPs passed CRC and exact
byte comparisons against unpacked files. The source allowlist excludes private
captures, local media, profiles, personal instruction files and local history.

Store screenshots use original fixture data. Unsigned ZIP validation is not
Mozilla signing or store approval. The actual submission state is reported
separately after publishing.
