# Wiki-Masters Auto Pack

Extension de navigateur (Manifest V3) pour [wiki-masters.com](https://www.wiki-masters.com) :

- ouverture automatique des packs, défilement des cartes et récap des raretés ;
- pause automatique à la limite quotidienne de packs, avec compte à rebours jusqu'au prochain essai ;
- suivi de collection (pastilles possédée / doublon / nouvelle sur les liens de cartes) ;
- filtre du marché (masquer les offres au-dessus du budget) ;
- vente des doublons et remise en vente des invendus ;
- renchère automatique au palier minimum, jusqu'à un plafond ;
- synchro des stats d'ouverture (packs et raretés) et de la collection vers l'API [`wiki-masters-extension-api`](../wiki-masters-extension-api), avec le pseudo lu dans la session du site.

La vente démarre en **mode simulation** : rien n'est validé tant que ce mode n'est pas désactivé dans la popup. La renchère envoie de vraies mises dès son activation.

## Installation en mode développeur

Le même `manifest.json` sert à Chrome et à Firefox.

### Chrome (et navigateurs Chromium)

1. Ouvrir `chrome://extensions`.
2. Activer le **Mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et choisir le dossier du projet.

Chrome peut afficher deux avertissements sans conséquence : clé `scripts` dans `background` et clé `browser_specific_settings` inconnues (elles sont destinées à Firefox).

Après une modification du code : bouton ↻ sur la fiche de l'extension, puis recharger l'onglet wiki-masters.com.

### Firefox (121 ou plus)

1. Ouvrir `about:debugging#/runtime/this-firefox`.
2. Cliquer sur **Charger un module complémentaire temporaire…** et sélectionner `manifest.json`.
3. **Autoriser l'accès au site** : `about:addons` → Wiki-Masters Auto Pack → onglet **Permissions** → activer l'accès à `wiki-masters.com`. Sans cette étape, l'extension ne fait rien sur le site (Firefox n'accorde pas les `host_permissions` automatiquement en Manifest V3).

À savoir :

- un module temporaire est retiré à chaque redémarrage de Firefox : le recharger depuis `about:debugging` ; les réglages et statistiques sont conservés grâce à l'identifiant fixe (`browser_specific_settings.gecko.id`) ;
- un avertissement sur la permission `declarativeContent` est normal : elle n'existe pas sur Firefox, et l'icône de l'extension y reste active sur tous les sites ;
- après une modification du code : bouton **Recharger** dans `about:debugging`, puis recharger l'onglet.

## Limite quotidienne de packs

Quand le site affiche « Limite quotidienne de paquets atteinte », le pack n'est pas compté et l'ouverture automatique se met en pause 30 minutes. La date du prochain essai est enregistrée dans l'extension. Elle est conservée après une actualisation de la page, dans tous les onglets et après un redémarrage du navigateur.

Sur `/pulls`, un encart au-dessus du récap affiche le temps restant et l'heure du prochain essai. Le bouton **Réessayer maintenant** annule la pause. À la fin du compte à rebours, l'extension retente une ouverture. Si la limite est toujours atteinte, une nouvelle pause démarre.

## Stats partagées et collection

L'extension envoie les stats d'ouverture et la collection du joueur à l'API [`wiki-masters-extension-api`](../wiki-masters-extension-api). Les données sont consultables sur ses pages web.

### Configuration

1. Popup → **⚙ Configuration avancée** → **📊 Synchro des stats** → **URL de l'API** : l'adresse publique de l'API, sans chemin (par exemple `https://stats.example.com`). Puis **Enregistrer**.
2. Ouvrir wiki-masters.com en étant connecté. Le pseudo est lu dans la session du site (`account.js`), et la popup affiche « Pseudo détecté : … ». Sans pseudo détecté, rien n'est envoyé.

La **clé de synchro** est générée à l'installation. Le premier envoi réserve le pseudo pour cette clé. Pour synchroniser depuis un autre navigateur, recopier la clé dans la même section de la configuration avancée.

### Synchro

- La synchro est automatique toutes les heures. Le bouton **⇅ Synchroniser maintenant** de la popup la lance tout de suite.
- **Packs** : chaque pack ouvert reçoit un identifiant unique, et l'API ignore un pack déjà reçu. Remettre le compteur local à zéro ou renvoyer un pack ne crée donc pas de doublon. Un pack n'est retiré du journal local qu'après confirmation du serveur.
- **Collection** : un scan remplace la collection précédente côté serveur.
- **Détail** : le résultat de chaque synchro apparaît dans **📜 Logs** (packs enregistrés, déjà reçus, rejetés, collection envoyée, totaux côté serveur, erreurs). La synchro automatique n'y écrit que si elle envoie quelque chose ou échoue.

### Scan de la collection

1. Aller sur la page **Collection** du site et retirer les filtres (étiquette, rareté, recherche) : le scan ne relève que ce qui est affiché.
2. Cliquer sur **📚 Scanner ma collection**, en bas à gauche.
3. Le scan revient à la page 1, lit chaque page (titre de la carte, rareté, quantité si affichée) et passe à la suivante avec « Suivant ». Le panneau affiche la progression (« Scan : page 12/58 · 240 carte(s)… »).
4. À la fin, la collection est enregistrée et la synchro part aussitôt. Le résultat apparaît dans les logs.

À savoir :

- **Arrêter** interrompt le scan sans rien envoyer, pour ne pas remplacer la collection du serveur par une liste partielle ;
- les cartes du site n'ont pas d'URL : une carte est identifiée par son titre ;
- une carte qui apparaît plusieurs fois est comptée en autant d'exemplaires ;
- après avoir rechargé l'extension, recharger aussi l'onglet (F5) avant de lancer un scan.

## Fichiers

| Fichier | Rôle |
|---|---|
| `manifest.json` | Manifest commun Chrome / Firefox |
| `background.js` | File de vente, remise en vente périodique, synchro avec l'API, logs |
| `content.js` | Ouverture des packs, défilement, raretés, encart récap, pause de la limite quotidienne |
| `collection.js` | Suivi de collection et pastilles sur les cartes |
| `sell.js` | Mise en vente sur la page d'une carte |
| `bid.js` | Renchère automatique sur la page d'une enchère |
| `account.js` | Lecture du pseudo dans la session du site |
| `scan.js` | Scan complet de la collection |
| `popup.html` / `popup.js` | Réglages, logs et configuration avancée |

## Logs

- **Popup → 📜 Logs** : ventes, remises en vente, renchères, synchros et scans. Les entrées de plus de 7 jours sont purgées automatiquement.
- **Console du navigateur (F12)** sur wiki-masters.com, avec un préfixe par script : `[AutoPack]` (packs), `[Collection]` (suivi de collection), `[Scan]` (scan de la collection) et `[Compte]` (détection du pseudo).
