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
  const filters = { type: 'all', personId: 'all', month: currentMonth };

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

  /* ===================== Persistance ===================== */
  function persist() {
    Storage.save(state);
    scheduleFirestoreWrite();
  }

  function runRecurringGeneration() {
    return Recurring.generateMissingInstances(state, todayStr());
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

  function bindPersonSwitch() {
    document.querySelectorAll('.person-switch-opt').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const p = state.people[i];
        if (!p) return;
        myPersonId = p.id;
        try { localStorage.setItem('myPersonId', p.id); } catch (e) { /* ignore */ }
        renderDashboard();
      });
    });
  }

  /* ===================== Personnel (haut de l'Accueil) ===================== */
  function renderPersonalSection() {
    if (!myPersonId || !state.people.some(p => p.id === myPersonId)) {
      myPersonId = state.people[0] ? state.people[0].id : null;
    }
    document.querySelectorAll('.person-switch-opt').forEach((btn, i) => {
      const p = state.people[i];
      if (!p) return;
      btn.textContent = p.name;
      btn.classList.toggle('active', p.id === myPersonId);
    });

    const person = personById(myPersonId);
    const i = personIndex(myPersonId);

    const summary = Calculations.computeMonthSummary(state, currentMonth);

    const usage = Calculations.computeLoisirsUsage(state, currentMonth).find(u => u.id === myPersonId)
      || { spent: 0, budget: 0, barPct: 0, over: false };
    const remaining = usage.budget - usage.spent;
    const caption = usage.budget <= 0
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
      <div class="gauge-caption ${usage.over ? 'over' : ''}">${caption}</div>`;

    // Jauge "Dépenses communes" : la part réelle due ce mois-ci (dépenses
    // ponctuelles + récurrentes déjà générées, prorata et remboursements
    // confondus) face à l'estimation mensuelle basée sur les récurrences
    // actives (calculée dans Réglages → Budget loisirs & épargne).
    const communActual = (summary.communDue[myPersonId] || 0) + (summary.reimburseDue[myPersonId] || 0);
    const budgetEstimate = Calculations.computeBudgetBreakdown(state).find(b => b.id === myPersonId) || { commun: 0 };
    const communBudget = budgetEstimate.commun || 0;
    const communBarPct = communBudget > 0 ? Math.min(100, (communActual / communBudget) * 100) : (communActual > 0 ? 100 : 0);
    const communOver = communActual > communBudget;
    const communCaption = communBudget <= 0
      ? `${formatCurrency(communActual)} de dépenses communes ce mois-ci (aucune récurrence active pour comparer)`
      : (communOver
        ? `${formatCurrency(communActual - communBudget)} au-delà de l\u2019estimation habituelle`
        : `${formatCurrency(communBudget - communActual)} sous l\u2019estimation habituelle`);
    document.getElementById('personal-commun-card').innerHTML = `
      <div class="gauge-header">
        <span class="avatar ${i === 1 ? 'avatar-b' : 'avatar-a'}">${initial(person.name)}</span>
        <span class="name">${escapeHtml(person.name)} · Dépenses communes</span>
      </div>
      <div class="gauge-amounts">
        <span class="spent">${formatCurrency(communActual)}</span>
        <span class="budget">/ ${formatCurrency(communBudget)} estimés</span>
      </div>
      <div class="gauge-track"><div class="gauge-fill ${communOver ? 'over' : ''}" style="width:${communBarPct}%"></div></div>
      <div class="gauge-caption ${communOver ? 'over' : ''}">${communCaption}</div>`;

    const persoExpenses = state.expenses
      .filter(e => e.personId === myPersonId && e.type === 'perso' && !Calculations.isForcedCommun(e) && Calculations.monthKeyOf(e.date) === currentMonth)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    document.getElementById('personal-expenses-list').innerHTML = persoExpenses.length
      ? persoExpenses.map(renderExpenseRowHTML).join('')
      : '<p class="card-sub">Aucune dépense personnelle ce mois-ci.</p>';

    const bal = summary.balance[myPersonId] || 0;
    const owedEl = document.getElementById('personal-owed');
    if (bal >= -0.005) {
      owedEl.innerHTML = bal > 0.005
        ? `<p class="card-sub">Rien à verser — on vous doit ${formatCurrency(bal)}.</p>`
        : '<p class="card-sub">Vous êtes à l\u2019équilibre.</p>';
    } else {
      const toVerser = -bal;
      const communDue = (summary.communDue && summary.communDue[myPersonId]) || 0;
      const reimburseDue = (summary.reimburseDue && summary.reimburseDue[myPersonId]) || 0;
      owedEl.innerHTML = `
        <div class="hero-amount" style="font-size:1.6rem; margin: 2px 0 12px;">${formatCurrency(toVerser)}</div>
        <div class="budget-line"><span>Dépenses communes (part, dont alimentation)</span><span>${formatCurrency(communDue)}</span></div>
        <div class="budget-line"><span>Remboursements dus</span><span>${formatCurrency(reimburseDue)}</span></div>`;
    }
  }

  /* ===================== Rendu : ligne de dépense partagée ===================== */
  function renderExpenseRowHTML(e) {
    const p = personById(e.personId);
    const forcedFood = Calculations.isForcedCommun(e);
    const typeBadge = (e.type === 'commun' || forcedFood) ? '<span class="badge badge-commun">Commune</span>' : '<span class="badge badge-perso">Perso</span>';
    const split = Calculations.effectiveSplit(e);
    const splitBadge = (!forcedFood && split.mode === 'fixed') ? `<span class="badge badge-split">${split.percent}% remb.</span>` : '';
    const recurTag = e.recurringId ? ' · récurrente' : '';
    return `
      <div class="expense-row" data-id="${e.id}">
        <span class="avatar ${avatarClass(e.personId)}">${initial(p.name)}</span>
        <div class="expense-main">
          <div class="expense-label">${escapeHtml(e.label)}</div>
          <div class="expense-meta">${typeBadge}${splitBadge}<span>${escapeHtml(e.category || 'Autre')}${recurTag}</span></div>
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

  /* ===================== Dashboard ===================== */
  function renderDashboard() {
    ensureRecurringUpToDate();
    renderPersonalSection();
    document.getElementById('month-label').textContent = formatMonthLabel(currentMonth);
    const summary = Calculations.computeMonthSummary(state, currentMonth);
    const [pA, pB] = state.people;

    document.getElementById('dash-total').textContent = formatCurrency(summary.total);

    const pctA = Math.round((summary.shares[pA.id] || 0) * 100);
    const pctB = 100 - pctA;
    document.getElementById('split-seg-a').style.flexBasis = pctA + '%';
    document.getElementById('split-seg-b').style.flexBasis = pctB + '%';
    document.getElementById('split-a-label').textContent = `${initial(pA.name)} ${pctA}%`;
    document.getElementById('split-b-label').textContent = `${initial(pB.name)} ${pctB}%`;

    const noSalaries = (Number(pA.salary) || 0) <= 0 && (Number(pB.salary) || 0) <= 0;
    document.getElementById('onboarding-hint').hidden = !noSalaries;

    const balEl = document.getElementById('balance-message');
    if (summary.total === 0) {
      balEl.textContent = 'Aucune dépense commune ce mois-ci.';
    } else if (!summary.transfer) {
      balEl.textContent = 'Vous êtes à l\u2019équilibre \u2705';
    } else {
      const from = personById(summary.transfer.fromId);
      const to = personById(summary.transfer.toId);
      balEl.textContent = `${from.name} doit ${formatCurrency(summary.transfer.amount)} à ${to.name}`;
    }

    const breakdownEl = document.getElementById('balance-breakdown');
    if (summary.reimburseTotal > 0 && (summary.communTransfer || summary.reimburseTransfer)) {
      breakdownEl.hidden = false;
      let rows = '';
      if (summary.communTransfer) {
        const from = personById(summary.communTransfer.fromId);
        rows += `<div class="bd-row"><span>Dépenses communes</span><span>${formatCurrency(summary.communTransfer.amount)} dus par ${from.name}</span></div>`;
      }
      if (summary.reimburseTransfer) {
        const from = personById(summary.reimburseTransfer.fromId);
        rows += `<div class="bd-row"><span>À rembourser</span><span>${formatCurrency(summary.reimburseTransfer.amount)} dus par ${from.name}</span></div>`;
      }
      breakdownEl.innerHTML = rows;
    } else {
      breakdownEl.hidden = true;
      breakdownEl.innerHTML = '';
    }

    const settleBtn = document.getElementById('settle-btn');
    const settledNote = document.getElementById('settled-note');
    settleBtn.disabled = summary.total === 0;
    if (summary.settled) {
      settleBtn.textContent = 'Annuler le règlement';
      settledNote.hidden = false;
      settledNote.textContent = `Réglé le ${formatDateFR(summary.settledDate)}`;
    } else {
      settleBtn.textContent = 'Marquer comme réglé';
      settledNote.hidden = true;
    }

    const catEl = document.getElementById('category-breakdown');
    const cats = Calculations.categoryBreakdown(summary.expenses);
    if (!cats.length) {
      catEl.innerHTML = '<p class="card-sub">Rien à afficher pour l\u2019instant.</p>';
    } else {
      const max = cats[0][1];
      catEl.innerHTML = cats.map(([name, amount]) => `
        <div class="cat-row">
          <span class="cat-name">${escapeHtml(name)}</span>
          <span class="cat-bar-track"><span class="cat-bar-fill" style="width:${Math.max(6, (amount / max) * 100)}%"></span></span>
          <span class="cat-amount">${formatCurrency(amount)}</span>
        </div>`).join('');
    }

    const monthAll = state.expenses
      .filter(e => Calculations.monthKeyOf(e.date) === currentMonth)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt || '') < (b.createdAt || '') ? 1 : -1))
      .slice(0, 6);
    document.getElementById('recent-expenses').innerHTML = monthAll.length
      ? monthAll.map(renderExpenseRowHTML).join('')
      : '<p class="card-sub">Aucune dépense ce mois-ci.</p>';
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
      if (filters.personId !== 'all' && e.personId !== filters.personId) return false;
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
  }

  /* ===================== Récurrentes ===================== */
  function renderRecurring() {
    const rules = state.recurring.slice().sort((a, b) => (a.label || '').localeCompare(b.label || ''));
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
      const pillClass = s.settled ? 'status-settled' : 'status-pending';
      const pillLabel = s.settled ? `Réglé le ${formatDateFR(s.settledDate)}` : (s.total > 0 ? 'En attente' : '—');
      return `
        <div class="history-row" data-month="${k}">
          <div class="history-info">
            <div class="history-title">${formatMonthLabel(k)}</div>
            <div class="history-sub">${formatCurrency(s.total)} de dépenses communes</div>
          </div>
          <span class="status-pill ${pillClass}">${pillLabel}</span>
        </div>`;
    }).join('');
  }

  function bindHistoryList() {
    document.getElementById('history-list').addEventListener('click', (e) => {
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
        <div class="budget-line budget-line-total ${b.savings < 0 ? 'negative' : 'positive'}"><span>Épargne estimée</span><span>${formatCurrency(b.savings)}</span></div>
      </div>`).join('');
  }

  function syncSettingsValues() {
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
  }

  function ensureSettingsBuilt() {
    if (settingsBuilt) { syncSettingsValues(); return; }
    settingsBuilt = true;

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
    });

    const loisirsForm = document.getElementById('settings-loisirs-form');
    loisirsForm.addEventListener('input', () => {
      state.people[0].loisirs = parseFloat(loisirsForm.loisirs0.value) || 0;
      state.people[1].loisirs = parseFloat(loisirsForm.loisirs1.value) || 0;
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
      firstSnapshotSeen = true;
      if (data.updatedAt && state.updatedAt && data.updatedAt <= state.updatedAt) {
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

  /* ===================== Modale dépense ===================== */
  function populatePersonSelect() {
    const sel = document.getElementById('expense-person-select');
    sel.innerHTML = state.people.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  }

  function setRecurringUI(isRecurring) {
    expenseForm.isRecurring.value = isRecurring ? 'true' : 'false';
    document.querySelector('.field-group-oneoff').hidden = isRecurring;
    document.querySelector('.field-group-recurring').hidden = !isRecurring;
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
      Object.assign(exp, { label, amount, type, personId, category, splitMode, splitPercent });
      if (!exp.recurringId) exp.date = expenseForm.date.value || exp.date;
    } else {
      state.expenses.push({
        id: Recurring.genId(), label, amount, type, personId, category, splitMode, splitPercent,
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
    expenseForm.addEventListener('submit', handleExpenseSubmit);
    document.getElementById('expense-delete-btn').addEventListener('click', handleExpenseDelete);
    document.getElementById('settle-btn').addEventListener('click', () => {
      const existing = state.settlements[currentMonth];
      if (existing && existing.settled) {
        state.settlements[currentMonth] = { ...existing, settled: false, settledDate: null };
      } else {
        state.settlements[currentMonth] = { settled: true, settledDate: todayStr(), shares: Calculations.computeShares(state.people) };
      }
      persist();
      renderAll();
    });
  }

  /* ===================== Service worker (PWA) ===================== */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const okContext = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!okContext) return;
    navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('Service worker non enregistré :', err));
  }

  /* ===================== Authentification ===================== */
  function showLoginGate() {
    document.getElementById('login-gate').hidden = false;
    document.getElementById('app').hidden = true;
  }

  function showApp() {
    document.getElementById('login-gate').hidden = true;
    document.getElementById('app').hidden = false;
  }

  /* ===================== Démarrage ===================== */
  function startAppFor() {
    firstSnapshotSeen = false;
    try { myPersonId = localStorage.getItem('myPersonId') || (state.people[0] && state.people[0].id) || null; }
    catch (e) { myPersonId = state.people[0] ? state.people[0].id : null; }
    runRecurringGeneration();
    Storage.save(state);
    showApp();
    renderAll();
    showView('dashboard');
    updateSyncBadge();
    startDataSync();
  }

  function init() {
    bindNav();
    bindFilters();
    bindExpenseRowClicks('recent-expenses');
    bindExpenseRowClicks('expenses-full-list');
    bindRecurringList();
    bindHistoryList();
    bindModal();
    bindPersonSwitch();
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
