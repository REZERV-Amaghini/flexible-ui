'use strict';
const fixtureProfile = new URLSearchParams(location.search).get('site') === 'x' ? 'x' : 'youtube-music';
document.getElementById('music-fixture').hidden = fixtureProfile !== 'youtube-music';document.getElementById('x-fixture').hidden = fixtureProfile !== 'x';
const fixtureListeners = new Set(), fixtureMessages = new Set();
globalThis.browser = { runtime: { id: 'liquid-appearance-fixture', getManifest: () => ({ version: 'fixture' }),
  onMessage: { addListener: fn => fixtureMessages.add(fn), removeListener: fn => fixtureMessages.delete(fn) } },
  storage: { onChanged: { addListener: fn => fixtureListeners.add(fn), removeListener: fn => fixtureListeners.delete(fn) },
    local: { get: async keys => Object.fromEntries(keys.filter(key => localStorage.getItem(key) !== null).map(key => [key, JSON.parse(localStorage.getItem(key))])),
      set: async values => { const changes = {};for (const [key, value] of Object.entries(values)) {
        changes[key] = { newValue: value };localStorage.setItem(key, JSON.stringify(value)); }
        for (const fn of fixtureListeners) fn(changes, 'local'); } } } };
window.addEventListener('storage', event => {
  if (event.key) for (const fn of fixtureListeners) fn({ [event.key]: {
    newValue: event.newValue === null ? undefined : JSON.parse(event.newValue)
  } }, 'local');
});
function measurements() {
  return Object.fromEntries([...document.querySelectorAll('section:not([hidden]) [data-measure]')].map(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return [element.dataset.measure, { geometry: [rect.x, rect.y, rect.width, rect.height], fontSize: style.fontSize,
      background: style.backgroundColor, radius: style.borderRadius, filter: style.backdropFilter }];
  }));
}
const fixtureBaseline = measurements();
document.getElementById('fixture-action').onclick = () => LiquidUI.open();
document.getElementById('fixture-site').onclick = () => LiquidUI.open({ site: fixtureProfile });
document.getElementById('fixture-theme').onclick = () => document.body.classList.toggle('light');
document.getElementById('fixture-add').onclick = () => {
  const container = document.getElementById(fixtureProfile === 'x' ? 'post-list' : 'music-fixture');
  if (fixtureProfile === 'x') { const post = document.createElement('article');post.dataset.testid = 'tweet';post.textContent = 'あとから追加された投稿';post.dataset.measure = 'x-late-post';container.append(post); }
  else { const line = document.createElement('p');line.textContent = '03 — Added track';document.querySelector('.queue-items').append(line); }
};
document.getElementById('fixture-inspect').onclick = () => {
  const current = measurements(), rows = Object.entries(fixtureBaseline);
  const changed = rows.filter(([key, before]) => JSON.stringify(before.geometry) !== JSON.stringify(current[key].geometry) || before.fontSize !== current[key].fontSize).map(([key]) => key);
  document.getElementById('fixture-result').textContent = JSON.stringify({ profile: fixtureProfile, layoutChanged: changed,
    appearance: document.documentElement.getAttribute('data-liquid-ui-appearance'), current }, null, 2);
};
