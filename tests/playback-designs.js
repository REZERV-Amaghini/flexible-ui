/* Interactive design alternatives only. No extension storage or audio DSP. */
(() => {
  'use strict';
  const variants = [
    { id: 'A', name: '一列にまとめる', caption: '枠なしの％表示 · タグは右上', shell: 'plain', picker: 'plain', tags: 'top' },
    { id: 'B', name: '左右を分ける', caption: '小さな入力枠 · タグは見出しの下', shell: 'split', picker: 'box', tags: 'middle' },
    { id: 'C', name: '高さを抑える', caption: '横一列の入力 · タグは下側', shell: 'flat', picker: 'inline', tags: 'bottom' },
    { id: 'D', name: 'ホイールを見せる', caption: '前後の数値を表示 · タグは左下', shell: 'wheel', picker: 'wheel', tags: 'bottom' }
  ];
  const node = (tag, cls, text) => {
    const e = document.createElement(tag);if (cls) e.className = cls;if (text !== undefined) e.textContent = text;return e;
  };
  function create({ icons, onChange, initial = {} }) {
    const state = { enabled: true, mode: 'rate', rate: 1, ...initial }, mounted = new Set();
    let combination = { ...variants[3] };
    function update(change) {
      Object.assign(state, change);for (const card of mounted) card.refresh();onChange({ ...state });
    }
    function card(config, prefix) {
      const instance = LiquidPlaybackCard.create({ icons, config, prefix, getState: () => state, onChange: update });
      mounted.add(instance);return instance;
    }
    function render(target, { onPreview } = {}) {
      // Remove abandoned cards from the shared preview update set.
      for (const instance of mounted) if (!instance.element.isConnected) { instance.dispose();mounted.delete(instance); }
      const intro = node('div', 'rate-design-intro'), description = node('p', '', '同じ値で4案を比較できます。');
      const mix = node('button', 'rate-mix-button', '組み合わせる');mix.type = 'button';intro.append(description, mix);target.append(intro);
      const gallery = node('div', 'rate-design-grid');
      for (const variant of variants) {
        const sample = node('article', 'rate-sample'), heading = node('h3');heading.title = variant.caption;heading.append(node('span', 'rate-letter', variant.id), node('span', '', variant.name));
        sample.append(heading, card(variant, variant.id).element, node('p', 'rate-caption', variant.caption));gallery.append(sample);
      }
      target.append(gallery);
      mix.addEventListener('click', () => {
        gallery.hidden = true;mix.hidden = true;
        const builder = node('div', 'rate-builder'), options = node('div', 'rate-mix-options'), preview = node('div', 'rate-mix-preview');
        let shell = combination.id, picker = combination.picker, tagPosition = combination.tags;
        function choice(label, entries, initial, change) {
          const wrap = node('label', 'rate-mix-choice', label), input = node('select');
          input.setAttribute('aria-label', label);
          for (const [value, text] of entries) { const option = node('option', '', text);option.value = value;input.append(option); }
          input.value = initial;input.addEventListener('change', () => { change(input.value);draw(); });wrap.append(input);options.append(wrap);
        }
        function draw() {
          combination = { ...variants.find(v => v.id === shell), picker, tags: tagPosition };
          for (const instance of mounted) if (preview.contains(instance.element)) { instance.dispose();mounted.delete(instance); }
          preview.replaceChildren(card(combination, '組み合わせ').element);
        }
        choice('カードの形', variants.map(v => [v.id, v.id + ' · ' + v.name]), shell, v => { shell = v; });
        choice('％の表示', variants.map(v => [v.picker, v.id + ' · ' + v.name]), picker, v => { picker = v; });
        choice('タグの位置', [['top', '右上'], ['middle', '見出しの下'], ['bottom', '下側']], tagPosition, v => { tagPosition = v; });
        const actions = node('div', 'rate-mix-actions'), back = node('button', 'rate-mix-button', '4案に戻る'), show = node('button', 'rate-mix-button', '簡易パネルで見る');back.type = show.type = 'button';
        back.addEventListener('click', () => { builder.remove();gallery.hidden = false;mix.hidden = false; });
        show.addEventListener('click', () => onPreview?.({ ...combination }));actions.append(back, show);
        builder.append(options, preview, actions);target.append(builder);draw();
      });
    }
    return { render, card, update, state, variants };
  }
  const sheet = new CSSStyleSheet();sheet.replaceSync(LiquidPlaybackCard.css);document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  window.LiquidPlaybackDesigns = { create };
})();
