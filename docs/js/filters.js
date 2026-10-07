// Team-Filter (Checkboxen) und Alert-Empfänger-Filter.
// Ausblenden erfolgt per Klasse „filtered-out“ (display: none) – kein remove(), kein Re-Layout.

import { el, clear } from './dom.js';
import { collectEmails, emailsForJob } from './data.js';

export function initFilters(cy, index, { teamInputs, emailSelect, onChange }) {
  const state = {
    teams: new Set(teamInputs.filter((input) => input.checked).map((input) => input.value)),
    email: '',
  };

  fillEmailOptions(emailSelect, collectEmails(index), index.meta.emails_masked);

  const apply = () => {
    const visibleJobs = new Set();
    for (const job of index.jobNodes) {
      if (isJobVisible(job)) visibleJobs.add(job.id);
    }
    cy.batch(() => {
      for (const job of index.jobNodes) {
        cy.getElementById(job.id).toggleClass('filtered-out', !visibleJobs.has(job.id));
      }
      for (const dag of index.dagNodes) {
        const children = index.childrenByDag.get(dag.id) || [];
        const hasVisibleChild = children.some((child) => visibleJobs.has(child.id));
        const visible = state.teams.has(dag.team) && (hasVisibleChild || (!state.email && !children.length));
        cy.getElementById(dag.id).toggleClass('filtered-out', !visible);
      }
      for (const edge of index.edges) {
        const visible = isEndpointVisible(edge.source, visibleJobs) && isEndpointVisible(edge.target, visibleJobs);
        cy.getElementById(edge.id).toggleClass('filtered-out', !visible);
      }
    });
    onChange?.();
  };

  const isJobVisible = (job) => {
    if (!state.teams.has(job.team)) return false;
    if (state.email && !emailsForJob(index, job).has(state.email)) return false;
    return true;
  };

  const isEndpointVisible = (id, visibleJobs) => {
    const node = index.nodesById.get(id);
    if (node?.kind === 'dag') return !cy.getElementById(id).hasClass('filtered-out');
    return visibleJobs.has(id);
  };

  for (const input of teamInputs) {
    input.addEventListener('change', () => {
      if (input.checked) state.teams.add(input.value);
      else state.teams.delete(input.value);
      apply();
    });
  }
  emailSelect.addEventListener('change', () => {
    state.email = emailSelect.value;
    apply();
  });

  apply();

  return {
    isVisible(id) {
      const node = cy.getElementById(id);
      return node.nonempty() && !node.hasClass('filtered-out');
    },
    /** Macht einen Job sichtbar (Team einschalten, Empfänger-Filter zurücksetzen). */
    reveal(id) {
      const job = index.nodesById.get(id);
      if (!job) return;
      let changed = false;
      if (!state.teams.has(job.team)) {
        state.teams.add(job.team);
        const input = teamInputs.find((candidate) => candidate.value === job.team);
        if (input) input.checked = true;
        changed = true;
      }
      if (state.email && !emailsForJob(index, job).has(state.email)) {
        state.email = '';
        emailSelect.value = '';
        changed = true;
      }
      if (changed) apply();
    },
  };
}

function fillEmailOptions(select, emails, masked) {
  clear(select);
  select.appendChild(el('option', { value: '', text: 'Alle Empfänger' }));
  for (const mail of emails) select.appendChild(el('option', { value: mail, text: mail }));
  select.disabled = emails.length === 0;
  select.title = masked
    ? 'E-Mail-Adressen sind in diesem Build maskiert.'
    : 'Nur Jobs anzeigen, deren Fehler-Alerts an diese Adresse gehen (Job oder DAG).';
}
