iapp.use((req:any,res:any,next:any)=>{res.on("finish",()=>{if(req.user&&["POST","PATCH","PUT","DELETE"].includes(req.method)){const caseId=req.params?.id&&req.path.includes("/cases/")?String(req.params.id):undefined;writeAudit({actorId:req.user.id,caseId,action:"HTTP_MUTATION",actorRole:req.user.role,ipAddress:req.ip,userAgent:req.get("user-agent"),metadata:{method:req.method,path:req.path,statusCode:res.statusCode}}).catch(()=>{});}});next();});

mport express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import multer from "multer";
import {checkDatabase} from "./db.js";
import {migrateDatabase} from "./db/migrate.js";
import {registerCitizen,authenticate} from "./services/userService.js";
import {listUsers,updateUserAccess,findUserById} from "./repositories/userRepository.js";
import {getCases,openCase,transitionCase,assignCaseTo,getRequirements,attachRequirementDocument,validateRequirement} from "./services/caseService.js";
import {findCase} from "./repositories/caseRepository.js";
import {getParties,addParty} from "./services/partyService.js";
import {getDocuments,registerDocument} from "./services/documentService.js";
import {findDocumentById,updateOCRText} from "./repositories/documentRepository.js";
import {getHearings,scheduleHearing} from "./services/hearingService.js";
import {getConciliations,scheduleConciliation,getConciliation,updateConciliation} from "./services/conciliationService.js";
import {listCalendar} from "./repositories/calendarRepository.js";
import {getNotifications,notify,markNotificationRead} from "./services/notificationService.js";
import {saveDocument,readDocument} from "./storage/localStorage.js";
import {extractText} from "./services/ocrService.js";
import {searchInDocuments} from "./services/searchService.js";
import {getDashboard} from "./services/dashboardService.js";
import {getDecisions,issueDecision} from "./services/decisionService.js";
import {searchLegal,addLegalSource,assistLegal} from "./services/legalService.js";
import {listAudit,writeAudit} from "./repositories/auditRepository.js";
import {hasPermission,type Role} from "./auth/permissions.js";
import type {CaseStatus} from "./domain/workflow.js";

const app=express(), port=Number(process.env.APP_PORT??3000), isProduction=process.env.APP_ENV==="production"||process.env.NODE_ENV==="production", jwtSecret=process.env.JWT_SECRET??"development-only-change-me";
if(isProduction&&(!process.env.JWT_SECRET||process.env.JWT_SECRET.length<32))throw new Error("JWT_SECRET must be set to at least 32 characters in production");
if(isProduction&&!process.env.CORS_ORIGIN)throw new Error("CORS_ORIGIN must be set in production");
app.use(cors({origin:process.env.CORS_ORIGIN?.split(",")??true}));
app.use(express.json({limit:"2mb"}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024}});

const rateBuckets=new Map<string,{count:number;resetAt:number}>();
function rateLimit(limit:number,windowMs:number){
  return (req:express.Request,res:express.Response,next:express.NextFunction)=>{
    const key=req.ip??"unknown";
    const now=Date.now();
    const current=rateBuckets.get(key);
    if(!current||current.resetAt<=now){
      rateBuckets.set(key,{count:1,resetAt:now+windowMs});
      return next();
    }
    current.count++;
    if(current.count>limit){
      res.setHeader("Retry-After",String(Math.ceil((current.resetAt-now)/1000)));
      return res.status(429).json({error:"Trop de requêtes. Réessayez plus tard."});
    }
    next();
  };
}

const router:any=app;
type User={id:string;email:string;role:Role;};
type Req=express.Request<Record<string,string>>&{user?:User};

async function auth(req:Req,res:express.Response,next:express.NextFunction){const h=req.headers.authorization;if(!h?.startsWith("Bearer "))return res.status(401).json({error:"Authentification requise"});try{const token=jwt.verify(h.slice(7),jwtSecret) as User;const current=await findUserById(token.id);if(!current||!current.active)return res.status(401).json({error:"Compte inactif ou introuvable"});req.user={id:current.id,email:current.email,role:current.role};next();}catch{return res.status(401).json({error:"Jeton invalide"});}}
function permission(p:string){return (req:Req,res:express.Response,next:express.NextFunction)=>req.user&&hasPermission(req.user.role,p)?next():res.status(403).json({error:"Permission refusée"});}
async function caseAccess(req:Req,id:string,write=false){const c=await findCase(id);if(!c)return null;if(req.user?.role==="CITOYEN"&&c.claimant_id!==req.user.id)return false;if((req.user?.role==="GREFFE"||req.user?.role==="MAGISTRAT")&&c.assigned_to!==req.user.id)return false;if(write&&!req.user?.role)return false;return c;}
function handleError(res:express.Response,e:unknown,fallback:string){const code=e instanceof Error?e.message:"";const map:Record<string,[number,string]>={INVALID_SOURCE_URL:[400,"URL de source invalide"],FILE_SIGNATURE_INVALID:[415,"Contenu de fichier invalide"],INVALID_DATE:[400,"Date invalide"],DATE_IN_PAST:[400,"La date doit être future"],INVALID_STATUS:[400,"Statut invalide"],INVALID_CHANNEL:[400,"Canal invalide"],QUERY_TOO_SHORT:[400,"La recherche doit contenir au moins 2 caractères"],FILE_TYPE_NOT_ALLOWED:[415,"Type de fichier non autorisé"],FILE_TOO_LARGE:[413,"Fichier trop volumineux"],CASE_NOT_FOUND:[404,"Dossier introuvable"],INVALID_TRANSITION:[422,"Transition interdite"],DECISION_TOO_SHORT:[400,"Décision trop courte"]};const x=map[code];return x?res.status(x[0]).json({error:x[1]}):res.status(500).json({error:fallback});}

router.get("/api/v1/health",async(_req:express.Request,res:express.Response)=>{let database=false;try{database=await checkDatabase();}catch{}res.status(database?200:503).json({service:"etravail-api",status:database?"ok":"degraded",database,version:"0.3.0"});});
router.post("/api/v1/auth/register",rateLimit(10,15*60*1000),async(req:express.Request,res:express.Response)=>{if(!req.body?.email||!req.body?.password)return res.status(400).json({error:"email et password sont obligatoires"});try{const u=await registerCitizen(req.body);res.status(201).json({data:{id:u.id,email:u.email,role:u.role,fullName:u.full_name}});}catch(e){const c=e instanceof Error?e.message:"";return res.status(c==="EMAIL_EXISTS"?409:400).json({error:c==="EMAIL_EXISTS"?"Email déjà utilisé":c==="PASSWORD_TOO_SHORT"?"Mot de passe trop court":"Inscription impossible"});}});
router.post("/api/v1/auth/login",rateLimit(10,15*60*1000),async(req:express.Request,res:express.Response)=>{if(!req.body?.email||!req.body?.password)return res.status(400).json({error:"email et password sont obligatoires"});try{const u=await authenticate(req.body.email,req.body.password);const token=jwt.sign({id:u.id,email:u.email,role:u.role},jwtSecret,{expiresIn:"8h"});res.json({token,user:{id:u.id,email:u.email,role:u.role,fullName:u.full_name}});}catch{res.status(401).json({error:"Identifiants invalides"});}});

router.get("/api/v1/dashboard",auth,async(req:Req,res:express.Response)=>{try{res.json({data:await getDashboard(req.user!.role,req.user!.id)});}catch(e){handleError(res,e,"Tableau de bord indisponible");}});
router.get("/api/v1/cases",auth,async(req:Req,res:express.Response)=>{try{if(!req.user)return res.status(401).end();const all=await getCases();if(req.user.role==="CITOYEN")return res.json({data:all.filter(c=>c.claimant_id===req.user!.id)});if(!hasPermission(req.user.role,"case:read"))return res.status(403).json({error:"Permission refusée"});if(req.user.role==="ADMIN")return res.json({data:all});return res.json({data:all.filter(c=>c.assigned_to===req.user!.id)});}catch(e){handleError(res,e,"Impossible de récupérer les dossiers");}});
router.post("/api/v1/cases",auth,permission("case:create"),async(req:Req,res:express.Response)=>{if(!req.body?.title)return res.status(400).json({error:"title est obligatoire"});try{res.status(201).json({data:await openCase({claimantId:req.user!.id,actorId:req.user!.id,title:String(req.body.title).trim(),natureCode:req.body?.natureCode})});}catch(e){handleError(res,e,"Impossible de créer le dossier");}});
router.post("/api/v1/cases/:id/transition",auth,async(req:Req,res:express.Response)=>{try{const current=await caseAccess(req,req.params.id,true);if(!current)return res.status(current===null?404:403).json({error:current===null?"Dossier introuvable":"Accès refusé"});const next=req.body?.status as CaseStatus;const citizenOwnSubmit=req.user!.role==="CITOYEN"&&current.status==="BROUILLON"&&next==="SOUMIS";if(!citizenOwnSubmit&&!hasPermission(req.user!.role,"case:transition"))return res.status(403).json({error:"Permission refusée"});const item=await transitionCase({id:req.params.id,next,actorId:req.user!.id,actorRole:req.user!.role});const c=await findCase(req.params.id);if(c)await notify({userId:c.claimant_id,caseId:c.id,channel:"IN_APP",subject:"Mise à jour du dossier",body:`Le dossier ${c.reference} est maintenant au statut ${item?.status}.`});res.json({data:item});}catch(e){handleError(res,e,"Impossible de modifier le dossier");}});
router.get("/api/v1/cases/:id/parties",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getParties(req.params.id)});}catch(e){handleError(res,e,"Impossible de récupérer les parties");}});
router.post("/api/v1/cases/:id/parties",auth,permission("case:document"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});if(!req.body?.type||!req.body?.fullName)return res.status(400).json({error:"type et fullName sont obligatoires"});try{res.status(201).json({data:await addParty({caseId:req.params.id,type:req.body.type,fullName:req.body.fullName,contact:req.body.contact})});}catch(e){handleError(res,e,"Impossible d'ajouter la partie");}});
router.get("/api/v1/cases/:id/documents/:documentId/download",auth,async(req:Req,res:express.Response)=>{
  try{
    const d=await findDocumentById(req.params.documentId);
    if(!d||d.case_id!==req.params.id)return res.status(404).json({error:"Document introuvable"});
    const a=await caseAccess(req,d.case_id);
    if(!a)return res.status(403).json({error:"Accès refusé"});
    const buffer=await readDocument(d.storage_key);
    res.setHeader("Content-Type",d.mime_type||"application/octet-stream");
    res.setHeader("Content-Disposition",`attachment; filename="${encodeURIComponent(d.filename)}"`);
    res.send(buffer);
  }catch(e){handleError(res,e,"Impossible de télécharger le document");}
});

router.get("/api/v1/cases/:id/documents",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getDocuments(req.params.id)});}catch(e){handleError(res,e,"Impossible de récupérer les pièces");}});
router.post("/api/v1/cases/:id/documents/upload",auth,upload.single("file"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});if(!req.user||(!hasPermission(req.user.role,"case:document")&&req.user.role!=="CITOYEN"))return res.status(403).json({error:"Permission refusée"});if(!req.file)return res.status(400).json({error:"Fichier obligatoire"});try{const key=await saveDocument(req.file.buffer,req.file.originalname);const d=await registerDocument({caseId:req.params.id,uploadedBy:req.user!.id,filename:req.file.originalname,storageKey:key,mimeType:req.file.mimetype,fileSize:req.file.size,fileData:req.file.buffer});if(req.body?.requirementId)await attachRequirementDocument(req.params.id,String(req.body.requirementId),d.id,req.user!.id);const o=await extractText(req.file.buffer,"fra");if(o.status==="COMPLETED")await updateOCRText(d.id,o.text);res.status(201).json({data:{...d,ocr_text:o.text},ocr:{status:o.status,language:o.language}});}catch(e){handleError(res,e,"Impossible de stocker le document");}});
router.post("/api/v1/documents/:documentId/ocr",auth,permission("case:document"),async(req:Req,res:express.Response)=>{try{const d=await findDocumentById(req.params.documentId);if(!d)return res.status(404).json({error:"Document introuvable"});const a=await caseAccess(req,d.case_id);if(!a)return res.status(403).json({error:"Accès refusé"});const o=await extractText(await readDocument(d.storage_key),"fra");if(o.status==="COMPLETED")await updateOCRText(d.id,o.text);res.json({data:{documentId:d.id,status:o.status,text:o.text,language:o.language}});}catch(e){handleError(res,e,"Échec du traitement OCR");}});

router.get("/api/v1/cases/:id/hearings",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getHearings(req.params.id)});}catch(e){handleError(res,e,"Impossible de récupérer les audiences");}});
router.post("/api/v1/cases/:id/hearings",auth,permission("hearing:manage"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{const h=await scheduleHearing({caseId:req.params.id,scheduledAt:req.body?.scheduledAt,room:req.body?.room});const c=await findCase(req.params.id);if(c)await notify({userId:c.claimant_id,caseId:c.id,channel:"IN_APP",subject:"Audience programmée",body:`Une audience a été programmée pour le dossier ${c.reference} le ${new Date(h.scheduled_at).toLocaleString("fr-FR")}.`});res.status(201).json({data:h});}catch(e){handleError(res,e,"Impossible de programmer l'audience");}});
router.get("/api/v1/cases/:id/conciliations",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getConciliations(req.params.id)});}catch(e){handleError(res,e,"Impossible de récupérer les conciliations");}});
router.post("/api/v1/cases/:id/conciliations",auth,permission("hearing:manage"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{const x=await scheduleConciliation({caseId:req.params.id,scheduledAt:req.body?.scheduledAt,room:req.body?.room,createdBy:req.user!.id,notes:req.body?.notes});const c=await findCase(req.params.id);if(c)await notify({userId:c.claimant_id,caseId:c.id,channel:"IN_APP",subject:"Conciliation programmée",body:`Une conciliation a été programmée pour le dossier ${c.reference} le ${new Date(x.scheduled_at).toLocaleString("fr-FR")}.`});res.status(201).json({data:x});}catch(e){handleError(res,e,"Impossible de programmer la conciliation");}});
router.patch("/api/v1/conciliations/:id",auth,permission("hearing:manage"),async(req:Req,res:express.Response)=>{try{const existing=await getConciliation(req.params.id);if(!existing)return res.status(404).json({error:"Conciliation introuvable"});const a=await caseAccess(req,existing.case_id);if(!a)return res.status(403).json({error:"Accès refusé"});const status=String(req.body?.status??"");
    const updated=await updateConciliation(req.params.id,status,req.body?.notes);
    if(status==="ACCORD"){
      await transitionCase({id:existing.case_id,next:"CONCILIE",actorId:req.user!.id,actorRole:req.user!.role});
    }else if(status==="ECHEC"){
      await transitionCase({id:existing.case_id,next:"CONCILIATION_ECHEC",actorId:req.user!.id,actorRole:req.user!.role});
    }
    res.json({data:updated});}catch(e){handleError(res,e,"Impossible de modifier la conciliation");}});
router.get("/api/v1/cases/:id/requirements",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getRequirements(req.params.id)});}catch(e){handleError(res,e,"Exigences du dossier indisponibles");}});
router.patch("/api/v1/cases/:id/requirements/:requirementId/validate",auth,permission("case:document"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id,true);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{const valid=req.body?.valid===true;const item=await validateRequirement(req.params.id,req.params.requirementId,req.user!.id,valid,req.body?.reason);res.json({data:item});}catch(e){handleError(res,e,"Validation de pièce impossible");}});
router.get("/api/v1/calendar",auth,async(req:Req,res:express.Response)=>{try{res.json({data:await listCalendar(req.user!.role,req.user!.id,req.query.caseId?String(req.query.caseId):undefined)});}catch(e){handleError(res,e,"Calendrier indisponible");}});

router.get("/api/v1/notifications",auth,async(req:Req,res:express.Response)=>{try{res.json({data:await getNotifications(req.user!.id)});}catch(e){handleError(res,e,"Impossible de récupérer les notifications");}});
router.patch("/api/v1/notifications/:id/read",auth,async(req:Req,res:express.Response)=>{try{res.json({data:await markNotificationRead(req.params.id,req.user!.id)});}catch(e){handleError(res,e,"Notification introuvable");}});
router.post("/api/v1/notifications",auth,permission("notification:manage"),async(req:Req,res:express.Response)=>{if(!req.body?.userId||!req.body?.subject||!req.body?.body)return res.status(400).json({error:"userId, subject et body sont obligatoires"});try{res.status(201).json({data:await notify({userId:req.body.userId,caseId:req.body.caseId,channel:req.body.channel??"IN_APP",subject:req.body.subject,body:req.body.body})});}catch(e){handleError(res,e,"Impossible de créer la notification");}});
router.get("/api/v1/cases/:id/audit",auth,permission("case:read"),async(req:Req,res:express.Response)=>{try{res.json({data:await listAudit(req.params.id)});}catch(e){handleError(res,e,"Journal d'audit indisponible");}});
router.get("/api/v1/cases/:id/decisions",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});if(req.user?.role!=="CITOYEN"&&!hasPermission(req.user!.role,"case:read"))return res.status(403).json({error:"Permission refusée"});try{res.json({data:await getDecisions(req.params.id)});}catch(e){handleError(res,e,"Impossible de récupérer les décisions");}});
router.post("/api/v1/cases/:id/decisions",auth,permission("decision:create"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});if(!req.body?.content)return res.status(400).json({error:"content est obligatoire"});try{const d=await issueDecision({caseId:req.params.id,reference:req.body.reference,content:req.body.content});await writeAudit({actorId:req.user!.id,caseId:req.params.id,action:"DECISION_CREATED",metadata:{decisionId:d.id}});res.status(201).json({data:d});}catch(e){handleError(res,e,"Impossible d'enregistrer la décision");}});
router.patch("/api/v1/admin/cases/:id/assignment",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
 try{
  const assignedTo=req.body?.assignedTo?String(req.body.assignedTo):null;
  const assignedRole=req.body?.assignedRole?String(req.body.assignedRole):null;
  if(assignedTo){const u=await findUserById(assignedTo);if(!u||!u.active||!["GREFFE","MAGISTRAT"].includes(u.role))return res.status(400).json({error:"Agent d'affectation invalide"});}
  if(assignedRole&&!["GREFFE","MAGISTRAT"].includes(assignedRole))return res.status(400).json({error:"Rôle d'affectation invalide"});
  const data=await assignCaseTo({id:req.params.id,assignedTo,assignedRole,actorId:req.user!.id,reason:req.body?.reason?String(req.body.reason):undefined});
  res.json({data});
 }catch(e){handleError(res,e,"Impossible d'affecter le dossier");}
});
router.patch("/api/v1/admin/users/:id",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
  const role=req.body?.role as Role;
  const active=Boolean(req.body?.active);
  if(!["CITOYEN","GREFFE","MAGISTRAT","ADMIN"].includes(role))return res.status(400).json({error:"Rôle invalide"});
  try{
    const updated=await updateUserAccess(req.params.id,{role,active});
    if(!updated)return res.status(404).json({error:"Utilisateur introuvable"});
    await writeAudit({actorId:req.user!.id,action:"USER_ACCESS_CHANGED",metadata:{userId:updated.id,role:updated.role,active:updated.active}});
    res.json({data:updated});
  }catch(e){handleError(res,e,"Impossible de modifier l'utilisateur");}
});
router.get("/api/v1/admin/audit",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{try{res.json({data:await import("./repositories/auditRepository.js").then(m=>m.listAuditAll(Number(req.query.limit??500)))})}catch(e){handleError(res,e,"Audit global indisponible");}});
router.get("/api/v1/admin/users",auth,permission("admin:manage"),async(_req:Req,res:express.Response)=>{
  try{res.json({data:await listUsers()});}catch(e){handleError(res,e,"Impossible de récupérer les utilisateurs");}
});
router.get("/api/v1/legal/sources",auth,permission("legal:read"),async(req:Req,res:express.Response)=>{
  try{res.json({data:await searchLegal(String(req.query.q??""))});}catch(e){handleError(res,e,"Recherche juridique impossible");}
});
router.post("/api/v1/ai/assist",rateLimit(20,10*60*1000),auth,permission("legal:read"),async(req:Req,res:express.Response)=>{
  if(!req.body?.question)return res.status(400).json({error:"question obligatoire"});
  try{
    const caseId=req.body?.caseId?String(req.body.caseId):undefined;
    if(caseId){
      const a=await caseAccess(req,caseId);
      if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
    }
    res.json({data:await assistLegal({userId:req.user!.id,caseId,question:String(req.body.question)})});
  }catch(e){handleError(res,e,"Assistance juridique indisponible");}
});
router.post("/api/v1/admin/legal/sources",auth,permission("legal:manage"),async(req:Req,res:express.Response)=>{
  try{const source=await addLegalSource({...req.body,createdBy:req.user!.id});await writeAudit({actorId:req.user!.id,action:"LEGAL_SOURCE_CREATED",metadata:{sourceId:source.id,title:source.title}});res.status(201).json({data:source});}
  catch(e){const c=e instanceof Error?e.message:"";res.status(c==="LEGAL_SOURCE_REQUIRED"?400:500).json({error:c==="LEGAL_SOURCE_REQUIRED"?"Titre, type et contenu sont obligatoires":"Impossible d'ajouter la source juridique"});}
});
router.get("/api/v1/search/documents",auth,permission("case:read"),async(req:Req,res:express.Response)=>{try{res.json({data:await searchInDocuments(String(req.query.q??""))});}catch(e){handleError(res,e,"Recherche impossible");}});

async function bootstrap(){
  try{
    await checkDatabase();
    console.log("Database connection verified");
    await migrateDatabase();
    console.log("Database schema verified");
  }catch(error){console.error("Database connection failed",error);process.exit(1)}
  app.listen(port,()=>console.log(`e-Travail API listening on :${port}`));
}
bootstrap();
