# Architecture initiale — e-Travail

## Architecture cible

Frontend
→ API Backend
→ Services métier
→ Base de données
→ Stockage documentaire

Services transverses :
- Authentification
- Autorisation
- Notifications
- Audit
- Recherche
- OCR
- Assistance IA

## Entités principales

- User
- Role
- Permission
- Party
- Case / Dossier
- Claim / Demande
- Document
- LegalReference
- Conciliation
- Hearing
- Decision
- Notification
- AuditLog

## Règles d'architecture

1. Les règles métier sont centralisées côté backend.
2. Les permissions sont vérifiées côté serveur.
3. Les documents sont associés à un dossier et soumis au contrôle d'accès.
4. Les changements d'état importants sont journalisés.
5. Les références juridiques conservent leur source et leur version.
6. Les composants IA sont séparés des mécanismes de décision métier.

## Découpage technique

### frontend/
Interface citoyen et back-office.

### backend/
API, authentification, workflow, règles métier et services.

### database/
Schéma, migrations et données de référence.

### tests/
Tests unitaires, intégration, permissions et workflow.
