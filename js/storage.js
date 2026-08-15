/* Storage — lecture/écriture locale (localStorage) + export/import JSON.
   C'est le cache local rapide : chaque écran lit/écrit ici de façon
   synchrone. La synchro Firebase (firebase-sync.js) vient le compléter en
   arrière-plan pour partager les mêmes données entre les deux appareils. */
const Storage = (() => {
  const KEY = 'coupleBudgetData_v1';

  function defaultState() {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      people: [
        { id: 'p1', name: 'Xanthin', salary: 0, loisirs: 0 },
        { id: 'p2', name: 'Ma compagne', salary: 0, loisirs: 0 }
      ],
      expenses: [],
      recurring: [],
      settlements: {}
    };
  }

  function mergeWithDefaults(parsed) {
    const base = defaultState();
    const people = (parsed.people && parsed.people.length === 2)
      ? parsed.people.map((p, i) => ({ ...base.people[i], ...p }))
      : base.people;
    return {
      ...base,
      ...parsed,
      people,
      expenses: parsed.expenses || [],
      recurring: parsed.recurring || [],
      settlements: parsed.settlements || {}
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      return mergeWithDefaults(JSON.parse(raw));
    } catch (e) {
      console.error('Erreur de lecture des données locales', e);
      return defaultState();
    }
  }

  function save(state) {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('Erreur de sauvegarde locale', e);
      return false;
    }
  }

  function exportJSON(state) {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-couple-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importJSONFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try { resolve(mergeWithDefaults(JSON.parse(reader.result))); }
        catch (e) { reject(e); }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  return { defaultState, mergeWithDefaults, load, save, exportJSON, importJSONFile };
})();
