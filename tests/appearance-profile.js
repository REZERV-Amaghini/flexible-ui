'use strict';
const fixtureRegistry = LiquidSites;
globalThis.LiquidSites = Object.freeze({ ...fixtureRegistry,
  identify: () => fixtureRegistry.list().find(site => site.id === fixtureProfile) });
