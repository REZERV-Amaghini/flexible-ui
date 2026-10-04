# Flexible UI · 3.1.3

Name: Flexible UI
Summary: Customize YouTube backgrounds, playback, video lists and channel previews.
Source: https://github.com/REZERV-Amaghini/flexible-ui
Support: https://github.com/REZERV-Amaghini/flexible-ui/issues
Privacy: https://github.com/REZERV-Amaghini/flexible-ui/blob/main/PRIVACY.md
License: MIT
Platform: Firefox desktop 140 or later. Android is not declared.

## Description

Flexible UI adds customizable ambient backgrounds, playback wheels, organized video lists and channel cards to desktop YouTube. Adjust blur, saturation, black-bar handling and interface transparency. Use speed with preserved pitch, or rate with linked speed and pitch.

Comment and live-chat author names open a public channel card without leaving the video. The card can show the channel overview and available videos. A channel page is requested only when you click its author; no remote code or embedded channel page is used.

Choose light or dark settings, set YouTube accent colors, and save or restore preferences using local JSON files. Optional YouTube Music and X appearance profiles and shared playback settings are also available.

No analytics, telemetry or developer-operated data collection. Preferences stay in local extension storage. Channel-card requests go directly to YouTube and its normal image hosts. Read the privacy policy for details.

Independent open-source project. Not affiliated with YouTube, Google, Mozilla or X. Protected videos, YouTube layout changes and other extensions may affect compatibility. Rapid-flash detection is optional and does not guarantee safety.

## 日本語

YouTubeのアンビエント背景、再生調整、動画一覧、チャンネルカードをまとめて設定できます。コメントやライブチャットの名前を押すと、動画ページを離れずに公開チャンネルの概要と動画を確認できます。明暗のテーマ、アクセント色、設定のインポートとエクスポートにも対応します。

設定は端末内へ保存します。チャンネル情報はクリックしたときにYouTubeから取得します。開発者のサーバーへの送信、解析、広告、リモートコードはありません。YouTubeとは関係のない独立したオープンソースの拡張機能です。

## Reviewer instructions

No extension account or API key is required. Load the Firefox ZIP and open a regular desktop YouTube watch page. Open Flexible UI next to the Create button, enable ambient, and adjust blur/strength. Use the playback button in the player's bottom controls to adjust speed and semitones. Open All settings and test light/dark themes, accent color, and local JSON export/import.

Click an author name in a comment, a reply and, when available, live chat/replay. Confirm that a card opens while the watch URL stays unchanged. Close with Escape or its close button. A failed public-channel request leaves the author identity, a retry and a channel link.

Enable video-list organization to reuse the page's native tags and playlist actions. Ultrawide layout depends on available page width; normal layouts keep separate scrolling without requiring organized lists.

Build: Python 3.9+, standard library only, `python scripts/build.py`. The extension uses original unminified source; there is no transpilation, bundler or remote code. Source ZIP includes tests and the reproducible build script.
