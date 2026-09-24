import { createUser, findUserByEmail } from "../repositories/userRepository.js";
import { pool } from "../db.js";
import { hashPassword, verifyPassword } from "../auth/password.js";

export async function registerCitizen(input: { email: string; password: string; fullName?: string; phone?: string }) {
  if (input.password.length < 8) throw new Error("PASSWORD_TOO_SHORT");
  if (await findUserByEmail(input.email)) throw new Error("EMAIL_EXISTS");
  return createUser({
    email: input.email,
    passwordHash: hashPassword(input.password),
    role: "CITOYEN",
    fullName: input.fullName,
    phone: input.phone
  });
}

export async function authenticate(email: string, password: string) {
  const user = await findUserByEmail(email);
  if (!user || !user.active || !user.password_hash || !verifyPassword(password, user.password_hash)) {
    throw new Error("INVALID_CREDENTIALS");
  }
  return user;
}


export async function createStaffAccount(input:{email:string;password:string;fullName?:string;phone?:string;role:"GREFFE"|"MAGISTRAT"|"ADMIN";stages:string[];createdBy:string}) {
  if(input.password.length<8) throw new Error("PASSWORD_TOO_SHORT");
  if(await findUserByEmail(input.email)) throw new Error("EMAIL_EXISTS");
  const allowed=["SAISINE","GREFFE","CONTROLE","ENROLEMENT","AUDIENCES","DECISIONS","NOTIFICATION","ARCHIVAGE"];
  const stages=[...new Set(input.stages)].filter(x=>allowed.includes(x));
  if(!stages.length) throw new Error("STAGE_REQUIRED");
  const user=await createUser({email:input.email,passwordHash:hashPassword(input.password),role:input.role,fullName:input.fullName,phone:input.phone});
  for(const stage of stages) await pool.query(`INSERT INTO user_stage_access(user_id,stage_key,granted_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[user.id,stage,input.createdBy]);
  return {...user,stage_access:stages};
}
