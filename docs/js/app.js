// Einstiegspunkt: Daten laden → Graph aufbauen → UI-Interaktion verdrahten.

import { el, append, clear, readStorage, writeStorage } from './dom.js';
import { loadGraph, buildIndex, GraphLoadError, JOB_KINDS } from './data.js';
import { computeColumns, createGraph, buildStylesheet } from './graph.js';
import { initColumns } from './columns.js';
import { createImpactHighlighter } from './highlight.js';
import { initFilters } from './filters.js';
import { initSearch } from './search.js';
import { createModal } from './modal.js';
import { renderJobDetails } from './details.js';
import { renderWarningBadge, renderWarningList } from './warnings.js';
import { initTheme, readPalette } from './theme.js';
import { kindName, teamName } from './labels.js';

const DATA_URL = './data/graph.json';
const FOCUS_ZOOM = 1;
const VIEW_MARGIN = 28;
const LEGEND_STORAGE_KEY = 'datep-dashboard-legend';

const dom = {
  cy: document.getElementById('cy'),
  graphArea: document.getElementById('graph-area'),
  columnHeads: document.getElementById('column-heads'),
  columnBands: document.getElementById('column-bands'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  notice: document.getElementById('notice'),
  tooltip: document.getElementById('tooltip'),
  status: document.getElementById('status'),
  searchInput: document.getElementById('search-input'),
  searchList: document.getElementById('search-list'),
  teamInputs: [...document.querySelectorAll('input[name="team"]')],
  emailFilter: document.getElementById('email-filter'),
  impactMode: document.getElementById('impact-mode'),
  warningsButton: document.getElementById('warnings-button'),
  themeToggle: document.getElementById('theme-toggle'),
  detailsDialog: document.getElementById('details-dialog'),
  warningsDialog: document.getElementById('warnings-dialog'),
  zoomIn: document.getElementById('zoom-in'),
  zoomOut: document.getElementById('zoom-out'),
  zoomFit: document.getElementById('zoom-fit'),
  zoomHome: document.getElementById('zoom-home'),
  exportPng: document.getElementById('export-png'),
  legend: document.getElementById('legend'),
};

main();

async function main() {
  initLegend();
  try {
    if (typeof window.cytoscape !== 'function') {
      throw new GraphLoadError(
        'Die Grafikbibliothek Cytoscape.js konnte nicht geladen werden.',
        'Das CDN (cdn.jsdelivr.net) ist nicht erreichbar oder wird blockiert. Bitte Netzwerk/Proxy prüfen und neu laden.'
      );
    }
    const graph = await loadGraph(DATA_URL);
    const index = buildIndex(graph);
    startDashboard(index);
  } catch (error) {
    console.error(error);
    showError(error);
  } finally {
    dom.loading.hidden = true;
  }
}

/** Baut Graph und UI auf, sobald die Daten vorliegen. */
function startDashboard(index) {
  const columns = computeColumns(index);
  const cy = createGraph(dom.cy, index, columns, readPalette());
  initColumns(cy, columns, dom.columnHeads, dom.columnBands);

  const highlighter = createImpactHighlighter(cy, index);
  const filters = initFilters(cy, index, {
    teamInputs: dom.teamInputs,
    emailSelect: dom.emailFilter,
    onChange: () => hideTooltip(),
  });

  const detailsModal = createModal(dom.detailsDialog);
  const warningsModal = createModal(dom.warningsDialog);

  /** Zentriert einen Node, markiert ihn und öffnet optional das Popup. */
  const focusNode = (id, { openDetails = false, animate = true } = {}) => {
    const node = index.nodesById.get(id);
    if (!node) return;
    filters.reveal(id);
    const element = cy.getElementById(id);
    if (node.kind === 'dag') {
      highlighter.unpin();
      setUrlJob(null);
      cy.animate({ fit: { eles: element, padding: 60 }, duration: animate ? 350 : 0 });
      return;
    }
    highlighter.pin(id);
    setUrlJob(id);
    const zoom = Math.max(cy.zoom(), FOCUS_ZOOM);
    cy.animate({ center: { eles: element }, zoom, duration: animate ? 350 : 0 });
    flash(element);
    if (openDetails) openJobDetails(id);
  };

  const openJobDetails = (id) => {
    const job = index.nodesById.get(id);
    if (!job || !JOB_KINDS.has(job.kind)) return;
    warningsModal.close();
    detailsModal.open(renderJobDetails(job, {
      index,
      isVisible: (nodeId) => filters.isVisible(nodeId),
      onNavigate: (targetId) => focusNode(targetId, { openDetails: true }),
      permalinkFor: permalinkFor,
    }));
  };

  wireGraphEvents(cy, index, highlighter, openJobDetails, focusNode);
  wireToolbar(cy, index, highlighter, warningsModal, focusNode);
  wireViewControls(cy);

  initSearch(index, {
    input: dom.searchInput,
    list: dom.searchList,
    onSelect: (entry) => focusNode(entry.id),
  });

  initTheme(dom.themeToggle, () => {
    cy.style().fromJson(buildStylesheet(readPalette(), index.meta.layout || {})).update();
  });

  renderWarningBadge(dom.warningsButton, index);
  renderStatus(index);
  renderNotices(index.notices);

  // Startansicht: Permalink oder Überblick ab der linken Spalte.
  showHome(cy, false);
  const linkedJob = new URLSearchParams(location.search).get('job');
  if (linkedJob) {
    if (index.nodesById.has(linkedJob)) focusNode(linkedJob, { openDetails: true, animate: false });
    else renderNotices([`Der verlinkte Job „${linkedJob}“ existiert in graph.json nicht (mehr).`]);
  }
}

// ---------- Graph-Interaktion ----------

function wireGraphEvents(cy, index, highlighter, openJobDetails, focusNode) {
  const isJob = (target) => target.isNode && target.isNode() && JOB_KINDS.has(target.data('kind'));

  cy.on('tap', (event) => {
    const target = event.target;
    if (isJob(target)) {
      focusNode(target.id(), { openDetails: true });
    } else if (target === cy || target.data('kind') === 'dag') {
      highlighter.unpin();
      setUrlJob(null);
    }
  });

  cy.on('mouseover', 'node', (event) => {
    const node = event.target;
    if (!isJob(node)) return;
    node.addClass('hover');
    highlighter.preview(node.id());
    showTooltip(node, index);
    dom.cy.classList.add('is-pointer');
  });

  cy.on('mouseout', 'node', (event) => {
    event.target.removeClass('hover');
    highlighter.endPreview();
    hideTooltip();
    dom.cy.classList.remove('is-pointer');
  });

  cy.on('viewport', hideTooltip);

  // Esc außerhalb eines Dialogs hebt die Auswahl auf.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    if (document.activeElement === dom.searchInput) return;
    highlighter.unpin();
    setUrlJob(null);
  });
}

function wireToolbar(cy, index, highlighter, warningsModal, focusNode) {
  dom.impactMode.addEventListener('change', () => highlighter.setMode(dom.impactMode.value));
  highlighter.setMode(dom.impactMode.value);

  dom.warningsButton.addEventListener('click', () => {
    warningsModal.open(renderWarningList(index, (id) => {
      warningsModal.close();
      focusNode(id, { openDetails: true });
    }));
  });

  dom.exportPng.addEventListener('click', async () => {
    const blob = await cy.png({ output: 'blob-promise', full: true, scale: 2, bg: readPalette().canvas });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `datep-job-graph${index.meta.commit ? `-${index.meta.commit}` : ''}.png` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function wireViewControls(cy) {
  const zoomBy = (factor) => {
    const center = { x: cy.width() / 2, y: cy.height() / 2 };
    cy.animate({ zoom: { level: cy.zoom() * factor, renderedPosition: center }, duration: 180 });
  };
  dom.zoomIn.addEventListener('click', () => zoomBy(1.25));
  dom.zoomOut.addEventListener('click', () => zoomBy(0.8));
  dom.zoomFit.addEventListener('click', () => cy.animate({ fit: { eles: cy.elements(':visible'), padding: VIEW_MARGIN }, duration: 300 }));
  dom.zoomHome.addEventListener('click', () => showHome(cy, true));
}

/** Überblick: volle Breite einpassen (mit Mindestzoom für Lesbarkeit), oben links beginnen. */
function showHome(cy, animate) {
  const visible = cy.elements(':visible');
  if (visible.empty()) return;
  const box = visible.boundingBox();
  const availableWidth = cy.width() - 2 * VIEW_MARGIN;
  const zoom = Math.min(1, Math.max(0.75, availableWidth / box.w));
  const contentWidth = box.w * zoom;
  const offsetX = contentWidth < availableWidth ? (availableWidth - contentWidth) / 2 : 0;
  const pan = { x: VIEW_MARGIN + offsetX - box.x1 * zoom, y: VIEW_MARGIN - box.y1 * zoom };
  if (animate) cy.animate({ zoom, pan, duration: 300 });
  else cy.viewport({ zoom, pan });
}

function flash(element) {
  element.addClass('search-hit');
  setTimeout(() => element.removeClass('search-hit'), 1600);
}

/** Legende auf- und zuklappbar; der Zustand wird pro Browser gemerkt. */
function initLegend() {
  const stored = readStorage(LEGEND_STORAGE_KEY);
  // Auf niedrigen Bildschirmen startet die Legende eingeklappt, damit sie den Graph nicht verdeckt.
  dom.legend.open = stored ? stored === 'open' : window.innerHeight >= 1000;
  dom.legend.addEventListener('toggle', () => writeStorage(LEGEND_STORAGE_KEY, dom.legend.open ? 'open' : 'closed'));
}

// ---------- Tooltip ----------

function showTooltip(node, index) {
  const job = index.nodesById.get(node.id());
  if (!job) return;
  clear(dom.tooltip);
  append(dom.tooltip, [
    el('strong', { text: job.label }),
    el('span', { text: `${teamName(job.team)} · ${kindName(job.kind)} · ${job.level_label || ''}` }),
    job.is_orphan ? el('span', { className: 'tooltip-warn', text: '⚠ Isolierter Job (Config prüfen)' }) : null,
  ]);
  const position = node.renderedPosition();
  const halfHeight = node.renderedOuterHeight() / 2;
  dom.tooltip.hidden = false;
  const areaWidth = dom.graphArea.clientWidth;
  const width = dom.tooltip.offsetWidth;
  const left = Math.min(Math.max(8, position.x - width / 2), areaWidth - width - 8);
  dom.tooltip.style.transform = `translate(${left}px, ${position.y + halfHeight + 8}px)`;
}

function hideTooltip() {
  dom.tooltip.hidden = true;
}

// ---------- Kopf- und Fußbereich ----------

function renderStatus(index) {
  const { meta } = index;
  const counts = meta.counts || {};
  const generated = meta.generated_at
    ? new Date(meta.generated_at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
    : null;
  const items = [
    el('span', { className: 'status-item' }, [
      'Stand: ',
      generated ? el('time', { datetime: meta.generated_at, text: generated }) : el('em', { text: 'lokaler Build' }),
    ]),
    el('span', { className: 'status-item' }, ['Commit: ', meta.commit ? el('code', { text: meta.commit }) : el('em', { text: '–' })]),
    statusCount(counts.dags, 'DAGs'),
    statusCount(counts.jobs, 'Jobs'),
    statusCount(counts.edges, 'Kanten'),
    statusCount(counts.warnings, 'Warnungen'),
    meta.emails_masked ? el('span', { className: 'status-item', text: 'E-Mails maskiert' }) : null,
  ];
  append(clear(dom.status), items);
}

function statusCount(value, label) {
  return el('span', { className: 'status-item' }, [el('strong', { text: value ?? '–' }), ` ${label}`]);
}

function renderNotices(notices) {
  if (!notices.length) return;
  const list = dom.notice.querySelector('.notice-list');
  for (const text of notices) list.appendChild(el('li', { text }));
  dom.notice.hidden = false;
  dom.notice.querySelector('[data-dismiss]').addEventListener('click', () => { dom.notice.hidden = true; }, { once: true });
}

function showError(error) {
  const hint = error instanceof GraphLoadError ? error.hint : 'Details stehen in der Browser-Konsole.';
  const message = error instanceof GraphLoadError ? error.message : `Unerwarteter Fehler: ${error.message}`;
  append(clear(dom.error), [
    el('div', { className: 'error-card', role: 'alert' }, [
      el('h2', { text: 'Das Dashboard konnte nicht geladen werden' }),
      el('p', { text: message }),
      hint ? el('p', { className: 'muted', text: hint }) : null,
      el('button', { type: 'button', className: 'button button-primary', onClick: () => location.reload() }, 'Erneut versuchen'),
    ]),
  ]);
  dom.error.hidden = false;
  document.body.classList.add('has-error');
}

// ---------- Permalink ----------

function permalinkFor(id) {
  const url = new URL(location.href);
  url.searchParams.set('job', id);
  return url.toString();
}

function setUrlJob(id) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('job', id);
  else url.searchParams.delete('job');
  if (url.toString() !== location.href) history.replaceState(null, '', url);
}
