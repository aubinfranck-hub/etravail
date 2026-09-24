import { pool } from "../db.js";

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string | null;
  role: "CITOYEN" | "GREFFE" | "MAGISTRAT" | "ADMIN";
  full_name: string | null;
  phone: string | null;
  active: boolean;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const result = await pool.query(
    "SELECT id,email,password_hash,role,full_name,phone,active FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const result = await pool.query(
    "SELECT id,email,password_hash,role,full_name,phone,active FROM users WHERE id=$1",
    [id]
  );
  return result.rows[0] ?? null;
}

export async function listUsers() {
  const result = await pool.query(`SELECT u.id,u.email,u.role,u.full_name,u.phone,u.active,u.created_at,
    COALESCE(array_agg(usa.stage_key ORDER BY usa.stage_key) FILTER (WHERE usa.stage_key IS NOT NULL),'{}') AS stage_access
    FROM users u LEFT JOIN user_stage_access usa ON usa.user_id=u.id
    GROUP BY u.id ORDER BY u.created_at DESC`);
  return result.rows;
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  role: UserRecord["role"];
  fullName?: string;
  phone?: string;
}) {
  const result = await pool.query(
    `INSERT INTO users (email,password_hash,role,full_name,phone)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id,email,password_hash,role,full_name,phone,active`,
    [input.email.toLowerCase(), input.passwordHash, input.role, input.fullName ?? null, input.phone ?? null]
  );
  return result.rows[0] as UserRecord;
}


export async function updateUserAccess(id:string,input:{role:UserRecord["role"];active:boolean}) {
  const result=await pool.query(
    `UPDATE users SET role=$2, active=$3 WHERE id=$1
     RETURNING id,email,role,full_name,phone,active,created_at`,
    [id,input.role,input.active]
  );
  return result.rows[0] ?? null;
}
