// Suche mit Autovervollständigung über Job- und DAG-Namen (ARIA-Combobox).

import { el, clear } from './dom.js';
import { TEAM_GLYPHS } from './labels.js';

const MAX_RESULTS = 12;

export function initSearch(index, { input, list, onSelect }) {
  const entries = buildEntries(index);
  let results = [];
  let activeIndex = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const renderResults = () => {
    clear(list);
    if (!results.length) {
      list.appendChild(el('li', { className: 'search-empty', role: 'option', 'aria-disabled': 'true', text: 'Keine Treffer' }));
    }
    results.forEach((entry, position) => {
      list.appendChild(el('li', {
        id: `search-option-${position}`,
        className: `search-option${position === activeIndex ? ' is-active' : ''}`,
        role: 'option',
        'aria-selected': String(position === activeIndex),
        onMousedown: (event) => event.preventDefault(), // Fokus im Feld behalten
        onClick: () => choose(position),
      }, [
        el('span', { className: `search-type search-type-${entry.type}`, text: entry.type === 'dag' ? 'DAG' : 'Job' }),
        el('span', { className: 'search-text' }, [
          el('span', { className: 'search-name' }, highlightMatch(entry.name, input.value)),
          el('span', { className: 'search-sub', text: entry.sub }),
        ]),
        el('span', { className: `team-glyph team-${entry.team}`, 'aria-hidden': 'true', text: TEAM_GLYPHS[entry.team] || '' }),
      ]));
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (activeIndex >= 0) input.setAttribute('aria-activedescendant', `search-option-${activeIndex}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const choose = (position) => {
    const entry = results[position];
    if (!entry) return;
    input.value = entry.name;
    close();
    onSelect(entry);
  };

  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (!query) { close(); return; }
    results = findMatches(entries, query);
    activeIndex = results.length ? 0 : -1;
    renderResults();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (list.hidden) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + step + results.length) % Math.max(results.length, 1);
      renderResults();
      list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (list.hidden && input.value.trim()) {
        results = findMatches(entries, input.value.trim());
        activeIndex = results.length ? 0 : -1;
      }
      choose(activeIndex);
    } else if (event.key === 'Escape') {
      if (!list.hidden) { event.stopPropagation(); close(); }
      else input.value = '';
    }
  });

  input.addEventListener('blur', close);

  // „/“ fokussiert die Suche, sofern nicht gerade in einem Feld getippt wird.
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.ctrlKey || event.metaKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    input.focus();
    input.select();
  });
}

function buildEntries(index) {
  const jobs = index.jobNodes.map((job) => ({
    type: 'job',
    id: job.id,
    name: job.label || job.job_name || job.id,
    sub: job.dag_id || '',
    team: job.team,
    haystack: `${job.label} ${job.job_name || ''} ${job.dag_id || ''}`.toLowerCase(),
  }));
  const dags = index.dagNodes.map((dag) => ({
    type: 'dag',
    id: dag.id,
    name: dag.dag_id || dag.label,
    sub: `${(index.childrenByDag.get(dag.id) || []).length} Jobs`,
    team: dag.team,
    haystack: `${dag.dag_id || ''} ${dag.label || ''}`.toLowerCase(),
  }));
  return [...dags, ...jobs];
}

/** Alle Suchbegriffe müssen vorkommen; Treffer am Namensanfang zuerst. */
function findMatches(entries, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const entry of entries) {
    if (!terms.every((term) => entry.haystack.includes(term))) continue;
    const name = entry.name.toLowerCase();
    let score = 0;
    if (name === terms[0]) score -= 100;
    else if (name.startsWith(terms[0])) score -= 50;
    else if (name.includes(terms[0])) score -= 20;
    if (entry.type === 'dag') score -= 5;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name));
  return scored.slice(0, MAX_RESULTS).map((item) => item.entry);
}

/** Markiert den ersten Suchbegriff im Namen per <mark>. */
function highlightMatch(name, query) {
  const term = query.trim().split(/\s+/)[0]?.toLowerCase();
  const position = term ? name.toLowerCase().indexOf(term) : -1;
  if (position < 0) return [name];
  return [
    name.slice(0, position),
    el('mark', { text: name.slice(position, position + term.length) }),
    name.slice(position + term.length),
  ];
}
