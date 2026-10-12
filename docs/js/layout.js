// Anordnung der Jobs und DAG-Rahmen im Ebenen-Raster.
//
// Die x-Position (Spalte) ergibt sich weiterhin allein aus dem `level` eines Jobs.
// Die y-Positionen werden hier neu bestimmt, damit
//   1. Kanten, die eine Ebene überspringen, nie durch einen Job laufen,
//   2. DAGs freien Platz neben anderen DAGs nutzen statt pauschal darunter zu landen,
//   3. abhängige DAGs möglichst auf Höhe ihres Auslösers stehen (gerade Pfeile),
//   4. senkrechte Kantenabschnitte in der Lücke zwischen zwei Spalten verlaufen,
//      jede Quelle auf einer eigenen „Spur“, damit sich Linien nicht überlagern.
//
// Routing-Regel (passt zu Cytoscapes taxi-Kanten): Eine Kante verlässt die Quelle nach rechts,
// knickt in der Lücke direkt hinter der Quell-Spalte senkrecht ab und läuft auf Höhe des Ziels
// waagerecht weiter. Die Spalten zwischen Quelle und Ziel müssen auf Ziel-Höhe deshalb frei sein –
// diese „Korridore“ reserviert das Layout.
//
// Das Ergebnis ist deterministisch und wird einmal beim Laden berechnet; Filtern ändert nichts daran.

const BLOCK_GAP = 28;          // Mindestabstand zwischen zwei DAG-Rahmen
const CORRIDOR_HALF = 3;       // Halbe „Dicke“ eines reservierten Kantenkorridors
const CORRIDOR_CLEARANCE = 14; // Abstand eines Korridors zu Rahmen und anderen Korridoren
const TRACK_MARGIN = 14;       // Abstand der äußersten Spur zum Node-Rand
const TRACK_SPACING = 14;      // Bevorzugter Abstand zwischen zwei Spuren
const MIN_TRACK_SPACING = 6;
const FRAME_CROSSING_PENALTY = 1000; // „Kosten“ in px, wenn ein senkrechter Kantenabschnitt durch einen fremden Rahmen läuft

/**
 * @param index   Ergebnis von buildIndex()
 * @param columns Ergebnis von computeColumns() (sortiert, mit displayX)
 * @param dims    { nodeWidth, nodeHeight, rowSpacing, columnSpacing, framePadding }
 * @returns { positions: Map<jobId,{x,y}>, edgeTurns: Map<edgeId, number> }
 */
export function computeLayout(index, columns, dims) {
  const columnOfLevel = new Map(columns.map((column, position) => [column.level, position]));
  const colOf = (job) => columnOfLevel.get(job.level) ?? 0;
  const layoutTarget = buildLayoutTargetResolver(index);

  const blocks = buildBlocks(index, colOf, layoutTarget, dims);
  const crossEdges = collectCrossEdges(index, blocks, layoutTarget);
  const order = orderBlocks(blocks, crossEdges);
  const jobY = placeBlocks(order, crossEdges, blocks, colOf, dims);

  const positions = new Map();
  for (const job of index.jobNodes) {
    positions.set(job.id, { x: columns[colOf(job)].displayX, y: jobY.get(job.id) });
  }
  const edgeTurns = assignTracks(index, positions, colOf, dims);
  return { positions, edgeTurns };
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/** Kanten auf einen DAG-Rahmen (statt einen Job) zählen fürs Layout als Kante auf dessen Einstiegs-Job. */
function buildLayoutTargetResolver(index) {
  return (nodeId) => {
    const node = index.nodesById.get(nodeId);
    if (!node) return null;
    if (node.kind !== 'dag') return node;
    const children = index.childrenByDag.get(nodeId) || [];
    return children.find((child) => child.is_root) || children[0] || null;
  };
}

function blockIdOf(job) {
  return job.parent || `solo::${job.id}`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function overlaps(a1, b1, a2, b2, gap) {
  return a1 < b2 + gap && a2 < b1 + gap;
}

/** Belegte Intervalle je Spalte (Rahmen und Korridore). */
class ColumnOccupancy {
  constructor() { this.byColumn = new Map(); }

  list(col) { return this.byColumn.get(col) || []; }

  add(col, from, to, kind) {
    if (!this.byColumn.has(col)) this.byColumn.set(col, []);
    this.byColumn.get(col).push({ from, to, kind });
  }

  isFree(col, from, to, kind) {
    return this.list(col).every((interval) => {
      const gap = kind === 'frame' && interval.kind === 'frame' ? BLOCK_GAP : CORRIDOR_CLEARANCE;
      return !overlaps(from, to, interval.from, interval.to, gap);
    });
  }

  bottom() {
    let max = 0;
    for (const intervals of this.byColumn.values()) for (const interval of intervals) max = Math.max(max, interval.to);
    return max;
  }
}

// ---------------------------------------------------------------------------
// Schritt 1: Zeilen innerhalb eines DAGs
// ---------------------------------------------------------------------------

/**
 * Jeder DAG wird zu einem Block mit relativen Zeilen.
 * Spalte für Spalte (links → rechts) bekommt jeder Job die Zeile, die dem Median seiner
 * Vorgänger am nächsten liegt und deren Korridor durch übersprungene Spalten frei ist.
 */
function buildBlocks(index, colOf, layoutTarget, dims) {
  const jobsByBlock = new Map();
  for (const job of index.jobNodes) {
    const id = blockIdOf(job);
    if (!jobsByBlock.has(id)) jobsByBlock.set(id, []);
    jobsByBlock.get(id).push(job);
  }

  const blocks = new Map();
  for (const [id, jobs] of jobsByBlock) {
    blocks.set(id, layoutBlock(id, jobs, index, colOf, layoutTarget, dims));
  }
  return blocks;
}

function layoutBlock(id, jobs, index, colOf, layoutTarget, dims) {
  const memberIds = new Set(jobs.map((job) => job.id));
  const minCol = Math.min(...jobs.map(colOf));
  const maxCol = Math.max(...jobs.map(colOf));
  const occupied = new Map(); // Spalte -> Set(Zeilen)
  const isFree = (col, row) => !occupied.get(col)?.has(row);
  const occupy = (col, row) => {
    if (!occupied.has(col)) occupied.set(col, new Set());
    occupied.get(col).add(row);
  };
  const rowOf = new Map();

  // Vorgänger (auch aus anderen DAGs; Kanten auf Rahmen zählen für den Einstiegs-Job)
  const predecessorsOf = (job) => {
    const result = [];
    for (const edge of index.incoming.get(job.id) || []) {
      const source = index.nodesById.get(edge.source);
      if (source && source.kind !== 'dag') result.push(source);
    }
    for (const edge of index.incoming.get(job.parent) || []) {
      if (layoutTarget(job.parent)?.id !== job.id) continue;
      const source = index.nodesById.get(edge.source);
      if (source && source.kind !== 'dag') result.push(source);
    }
    return result;
  };

  const columnsInBlock = [...new Set(jobs.map(colOf))].sort((a, b) => a - b);
  for (const col of columnsInBlock) {
    const prepared = jobs.filter((job) => colOf(job) === col).map((job) => {
      const preds = predecessorsOf(job);
      const internalRows = preds.filter((pred) => memberIds.has(pred.id) && rowOf.has(pred.id)).map((pred) => rowOf.get(pred.id));
      return { job, preds, preferred: internalRows.length ? median(internalRows) : null };
    });
    // Jobs mit Vorgängern im DAG zuerst und nach deren Lage; Jobs ohne Vorgänger (Einstiege, isolierte Jobs)
    // füllen danach die freien Zeilen in der Reihenfolge der Pipeline.
    prepared.sort((a, b) => (a.preferred ?? Infinity) - (b.preferred ?? Infinity) || a.job.y - b.job.y || a.job.id.localeCompare(b.job.id));

    for (const { job, preds, preferred } of prepared) {
      const corridorColumns = new Set();
      for (const pred of preds) {
        for (let c = Math.max(colOf(pred) + 1, minCol); c < col; c += 1) corridorColumns.add(c);
      }
      const fits = (row) => isFree(col, row) && [...corridorColumns].every((c) => isFree(c, row));
      const row = findRow(preferred ?? 0, fits);
      occupy(col, row);
      for (const c of corridorColumns) occupy(c, row);
      rowOf.set(job.id, row);
    }
  }

  let rowCount = 1;
  for (const rows of occupied.values()) for (const row of rows) rowCount = Math.max(rowCount, row + 1);

  const offsetOf = new Map();
  for (const [jobId, row] of rowOf) {
    offsetOf.set(jobId, dims.framePadding + row * dims.rowSpacing + dims.nodeHeight / 2);
  }
  const height = 2 * dims.framePadding + (rowCount - 1) * dims.rowSpacing + dims.nodeHeight;
  const sortKey = Math.min(...jobs.map((job) => job.y ?? 0));
  const isCheckBlock = jobs.some((job) => job.kind === 'check' || job.kind === 'check_trigger');
  return { id, jobs, memberIds, minCol, maxCol, offsetOf, height, sortKey, isCheckBlock };
}

/** Nächstgelegene freie Zeile ab `preferred` (erst nach unten, dann nach oben). */
function findRow(preferred, fits) {
  for (let distance = 0; distance < 10000; distance += 1) {
    if (fits(preferred + distance)) return preferred + distance;
    if (distance > 0 && preferred - distance >= 0 && fits(preferred - distance)) return preferred - distance;
  }
  return preferred;
}

// ---------------------------------------------------------------------------
// Schritt 2: DAG-Blöcke packen
// ---------------------------------------------------------------------------

function collectCrossEdges(index, blocks, layoutTarget) {
  const blockOfJob = new Map();
  for (const block of blocks.values()) for (const job of block.jobs) blockOfJob.set(job.id, block.id);

  const result = [];
  for (const edge of index.edges) {
    const source = index.nodesById.get(edge.source);
    const target = layoutTarget(edge.target);
    if (!source || source.kind === 'dag' || !target) continue;
    const from = blockOfJob.get(source.id);
    const to = blockOfJob.get(target.id);
    if (from && to && from !== to) result.push({ source, target, from, to });
  }
  return result;
}

/**
 * Topologische Reihenfolge der DAGs: Auslöser vor abhängigen DAGs.
 * Unter den platzierbaren DAGs zuerst Check-DAGs, dann DAGs mit Auslöser (sie haben eine Wunschhöhe),
 * dann DAGs, die andere auslösen, zuletzt unverbundene DAGs – die füllen verbleibende Lücken.
 * Innerhalb einer Gruppe gilt die Reihenfolge der Pipeline. Zyklen werden aufgebrochen.
 */
function orderBlocks(blocks, crossEdges) {
  const indegree = new Map([...blocks.keys()].map((id) => [id, 0]));
  const successors = new Map([...blocks.keys()].map((id) => [id, new Set()]));
  const hasIncoming = new Set();
  for (const { from, to } of crossEdges) {
    hasIncoming.add(to);
    if (successors.get(from).has(to)) continue;
    successors.get(from).add(to);
    indegree.set(to, indegree.get(to) + 1);
  }
  const rank = (block) => {
    if (block.isCheckBlock) return 0;
    if (hasIncoming.has(block.id)) return 1;
    if (successors.get(block.id).size) return 2;
    return 3;
  };
  const priority = (a, b) => rank(a) - rank(b) || a.sortKey - b.sortKey || a.id.localeCompare(b.id);

  const order = [];
  const done = new Set();
  while (order.length < blocks.size) {
    const remaining = [...blocks.values()].filter((block) => !done.has(block.id));
    const ready = remaining.filter((block) => indegree.get(block.id) === 0);
    const next = (ready.length ? ready : remaining).sort(priority)[0];
    order.push(next);
    done.add(next.id);
    for (const succ of successors.get(next.id)) indegree.set(succ, indegree.get(succ) - 1);
  }
  return order;
}

/**
 * Setzt jeden Block an die gültige Position, die seiner Wunschhöhe am nächsten liegt.
 * Wunschhöhe: Ziel-Job auf Höhe des auslösenden Jobs (Median über alle eingehenden Kanten).
 */
function placeBlocks(order, crossEdges, blocks, colOf, dims) {
  const occupancy = new ColumnOccupancy();
  const jobY = new Map();
  const placed = []; // { id, minCol, maxCol, top, bottom }
  const blockOfJob = new Map();
  for (const block of blocks.values()) for (const job of block.jobs) blockOfJob.set(job.id, block.id);

  /** Anzahl fremder Rahmen, die die Lücke hinter Spalte `col` zwischen y1 und y2 überdecken. */
  const framesCrossed = (col, y1, y2, ownIds) => placed.filter((frame) => !ownIds.has(frame.id)
    && frame.minCol <= col && frame.maxCol >= col + 1
    && overlaps(Math.min(y1, y2), Math.max(y1, y2), frame.top, frame.bottom, 0)).length;

  for (const block of order) {
    const incoming = crossEdges.filter((edge) => edge.to === block.id && jobY.has(edge.source.id));
    const corridors = incoming
      .map((edge) => ({
        offset: block.offsetOf.get(edge.target.id),
        columns: range(colOf(edge.source) + 1, block.minCol - 1),
      }))
      .filter((corridor) => corridor.columns.length);
    const desired = incoming.length
      ? Math.max(0, median(incoming.map((edge) => jobY.get(edge.source.id) - block.offsetOf.get(edge.target.id))))
      : 0;

    const blockColumns = range(block.minCol, block.maxCol);
    const isValid = (top) => top >= 0
      && blockColumns.every((col) => occupancy.isFree(col, top, top + block.height, 'frame'))
      && corridors.every(({ offset, columns }) => columns.every((col) => occupancy.isFree(col, top + offset - CORRIDOR_HALF, top + offset + CORRIDOR_HALF, 'corridor')));

    // Kosten: Abstand zur Wunschhöhe plus Strafe für senkrechte Kantenabschnitte durch fremde Rahmen.
    const cost = (top) => Math.abs(top - desired) + FRAME_CROSSING_PENALTY * incoming.reduce((sum, edge) => {
      const own = new Set([block.id, blockOfJob.get(edge.source.id)]);
      return sum + framesCrossed(colOf(edge.source), jobY.get(edge.source.id), top + block.offsetOf.get(edge.target.id), own);
    }, 0);
    const candidates = [...candidateTops(block, blockColumns, corridors, occupancy, desired), occupancy.bottom() + BLOCK_GAP + 1];
    const top = bestCandidate(candidates, cost, isValid) ?? occupancy.bottom() + BLOCK_GAP;

    for (const col of blockColumns) occupancy.add(col, top, top + block.height, 'frame');
    for (const { offset, columns } of corridors) {
      for (const col of columns) occupancy.add(col, top + offset - CORRIDOR_HALF, top + offset + CORRIDOR_HALF, 'corridor');
    }
    for (const job of block.jobs) jobY.set(job.id, top + block.offsetOf.get(job.id));
    placed.push({ id: block.id, minCol: block.minCol, maxCol: block.maxCol, top, bottom: top + block.height });
  }
  return jobY;
}

/** Kandidaten: Wunschhöhe, oberer Rand und jede Position direkt über/unter einem belegten Intervall. */
function candidateTops(block, blockColumns, corridors, occupancy, desired) {
  const candidates = [desired, 0];
  for (const col of blockColumns) {
    for (const interval of occupancy.list(col)) {
      const gap = interval.kind === 'frame' ? BLOCK_GAP : CORRIDOR_CLEARANCE;
      candidates.push(interval.to + gap + 1, interval.from - gap - block.height - 1);
    }
  }
  for (const { offset, columns } of corridors) {
    for (const col of columns) {
      for (const interval of occupancy.list(col)) {
        candidates.push(interval.to + CORRIDOR_CLEARANCE + CORRIDOR_HALF + 1 - offset);
        candidates.push(interval.from - CORRIDOR_CLEARANCE - CORRIDOR_HALF - 1 - offset);
      }
    }
  }
  return candidates;
}

function bestCandidate(candidates, cost, isValid) {
  let best = null;
  let bestCost = Infinity;
  for (const candidate of candidates) {
    const top = Math.round(candidate);
    if (!isValid(top)) continue;
    const value = cost(top);
    if (value < bestCost || (value === bestCost && top < best)) {
      best = top;
      bestCost = value;
    }
  }
  return best;
}

function range(from, to) {
  const result = [];
  for (let value = from; value <= to; value += 1) result.push(value);
  return result;
}

// ---------------------------------------------------------------------------
// Schritt 3: Spuren in den Lücken zwischen den Spalten
// ---------------------------------------------------------------------------

/**
 * Alle Kanten einer Quelle teilen sich eine senkrechte Spur (Kamm), verschiedene Quellen
 * mit überlappendem senkrechtem Bereich bekommen verschiedene Spuren.
 * Rückgabe: Abstand des Knicks vom rechten Rand der Quelle (taxi-turn in px).
 */
function assignTracks(index, positions, colOf, dims) {
  const gutterWidth = dims.columnSpacing - dims.nodeWidth;
  const groups = new Map(); // `${col}|${sourceId}` -> { col, from, to, edgeIds }

  for (const edge of index.edges) {
    const source = index.nodesById.get(edge.source);
    const target = index.nodesById.get(edge.target);
    if (!source || source.kind === 'dag' || !target || target.kind === 'dag') continue;
    if (colOf(target) <= colOf(source)) continue;
    const ys = positions.get(source.id).y;
    const yt = positions.get(target.id).y;
    const key = `${colOf(source)}|${source.id}`;
    if (!groups.has(key)) groups.set(key, { col: colOf(source), from: ys, to: ys, sourceY: ys, edgeIds: [] });
    const group = groups.get(key);
    group.from = Math.min(group.from, yt);
    group.to = Math.max(group.to, yt);
    group.edgeIds.push(edge.id);
  }

  const turns = new Map();
  const byGutter = new Map();
  for (const group of groups.values()) {
    if (group.to - group.from < 1) {
      for (const id of group.edgeIds) turns.set(id, gutterWidth / 2); // gerade Linie
      continue;
    }
    if (!byGutter.has(group.col)) byGutter.set(group.col, []);
    byGutter.get(group.col).push(group);
  }

  for (const gutterGroups of byGutter.values()) {
    // Reihenfolge der Spuren so wählen, dass sich überlappende Kämme nicht kreuzen:
    // nach oben laufende Gruppen links (obere Quelle zuerst), nach unten laufende rechts davon
    // (untere Quelle zuerst). Danach Intervall-Färbung: jede Gruppe nimmt die erste Spur ohne Überlappung.
    gutterGroups.sort((a, b) => trackSortKey(a) - trackSortKey(b));
    const tracks = [];
    for (const group of gutterGroups) {
      const clearance = dims.nodeHeight / 2;
      let track = tracks.findIndex((members) => members.every((other) => !overlaps(group.from, group.to, other.from, other.to, clearance)));
      if (track === -1) { track = tracks.length; tracks.push([]); }
      tracks[track].push(group);
      group.track = track;
    }
    const offsets = trackOffsets(tracks.length, gutterWidth);
    for (const group of gutterGroups) {
      for (const id of group.edgeIds) turns.set(id, offsets[group.track]);
    }
  }
  return turns;
}

function trackSortKey(group) {
  const goesDown = (group.from + group.to) / 2 > group.sourceY;
  return goesDown ? 1e9 - group.sourceY : group.sourceY;
}

function trackOffsets(count, gutterWidth) {
  if (count <= 1) return [gutterWidth / 2];
  const usable = gutterWidth - 2 * TRACK_MARGIN;
  const spacing = Math.max(MIN_TRACK_SPACING, Math.min(TRACK_SPACING, usable / (count - 1)));
  const start = (gutterWidth - spacing * (count - 1)) / 2;
  return Array.from({ length: count }, (_, i) => Math.max(4, Math.min(gutterWidth - 4, start + i * spacing)));
}
