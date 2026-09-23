import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

function hashPassword(password:string){
  const salt=crypto.randomBytes(16).toString("hex");
  const derived=crypto.scryptSync(password,salt,64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

async function seedUser(email:string,password:string,role:"ADMIN"|"CITOYEN",fullName:string){
  const existing=await pool.query("SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1",[email]);
  if(existing.rowCount) return;
  await pool.query(
    "INSERT INTO users(email,password_hash,role,full_name,active) VALUES($1,$2,$3,$4,TRUE)",
    [email.trim().toLowerCase(),hashPassword(password),role,fullName]
  );
  console.log(`e-Travail bootstrap user created: ${email} (${role})`);
}

export async function migrateDatabase(){
  const here=path.dirname(fileURLToPath(import.meta.url));
  const schema=await fs.readFile(path.resolve(here,"../../../database/schema.sql"),"utf8");
  await pool.query(schema);

  const adminEmail=process.env.ETRAVAIL_BOOTSTRAP_ADMIN_EMAIL;
  const adminPassword=process.env.ETRAVAIL_BOOTSTRAP_ADMIN_PASSWORD;
  const userEmail=process.env.ETRAVAIL_BOOTSTRAP_USER_EMAIL;
  const userPassword=process.env.ETRAVAIL_BOOTSTRAP_USER_PASSWORD;

  if(adminEmail&&adminPassword) await seedUser(adminEmail,adminPassword,"ADMIN","Administrateur e-Travail");
  if(userEmail&&userPassword) await seedUser(userEmail,userPassword,"CITOYEN","Utilisateur test e-Travail");
}

if(import.meta.url===`file://${process.argv[1]}`){
  try{await migrateDatabase();}finally{await pool.end();}
}
