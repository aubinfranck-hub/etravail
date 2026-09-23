imp

app.post("/api/v1/documents/:documentId/ocr", auth, permission("case:document"), async (req: AuthedRequest, res) => {
  try {
    const documents=await getDocuments(req.body?.caseId);
    const document=documents.find((d:any)=>d.id===req.params.documentId);
    if (!document) return res.status(404).json({error:"Document introuvable"});
    const buffer=await readDocument(document.storage_key);
    const ocr=await extractText(buffer,"fra");
    if (ocr.status==="COMPLETED") await updateOCRText(document.id,ocr.text);
    res.json({data:{documentId:document.id,status:ocr.status,text:ocr.text,language:ocr.language}});
  } catch {
    res.status(500).json({error:"Échec du traitement OCR"});
  }
});ort express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { checkDatabase } from "./db.js";
import { registerCitizen, authenticate } from "./services/userService.js";
import { getParties, addParty } from "./services/partyService.js";
import { getDocuments, registerDocument } from "./services/documentService.js";
import { getHearings, scheduleHearing } from "./services/hearingService.js";
import { getNotifications, notify } from "./services/notificationService.js";
import { saveDocument, readDocument } from "./storage/localStorage.js";
import { extractText } from "./services/ocrService.js";
import { updateOCRText } from "./repositories/documentRepository.js";
import { searchInDocuments } from "./services/searchService.js";
import multer from "multer";
import { getCases, openCase, transitionCase } from "./services/caseService.js";
import type { CaseStatus } from "./domain/workflow.js";

const app = express();
const port = Number(process.env.APP_PORT ?? 3000);
const jwtSecret = process.env.JWT_SECRET ?? "development-only-change-me";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

app.get("/api/v1/search/documents", auth, permission("case:read"), async (req, res) => {
  const q=String(req.query.q ?? "");
  try { res.json({data:await searchInDocuments(q)}); }
  catch(error) { if(error instanceof Error && error.message==="QUERY_TOO_SHORT") return res.status(400).json({error:"La recherche doit contenir au moins 2 caractères"}); res.status(500).json({error:"Recherche impossible"}); }
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


app.get("/api/v1/cases/:id/hearings", auth, permission("case:read"), async (req, res) => {
  try { res.json({ data: await getHearings(req.params.id) }); }
  catch { res.status(500).json({ error: "Impossible de récupérer les audiences" }); }
});

app.post("/api/v1/cases/:id/hearings", auth, permission("case:transition"), async (req, res) => {
  if (!req.body?.scheduledAt) return res.status(400).json({ error: "scheduledAt est obligatoire" });
  try { res.status(201).json({ data: await scheduleHearing({ caseId:req.params.id, scheduledAt:req.body.scheduledAt, room:req.body.room }) }); }
  catch(error) { const code=error instanceof Error?error.message:"UNKNOWN"; if(code==="INVALID_DATE"||code==="DATE_IN_PAST") return res.status(400).json({error:"Date d'audience invalide"}); res.status(500).json({error:"Impossible de programmer l'audience"}); }
});

app.get("/api/v1/notifications", auth, async (req: AuthedRequest, res) => {
  try { res.json({ data: await getNotifications(req.user!.id) }); }
  catch { res.status(500).json({ error: "Impossible de récupérer les notifications" }); }
});

app.post("/api/v1/notifications", auth, permission("case:transition"), async (req, res) => {
  if (!req.body?.userId || !req.body?.subject || !req.body?.body) return res.status(400).json({error:"userId, subject et body sont obligatoires"});
  try { res.status(201).json({data:await notify({userId:req.body.userId,caseId:req.body.caseId,channel:req.body.channel??"IN_APP",subject:req.body.subject,body:req.body.body})}); }
  catch(error) { if(error instanceof Error && error.message==="INVALID_CHANNEL") return res.status(400).json({error:"Canal invalide"}); res.status(500).json({error:"Impossible de créer la notification"}); }
});

app.post("/api/v1/cases/:id/documents/upload", auth, permission("case:document"), upload.single("file"), async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({error:"Fichier obligatoire"});
  const allowed=["application/pdf","image/jpeg","image/png"];
  if (!allowed.includes(req.file.mimetype)) return res.status(415).json({error:"Type de fichier non autorisé"});
  try {
    const storageKey=await saveDocument(req.file.buffer,req.file.originalname);
    const data=await registerDocument({caseId:req.params.id,uploadedBy:req.user!.id,filename:req.file.originalname,storageKey,mimeType:req.file.mimetype,fileSize:req.file.size});
    const ocr=await extractText(req.file.buffer,"fra");
    if (ocr.status === "COMPLETED") await updateOCRText(data.id,ocr.text);
    const finalData={...data,ocr_text:ocr.text};
    res.status(201).json({data:finalData,ocr:{status:ocr.status,language:ocr.language}});
  } catch { res.status(500).json({error:"Impossible de stocker le document"}); }
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
