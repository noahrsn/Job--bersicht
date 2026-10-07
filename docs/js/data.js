// Daten laden, prüfen und für schnelle Abfragen indizieren.
// Dieses Modul kennt weder Cytoscape noch das DOM.

export const SUPPORTED_SCHEMA_VERSION = 1;
export const JOB_KINDS = new Set(['job', 'dummy', 'check', 'check_trigger']);

/** Fehler beim Laden, deren Text direkt in der UI angezeigt werden kann. */
export class GraphLoadError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'GraphLoadError';
    this.hint = hint;
  }
}

/** Lädt graph.json per fetch und prüft die Grundstruktur. */
export async function loadGraph(url) {
  let response;
  try {
    response = await fetch(url, { cache: 'no-cache' });
  } catch (error) {
    throw new GraphLoadError(
      `Die Datei ${url} konnte nicht geladen werden (${error.message}).`,
      location.protocol === 'file:'
        ? 'Die Seite wurde direkt als Datei geöffnet. Bitte über einen Webserver starten, z. B. „cd docs && python -m http.server 8000“.'
        : 'Bitte Netzwerkverbindung prüfen und die Seite neu laden.'
    );
  }
  if (!response.ok) {
    throw new GraphLoadError(
      `Die Datei ${url} ist nicht verfügbar (HTTP ${response.status}).`,
      'Wurde die Datenpipeline ausgeführt und docs/data/graph.json erzeugt?'
    );
  }
  let graph;
  try {
    graph = await response.json();
  } catch (error) {
    throw new GraphLoadError(
      `Die Datei ${url} enthält kein gültiges JSON (${error.message}).`,
      'Die Datei ist vermutlich beschädigt oder unvollständig – bitte neu generieren.'
    );
  }
  assertShape(graph);
  return graph;
}

/** Prüft, ob die Pflichtbereiche vorhanden sind. Wirft bei unbrauchbaren Daten. */
function assertShape(graph) {
  const missing = [];
  if (!graph || typeof graph !== 'object') missing.push('Wurzelobjekt');
  else {
    if (!graph.meta || typeof graph.meta !== 'object') missing.push('meta');
    if (!Array.isArray(graph.nodes)) missing.push('nodes');
    if (!Array.isArray(graph.edges)) missing.push('edges');
  }
  if (missing.length) {
    throw new GraphLoadError(
      `graph.json hat nicht das erwartete Format – es fehlt: ${missing.join(', ')}.`,
      'Bitte prüfen, ob die Datei von der aktuellen Pipeline-Version erzeugt wurde.'
    );
  }
}

/**
 * Baut alle Nachschlage-Strukturen auf.
 * Gibt zusätzlich `notices` zurück: nicht-fatale Datenprobleme für einen Hinweis-Banner.
 */
export function buildIndex(graph) {
  const notices = [];
  const meta = graph.meta;
  if (meta.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    notices.push(
      `graph.json meldet schema_version ${JSON.stringify(meta.schema_version)}, diese Seite ist für Version ${SUPPORTED_SCHEMA_VERSION} gebaut. Die Darstellung kann unvollständig sein.`
    );
  }

  const nodesById = new Map();
  const dagNodes = [];
  const jobNodes = [];
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string') continue;
    nodesById.set(node.id, node);
    if (node.kind === 'dag') dagNodes.push(node);
    else jobNodes.push(node);
  }

  const dagsById = new Map((graph.dags || []).map((dag) => [dag.dag_id, dag]));
  const childrenByDag = groupChildren(jobNodes, nodesById, notices);

  const { edges, edgesById, outgoing, incoming, skipped } = indexEdges(graph.edges, nodesById);
  if (skipped.length) {
    notices.push(`${skipped.length} Kante(n) verweisen auf unbekannte Nodes und werden nicht angezeigt.`);
    console.warn('Übersprungene Kanten:', skipped);
  }

  const flow = buildFlowAdjacency(edges, nodesById, childrenByDag);

  return {
    meta,
    nodesById,
    dagNodes,
    jobNodes,
    dagsById,
    childrenByDag,
    edges,
    edgesById,
    outgoing,
    incoming,
    flow,
    warnings: Array.isArray(graph.warnings) ? graph.warnings : [],
    notices,
  };
}

/** Ordnet Jobs ihrem DAG-Rahmen zu; Jobs mit unbekanntem Parent werden freigestellt. */
function groupChildren(jobNodes, nodesById, notices) {
  const childrenByDag = new Map();
  let orphanedParents = 0;
  for (const job of jobNodes) {
    if (!job.parent) continue;
    if (!nodesById.has(job.parent)) {
      orphanedParents += 1;
      job.parent = null;
      continue;
    }
    if (!childrenByDag.has(job.parent)) childrenByDag.set(job.parent, []);
    childrenByDag.get(job.parent).push(job);
  }
  if (orphanedParents) {
    notices.push(`${orphanedParents} Job(s) verweisen auf einen unbekannten DAG-Rahmen und werden ohne Rahmen angezeigt.`);
  }
  return childrenByDag;
}

/** Indiziert Kanten in beide Richtungen. Kanten mit unbekannten Endpunkten werden aussortiert. */
function indexEdges(rawEdges, nodesById) {
  const edges = [];
  const edgesById = new Map();
  const outgoing = new Map();
  const incoming = new Map();
  const skipped = [];
  for (const edge of rawEdges) {
    if (!edge || !nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      skipped.push(edge);
      continue;
    }
    const id = edge.id || `${edge.source}->${edge.target}`;
    const normalized = { ...edge, id };
    edges.push(normalized);
    edgesById.set(id, normalized);
    pushTo(outgoing, edge.source, normalized);
    pushTo(incoming, edge.target, normalized);
  }
  return { edges, edgesById, outgoing, incoming, skipped };
}

/**
 * Adjazenz für die Impact-Analyse.
 * Zeigt eine Kante auf einen DAG-Rahmen (statt auf einen Job), läuft der Fluss
 * weiter zu den Einstiegs-Jobs dieses DAGs (is_root bzw. alle Kinder als Fallback).
 */
function buildFlowAdjacency(edges, nodesById, childrenByDag) {
  const down = new Map();
  const up = new Map();
  const link = (from, to, edgeId) => {
    pushTo(down, from, { id: to, edgeId });
    pushTo(up, to, { id: from, edgeId });
  };
  for (const edge of edges) link(edge.source, edge.target, edge.id);

  for (const dagNode of nodesById.values()) {
    if (dagNode.kind !== 'dag' || !up.has(dagNode.id)) continue;
    const children = childrenByDag.get(dagNode.id) || [];
    const entries = children.filter((child) => child.is_root);
    for (const child of entries.length ? entries : children) link(dagNode.id, child.id, null);
  }
  return { down, up };
}

/**
 * Sammelt alle transitiv erreichbaren Nodes und Kanten in eine Richtung.
 * direction: 'down' (Nachfolger) oder 'up' (Vorgänger).
 */
export function traverse(index, startId, direction) {
  const adjacency = index.flow[direction];
  const nodeIds = new Set();
  const edgeIds = new Set();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const step of adjacency.get(current) || []) {
      if (step.edgeId) edgeIds.add(step.edgeId);
      if (step.id === startId || nodeIds.has(step.id)) continue;
      nodeIds.add(step.id);
      queue.push(step.id);
    }
  }
  return { nodeIds, edgeIds };
}

/** Zählt nur echte Jobs (keine DAG-Rahmen) in einer Node-Menge. */
export function countJobs(index, nodeIds) {
  let count = 0;
  for (const id of nodeIds) if (JOB_KINDS.has(index.nodesById.get(id)?.kind)) count += 1;
  return count;
}

/** Alle Alert-Empfänger (Job- und DAG-Ebene), sortiert und eindeutig. */
export function collectEmails(index) {
  const emails = new Set();
  for (const job of index.jobNodes) for (const mail of job.fail_email_to || []) emails.add(mail);
  for (const dag of index.dagsById.values()) for (const mail of dag.fail_email_to || []) emails.add(mail);
  return [...emails].sort((a, b) => a.localeCompare(b, 'de'));
}

/** Liefert alle für einen Job relevanten Empfänger: eigene plus die des DAGs. */
export function emailsForJob(index, job) {
  const dag = index.dagsById.get(job.dag_id);
  return new Set([...(job.fail_email_to || []), ...(dag?.fail_email_to || [])]);
}

function pushTo(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}
