# Flexible UI

Flexible UI is an MIT-licensed desktop browser extension for YouTube ambient backgrounds, playback adjustment, video lists and channel cards. YouTube Music and X have optional appearance profiles. It is an independent project, not affiliated with YouTube, Google, Mozilla or X.

Current version: **3.1.3**. This is a new extension identity, separate from YouTube Ambient Canvas.

## Features

- Video-derived ambient backgrounds, black-bar detection and replacement, blur, saturation and interface transparency.
- Shared playback adjustment: speed with pitch preserved, or rate with speed and pitch linked. Animated percentage and semitone wheels.
- Optional video-list organization using YouTube's native filter chips and playlist actions.
- Separate scrolling for video/comments, live chat and video lists; optional ultrawide arrangement.
- Comment and live-chat author cards with public channel information, an overview and available channel videos. Names open a card without navigating away. Ctrl/Cmd-click keeps the original link behavior.
- Light and dark settings, local settings import/export, YouTube accent colors, and a compact quick panel.

Channel cards load the public channel page only after an author is clicked. They do not embed another YouTube page or run remote scripts. Public information is cached in memory for five minutes. No channel history or messages are stored. See [PRIVACY.md](PRIVACY.md).

## Development installation

Requires Python 3.9+ to build, and Node.js 18+ to run tests. No dependencies or compilation are required for the extension itself.

```sh
npm run check
npm test
python scripts/build.py
```

The build produces `dist/flexible-ui-chrome-3.1.3.zip`, `dist/flexible-ui-firefox-3.1.3.zip`, source and store-asset archives, and SHA256SUMS.txt. Unpacked browser directories are `dist/chrome` and `dist/firefox`.

For Chrome 111+, enable Developer mode at chrome://extensions and load `dist/chrome` as an unpacked extension. For Firefox 140+, open about:debugging, choose This Firefox, then Load Temporary Add-on and select `dist/firefox/manifest.json`. Temporary installation lasts until Firefox restarts. A regular Firefox installation requires Mozilla signing; an unsigned development ZIP is not an approved store release.

## Test pages

`npm run demo` starts a loopback-only server and prints its port. `/watch`, `/settings-check` and `/channel-check` use original test graphics and data. The optional `/design-stage` requires a private local page capture, which is deliberately excluded from public source and packages. Local media and captures are never included in an extension ZIP.

## Compatibility

YouTube layout changes, protected video, browser graphics settings and other extensions can affect rendering. Channel pages can be unavailable or change their data format; the card keeps the author's name and provides a retry and an explicit channel link. Firefox for Android has not been validated.

The optional rapid-flash warning uses sampled pixels and is not a medical or safety guarantee. High ambient frame rates and blur may increase GPU usage.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [LICENSE](LICENSE) and [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt). Site logos and trademarks remain the property of their owners.

## 日本語

Flexible UIはYouTubeの背景、再生速度、動画一覧、チャンネルカードを調整する拡張機能です。コメントとライブチャットの名前を押すと、動画ページを離れずにチャンネル情報を確認できます。設定は端末内へ保存し、インポートとエクスポートに対応します。

現在の開発版は3.1.3です。Firefoxの通常インストールにはMozillaの署名が必要です。公開版の審査状況と開発用ZIPを区別してください。

前身とローカル開発の履歴は別に保管しています。公開リポジトリには、個人用キャプチャ、ローカル動画、認証情報を含めません。
