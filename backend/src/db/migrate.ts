import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const here=path.dirname(fileURLToPath(import.meta.url));
const schema=await fs.readFile(path.resolve(here,"../../../database/schema.sql"),"utf8");
await pool.query(schema);
await pool.end();
console.log("e-Travail database schema applied");
