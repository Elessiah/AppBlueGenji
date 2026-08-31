require('dotenv').config();
const mysql=require('mysql2/promise');
(async()=>{
  const c=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE});
  const [r]=await c.execute(`SELECT m.tournament_id, t.name, t.format, t.match_format_type, t.match_format_value, COUNT(*) n
    FROM bg_matches m JOIN bg_tournaments t ON t.id=m.tournament_id
    WHERE t.state='RUNNING' AND m.status='READY' AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
    GROUP BY m.tournament_id HAVING n>=3 ORDER BY t.match_format_type IS NULL, n DESC LIMIT 6`);
  console.table(r);
  await c.end();
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
