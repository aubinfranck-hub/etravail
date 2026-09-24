import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import multer from "multer";
import {checkDatabase,pool} from "./db.js";
import {migrateDatabase} from "./db/migrate.js";
import {registerCitizen,authenticate,createStaffAccount} from "./services/userService.js";
import {listUsers,updateUserAccess,findUserById} from "./repositories/userRepository.js";
import {getCases,openCase,updateCaseBasics,transitionCase,assignCaseTo,getRequirements,getEnrollment,getWorkflowQuestions,saveCaseAnswer,ensureRequiredQuestionsAnswered,ensureRequirementCanReceive,attachRequirementDocument,validateRequirement,getRequirementHistory,reassignCasesFromUser,ensureCaseMutationAllowed} from "./services/caseService.js";
import {findCase} from "./repositories/caseRepository.js";
import {getParties,addParty} from "./services/partyService.js";
import {getDocuments,registerDocument} from "./services/documentService.js";
import {findDocumentById,updateOCRText} from "./repositories/documentRepository.js";
import {getHearings,scheduleHearing,hearingStageAllowed} from "./services/hearingService.js";
import {getConciliations,scheduleConciliation,getConciliation,updateConciliation,conciliationStageAllowed} from "./services/conciliationService.js";
import {listCalendar} from "./repositories/calendarRepository.js";
import {getNotifications,notify,markNotificationRead} from "./services/notificationService.js";
import {saveDocument,readDocument} from "./storage/localStorage.js";
import {extractText} from "./services/ocrService.js";
import {searchInDocuments} from "./services/searchService.js";
import {getDashboard} from "./services/dashboardService.js";
import {getDecisions,issueDecision,decisionStageAllowed} from "./services/decisionService.js";
import {searchLegal,addLegalSource,assistLegal} from "./services/legalService.js";
import {listAudit,writeAudit,verifyAuditChain} from "./repositories/auditRepository.js";
import {hasPermission,listPermissions,setPermission,type Role} from "./auth/permissions.js";
import {stageForStatus} from "./domain/workflow.js";
import type {CaseStatus} from "./domain/workflow.js";
import {setupPayment,getPayment,registerExternalValidationCode,verifyPaymentByExternalCode,exemptPayment,confirmExternalPayment} from "./services/paymentService.js";
import {getCaseSmsTracking,purchaseCaseSmsTracking,validateCaseSmsPayment,setCaseSmsTrackingOption} from "./services/smsService.js";
import {listWorkflowRequirements,createWorkflowRequirement,updateWorkflowRequirement} from "./services/workflowRequirementService.js";

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
function externalPaymentAuth(req:express.Request,res:express.Response,next:express.NextFunction){
 const configured=process.env.PAYMENT_VALIDATION_API_KEY;
 const supplied=String(req.headers["x-payment-validation-key"]??"");
 if(!configured||!supplied||supplied.length!==configured.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(configured))) return res.status(401).json({error:"Clé d'intégration paiement invalide"});
 next();
}
async function caseAccess(req:Req,id:string,write=false){const c=await findCase(id);if(!c)return null;if(req.user?.role==="CITOYEN"&&c.claimant_id!==req.user.id)return false;if((req.user?.role==="GREFFE"||req.user?.role==="MAGISTRAT")&&c.assigned_to!==req.user.id)return false;if(write&&!req.user?.role)return false;return c;}
function handleError(res:express.Response,e:unknown,fallback:string){const code=e instanceof Error?e.message:"";const map:Record<string,[number,string]>={INVALID_SOURCE_URL:[400,"URL de source invalide"],FILE_SIGNATURE_INVALID:[415,"Contenu de fichier invalide"],INVALID_DATE:[400,"Date invalide"],DATE_IN_PAST:[400,"La date doit être future"],INVALID_STATUS:[400,"Statut invalide"],INVALID_CHANNEL:[400,"Canal invalide"],QUERY_TOO_SHORT:[400,"La recherche doit contenir au moins 2 caractères"],FILE_TYPE_NOT_ALLOWED:[415,"Type de fichier non autorisé"],FILE_TOO_LARGE:[413,"Fichier trop volumineux"],CASE_NOT_FOUND:[404,"Dossier introuvable"],INVALID_TRANSITION:[422,"Transition interdite"],ROLE_CANNOT_TRANSITION:[403,"Ce rôle ne peut pas effectuer cette transition"],REQUIRED_DOCUMENTS_MISSING:[422,"Les pièces obligatoires doivent être déposées avant la soumission"],REQUIRED_DOCUMENTS_NOT_VALIDATED:[422,"Toutes les pièces obligatoires doivent être validées avant de clôturer le contrôle"],REQUIREMENT_NOT_FOUND:[404,"Exigence de pièce introuvable"],DOCUMENT_CASE_MISMATCH:[422,"La pièce sélectionnée n'appartient pas à ce dossier"],REQUIREMENT_ALREADY_VALIDATED:[409,"Cette pièce est déjà validée et ne peut pas être remplacée"],REQUIREMENT_DOCUMENT_REQUIRED:[422,"Un document doit être déposé avant validation"],REQUIREMENT_NOT_RECEIVED:[422,"La pièce doit être au statut reçue avant validation"],REQUIREMENT_NOT_APPLICABLE:[422,"Cette pièce n'est pas applicable à la situation déclarée"],DOCUMENT_SELF_VALIDATION_FORBIDDEN:[403,"Un agent ne peut pas valider la pièce qu'il a lui-même déposée"],REQUIREMENT_REJECTION_REASON_REQUIRED:[400,"Le motif de rejet est obligatoire"],NO_ACTIVE_ASSIGNMENT_AGENT:[409,"Aucun agent actif disponible pour l’affectation automatique"],NOTIFICATION_NOT_FOUND:[404,"Notification introuvable"],DECISION_TOO_SHORT:[400,"Décision trop courte"],INVALID_PAYMENT_AMOUNT:[400,"Montant de paiement invalide"],PAYMENT_CODE_REQUIRED:[400,"Code externe de paiement obligatoire"],INVALID_PAYMENT_SOURCE:[400,"Source de validation de paiement invalide"],INVALID_PAYMENT_CURRENCY:[400,"Devise de paiement invalide"],INVALID_WORKFLOW_STAGE:[422,"Cette action n'est pas autorisée à cette étape du dossier"],DECISION_REQUIRED:[422,"Une décision doit être enregistrée avant de passer à l'étape suivante"],HEARING_REQUIRED:[422,"Une audience planifiée est requise avant de passer à l'audience"],PAYMENT_NOT_SETUP:[422,"Les frais du dossier ne sont pas configurés"],PAYMENT_AMOUNT_MISMATCH:[422,"Le montant du code de validation ne correspond pas aux frais du dossier"],PAYMENT_CURRENCY_MISMATCH:[422,"La devise du code de validation ne correspond pas aux frais du dossier"],PAYMENT_CODE_INVALID_OR_USED:[422,"Code de validation externe invalide ou déjà utilisé"],PAYMENT_NOT_VERIFIED:[422,"Le paiement doit être validé par la comptabilité ou la caisse avant l’enrôlement"],PAYMENT_ALREADY_FINALIZED:[409,"Les frais d'un paiement déjà payé ou exonéré ne peuvent plus être modifiés"],PAYMENT_ALREADY_EXONERATED:[409,"Le dossier est déjà exonéré de paiement"],PAYMENT_CODE_ALREADY_REGISTERED:[409,"Ce code de validation est déjà enregistré pour ce dossier"],PAYMENT_EXEMPTION_REASON_REQUIRED:[400,"Le motif d'exonération est obligatoire"],ENROLLMENT_CASE_NOT_COMPLETE:[422,"Le dossier doit être complet avant l’enrôlement"],SMS_PHONE_REQUIRED:[400,"Numéro de téléphone requis pour les SMS"],SMS_OPTION_DISABLED:[422,"Le suivi SMS n’est pas activé pour ce dossier"],SMS_PACKAGE_NOT_PAID:[422,"Le forfait SMS de ce dossier n’est pas encore payé"],SMS_PACKAGE_NOT_PURCHASED:[422,"Aucun forfait SMS n’a été demandé pour ce dossier"],SMS_PACKAGE_EXPIRED:[422,"Le forfait SMS de ce dossier est expiré"],SMS_QUOTA_EXHAUSTED:[422,"Le quota SMS de ce dossier est épuisé"],SMS_CASE_CLOSED:[409,"Le suivi SMS est arrêté car le dossier est archivé"],SMS_CASE_ACCESS_DENIED:[403,"Le forfait SMS doit être rattaché au dossier du demandeur"],SMS_PROVIDER_NOT_CONFIGURED:[503,"Le service SMS n’est pas configuré"],SMS_PROVIDER_FAILED:[502,"Le prestataire SMS n’a pas accepté l’envoi"],INVALID_SMS_CREDIT:[400,"Crédit SMS invalide"],REQUIRED_QUESTIONS_MISSING:[422,"Les questions obligatoires doivent être renseignées avant la soumission"],QUESTION_NOT_FOUND:[404,"Question de dossier introuvable"],ANSWER_REQUIRED:[400,"Réponse obligatoire"],ANSWER_TYPE_INVALID:[400,"Format de réponse invalide"],ANSWER_OPTION_INVALID:[400,"Option de réponse invalide"],CASE_ENROLLMENT_LOCKED:[409,"Le dossier est verrouillé après enrôlement : cette modification n’est plus autorisée"],WORKFLOW_REQUIREMENT_REQUIRED:[400,"Code et libellé de pièce obligatoires"],INVALID_NATURE:[400,"Nature de dossier invalide"],INVALID_DEADLINE:[400,"Délai invalide"],INVALID_SORT_ORDER:[400,"Ordre de tri invalide"],ADMIN_MANAGE_REQUIRED:[422,"La permission admin:manage doit rester active pour préserver l’accès d’administration"]};const x=map[code];return x?res.status(x[0]).json({error:x[1]}):res.status(500).json({error:fallback});}

app.use((req:any,res:any,next:any)=>{res.on("finish",()=>{if(req.user&&["POST","PATCH","PUT","DELETE"].includes(req.method)){const caseId=req.params?.id&&req.path.includes("/cases/")?String(req.params.id):undefined;writeAudit({actorId:req.user.id,caseId,action:"HTTP_MUTATION",actorRole:req.user.role,ipAddress:req.ip,userAgent:req.get("user-agent"),metadata:{method:req.method,path:req.path,statusCode:res.statusCode}}).catch(()=>{});}});next();});

router.get("/api/v1/health",async(_req:express.Request,res:express.Response)=>{let database=false;try{database=await checkDatabase();}catch{}res.status(database?200:503).json({service:"etravail-api",status:database?"ok":"degraded",database,version:"0.3.0"});});
router.post("/api/v1/auth/register",rateLimit(10,15*60*1000),async(req:express.Request,res:express.Response)=>{if(!req.body?.email||!req.body?.password)return res.status(400).json({error:"email et password sont obligatoires"});try{const u=await registerCitizen(req.body);res.status(201).json({data:{id:u.id,email:u.email,role:u.role,fullName:u.full_name}});}catch(e){const c=e instanceof Error?e.message:"";return res.status(c==="EMAIL_EXISTS"?409:400).json({error:c==="EMAIL_EXISTS"?"Email déjà utilisé":c==="PASSWORD_TOO_SHORT"?"Mot de passe trop court":"Inscription impossible"});}});
router.post("/api/v1/auth/login",rateLimit(10,15*60*1000),async(req:express.Request,res:express.Response)=>{if(!req.body?.email||!req.body?.password)return res.status(400).json({error:"email et password sont obligatoires"});try{const u=await authenticate(req.body.email,req.body.password);const token=jwt.sign({id:u.id,email:u.email,role:u.role},jwtSecret,{expiresIn:"8h"});res.json({token,user:{id:u.id,email:u.email,role:u.role,fullName:u.full_name}});}catch{res.status(401).json({error:"Identifiants invalides"});}});

router.get("/api/v1/dashboard",auth,async(req:Req,res:express.Response)=>{try{res.json({data:await getDashboard(req.user!.role,req.user!.id)});}catch(e){handleError(res,e,"Tableau de bord indisponible");}});
router.get("/api/v1/cases",auth,async(req:Req,res:express.Response)=>{try{if(!req.user)return res.status(401).end();const all=await getCases();if(req.user.role==="CITOYEN")return res.json({data:all.filter(c=>c.claimant_id===req.user!.id)});if(!hasPermission(req.user.role,"case:read"))return res.status(403).json({error:"Permission refusée"});if(req.user.role==="ADMIN")return res.json({data:all});return res.json({data:all.filter(c=>c.assigned_to===req.user!.id)});}catch(e){handleError(res,e,"Impossible de récupérer les dossiers");}});
router.post("/api/v1/cases",auth,permission("case:create"),async(req:Req,res:express.Response)=>{if(!req.body?.title)return res.status(400).json({error:"title est obligatoire"});try{res.status(201).json({data:await openCase({claimantId:req.user!.id,actorId:req.user!.id,title:String(req.body.title).trim(),natureCode:req.body?.natureCode})});}catch(e){handleError(res,e,"Impossible de créer le dossier");}});
router.patch("/api/v1/cases/:id/basics",auth,async(req:Req,res:express.Response)=>{
 try{
  const a=await caseAccess(req,req.params.id,true);
  if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  if(req.user!.role!=="CITOYEN"&&req.user!.role!=="ADMIN")return res.status(403).json({error:"Permission refusée"});
  const data=await updateCaseBasics(req.params.id,{title:req.body?.title,natureCode:req.body?.natureCode},req.user!.id);
  res.json({data});
 }catch(e){handleError(res,e,"Impossible de mettre à jour le dossier");}
});
router.get("/api/v1/cases/:id/questions",auth,async(req:Req,res:express.Response)=>{
 try{
  const a=await caseAccess(req,req.params.id);
  if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  res.json({data:await getWorkflowQuestions(req.params.id,"SAISINE",String(a.nature_code??"AUTRE"))});
 }catch(e){handleError(res,e,"Questions du dossier indisponibles");}
});
router.put("/api/v1/cases/:id/questions/:questionId",auth,async(req:Req,res:express.Response)=>{
 try{
  const a=await caseAccess(req,req.params.id,true);
  if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  if(req.user!.role!=="ADMIN") await ensureCaseMutationAllowed(req.params.id,req.user!.role,"ANSWER_QUESTION");
  if(!["CITOYEN","GREFFE","MAGISTRAT","ADMIN"].includes(req.user!.role))return res.status(403).json({error:"Permission refusée"});
  const value=req.body?.value;
  const data=await saveCaseAnswer(req.params.id,req.params.questionId,value,req.user!.id);
  res.json({data});
 }catch(e){handleError(res,e,"Impossible d'enregistrer la réponse");}
});
router.post("/api/v1/cases/:id/transition",auth,async(req:Req,res:express.Response)=>{try{const current=await caseAccess(req,req.params.id,true);if(!current)return res.status(current===null?404:403).json({error:current===null?"Dossier introuvable":"Accès refusé"});const next=req.body?.status as CaseStatus;const citizenOwnSubmit=req.user!.role==="CITOYEN"&&current.status==="BROUILLON"&&next==="SOUMIS";if(next==="SOUMIS"){await ensureRequiredQuestionsAnswered(req.params.id,"SAISINE",String(current.nature_code??"AUTRE"));}if(!citizenOwnSubmit&&!hasPermission(req.user!.role,"case:transition"))return res.status(403).json({error:"Permission refusée"});const item=await transitionCase({id:req.params.id,next,actorId:req.user!.id,actorRole:req.user!.role});const c=await findCase(req.params.id);if(c)await notify({userId:c.claimant_id,caseId:c.id,channel:"IN_APP",subject:"Mise à jour du dossier",body:`Le dossier ${c.reference} est maintenant au statut ${item?.status}.`});res.json({data:item});}catch(e){handleError(res,e,"Impossible de modifier le dossier");}});
router.get("/api/v1/cases/:id/parties",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getParties(req.params.id)});}catch(e){handleError(res,e,"Impossible de récupérer les parties");}});
router.post("/api/v1/cases/:id/parties",auth,permission("case:document"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});if(!req.body?.type||!req.body?.fullName)return res.status(400).json({error:"type et fullName sont obligatoires"});try{await ensureCaseMutationAllowed(req.params.id,req.user!.role,"ADD_PARTY");res.status(201).json({data:await addParty({caseId:req.params.id,type:req.body.type,fullName:req.body.fullName,contact:req.body.contact})});}catch(e){handleError(res,e,"Impossible d'ajouter la partie");}});
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
router.post("/api/v1/cases/:id/documents/upload",auth,upload.single("file"),async(req:Req,res:express.Response)=>{try{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});if(!req.user||(!hasPermission(req.user.role,"case:document")&&req.user.role!=="CITOYEN"))return res.status(403).json({error:"Permission refusée"});if(req.user.role!=="ADMIN")await ensureCaseMutationAllowed(req.params.id,req.user.role,"UPLOAD_DOCUMENT");if(!req.file)return res.status(400).json({error:"Fichier obligatoire"});if(req.body?.requirementId) await ensureRequirementCanReceive(req.params.id,String(req.body.requirementId));
  const key=await saveDocument(req.file.buffer,req.file.originalname);const d=await registerDocument({caseId:req.params.id,uploadedBy:req.user!.id,filename:req.file.originalname,storageKey:key,mimeType:req.file.mimetype,fileSize:req.file.size,fileData:req.file.buffer});if(req.body?.requirementId)await attachRequirementDocument(req.params.id,String(req.body.requirementId),d.id,req.user!.id);const o=await extractText(req.file.buffer,"fra");if(o.status==="COMPLETED")await updateOCRText(d.id,o.text);res.status(201).json({data:{...d,ocr_text:o.text},ocr:{status:o.status,language:o.language}});}catch(e){handleError(res,e,"Impossible de stocker le document");}});
router.post("/api/v1/documents/:documentId/ocr",auth,permission("case:document"),async(req:Req,res:express.Response)=>{try{const d=await findDocumentById(req.params.documentId);if(!d)return res.status(404).json({error:"Document introuvable"});const a=await caseAccess(req,d.case_id);if(!a)return res.status(403).json({error:"Accès refusé"});const o=await extractText(await readDocument(d.storage_key),"fra");if(o.status==="COMPLETED")await updateOCRText(d.id,o.text);res.json({data:{documentId:d.id,status:o.status,text:o.text,language:o.language}});}catch(e){handleError(res,e,"Échec du traitement OCR");}});

router.get("/api/v1/cases/:id/hearings",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getHearings(req.params.id)});}catch(e){handleError(res,e,"Impossible de récupérer les audiences");}});
router.post("/api/v1/cases/:id/hearings",auth,permission("hearing:manage"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{if(!hearingStageAllowed(a.status))throw new Error("INVALID_WORKFLOW_STAGE");const h=await scheduleHearing({caseId:req.params.id,scheduledAt:req.body?.scheduledAt,room:req.body?.room});const c=await findCase(req.params.id);if(c)await notify({userId:c.claimant_id,caseId:c.id,channel:"IN_APP",subject:"Audience programmée",body:`Une audience a été programmée pour le dossier ${c.reference} le ${new Date(h.scheduled_at).toLocaleString("fr-FR")}.`});res.status(201).json({data:h});}catch(e){handleError(res,e,"Impossible de programmer l'audience");}});
router.get("/api/v1/cases/:id/conciliations",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getConciliations(req.params.id)});}catch(e){handleError(res,e,"Impossible de récupérer les conciliations");}});
router.post("/api/v1/cases/:id/conciliations",auth,permission("hearing:manage"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{if(!conciliationStageAllowed(a.status))throw new Error("INVALID_WORKFLOW_STAGE");const x=await scheduleConciliation({caseId:req.params.id,scheduledAt:req.body?.scheduledAt,room:req.body?.room,createdBy:req.user!.id,notes:req.body?.notes});const c=await findCase(req.params.id);if(c)await notify({userId:c.claimant_id,caseId:c.id,channel:"IN_APP",subject:"Conciliation programmée",body:`Une conciliation a été programmée pour le dossier ${c.reference} le ${new Date(x.scheduled_at).toLocaleString("fr-FR")}.`});res.status(201).json({data:x});}catch(e){handleError(res,e,"Impossible de programmer la conciliation");}});
router.patch("/api/v1/conciliations/:id",auth,permission("hearing:manage"),async(req:Req,res:express.Response)=>{try{const existing=await getConciliation(req.params.id);if(!existing)return res.status(404).json({error:"Conciliation introuvable"});const a=await caseAccess(req,existing.case_id);if(!a)return res.status(403).json({error:"Accès refusé"});const status=String(req.body?.status??"");
    if(existing.status==="PLANIFIEE"&&status==="EN_COURS"){}
    else if(existing.status==="EN_COURS"&&!["ACCORD","ECHEC","ANNULEE"].includes(status))throw new Error("INVALID_STATUS");
    else if(existing.status==="PLANIFIEE"&&!["EN_COURS","ANNULEE"].includes(status))throw new Error("INVALID_STATUS");
    const updated=await updateConciliation(req.params.id,status,req.body?.notes);
    await writeAudit({actorId:req.user!.id,caseId:existing.case_id,action:"CONCILIATION_STATUS_CHANGED",metadata:{conciliationId:existing.id,from:existing.status,to:status,notes:req.body?.notes??null}});
    if(status==="ACCORD"){
      await transitionCase({id:existing.case_id,next:"CONCILIE",actorId:req.user!.id,actorRole:req.user!.role});
    }else if(status==="ECHEC"){
      await transitionCase({id:existing.case_id,next:"CONCILIATION_ECHEC",actorId:req.user!.id,actorRole:req.user!.role});
    }
    res.json({data:updated});}catch(e){handleError(res,e,"Impossible de modifier la conciliation");}});
router.post("/api/v1/integrations/payment/validation-code",externalPaymentAuth,async(req:express.Request,res:express.Response)=>{
 try{
  const caseId=String(req.body?.caseId??"");
  const source=String(req.body?.source??"") as "COMPTABILITE"|"CAISSE"|"EXTERNE";
  const code=String(req.body?.code??"");
  const amount=Number(req.body?.amount);
  if(!caseId||!["COMPTABILITE","CAISSE","EXTERNE"].includes(source)||!code||!Number.isFinite(amount)) return res.status(400).json({error:"caseId, source, code et amount sont obligatoires"});
  const data=await confirmExternalPayment({caseId,code,source,externalReference:req.body?.externalReference,amount,currency:req.body?.currency});
  res.status(200).json({data});
 }catch(e){handleError(res,e,"Enregistrement du code externe impossible");}
});

router.get("/api/v1/cases/:id/payment",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getPayment(req.params.id)});}catch(e){handleError(res,e,"État du paiement indisponible");}});
router.get("/api/v1/cases/:id/enrollment",auth,async(req:Req,res:express.Response)=>{
 try{
  const a=await caseAccess(req,req.params.id);
  if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  res.json({data:await getEnrollment(req.params.id)});
 }catch(e){handleError(res,e,"État de l’enrôlement indisponible");}
});

router.post("/api/v1/admin/cases/:id/payment/setup",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
 try{const a=await caseAccess(req,req.params.id,true);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  await ensureCaseMutationAllowed(req.params.id,req.user!.role,"SETUP_PAYMENT");const data=await setupPayment({caseId:req.params.id,feeAmount:Number(req.body?.feeAmount),currency:req.body?.currency,actorId:req.user!.id});res.json({data});
 }catch(e){handleError(res,e,"Configuration du paiement impossible");}
});

router.post("/api/v1/admin/cases/:id/payment/exempt",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
 try{
  const a=await caseAccess(req,req.params.id,true);
  if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  const data=await exemptPayment({caseId:req.params.id,actorId:req.user!.id,reason:String(req.body?.reason??"")});
  res.json({data});
 }catch(e){handleError(res,e,"Exonération du paiement impossible");}
});

router.post("/api/v1/admin/cases/:id/payment/validation-code",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
 try{const a=await caseAccess(req,req.params.id,true);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  const source=String(req.body?.source??"") as "COMPTABILITE"|"CAISSE"|"EXTERNE";
  if(!["COMPTABILITE","CAISSE","EXTERNE"].includes(source))return res.status(400).json({error:"Source de validation invalide"});
  const data=await registerExternalValidationCode({caseId:req.params.id,code:String(req.body?.code??""),source,externalReference:req.body?.externalReference,amount:Number(req.body?.amount),currency:req.body?.currency,actorId:req.user!.id});
  res.status(201).json({data});
 }catch(e){handleError(res,e,"Enregistrement du code externe impossible");}
});

router.post("/api/v1/cases/:id/payment/verify",auth,async(req:Req,res:express.Response)=>{
 try{const a=await caseAccess(req,req.params.id,true);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  if(!["GREFFE","ADMIN"].includes(req.user!.role))return res.status(403).json({error:"Seul le greffe ou l'administration peut valider le paiement"});
  const data=await verifyPaymentByExternalCode({caseId:req.params.id,code:String(req.body?.code??""),actorId:req.user!.id});
  res.json({data});
 }catch(e){handleError(res,e,"Vérification du paiement impossible");}
});

router.get("/api/v1/admin/workflow/requirements",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{try{res.json({data:await listWorkflowRequirements(req.query.status?String(req.query.status):undefined,req.query.natureCode?String(req.query.natureCode):undefined)});}catch(e){handleError(res,e,"Exigences de workflow indisponibles");}});

router.post("/api/v1/admin/workflow/requirements",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
 try{
  const item=await createWorkflowRequirement({status:String(req.body?.status??"SOUMIS"),natureCode:req.body?.natureCode?String(req.body.natureCode):null,code:String(req.body?.code??""),label:String(req.body?.label??""),required:req.body?.required!==false,deadlineHours:req.body?.deadlineHours==null?undefined:Number(req.body.deadlineHours),sortOrder:req.body?.sortOrder==null?0:Number(req.body.sortOrder),actorId:req.user!.id});
  res.status(201).json({data:item});
 }catch(e){handleError(res,e,"Création de l'exigence impossible");}
});

router.patch("/api/v1/admin/workflow/requirements/:id",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
 try{
  const item=await updateWorkflowRequirement(req.params.id,{status:req.body?.status,natureCode:req.body?.natureCode,code:req.body?.code,label:req.body?.label,required:req.body?.required,deadlineHours:req.body?.deadlineHours,sortOrder:req.body?.sortOrder,active:req.body?.active,actorId:req.user!.id});
  if(!item)return res.status(404).json({error:"Exigence introuvable"});
  res.json({data:item});
 }catch(e){handleError(res,e,"Modification de l'exigence impossible");}
});

router.get("/api/v1/cases/:id/requirements",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getRequirements(req.params.id)});}catch(e){handleError(res,e,"Exigences du dossier indisponibles");}});
router.patch("/api/v1/cases/:id/requirements/:requirementId/validate",auth,permission("case:document"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id,true);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});if(!["GREFFE","MAGISTRAT","ADMIN"].includes(req.user!.role))return res.status(403).json({error:"Seul le greffe, le magistrat ou l'administration peut valider une pièce"});try{const valid=req.body?.valid===true;await ensureCaseMutationAllowed(req.params.id,req.user!.role,"VALIDATE_REQUIREMENT");const item=await validateRequirement(req.params.id,req.params.requirementId,req.user!.id,valid,req.body?.reason);res.json({data:item});}catch(e){handleError(res,e,"Validation de pièce impossible");}});
router.get("/api/v1/cases/:id/requirements/:requirementId/history",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});try{res.json({data:await getRequirementHistory(req.params.id,req.params.requirementId)});}catch(e){handleError(res,e,"Historique de la pièce indisponible");}});
router.get("/api/v1/calendar",auth,async(req:Req,res:express.Response)=>{try{res.json({data:await listCalendar(req.user!.role,req.user!.id,req.query.caseId?String(req.query.caseId):undefined)});}catch(e){handleError(res,e,"Calendrier indisponible");}});

router.get("/api/v1/notifications",auth,async(req:Req,res:express.Response)=>{try{res.json({data:await getNotifications(req.user!.id)});}catch(e){handleError(res,e,"Impossible de récupérer les notifications");}});
router.patch("/api/v1/notifications/:id/read",auth,async(req:Req,res:express.Response)=>{try{res.json({data:await markNotificationRead(req.params.id,req.user!.id)});}catch(e){handleError(res,e,"Notification introuvable");}});
router.get("/api/v1/cases/:id/sms-tracking",auth,async(req:Req,res:express.Response)=>{
  const a=await caseAccess(req,req.params.id);
  if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  try{res.json({data:await getCaseSmsTracking(req.params.id)});}catch(e){handleError(res,e,"Suivi SMS indisponible");}
});
router.post("/api/v1/cases/:id/sms-tracking/purchase",auth,async(req:Req,res:express.Response)=>{
  const a=await caseAccess(req,req.params.id,true);
  if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  if(req.user!.role!=="CITOYEN")return res.status(403).json({error:"Seul le demandeur peut souscrire le forfait SMS"});
  try{res.status(201).json({data:await purchaseCaseSmsTracking(req.params.id,req.user!.id)});}catch(e){handleError(res,e,"Souscription du forfait SMS impossible");}
});
router.patch("/api/v1/cases/:id/sms-tracking/option",auth,async(req:Req,res:express.Response)=>{
  const a=await caseAccess(req,req.params.id,true);
  if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  if(req.user!.role!=="CITOYEN")return res.status(403).json({error:"Seul le demandeur peut modifier son suivi SMS"});
  try{
    const data=await setCaseSmsTrackingOption(req.params.id,req.user!.id,req.body?.enabled===true);
    await writeAudit({actorId:req.user!.id,caseId:req.params.id,action:"SMS_TRACKING_OPTION_CHANGED",metadata:{enabled:data.enabled}});
    res.json({data});
  }catch(e){handleError(res,e,"Modification du suivi SMS impossible");}
});
router.post("/api/v1/admin/cases/:id/sms-tracking/validate",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
  const a=await caseAccess(req,req.params.id,true);
  if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});
  try{
    const data=await validateCaseSmsPayment(req.params.id,req.user!.id,req.body?.paymentReference?String(req.body.paymentReference):undefined);
    res.json({data});
  }catch(e){handleError(res,e,"Validation du paiement du forfait SMS impossible");}
});

router.post("/api/v1/notifications",auth,permission("notification:manage"),async(req:Req,res:express.Response)=>{if(!req.body?.userId||!req.body?.subject||!req.body?.body)return res.status(400).json({error:"userId, subject et body sont obligatoires"});try{res.status(201).json({data:await notify({userId:req.body.userId,caseId:req.body.caseId,channel:req.body.channel??"IN_APP",subject:req.body.subject,body:req.body.body})});}catch(e){handleError(res,e,"Impossible de créer la notification");}});
router.get("/api/v1/cases/:id/audit",auth,permission("case:read"),async(req:Req,res:express.Response)=>{try{res.json({data:await listAudit(req.params.id)});}catch(e){handleError(res,e,"Journal d'audit indisponible");}});
router.get("/api/v1/cases/:id/decisions",auth,async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});if(req.user?.role!=="CITOYEN"&&!hasPermission(req.user!.role,"case:read"))return res.status(403).json({error:"Permission refusée"});try{res.json({data:await getDecisions(req.params.id)});}catch(e){handleError(res,e,"Impossible de récupérer les décisions");}});
router.post("/api/v1/cases/:id/decisions",auth,permission("decision:create"),async(req:Req,res:express.Response)=>{const a=await caseAccess(req,req.params.id);if(!a)return res.status(a===null?404:403).json({error:a===null?"Dossier introuvable":"Accès refusé"});if(!req.body?.content)return res.status(400).json({error:"content est obligatoire"});try{if(!decisionStageAllowed(a.status))throw new Error("INVALID_WORKFLOW_STAGE");const d=await issueDecision({caseId:req.params.id,reference:req.body.reference,content:req.body.content});await writeAudit({actorId:req.user!.id,caseId:req.params.id,action:"DECISION_CREATED",metadata:{decisionId:d.id}});const caseItem=await findCase(req.params.id);if(caseItem)await notify({userId:caseItem.claimant_id,caseId:caseItem.id,channel:"IN_APP",subject:"Décision enregistrée",body:`Une décision a été enregistrée pour le dossier ${caseItem.reference}.`});res.status(201).json({data:d});}catch(e){handleError(res,e,"Impossible d'enregistrer la décision");}});
router.patch("/api/v1/admin/cases/:id/assignment",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
 try{
  const assignedTo=req.body?.assignedTo?String(req.body.assignedTo):null;
  const assignedRole=req.body?.assignedRole?String(req.body.assignedRole):null;
  if(assignedTo){const u=await findUserById(assignedTo);if(!u||!u.active||!["GREFFE","MAGISTRAT"].includes(u.role))return res.status(400).json({error:"Agent d'affectation invalide"}); const currentCase=await findCase(req.params.id); const stage=currentCase?stageForStatus[currentCase.status as CaseStatus]:null; if(stage){const access=await pool.query("SELECT 1 FROM user_stage_access WHERE user_id=$1 AND stage_key=$2 LIMIT 1",[assignedTo,stage]); if(!access.rowCount)return res.status(400).json({error:"Cet agent n'est pas habilité pour l'étape actuelle"});}}
  if(assignedTo&&!assignedRole)return res.status(400).json({error:"Le rôle est obligatoire pour une affectation"});
  if(assignedTo&&assignedRole){const target=await findUserById(assignedTo);if(!target||target.role!==assignedRole)return res.status(400).json({error:"Le rôle choisi ne correspond pas à l'agent"});}
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
    const before=await findUserById(req.params.id);
    if(!before)return res.status(404).json({error:"Utilisateur introuvable"});
    const accessChanges=before.active!==active || before.role!==role;
    if(accessChanges && before.active) await reassignCasesFromUser(before.id,req.user!.id);
    const updated=await updateUserAccess(req.params.id,{role,active});
    if(!updated)return res.status(404).json({error:"Utilisateur introuvable"});
    await writeAudit({actorId:req.user!.id,action:"USER_ACCESS_CHANGED",metadata:{userId:updated.id,fromRole:before.role,toRole:updated.role,fromActive:before.active,toActive:updated.active}});
    res.json({data:updated});
  }catch(e){handleError(res,e,"Impossible de modifier l'utilisateur");}
});
router.get("/api/v1/admin/audit",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{try{res.json({data:await import("./repositories/auditRepository.js").then(m=>m.listAuditAll(Number(req.query.limit??500)))})}catch(e){handleError(res,e,"Audit global indisponible");}});
router.get("/api/v1/admin/audit/integrity",auth,permission("admin:manage"),async(_req:Req,res:express.Response)=>{
  try{res.json({data:await verifyAuditChain()});}catch(e){handleError(res,e,"Vérification d'intégrité de l'audit indisponible");}
});
router.get("/api/v1/admin/permissions",auth,permission("admin:manage"),async(_req:Req,res:express.Response)=>{
 try{res.json({data:await listPermissions()});}catch(e){handleError(res,e,"Permissions indisponibles");}
});
router.patch("/api/v1/admin/permissions",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
 try{
  const role=String(req.body?.role??"") as Role;
  const permissionName=String(req.body?.permission??"");
  if(!["CITOYEN","GREFFE","MAGISTRAT","ADMIN"].includes(role))return res.status(400).json({error:"Rôle invalide"});
  const item=await setPermission({role,permission:permissionName,enabled:req.body?.enabled===true,actorId:req.user!.id});
  await writeAudit({actorId:req.user!.id,action:"ROLE_PERMISSION_CHANGED",metadata:{role,permission:permissionName,enabled:item.enabled}});
  res.json({data:item});
 }catch(e){handleError(res,e,"Modification de la permission impossible");}
});

router.post("/api/v1/admin/users",auth,permission("admin:manage"),async(req:Req,res:express.Response)=>{
  try{
    const role=String(req.body?.role??"") as "GREFFE"|"MAGISTRAT"|"ADMIN";
    if(!["GREFFE","MAGISTRAT","ADMIN"].includes(role)) return res.status(400).json({error:"Rôle de compte interne invalide"});
    const data=await createStaffAccount({
      email:String(req.body?.email??"").trim(),
      password:String(req.body?.password??""),
      fullName:req.body?.fullName?String(req.body.fullName).trim():undefined,
      phone:req.body?.phone?String(req.body.phone).trim():undefined,
      role,
      stages:Array.isArray(req.body?.stages)?req.body.stages.map(String):[],
      createdBy:req.user!.id
    });
    await writeAudit({actorId:req.user!.id,action:"STAFF_ACCOUNT_CREATED",metadata:{userId:data.id,role:data.role,stageAccess:data.stage_access}});
    res.status(201).json({data});
  }catch(e){
    const c=e instanceof Error?e.message:"";
    const status=c==="EMAIL_EXISTS"?409:400;
    res.status(status).json({error:c==="EMAIL_EXISTS"?"Email déjà utilisé":c==="PASSWORD_TOO_SHORT"?"Mot de passe trop court":c==="STAGE_REQUIRED"?"Au moins une étape doit être attribuée":"Création du compte impossible"});
  }
});
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
