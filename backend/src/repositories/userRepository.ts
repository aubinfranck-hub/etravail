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
