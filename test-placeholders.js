import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
});

(async () => {
  try {
    // Check all LOWER bracket matches
    const [rows] = await pool.execute(`
      SELECT m.tournament_id, m.id, m.bracket, m.round_number, m.match_number, m.team1_placeholder, m.team2_placeholder
      FROM bg_matches m
      WHERE m.bracket = 'LOWER'
      ORDER BY m.tournament_id, m.round_number, m.match_number
      LIMIT 6
    `);

    if (rows.length === 0) {
      console.log('No LOWER bracket matches found');
    } else {
      console.log('\n✅ LOWER bracket matches:');
      rows.forEach(row => {
        const t1 = row.team1_placeholder === null ? '[NULL]' : `"${row.team1_placeholder}"`;
        const t2 = row.team2_placeholder === null ? '[NULL]' : `"${row.team2_placeholder}"`;
        console.log(`  T${row.tournament_id} R${row.round_number}M${row.match_number}: ${t1} vs ${t2}`);
      });
    }

    // Check if columns exist
    const [cols] = await pool.execute('DESCRIBE bg_matches');
    const hasTeam1Placeholder = cols.some(c => c.Field === 'team1_placeholder');
    const hasTeam2Placeholder = cols.some(c => c.Field === 'team2_placeholder');
    console.log(`\nColumn team1_placeholder exists: ${hasTeam1Placeholder}`);
    console.log(`Column team2_placeholder exists: ${hasTeam2Placeholder}`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
