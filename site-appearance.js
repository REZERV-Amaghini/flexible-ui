/* Paint-only site adapter. CSS handles new content without per-item JS scans. */
(() => {
  'use strict';
  const attribute = 'data-liquid-ui-appearance';
  class LiquidSiteAppearance {
    constructor(store, site, { document: doc, CSSStyleSheet: Sheet, MutationObserver: Observer, getComputedStyle: computed,
      matchMedia }) {
      this.store = store;this.site = site;this.doc = doc;this.Sheet = Sheet;
      this.computed = element => computed.call(doc.defaultView, element);
      this.sheet = null;this.active = false;this.disposed = false;this.previousAttribute = null;
      this.observer = new Observer(() => { if (this.active) this.paint(); });
      this.media = matchMedia('(prefers-color-scheme: dark)');
      this.schemeChange = () => { if (this.active) this.paint(); };
      this.unsubscribe = store.subscribe(values => {
        const signature = JSON.stringify([values.appearanceEnabled, values.chromeDensity, values.contentDensity, values.cornerRadius, values.chromeBlur]);
        if (signature === this.signature) return;
        this.signature = signature;this.values = { ...values };
        if (!values.appearanceEnabled) this.pause();else { this.start();this.paint(); }
      });
      this.values ||= { ...store.values };
    }
    createSheet() {
      const prefix = `html[${attribute}="${this.site.id}"]`, spec = this.site.appearance;
      const selectors = list => list.map(selector => prefix + ' ' + selector).join(',');
      const sheet = new this.Sheet();
      sheet.replaceSync(`${prefix}{--liquid-ui-chrome-face:transparent;--liquid-ui-content-face:transparent;--liquid-ui-chrome-edge:transparent;--liquid-ui-content-edge:transparent;--liquid-ui-radius:0px;--liquid-ui-filter:none}
        ${selectors(spec.chrome)}{background-color:var(--liquid-ui-chrome-face)!important;backdrop-filter:var(--liquid-ui-filter)!important;border-radius:var(--liquid-ui-radius)!important;box-shadow:inset 0 0 0 1px var(--liquid-ui-chrome-edge)!important}
        ${selectors(spec.content)}{background-color:var(--liquid-ui-content-face)!important;border-radius:var(--liquid-ui-radius)!important;box-shadow:inset 0 0 0 1px var(--liquid-ui-content-edge)!important}
        ${spec.backgrounds.length ? selectors(spec.backgrounds) + '{background-color:transparent!important}' : ''}`);
      this.sheet = sheet;
    }
    start() {
      if (this.active || this.disposed || !this.values.appearanceEnabled) return;
      if (!this.sheet) this.createSheet();
      this.previousAttribute = this.doc.documentElement.getAttribute(attribute);
      this.doc.adoptedStyleSheets = [...this.doc.adoptedStyleSheets, this.sheet];
      this.doc.documentElement.setAttribute(attribute, this.site.id);this.active = true;
      const options = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'dark'] };
      this.observer.observe(this.doc.documentElement, options);
      if (this.doc.body) this.observer.observe(this.doc.body, options);
      this.media.addEventListener('change', this.schemeChange);
    }
    paint() {
      if (!this.active) return;
      const foreground = this.doc.querySelector(this.site.appearance.nativeForeground) || this.doc.body || this.doc.documentElement;
      const native = this.computed(foreground), components = value => value?.match(/[\d.]+/g)?.map(Number);
      const color = components(native.color), background = components(native.backgroundColor);
      const luminance = rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
      const dark = background?.length >= 3 && (background[3] ?? 1) >= .95 ? luminance(background) < 128 :
        color?.length >= 3 ? luminance(color) > 128 : this.media.matches;
      const shade = dark ? '25,27,34' : '250,251,255', edge = dark ? '255,255,255' : '20,24,32';
      const style = this.sheet.cssRules[0].style, values = {
        '--liquid-ui-chrome-face': `rgba(${shade},${this.values.chromeDensity / 100})`,
        '--liquid-ui-content-face': `rgba(${shade},${this.values.contentDensity / 100})`,
        '--liquid-ui-chrome-edge': `rgba(${edge},${.08 * this.values.chromeDensity / 100})`,
        '--liquid-ui-content-edge': `rgba(${edge},${.08 * this.values.contentDensity / 100})`,
        '--liquid-ui-radius': this.values.cornerRadius + 'px',
        '--liquid-ui-filter': this.values.chromeBlur ? `blur(${this.values.chromeBlur}px)` : 'none'
      };
      for (const [key, value] of Object.entries(values)) if (style.getPropertyValue(key).trim() !== value) style.setProperty(key, value);
    }
    pause() {
      if (!this.active) return;
      this.active = false;this.observer.disconnect();this.media.removeEventListener('change', this.schemeChange);
      if (!this.sheet) return;
      this.doc.adoptedStyleSheets = this.doc.adoptedStyleSheets.filter(sheet => sheet !== this.sheet);
      if (this.doc.documentElement.getAttribute(attribute) === this.site.id) {
        if (this.previousAttribute === null) this.doc.documentElement.removeAttribute(attribute);
        else this.doc.documentElement.setAttribute(attribute, this.previousAttribute);
      }
    }
    dispose() { this.pause();this.disposed = true;this.unsubscribe(); }
  }
  globalThis.LiquidSiteAppearance = LiquidSiteAppearance;
  if (typeof module !== 'undefined') module.exports = LiquidSiteAppearance;
  if (globalThis.LiquidUI && !globalThis.LiquidAppearance && typeof document !== 'undefined' && window.top === window) {
    const site = LiquidSites.identify(location.hostname);
    if (!site.appearance) return;
    const controller = new LiquidSiteAppearance(LiquidUI.getStore(site.id), site,
      { document, CSSStyleSheet, MutationObserver, getComputedStyle, matchMedia });
    globalThis.LiquidAppearance = Object.freeze({ dispose: () => controller.dispose() });
    window.addEventListener('pagehide', event => { if (event.persisted) controller.pause();else controller.dispose(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { controller.start();controller.paint(); } });
  }
})();
