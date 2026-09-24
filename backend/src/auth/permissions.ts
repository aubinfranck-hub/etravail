import {pool} from "../db.js";

export type Role = "CITOYEN" | "GREFFE" | "MAGISTRAT" | "ADMIN";

export const permissions: Record<Role, string[]> = {
  CITOYEN: ["case:create","case:read:own","case:document:own","notification:read:own","legal:read"],
  GREFFE: ["case:read","case:transition","case:document","hearing:manage","notification:manage","legal:read"],
  MAGISTRAT: ["case:read","case:transition","case:document","hearing:manage","decision:create","notification:manage","legal:read"],
  ADMIN: ["case:read","case:transition","case:document","hearing:manage","decision:create","notification:manage","admin:manage","legal:read","legal:manage"]
};

let effective: Record<Role,string[]> = JSON.parse(JSON.stringify(permissions));

export async function loadPermissions(){
  const rows=await pool.query("SELECT role,permission,enabled FROM role_permissions");
  const next:Record<Role,string[]>=JSON.parse(JSON.stringify(permissions));
  for(const r of rows.rows){
    const role=r.role as Role;
    if(!next[role]) continue;
    next[role]=next[role].filter(p=>p!==r.permission);
    if(r.enabled) next[role].push(r.permission);
  }
  effective=next;
}

export function hasPermission(role:Role,permission:string){
  return effective[role]?.includes(permission)??false;
}

export async function listPermissions(){
  const rows=await pool.query("SELECT role,permission,enabled,updated_at FROM role_permissions ORDER BY role,permission");
  return rows.rows;
}

export async function setPermission(input:{role:Role;permission:string;enabled:boolean;actorId:string}){
  if(input.role==="ADMIN"&&input.permission==="admin:manage"&&!input.enabled) throw new Error("ADMIN_MANAGE_REQUIRED");
  if(!permissions[input.role]) throw new Error("INVALID_ROLE");
  if(!permissions[input.role].includes(input.permission)) throw new Error("INVALID_PERMISSION");
  const r=await pool.query(`INSERT INTO role_permissions(role,permission,enabled,updated_at)
    VALUES($1,$2,$3,CURRENT_TIMESTAMP)
    ON CONFLICT(role,permission) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=CURRENT_TIMESTAMP
    RETURNING *`,[input.role,input.permission,input.enabled]);
  await loadPermissions();
  return r.rows[0];
}
