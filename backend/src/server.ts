import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { checkDatabase } from "./db.js";
import { registerCitizen, authenticate } from "./services/userService.js";
import { getParties, addParty } from "./services/partyService.js";
import { getDocuments, registerDocument } from "./services/documentService.js";
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

app.post("/api/v1/auth/register", async (req, res) => {\n  if (!req.body?.email || !req.body?.password) return res.status(400).json({ error: "email et password sont obligatoires" });\n  try { const user = await registerCitizen(req.body); res.status(201).json({ data: { id:user.id,email:user.email,role:user.role,fullName:user.full_name } }); }\n  catch (error) { const code=error instanceof Error?error.message:"UNKNOWN"; if(code==="EMAIL_EXISTS") return res.status(409).json({error:"Email déjà utilisé"}); if(code==="PASSWORD_TOO_SHORT") return res.status(400).json({error:"Mot de passe trop court"}); res.status(500).json({error:"Inscription impossible"}); }\n});\n\napp.post("/api/v1/auth/login", async (req, res) => {\n  if (!req.body?.email || !req.body?.password) return res.status(400).json({ error: "email et password sont obligatoires" });\n  try { const user = await authenticate(req.body.email, req.body.password); const token=jwt.sign({id:user.id,email:user.email,role:user.role},jwtSecret,{expiresIn:"8h"}); res.json({token,user:{id:user.id,email:user.email,role:user.role,fullName:user.full_name}}); }\n  catch { res.status(401).json({error:"Identifiants invalides"}); }\n});\n\n// Développement uniquement. À supprimer avant production.
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


app.get("/api/v1/cases/:id/parties", auth, permission("case:read"), async (req, res) => {
  try { res.json({ data: await getParties(req.params.id) }); }
  catch { res.status(500).json({ error: "Impossible de récupérer les parties" }); }
});

app.post("/api/v1/cases/:id/parties", auth, permission("case:document"), async (req: AuthedRequest, res) => {
  if (!req.body?.type || !req.body?.fullName) return res.status(400).json({ error: "type et fullName sont obligatoires" });
  try { res.status(201).json({ data: await addParty({ caseId:req.params.id,type:req.body.type,fullName:req.body.fullName,contact:req.body.contact }) }); }
  catch { res.status(500).json({ error: "Impossible d'ajouter la partie" }); }
});

app.get("/api/v1/cases/:id/documents", auth, permission("case:read"), async (req, res) => {
  try { res.json({ data: await getDocuments(req.params.id) }); }
  catch { res.status(500).json({ error: "Impossible de récupérer les pièces" }); }
});

app.post("/api/v1/cases/:id/documents", auth, permission("case:document"), async (req: AuthedRequest, res) => {
  if (!req.body?.filename || !req.body?.storageKey) return res.status(400).json({ error: "filename et storageKey sont obligatoires" });
  try {
    const data=await registerDocument({caseId:req.params.id,uploadedBy:req.user!.id,filename:req.body.filename,storageKey:req.body.storageKey,mimeType:req.body.mimeType,fileSize:req.body.fileSize});
    res.status(201).json({data});
  } catch(error) {
    const code=error instanceof Error?error.message:"UNKNOWN";
    if(code==="FILE_TYPE_NOT_ALLOWED") return res.status(415).json({error:"Type de fichier non autorisé"});
    if(code==="FILE_TOO_LARGE") return res.status(413).json({error:"Fichier trop volumineux"});
    res.status(500).json({error:"Impossible d'enregistrer la pièce"});
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
