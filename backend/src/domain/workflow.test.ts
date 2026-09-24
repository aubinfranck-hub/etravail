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
