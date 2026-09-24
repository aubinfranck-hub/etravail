import crypto from "node:crypto";
import { pool } from "../db.js";
import { writeAudit } from "../repositories/auditRepository.js";

type PaymentSource = "COMPTABILITE" | "CAISSE" | "EXTERNE";

export function paymentRequirementSatisfied(feeAmount:number|null,paymentStatus:string){
  const fee=feeAmount===null?null:Number(feeAmount);
  return fee===null || fee<=0 || paymentStatus==="PAYE" || paymentStatus==="EXONERE";
}

function hashCode(code:string){
  return crypto.createHash("sha256").update(code.trim()).digest("hex");
}

export async function setupPayment(input:{caseId:string;feeAmount:number;currency?:string;actorId:string}){
  if(!Number.isFinite(input.feeAmount)||input.feeAmount<0) throw new Error("INVALID_PAYMENT_AMOUNT");
  const currency=(input.currency??"XOF").trim().toUpperCase();
  const r=await pool.query(
    `INSERT INTO enrollments(case_id,fee_amount,currency,payment_status)
     VALUES($1,$2,$3,'A_PAYER')
     ON CONFLICT(case_id) DO UPDATE SET fee_amount=EXCLUDED.fee_amount,currency=EXCLUDED.currency,
       payment_status=CASE WHEN enrollments.payment_status='PAYE' THEN enrollments.payment_status ELSE 'A_PAYER' END,
       updated_at=CURRENT_TIMESTAMP
     RETURNING *`,
    [input.caseId,input.feeAmount,currency]
  );
  await writeAudit({actorId:input.actorId,caseId:input.caseId,action:"PAYMENT_SETUP",metadata:{feeAmount:input.feeAmount,currency}});
  return r.rows[0];
}

export async function getPayment(caseId:string){
  const r=await pool.query(
    `SELECT e.*, 
      (SELECT json_agg(json_build_object('id',pvc.id,'source',pvc.source,'external_reference',pvc.external_reference,
        'amount',pvc.amount,'currency',pvc.currency,'issued_at',pvc.issued_at,'used_at',pvc.used_at,
        'issued_by',pvc.issued_by,'used_by',pvc.used_by) ORDER BY pvc.issued_at DESC)
       FROM payment_validation_codes pvc WHERE pvc.case_id=e.case_id) AS validation_codes
     FROM enrollments e WHERE e.case_id=$1`,[caseId]);
  return r.rows[0]??null;
}

export async function registerExternalValidationCode(input:{
  caseId:string; code:string; source:PaymentSource; externalReference?:string;
  amount:number; currency?:string; actorId:string;
}){
  if(!input.code?.trim()) throw new Error("PAYMENT_CODE_REQUIRED");
  if(!Number.isFinite(input.amount)||input.amount<0) throw new Error("INVALID_PAYMENT_AMOUNT");
  const currency=(input.currency??"XOF").trim().toUpperCase();
  const enrollment=await pool.query("SELECT fee_amount,currency FROM enrollments WHERE case_id=$1",[input.caseId]);
  if(!enrollment.rowCount) throw new Error("PAYMENT_NOT_SETUP");
  const fee=enrollment.rows[0].fee_amount===null?null:Number(enrollment.rows[0].fee_amount);
  if(fee!==null && fee!==Number(input.amount)) throw new Error("PAYMENT_AMOUNT_MISMATCH");
  const r=await pool.query(
    `INSERT INTO payment_validation_codes(case_id,code_hash,source,external_reference,amount,currency,issued_by)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     RETURNING id,case_id,source,external_reference,amount,currency,issued_at,issued_by,used_at,used_by`,
    [input.caseId,hashCode(input.code),input.source,input.externalReference??null,input.amount,currency,input.actorId]
  );
  await writeAudit({actorId:input.actorId,caseId:input.caseId,action:"PAYMENT_EXTERNAL_CODE_REGISTERED",
    metadata:{validationId:r.rows[0].id,source:input.source,externalReference:input.externalReference??null,amount:input.amount,currency}});
  return r.rows[0];
}

export async function verifyPaymentByExternalCode(input:{caseId:string;code:string;actorId:string}){
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const code=await client.query(
      `SELECT * FROM payment_validation_codes
       WHERE case_id=$1 AND code_hash=$2 AND used_at IS NULL
       ORDER BY issued_at DESC LIMIT 1 FOR UPDATE`,
      [input.caseId,hashCode(input.code)]
    );
    if(!code.rowCount) throw new Error("PAYMENT_CODE_INVALID_OR_USED");
    const v=code.rows[0];
    const enrollment=await client.query("SELECT * FROM enrollments WHERE case_id=$1 FOR UPDATE",[input.caseId]);
    if(!enrollment.rowCount) throw new Error("PAYMENT_NOT_SETUP");
    const e=enrollment.rows[0];
    const fee=e.fee_amount===null?null:Number(e.fee_amount);
    if(fee!==null && fee!==Number(v.amount)) throw new Error("PAYMENT_AMOUNT_MISMATCH");
    if(String(e.currency).toUpperCase()!==String(v.currency).toUpperCase()) throw new Error("PAYMENT_CURRENCY_MISMATCH");

    const now=new Date();
    await client.query(
      `UPDATE payment_validation_codes SET used_at=$1,used_by=$2 WHERE id=$3`,
      [now,input.actorId,v.id]
    );
    const updated=await client.query(
      `UPDATE enrollments SET payment_status='PAYE',payment_reference=$2,paid_at=$3,updated_at=$3
       WHERE case_id=$1 RETURNING *`,
      [input.caseId,v.external_reference??null,now]
    );
    await client.query("COMMIT");
    await writeAudit({actorId:input.actorId,caseId:input.caseId,action:"PAYMENT_VERIFIED_EXTERNAL_CODE",
      metadata:{validationId:v.id,source:v.source,externalReference:v.external_reference??null,amount:Number(v.amount),currency:v.currency,verifiedAt:now.toISOString()}});
    return updated.rows[0];
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{
    client.release();
  }
}

export async function ensurePaymentForEnrollment(caseId:string){
  const r=await pool.query("SELECT fee_amount,payment_status FROM enrollments WHERE case_id=$1",[caseId]);
  if(!r.rowCount) return;
  const fee=r.rows[0].fee_amount===null?null:Number(r.rows[0].fee_amount);
  if(!paymentRequirementSatisfied(fee,r.rows[0].payment_status)) throw new Error("PAYMENT_NOT_VERIFIED");
}
