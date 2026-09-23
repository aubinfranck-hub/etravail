import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

export async function migrateDatabase(){
  const here=path.dirname(fileURLToPath(import.meta.url));
  const schema=await fs.readFile(path.resolve(here,"../../../database/schema.sql"),"utf8");
  await pool.query(schema);
  console.log("e-Travail database schema applied");
}

if(import.meta.url===`file://${process.argv[1]}`){
  try{await migrateDatabase();}finally{await pool.end();}
}
