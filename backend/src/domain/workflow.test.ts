import test from "node:test";
import assert from "node:assert/strict";
import {canTransition} from "./workflow.js";

test("workflow accepts valid transition",()=>assert.equal(canTransition("BROUILLON","SOUMIS"),true));
test("workflow rejects invalid transition",()=>assert.equal(canTransition("BROUILLON","DECISION_RENDUE"),false));
test("workflow archives only from notification",()=>assert.equal(canTransition("NOTIFIE","ARCHIVE"),true));

import {assignmentRoleByStatus} from "./workflow.js";

test("automatic assignment routes submitted cases to the registry",()=>assert.equal(assignmentRoleByStatus.SOUMIS,"GREFFE"));
test("automatic assignment routes enrollment to magistrate",()=>assert.equal(assignmentRoleByStatus.ENROLEMENT,"MAGISTRAT"));
test("automatic assignment returns the registry after notification",()=>assert.equal(assignmentRoleByStatus.NOTIFIE,"GREFFE"));
