// Kleine DOM-Helfer, damit die UI-Module ohne innerHTML auskommen (kein XSS-Risiko durch Daten).

/**
 * Erzeugt ein Element.
 * attrs: className, text, dataset, on{Event}-Handler (z. B. onClick), sonst setAttribute.
 * children: Strings werden zu Textknoten, null/undefined/false werden übersprungen.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

/** Hängt Kinder (auch verschachtelte Arrays) an ein Element an. */
export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
  return parent;
}

/** Entfernt alle Kinder eines Elements. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Kopiert Text in die Zwischenablage, mit Fallback für unsichere Kontexte. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { className: 'visually-hidden', readonly: true });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/** Liefert einen Wert aus localStorage, ohne bei gesperrtem Speicher zu werfen. */
export function readStorage(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function writeStorage(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* Speicher nicht verfügbar – Einstellung gilt nur für diese Sitzung */ }
}
