'use strict';
// Simulate each real adapter while serving only a local synthetic test source.
(() => {
  const registry = LiquidSites, profile = new URLSearchParams(location.search).get('site');
  const selected = registry.list().find(site => site.id === profile);
  if (selected) globalThis.LiquidSites = Object.freeze({ ...registry, identify: () => selected });
})();
