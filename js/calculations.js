/* Calculations — répartition au prorata des salaires, et calcul du solde mensuel. */
const Calculations = (() => {

  // % de chacun, recalculé en direct à partir des salaires actuels.
  // Si les deux salaires sont à 0, on retombe sur un 50/50 par défaut.
  function computeShares(people) {
    const total = people.reduce((sum, p) => sum + (Number(p.salary) || 0), 0);
    const shares = {};
    if (total <= 0) {
      const equal = people.length ? 1 / people.length : 0;
      people.forEach(p => { shares[p.id] = equal; });
      return shares;
    }
    people.forEach(p => { shares[p.id] = (Number(p.salary) || 0) / total; });
    return shares;
  }

  function monthKeyOf(dateStr) {
    return dateStr ? dateStr.slice(0, 7) : '';
  }

  // Résumé complet d'un mois : total commun, part due de chacun, ce que chacun a
  // réellement avancé, et qui doit combien à qui.
  // Si le mois est déjà "réglé", on réutilise les % figés à ce moment-là plutôt
  // que les % courants (utile si les salaires ont changé depuis).
  function computeMonthSummary(state, monthKey) {
    const people = state.people;
    const settlement = state.settlements[monthKey];
    const shares = (settlement && settlement.settled && settlement.shares)
      ? settlement.shares
      : computeShares(people);

    const monthExpenses = state.expenses
      .filter(e => e.type === 'commun' && monthKeyOf(e.date) === monthKey)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const total = monthExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const paidBy = {};
    people.forEach(p => { paidBy[p.id] = 0; });
    monthExpenses.forEach(e => {
      paidBy[e.personId] = (paidBy[e.personId] || 0) + (Number(e.amount) || 0);
    });

    const due = {};
    people.forEach(p => { due[p.id] = total * (shares[p.id] || 0); });

    const balance = {};
    people.forEach(p => { balance[p.id] = (paidBy[p.id] || 0) - (due[p.id] || 0); });

    let transfer = null;
    if (people.length === 2) {
      const [a, b] = people;
      const diff = balance[a.id];
      if (Math.abs(diff) > 0.005) {
        transfer = diff > 0
          ? { fromId: b.id, toId: a.id, amount: diff }
          : { fromId: a.id, toId: b.id, amount: -diff };
      }
    }

    return {
      monthKey, shares, total, paidBy, due, balance, transfer,
      expenses: monthExpenses,
      settled: !!(settlement && settlement.settled),
      settledDate: settlement ? settlement.settledDate : null
    };
  }

  function categoryBreakdown(monthExpenses) {
    const map = {};
    monthExpenses.forEach(e => {
      const cat = e.category || 'Autre';
      map[cat] = (map[cat] || 0) + (Number(e.amount) || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }

  function allMonthKeysWithActivity(state) {
    const keys = new Set();
    state.expenses.forEach(e => { if (e.type === 'commun') keys.add(monthKeyOf(e.date)); });
    Object.keys(state.settlements).forEach(k => keys.add(k));
    return Array.from(keys).filter(Boolean).sort().reverse();
  }

  return { computeShares, computeMonthSummary, monthKeyOf, categoryBreakdown, allMonthKeysWithActivity };
})();
