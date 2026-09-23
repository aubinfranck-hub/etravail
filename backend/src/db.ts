import pg from "pg";
const {Pool}=pg;

const databaseUrl=process.env.DATABASE_URL;

export const pool=new Pool({
  connectionString:databaseUrl,
  max:10,
  idleTimeoutMillis:30000,
  ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:undefined
});

export async function checkDatabase():Promise<boolean>{
  if(!databaseUrl)return false;
  const client=await pool.connect();
  try{
    await client.query("SELECT 1");
    return true;
  }finally{
    client.release();
  }
}
