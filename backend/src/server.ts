import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";

const app = express();
const port = Number(process.env.APP_PORT ?? 3000);
const jwtSecret = process.env.JWT_SECRET ?? "development-only-change-me";

app.use(cors());
app.use(express.json());

type Role = "CITOYEN" | "GREFFE" | "MAGISTRAT" | "ADMIN";
type CaseStatus =
  | "BROUILLON" | "SOUMIS" | "RECU_GREFFE" | "A_VERIFIER"
  | "COMPLET" | "INCOMPLET" | "CONCILIATION"
  | "AUDIENCE_PLANIFIEE" | "AUDIENCE" | "DECISION_RENDUE"
  | "NOTIFIE" | "ARCHIVE";

interface User { id: string; email: string; role: Role; }
interface CaseFile { id: string; title: string; claimant: string; status: CaseStatus; createdAt: string; }

const users: User[] = [
  { id: "u-admin", email: "admin@etravail.local", role: "ADMIN" },
  { id: "u-greffe", email: "greffe@etravail.local", role: "GREFFE" },
  { id: "u-magistrat", email: "magistrat@etravail.local", role: "MAGISTRAT" }
];

const cases: CaseFile[] = [];

const transitions: Record<CaseStatus, CaseStatus[]> = {
  BROUILLON: ["SOUMIS"],
  SOUMIS: ["RECU_GREFFE"],
  RECU_GREFFE: ["A_VERIFIER"],
  A_VERIFIER: ["COMPLET", "INCOMPLET"],
  COMPLET: ["CONCILIATION"],
  INCOMPLET: ["SOUMIS"],
  CONCILIATION: ["AUDIENCE_PLANIFIEE", "DECISION_RENDUE"],
  AUDIENCE_PLANIFIEE: ["AUDIENCE"],
  AUDIENCE: ["DECISION_RENDUE"],
  DECISION_RENDUE: ["NOTIFIE"],
  NOTIFIE: ["ARCHIVE"],
  ARCHIVE: []
};

const rolePermissions: Record<Role, string[]> = {
  CITOYEN: ["case:create", "case:read:own"],
  GREFFE: ["case:read", "case:transition", "case:document"],
  MAGISTRAT: ["case:read", "case:transition", "decision:create"],
  ADMIN: ["case:read", "case:transition", "case:document", "decision:create", "admin:manage"]
};

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Authentification requise" });
  try {
    const payload = jwt.verify(header.slice(7), jwtSecret) as User;
    (req as express.Request & { user?: User }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Jeton invalide" });
  }
}

function permission(permission: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as express.Request & { user?: User }).user;
    if (!user || !rolePermissions[user.role].includes(permission)) {
      return res.status(403).json({ error: "Permission refusée" });
    }
    next();
  };
}

app.get("/api/v1/health", (_req, res) => {
  res.json({ service: "etravail-api", status: "ok", version: "0.1.0" });
});

// Development login: replace with real identity provider before production.
app.post("/api/v1/auth/dev-login", (req, res) => {
  const user = users.find(u => u.email === req.body?.email);
  if (!user) return res.status(401).json({ error: "Utilisateur de développement inconnu" });
  const token = jwt.sign(user, jwtSecret, { expiresIn: "8h" });
  res.json({ token, user });
});

app.get("/api/v1/cases", auth, permission("case:read"), (_req, res) => {
  res.json({ data: cases });
});

app.post("/api/v1/cases", auth, permission("case:create"), (req, res) => {
  const user = (req as express.Request & { user?: User }).user!;
  const item: CaseFile = {
    id: `CASE-${Date.now()}`,
    title: String(req.body?.title ?? "Sans titre"),
    claimant: user.email,
    status: "BROUILLON",
    createdAt: new Date().toISOString()
  };
  cases.push(item);
  res.status(201).json({ data: item });
});

app.post("/api/v1/cases/:id/transition", auth, permission("case:transition"), (req, res) => {
  const item = cases.find(c => c.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Dossier introuvable" });
  const next = req.body?.status as CaseStatus;
  if (!transitions[item.status].includes(next)) {
    return res.status(422).json({ error: `Transition interdite: ${item.status} -> ${next}` });
  }
  item.status = next;
  res.json({ data: item });
});

app.listen(port, () => console.log(`e-Travail API listening on :${port}`));
