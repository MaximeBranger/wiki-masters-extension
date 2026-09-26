# Wiki-Masters Auto Pack

Extension de navigateur (Manifest V3) pour [wiki-masters.com](https://www.wiki-masters.com) :

- ouverture automatique des packs, défilement des cartes et récap des raretés ;
- suivi de collection (pastilles possédée / doublon / nouvelle sur les liens de cartes) ;
- filtre du marché (masquer les offres au-dessus du budget) ;
- vente des doublons et remise en vente des invendus ;
- renchère automatique au palier minimum, jusqu'à un plafond.

La vente et la renchère démarrent en **mode simulation** : rien n'est validé tant que ce mode n'est pas désactivé dans la popup.

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

## Fichiers

| Fichier | Rôle |
|---|---|
| `manifest.json` | Manifest commun Chrome / Firefox |
| `background.js` | File de vente, remise en vente périodique, logs |
| `content.js` | Ouverture des packs, défilement, raretés, encart récap |
| `collection.js` | Suivi de collection et pastilles sur les cartes |
| `sell.js` | Mise en vente sur la page d'une carte |
| `bid.js` | Renchère automatique sur la page d'une enchère |
| `popup.html` / `popup.js` | Réglages, logs et configuration avancée |

Les logs du script de page sont visibles dans la console (F12) avec le préfixe `[AutoPack]`.
