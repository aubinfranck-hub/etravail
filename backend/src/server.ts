import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { checkDatabase } from "./db.js";
import { getCases, openCase, transitionCase } from "./services/caseService.js";
import type { CaseStatus } from "./domain/workflow.js";

const app = express();
const port = Number(process.env.APP_PORT ?? 3000);
const jwtSecret = process.env.JWT_SECRET ?? "development-only-change-me";

app.use(cors());
app.use(express.json({ limit: "2mb" }));

type Role = "CITOYEN" | "GREFFE" | "MAGISTRAT" | "ADMIN";
interface User { id: string; email: string; role: Role; }

const users: User[] = [
  { id: "u-admin", email: "admin@etravail.local", role: "ADMIN" },
  { id: "u-greffe", email: "greffe@etravail.local", role: "GREFFE" },
  { id: "u-magistrat", email: "magistrat@etravail.local", role: "MAGISTRAT" }
];

const permissions: Record<Role, string[]> = {
  CITOYEN: ["case:create", "case:read:own"],
  GREFFE: ["case:read", "case:transition", "case:document"],
  MAGISTRAT: ["case:read", "case:transition", "decision:create"],
  ADMIN: ["case:read", "case:transition", "case:document", "decision:create", "admin:manage"]
};

type AuthedRequest = express.Request & { user?: User };

function auth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Authentification requise" });
  try {
    req.user = jwt.verify(header.slice(7), jwtSecret) as User;
    next();
  } catch {
    res.status(401).json({ error: "Jeton invalide" });
  }
}

function permission(required: string) {
  return (req: AuthedRequest, res: express.Response, next: express.NextFunction) => {
    if (!req.user || !permissions[req.user.role].includes(required)) {
      return res.status(403).json({ error: "Permission refusée" });
    }
    next();
  };
}

app.get("/api/v1/health", async (_req, res) => {
  let database = false;
  try { database = await checkDatabase(); } catch { database = false; }
  res.status(database ? 200 : 503).json({
    service: "etravail-api",
    status: database ? "ok" : "degraded",
    database,
    version: "0.2.0"
  });
});

// Développement uniquement. À remplacer par une authentification de production.
app.post("/api/v1/auth/dev-login", (req, res) => {
  const user = users.find(u => u.email === req.body?.email);
  if (!user) return res.status(401).json({ error: "Utilisateur de développement inconnu" });
  const token = jwt.sign(user, jwtSecret, { expiresIn: "8h" });
  res.json({ token, user });
});

app.get("/api/v1/cases", auth, permission("case:read"), async (_req, res) => {
  try {
    res.json({ data: await getCases() });
  } catch {
    res.status(500).json({ error: "Impossible de récupérer les dossiers" });
  }
});

app.post("/api/v1/cases", auth, permission("case:create"), async (req: AuthedRequest, res) => {
  if (!req.body?.title || typeof req.body.title !== "string") {
    return res.status(400).json({ error: "title est obligatoire" });
  }
  try {
    const item = await openCase({
      claimantId: req.user!.id,
      actorId: req.user!.id,
      title: req.body.title.trim()
    });
    res.status(201).json({ data: item });
  } catch {
    res.status(500).json({ error: "Impossible de créer le dossier" });
  }
});

app.post("/api/v1/cases/:id/transition", auth, permission("case:transition"), async (req: AuthedRequest, res) => {
  const next = req.body?.status as CaseStatus;
  if (!next) return res.status(400).json({ error: "status est obligatoire" });
  try {
    const item = await transitionCase({ id: req.params.id, next, actorId: req.user!.id });
    res.json({ data: item });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    if (code === "CASE_NOT_FOUND") return res.status(404).json({ error: "Dossier introuvable" });
    if (code === "INVALID_TRANSITION") return res.status(422).json({ error: "Transition interdite" });
    res.status(500).json({ error: "Impossible de modifier le dossier" });
  }
});

app.listen(port, () => console.log(`e-Travail API listening on :${port}`));
