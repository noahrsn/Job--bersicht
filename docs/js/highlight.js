// Impact-Analyse: hebt alle Nachfolger („Was bricht?“) und/oder Vorgänger („Woher kommen meine Daten?“) hervor.
// Alles läuft über Cytoscape-Klassen in einem einzigen batch – keine direkte Stilmanipulation.

import { traverse } from './data.js';

const STATE_CLASSES = 'faded hl-down hl-up focus';

export function createImpactHighlighter(cy, index) {
  let mode = 'both';
  let pinnedId = null;
  let previewId = null;

  const render = () => {
    const activeId = previewId || pinnedId;
    cy.batch(() => {
      cy.elements().removeClass(STATE_CLASSES);
      if (!activeId) return;
      const focusNode = cy.getElementById(activeId);
      if (focusNode.empty()) return;

      const marked = new Set([activeId]);
      const markedEdges = new Set();
      if (mode === 'down' || mode === 'both') markDirection(activeId, 'down', marked, markedEdges);
      if (mode === 'up' || mode === 'both') markDirection(activeId, 'up', marked, markedEdges);

      cy.elements().forEach((ele) => {
        const relevant = ele.isNode() ? marked.has(ele.id()) : markedEdges.has(ele.id());
        if (!relevant) ele.addClass('faded');
      });
      focusNode.addClass('focus');
    });
  };

  const markDirection = (startId, direction, marked, markedEdges) => {
    const { nodeIds, edgeIds } = traverse(index, startId, direction);
    const className = direction === 'down' ? 'hl-down' : 'hl-up';
    for (const id of nodeIds) {
      marked.add(id);
      cy.getElementById(id).addClass(className);
    }
    for (const id of edgeIds) {
      markedEdges.add(id);
      cy.getElementById(id).addClass(className);
    }
    // DAG-Rahmen betroffener Jobs nicht abblenden, damit der Kontext lesbar bleibt.
    for (const id of nodeIds) {
      const parentId = index.nodesById.get(id)?.parent;
      if (parentId) marked.add(parentId);
    }
    const ownParent = index.nodesById.get(startId)?.parent;
    if (ownParent) marked.add(ownParent);
  };

  return {
    pin(id) { pinnedId = id; previewId = null; render(); },
    unpin() { pinnedId = null; previewId = null; render(); },
    preview(id) { if (previewId === id) return; previewId = id; render(); },
    endPreview() { if (!previewId) return; previewId = null; render(); },
    setMode(nextMode) { mode = nextMode; render(); },
    get pinnedId() { return pinnedId; },
  };
}
