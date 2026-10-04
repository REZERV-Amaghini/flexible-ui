/* Required SVGs from official lucide-static@1.50.0, bundled without its runtime.
 * Source: https://registry.npmjs.org/lucide-static/-/lucide-static-1.50.0.tgz
 * Copyright (c) 2026 Lucide Icons and Contributors (ISC).
 * Feather-derived icons: Copyright (c) 2013-present Cole Bemis (MIT).
 * Complete license texts are in THIRD-PARTY-NOTICES.txt.
 */
(() => {
  'use strict';
  const namespace = 'http://www.w3.org/2000/svg';
  const attributes = Object.freeze({
    width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  });
  const nodes = {
    gauge: [['path', { d: 'm12 14 4-4' }], ['path', { d: 'M3.34 19a10 10 0 1 1 17.32 0' }]],
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    download: [['path', { d: 'M12 15V3' }], ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'm7 10 5 5 5-5' }]],
    upload: [['path', { d: 'M12 3v12' }], ['path', { d: 'm17 8-5-5-5 5' }], ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }]],
    'chevron-down': [['path', { d: 'm6 9 6 6 6-6' }]],
    'list-video': [['path', { d: 'M21 5H3' }], ['path', { d: 'M10 12H3' }], ['path', { d: 'M10 19H3' }],
      ['path', { d: 'M15 12.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z' }]],
    play: [['path', { d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z' }]],
    'music-2': [['circle', { cx: '8', cy: '18', r: '4' }], ['path', { d: 'M12 18V2l7 4' }]],
    'volume-2': [
      ['path', { d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z' }],
      ['path', { d: 'M16 9a5 5 0 0 1 0 6' }], ['path', { d: 'M19.364 18.364a9 9 0 0 0 0-12.728' }]
    ],
    'settings-2': [
      ['path', { d: 'M14 17H5' }],
      ['path', { d: 'M19 7h-9' }],
      ['circle', { cx: '17', cy: '17', r: '3' }],
      ['circle', { cx: '7', cy: '7', r: '3' }]
    ],
    sun: [
      ['circle', { cx: '12', cy: '12', r: '4' }],
      ['path', { d: 'M12 2v2' }],
      ['path', { d: 'M12 20v2' }],
      ['path', { d: 'm4.93 4.93 1.41 1.41' }],
      ['path', { d: 'm17.66 17.66 1.41 1.41' }],
      ['path', { d: 'M2 12h2' }],
      ['path', { d: 'M20 12h2' }],
      ['path', { d: 'm6.34 17.66-1.41 1.41' }],
      ['path', { d: 'm19.07 4.93-1.41 1.41' }]
    ],
    'panels-top-left': [
      ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
      ['path', { d: 'M3 9h18' }],
      ['path', { d: 'M9 21V9' }]
    ],
    'scan-line': [
      ['path', { d: 'M3 7V5a2 2 0 0 1 2-2h2' }],
      ['path', { d: 'M17 3h2a2 2 0 0 1 2 2v2' }],
      ['path', { d: 'M21 17v2a2 2 0 0 1-2 2h-2' }],
      ['path', { d: 'M7 21H5a2 2 0 0 1-2-2v-2' }],
      ['path', { d: 'M7 12h10' }]
    ],
    'shield-check': [
      ['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }],
      ['path', { d: 'm9 12 2 2 4-4' }]
    ],
    'arrow-left': [
      ['path', { d: 'm12 19-7-7 7-7' }],
      ['path', { d: 'M19 12H5' }]
    ],
    x: [
      ['path', { d: 'M18 6 6 18' }],
      ['path', { d: 'm6 6 12 12' }]
    ],
    'chevron-right': [
      ['path', { d: 'm9 18 6-6-6-6' }]
    ],
    info: [
      ['circle', { cx: '12', cy: '12', r: '10' }],
      ['path', { d: 'M12 16v-4' }],
      ['path', { d: 'M12 8h.01' }]
    ]
  };
  for (const icon of Object.values(nodes)) {
    for (const node of icon) { Object.freeze(node[1]);Object.freeze(node); }
    Object.freeze(icon);
  }
  Object.freeze(nodes);
  function create(name, size = 24) {
    if (!Object.hasOwn(nodes, name)) throw new RangeError('Unknown bundled Lucide icon: ' + name);
    const svg = document.createElementNS(namespace, 'svg');
    for (const [key, value] of Object.entries({ ...attributes, width: size, height: size,
      class: 'lucide lucide-' + name, 'data-lucide': name, 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
    for (const [tag, nodeAttributes] of nodes[name]) {
      const node = document.createElementNS(namespace, tag);
      for (const [key, value] of Object.entries(nodeAttributes)) node.setAttribute(key, value);
      svg.append(node);
    }
    return svg;
  }
  globalThis.YacIcons = Object.freeze({ version: '1.50.0',
    source: 'https://registry.npmjs.org/lucide-static/-/lucide-static-1.50.0.tgz',
    attributes, nodes, create });
})();
