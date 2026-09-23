# Sécurité — e-Travail

## Principes

- Contrôle d'accès côté serveur.
- Principe du moindre privilège.
- Séparation des rôles citoyen, greffe, magistrat et administration.
- Journalisation des actions sensibles.
- Accès aux documents limité au dossier et aux habilitations.
- Secrets uniquement via variables d'environnement.
- Authentification de développement interdite en production.

## Avant production

- Remplacer le compte dev-login.
- Ajouter rotation/expiration contrôlée des secrets.
- Ajouter limitation de débit.
- Ajouter validation stricte des entrées.
- Ajouter antivirus et contrôle des fichiers.
- Chiffrer les sauvegardes.
- Mettre en place supervision et alertes.
