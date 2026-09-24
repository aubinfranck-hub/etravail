# e-Travail

Plateforme numérique dédiée à la gestion et au suivi des procédures liées aux litiges du travail.

> **Important :** e-Travail est une plateforme numérique d'accompagnement et de gestion des dossiers. Elle ne constitue pas un tribunal et ne remplace pas les autorités judiciaires, les magistrats, le greffe ou les professionnels du droit.

## Vision

Centraliser, sécuriser et tracer le parcours d'un dossier de travail : préparation, saisine, traitement administratif, conciliation, audience, décision, notification et archivage.

## Périmètre fonctionnel

- Espace citoyen / partie
- Création et suivi de dossiers
- Dépôt et gestion des pièces
- OCR et indexation documentaire
- Gestion du greffe
- Conciliation
- Gestion des audiences
- Gestion des décisions
- Notifications
- Calendrier et échéances
- Administration et habilitations
- Journal d'audit
- Recherche juridique avec sources
- Assistance IA encadrée et traçable

## Principes

- Sécurité et confidentialité des dossiers
- Contrôle d'accès par rôles et permissions
- Traçabilité des actions
- Référencement des sources juridiques
- Aucune décision judiciaire automatisée par l'IA
- Architecture évolutive et testable

## Workflow applicatif initial

BROUILLON → SOUMIS → REÇU_GREFFE → À_VÉRIFIER → COMPLET/INCOMPLET → CONCILIATION → AUDIENCE_PLANIFIÉE → AUDIENCE → DÉCISION_RENDUE → NOTIFIÉ → ARCHIVÉ

Ce workflow applicatif devra être aligné avec les règles de procédure effectivement applicables avant mise en production.

## Structure

- `docs/` — documentation fonctionnelle et technique
- `backend/` — API et logique métier
- `frontend/` — interface utilisateur
- `database/` — schémas et migrations
- `tests/` — tests automatisés

## Statut

**Phase 1 — Initialisation du socle**

## Vérification des paiements

Le paiement d'un dossier peut être validé par un **code externe** émis par la comptabilité, la caisse ou un système tiers.

1. L'administration configure le montant et la devise du dossier.
2. La comptabilité/caisse transmet un code à usage unique avec la source, le montant et la référence externe via l'intégration sécurisée.
3. Le greffe ou l'administration saisit le code dans e-Travail.
4. Le système vérifie le code, le montant et la devise, puis le consomme définitivement.
5. La validation est inscrite dans le journal d'audit avec la source, la référence, le montant et l'horodatage.
6. L'enrôlement est bloqué tant qu'un paiement obligatoire n'est pas en statut **PAYE** ou **EXONERE**.

L'intégration externe utilise la variable d'environnement `PAYMENT_VALIDATION_API_KEY` et l'en-tête `X-Payment-Validation-Key`.

## Contrôle d'intégrité de l'audit

L'administration dispose de l'endpoint authentifié `GET /api/v1/admin/audit/integrity`.
Il vérifie séquentiellement la chaîne des événements d'audit et signale le premier événement dont le `previous_hash` ou le `event_hash` ne correspond plus au calcul attendu.

Les écritures d'audit sont sérialisées dans une transaction PostgreSQL afin d'éviter que deux écritures concurrentes produisent le même précédent de chaîne.

## Tests

Le backend exécute les tests Node natifs avant la compilation TypeScript. Les tests métier couvrent notamment la matrice des transitions, les rôles autorisés, les affectations automatiques et la classification des natures de litige.

## Statut technique

**Phase 1 — Socle fonctionnel + workflow contrôlé + validation paiement externe + audit intégrité
