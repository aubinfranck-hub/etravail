import { pool } from "../db.js";
import { createCase, findCase, listCases, updateCaseStatus, assignCase } from "../repositories/caseRepository.js";
import { writeAudit } from "../repositories/auditRepository.js";
import { canTransition, allowedRolesByTransition, assignmentRoleByStatus, stageForStatus } from "../domain/workflow.js";
import type { CaseStatus, AssignmentRole } from "../domain/workflow.js";
import { notify, notifyCaseParticipants } from "./notificationService.js";
import { ensurePaymentForEnrollment } from "./paymentService.js";
import { sendTrackingSms, type TrackingSmsEvent } from "./smsService.js";

const NATURES = ["LICENCIEMENT","SALAIRE_IMPAYE","CONGES","RUPTURE_CONTRAT","HARCELEMENT","ACCIDENT_TRAVAIL","AUTRE"] as const;

export async function getCases(){ return listCases(); }

const ENROLLMENT_LOCKED_STATUSES = new Set<CaseStatus>([
  "ENROLEMENT","CONCILIATION","CONCILIE","CONCILIATION_ECHEC",
  "AUDIENCE_PLANIFIEE","AUDIENCE","DECISION_RENDUE","NOTIFIE","ARCHIVE"
]);

export function isEnrollmentLocked(status: CaseStatus){
  return ENROLLMENT_LOCKED_STATUSES.has(status);
}

export async function ensureCaseMutationAllowed(caseId:string,actorRole:string,mutation:string){
  const current=await findCase(caseId);
  if(!current) throw new Error("CASE_NOT_FOUND");
  if(isEnrollmentLocked(current.status as CaseStatus) && actorRole!=="ADMIN"){
    await writeAudit({
      caseId,
      action:"CASE_MUTATION_BLOCKED_AFTER_ENROLLMENT",
      actorRole,
      metadata:{mutation,status:current.status}
    });
    throw new Error("CASE_ENROLLMENT_LOCKED");
  }
  return current;
}


export function classifyNature(title:string){
  const t=title.toLowerCase();
  if(/licenci|renvoi|licenciement/.test(t)) return "LICENCIEMENT";
  if(/salaire|paie|rémun|remuner/.test(t)) return "SALAIRE_IMPAYE";
  if(/congé|conge/.test(t)) return "CONGES";
  if(/rupture|résiliation|resiliation|démission|demission/.test(t)) return "RUPTURE_CONTRAT";
  if(/harcèl|harcel/.test(t)) return "HARCELEMENT";
  if(/accident|maladie professionnelle/.test(t)) return "ACCIDENT_TRAVAIL";
  return "AUTRE";
}

export function normalizeNature(nature:string|undefined,title:string){
  const value=String(nature??"").trim().toUpperCase();
  return (NATURES as readonly string[]).includes(value)?value:classifyNature(title);
}

async function syncCaseRequirements(caseId:string,natureCode:string,stage:string){
  const rules=await pool.query(
    `SELECT wr.id
     FROM workflow_requirements wr
     WHERE wr.status=$2 AND wr.active=true
       AND (wr.nature_code=$1 OR wr.nature_code IS NULL)
       AND (
         NOT EXISTS (
           SELECT 1 FROM workflow_requirement_rules rr
           WHERE rr.requirement_id=wr.id AND rr.active=true
         )
         OR NOT EXISTS (
           SELECT 1
           FROM workflow_requirement_rules rr
           WHERE rr.requirement_id=wr.id AND rr.active=true
             AND NOT EXISTS (
               SELECT 1 FROM case_answers ca
               WHERE ca.case_id=$3 AND ca.question_id=rr.question_id
                 AND (
                   rr.operator='EXISTS'
                   OR (rr.operator='EQ' AND ca.value = rr.expected_value)
                   OR (rr.operator='NEQ' AND ca.value <> rr.expected_value)
                   OR (rr.operator='IN' AND rr.expected_value ? (ca.value->>0))
                   OR (rr.operator='NOT_IN' AND NOT (rr.expected_value ? (ca.value->>0)))
                 )
             )
         )
       )
     ORDER BY wr.sort_order ASC`,[natureCode,stage,caseId]);

  const eligible=new Set(rules.rows.map((r:{id:string})=>r.id));
  const existing=await pool.query(
    `SELECT cr.id,cr.requirement_id
     FROM case_requirements cr
     JOIN workflow_requirements wr ON wr.id=cr.requirement_id
     WHERE cr.case_id=$1 AND wr.status=$2`,
    [caseId,stage]
  );
  for(const row of existing.rows){
    await pool.query(
      `UPDATE case_requirements SET applicable=$1,updated_at=CURRENT_TIMESTAMP
       WHERE id=$2`,
      [eligible.has(row.requirement_id),row.id]
    );
  }
  for(const rule of rules.rows){
    await pool.query(
      `INSERT INTO case_requirements(case_id,requirement_id,applicable)
       VALUES($1,$2,TRUE)
       ON CONFLICT(case_id,requirement_id) DO UPDATE SET
         applicable=TRUE,updated_at=CURRENT_TIMESTAMP`,
      [caseId,rule.id]
    );
  }
}

async function seedCaseRequirements(caseId:string,natureCode:string){
  await syncCaseRequirements(caseId,natureCode,"SOUMIS");
}

async function autoAssignNewCase(caseId:string){
  return autoAssign(caseId,"SAISINE","Affectation automatique à la création du dossier");
}

export async function openCase(input:{claimantId:string;title:string;actorId:string;natureCode?:string}){
  const natureCode=normalizeNature(input.natureCode,input.title);
  const reference=`ET-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
  const item=await createCase({reference,title:input.title,claimantId:input.claimantId,natureCode});
  await seedCaseRequirements(item.id,natureCode);
  await autoAssignNewCase(item.id);
  await writeAudit({actorId:input.actorId,caseId:item.id,action:"CASE_CREATED",actorRole:"CITOYEN",metadata:{reference,natureCode}});
  await writeAudit({actorId:input.actorId,caseId:item.id,action:"CASE_NATURE_CLASSIFIED",actorRole:"CITOYEN",metadata:{natureCode,source:input.natureCode?"USER":"RULE_ENGINE"}});
  return item;
}

export async function updateCaseBasics(caseId:string,input:{title?:string;natureCode?:string},actorId:string){
  const current=await findCase(caseId);
  if(!current) throw new Error("CASE_NOT_FOUND");
  if(current.status!=="BROUILLON") throw new Error("CASE_ENROLLMENT_LOCKED");
  const title=String(input.title??current.title).trim();
  if(!title) throw new Error("TITLE_REQUIRED");
  const natureCode=normalizeNature(input.natureCode,current.title);
  const r=await pool.query(
    `UPDATE cases SET title=$2,nature_code=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
    [caseId,title,natureCode]
  );
  await syncCaseRequirements(caseId,natureCode,"SOUMIS");
  await writeAudit({actorId,caseId,action:"CASE_BASICS_UPDATED",metadata:{title,natureCode}});
  return r.rows[0];
}

export async function getWorkflowQuestions(caseId:string,status:string,natureCode:string){
  const r=await pool.query(
    `SELECT wq.id,wq.code,wq.label,wq.answer_type,wq.required,wq.sort_order,
      ca.value AS answer
     FROM workflow_questions wq
     LEFT JOIN case_answers ca ON ca.question_id=wq.id AND ca.case_id=$1
     WHERE wq.status=$2 AND wq.active=true
       AND (wq.nature_code=$3 OR wq.nature_code IS NULL)
     ORDER BY wq.sort_order,wq.label`,
    [caseId,status,natureCode]
  );
  return r.rows;
}

function validateQuestionAnswer(answerType:string,value:unknown){
  if(value===undefined||value===null) throw new Error("ANSWER_REQUIRED");
  if(answerType==="BOOLEAN"&&typeof value!=="boolean") throw new Error("ANSWER_TYPE_INVALID");
  if(answerType==="NUMBER"&&(typeof value!=="number"||!Number.isFinite(value))) throw new Error("ANSWER_TYPE_INVALID");
  if(answerType==="DATE"&&(typeof value!=="string"||!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)||Number.isNaN(Date.parse(value)))) throw new Error("ANSWER_TYPE_INVALID");
  if((answerType==="TEXT"||answerType==="LONG_TEXT")&&typeof value!=="string") throw new Error("ANSWER_TYPE_INVALID");
  return true;
}

async function validateQuestionOptions(questionId:string,answerType:string,value:unknown){
  if(answerType!=="SINGLE_CHOICE"&&answerType!=="MULTIPLE_CHOICE") return;
  const values=answerType==="MULTIPLE_CHOICE"?(Array.isArray(value)?value:null):[value];
  if(!values||values.some(v=>typeof v!=="string")) throw new Error("ANSWER_TYPE_INVALID");
  const r=await pool.query(
    `SELECT code FROM workflow_question_options WHERE question_id=$1 AND active=true AND code = ANY($2::text[])`,
    [questionId,values]
  );
  if(r.rowCount!==values.length) throw new Error("ANSWER_OPTION_INVALID");
}

export async function saveCaseAnswer(caseId:string,questionId:string,value:unknown,actorId:string){
  const question=await pool.query(
    `SELECT wq.id,wq.answer_type,wq.required
     FROM workflow_questions wq JOIN cases c ON c.id=$2
     WHERE wq.id=$1 AND wq.active=true
       AND (wq.nature_code=c.nature_code OR wq.nature_code IS NULL)
     LIMIT 1`,[questionId,caseId]);
  if(!question.rowCount) throw new Error("QUESTION_NOT_FOUND");
  if(value===undefined||value===null) throw new Error("ANSWER_REQUIRED");
  validateQuestionAnswer(String(question.rows[0].answer_type),value);
  await validateQuestionOptions(questionId,String(question.rows[0].answer_type),value);
  const r=await pool.query(
    `INSERT INTO case_answers(case_id,question_id,value,answered_by)
     VALUES($1,$2,$3::jsonb,$4)
     ON CONFLICT(case_id,question_id) DO UPDATE SET
       value=EXCLUDED.value,answered_by=EXCLUDED.answered_by,
       answered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [caseId,questionId,JSON.stringify(value),actorId]
  );
  const caseRow=await findCase(caseId);
  if(caseRow) await syncCaseRequirements(caseId,String(caseRow.nature_code??"AUTRE"),"SOUMIS");
  await writeAudit({actorId,caseId,action:"CASE_QUESTION_ANSWERED",metadata:{questionId,value}});
  return r.rows[0];
}

export async function ensureRequiredQuestionsAnswered(caseId:string,status:string,natureCode:string){
  const r=await pool.query(
    `SELECT wq.id,wq.code,wq.label
     FROM workflow_questions wq
     LEFT JOIN case_answers ca ON ca.question_id=wq.id AND ca.case_id=$1
     WHERE wq.status=$2 AND wq.active=true AND wq.required=true
       AND (wq.nature_code=$3 OR wq.nature_code IS NULL)
       AND ca.id IS NULL
     ORDER BY wq.sort_order,wq.label`,
    [caseId,status,natureCode]
  );
  if(r.rowCount) throw new Error("REQUIRED_QUESTIONS_MISSING");
  return true;
}

export function requiredDocumentsSatisfied(state:{required_count:number;received_count:number;validated_count:number},mode:"SUBMIT"|"COMPLETE"){
  if(mode==="SUBMIT") return Number(state.required_count)<=Number(state.received_count);
  return Number(state.required_count)<=Number(state.validated_count);
}

function requirementStageForTransition(next:CaseStatus){
  if(next==="SOUMIS") return "SOUMIS";
  if(next==="COMPLET") return "A_VERIFIER";
  return null;
}

async function requiredState(caseId:string,stage:string){
  const r=await pool.query(`SELECT COUNT(*) FILTER (WHERE wr.required)::int AS required_count,
    COUNT(*) FILTER (WHERE wr.required AND cr.status IN ('RECEIVED','VALIDATED'))::int AS received_count,
    COUNT(*) FILTER (WHERE wr.required AND cr.status='VALIDATED')::int AS validated_count
    FROM case_requirements cr JOIN workflow_requirements wr ON wr.id=cr.requirement_id
    WHERE cr.case_id=$1 AND wr.status=$2 AND wr.active=true AND cr.applicable=true`,[caseId,stage]);
  return r.rows[0]??{required_count:0,received_count:0,validated_count:0};
}

export async function getRequirements(caseId:string){
  const r=await pool.query(`SELECT cr.id,cr.case_id,cr.status,cr.document_id,cr.validated_by,cr.validated_at,cr.rejection_reason,
    wr.status AS stage,wr.code,wr.label,wr.required,wr.deadline_hours,wr.sort_order,
    d.filename
    FROM case_requirements cr JOIN workflow_requirements wr ON wr.id=cr.requirement_id
    LEFT JOIN documents d ON d.id=cr.document_id
    WHERE cr.case_id=$1 ORDER BY wr.sort_order,wr.label`,[caseId]);
  return r.rows;
}

export async function ensureRequirementCanReceive(caseId:string,requirementId:string){
  const r=await pool.query(
    `SELECT cr.id,cr.status,cr.document_id,cr.applicable,wr.code,wr.label
     FROM case_requirements cr JOIN workflow_requirements wr ON wr.id=cr.requirement_id
     WHERE cr.id=$1 AND cr.case_id=$2 LIMIT 1`,
    [requirementId,caseId]
  );
  if(!r.rowCount) throw new Error("REQUIREMENT_NOT_FOUND");
  if(!r.rows[0].applicable) throw new Error("REQUIREMENT_NOT_APPLICABLE");
  if(r.rows[0].status==="VALIDATED") throw new Error("REQUIREMENT_ALREADY_VALIDATED");
  return r.rows[0];
}

export async function attachRequirementDocument(caseId:string,requirementId:string,documentId:string,actorId:string){
  const document=await pool.query("SELECT id FROM documents WHERE id=$1 AND case_id=$2 LIMIT 1",[documentId,caseId]);
  if(!document.rowCount) throw new Error("DOCUMENT_CASE_MISMATCH");
  const current=await ensureRequirementCanReceive(caseId,requirementId);
  const r=await pool.query(`UPDATE case_requirements SET status='RECEIVED',document_id=$1,validated_by=NULL,validated_at=NULL,rejection_reason=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE id=$2 AND case_id=$3 RETURNING *`,[documentId,requirementId,caseId]);
  if(!r.rowCount) throw new Error("REQUIREMENT_NOT_FOUND");
  await pool.query(
    `INSERT INTO case_requirement_events(case_requirement_id,case_id,actor_id,previous_status,new_status,previous_document_id,new_document_id,reason)
     VALUES($1,$2,$3,$4,'RECEIVED',$5,$6,$7)`,
    [requirementId,caseId,actorId,current.status,current.document_id,documentId,current.status==="REJECTED"?"Remplacement après rejet":current.status==="RECEIVED"?"Remplacement de la pièce reçue":null]
  );
  await writeAudit({actorId,caseId,action:current.document_id?"DOCUMENT_REQUIREMENT_REPLACED":"DOCUMENT_REQUIREMENT_RECEIVED",metadata:{requirementId,previousDocumentId:current.document_id,newDocumentId:documentId,previousStatus:current.status}});
  return r.rows[0];
}

export async function validateRequirement(caseId:string,requirementId:string,actorId:string,valid:boolean,reason?:string){
  const r0=await pool.query(
    `SELECT cr.*,d.uploaded_by FROM case_requirements cr
     LEFT JOIN documents d ON d.id=cr.document_id
     WHERE cr.id=$1 AND cr.case_id=$2 LIMIT 1`,
    [requirementId,caseId]
  );
  if(!r0.rowCount) throw new Error("REQUIREMENT_NOT_FOUND");
  const current=r0.rows[0];
  if(!current.document_id) throw new Error("REQUIREMENT_DOCUMENT_REQUIRED");
  if(current.status!=="RECEIVED") throw new Error("REQUIREMENT_NOT_RECEIVED");
  if(String(current.uploaded_by??"")===String(actorId)) throw new Error("DOCUMENT_SELF_VALIDATION_FORBIDDEN");
  if(!valid&&!String(reason??"").trim()) throw new Error("REQUIREMENT_REJECTION_REASON_REQUIRED");
  const status=valid?"VALIDATED":"REJECTED";
  const cleanReason=valid?null:String(reason).trim();
  const r=await pool.query(`UPDATE case_requirements SET status=$1,validated_by=$2,validated_at=CURRENT_TIMESTAMP,rejection_reason=$3,updated_at=CURRENT_TIMESTAMP
    WHERE id=$4 AND case_id=$5 AND status='RECEIVED' RETURNING *`,[status,actorId,cleanReason,requirementId,caseId]);
  if(!r.rowCount) throw new Error("REQUIREMENT_NOT_RECEIVED");
  await pool.query(
    `INSERT INTO case_requirement_events(case_requirement_id,case_id,actor_id,previous_status,new_status,previous_document_id,new_document_id,reason)
     VALUES($1,$2,$3,'RECEIVED',$4,$5,$5,$6)`,
    [requirementId,caseId,actorId,status,current.document_id,cleanReason]
  );
  await writeAudit({actorId,caseId,action:valid?"DOCUMENT_VALIDATED":"DOCUMENT_REJECTED",metadata:{requirementId,status,documentId:current.document_id,reason:cleanReason}});
  const caseItem=await findCase(caseId);
  if(caseItem){
    await notifyCaseParticipants({
      caseId,
      subject:valid?"Pièce validée":"Pièce rejetée",
      body:valid?`La pièce requise du dossier ${caseItem.reference} a été validée.`:`La pièce requise du dossier ${caseItem.reference} a été rejetée.${cleanReason?` Motif : ${cleanReason}`:""}`
    });
  }
  return r.rows[0];
}

export async function getRequirementHistory(caseId:string,requirementId:string){
  const r=await pool.query(
    `SELECT e.*,u.full_name AS actor_name
     FROM case_requirement_events e LEFT JOIN users u ON u.id=e.actor_id
     WHERE e.case_id=$1 AND e.case_requirement_id=$2
     ORDER BY e.created_at ASC`,
    [caseId,requirementId]
  );
  return r.rows;
}

async function autoAssign(caseId:string,role:AssignmentRole,reason:string){
  const current=await findCase(caseId);
  if(!current) throw new Error("CASE_NOT_FOUND");
  if(current.assigned_to && current.assigned_role===role){
    const activeCurrent=await pool.query("SELECT id FROM users WHERE id=$1 AND role=$2 AND active=true LIMIT 1",[current.assigned_to,role]);
    if(activeCurrent.rowCount) return current;
  }
  const stage=stageForStatus[current.status as CaseStatus];
  const r=await pool.query(`SELECT u.id,u.full_name,
    COUNT(c.id) FILTER (WHERE c.status NOT IN ('ARCHIVE') AND c.assigned_to=u.id)::int AS workload
    FROM users u LEFT JOIN cases c ON c.assigned_to=u.id
    WHERE u.role=$1 AND u.active=true
      AND EXISTS (SELECT 1 FROM user_stage_access usa WHERE usa.user_id=u.id AND usa.stage_key=$2)
    GROUP BY u.id,u.full_name
    ORDER BY workload ASC,u.created_at ASC LIMIT 1`,[role,stage]);
  const target=r.rows[0];
  if(!target) return current;
  const updated=await assignCase(caseId,target.id,role);
  if(!updated) throw new Error("CASE_NOT_FOUND");
  await pool.query(`INSERT INTO case_assignments(case_id,assigned_to,assigned_role,assignment_type,reason)
    VALUES($1,$2,$3,'AUTO',$4)`,[caseId,target.id,role,reason]);
  await writeAudit({caseId,action:"CASE_AUTO_ASSIGNED",actorRole:"SYSTEM",metadata:{assignedTo:target.id,assignedRole:role,stage,workloadBefore:Number(target.workload),reason}});
  await notify({userId:target.id,caseId,channel:"IN_APP",subject:"Nouveau dossier affecté",body:`Le dossier ${updated.reference} vous est affecté à l'étape ${stage}.`});
  return updated;
}

async function ensureAutoAssignmentTarget(caseId:string,role:AssignmentRole,nextStatus:CaseStatus){
  const current=await findCase(caseId);
  if(current?.assigned_to && current.assigned_role===role){
    const activeCurrent=await pool.query("SELECT id FROM users WHERE id=$1 AND role=$2 AND active=true LIMIT 1",[current.assigned_to,role]);
    if(activeCurrent.rowCount) return;
  }
  const stage=stageForStatus[nextStatus];
  const available=await pool.query(
    "SELECT u.id FROM users u WHERE u.role=$1 AND u.active=true AND EXISTS (SELECT 1 FROM user_stage_access usa WHERE usa.user_id=u.id AND usa.stage_key=$2) LIMIT 1",
    [role,stage]
  );
  if(!available.rowCount) throw new Error("NO_ACTIVE_ASSIGNMENT_AGENT");
}

async function setDueDate(caseId:string,status:CaseStatus){
  const r=await pool.query(`SELECT MIN(wr.deadline_hours)::int AS hours
    FROM case_requirements cr JOIN workflow_requirements wr ON wr.id=cr.requirement_id
    WHERE cr.case_id=$1 AND wr.status=$2 AND wr.active=true AND wr.deadline_hours IS NOT NULL`,[caseId,status]);
  const hours=Number(r.rows[0]?.hours??0);
  if(hours>0) await pool.query("UPDATE cases SET due_at=CURRENT_TIMESTAMP + ($2 || ' hours')::interval WHERE id=$1",[caseId,String(hours)]);
}

async function ensureEnrollmentCreated(caseId:string,actorId:string){
  const current=await findCase(caseId);
  if(!current) throw new Error("CASE_NOT_FOUND");
  if(!["COMPLET","ENROLEMENT"].includes(current.status)) throw new Error("ENROLLMENT_CASE_NOT_COMPLETE");

  const existing=await pool.query(
    "SELECT * FROM enrollments WHERE case_id=$1 FOR UPDATE",
    [caseId]
  );
  if(existing.rowCount && existing.rows[0].enrollment_reference){
    return existing.rows[0];
  }

  const year=new Date().getFullYear();
  const reference=`ENR-${year}-${current.reference}`;
  const r=await pool.query(
    `INSERT INTO enrollments(case_id,enrollment_reference,enrolled_at,enrolled_by)
     VALUES($1,$2,CURRENT_TIMESTAMP,$3)
     ON CONFLICT(case_id) DO UPDATE SET
       enrollment_reference=COALESCE(enrollments.enrollment_reference,EXCLUDED.enrollment_reference),
       enrolled_at=COALESCE(enrollments.enrolled_at,EXCLUDED.enrolled_at),
       enrolled_by=COALESCE(enrollments.enrolled_by,EXCLUDED.enrolled_by),
       updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [caseId,reference,actorId]
  );
  await writeAudit({
    actorId,
    caseId,
    action:"CASE_ENROLLED",
    metadata:{
      enrollmentId:r.rows[0].id,
      enrollmentReference:r.rows[0].enrollment_reference,
      enrolledAt:r.rows[0].enrolled_at,
      enrolledBy:actorId
    }
  });
  return r.rows[0];
}

export async function getEnrollment(caseId:string){
  const r=await pool.query(
    `SELECT e.*,u.full_name AS enrolled_by_name
     FROM enrollments e LEFT JOIN users u ON u.id=e.enrolled_by
     WHERE e.case_id=$1`,
    [caseId]
  );
  return r.rows[0]??null;
}

async function ensureDecisionExists(caseId:string){
  const r=await pool.query("SELECT id FROM decisions WHERE case_id=$1 LIMIT 1",[caseId]);
  if(!r.rowCount) throw new Error("DECISION_REQUIRED");
}

async function ensureHearingExists(caseId:string){
  const r=await pool.query("SELECT id FROM hearings WHERE case_id=$1 AND status='PLANIFIEE' LIMIT 1",[caseId]);
  if(!r.rowCount) throw new Error("HEARING_REQUIRED");
}

async function ensureStageAccessForTransition(next:CaseStatus, actorId:string, actorRole?:string){
  if(!actorRole || actorRole==="ADMIN") return;
  const stage=stageForStatus[next];
  if(actorRole==="CITOYEN" && stage==="SAISINE") return;
  const r=await pool.query("SELECT 1 FROM user_stage_access WHERE user_id=$1 AND stage_key=$2 LIMIT 1",[actorId,stage]);
  if(!r.rowCount) throw new Error("STAGE_ACCESS_REQUIRED");
}

export async function transitionCase(input:{id:string;next:CaseStatus;actorId:string;actorRole?:string}){
  const item=await findCase(input.id); if(!item) throw new Error("CASE_NOT_FOUND");
  if(!canTransition(item.status as CaseStatus,input.next)) throw new Error("INVALID_TRANSITION");
  const roles=allowedRolesByTransition[`${item.status}->${input.next}`];
  if(roles&&input.actorRole&&!roles.includes(input.actorRole)) throw new Error("ROLE_CANNOT_TRANSITION");
  await ensureStageAccessForTransition(input.next,input.actorId,input.actorRole);
  const requirementStage=requirementStageForTransition(input.next);
  const currentCaseNature=String(item.nature_code??"AUTRE");
  if(requirementStage) await syncCaseRequirements(input.id,currentCaseNature,requirementStage);
  const req=requirementStage?await requiredState(input.id,requirementStage):{required_count:0,received_count:0,validated_count:0};
  if(input.next==="SOUMIS" && !requiredDocumentsSatisfied(req,"SUBMIT")) throw new Error("REQUIRED_DOCUMENTS_MISSING");
  if(input.next==="COMPLET" && !requiredDocumentsSatisfied(req,"COMPLETE")) throw new Error("REQUIRED_DOCUMENTS_NOT_VALIDATED");
  if(input.next==="ENROLEMENT") await ensurePaymentForEnrollment(input.id);
  if(input.next==="AUDIENCE") await ensureHearingExists(input.id);
  if(input.next==="DECISION_RENDUE") await ensureDecisionExists(input.id);
  const assignmentRole=assignmentRoleByStatus[input.next];
  if(assignmentRole) await ensureAutoAssignmentTarget(input.id,assignmentRole,input.next);
  const updated=await updateCaseStatus(input.id,input.next);
  if(!updated) throw new Error("CASE_NOT_FOUND");
  if(input.next==="ENROLEMENT") await ensureEnrollmentCreated(input.id,input.actorId);
  await writeAudit({actorId:input.actorId,caseId:input.id,action:"CASE_STATUS_CHANGED",actorRole:input.actorRole,metadata:{from:item.status,to:input.next,stage:stageForStatus[input.next],requirements:req}});
  await setDueDate(input.id,input.next);
  const stageNotificationByStatus:Partial<Record<CaseStatus,string>>={
    SOUMIS:"GREFFE",
    RECU_GREFFE:"GREFFE",
    A_VERIFIER:"CONTROLE",
    COMPLET:"ENROLEMENT",
    INCOMPLET:"SAISINE",
    ENROLEMENT:"AUDIENCES",
    CONCILIATION:"AUDIENCES",
    CONCILIE:"NOTIFICATION",
    CONCILIATION_ECHEC:"AUDIENCES",
    AUDIENCE_PLANIFIEE:"AUDIENCES",
    AUDIENCE:"AUDIENCES",
    DECISION_RENDUE:"NOTIFICATION",
    NOTIFIE:"ARCHIVAGE",
    ARCHIVE:"ARCHIVAGE"
  };
  const targetStage=stageNotificationByStatus[input.next];
  if(targetStage){
    const labels:Partial<Record<CaseStatus,string>>={
      SOUMIS:"Nouveau dossier soumis",RECU_GREFFE:"Dossier reçu au Greffe",A_VERIFIER:"Dossier à contrôler",COMPLET:"Dossier complet",INCOMPLET:"Dossier incomplet",ENROLEMENT:"Dossier à enrôler",CONCILIATION:"Conciliation",CONCILIE:"Conciliation réussie",CONCILIATION_ECHEC:"Conciliation échouée",AUDIENCE_PLANIFIEE:"Audience programmée",AUDIENCE:"Audience en cours",DECISION_RENDUE:"Décision rendue",NOTIFIE:"Décision à notifier",ARCHIVE:"Dossier archivé"
    };
    const c=await findCase(input.id);
    if(c) await notifyCaseParticipants({caseId:input.id,stage:targetStage,subject:labels[input.next]??"Mise à jour du dossier",body:`Le dossier ${c.reference} est passé au statut ${input.next}.`});
  }
  if(assignmentRole) await autoAssign(input.id,assignmentRole,`Entrée dans l’étape ${stageForStatus[input.next]}`);
  const trackingEventByStatus:Partial<Record<CaseStatus,TrackingSmsEvent>>={
    SOUMIS:"CASE_REGISTERED",
    A_VERIFIER:"CASE_UNDER_REVIEW",
    INCOMPLET:"CASE_INCOMPLETE",
    ENROLEMENT:"CASE_ENROLLED",
    AUDIENCE_PLANIFIEE:"HEARING_SCHEDULED",
    DECISION_RENDUE:"DECISION_AVAILABLE"
  };
  const trackingEvent=trackingEventByStatus[input.next];
  if(trackingEvent){
    const claimantId=String(updated.claimant_id??"");
    if(claimantId){
      try{ await sendTrackingSms({caseId:input.id,event:trackingEvent,actorId:input.actorId}); }
      catch(error){
        await writeAudit({actorId:input.actorId,caseId:input.id,action:"SMS_TRACKING_NOT_SENT",metadata:{event:trackingEvent,reason:error instanceof Error?error.message:"SMS_FAILED"}});
      }
    }
  }
  return updated;
}

export async function reassignCasesFromUser(userId:string,actorId:string){
  const r=await pool.query(
    "SELECT id,status FROM cases WHERE assigned_to=$1 AND status<>'ARCHIVE' ORDER BY created_at ASC",
    [userId]
  );
  const results=[];
  for(const item of r.rows){
    const role=assignmentRoleByStatus[item.status as CaseStatus];
    if(!role) continue;
    const target=await pool.query(
      `SELECT u.id,u.full_name,COUNT(c.id) FILTER (WHERE c.status<>'ARCHIVE' AND c.assigned_to=u.id)::int AS workload
       FROM users u LEFT JOIN cases c ON c.assigned_to=u.id
       WHERE u.role=$1 AND u.active=true AND u.id<>$2
         AND EXISTS (SELECT 1 FROM user_stage_access usa WHERE usa.user_id=u.id AND usa.stage_key=$3)
       GROUP BY u.id,u.full_name ORDER BY workload ASC,u.created_at ASC LIMIT 1`,
      [role,userId,stageForStatus[item.status as CaseStatus]]
    );
    if(!target.rowCount) throw new Error("NO_ACTIVE_ASSIGNMENT_AGENT");
    const selected=target.rows[0];
    const updated=await assignCase(item.id,selected.id,role);
    if(updated){
      await pool.query(
        `INSERT INTO case_assignments(case_id,assigned_to,assigned_role,assigned_by,assignment_type,reason)
         VALUES($1,$2,$3,$4,'REASSIGNMENT',$5)`,
        [item.id,selected.id,role,actorId,"Réaffectation automatique après désactivation/changement de rôle"]
      );
      await writeAudit({actorId,caseId:item.id,action:"CASE_AUTO_REASSIGNED",metadata:{fromAssignedTo:userId,toAssignedTo:selected.id,assignedRole:role,reason:"AGENT_ACCESS_CHANGED"}});
      await notify({userId:selected.id,caseId:item.id,channel:"IN_APP",subject:"Dossier réaffecté",body:`Un dossier vous a été réaffecté à l'étape ${stageForStatus[item.status as CaseStatus]}.`});
      results.push({caseId:item.id,assignedTo:selected.id,assignedRole:role});
    }
  }
  return results;
}

export async function assignCaseTo(input:{id:string;assignedTo:string|null;assignedRole:string|null;actorId:string;reason?:string}){
 const item=await findCase(input.id); if(!item) throw new Error("CASE_NOT_FOUND");
 const updated=await assignCase(input.id,input.assignedTo,input.assignedRole);
 await pool.query(`INSERT INTO case_assignments(case_id,assigned_to,assigned_role,assigned_by,assignment_type,reason)
   VALUES($1,$2,$3,$4,$5,$6)`,[input.id,input.assignedTo,input.assignedRole,input.actorId,item.assigned_to?"REASSIGNMENT":"MANUAL",input.reason??null]);
 await writeAudit({actorId:input.actorId,caseId:input.id,action:item.assigned_to?"CASE_REASSIGNED":"CASE_ASSIGNED",metadata:{fromAssignedTo:item.assigned_to,fromAssignedRole:item.assigned_role,assignedTo:input.assignedTo,assignedRole:input.assignedRole,reason:input.reason??null}});
 if(input.assignedTo&&updated) await notify({userId:input.assignedTo,caseId:input.id,channel:"IN_APP",subject:"Dossier affecté",body:`Le dossier ${updated.reference} vous est affecté. Action requise à l'étape ${stageForStatus[updated.status as CaseStatus]}.`});
 return updated;
}
