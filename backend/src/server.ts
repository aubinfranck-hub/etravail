import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
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
import {listAudit,writeAudit,verifyAuditChain} from "./repositories/auditRepository.js";
import {hasPermission,listPermissions,setPermission,type Role} from "./auth/permissions.js";
import type {CaseStatus} from "./domain/workflow.js";
import {setupPayment,getPayment,registerExternalValidationCode,verifyPaymentByExternalCode} from "./services/paymentService.js";
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