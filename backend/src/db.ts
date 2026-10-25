import pg from "pg";
const {Pool}=pg;

const databaseUrl=process.env.DATABASE_URL;

export const pool=new Pool({
  connectionString:databaseUrl,
  max:10,
  idleTimeoutMillis:30000,
  ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:undefined
});

// Une connexion inactive coupée (redémarrage de la base, coupure réseau) émet un événement « error » :
// sans écouteur, Node plante tout le serveur.
pool.on("error",(err)=>console.error("[DB] Connexion inactive perdue (le pool se reconnecte seul) :",err.message));

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
