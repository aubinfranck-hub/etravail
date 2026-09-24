import {pool} from "../db.js";
import {writeAudit} from "../repositories/auditRepository.js";

const STATUSES=["SOUMIS","RECU_GREFFE","A_VERIFIER","COMPLET","INCOMPLET","ENROLEMENT","CONCILIATION","AUDIENCE_PLANIFIEE","AUDIENCE","DECISION_RENDUE","NOTIFIE","ARCHIVE"] as const;
const NATURES=["LICENCIEMENT","SALAIRE_IMPAYE","CONGES","RUPTURE_CONTRAT","HARCELEMENT","ACCIDENT_TRAVAIL","AUTRE"] as const;

function validate(input:{status:string;natureCode?:string|null;code:string;label:string;deadlineHours?:number;sortOrder?:number}){
 if(!STATUSES.includes(input.status as typeof STATUSES[number])) throw new Error("INVALID_STATUS");
 if(input.natureCode!==null&&input.natureCode!==undefined&&!NATURES.includes(input.natureCode as typeof NATURES[number])) throw new Error("INVALID_NATURE");
 if(!input.code.trim()||!input.label.trim()) throw new Error("WORKFLOW_REQUIREMENT_REQUIRED");
 if(input.deadlineHours!==undefined&&(!Number.isInteger(input.deadlineHours)||input.deadlineHours<0)) throw new Error("INVALID_DEADLINE");
 if(input.sortOrder!==undefined&&(!Number.isInteger(input.sortOrder)||input.sortOrder<0)) throw new Error("INVALID_SORT_ORDER");
}

export async function listWorkflowRequirements(status?:string,natureCode?:string){
 const params:string[]=[]; const where:string[]=["1=1"];
 if(status){if(!STATUSES.includes(status as typeof STATUSES[number])) throw new Error("INVALID_STATUS");params.push(status);where.push(`status=$${params.length}`);}
 if(natureCode){if(!NATURES.includes(natureCode as typeof NATURES[number])) throw new Error("INVALID_NATURE");params.push(natureCode);where.push(`(nature_code=$${params.length} OR nature_code IS NULL)`);}
 const r=await pool.query(`SELECT * FROM workflow_requirements WHERE ${where.join(" AND ")} ORDER BY status,nature_code NULLS FIRST,sort_order,label`,params);
 return r.rows;
}

export async function createWorkflowRequirement(input:{status:string;natureCode?:string|null;code:string;label:string;required?:boolean;deadlineHours?:number;sortOrder?:number;actorId:string}){
 validate(input);
 const r=await pool.query(`INSERT INTO workflow_requirements(status,nature_code,code,label,required,deadline_hours,sort_order,active)
 VALUES($1,$2,$3,$4,$5,$6,$7,true)
 RETURNING *`,[input.status,input.natureCode??null,input.code.trim().toUpperCase(),input.label.trim(),input.required!==false,input.deadlineHours??null,input.sortOrder??0]);
 await writeAudit({actorId:input.actorId,action:"WORKFLOW_REQUIREMENT_CREATED",metadata:{requirementId:r.rows[0].id,status:input.status,natureCode:input.natureCode??null,code:r.rows[0].code,required:r.rows[0].required}});
 return r.rows[0];
}

export async function updateWorkflowRequirement(id:string,input:{status?:string;natureCode?:string|null;code?:string;label?:string;required?:boolean;deadlineHours?:number|null;sortOrder?:number;active?:boolean;actorId:string}){
 const existing=await pool.query("SELECT * FROM workflow_requirements WHERE id=$1",[id]);
 if(!existing.rowCount) return null;
 const e=existing.rows[0];
 const next={status:String(input.status??e.status),natureCode:input.natureCode===undefined?e.nature_code:input.natureCode,code:String(input.code??e.code),label:String(input.label??e.label),deadlineHours:input.deadlineHours===undefined?(e.deadline_hours===null?undefined:Number(e.deadline_hours)):input.deadlineHours??undefined,sortOrder:input.sortOrder===undefined?Number(e.sort_order):input.sortOrder};
 validate(next);
 const r=await pool.query(`UPDATE workflow_requirements SET status=$2,nature_code=$3,code=$4,label=$5,required=$6,deadline_hours=$7,sort_order=$8,active=$9
 WHERE id=$1 RETURNING *`,[id,next.status,next.natureCode??null,next.code.trim().toUpperCase(),next.label.trim(),input.required===undefined?e.required:input.required,next.deadlineHours??null,next.sortOrder,input.active===undefined?e.active:input.active]);
 await writeAudit({actorId:input.actorId,action:"WORKFLOW_REQUIREMENT_UPDATED",metadata:{requirementId:id,before:e,after:r.rows[0]}});
 return r.rows[0];
}
