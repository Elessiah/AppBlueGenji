import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

(async () => {
  try {
    // Get largest DOUBLE tournament
    const [tourn] = await pool.execute(`
      SELECT t.id, r.registered_teams
      FROM bg_tournaments t
      LEFT JOIN (
        SELECT tournament_id, COUNT(*) as registered_teams
        FROM bg_tournament_registrations
        GROUP BY tournament_id
      ) r ON r.tournament_id = t.id
      WHERE t.format = 'DOUBLE' AND r.registered_teams >= 5
      ORDER BY r.registered_teams DESC
      LIMIT 1
    `);

    if (!tourn || tourn.length === 0) {
      console.log('❌ No suitable tournament found');
      process.exit(0);
    }

    const tid = tourn[0].id;
    console.log(`\n✅ Checking tournament T${tid} (${tourn[0].registered_teams} teams):`);

    const [matches] = await pool.execute(`
      SELECT bracket, round_number, COUNT(*) as cnt
      FROM bg_matches
      WHERE tournament_id = ?
      GROUP BY bracket, round_number
      ORDER BY FIELD(bracket, 'UPPER', 'LOWER', 'GRAND'), round_number
    `, [tid]);

    for (const m of matches) {
      console.log(`${m.bracket} R${m.round_number}: ${m.cnt} matches`);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
