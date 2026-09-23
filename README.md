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
