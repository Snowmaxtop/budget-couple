/* Recurring — génère automatiquement les échéances (dépenses) à partir des
   modèles récurrents, jusqu'à la date du jour. Le jour du mois / jour de la
   semaine / date anniversaire est déduit de la "première échéance" saisie. */
const Recurring = (() => {

  function clampDay(year, monthIndex, day) {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return Math.min(day, lastDay);
  }

  function toISO(year, monthIndex, day) {
    const mm = String(monthIndex + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  // Toutes les occurrences d'une règle entre sa première échéance et `uptoDateStr` inclus.
  function occurrencesUpTo(rule, uptoDateStr) {
    if (!rule.startDate) return [];
    const upto = new Date(uptoDateStr + 'T00:00:00');
    const start = new Date(rule.startDate + 'T00:00:00');
    const end = rule.endDate ? new Date(rule.endDate + 'T00:00:00') : null;
    const dates = [];

    if (rule.frequency === 'weekly') {
      let cur = new Date(start);
      let guard = 0;
      while (cur <= upto && (!end || cur <= end) && guard < 2000) {
        dates.push(cur.toISOString().slice(0, 10));
        cur.setDate(cur.getDate() + 7);
        guard++;
      }
    } else if (rule.frequency === 'yearly') {
      let year = start.getFullYear();
      const monthIndex = start.getMonth();
      const day = start.getDate();
      let guard = 0;
      while (guard < 200) {
        const d = clampDay(year, monthIndex, day);
        const iso = toISO(year, monthIndex, d);
        const dateObj = new Date(iso + 'T00:00:00');
        if (dateObj > upto || (end && dateObj > end)) break;
        if (dateObj >= start) dates.push(iso);
        year += 1;
        guard++;
      }
    } else { // monthly (défaut)
      let year = start.getFullYear();
      let monthIndex = start.getMonth();
      const day = start.getDate();
      let guard = 0;
      while (guard < 1200) {
        const d = clampDay(year, monthIndex, day);
        const iso = toISO(year, monthIndex, d);
        const dateObj = new Date(iso + 'T00:00:00');
        if (dateObj > upto || (end && dateObj > end)) break;
        if (dateObj >= start) dates.push(iso);
        monthIndex += 1;
        if (monthIndex > 11) { monthIndex = 0; year += 1; }
        guard++;
      }
    }
    return dates;
  }

  // Crée dans state.expenses toutes les échéances manquantes jusqu'à aujourd'hui.
  // Idempotent : ne recrée jamais une échéance déjà générée pour une même date.
  function generateMissingInstances(state, todayStr) {
    const created = [];
    (state.recurring || []).filter(r => r.active !== false).forEach(rule => {
      const dates = occurrencesUpTo(rule, todayStr);
      dates.forEach(dateStr => {
        const exists = state.expenses.some(e => e.recurringId === rule.id && e.date === dateStr);
        if (!exists) {
          const expense = {
            id: genId(),
            label: rule.label,
            amount: rule.amount,
            type: rule.type,
            personId: rule.personId,
            category: rule.category,
            splitMode: rule.splitMode || 'prorata',
            splitPercent: rule.splitPercent != null ? rule.splitPercent : null,
            date: dateStr,
            recurringId: rule.id,
            createdAt: new Date().toISOString()
          };
          state.expenses.push(expense);
          created.push(expense);
        }
      });
    });
    return created;
  }

  function nextOccurrence(rule, fromDateStr) {
    const lookahead = addYears(fromDateStr, 2);
    const all = occurrencesUpTo(rule, lookahead);
    return all.find(d => d > fromDateStr) || null;
  }

  function addYears(dateStr, years) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setFullYear(d.getFullYear() + years);
    return d.toISOString().slice(0, 10);
  }

  function genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  return { generateMissingInstances, occurrencesUpTo, nextOccurrence, genId };
})();
