// Warnungs-Badge und Warnungsliste.

import { el } from './dom.js';
import { WARNING_TYPE_NAMES } from './labels.js';

/** Aktualisiert den Badge im Kopfbereich. */
export function renderWarningBadge(button, index) {
  const count = index.meta.counts?.warnings ?? index.warnings.length;
  button.querySelector('.warning-count').textContent = String(count);
  button.classList.toggle('has-warnings', count > 0);
  button.setAttribute('aria-label', `${count} Warnung${count === 1 ? '' : 'en'} anzeigen`);
}

/** Baut den Inhalt des Warnungs-Dialogs; onNavigate springt zu einem betroffenen Job. */
export function renderWarningList(index, onNavigate) {
  const groups = new Map();
  for (const warning of index.warnings) {
    const type = warning.type || 'unbekannt';
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(warning);
  }
  const orphans = index.jobNodes.filter((job) => job.is_orphan);

  return el('article', { className: 'warnings' }, [
    el('header', { className: 'details-header' }, [
      el('h2', { id: 'warnings-title', className: 'details-title', tabindex: '-1', 'data-autofocus': true }, 'Warnungen aus der Datenpipeline'),
      el('p', { className: 'muted', text: 'Konfigurationsprobleme, die beim Erzeugen von graph.json aufgefallen sind.' }),
    ]),
    index.warnings.length
      ? [...groups.entries()].map(([type, warnings]) => el('section', { className: 'details-section' }, [
        el('h3', { className: 'details-section-title' }, [
          WARNING_TYPE_NAMES[type] || type,
          el('span', { className: 'count', text: String(warnings.length) }),
        ]),
        el('ul', { className: 'warning-list' }, warnings.map((warning) => el('li', { className: `warning-item warning-${type}` }, [
          el('code', { className: 'warning-type', text: type }),
          el('span', { className: 'breakable', text: warning.message || '(ohne Text)' }),
        ]))),
      ]))
      : el('p', { className: 'empty-state', text: 'Keine Warnungen – alles sauber konfiguriert.' }),
    orphans.length
      ? el('section', { className: 'details-section' }, [
        el('h3', { className: 'details-section-title' }, ['Im Graph markierte isolierte Jobs', el('span', { className: 'count', text: String(orphans.length) })]),
        el('ul', { className: 'relation-list' }, orphans.map((job) => el('li', {}, [
          el('button', { type: 'button', className: 'relation-link', onClick: () => onNavigate(job.id) }, [
            el('span', { 'aria-hidden': 'true', text: '⚠' }),
            el('span', { className: 'relation-name', text: job.label }),
          ]),
          el('span', { className: 'relation-dag', text: job.dag_id }),
        ]))),
      ])
      : null,
  ]);
}
