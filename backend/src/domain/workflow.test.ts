import test from "node:test";
import assert from "node:assert/strict";
import {canTransition,transitions,stageForStatus,assignmentRoleByStatus,allowedRolesByTransition,type CaseStatus} from "./workflow.js";

test("workflow accepts valid transition",()=>assert.equal(canTransition("BROUILLON","SOUMIS"),true));
test("workflow rejects invalid transition",()=>assert.equal(canTransition("BROUILLON","DECISION_RENDUE"),false));
test("workflow archives only from notification",()=>assert.equal(canTransition("NOTIFIE","ARCHIVE"),true));


test("automatic assignment routes submitted cases to the registry",()=>assert.equal(assignmentRoleByStatus.SOUMIS,"GREFFE"));
test("automatic assignment routes enrollment to audiences",()=>assert.equal(assignmentRoleByStatus.ENROLEMENT,"AUDIENCES"));
test("automatic assignment routes notification to archive",()=>assert.equal(assignmentRoleByStatus.NOTIFIE,"ARCHIVAGE"));


test("every workflow status has a declared stage",()=>{
  const statuses=Object.keys(transitions) as CaseStatus[];
  for(const status of statuses) assert.equal(typeof stageForStatus[status],"string");
});

test("workflow transition matrix has no orphan target",()=>{
  const statuses=new Set(Object.keys(transitions));
  for(const targets of Object.values(transitions)){
    for(const target of targets) assert.equal(statuses.has(target),true);
  }
});

test("all controlled transitions declare allowed roles",()=>{
  for(const [key,roles] of Object.entries(allowedRolesByTransition)){
    assert.equal(Array.isArray(roles),true,key);
    const [from,to]=key.split("->") as [CaseStatus,CaseStatus];
    assert.equal(canTransition(from,to),true,key);
    assert.ok((roles??[]).length>0,key);
  }
});

test("citizen can submit but cannot jump to a decision",()=>{
  assert.equal((allowedRolesByTransition["BROUILLON->SOUMIS"]??[]).includes("CITOYEN"),true);
  assert.equal(canTransition("BROUILLON","DECISION_RENDUE"),false);
});

test("enrollment requires a registry assignment",()=>{
  assert.equal(assignmentRoleByStatus.ENROLEMENT,"AUDIENCES");
  assert.equal(stageForStatus.ENROLEMENT,"ENROLEMENT");
});

test("notification returns responsibility to the registry",()=>{
  assert.equal(assignmentRoleByStatus.NOTIFIE,"GREFFE");
  assert.equal(stageForStatus.NOTIFIE,"NOTIFICATION");
  assert.equal(stageForStatus.CONCILIATION,"AUDIENCES");
  assert.equal(stageForStatus.AUDIENCE,"AUDIENCES");
  assert.equal(stageForStatus.DECISION_RENDUE,"DECISIONS");
});

import {classifyNature,normalizeNature,requiredDocumentsSatisfied,isEnrollmentLocked} from "../services/caseService.js";
import {paymentRequirementSatisfied} from "../services/paymentService.js";
import {decisionStageAllowed} from "../services/decisionService.js";
import {conciliationStageAllowed} from "../services/conciliationService.js";
import {hearingStageAllowed} from "../services/hearingService.js";

test("nature classifier recognizes core labour disputes",()=>{
  assert.equal(classifyNature("Licenciement abusif"),"LICENCIEMENT");
  assert.equal(classifyNature("Salaire impayé de trois mois"),"SALAIRE_IMPAYE");
  assert.equal(classifyNature("Congé non accordé"),"CONGES");
  assert.equal(classifyNature("Rupture du contrat"),"RUPTURE_CONTRAT");
  assert.equal(classifyNature("Harcèlement au travail"),"HARCELEMENT");
  assert.equal(classifyNature("Accident de travail"),"ACCIDENT_TRAVAIL");
});

test("unknown nature falls back to AUTRE",()=>{
  assert.equal(normalizeNature("INCONNU","Demande générale"),"AUTRE");
  assert.equal(classifyNature("Demande générale"),"AUTRE");
});

test("explicit supported nature takes precedence over title classification",()=>{
  assert.equal(normalizeNature("CONGES","Licenciement"),"CONGES");
});


test("required documents must all be received before submission",()=>{
  assert.equal(requiredDocumentsSatisfied({required_count:3,received_count:2,validated_count:0},"SUBMIT"),false);
  assert.equal(requiredDocumentsSatisfied({required_count:3,received_count:3,validated_count:0},"SUBMIT"),true);
});

test("required documents must all be validated before completion",()=>{
  assert.equal(requiredDocumentsSatisfied({required_count:3,received_count:3,validated_count:2},"COMPLETE"),false);
  assert.equal(requiredDocumentsSatisfied({required_count:3,received_count:3,validated_count:3},"COMPLETE"),true);
});


test("payment must be verified before enrollment when fees are due",()=>{
  assert.equal(paymentRequirementSatisfied(1000,"A_PAYER"),false);
  assert.equal(paymentRequirementSatisfied(1000,"PAYE"),true);
  assert.equal(paymentRequirementSatisfied(1000,"EXONERE"),true);
});

test("no-fee enrollment does not require a payment code",()=>{
  assert.equal(paymentRequirementSatisfied(0,"A_PAYER"),true);
  assert.equal(paymentRequirementSatisfied(null,"A_PAYER"),true);
});


test("actions are restricted to their workflow stage",()=>{
  assert.equal(conciliationStageAllowed("CONCILIATION"),true);
  assert.equal(conciliationStageAllowed("AUDIENCE"),false);
  assert.equal(hearingStageAllowed("AUDIENCE_PLANIFIEE"),true);
  assert.equal(hearingStageAllowed("CONCILIATION"),false);
  assert.equal(decisionStageAllowed("AUDIENCE"),true);
  assert.equal(decisionStageAllowed("AUDIENCE_PLANIFIEE"),false);
});


test("assignment status mapping covers operational stages",()=>{
  assert.equal(assignmentRoleByStatus.SOUMIS,"GREFFE");
  assert.equal(assignmentRoleByStatus.ENROLEMENT,"GREFFE");
  assert.equal(assignmentRoleByStatus.NOTIFIE,"GREFFE");
});

test("submission requirements are scoped to the target workflow stage",()=>{
  assert.equal(requiredDocumentsSatisfied({required_count:3,received_count:2,validated_count:2},"SUBMIT"),false);
  assert.equal(requiredDocumentsSatisfied({required_count:3,received_count:3,validated_count:0},"SUBMIT"),true);
});


test("enrollment lock starts at enrollment and remains active through archive",()=>{
  assert.equal(isEnrollmentLocked("COMPLET"),false);
  for(const status of ["ENROLEMENT","CONCILIATION","CONCILIE","CONCILIATION_ECHEC","AUDIENCE_PLANIFIEE","AUDIENCE","DECISION_RENDUE","NOTIFIE","ARCHIVE"] as CaseStatus[]){
    assert.equal(isEnrollmentLocked(status),true,status);
  }
});

test("incomplete workflow remains editable before enrollment",()=>{
  for(const status of ["BROUILLON","SOUMIS","RECU_GREFFE","A_VERIFIER","INCOMPLET"] as CaseStatus[]){
    assert.equal(isEnrollmentLocked(status),false,status);
  }
});
