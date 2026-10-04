'use strict';
const assert = require('node:assert/strict'), Choice = require('../choice-menu.js');
class Element {
  constructor(tag, doc) { this.tagName = tag;this.ownerDocument = doc;this.children = [];this.attributes = {};this.style = {};this.events = new Map();this.hidden = false;this.rect = { left: 340, top: 370, right: 440, bottom: 400, width: 100, height: 30 }; }
  append(...nodes) { for (const node of nodes) { this.children.push(node);node.parentElement = this; } }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, fn) { if (!this.events.has(key)) this.events.set(key, new Set());this.events.get(key).add(fn); }
  removeEventListener(key, fn) { this.events.get(key)?.delete(fn); }
  fire(key, data = {}) { const event = { preventDefault() {}, stopPropagation() {}, ...data };for (const fn of [...this.events.get(key) || []]) fn(event); }
  getBoundingClientRect() { return this.rect; }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView(options) { this.scrollRequest = options; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(el => el !== this);this.parentElement = null; }
  get isConnected() { return this.tagName === 'html' || !!this.parentElement?.isConnected; }
}
const doc = new Element('document');doc.createElement = tag => new Element(tag, doc);doc.documentElement = doc.createElement('html');
const win = doc.createElement('window');win.innerWidth = 500;win.innerHeight = 480;doc.defaultView = win;
const boundary = doc.createElement('section');boundary.rect = { left: 30, top: 30, right: 450, bottom: 450 };doc.documentElement.append(boundary);
let changes = [];
const make = id => Choice.create({ document: doc, icons: { create: () => doc.createElement('svg') }, overlayRoot: boundary, container: boundary, boundary,
  choices: [['all', 'すべて'], ['channel', '提供'], ['related', '関連動画']], label: '使うタグ', value: 'related', id, onChange: value => changes.push(value) });
const first = make('first'), second = make('second');boundary.append(first.element, second.element);
first.menu.rect.height = second.menu.rect.height = 140;
assert.equal(first.button.tagName, 'button');assert.equal(first.button.attributes['aria-haspopup'], 'menu');
first.open();assert.equal(first.menu.hidden, false);assert.equal(doc.activeElement, first.menu.children[2]);assert.ok(Choice.hasOpenMenu(doc));
assert.deepEqual(first.menu.children[2].scrollRequest, { block: 'nearest', inline: 'nearest' }, 'opening reveals the selected option in a short menu');
assert.equal(first.menu.children.filter(item => item.attributes['aria-checked'] === 'true').length, 1);
assert.ok(Number.parseFloat(first.menu.style.top) + 30 >= 30 && Number.parseFloat(first.menu.style.top) + 30 + 140 <= 450, 'menu fits inside its dialog');
doc.fire('keydown', { key: 'Home' });assert.equal(doc.activeElement, first.menu.children[0]);
assert.equal(first.menu.children[0].scrollRequest.block, 'nearest', 'keyboard movement reveals its focused option');
doc.fire('keydown', { key: 'ArrowUp' });assert.equal(doc.activeElement, first.menu.children[2]);
doc.fire('keydown', { key: 'ArrowDown' });assert.equal(doc.activeElement, first.menu.children[0]);
doc.fire('keydown', { key: 'End' });assert.equal(doc.activeElement, first.menu.children[2]);
first.menu.children[1].fire('click');assert.deepEqual(changes, ['channel']);assert.equal(first.button.value, 'channel');assert.equal(first.menu.hidden, true);assert.equal(doc.activeElement, first.button);
first.open();second.open();assert.equal(first.menu.hidden, true);assert.equal(second.menu.hidden, false);assert.equal(doc.events.get('keydown').size, 1);
Choice.closeOpenMenu(doc);assert.equal(second.menu.hidden, true);second.open();
second.update('all');assert.equal(second.menu.children[0].attributes['aria-checked'], 'true');assert.equal(second.menu.children[2].attributes['aria-checked'], 'false');
doc.fire('pointerdown', { composedPath: () => [second.menu] });assert.equal(second.menu.hidden, false);
doc.fire('keydown', { key: 'Escape' });assert.equal(second.menu.hidden, true);assert.equal(doc.activeElement, second.button);
first.button.fire('keydown', { key: 'ArrowDown' });assert.equal(first.menu.hidden, false);
doc.fire('pointerdown', { composedPath: () => [boundary] });assert.equal(first.menu.hidden, true);
first.open();doc.fire('keydown', { key: 'Tab' });assert.equal(first.menu.hidden, true);assert.equal(doc.activeElement, first.button, 'Tab starts its next focus search from the visible trigger');
boundary.clientLeft = 2;boundary.clientTop = 3;boundary.scrollLeft = 7;boundary.scrollTop = 11;
first.open();assert.equal(Number.parseFloat(first.menu.style.left), 179);assert.equal(Number.parseFloat(first.menu.style.top), 202, 'placement uses the bordered, scrolled containing block');
first.close();boundary.rect = { left: -100, top: -100, right: 600, bottom: 600 };first.open();
assert.equal(Number.parseFloat(first.menu.style.maxHeight), 464, 'off-screen boundaries are intersected with the visible viewport');
first.open();first.dispose();first.dispose();second.dispose();assert.equal(Choice.hasOpenMenu(doc), false);
for (const type of ['pointerdown', 'keydown', 'scroll']) assert.equal(doc.events.get(type).size, 0);
assert.equal(win.events.get('resize').size, 0);assert.equal(boundary.children.length, 0, 'dispose removes menus and trigger controls');
console.log('Choice menus: painted options, scope, checks, keyboard, focus, boundary placement and cleanup passed');
