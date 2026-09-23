import pg from "pg";
const {Pool}=pg;

function getDatabaseUrl(): string | undefined {
  const raw=process.env.DATABASE_URL;
  if(!raw) return undefined;
  try {
    const url=new URL(raw);
    if(url.hostname==="base"){
      url.hostname="dpg-daptqa2jnfac73e07670-a.frankfurt-postgres.render.com";
    }
    return url.toString();
  } catch {
    return raw;
  }
}

const databaseUrl=getDatabaseUrl();

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
