# Budget à Deux

Application de gestion de budget en couple : dépenses personnelles et communes,
répartition automatique au prorata des salaires, dépenses récurrentes, suivi
mensuel des remboursements. HTML/CSS/JS pur, sans build, installable en PWA,
hébergée sur GitHub Pages et synchronisée en temps réel via Firebase.

## Structure

```
budget-couple/
├── index.html               # structure de l'app
├── manifest.json            # métadonnées PWA
├── service-worker.js        # cache hors-ligne
├── css/style.css
├── js/
│   ├── storage.js           # cache local (localStorage) + export/import JSON
│   ├── firebase-config.js   # VOS identifiants de projet Firebase (à remplir)
│   ├── firebase-sync.js     # connexion anonyme + synchro Firestore temps réel
│   ├── calculations.js      # prorata + soldes mensuels
│   ├── recurring.js         # génération des dépenses récurrentes
│   └── app.js                # état, rendu, événements
├── fonts/                   # Manrope, auto-hébergée
└── icons/
```

Le site est hébergé simplement (GitHub Pages, comme un site statique
classique). Les données, elles, vivent dans un projet Firebase (Firestore)
que vous créez vous-même. La connexion à Firebase est automatique et
invisible (pas de mot de passe) — voir la note sécurité plus bas.

## Lancer en local

```bash
cd budget-couple
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

Un vrai serveur est nécessaire : le module Firebase est chargé en tant que
module JavaScript, que les navigateurs bloquent par sécurité sur `file://`.

## Mettre en ligne avec GitHub Pages (sans terminal)

Tout se fait par glisser-déposer sur le site github.com, sans installer ni
taper aucune commande.

1. Sur **github.com**, cliquez sur **« New »** (ou le **+** en haut à
   droite → « New repository ») pour créer un dépôt, par exemple nommé
   `budget-couple`.
2. Sur la page du dépôt fraîchement créé, cliquez sur **« uploading an
   existing file »** (ou plus tard : bouton **« Add file » → « Upload
   files »**).
3. Ouvrez le dossier `budget-couple` dézippé sur votre ordinateur, **sélectionnez
   tout son contenu** (les fichiers et dossiers `index.html`, `css`, `js`,
   `icons`, `fonts`, `manifest.json`, etc. — pas le dossier `budget-couple`
   lui-même, son *contenu*), et glissez-le dans la zone d'upload de GitHub.
   GitHub conserve automatiquement la structure des sous-dossiers.
4. Ajoutez un message de commit (ex. « premier envoi »), cliquez sur
   **« Commit changes »**.
5. Dans **Settings → Pages** du dépôt, choisissez la branche `main` et le
   dossier `/root`, sauvegardez. GitHub vous donne une URL en
   `https://votre-pseudo.github.io/budget-couple/`.
6. Pour une future mise à jour d'un fichier : ouvrez-le dans GitHub (cliquez
   dessus dans la liste des fichiers), cliquez sur l'icône crayon **« Edit »**,
   modifiez, puis **« Commit changes »**. Pour remplacer plusieurs fichiers
   d'un coup, repassez par **« Add file » → « Upload files »** : un fichier
   déposé avec le même nom et le même chemin remplace l'ancien.

## Installer sur téléphone (PWA)

Une fois le site ouvert en HTTPS :
- **Android / Chrome** : menu ⋮ → *Ajouter à l'écran d'accueil*.
- **iPhone / Safari** : bouton Partager → *Sur l'écran d'accueil*.

---

## Configurer Firebase (à faire une seule fois)

Firebase est le service gratuit de Google qui stocke vos données et les
synchronise en temps réel entre vos appareils. Pas de terminal, pas de
compte à créer pour vous ou votre compagne — tout se passe dans le
navigateur, en 5 étapes, ~10 minutes.

### Étape 1 — Créer le projet Firebase

1. Allez sur **console.firebase.google.com** et connectez-vous avec un compte
   Google (créez-en un si besoin, c'est gratuit).
2. Cliquez sur **« Ajouter un projet »**.
3. Donnez-lui un nom, par exemple `budget-couple`.
4. Quand on vous propose Google Analytics, **désactivez-le** (pas utile ici).
5. Cliquez sur **« Créer le projet »**.

### Étape 2 — Déclarer une application Web

1. Sur la page d'accueil du projet, cliquez sur l'icône **`</>`** (« Web »).
2. Donnez un surnom à l'app, par exemple `budget-web`.
3. **Ne cochez pas** « Configurer Firebase Hosting » (vous utilisez GitHub
   Pages).
4. Cliquez sur **« Enregistrer l'application »**.
5. Firebase affiche un bloc `const firebaseConfig = { ... }`. Gardez cette
   page ouverte, vous en avez besoin à l'étape 5.

### Étape 3 — Activer Firestore (la base de données)

1. Menu de gauche : **Build → Firestore Database**.
2. Cliquez sur **« Créer une base de données »**.
3. Choisissez un emplacement proche de vous (ex. `eur3 (europe-west)`).
4. Laissez le mode **production** sélectionné, puis **« Activer »**.

### Étape 4 — Autoriser l'accès et activer la connexion anonyme

1. Dans Firestore Database, onglet **« Règles »**. Effacez tout et collez :

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /budgets/shared {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

   Cliquez sur **« Publier »**.

2. Menu de gauche : **Build → Authentication → « Get started »**
   (première visite). Onglet **« Sign-in method »** → cliquez sur
   **« Anonymous »** → activez l'interrupteur → **« Save »**.

   C'est tout : l'app se connectera toute seule, sans email ni mot de passe,
   dès qu'elle s'ouvre.

### Étape 5 — Coller la configuration dans le projet

1. Ouvrez `js/firebase-config.js` et remplacez les valeurs `REMPLACER_...`
   par celles copiées à l'étape 2 :

   ```js
   export const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "budget-couple-xxxxx.firebaseapp.com",
     projectId: "budget-couple-xxxxx",
     storageBucket: "budget-couple-xxxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```

2. Enregistrez. Si le fichier est déjà en ligne sur GitHub, ouvrez-le dans
   le dépôt (`js/firebase-config.js`), cliquez sur l'icône crayon **« Edit »**
   en haut à droite du fichier, collez le contenu modifié, puis **« Commit
   changes »** — pas besoin de le re-glisser depuis votre ordinateur.
   GitHub Pages se met à jour automatiquement en quelques dizaines de
   secondes.
3. Ouvrez le site sur votre PC et vos téléphones : ça se connecte tout seul,
   aucun écran de connexion à remplir.

---

## ⚠️ À savoir sur la sécurité de ce choix

Sans mot de passe, l'accès aux données repose uniquement sur le fait de
**connaître l'adresse du site**. Toute personne qui tomberait sur votre URL
GitHub Pages pourrait, en théorie, lire et modifier vos dépenses. Pour un
usage privé à deux avec une URL que vous ne partagez pas publiquement,
c'est un compromis raisonnable — mais ce n'est pas la même protection
qu'un vrai compte avec mot de passe. Si un jour ça vous gêne, on pourra
remettre une vraie connexion par email/mot de passe (ce qu'on avait avant),
sans tout reconstruire.

## Comment marche la synchro des données

- Chaque modification s'envoie vers Firestore ~1,5 seconde après la saisie.
- Les changements de l'autre appareil arrivent **en direct**, sans recharger
  la page.
- Un badge en haut de l'écran indique l'état : *Synchronisé*, *Modifications
  en attente…*, ou *Erreur de synchro*.
- En cas d'erreur, **Réglages → Synchronisation → Renvoyer maintenant**
  relance l'envoi manuellement.

**Limite à connaître :** pas de fusion intelligente si vous modifiez tous les
deux exactement au même instant — le dernier envoi gagne. Dans l'usage
courant, ça ne pose pas de problème en pratique.

## Répartition au prorata

Le pourcentage de chacun se recalcule en direct à partir des salaires saisis
dans Réglages (`salaire A / (salaire A + salaire B)`). Un mois marqué comme
« réglé » fige le pourcentage utilisé ce mois-là.

## Coût

Le tier gratuit de Firebase (Spark) inclut 50 000 lectures et 20 000
écritures par jour sur Firestore, très largement au-dessus de ce qu'un usage
à deux personnes consomme. Aucun moyen de paiement n'est demandé à la
création du projet. GitHub Pages est gratuit également.

## Pistes d'évolution possibles

- Historique des salaires (au lieu d'une seule valeur courante)
- Notifications pour les échéances récurrentes à venir
- Objectifs d'épargne commune
- Mode sombre
- Vraie authentification par mot de passe, si le compromis sécurité actuel
  ne convient plus

---

Fait avec Claude — n'hésite pas à revenir ici pour continuer à faire évoluer
l'app avec ta compagne.
