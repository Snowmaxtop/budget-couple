// Firebase — connexion anonyme automatique (aucun mot de passe) +
// synchronisation temps réel via Firestore. Module ES, chargé avec
// <script type="module"> dans index.html. Expose ses fonctions sur
// window.FirebaseSync pour que app.js (script classique) puisse les appeler.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInAnonymously
} from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js';
import {
  getFirestore, doc, setDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const SHARED_DOC = doc(db, 'budgets', 'shared');

let unsubscribeSnapshot = null;
let signInAttempted = false;

// Appelle callback(user) dès qu'une session (même anonyme) est active.
// Déclenche automatiquement une connexion anonyme si personne n'est encore
// connecté — aucune saisie de la part de la personne qui utilise l'app.
function ensureSignedIn(callback, onError) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      callback(user);
    } else if (!signInAttempted) {
      signInAttempted = true;
      signInAnonymously(auth).catch(err => { if (onError) onError(err); });
      // onAuthStateChanged sera rappelé automatiquement une fois connecté.
    }
  });
}

// onData(null) signifie « aucun document distant pour l'instant » (première
// utilisation). onData(objet) est appelé immédiatement avec les données
// actuelles, puis à nouveau à chaque changement, sur CET appareil ou l'autre.
function listen(onData, onError) {
  if (unsubscribeSnapshot) unsubscribeSnapshot();
  unsubscribeSnapshot = onSnapshot(
    SHARED_DOC,
    (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) return; // écho de notre propre écriture, déjà appliquée localement
      onData(snapshot.exists() ? snapshot.data() : null);
    },
    (err) => { if (onError) onError(err); }
  );
}

function writeData(data) {
  return setDoc(SHARED_DOC, data);
}

window.FirebaseSync = { ensureSignedIn, listen, writeData };
