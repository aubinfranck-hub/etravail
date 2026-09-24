import test from "node:test";
import assert from "node:assert/strict";
import {canTransition,transitions,stageForStatus,assignmentRoleByStatus,allowedRolesByTransition,type CaseStatus} from "./workflow.js";

test("workflow accepts valid transition",()=>assert.equal(canTransition("BROUILLON","SOUMIS"),true));
test("workflow rejects invalid transition",()=>assert.equal(canTransition("BROUILLON","DECISION_RENDUE"),false));
test("workflow archives only from notification",()=>assert.equal(canTransition("NOTIFIE","ARCHIVE"),true));


test("automatic assignment routes submitted cases to the registry",()=>assert.equal(assignmentRoleByStatus.SOUMIS,"GREFFE"));
test("automatic assignment routes enrollment to magistrate",()=>assert.equal(assignmentRoleByStatus.ENROLEMENT,"MAGISTRAT"));
test("automatic assignment returns the registry after notification",()=>assert.equal(assignmentRoleByStatus.NOTIFIE,"GREFFE"));


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
  assert.deepEqual(allowedRolesByTransition["BROUILLON->SOUMIS"],["CITOYEN"]);
  assert.equal(canTransition("BROUILLON","DECISION_RENDUE"),false);
});

test("enrollment requires a magistrate assignment",()=>{
  assert.equal(assignmentRoleByStatus.ENROLEMENT,"MAGISTRAT");
  assert.equal(stageForStatus.ENROLEMENT,"GREFFE");
});

test("notification returns responsibility to the registry",()=>{
  assert.equal(assignmentRoleByStatus.NOTIFIE,"GREFFE");
  assert.equal(stageForStatus.NOTIFIE,"NOTIFICATION");
});

import {classifyNature,normalizeNature,requiredDocumentsSatisfied} from "../services/caseService.js";
import {paymentRequirementSatisfied} from "../services/paymentService.js";

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
  const {requiredDocumentsSatisfied}=require("../services/caseService.js");
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
