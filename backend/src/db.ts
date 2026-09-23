import pg from "pg";
const {Pool}=pg;

const rawDatabaseUrl=process.env.DATABASE_URL;

function getDatabaseConfig(): Record<string,unknown> {
  if(!rawDatabaseUrl) return {};
  try {
    const url=new URL(rawDatabaseUrl);
    const host=url.hostname==="base"
      ?"dpg-daptqa2jnfac73e07670-a.frankfurt-postgres.render.com"
      :url.hostname;
    return {
      host,
      port:url.port?Number(url.port):5432,
      user:decodeURIComponent(url.username),
      password:decodeURIComponent(url.password),
      database:url.pathname.replace(/^\//,""),
    };
  } catch {
    return {connectionString:rawDatabaseUrl};
  }
}

const databaseConfig=getDatabaseConfig();

export const pool=new Pool({
  ...databaseConfig,
  max:10,
  idleTimeoutMillis:30000,
  ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:undefined
});

export async function checkDatabase():Promise<boolean>{
  if(!rawDatabaseUrl)return false;
  const client=await pool.connect();
  try{
    await client.query("SELECT 1");
    return true;
  }finally{
    client.release();
  }
}
