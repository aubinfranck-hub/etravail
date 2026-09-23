import test from "node:test";
import assert from "node:assert/strict";
import {canTransition} from "./workflow.js";

test("workflow accepts valid transition",()=>assert.equal(canTransition("BROUILLON","SOUMIS"),true));
test("workflow rejects invalid transition",()=>assert.equal(canTransition("BROUILLON","DECISION_RENDUE"),false));
test("workflow archives only from notification",()=>assert.equal(canTransition("NOTIFIE","ARCHIVE"),true));
