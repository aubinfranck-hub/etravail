import test from "node:test";
import assert from "node:assert/strict";
import {canTransition,transitions} from "./domain/workflow.js";
import {hashPassword,verifyPassword} from "./auth/password.js";

test("workflow only permits declared transitions",()=>{
  for(const [from,targets] of Object.entries(transitions)){
    for(const to of targets) assert.equal(canTransition(from as any,to),true);
  }
  assert.equal(canTransition("BROUILLON","DECISION_RENDUE"),false);
  assert.equal(canTransition("ARCHIVE","BROUILLON"),false);
});

test("password hashing is salted and verifiable",()=>{
  const hash=hashPassword("TestPassword123!");
  assert.notEqual(hash,"TestPassword123!");
  assert.equal(verifyPassword("TestPassword123!",hash),true);
  assert.equal(verifyPassword("wrong-password",hash),false);
});
