/* GitHubBackup — sauvegarde automatique en parallèle de Firebase. Firebase
   reste la synchro en direct entre les deux appareils ; ce module se
   contente d'écrire (et, si besoin, relire) une copie complète des données
   dans un fichier du dépôt GitHub, via l'API Contents et un token d'accès
   personnel propre à cet appareil. */
const GitHubBackup = (() => {
  const API = 'https://api.github.com';

  function b64Encode(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function b64Decode(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function getFile(cfg) {
    const { owner, repo, branch, path, token } = cfg;
    const res = await fetch(
      `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch || 'main')}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (res.status === 404) return { sha: null, data: null };
    if (!res.ok) throw new Error(await describeError(res));
    const json = await res.json();
    return { sha: json.sha, data: JSON.parse(b64Decode(json.content)) };
  }

  async function putFile(cfg, data, sha) {
    const { owner, repo, branch, path, token } = cfg;
    const body = {
      message: `Sauvegarde budget – ${new Date().toLocaleString('fr-FR')}`,
      content: b64Encode(JSON.stringify(data, null, 2)),
      branch: branch || 'main'
    };
    if (sha) body.sha = sha;
    const res = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(await describeError(res));
    return res.json();
  }

  async function describeError(res) {
    if (res.status === 401) return 'Token invalide ou expiré';
    if (res.status === 403) return 'Accès refusé — vérifiez les permissions du token';
    if (res.status === 409) return 'Conflit sur le fichier — réessayez dans un instant';
    try {
      const err = await res.json();
      return err.message || `Erreur GitHub (${res.status})`;
    } catch (_) {
      return `Erreur GitHub (${res.status})`;
    }
  }

  return { getFile, putFile };
})();
