// Barrierearmer modaler Dialog auf Basis von <dialog>:
// Schließen per Esc, Klick auf den Hintergrund und Schließen-Button; Fokus-Falle; Fokus-Rückgabe.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function createModal(dialog, { onClose } = {}) {
  const body = dialog.querySelector('.modal-body');
  let returnFocusTo = null;

  const close = () => {
    if (!dialog.open) return;
    dialog.close();
  };

  dialog.addEventListener('close', () => {
    onClose?.();
    if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus();
    returnFocusTo = null;
  });

  // Klick außerhalb des Inhalts (auf das ::backdrop bzw. den Dialograhmen) schließt.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // Nur den Dialog schließen – die Auswahl im Graph bleibt erhalten.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      trapFocus(dialog, event);
    }
  });

  for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', close);

  return {
    /** Ersetzt den Inhalt und öffnet den Dialog (bzw. aktualisiert ihn, wenn schon offen). */
    open(content) {
      body.replaceChildren(content);
      body.scrollTop = 0;
      if (!dialog.open) {
        returnFocusTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
        dialog.showModal();
      }
      const heading = dialog.querySelector('[data-autofocus]') || dialog.querySelector(FOCUSABLE);
      heading?.focus();
    },
    close,
    get isOpen() { return dialog.open; },
  };
}

function trapFocus(dialog, event) {
  const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
