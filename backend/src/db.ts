import pg from "pg";
const {Pool}=pg;
export const pool=new Pool({connectionString:process.env.DATABASE_URL,max:10,idleTimeoutMillis:30000,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:undefined});
export async function checkDatabase():Promise<boolean>{if(!process.env.DATABASE_URL)return false;const client=await pool.connect();try{await client.query("SELECT 1");return true}finally{client.release()}}
