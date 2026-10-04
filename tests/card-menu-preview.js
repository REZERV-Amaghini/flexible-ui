/* Temporary native-page scope preview. No storage writes or menu actions. */
(() => {
  function mount({ api, css, document: doc = document }) {
    const sheet = new CSSStyleSheet();sheet.replaceSync(css);doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    const scopes = { videos: true, comments: true, replies: true };
    const menus = api.createCardMenus({ root: doc.documentElement, scopes });
    const hover = api.createCommentHover({ document: doc });
    const headerFade = api.createHeaderFade({ document: doc });
    const host = doc.createElement('div');host.id = 'liquid-card-menu-preview';const root = host.attachShadow({ mode: 'open' });
    const styles = new CSSStyleSheet();styles.replaceSync(`:host{position:fixed;right:16px;top:72px;width:260px;z-index:2201;color:#eee;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.panel{background:#25252de6;backdrop-filter:blur(28px);border:1px solid #ffffff25;border-radius:16px;padding:12px;box-shadow:0 10px 40px #0006}header{display:flex;align-items:center;justify-content:space-between}strong{font-size:14px}button{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent;border-radius:8px;padding:5px 8px}button:hover{background:#ffffff12}label{display:flex;align-items:center;justify-content:space-between;min-height:42px;border-bottom:1px solid #ffffff12}input{appearance:none;width:36px;height:22px;border:0;border-radius:12px;background:#626269;position:relative;cursor:pointer}input:before{content:"";position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:#eee}input:checked{background:#d4d4da}input:checked:before{left:16px;background:#55555d}p{color:#b5b5bd;margin:10px 0 0;font-size:11px}:focus-visible{outline:2px solid #ddd;outline-offset:2px}`);root.adoptedStyleSheets = [styles];
    const panel = doc.createElement('div');panel.className = 'panel';const header = doc.createElement('header'), title = doc.createElement('strong');title.textContent = '右クリックの範囲を試す';
    const close = doc.createElement('button');close.type = 'button';close.textContent = '終了';close.addEventListener('click', dispose);header.append(title, close);panel.append(header);
    for (const [key, name] of [['videos', '動画一覧'], ['comments', '親コメント'], ['replies', '返信']]) {
      const label = doc.createElement('label'), caption = doc.createElement('span'), input = doc.createElement('input');caption.textContent = name;input.type = 'checkbox';input.checked = scopes[key];input.setAttribute('role', 'switch');input.setAttribute('aria-label', name + 'の右クリック');
      input.addEventListener('change', () => { scopes[key] = input.checked;menus.setScopes(scopes); });label.append(caption, input);panel.append(label);
    }
    for (const [name, selector] of [['動画一覧を見る', '#secondary #related'], ['コメントを見る', 'ytd-comments']]) {
      const button = doc.createElement('button');button.type = 'button';button.textContent = name;button.addEventListener('click', () => doc.querySelector(selector)?.scrollIntoView({ block: 'start' }));panel.append(button);
    }
    const note = doc.createElement('p');note.textContent = 'オンにしたカード内を右クリックすると、YouTubeの元のメニューが開きます。ページを再読み込みすると試作を解除します。';panel.append(note);root.append(panel);doc.documentElement.append(host);
    function dispose() { menus.dispose();hover.dispose();headerFade.dispose();host.remove();doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(value => value !== sheet); }
    return { dispose };
  }
  globalThis.LiquidCardMenuPreview = Object.freeze({ mount });
})();
