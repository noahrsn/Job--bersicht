// Inhalt des Detail-Popups: Job-Daten, DAG-Daten und klickbare Beziehungen.

import { el, copyText } from './dom.js';
import { describeCron } from './cron.js';
import { countJobs, traverse } from './data.js';
import {
  EDGE_KIND_NAMES, SIZE_NAMES, TEAM_GLYPHS, kindName, teamName,
} from './labels.js';

/**
 * ctx: { index, isVisible(id), onNavigate(id), permalinkFor(id) }
 */
export function renderJobDetails(job, ctx) {
  const dag = ctx.index.dagsById.get(job.dag_id);
  return el('article', { className: 'details' }, [
    renderHeader(job, ctx),
    renderImpactSummary(job, ctx),
    el('div', { className: 'details-grid' }, [
      renderJobSection(job, ctx),
      renderDagSection(job, dag, ctx),
    ]),
    renderRelations(job, ctx),
  ]);
}

function renderHeader(job, ctx) {
  const copyButton = el('button', {
    type: 'button',
    className: 'button button-ghost button-small',
    onClick: async () => {
      const ok = await copyText(ctx.permalinkFor(job.id));
      copyButton.textContent = ok ? 'Link kopiert ✓' : 'Kopieren fehlgeschlagen';
      setTimeout(() => { copyButton.textContent = 'Permalink kopieren'; }, 1800);
    },
  }, 'Permalink kopieren');

  return el('header', { className: 'details-header' }, [
    el('div', { className: 'badges' }, [
      teamBadge(job.team),
      el('span', { className: `badge badge-kind kind-${job.kind}`, text: kindName(job.kind) }),
      el('span', { className: 'badge badge-level', text: job.level_label || `Ebene ${job.level}` }),
      job.is_orphan ? el('span', { className: 'badge badge-warn', text: '⚠ Isoliert' }) : null,
      job.is_root ? el('span', { className: 'badge badge-muted', text: 'Einstieg' }) : null,
      job.is_leaf ? el('span', { className: 'badge badge-muted', text: 'Endpunkt' }) : null,
    ]),
    el('h2', { id: 'details-title', className: 'details-title', tabindex: '-1', 'data-autofocus': true }, breakable(job.label)),
    el('div', { className: 'details-actions' }, [copyButton]),
  ]);
}

function renderImpactSummary(job, ctx) {
  const downstream = countJobs(ctx.index, traverse(ctx.index, job.id, 'down').nodeIds);
  const upstream = countJobs(ctx.index, traverse(ctx.index, job.id, 'up').nodeIds);
  return el('div', { className: 'impact-summary' }, [
    el('div', { className: 'impact-stat impact-stat-down' }, [
      el('strong', { text: String(downstream) }),
      el('span', { text: downstream === 1 ? 'nachgelagerter Job betroffen, wenn dieser fällt' : 'nachgelagerte Jobs betroffen, wenn dieser fällt' }),
    ]),
    el('div', { className: 'impact-stat impact-stat-up' }, [
      el('strong', { text: String(upstream) }),
      el('span', { text: upstream === 1 ? 'vorgelagerter Job liefert Daten' : 'vorgelagerte Jobs liefern Daten' }),
    ]),
  ]);
}

function renderJobSection(job, ctx) {
  return section('Job', [
    field('Beschreibung', job.description ? el('p', { className: 'prose', text: job.description }) : empty('Keine Beschreibung')),
    field('Größe', job.size ? el('span', { className: `size-pill size-${job.size}`, text: SIZE_NAMES[job.size] || job.size }) : empty('–')),
    field('Alert-Empfänger', emailList(job.fail_email_to, ctx.index.meta.emails_masked, 'Keine eigenen (siehe DAG)')),
    field('Quellpfad', codeWithCopy(job.source_path)),
  ]);
}

function renderDagSection(job, dag, ctx) {
  if (!dag) {
    return section('DAG', [
      field('DAG-ID', el('code', { text: job.dag_id || '–' })),
      el('p', { className: 'muted', text: 'Für diesen DAG liegen keine Metadaten in graph.json vor.' }),
    ]);
  }
  return section('DAG', [
    field('DAG-ID', el('code', { className: 'breakable', text: dag.dag_id })),
    field('Tags', dag.tags?.length ? chipList(dag.tags) : empty('Keine')),
    field('Auslöser', triggerDescription(dag)),
    dag.trigger_type === 'dataset' || dag.dataset_refs?.length
      ? field('Datasets', dag.dataset_refs?.length ? chipList(dag.dataset_refs, 'chip-dataset') : empty('Keine'))
      : null,
    field('Zeitzone', dag.timezone || empty('–')),
    field('Retries', dag.retries ?? empty('–')),
    field('Retry-Verzögerung', dag.retry_delay != null ? `${dag.retry_delay} Minuten` : empty('–')),
    field('DAG-Run-Timeout', dag.dagrun_timeout != null ? `${dag.dagrun_timeout} Stunden` : empty('–')),
    field('Alert-Empfänger', emailList(dag.fail_email_to, ctx.index.meta.emails_masked, 'Keine')),
    field('Konfiguration', codeWithCopy(dag.source_path)),
  ]);
}

/** Zeitplan in Klartext plus Rohwert und Zeitzone bzw. Dataset-Trigger. */
function triggerDescription(dag) {
  if (dag.trigger_type === 'dataset') {
    return el('div', { className: 'trigger' }, [
      el('span', { className: 'trigger-main', text: 'Dataset-Trigger' }),
      el('span', { className: 'muted', text: 'Startet, sobald die unten genannten Checks erfolgreich waren.' }),
    ]);
  }
  if (!dag.schedule) return el('span', { className: 'trigger-main', text: 'Kein Zeitplan (nur manuell)' });
  const plain = describeCron(dag.schedule);
  return el('div', { className: 'trigger' }, [
    el('span', { className: 'trigger-main', text: plain ? capitalize(plain) : 'Zeitplan' }),
    el('span', { className: 'muted' }, [
      el('code', { text: dag.schedule }),
      dag.timezone ? ` · Zeitzone ${dag.timezone}` : '',
    ]),
  ]);
}

function renderRelations(job, ctx) {
  const predecessors = (ctx.index.incoming.get(job.id) || []).map((edge) => ({ edge, id: edge.source }));
  const successors = (ctx.index.outgoing.get(job.id) || []).map((edge) => ({ edge, id: edge.target }));
  // Dataset-Kanten auf den DAG-Rahmen sind für Einstiegs-Jobs ebenfalls direkte Vorgänger.
  if (job.parent && job.is_root) {
    for (const edge of ctx.index.incoming.get(job.parent) || []) predecessors.push({ edge, id: edge.source });
  }
  return section('Beziehungen', [
    el('div', { className: 'relations' }, [
      relationColumn('Vorgänger', 'up', predecessors, ctx),
      relationColumn('Nachfolger', 'down', successors, ctx),
    ]),
  ], 'details-section-wide', false);
}

function relationColumn(title, direction, relations, ctx) {
  return el('div', { className: `relation-column relation-${direction}` }, [
    el('h4', { className: 'relation-title' }, [title, el('span', { className: 'count', text: String(relations.length) })]),
    relations.length
      ? el('ul', { className: 'relation-list' }, relations.map(({ edge, id }) => relationItem(edge, id, ctx)))
      : empty(direction === 'up' ? 'Keine – Einstiegspunkt' : 'Keine – Endpunkt'),
  ]);
}

function relationItem(edge, id, ctx) {
  const node = ctx.index.nodesById.get(id);
  const hidden = !ctx.isVisible(id);
  const target = node?.kind === 'dag' ? node.dag_id : node?.label || id;
  return el('li', {}, [
    el('button', {
      type: 'button',
      className: 'relation-link',
      title: `${target}${hidden ? ' (aktuell ausgeblendet – wird beim Anspringen eingeblendet)' : ''}`,
      onClick: () => ctx.onNavigate(id),
    }, [
      el('span', { className: `team-glyph team-${node?.team}`, 'aria-hidden': 'true', text: TEAM_GLYPHS[node?.team] || '' }),
      el('span', { className: 'relation-name' }, breakable(node?.kind === 'dag' ? `DAG ${target}` : target)),
      el('span', { className: `edge-pill edge-pill-${edge.kind}`, text: EDGE_KIND_NAMES[edge.kind] || edge.kind }),
      hidden ? el('span', { className: 'badge badge-muted', text: 'ausgeblendet' }) : null,
    ]),
    el('span', { className: 'relation-dag', text: node?.dag_id && node.kind !== 'dag' ? node.dag_id : '' }),
  ]);
}

// ---------- kleine Bausteine ----------

function section(title, children, extraClass = '', asFieldList = true) {
  return el('section', { className: `details-section ${extraClass}`.trim() }, [
    el('h3', { className: 'details-section-title', text: title }),
    asFieldList ? el('dl', { className: 'fields' }, children) : children,
  ]);
}

function field(label, value) {
  return el('div', { className: 'field' }, [el('dt', { text: label }), el('dd', {}, [value])]);
}

function empty(text) {
  return el('span', { className: 'muted', text });
}

function teamBadge(team) {
  return el('span', { className: `badge badge-team team-${team}` }, [
    el('span', { 'aria-hidden': 'true', text: TEAM_GLYPHS[team] || '' }),
    teamName(team),
  ]);
}

function chipList(values, extraClass = '') {
  return el('ul', { className: 'chips' }, values.map((value) => el('li', { className: `chip ${extraClass}`.trim(), text: value })));
}

function emailList(emails, masked, emptyText) {
  if (!emails?.length) return empty(emptyText);
  return el('ul', { className: 'email-list' }, emails.map((mail) => el('li', {}, [
    masked ? el('span', { text: mail }) : el('a', { href: `mailto:${mail}`, text: mail }),
  ])));
}

function codeWithCopy(text) {
  if (!text) return empty('–');
  const button = el('button', {
    type: 'button',
    className: 'icon-button',
    'aria-label': 'Pfad kopieren',
    title: 'Pfad kopieren',
    onClick: async () => {
      const ok = await copyText(text);
      button.textContent = ok ? '✓' : '!';
      setTimeout(() => { button.textContent = '⧉'; }, 1500);
    },
  }, '⧉');
  return el('span', { className: 'code-copy' }, [el('code', { className: 'breakable', text }), button]);
}

/** Erlaubt Zeilenumbrüche nach „_“ in langen Bezeichnern. */
function breakable(text) {
  const parts = String(text ?? '').split('_');
  return parts.flatMap((part, i) => (i < parts.length - 1 ? [part, '_', el('wbr')] : [part]));
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
