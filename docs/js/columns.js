// Fixierte Spaltenköpfe und Spalten-Hintergründe, synchron zu Pan und Zoom des Graphen.
// Die DOM-Elemente werden einmal erzeugt; bei Viewport-Änderungen werden nur transform/width gesetzt.

import { el, clear } from './dom.js';

export function initColumns(cy, columns, headsContainer, bandsContainer) {
  clear(headsContainer);
  clear(bandsContainer);

  const entries = columns.map((column, position) => {
    const head = el('div', {
      className: 'column-head',
      role: 'columnheader',
      title: `${column.label} – ${column.count ?? '?'} Job(s)`,
    }, [
      el('span', { className: 'column-head-label', text: column.label }),
      column.count !== undefined ? el('span', { className: 'column-head-count', text: String(column.count) }) : null,
    ]);
    const band = el('div', { className: `column-band ${position % 2 ? 'column-band-odd' : ''}` });
    headsContainer.appendChild(head);
    bandsContainer.appendChild(band);
    return { column, head, band };
  });

  let frameRequested = false;
  const sync = () => {
    frameRequested = false;
    const zoom = cy.zoom();
    const pan = cy.pan();
    for (const { column, head, band } of entries) {
      const width = column.width * zoom;
      const left = column.displayX * zoom + pan.x - width / 2;
      const transform = `translateX(${left.toFixed(1)}px)`;
      head.style.transform = transform;
      head.style.width = `${width.toFixed(1)}px`;
      band.style.transform = transform;
      band.style.width = `${width.toFixed(1)}px`;
      head.classList.toggle('column-head-compact', width < 110);
    }
  };
  const scheduleSync = () => {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(sync);
  };

  cy.on('viewport resize', scheduleSync);
  sync();
  return { sync };
}
