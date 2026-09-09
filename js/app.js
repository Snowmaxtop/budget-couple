(function () {
  'use strict';

  const MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

  let state = Storage.load();
  let currentView = 'dashboard';
  let currentMonth = todayStr().slice(0, 7);
  let editingExpenseId = null;
  let editingRecurringId = null;
  let pushTimer = null;
  let settingsBuilt = false;
  let myPersonId = null;
  const filters = { type: 'all', personId: 'all', month: currentMonth, recurringPersonId: 'all' };

  const expenseModal = document.getElementById('expense-modal');
  const expenseForm = document.getElementById('expense-form');

  /* ===================== Utilitaires ===================== */
  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function formatCurrency(n) {
    return (Number(n) || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  }
  function formatMonthLabel(key) {
    const [y, m] = key.split('-').map(Number);
    const name = MONTHS_FR[m - 1] || '';
    return name.charAt(0).toUpperCase() + name.slice(1) + ' ' + y;
  }
  function formatDayMonth(dateStr) {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${d} ${MONTHS_FR[m - 1]}`;
  }
  function formatDateFR(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function initial(name) { return ((name || '?').trim().charAt(0) || '?').toUpperCase(); }
  function personById(id) { return state.people.find(p => p.id === id) || { id: null, name: '—' }; }
  function personIndex(id) { return state.people.findIndex(p => p.id === id); }
  function avatarClass(id) { return personIndex(id) === 1 ? 'avatar-b' : 'avatar-a'; }
  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function endOfMonth(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m, 0); // jour 0 du mois suivant = dernier jour du mois courant
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ===================== Persistance ===================== */
  function persist() {
    Storage.save(state);
    scheduleFirestoreWrite();
    scheduleGithubBackup();
  }

  // Génère les échéances jusqu'à la fin du mois RÉEL en cours (pas du mois
  // affiché à l'écran) : une récurrence dont le jour n'est pas encore passé
  // ce mois-ci (ex. loyer le 5, on est le 3) doit quand même compter dans
  // les dépenses communes du mois. On s'arrête volontairement à la fin du
  // mois réel — naviguer vers un mois futur avec les flèches ne doit PAS
  // générer ses échéances à l'avance : si une récurrence change de montant
  // avant que ce mois n'arrive vraiment, une échéance déjà générée trop tôt
  // garderait l'ancien montant.
  function runRecurringGeneration() {
    const boundary = endOfMonth(todayStr().slice(0, 7));
    return Recurring.generateMissingInstances(state, boundary);
  }

  // Filet de sécurité : régénère les échéances récurrentes manquantes à
  // chaque affichage du dashboard (idempotent — ne crée jamais de doublon),
  // pour ne jamais afficher un mois auquel il manquerait une échéance déjà
  // due, quelle que soit la façon dont l'état a été chargé (cache local,
  // import, ou synchro Firestore).
  function ensureRecurringUpToDate() {
    const created = runRecurringGeneration();
    if (created.length) {
      Storage.save(state);
      scheduleFirestoreWrite();
    }
    return created;
  }

  /* ===================== Navigation ===================== */
  function showView(name) {
    currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
    renderCurrentView();
    window.scrollTo(0, 0);
  }

  function renderCurrentView() {
    if (currentView === 'dashboard') renderDashboard();
    else if (currentView === 'expenses') renderExpenses();
    else if (currentView === 'recurring') renderRecurring();
    else if (currentView === 'history') renderHistory();
    else if (currentView === 'settings') ensureSettingsBuilt();
  }

  function renderAll() {
    renderDashboard();
    renderExpenses();
    renderRecurring();
    renderHistory();
  }

  function bindNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => showView(btn.dataset.view));
    });
    document.querySelectorAll('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => showView(btn.dataset.goto));
    });
    document.getElementById('prev-month').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, -1); renderDashboard(); });
    document.getElementById('next-month').addEventListener('click', () => { currentMonth = shiftMonth(currentMonth, 1); renderDashboard(); });
  }

  /* ===================== Personnel (haut de l'Accueil, en 2 parties) ===================== */
  function renderPersonalSection() {
    if (!myPersonId || !state.people.some(p => p.id === myPersonId)) {
      myPersonId = state.people[0] ? state.people[0].id : null;
    }

    const person = personById(myPersonId);
    const i = personIndex(myPersonId);
    const summary = Calculations.computeMonthSummary(state, currentMonth);

    /* ---- Partie 1 : dépenses perso ---- */
    const usage = Calculations.computeLoisirsUsage(state, currentMonth).find(u => u.id === myPersonId)
      || { spent: 0, budget: 0, barPct: 0, over: false };
    const remaining = usage.budget - usage.spent;
    const loisirsCaption = usage.budget <= 0
      ? 'Aucun budget loisirs défini pour l\u2019instant (Réglages)'
      : (usage.over ? `Dépassement de ${formatCurrency(usage.spent - usage.budget)}` : `${formatCurrency(remaining)} restants`);
    document.getElementById('personal-loisirs-card').innerHTML = `
      <div class="gauge-header">
        <span class="avatar ${i === 1 ? 'avatar-b' : 'avatar-a'}">${initial(person.name)}</span>
        <span class="name">${escapeHtml(person.name)} · Loisirs</span>
      </div>
      <div class="gauge-amounts">
        <span class="spent">${formatCurrency(usage.spent)}</span>
        <span class="budget">/ ${formatCurrency(usage.budget)}</span>
      </div>
      <div class="gauge-track"><div class="gauge-fill ${usage.over ? 'over' : ''}" style="width:${usage.barPct}%"></div></div>
      <div class="gauge-caption ${usage.over ? 'over' : ''}">${loisirsCaption}</div>`;

    const persoExpenses = Calculations.personalSpendingExpenses(state, myPersonId, currentMonth)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    document.getElementById('personal-expenses-list').innerHTML = persoExpenses.length
      ? persoExpenses.map(renderExpenseRowHTML).join('')
      : '<p class="card-sub">Aucune dépense personnelle ce mois-ci.</p>';

    renderSavingsCard();

    /* ---- Partie 2 : dépenses communes ---- */
    renderBalanceBlock('recurring', summary, myPersonId, 'Aucune dépense récurrente commune ce mois-ci.');
    renderBalanceBlock('rest', summary, myPersonId, 'Aucune dépense ponctuelle commune ce mois-ci.');
  }

  // Rappel mensuel : la personne active a-t-elle bien viré son épargne ce
  // mois-ci ? Un simple bouton à cocher, par personne et par mois. L'objectif
  // affiché est celui saisi à la main dans Réglages (people[].savingsGoal),
  // pas l'estimation automatique (qui reste visible dans Réglages à titre
  // indicatif).
  function renderSavingsCard() {
    if (!state.savingsLog) state.savingsLog = {};
    const person = personById(myPersonId);
    const goal = Number(person.savingsGoal) || 0;
    const log = (state.savingsLog[currentMonth] && state.savingsLog[currentMonth][myPersonId]) || null;

    document.getElementById('savings-message').textContent = goal > 0
      ? `Objectif ce mois-ci : ${formatCurrency(goal)}`
      : 'Aucun montant à épargner défini pour l\u2019instant (Réglages)';

    const btn = document.getElementById('savings-validate-btn');
    const note = document.getElementById('savings-note');
    const reward = document.getElementById('savings-reward');
    const cardEl = document.getElementById('savings-card');
    const done = !!(log && log.done);
    if (done) {
      btn.textContent = 'Annuler';
      note.hidden = false;
      note.textContent = `Épargné le ${formatDateFR(log.date)}`;
      reward.hidden = false;
    } else {
      btn.textContent = 'J\u2019ai épargné ce mois-ci';
      note.hidden = true;
      reward.hidden = true;
    }
    cardEl.classList.toggle('card-done', done);
  }

  function toggleSavingsLog() {
    if (!myPersonId) return;
    if (!state.savingsLog) state.savingsLog = {};
    if (!state.savingsLog[currentMonth]) state.savingsLog[currentMonth] = {};
    const existing = state.savingsLog[currentMonth][myPersonId];
    state.savingsLog[currentMonth][myPersonId] = (existing && existing.done)
      ? { done: false, date: null }
      : { done: true, date: todayStr() };
    persist();
    renderSavingsCard();
  }

  /* ===================== Rendu : ligne de dépense partagée ===================== */
  const CATEGORY_EMOJIS = {
    'logement': '🏠', 'alimentation': '🛒', 'transport': '🚗', 'loisirs': '🎉',
    'santé': '💊', 'abonnements': '📱', 'assurances': '🛡️', 'autre': '🗂️'
  };
  function categoryEmoji(category) {
    return CATEGORY_EMOJIS[(category || '').trim().toLowerCase()] || '🗂️';
  }

  function renderExpenseRowHTML(e) {
    const p = personById(e.personId);
    const forcedFood = Calculations.isForcedCommun(e);
    const typeBadge = (e.type === 'commun' || forcedFood) ? '<span class="badge badge-commun">Commune</span>' : '<span class="badge badge-perso">Perso</span>';
    const split = Calculations.effectiveSplit(e);
    const splitBadge = (!forcedFood && split.mode === 'fixed') ? `<span class="badge badge-split">${split.percent}% remb.</span>` : '';
    const freqBadge = e.recurringId ? '<span class="badge badge-split">Récurrente</span>' : '<span class="badge badge-perso">Ponctuelle</span>';
    const restoAmount = Number(e.restoAmount) || 0;
    const restoNote = restoAmount > 0 ? ` · dont ${formatCurrency(restoAmount)} carte resto` : '';
    return `
      <div class="expense-row" data-id="${e.id}">
        <span class="avatar ${avatarClass(e.personId)}">${initial(p.name)}</span>
        <div class="expense-main">
          <div class="expense-label">${escapeHtml(e.label)}</div>
          <div class="expense-meta">${typeBadge}${splitBadge}${freqBadge}<span>${categoryEmoji(e.category)} ${escapeHtml(e.category || 'Autre')}${restoNote}</span></div>
        </div>
        <div class="expense-amount">${formatCurrency(e.amount)}</div>
      </div>`;
  }

  function bindExpenseRowClicks(containerId) {
    document.getElementById(containerId).addEventListener('click', (e) => {
      const row = e.target.closest('.expense-row');
      if (row) openEditExpenseModal(row.dataset.id);
    });
  }

  function renderBalanceBlock(bucket, summary, personId, emptyMessage) {
    const total = bucket === 'recurring' ? summary.recurringTotal : summary.restTotal;
    const transfer = bucket === 'recurring' ? summary.recurringTransfer : summary.restTransfer;
    const settled = bucket === 'recurring' ? summary.recurringSettled : summary.restSettled;
    const settledDate = bucket === 'recurring' ? summary.recurringSettledDate : summary.restSettledDate;

    const oweAmount = (transfer && transfer.fromId === personId) ? transfer.amount : 0;
    document.getElementById(`commun-${bucket}-amount`).textContent = formatCurrency(oweAmount);

    const balEl = document.getElementById(`balance-message-${bucket}`);
    if (total === 0) {
      balEl.textContent = emptyMessage;
    } else if (!transfer) {
      balEl.textContent = 'Vous êtes à l\u2019équilibre \u2705';
    } else if (transfer.fromId === personId) {
      const to = personById(transfer.toId);
      balEl.textContent = `À verser à ${to.name}`;
    } else {
      const from = personById(transfer.fromId);
      balEl.textContent = `${from.name} vous doit ${formatCurrency(transfer.amount)}`;
    }

    const settleBtn = document.getElementById(`settle-${bucket}-btn`);
    const settledNote = document.getElementById(`settled-note-${bucket}`);
    const cardEl = document.getElementById(`card-${bucket}`);
    settleBtn.disabled = total === 0;
    if (settled) {
      settleBtn.textContent = 'Annuler le règlement';
      settledNote.hidden = false;
      settledNote.textContent = `Réglé le ${formatDateFR(settledDate)}`;
    } else {
      settleBtn.textContent = 'Marquer comme réglé';
      settledNote.hidden = true;
    }
    if (cardEl) cardEl.classList.toggle('card-done', !!settled);
  }

  /* ===================== Dashboard ===================== */
  function renderDashboard() {
    ensureRecurringUpToDate();
    renderPersonalSection();
    document.getElementById('month-label').textContent = formatMonthLabel(currentMonth);

    const [pA, pB] = state.people;
    const noSalaries = (Number(pA.salary) || 0) <= 0 && (Number(pB.salary) || 0) <= 0;
    document.getElementById('onboarding-hint').hidden = !noSalaries;
  }

  /* ===================== Dépenses (liste complète) ===================== */
  function populateFilterOptions() {
    const personSel = document.getElementById('filter-person');
    personSel.innerHTML = '<option value="all">Tout le monde</option>' +
      state.people.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    personSel.value = filters.personId;

    const monthSel = document.getElementById('filter-month');
    const months = Array.from(new Set(state.expenses.map(e => Calculations.monthKeyOf(e.date)))).filter(Boolean).sort().reverse();
    if (!months.includes(currentMonth)) months.unshift(currentMonth);
    monthSel.innerHTML = '<option value="all">Tous les mois</option>' +
      months.map(m => `<option value="${m}">${formatMonthLabel(m)}</option>`).join('');
    monthSel.value = filters.month;

    document.getElementById('filter-type').value = filters.type;
  }

  function getFilteredExpenses() {
    return state.expenses.filter(e => {
      if (filters.type !== 'all' && e.type !== filters.type) return false;
      // Le filtre "Personne" ne restreint que les dépenses PERSONNELLES —
      // une dépense commune concerne les deux, elle reste visible quel que
      // soit le profil sélectionné (seul l'avatar du payeur change).
      if (filters.personId !== 'all' && e.type === 'perso' && e.personId !== filters.personId) return false;
      if (filters.month !== 'all' && Calculations.monthKeyOf(e.date) !== filters.month) return false;
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function renderExpenses() {
    populateFilterOptions();
    const list = getFilteredExpenses();
    const container = document.getElementById('expenses-full-list');
    document.getElementById('expenses-empty').hidden = list.length !== 0;
    if (!list.length) { container.innerHTML = ''; return; }

    let html = '';
    let lastDay = null;
    list.forEach(e => {
      if (e.date !== lastDay) { html += `<div class="day-divider">${formatDayMonth(e.date)}</div>`; lastDay = e.date; }
      html += renderExpenseRowHTML(e);
    });
    container.innerHTML = html;
  }

  function bindFilters() {
    document.getElementById('filter-type').addEventListener('change', e => { filters.type = e.target.value; renderExpenses(); });
    document.getElementById('filter-person').addEventListener('change', e => { filters.personId = e.target.value; renderExpenses(); });
    document.getElementById('filter-month').addEventListener('change', e => { filters.month = e.target.value; renderExpenses(); });
    document.getElementById('filter-recurring-person').addEventListener('change', e => { filters.recurringPersonId = e.target.value; renderRecurring(); });
  }

  /* ===================== Récurrentes ===================== */
  function populateRecurringFilterOptions() {
    const sel = document.getElementById('filter-recurring-person');
    sel.innerHTML = '<option value="all">Tout le monde</option>' +
      state.people.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    sel.value = filters.recurringPersonId;
  }

  function renderRecurring() {
    populateRecurringFilterOptions();
    const rules = state.recurring
      .filter(r => filters.recurringPersonId === 'all' || r.type === 'commun' || r.personId === filters.recurringPersonId)
      .slice().sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    document.getElementById('recurring-empty').hidden = rules.length !== 0;
    const today = todayStr();
    const freqLabels = { monthly: 'Mensuelle', weekly: 'Hebdomadaire', yearly: 'Annuelle' };
    document.getElementById('recurring-list').innerHTML = rules.map(r => {
      const p = personById(r.personId);
      const next = Recurring.nextOccurrence(r, today);
      const paused = r.active === false;
      return `
        <div class="recurring-row ${paused ? 'paused' : ''}" data-id="${r.id}">
          <span class="avatar ${avatarClass(r.personId)}">${initial(p.name)}</span>
          <div class="recurring-info">
            <div class="recurring-title">${escapeHtml(r.label)}</div>
            <div class="recurring-sub">${freqLabels[r.frequency] || r.frequency} · ${next ? 'Prochaine le ' + formatDateFR(next) : 'Terminée'}</div>
          </div>
          <div class="recurring-amount">${formatCurrency(r.amount)}</div>
          <button type="button" class="status-pill ${paused ? 'status-pending' : 'status-settled'}" data-action="toggle-active" data-id="${r.id}">${paused ? 'En pause' : 'Active'}</button>
        </div>`;
    }).join('');
  }

  function bindRecurringList() {
    document.getElementById('recurring-list').addEventListener('click', (e) => {
      const pill = e.target.closest('[data-action="toggle-active"]');
      if (pill) {
        e.stopPropagation();
        const rule = state.recurring.find(r => r.id === pill.dataset.id);
        if (rule) { rule.active = rule.active === false ? true : false; persist(); renderRecurring(); }
        return;
      }
      const row = e.target.closest('.recurring-row');
      if (row) openEditRecurringModal(row.dataset.id);
    });
  }

  /* ===================== Historique ===================== */
  function renderHistory() {
    const keys = Calculations.allMonthKeysWithActivity(state);
    document.getElementById('history-empty').hidden = keys.length !== 0;
    document.getElementById('history-list').innerHTML = keys.map(k => {
      const s = Calculations.computeMonthSummary(state, k);
      const bothSettled = s.recurringSettled && s.restSettled;
      const noneSettled = !s.recurringSettled && !s.restSettled;
      const pillClass = bothSettled ? 'status-settled' : 'status-pending';
      const pillLabel = bothSettled ? 'Réglé' : (noneSettled ? (s.total > 0 ? 'En attente' : '—') : 'Partiellement réglé');
      return `
        <div class="history-row" data-month="${k}">
          <div class="history-info">
            <div class="history-title">${formatMonthLabel(k)}</div>
            <div class="history-sub">${formatCurrency(s.total)} de dépenses communes</div>
          </div>
          <span class="status-pill ${pillClass}">${pillLabel}</span>
          <button type="button" class="icon-btn history-delete-btn" data-action="delete-month" data-month="${k}" aria-label="Supprimer les données de ce mois">
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>`;
    }).join('');
  }

  // Supprime toutes les données (dépenses, règlements, primes loisirs,
  // épargne pointée) rattachées à un mois précis — utile pour repartir sur
  // une base propre (ex. mois de test) sans toucher aux autres mois.
  function deleteMonthData(monthKey) {
    const label = formatMonthLabel(monthKey);
    if (!confirm(`Supprimer définitivement toutes les données de ${label} (dépenses, règlements, épargne) ? Cette action est irréversible et concerne les deux profils.`)) return;
    state.expenses = state.expenses.filter(e => Calculations.monthKeyOf(e.date) !== monthKey);
    delete state.settlements[monthKey];
    if (state.loisirsBonuses) delete state.loisirsBonuses[monthKey];
    if (state.loisirsRewards) delete state.loisirsRewards[monthKey];
    if (state.savingsLog) delete state.savingsLog[monthKey];
    persist();
    renderAll();
  }

  function bindHistoryList() {
    document.getElementById('history-list').addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-action="delete-month"]');
      if (delBtn) {
        e.stopPropagation();
        deleteMonthData(delBtn.dataset.month);
        return;
      }
      const row = e.target.closest('.history-row');
      if (!row) return;
      currentMonth = row.dataset.month;
      showView('dashboard');
    });
  }

  /* ===================== Réglages ===================== */
  function renderSharesPreview() {
    const shares = Calculations.computeShares(state.people);
    const [pA, pB] = state.people;
    const pctA = Math.round((shares[pA.id] || 0) * 100);
    const pctB = 100 - pctA;
    document.getElementById('shares-preview').innerHTML = `
      <div class="share-item"><span class="share-dot" style="background:var(--rose)"></span>${escapeHtml(pA.name)} · ${pctA}%</div>
      <div class="share-item"><span class="share-dot" style="background:var(--sage)"></span>${escapeHtml(pB.name)} · ${pctB}%</div>`;
  }

  function refreshBudgetPersonNames() {
    document.getElementById('loisirs-name0').textContent = state.people[0].name;
    document.getElementById('loisirs-name1').textContent = state.people[1].name;
  }

  function renderBudgetBreakdown() {
    const breakdown = Calculations.computeBudgetBreakdown(state);
    document.getElementById('budget-breakdown').innerHTML = breakdown.map((b, i) => `
      <div class="budget-person">
        <div class="budget-person-header"><span class="avatar ${i === 0 ? 'avatar-a' : 'avatar-b'}">${initial(b.name)}</span>${escapeHtml(b.name)}</div>
        <div class="budget-line"><span>Dépenses communes (récurrentes)</span><span>${formatCurrency(b.commun)}</span></div>
        <div class="budget-line"><span>Loisirs</span><span>${formatCurrency(b.loisirs)}</span></div>
        <div class="budget-line"><span>Épargne du début de mois</span><span>${formatCurrency(b.savingsGoal)}</span></div>
        <div class="budget-line budget-line-total ${b.savings < 0 ? 'negative' : 'positive'}"><span>Épargne estimée en fin de mois</span><span>${formatCurrency(b.savings)}</span></div>
      </div>`).join('');
  }

  function syncSettingsValues() {
    const current = personById(myPersonId);
    document.getElementById('current-profile-name').textContent = current ? current.name : '—';

    const peopleForm = document.getElementById('settings-people-form');
    peopleForm.name0.value = state.people[0].name;
    peopleForm.salary0.value = state.people[0].salary || '';
    peopleForm.name1.value = state.people[1].name;
    peopleForm.salary1.value = state.people[1].salary || '';
    renderSharesPreview();

    const loisirsForm = document.getElementById('settings-loisirs-form');
    loisirsForm.loisirs0.value = state.people[0].loisirs || '';
    loisirsForm.loisirs1.value = state.people[1].loisirs || '';
    refreshBudgetPersonNames();
    renderBudgetBreakdown();

    const savingsForm = document.getElementById('settings-savings-form');
    savingsForm.savings0.value = state.people[0].savingsGoal || '';
    savingsForm.savings1.value = state.people[1].savingsGoal || '';
    document.getElementById('savings-name0').textContent = state.people[0].name;
    document.getElementById('savings-name1').textContent = state.people[1].name;

    const ghForm = document.getElementById('github-backup-form');
    ghForm.owner.value = githubBackupConfig.owner;
    ghForm.repo.value = githubBackupConfig.repo;
    ghForm.branch.value = githubBackupConfig.branch;
    ghForm.path.value = githubBackupConfig.path;
    ghForm.token.value = githubBackupConfig.token;
    ghForm.enabled.checked = githubBackupConfig.enabled;
  }

  function ensureSettingsBuilt() {
    if (settingsBuilt) { syncSettingsValues(); return; }
    settingsBuilt = true;

    document.getElementById('switch-profile-btn').addEventListener('click', () => {
      showProfileGate();
    });

    const peopleForm = document.getElementById('settings-people-form');
    peopleForm.addEventListener('input', () => {
      state.people[0].name = peopleForm.name0.value.trim() || 'Personne 1';
      state.people[0].salary = parseFloat(peopleForm.salary0.value) || 0;
      state.people[1].name = peopleForm.name1.value.trim() || 'Personne 2';
      state.people[1].salary = parseFloat(peopleForm.salary1.value) || 0;
      persist();
      renderSharesPreview();
      refreshBudgetPersonNames();
      renderBudgetBreakdown();
      document.getElementById('savings-name0').textContent = state.people[0].name;
      document.getElementById('savings-name1').textContent = state.people[1].name;
    });

    const loisirsForm = document.getElementById('settings-loisirs-form');
    loisirsForm.addEventListener('input', () => {
      state.people[0].loisirs = parseFloat(loisirsForm.loisirs0.value) || 0;
      state.people[1].loisirs = parseFloat(loisirsForm.loisirs1.value) || 0;
      persist();
      renderBudgetBreakdown();
    });

    const savingsForm = document.getElementById('settings-savings-form');
    savingsForm.addEventListener('input', () => {
      state.people[0].savingsGoal = parseFloat(savingsForm.savings0.value) || 0;
      state.people[1].savingsGoal = parseFloat(savingsForm.savings1.value) || 0;
      persist();
      renderBudgetBreakdown();
    });

    document.getElementById('export-btn').addEventListener('click', () => Storage.exportJSON(state));
    document.getElementById('import-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!confirm('Importer remplacera toutes les données actuelles (sur cet appareil ET pour votre partenaire, une fois synchronisé). Continuer ?')) { e.target.value = ''; return; }
      try {
        state = await Storage.importJSONFile(file);
        Storage.save(state);
        renderAll();
        syncSettingsValues();
        persist();
      } catch (err) {
        alert('Fichier invalide : ' + err.message);
      }
      e.target.value = '';
    });

    document.getElementById('account-retry-btn').addEventListener('click', () => {
      updateSyncBadge('syncing');
      FirebaseSync.writeData(state)
        .then(() => { setSyncStatus('Envoyé à ' + new Date().toLocaleTimeString('fr-FR')); updateSyncBadge('ok'); })
        .catch(err => { setSyncStatus('Erreur : ' + err.message, true); updateSyncBadge('error'); });
    });

    const ghForm = document.getElementById('github-backup-form');
    ghForm.addEventListener('input', () => {
      githubBackupConfig.owner = ghForm.owner.value.trim();
      githubBackupConfig.repo = ghForm.repo.value.trim();
      githubBackupConfig.branch = ghForm.branch.value.trim() || 'main';
      githubBackupConfig.path = ghForm.path.value.trim() || 'data/budget-backup.json';
      githubBackupConfig.token = ghForm.token.value;
      githubBackupConfig.enabled = ghForm.enabled.checked;
      saveGithubBackupConfig();
    });
    document.getElementById('github-backup-now-btn').addEventListener('click', pushGithubBackup);
    document.getElementById('github-restore-btn').addEventListener('click', restoreGithubBackup);

    syncSettingsValues();
  }

  /* ===================== Synchronisation Firebase (temps réel) ===================== */
  let firstSnapshotSeen = false;

  // Écrit vers Firestore quelques instants après la dernière modification
  // locale (laisse le temps de finir une saisie plutôt que d'envoyer à
  // chaque frappe).
  function scheduleFirestoreWrite() {
    updateSyncBadge('pending');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      updateSyncBadge('syncing');
      FirebaseSync.writeData(state)
        .then(() => updateSyncBadge('ok'))
        .catch(err => { console.error(err); updateSyncBadge('error'); });
    }, 1500);
  }

  // Écoute Firestore en direct : appelé une fois immédiatement avec les
  // données actuelles, puis à nouveau à chaque changement (le vôtre ou celui
  // de votre partenaire), sans avoir besoin de recharger la page.
  function startDataSync() {
    FirebaseSync.listen((data) => {
      if (!data) {
        // Rien sur Firestore pour l'instant (tout premier lancement) : on y
        // envoie l'état local actuel pour amorcer le document partagé.
        if (!firstSnapshotSeen) FirebaseSync.writeData(state).catch(err => console.error(err));
        firstSnapshotSeen = true;
        updateSyncBadge('ok');
        return;
      }
      const isFirstSnapshot = !firstSnapshotSeen;
      firstSnapshotSeen = true;
      // La comparaison de dates ne sert qu'à éviter d'écraser une modification
      // locale très récente par un écho un peu périmé — elle n'a aucun sens
      // pour le tout premier chargement d'un appareil : un état local jamais
      // synchronisé (donc sans aucune valeur) ne doit jamais l'emporter sur
      // des données distantes déjà existantes, même si son horodatage
      // "updatedAt" (généré au démarrage) paraît plus récent.
      if (!isFirstSnapshot && data.updatedAt && state.updatedAt && data.updatedAt <= state.updatedAt) {
        updateSyncBadge('ok');
        return; // ce qu'on a localement est déjà identique ou plus récent
      }
      state = Storage.mergeWithDefaults(data);
      Storage.save(state);
      renderAll();
      if (currentView === 'settings') syncSettingsValues();
      updateSyncBadge('ok');
    }, (err) => {
      console.error(err);
      updateSyncBadge('error');
    });
  }

  function updateSyncBadge(mode) {
    const badge = document.getElementById('sync-badge');
    const badgeText = document.getElementById('sync-badge-text');
    badge.hidden = false;
    badge.classList.toggle('error', mode === 'error');
    const labels = { pending: 'Modifications en attente…', syncing: 'Synchronisation…', error: 'Erreur de synchro', ok: 'Synchronisé' };
    badgeText.textContent = labels[mode] || 'Synchronisé';
  }

  function setSyncStatus(msg, isError) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }

  /* ===================== Sauvegarde automatique GitHub ===================== */
  // En parallèle de Firebase (qui reste la synchro en direct entre les deux
  // appareils) : à chaque modification, un fichier complet est aussi écrit
  // dans un dépôt GitHub via un token propre à cet appareil. Uniquement du
  // push automatique (pas de tirage périodique) — c'est une sauvegarde, pas
  // un second canal de synchro ; restaurer reste une action volontaire.
  let githubBackupConfig = loadGithubBackupConfig();
  let githubBackupTimer = null;

  function loadGithubBackupConfig() {
    const defaults = { owner: '', repo: '', branch: 'main', path: 'data/budget-backup.json', token: '', enabled: false };
    try {
      const raw = localStorage.getItem('githubBackupConfig');
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch (e) {
      return defaults;
    }
  }

  function saveGithubBackupConfig() {
    try { localStorage.setItem('githubBackupConfig', JSON.stringify(githubBackupConfig)); } catch (e) { /* ignore */ }
  }

  function scheduleGithubBackup() {
    if (!githubBackupConfig.enabled) return;
    clearTimeout(githubBackupTimer);
    githubBackupTimer = setTimeout(() => pushGithubBackup(), 4000);
  }

  function setGithubBackupStatus(msg, isError) {
    const el = document.getElementById('github-backup-status');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }

  function githubBackupConfigured() {
    return !!(githubBackupConfig.owner && githubBackupConfig.repo && githubBackupConfig.token);
  }

  async function pushGithubBackup() {
    if (!githubBackupConfigured()) { setGithubBackupStatus('Configuration incomplète.', true); return; }
    try {
      setGithubBackupStatus('Sauvegarde en cours…');
      const { sha } = await GitHubBackup.getFile(githubBackupConfig);
      await GitHubBackup.putFile(githubBackupConfig, state, sha);
      setGithubBackupStatus('Sauvegardé à ' + new Date().toLocaleTimeString('fr-FR'));
    } catch (err) {
      setGithubBackupStatus('Erreur : ' + err.message, true);
    }
  }

  async function restoreGithubBackup() {
    if (!githubBackupConfigured()) { setGithubBackupStatus('Configuration incomplète.', true); return; }
    if (!confirm('Restaurer remplacera toutes les données actuelles (ici et pour votre partenaire une fois resynchronisé) par la dernière sauvegarde GitHub. Continuer ?')) return;
    try {
      setGithubBackupStatus('Restauration en cours…');
      const { data } = await GitHubBackup.getFile(githubBackupConfig);
      if (!data) { setGithubBackupStatus('Aucune sauvegarde trouvée sur GitHub pour l\u2019instant.', true); return; }
      state = Storage.mergeWithDefaults(data);
      Storage.save(state);
      renderAll();
      if (currentView === 'settings') syncSettingsValues();
      scheduleFirestoreWrite();
      setGithubBackupStatus('Restauré à ' + new Date().toLocaleTimeString('fr-FR'));
    } catch (err) {
      setGithubBackupStatus('Erreur : ' + err.message, true);
    }
  }

  /* ===================== Modale dépense ===================== */
  function populatePersonSelect() {
    const sel = document.getElementById('expense-person-select');
    sel.innerHTML = state.people.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  }

  function setRecurringUI(isRecurring) {
    expenseForm.isRecurring.value = isRecurring ? 'true' : 'false';
    document.querySelector('.field-group-oneoff').hidden = isRecurring;
    document.querySelector('.field-group-recurring').hidden = !isRecurring;
    // La carte resto varie à chaque achat : n'a de sens que sur une dépense
    // ponctuelle précise, pas sur le modèle d'une récurrence.
    document.getElementById('resto-section').hidden = isRecurring;
    if (isRecurring) setRestoUI(0);
  }

  function updateSplitModeVisibility() {
    document.getElementById('split-mode-row').hidden = expenseForm.type.value !== 'commun';
  }

  function setSplitModeUI(split) {
    const isFixed = split.mode === 'fixed';
    const percent = split.percent != null ? split.percent : 50;
    expenseForm.splitFixed.checked = isFixed;
    expenseForm.splitPercent.value = isFixed ? percent : 50;
    document.getElementById('split-percent-row').hidden = !isFixed;
    document.getElementById('split-percent-label').textContent = expenseForm.splitPercent.value + '%';
  }

  function readSplitMode() {
    return expenseForm.splitFixed.checked ? 'fixed' : 'prorata';
  }

  function readSplitPercent() {
    return parseInt(expenseForm.splitPercent.value, 10) || 0;
  }

  function setRestoUI(restoAmount) {
    const has = Number(restoAmount) > 0;
    expenseForm.hasResto.checked = has;
    expenseForm.restoAmount.value = has ? restoAmount : '';
    document.getElementById('resto-amount-row').hidden = !has;
  }

  function readRestoAmount() {
    if (!expenseForm.hasResto.checked) return 0;
    return parseFloat(expenseForm.restoAmount.value) || 0;
  }

  function openAddExpenseModal() {
    editingExpenseId = null;
    editingRecurringId = null;
    expenseForm.reset();
    populatePersonSelect();
    document.getElementById('expense-modal-title').textContent = 'Nouvelle dépense';
    document.getElementById('recurring-toggle-row').hidden = false;
    document.getElementById('static-type-label').hidden = true;
    document.getElementById('expense-delete-btn').hidden = true;
    document.getElementById('linked-recurring-note').hidden = true;
    document.querySelectorAll('.segmented-opt').forEach(b => b.classList.toggle('active', b.dataset.recurring === 'false'));
    setRecurringUI(false);
    expenseForm.date.disabled = false;
    expenseForm.date.value = todayStr();
    expenseForm.type.value = 'commun';
    expenseForm.startDate.value = todayStr();
    setSplitModeUI({ mode: 'prorata' });
    setRestoUI(0);
    updateSplitModeVisibility();
    expenseModal.showModal();
  }

  function openEditExpenseModal(id) {
    const exp = state.expenses.find(x => x.id === id);
    if (!exp) return;
    editingExpenseId = id;
    editingRecurringId = null;
    populatePersonSelect();
    expenseForm.label.value = exp.label;
    expenseForm.amount.value = exp.amount;
    expenseForm.category.value = exp.category || '';
    expenseForm.type.value = exp.type;
    expenseForm.personId.value = exp.personId;
    expenseForm.date.value = exp.date;
    expenseForm.date.disabled = !!exp.recurringId;
    setSplitModeUI(Calculations.effectiveSplit(exp));
    setRestoUI(exp.restoAmount || 0);
    updateSplitModeVisibility();

    document.getElementById('expense-modal-title').textContent = 'Modifier la dépense';
    document.getElementById('recurring-toggle-row').hidden = true;
    document.getElementById('static-type-label').hidden = false;
    document.getElementById('static-type-label').textContent = exp.recurringId ? 'Dépense récurrente (cette échéance)' : 'Dépense ponctuelle';
    document.getElementById('linked-recurring-note').hidden = !exp.recurringId;
    document.getElementById('expense-delete-btn').hidden = false;
    setRecurringUI(false);
    expenseModal.showModal();
  }

  function openEditRecurringModal(id) {
    const rule = state.recurring.find(r => r.id === id);
    if (!rule) return;
    editingExpenseId = null;
    editingRecurringId = id;
    populatePersonSelect();
    expenseForm.label.value = rule.label;
    expenseForm.amount.value = rule.amount;
    expenseForm.category.value = rule.category || '';
    expenseForm.type.value = rule.type;
    expenseForm.personId.value = rule.personId;
    expenseForm.frequency.value = rule.frequency;
    expenseForm.startDate.value = rule.startDate;
    expenseForm.endDate.value = rule.endDate || '';
    setSplitModeUI(Calculations.effectiveSplit(rule));
    setRestoUI(0);
    updateSplitModeVisibility();

    document.getElementById('expense-modal-title').textContent = 'Modifier la récurrence';
    document.getElementById('recurring-toggle-row').hidden = true;
    document.getElementById('static-type-label').hidden = false;
    document.getElementById('static-type-label').textContent = 'Dépense récurrente';
    document.getElementById('linked-recurring-note').hidden = true;
    document.getElementById('expense-delete-btn').hidden = false;
    setRecurringUI(true);
    expenseModal.showModal();
  }

  function closeExpenseModal() { expenseModal.close(); }

  function handleExpenseSubmit(e) {
    e.preventDefault();
    const label = expenseForm.label.value.trim();
    const amount = parseFloat(expenseForm.amount.value);
    const category = expenseForm.category.value.trim() || 'Autre';
    const forcedCommun = Calculations.isForcedCommun({ category });
    const type = forcedCommun ? 'commun' : expenseForm.type.value;
    const personId = expenseForm.personId.value;
    let splitMode = 'prorata', splitPercent = null;
    if (type === 'commun' && !forcedCommun && readSplitMode() === 'fixed') {
      splitMode = 'fixed';
      splitPercent = readSplitPercent();
    }
    const restoAmount = (type === 'commun') ? Math.min(readRestoAmount(), amount > 0 ? amount : 0) : 0;
    if (!label || !(amount > 0)) return;

    if (editingRecurringId) {
      const rule = state.recurring.find(r => r.id === editingRecurringId);
      Object.assign(rule, {
        label, amount, type, personId, category, splitMode, splitPercent,
        frequency: expenseForm.frequency.value,
        startDate: expenseForm.startDate.value || todayStr(),
        endDate: expenseForm.endDate.value || null
      });
      runRecurringGeneration();
    } else if (expenseForm.isRecurring.value === 'true') {
      const rule = {
        id: Recurring.genId(), label, amount, type, personId, category, splitMode, splitPercent,
        frequency: expenseForm.frequency.value,
        startDate: expenseForm.startDate.value || todayStr(),
        endDate: expenseForm.endDate.value || null,
        active: true
      };
      state.recurring.push(rule);
      runRecurringGeneration();
    } else if (editingExpenseId) {
      const exp = state.expenses.find(x => x.id === editingExpenseId);
      Object.assign(exp, { label, amount, type, personId, category, splitMode, splitPercent, restoAmount });
      if (!exp.recurringId) exp.date = expenseForm.date.value || exp.date;
    } else {
      state.expenses.push({
        id: Recurring.genId(), label, amount, type, personId, category, splitMode, splitPercent, restoAmount,
        date: expenseForm.date.value || todayStr(),
        recurringId: null, createdAt: new Date().toISOString()
      });
    }

    persist();
    closeExpenseModal();
    renderAll();
  }

  function handleExpenseDelete() {
    if (editingRecurringId) {
      if (!confirm('Supprimer cette dépense récurrente ? Les échéances déjà générées restent dans l\u2019historique.')) return;
      state.recurring = state.recurring.filter(r => r.id !== editingRecurringId);
    } else if (editingExpenseId) {
      if (!confirm('Supprimer cette dépense ?')) return;
      state.expenses = state.expenses.filter(x => x.id !== editingExpenseId);
    }
    persist();
    closeExpenseModal();
    renderAll();
  }

  function bindModal() {
    document.getElementById('fab-add').addEventListener('click', openAddExpenseModal);
    document.getElementById('expense-modal-close').addEventListener('click', closeExpenseModal);
    document.querySelectorAll('.segmented-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        const isRec = btn.dataset.recurring === 'true';
        document.querySelectorAll('.segmented-opt').forEach(b => b.classList.toggle('active', b === btn));
        setRecurringUI(isRec);
      });
    });
    expenseForm.type.addEventListener('change', updateSplitModeVisibility);
    expenseForm.splitFixed.addEventListener('change', () => {
      document.getElementById('split-percent-row').hidden = !expenseForm.splitFixed.checked;
    });
    expenseForm.splitPercent.addEventListener('input', () => {
      document.getElementById('split-percent-label').textContent = expenseForm.splitPercent.value + '%';
    });
    expenseForm.hasResto.addEventListener('change', () => {
      document.getElementById('resto-amount-row').hidden = !expenseForm.hasResto.checked;
    });
    expenseForm.addEventListener('submit', handleExpenseSubmit);
    document.getElementById('expense-delete-btn').addEventListener('click', handleExpenseDelete);
    document.getElementById('settle-recurring-btn').addEventListener('click', () => toggleSettlement('recurring'));
    document.getElementById('settle-rest-btn').addEventListener('click', () => toggleSettlement('rest'));
    document.getElementById('savings-validate-btn').addEventListener('click', toggleSavingsLog);
  }

  // bucket = 'recurring' | 'rest' — les deux virements du couple se règlent
  // indépendamment l'un de l'autre.
  function toggleSettlement(bucket) {
    const normalized = Calculations.normalizeSettlement(state.settlements[currentMonth]);
    if (normalized[bucket].settled) {
      normalized[bucket] = { settled: false, settledDate: null, shares: null };
    } else {
      normalized[bucket] = { settled: true, settledDate: todayStr(), shares: Calculations.computeShares(state.people) };
    }
    state.settlements[currentMonth] = normalized;
    persist();
    renderAll();
  }

  /* ===================== Service worker (PWA) ===================== */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const okContext = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!okContext) return;
    navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('Service worker non enregistré :', err));
  }

  /* ===================== Authentification & choix de profil ===================== */
  function showLoginGate() {
    document.getElementById('login-gate').hidden = false;
    document.getElementById('profile-gate').hidden = true;
    document.getElementById('app').hidden = true;
  }

  function showApp() {
    document.getElementById('login-gate').hidden = true;
    document.getElementById('profile-gate').hidden = true;
    document.getElementById('app').hidden = false;
  }

  function showProfileGate() {
    document.getElementById('login-gate').hidden = true;
    document.getElementById('app').hidden = true;
    document.getElementById('profile-gate').hidden = false;
    document.querySelectorAll('.profile-gate-opt').forEach((btn, idx) => {
      const p = state.people[idx];
      if (!p) return;
      btn.querySelector('.profile-gate-name').textContent = p.name;
      const av = btn.querySelector('.avatar');
      av.textContent = initial(p.name);
      av.className = 'avatar ' + (idx === 1 ? 'avatar-b' : 'avatar-a');
    });
  }

  function bindProfileGate() {
    document.querySelectorAll('.profile-gate-opt').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const p = state.people[idx];
        if (!p) return;
        myPersonId = p.id;
        try { localStorage.setItem('myPersonId', p.id); } catch (e) { /* ignore */ }
        filters.personId = p.id;
        filters.recurringPersonId = p.id;
        if (appFullyStarted) {
          document.getElementById('profile-gate').hidden = true;
          document.getElementById('app').hidden = false;
          renderAll();
        } else {
          appFullyStarted = true;
          finishStartup();
        }
      });
    });
  }

  /* ===================== Démarrage ===================== */
  let appFullyStarted = false;

  function finishStartup() {
    runRecurringGeneration();
    Storage.save(state);
    showApp();
    renderAll();
    showView('dashboard');
    updateSyncBadge();
    startDataSync();
  }

  function startAppFor() {
    firstSnapshotSeen = false;
    let stored = null;
    try { stored = localStorage.getItem('myPersonId'); } catch (e) { /* ignore */ }
    if (stored && state.people.some(p => p.id === stored)) {
      myPersonId = stored;
      filters.personId = stored;
      filters.recurringPersonId = stored;
      appFullyStarted = true;
      finishStartup();
    } else {
      showProfileGate();
    }
  }

  function init() {
    bindNav();
    bindFilters();
    bindExpenseRowClicks('expenses-full-list');
    bindRecurringList();
    bindHistoryList();
    bindModal();
    bindProfileGate();
    registerServiceWorker();

    if (!window.FirebaseSync) {
      document.getElementById('login-status').textContent = '';
      const errorEl = document.getElementById('login-error');
      errorEl.textContent = 'Impossible de charger Firebase. Vérifiez la connexion réseau et js/firebase-config.js.';
      errorEl.hidden = false;
      showLoginGate();
      return;
    }

    FirebaseSync.ensureSignedIn(
      () => startAppFor(),
      (err) => {
        document.getElementById('login-status').textContent = '';
        const errorEl = document.getElementById('login-error');
        errorEl.textContent = 'Connexion à Firebase impossible : ' + (err && err.message ? err.message : 'erreur inconnue') + '. Vérifiez js/firebase-config.js et les règles Firestore.';
        errorEl.hidden = false;
      }
    );
  }

  document.addEventListener('DOMContentLoaded', init);
})();
