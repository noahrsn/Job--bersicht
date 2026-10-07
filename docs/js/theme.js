// Hell-/Dunkelmodus. Standard ist die System-Präferenz; eine manuelle Wahl wird gemerkt.
// Die Graph-Farben werden aus den CSS-Variablen gelesen, damit CSS die einzige Farbquelle ist.

import { readStorage, writeStorage } from './dom.js';

const STORAGE_KEY = 'datep-dashboard-theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/** Liest alle für Cytoscape benötigten Farben aus den CSS-Variablen. */
export function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const read = (name) => styles.getPropertyValue(name).trim();
  return {
    canvas: read('--canvas'),
    text: read('--text'),
    textMuted: read('--text-muted'),
    nodeBg: read('--node-bg'),
    dagBg: read('--dag-bg'),
    edge: read('--edge'),
    edgeStart: read('--edge-start'),
    dataset: read('--edge-dataset'),
    warn: read('--warn'),
    warnBg: read('--warn-bg'),
    down: read('--impact-down'),
    up: read('--impact-up'),
    focus: read('--focus-ring'),
    glow: read('--brand'),
    teams: {
      shared: { line: read('--team-shared'), fill: read('--team-shared-bg') },
      epec: { line: read('--team-epec'), fill: read('--team-epec-bg') },
      epep: { line: read('--team-epep'), fill: read('--team-epep-bg') },
    },
  };
}

export function isDark() {
  const forced = document.documentElement.dataset.theme;
  return forced ? forced === 'dark' : darkQuery.matches;
}

/** Initialisiert den Umschalter; onChange wird nach jedem Themenwechsel aufgerufen. */
export function initTheme(toggleButton, onChange) {
  const stored = readStorage(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  updateButton(toggleButton);

  toggleButton.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    writeStorage(STORAGE_KEY, next);
    updateButton(toggleButton);
    onChange();
  });

  darkQuery.addEventListener('change', () => {
    if (document.documentElement.dataset.theme) return;
    updateButton(toggleButton);
    onChange();
  });
}

function updateButton(button) {
  const dark = isDark();
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', dark ? 'Hellen Modus aktivieren' : 'Dunklen Modus aktivieren');
  button.title = dark ? 'Hellen Modus aktivieren' : 'Dunklen Modus aktivieren';
  button.querySelector('.theme-icon').textContent = dark ? '☀' : '☾';
}
