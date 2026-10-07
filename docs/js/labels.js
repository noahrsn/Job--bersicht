// Texte und Bezeichnungen für Nodes, Teams und Kanten.

export const TEAM_ORDER = ['shared', 'epec', 'epep'];

/** Zweites Unterscheidungsmerkmal neben der Farbe: ein Symbol pro Team. */
export const TEAM_GLYPHS = { shared: '◆', epec: '●', epep: '▲' };

export const TEAM_NAMES = {
  shared: 'Shared (Checks)',
  epec: 'EPEC',
  epep: 'EPEP',
};

export const KIND_NAMES = {
  dag: 'DAG',
  check_trigger: 'Check-Trigger',
  check: 'Check',
  dummy: 'Dummy-Startjob',
  job: 'Job',
};

export const EDGE_KIND_NAMES = {
  job_wait: 'Abhängigkeit',
  start: 'Start',
  dataset: 'Dataset-Trigger',
};

export const SIZE_NAMES = { small: 'Klein', medium: 'Mittel', large: 'Groß' };

export const WARNING_TYPE_NAMES = {
  config_error: 'Konfigurationsfehler',
  unresolved_job_wait: 'Unaufgelöstes job_wait',
  unresolved_dataset: 'Unaufgelöstes Dataset',
  orphan_job: 'Isolierter Job',
  cycle: 'Zyklus',
};

const MAX_LABEL_CHARS = 50;
const TEAM_PREFIX = /^(EPEC|EPEP|SHARED)_/i;
const ZERO_WIDTH_SPACE = '\u200b';

/**
 * Kurzlabel für die Darstellung im 240 px breiten Node.
 * Das Team-Präfix steckt bereits im Symbol und in der Farbe, „CHECK_“ in der Form –
 * beides wird weggelassen. Nach jedem „_“ darf Cytoscape umbrechen.
 */
export function shortLabel(node) {
  let name = node.job_name || node.label || node.id;
  name = name.replace(TEAM_PREFIX, '');
  if (node.kind === 'check') name = name.replace(/^CHECK_/i, '');
  if (name.length > MAX_LABEL_CHARS) name = `${name.slice(0, MAX_LABEL_CHARS - 1)}…`;
  const glyph = TEAM_GLYPHS[node.team] || '';
  const warn = node.is_orphan ? '⚠ ' : '';
  return `${warn}${glyph} ${name.replaceAll('_', `_${ZERO_WIDTH_SPACE}`)}`.trim();
}

export function teamName(team) {
  return TEAM_NAMES[team] || team || 'unbekannt';
}

export function kindName(kind) {
  return KIND_NAMES[kind] || kind || 'unbekannt';
}
