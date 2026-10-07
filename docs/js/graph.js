// Aufbau der Cytoscape-Instanz: Elemente, Spalten-Koordinaten und Stylesheet.
// Positionen kommen ausschließlich aus graph.json (preset-Layout) – hier wird nichts gelayoutet.

import { shortLabel, TEAM_ORDER } from './labels.js';

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 52;
const DEFAULT_COLUMN_SPACING = 340;
const DAG_PADDING = 30;

/**
 * Ermittelt die Spalten aus meta.layout.levels.
 * Fehlt eine Ebene komplett (z. B. keine Dummy-Jobs → keine Ebene 0), werden die Spalten
 * lückenlos nebeneinandergesetzt. Das ist eine reine Verschiebung ganzer Spalten;
 * Reihenfolge und vertikale Positionen bleiben exakt wie berechnet.
 */
export function computeColumns(index) {
  const layout = index.meta.layout || {};
  const spacing = layout.column_spacing || DEFAULT_COLUMN_SPACING;
  let levels = Array.isArray(layout.levels) && layout.levels.length
    ? layout.levels.map((level) => ({ ...level }))
    : deriveLevels(index.jobNodes);
  levels = levels.sort((a, b) => a.level - b.level);

  const firstX = levels.length ? levels[0].x : 0;
  return levels.map((level, position) => {
    const displayX = firstX + position * spacing;
    return { ...level, displayX, shift: displayX - level.x, width: spacing };
  });
}

/** Fallback, falls meta.layout.levels fehlt: Ebenen direkt aus den Jobs ableiten. */
function deriveLevels(jobNodes) {
  const byLevel = new Map();
  for (const job of jobNodes) {
    if (!byLevel.has(job.level)) {
      byLevel.set(job.level, { level: job.level, label: job.level_label || `Ebene ${job.level}`, x: job.x, count: 0 });
    }
    byLevel.get(job.level).count += 1;
  }
  return [...byLevel.values()];
}

/** Erzeugt die Cytoscape-Instanz mit festen, nicht verschiebbaren Positionen. */
export function createGraph(container, index, columns, palette) {
  const shiftByLevel = new Map(columns.map((column) => [column.level, column.shift]));
  const elements = [
    ...index.dagNodes.map(toDagElement),
    ...index.jobNodes.map((job) => toJobElement(job, shiftByLevel.get(job.level) || 0)),
    ...index.edges.map(toEdgeElement),
  ];

  return window.cytoscape({
    container,
    elements,
    layout: { name: 'preset', fit: false },
    style: buildStylesheet(palette, index.meta.layout || {}),
    autoungrabify: true,      // Jobs und Rahmen sind nicht verschiebbar
    autounselectify: true,    // Auswahl steuern wir selbst über Klassen
    boxSelectionEnabled: false,
    userPanningEnabled: true,
    userZoomingEnabled: true,
    minZoom: 0.08,
    maxZoom: 2.5,
  });
}

function toDagElement(dag) {
  // Keine position: Cytoscape berechnet die Bounding-Box aus den Kindern.
  return {
    group: 'nodes',
    data: { id: dag.id, label: dag.label || dag.dag_id, kind: 'dag', team: dag.team },
    classes: `dag team-${dag.team}`,
  };
}

function toJobElement(job, shift) {
  return {
    group: 'nodes',
    data: {
      id: job.id,
      parent: job.parent || undefined,
      display: shortLabel(job),
      kind: job.kind,
      team: job.team,
    },
    position: { x: job.x + shift, y: job.y },
    classes: [`kind-${job.kind}`, `team-${job.team}`, job.is_orphan ? 'orphan' : ''].join(' ').trim(),
  };
}

function toEdgeElement(edge) {
  return {
    group: 'edges',
    data: { id: edge.id, source: edge.source, target: edge.target, kind: edge.kind },
    classes: `edge-${edge.kind}`,
  };
}

/** Komplettes Stylesheet; wird beim Theme-Wechsel neu gesetzt. */
export function buildStylesheet(palette, layout) {
  const width = layout.node_width || DEFAULT_NODE_WIDTH;
  const height = layout.node_height || DEFAULT_NODE_HEIGHT;
  return [
    ...baseStyles(palette, width, height),
    ...teamStyles(palette),
    ...kindStyles(palette),
    ...edgeStyles(palette),
    ...stateStyles(palette),
  ];
}

function baseStyles(palette, width, height) {
  return [
    {
      selector: 'node',
      style: {
        width,
        height,
        shape: 'round-rectangle',
        'background-color': palette.nodeBg,
        'border-width': 2,
        'border-color': palette.textMuted,
        label: 'data(display)',
        color: palette.text,
        'font-family': FONT_STACK,
        'font-size': 12.5,
        'font-weight': 500,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': width - 22,
        'line-height': 1.25,
        'min-zoomed-font-size': 5,
        'transition-property': 'opacity, border-color, border-width',
        'transition-duration': 120,
      },
    },
    {
      selector: 'node.dag',
      style: {
        shape: 'round-rectangle',
        'corner-radius': 14,
        'background-color': palette.dagBg,
        'background-opacity': 1,
        'border-width': 1.5,
        padding: DAG_PADDING,
        label: 'data(label)',
        'font-size': 15,
        'font-weight': 600,
        color: palette.textMuted,
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': DAG_PADDING - 6,
        'text-wrap': 'none',
        'compound-sizing-wrt-labels': 'exclude',
        'min-zoomed-font-size': 6,
      },
    },
  ];
}

/** Teamfarbe für Rand/Füllung + Linienstil des DAG-Rahmens als zweites Merkmal. */
function teamStyles(palette) {
  const frameStyle = { shared: 'dashed', epec: 'solid', epep: 'double' };
  return TEAM_ORDER.flatMap((team) => {
    const colors = palette.teams[team];
    return [
      { selector: `node.team-${team}`, style: { 'border-color': colors.line, 'background-color': colors.fill } },
      {
        selector: `node.dag.team-${team}`,
        style: {
          'border-color': colors.line,
          'background-color': palette.dagBg,
          'border-style': frameStyle[team],
          'border-width': team === 'epep' ? 4 : 1.75,
        },
      },
    ];
  });
}

function kindStyles(palette) {
  return [
    { selector: 'node.kind-check_trigger', style: { shape: 'barrel', 'font-weight': 700, 'border-width': 3 } },
    { selector: 'node.kind-check', style: { shape: 'cut-rectangle' } },
    {
      selector: 'node.kind-dummy',
      style: { 'border-style': 'dashed', 'background-color': palette.nodeBg, 'font-style': 'italic' },
    },
    {
      selector: 'node.orphan',
      style: {
        'border-color': palette.warn,
        'border-style': 'dashed',
        'border-width': 3,
        'background-color': palette.warnBg,
      },
    },
  ];
}

function edgeStyles(palette) {
  return [
    {
      selector: 'edge',
      style: {
        width: 1.6,
        'line-color': palette.edge,
        'target-arrow-color': palette.edge,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
        'curve-style': 'taxi',
        'taxi-direction': 'rightward',
        'taxi-turn': '50%',
        'taxi-radius': 10,
        'transition-property': 'opacity, line-color, width',
        'transition-duration': 120,
      },
    },
    {
      selector: 'edge.edge-start',
      style: {
        width: 1.2,
        'line-style': 'dashed',
        'line-dash-pattern': [5, 4],
        'line-color': palette.edgeStart,
        'target-arrow-color': palette.edgeStart,
        'target-arrow-shape': 'vee',
      },
    },
    {
      selector: 'edge.edge-dataset',
      style: {
        width: 4.5,
        'line-color': palette.dataset,
        'target-arrow-color': palette.dataset,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1.3,
        label: 'Dataset',
        'font-family': FONT_STACK,
        'font-size': 10,
        'font-weight': 700,
        color: palette.dataset,
        'text-background-color': palette.canvas,
        'text-background-opacity': 1,
        'text-background-padding': 2,
        'text-background-shape': 'round-rectangle',
        'z-index': 20,
      },
    },
  ];
}

/** Zustände: Filter, Impact-Hervorhebung, Suche, Hover. */
function stateStyles(palette) {
  return [
    { selector: '.filtered-out', style: { display: 'none' } },
    // Rahmen werden über Teil-Opazitäten abgeblendet, da opacity auf die Kinder durchschlagen würde.
    { selector: 'node.faded', style: { opacity: 0.18 } },
    {
      selector: 'node.dag.faded',
      style: { opacity: 1, 'background-opacity': 0.35, 'border-opacity': 0.3, 'text-opacity': 0.35 },
    },
    { selector: 'edge.faded', style: { opacity: 0.08 } },
    {
      selector: 'node.hl-down',
      style: {
        'border-color': palette.down,
        'border-width': 4,
        'underlay-color': palette.down,
        'underlay-opacity': 0.18,
        'underlay-padding': 6,
      },
    },
    {
      selector: 'node.hl-up',
      style: {
        'border-color': palette.up,
        'border-width': 5,
        'border-style': 'double',
        'underlay-color': palette.up,
        'underlay-opacity': 0.18,
        'underlay-padding': 6,
      },
    },
    { selector: 'node.dag.hl-down, node.dag.hl-up', style: { 'border-width': 3 } },
    {
      selector: 'edge.hl-down',
      style: { 'line-color': palette.down, 'target-arrow-color': palette.down, width: 3, 'z-index': 30 },
    },
    {
      selector: 'edge.hl-up',
      style: { 'line-color': palette.up, 'target-arrow-color': palette.up, width: 3, 'z-index': 30 },
    },
    {
      selector: 'node.focus',
      style: {
        'border-color': palette.focus,
        'border-width': 4,
        'border-style': 'solid',
        'underlay-color': palette.glow,
        'underlay-opacity': 0.2,
        'underlay-padding': 9,
        'font-weight': 700,
      },
    },
    {
      selector: 'node.search-hit',
      style: { 'underlay-color': palette.glow, 'underlay-opacity': 0.35, 'underlay-padding': 16, 'underlay-shape': 'round-rectangle' },
    },
    { selector: 'node.hover', style: { 'underlay-color': palette.text, 'underlay-opacity': 0.08, 'underlay-padding': 5 } },
  ];
}
