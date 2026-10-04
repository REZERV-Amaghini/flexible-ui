'use strict';
const assert = require('node:assert/strict'), Picker = require('../color-picker.js');
class Element {
  [require('node:util').inspect.custom]() { return this.tagName + ' ' + this.className + ' ' + (this.value || this.id || ''); }
  constructor(tag, doc) {
    this.tagName = tag;this.ownerDocument = doc;this.children = [];this.attributes = {};this.style = {};this.events = new Map();
    this.hidden = false;this.className = '';this.rect = { left: 340, top: 370, right: 440, bottom: 400, width: 100, height: 30 };
  }
  append(...nodes) { for (const node of nodes) { this.children.push(node);node.parentElement = this; } }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, fn) { if (!this.events.has(key)) this.events.set(key, new Set());this.events.get(key).add(fn); }
  removeEventListener(key, fn) { this.events.get(key)?.delete(fn); }
  fire(key, data = {}) {
    const event = { preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...data };
    for (const fn of [...this.events.get(key) || []]) fn(event);return event;
  }
  getBoundingClientRect() {
    if (this.className === 'liquid-color-menu') {
      const width = parseFloat(this.style.width) || 260, height = Math.min(230, parseFloat(this.style.maxHeight) || 230);
      return { ...this.rect, width, height };
    }
    if (this.className === 'liquid-color-palette') return { ...this.rect, width: this.parentElement.getBoundingClientRect().width - 22 };
    if (this.className === 'liquid-color-swatch') {
      const width = this.parentElement.getBoundingClientRect().width, columns = Number(this.parentElement.style.gridTemplateColumns?.match(/repeat\((\d+)/)?.[1]) || 6;
      return { ...this.rect, width: (width - (columns - 1) * 6) / columns };
    }
    return this.rect;
  }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView(options) { this.scrollRequest = options; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(el => el !== this);this.parentElement = null; }
  get isConnected() { return this.tagName === 'html' || !!this.parentElement?.isConnected; }
}
const doc = new Element('document');doc.createElement = tag => new Element(tag, doc);doc.documentElement = doc.createElement('html');
const win = doc.createElement('window');win.innerWidth = 500;win.innerHeight = 480;doc.defaultView = win;
const boundary = doc.createElement('section');boundary.rect = { left: 30, top: 30, right: 450, bottom: 450 };doc.documentElement.append(boundary);
const changes = [];
const make = (id, language = 'ja', value = '#ff2f92') => Picker.create({ document: doc, icons: { create: () => doc.createElement('svg') },
  overlayRoot: boundary, container: boundary, boundary, label: language === 'en' ? 'Accent color' : 'アクセントの色', id, value, language, onChange: value => changes.push(value) });
const first = make('first'), second = make('second', 'en', '#ABCDEF');boundary.append(first.element, second.element);
const [heading, colors, label, entry, error] = first.menu.children, [hex, apply] = entry.children;
assert.equal(first.button.tagName, 'button');assert.equal(first.button.attributes['aria-haspopup'], 'dialog');
assert.equal(second.button.value, '#abcdef');assert.equal(second.menu.children[2].textContent, 'Color code');
assert.equal(second.menu.children[3].children[1].textContent, 'Apply');
assert.equal(second.menu.children[0].children[1].attributes['aria-label'], 'Close color picker');
assert.equal(hex.type, 'text');assert.equal(hex.maxLength, 7);assert.equal(label.htmlFor, hex.id);
assert.equal(first.menu.attributes['aria-labelledby'], heading.children[0].id);
assert.equal(colors.children.filter(item => item.attributes['aria-pressed'] === 'true').length, 1);
assert.equal(Picker.normalize('#123abF'), '#123abf');assert.equal(Picker.normalize('#fff'), null);
assert.equal(Picker.normalize('red'), null);assert.equal(Picker.normalize('#ffffff00'), null);assert.equal(Picker.normalize(' #ffffff'), null);
assert.equal(first.update('#bad'), false);assert.equal(first.button.value, '#ff2f92');
assert.throws(() => make('invalid', 'ja', 'rgb(255,0,0)'), TypeError);
assert.ok(!Picker.css.includes('input[type=color]'), 'painted controls never invoke a native color picker');

first.open();assert.equal(first.menu.hidden, false);assert.ok(Picker.hasOpenMenu(doc));assert.equal(doc.activeElement, colors.children[0]);
assert.equal(first.button.attributes['aria-expanded'], 'true');assert.equal(Number.parseFloat(first.menu.style.left), 150);
assert.equal(Number.parseFloat(first.menu.style.top), 104);assert.equal(Number.parseFloat(first.menu.style.maxHeight), 404);
let event = doc.fire('keydown', { key: 'ArrowRight' });assert.ok(event.prevented && event.stopped);assert.equal(doc.activeElement, colors.children[1]);
doc.fire('keydown', { key: 'ArrowDown' });assert.equal(doc.activeElement, colors.children[7]);
doc.fire('keydown', { key: 'ArrowUp' });assert.equal(doc.activeElement, colors.children[1]);
doc.fire('keydown', { key: 'Home' });assert.equal(doc.activeElement, colors.children[0]);
doc.fire('keydown', { key: 'ArrowLeft' });assert.equal(doc.activeElement, colors.children[11]);
doc.fire('keydown', { key: 'End' });assert.equal(doc.activeElement, colors.children[11]);
assert.equal(changes.length, 0, 'keyboard focus movement alone does not save a color');
assert.equal(colors.children.filter(item => item.tabIndex === 0).length, 1);
colors.children[6].fire('click');assert.deepEqual(changes, ['#007aff']);assert.equal(first.menu.hidden, true);assert.equal(doc.activeElement, first.button);
assert.equal(first.button.children[0].style.backgroundColor, '#007aff');

first.open();doc.fire('keydown', { key: 'Tab' });assert.equal(doc.activeElement, hex);
hex.value = '#12';hex.fire('input');assert.equal(apply.disabled, true);assert.equal(changes.length, 1);
event = doc.fire('keydown', { key: 'Enter' });assert.ok(event.prevented && event.stopped);assert.equal(first.menu.hidden, false);
assert.equal(error.hidden, false);assert.equal(hex.attributes['aria-invalid'], 'true');assert.equal(changes.length, 1);
doc.fire('keydown', { key: 'Tab' });assert.equal(doc.activeElement, heading.children[1], 'invalid HEX skips the disabled Apply control');
doc.fire('keydown', { key: 'Tab', shiftKey: true });assert.equal(doc.activeElement, hex);
hex.value = '#12ABef';hex.fire('input');assert.equal(apply.disabled, false);assert.equal(error.hidden, true);assert.equal(hex.attributes['aria-invalid'], 'false');
event = doc.fire('keydown', { key: 'ArrowLeft' });assert.ok(!event.prevented, 'text caret keys keep their editing behavior');
first.update('#34c759');assert.equal(hex.value, '#12ABef', 'remote saved changes preserve custom text being edited');
assert.equal(first.button.value, '#34c759');
doc.fire('keydown', { key: 'Enter' });assert.equal(first.menu.hidden, true);assert.equal(first.button.value, '#12abef');
assert.deepEqual(changes, ['#007aff', '#12abef']);assert.equal(doc.activeElement, first.button);

first.open();assert.equal(hex.value, '#12abef');doc.fire('keydown', { key: 'Tab' });assert.equal(doc.activeElement, hex);
hex.value = '#f03f99';hex.fire('input');doc.fire('keydown', { key: 'Tab' });assert.equal(doc.activeElement, apply);
apply.fire('click');assert.equal(first.button.value, '#f03f99');assert.equal(changes.at(-1), '#f03f99');
first.open();doc.fire('keydown', { key: 'Tab' });doc.fire('keydown', { key: 'Tab' });doc.fire('keydown', { key: 'Tab' });
assert.equal(doc.activeElement, heading.children[1]);event = doc.fire('keydown', { key: 'Tab' });
assert.equal(first.menu.hidden, true);assert.equal(doc.activeElement, first.button);assert.ok(!event.prevented, 'Tab leaves the closed overlay through the visible trigger');
first.open();event = doc.fire('keydown', { key: 'Tab', shiftKey: true });assert.equal(first.menu.hidden, true);assert.ok(!event.prevented);
first.open();hex.value = '#beaded';hex.fire('input');doc.fire('keydown', { key: 'Escape' });
assert.equal(first.button.value, '#f03f99', 'Escape discards text that was not applied');assert.equal(doc.activeElement, first.button);

first.open();doc.fire('pointerdown', { composedPath: () => [hex, first.menu] });assert.equal(first.menu.hidden, false);
doc.fire('pointerdown', { composedPath: () => [boundary] });assert.equal(first.menu.hidden, true);
first.open();second.open();assert.equal(first.menu.hidden, true);assert.equal(second.menu.hidden, false);assert.equal(doc.events.get('keydown').size, 1);
Picker.closeOpenMenu(doc);assert.equal(second.menu.hidden, true);assert.equal(Picker.hasOpenMenu(doc), false);
let choiceClosures = 0;globalThis.LiquidChoiceMenu = { closeOpenMenu: owner => { assert.equal(owner, doc);choiceClosures++; } };
first.open();assert.equal(choiceClosures, 1, 'opening color closes an existing painted choice overlay');first.close();delete globalThis.LiquidChoiceMenu;
first.button.fire('keydown', { key: 'ArrowUp' });assert.equal(doc.activeElement, colors.children[11]);first.close(false);
first.button.fire('keydown', { key: 'ArrowDown' });assert.equal(doc.activeElement, colors.children[0]);first.close();

boundary.clientLeft = 2;boundary.clientTop = 3;boundary.scrollLeft = 7;boundary.scrollTop = 11;
first.open();assert.equal(Number.parseFloat(first.menu.style.left), 155);assert.equal(Number.parseFloat(first.menu.style.top), 112);
first.close();boundary.rect = { left: -100, top: -100, right: 600, bottom: 600 };first.open();
assert.equal(Number.parseFloat(first.menu.style.maxHeight), 464, 'off-screen container bounds intersect the viewport');first.close();
win.innerWidth = 210;win.innerHeight = 100;boundary.rect = { left: 0, top: 0, right: 210, bottom: 100 };
boundary.clientLeft = boundary.clientTop = boundary.scrollLeft = boundary.scrollTop = 0;
first.open();const menuRect = first.menu.getBoundingClientRect();
assert.equal(Number.parseFloat(first.menu.style.width), 194);assert.equal(Number.parseFloat(first.menu.style.maxHeight), 84);
assert.ok(Number.parseFloat(first.menu.style.left) >= 8 && Number.parseFloat(first.menu.style.left) + menuRect.width <= 202);
assert.ok(Number.parseFloat(first.menu.style.top) >= 8 && Number.parseFloat(first.menu.style.top) + menuRect.height <= 92);
doc.fire('keydown', { key: 'End' });doc.fire('keydown', { key: 'ArrowDown' });
assert.equal(doc.activeElement, colors.children[1], 'vertical wrapping keeps its column when the final row is incomplete');
first.close();boundary.rect = { left: 600, top: 600, right: 800, bottom: 800 };first.open();
assert.equal(first.menu.hidden, true);assert.equal(Picker.hasOpenMenu(doc), false, 'an entirely off-screen boundary leaves no invisible open picker');

first.dispose();first.dispose();second.dispose();
for (const type of ['pointerdown', 'keydown', 'scroll']) assert.equal(doc.events.get(type).size, 0);
assert.equal(win.events.get('resize').size, 0);assert.equal(boundary.children.length, 0);
first.open();assert.equal(first.menu.hidden, true);assert.equal(first.update('#ffffff'), false, 'disposed controls remain inactive');
const lastChanges = changes.length;colors.children[0].fire('click');hex.value = '#000000';apply.fire('click');
assert.equal(changes.length, lastChanges, 'queued actions on a disposed picker cannot persist old settings');
console.log('Color picker checks passed: painted swatches, HEX validation, locale, keyboard, focus, bounded placement and cleanup.');
