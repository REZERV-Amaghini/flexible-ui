# Privacy policy

Flexible UI 3.1.3 · 2026-10-04

Flexible UI has no developer-operated server, analytics, telemetry, advertising, account system or remote executable code. It does not send your preferences, video pixels, audio, comments, chat messages, browsing history or account details to the developer.

## Local processing

On YouTube, the extension samples the playing video's pixels in temporary canvases to draw ambient backgrounds, detect black bars and optionally detect rapid flashes. Bitmaps are transferred to bundled local Worker code and released after processing. They are not recorded or saved.

The extension reads existing page structure, native filter-chip labels, video links and author names/avatar URLs to organize lists, style comment hover states and open channel cards. For live-chat cards, a small page-world bridge reads only the clicked author's public channel ID from YouTube's message renderer. It does not expose chat-message text or extension storage. The extension does not post comments or chat messages or change subscriptions.

When playback adjustment is enabled, it changes the playback rate and pitch-compensation properties of existing video/audio elements. It does not capture, decode, record or transmit audio.

## Requests to YouTube

Clicking a comment or live-chat author's name requests that public channel page directly from www.youtube.com, using the browser's normal same-origin context. The extension parses the returned public channel metadata and available videos as data; it never executes fetched scripts or embeds the remote page. Channel avatars and thumbnails may load from YouTube/Google image hosts. YouTube may receive the requested channel URL, your IP address and ordinary browser request information, and applies its own privacy policy. There is no separate developer endpoint.

Channel metadata is held only in memory for up to five minutes, with a maximum of 32 cached channels. Closing a card or changing videos cancels its pending request. Removing or closing the page clears this memory. The extension never saves a record of clicked authors or channels.

## Preferences and permissions

The storage permission saves extension preferences in browser.storage.local. Global settings and site-specific visual settings use separate keys. Preferences are not synced or shared automatically. Export creates a JSON file on your device; import reads the file you choose and validates its settings before applying them. The file is not uploaded by the extension.

Content scripts run on ordinary HTTP and HTTPS pages to open the shared settings dialog and apply enabled playback settings. Ambient rendering, list organization, channel-card requests and the public-author bridge are restricted to www.youtube.com. Optional YouTube Music and X appearance profiles apply bundled CSS. Browser-internal pages and protected extension-store pages are not accessible.

All executable code and site-logo SVG paths are bundled. The extension does not download or run remote code. Removing the extension removes its extension storage. Your browser and the websites you visit have their own independent privacy policies.

Contact and source: https://github.com/REZERV-Amaghini/flexible-ui/issues

## 日本語

Flexible UIは開発者のサーバーへ設定、映像、音声、コメント、チャット、閲覧履歴を送信しません。背景描画と黒帯検出に使う画像は、メモリ内で処理して破棄します。設定はブラウザーの端末内ストレージへ保存します。

コメントやライブチャットの名前を押すと、YouTubeへその公開チャンネルのページを要求します。YouTubeには要求したURL、IPアドレスなど通常の通信情報が伝わります。公開された名前、概要、動画などをカードへ表示し、取得したスクリプトは実行しません。画像はYouTubeやGoogleの配信先から読み込む場合があります。

チャンネル情報は最大32件を5分間だけメモリに保持します。クリックした名前やチャンネルの履歴は保存しません。コメントやチャットの投稿、チャンネル登録は操作しません。

再生調整は既存の動画と音声の再生速度、音程補正を変更します。音声の取得、録音、送信は行いません。設定のエクスポートとインポートは端末内のJSONファイルで行い、拡張機能からアップロードしません。
