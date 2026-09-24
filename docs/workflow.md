# Workflow applicatif e-Travail — Tribunal du Travail d’Abidjan

## Procédure de référence

1. **SAISINE** — Constitution et dépôt du dossier : procès-verbal de non-conciliation, requête et CNI.
2. **GREFFE** — Réception et enregistrement des dossiers.
3. **CONTRÔLE** — Vérification des dossiers et validation des pièces.
4. **ENRÔLEMENT AU GREFFE** — Formalisation des dossiers, paiement des frais de justice et édition des citations à comparaître.
5. **AUDIENCES** — Deux types : tentative de conciliation et audience publique.
6. **DÉCISIONS** — Enregistrement de la décision.
7. **NOTIFICATION** — Notification de la décision aux parties.
8. **ARCHIVAGE** — Classement et conservation du dossier.

## États techniques

- BROUILLON
- SOUMIS
- RECU_GREFFE
- A_VERIFIER
- COMPLET
- INCOMPLET
- ENROLEMENT
- CONCILIATION
- CONCILIE
- CONCILIATION_ECHEC
- AUDIENCE_PLANIFIEE
- AUDIENCE
- DECISION_RENDUE
- NOTIFIE
- ARCHIVE

Les états **CONCILIATION**, **CONCILIE**, **CONCILIATION_ECHEC**, **AUDIENCE_PLANIFIEE** et **AUDIENCE** sont des sous-états de la rubrique **AUDIENCES**.

## Pièces obligatoires à la saisine

- **PV_NON_CONCILIATION** — Procès-verbal de non-conciliation
- **REQUETE** — Requête
- **CNI** — Carte nationale d'identité

La soumission est bloquée tant que les trois pièces obligatoires ne sont pas fournies. Le passage de **CONTRÔLE** à **COMPLET** exige leur validation par le greffe.

## Règles fondamentales

Toute transition est contrôlée côté serveur, réservée aux rôles habilités, journalisée dans l’audit et soumise aux préconditions de l’étape. Le workflow ne permet pas de sauter une rubrique.
