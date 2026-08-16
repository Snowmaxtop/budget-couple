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

  // Règle Alimentation : toute dépense catégorisée "Alimentation" est
  // toujours traitée comme commune au prorata, quel que soit le type ou le
  // mode de répartition enregistré (protège même d'anciennes données mal
  // catégorisées).
  function isForcedCommun(e) {
    return (e.category || '').trim().toLowerCase() === 'alimentation';
  }

  // Détermine le mode de répartition effectif d'une dépense commune :
  // { mode: 'prorata' } ou { mode: 'fixed', percent: 0-100 } où percent est
  // le pourcentage du montant remboursé par l'AUTRE personne (100 = l'autre
  // rembourse tout, 50 = moitié-moitié, 0 = rien à partager). Comprend aussi
  // les anciens formats ('5050', 'reimburse') pour rester compatible avec
  // des dépenses déjà enregistrées avant l'introduction du curseur.
  function effectiveSplit(e) {
    if (isForcedCommun(e)) return { mode: 'prorata' };
    if (e.splitMode === 'fixed') return { mode: 'fixed', percent: e.splitPercent != null ? Number(e.splitPercent) : 100 };
    if (e.splitMode === 'reimburse') return { mode: 'fixed', percent: 100 };
    if (e.splitMode === '5050') return { mode: 'fixed', percent: 50 };
    return { mode: 'prorata' };
  }

  // Résumé complet d'un mois : total commun, part due de chacun, ce que chacun a
  // réellement avancé, et qui doit combien à qui.
  // Si le mois est déjà "réglé", on réutilise les % figés à ce moment-là plutôt
  // que les % courants (utile si les salaires ont changé depuis).
  // Le résumé sépare aussi les totaux/soldes en deux groupes pour
  // l'affichage : "communes" (prorata, y compris Alimentation forcée) et
  // "remboursements" (pourcentage fixe défini par le curseur), en plus du
  // solde global combiné.
  function computeMonthSummary(state, monthKey) {
    const people = state.people;
    const settlement = state.settlements[monthKey];
    const shares = (settlement && settlement.settled && settlement.shares)
      ? settlement.shares
      : computeShares(people);

    const monthExpenses = state.expenses
      .filter(e => (e.type === 'commun' || isForcedCommun(e)) && monthKeyOf(e.date) === monthKey)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const total = monthExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    function dueContribution(e, due) {
      const amount = Number(e.amount) || 0;
      const split = effectiveSplit(e);
      if (split.mode === 'fixed') {
        const pct = split.percent / 100;
        people.forEach(p => {
          due[p.id] += (p.id === e.personId) ? amount * (1 - pct) : amount * pct;
        });
      } else {
        people.forEach(p => { due[p.id] += amount * (shares[p.id] || 0); });
      }
    }

    function computeBucket(list) {
      const paid = {}, due = {};
      people.forEach(p => { paid[p.id] = 0; due[p.id] = 0; });
      list.forEach(e => {
        paid[e.personId] = (paid[e.personId] || 0) + (Number(e.amount) || 0);
        dueContribution(e, due);
      });
      const bTotal = list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const balance = {};
      people.forEach(p => { balance[p.id] = paid[p.id] - due[p.id]; });
      return { total: bTotal, paid, due, balance };
    }

    function bucketTransfer(balance) {
      if (people.length !== 2) return null;
      const [a, b] = people;
      const diff = balance[a.id];
      if (Math.abs(diff) <= 0.005) return null;
      return diff > 0
        ? { fromId: b.id, toId: a.id, amount: diff }
        : { fromId: a.id, toId: b.id, amount: -diff };
    }

    const reimburseExpenses = monthExpenses.filter(e => effectiveSplit(e).mode === 'fixed');
    const communExpenses = monthExpenses.filter(e => effectiveSplit(e).mode !== 'fixed');
    const communBucket = computeBucket(communExpenses);
    const reimburseBucket = computeBucket(reimburseExpenses);

    const paidBy = {}, due = {};
    people.forEach(p => {
      paidBy[p.id] = communBucket.paid[p.id] + reimburseBucket.paid[p.id];
      due[p.id] = communBucket.due[p.id] + reimburseBucket.due[p.id];
    });
    const balance = {};
    people.forEach(p => { balance[p.id] = paidBy[p.id] - due[p.id]; });

    const transfer = bucketTransfer(balance);
    const communTransfer = bucketTransfer(communBucket.balance);
    const reimburseTransfer = bucketTransfer(reimburseBucket.balance);

    return {
      monthKey, shares, total, paidBy, due, balance, transfer,
      communTotal: communBucket.total, communTransfer, communDue: communBucket.due,
      reimburseTotal: reimburseBucket.total, reimburseTransfer, reimburseDue: reimburseBucket.due,
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
    state.expenses.forEach(e => { if (e.type === 'commun' || isForcedCommun(e)) keys.add(monthKeyOf(e.date)); });
    Object.keys(state.settlements).forEach(k => keys.add(k));
    return Array.from(keys).filter(Boolean).sort().reverse();
  }

  // Ramène le montant d'une récurrence à son équivalent mensuel, quelle que
  // soit sa fréquence (utile pour additionner des règles hebdo/mensuelles/
  // annuelles dans un même total mensuel).
  function monthlyEquivalentAmount(rule) {
    const amt = Number(rule.amount) || 0;
    if (rule.frequency === 'weekly') return amt * (52 / 12);
    if (rule.frequency === 'yearly') return amt / 12;
    return amt; // monthly
  }

  // Total mensuel des dépenses communes récurrentes actives (loyer,
  // abonnements partagés, etc.), toutes fréquences ramenées au mois.
  function totalMonthlyRecurringCommun(state) {
    return (state.recurring || [])
      .filter(r => (r.type === 'commun' || isForcedCommun(r)) && r.active !== false)
      .reduce((sum, r) => sum + monthlyEquivalentAmount(r), 0);
  }

  // Pour chaque personne : sa part des dépenses communes récurrentes (au
  // prorata courant des salaires), le budget loisirs qu'elle a défini, et
  // l'épargne estimée qui en découle (salaire - loisirs - part commune).
  function computeBudgetBreakdown(state) {
    const shares = computeShares(state.people);
    const totalCommunMonthly = totalMonthlyRecurringCommun(state);
    return state.people.map(p => {
      const commun = totalCommunMonthly * (shares[p.id] || 0);
      const loisirs = Number(p.loisirs) || 0;
      const salary = Number(p.salary) || 0;
      const savings = salary - loisirs - commun;
      return { id: p.id, name: p.name, commun, loisirs, savings };
    });
  }

  // Pour chaque personne : ce qu'elle a dépensé ce mois-ci en "Loisirs"
  // (dépenses personnelles catégorisées Loisirs), face à son budget défini
  // dans Réglages.
  function computeLoisirsUsage(state, monthKey) {
    return state.people.map(p => {
      const spent = state.expenses
        .filter(e => e.personId === p.id
          && e.type === 'perso'
          && !isForcedCommun(e)
          && monthKeyOf(e.date) === monthKey
          && (e.category || '').trim().toLowerCase() === 'loisirs')
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const budget = Number(p.loisirs) || 0;
      const barPct = budget > 0 ? Math.min(100, (spent / budget) * 100) : (spent > 0 ? 100 : 0);
      return { id: p.id, name: p.name, spent, budget, barPct, over: spent > budget };
    });
  }

  return {
    computeShares, computeMonthSummary, monthKeyOf, categoryBreakdown,
    allMonthKeysWithActivity, totalMonthlyRecurringCommun, computeBudgetBreakdown,
    computeLoisirsUsage, isForcedCommun, effectiveSplit
  };
})();
