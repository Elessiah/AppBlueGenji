# Test Data Seeding Guide

## Overview
Ce guide explique comment utiliser les données fictives créées pour tester la visualisation des tournois.

## Running the Seed Script

### Quick Start
```bash
npm run seed
```

The script will:
1. **Clear** existing test data (anything prefixed with `Test_` or `Test -`)
2. **Create** 16 fictional players
3. **Create** 8 fictional teams (with 3 members each)
4. **Create** 1 tournament with a double-elimination bracket
5. **Register** all 8 teams for the tournament

### What Gets Created

#### Players (16 total)
All usernames start with `Test_`:
- Test_ShadowNinja, Test_PhoenixRising, Test_ThunderStrike, Test_FrostByte
- Test_InfernoFlare, Test_VoidWalker, Test_EchoMaster, Test_LunaGhost
- Test_SolarFlash, Test_NeonViper, Test_CrimsonBlade, Test_SilverWing
- Test_IceQueen, Test_InfernoKnight, Test_StormChaser, Test_ObsidianGhost

#### Teams (8 total)
All team names start with `Test -`:
- Test - Dragon Squad
- Test - Phoenix Force
- Test - Thunder Legion
- Test - Frost Alliance
- Test - Eclipse Titans
- Test - Shadow Masters
- Test - Stellar Nexus
- Test - Cosmic Void

#### Tournament
- **Name:** Test Tournament [timestamp]
- **Format:** Double Elimination
- **Max Teams:** 8
- **State:** REGISTRATION (open for team registration)
- **Bracket:** 8-team double elimination bracket with all first round matches seeded

## Testing the Tournament View

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Login** with one of the test user accounts
   - You'll need to authenticate first (use Discord, Google, etc.)
   - OR manually log in via the API if you have direct DB access

3. **Navigate to Tournaments:**
   - Go to `/tournaments` to see the list of all tournaments
   - Look for tournaments starting with "Test Tournament"

4. **View Tournament Details:**
   - Click on the test tournament to view:
     - Tournament information
     - Registered teams
     - Bracket visualization
     - Match information

## Understanding the Bracket Structure

The double-elimination bracket is structured as follows:

```
Upper Bracket (Winners bracket)
- Round 1: 4 matches (8 teams → 4 winners)
- Round 2: 2 matches (4 teams → 2 winners)
- Round 3: 1 match (2 teams → 1 winner)

Lower Bracket (Losers bracket)
- Round 1: 4 matches (4 losers from R1 → 2 winners)
- Round 2: 2 matches 
- Round 3: 1 match

Grand Final
- 1 match between upper bracket winner and lower bracket winner
```

## Seeding Info

All 8 teams are seeded 1-8 based on their registration order:
- Test - Dragon Squad (Seed 1)
- Test - Phoenix Force (Seed 2)
- Test - Thunder Legion (Seed 3)
- Test - Frost Alliance (Seed 4)
- Test - Eclipse Titans (Seed 5)
- Test - Shadow Masters (Seed 6)
- Test - Stellar Nexus (Seed 7)
- Test - Cosmic Void (Seed 8)

## Customizing the Seed

To modify the test data, edit `lib/server/seed.ts`:

### Change Number of Teams
Modify `FICTIONAL_TEAMS` array in the seed file and update the bracket generation function.

### Change Number of Players
Modify `FICTIONAL_PLAYERS` array.

### Change Tournament Settings
Edit the `createTournamentWithMatches` function to change:
- Tournament name
- Format (SINGLE or DOUBLE)
- Max teams
- Dates and registration windows

## Clearing Test Data

To remove all test data without recreating it:
```sql
DELETE FROM bg_matches WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test Tournament%');
DELETE FROM bg_tournament_registrations WHERE tournament_id IN (SELECT id FROM bg_tournaments WHERE name LIKE 'Test Tournament%');
DELETE FROM bg_tournaments WHERE name LIKE 'Test Tournament%';
DELETE FROM bg_team_members WHERE team_id IN (SELECT id FROM bg_teams WHERE name LIKE 'Test -%');
DELETE FROM bg_teams WHERE name LIKE 'Test -%';
DELETE FROM bg_users WHERE pseudo LIKE 'Test_%';
```

## Troubleshooting

### "Connection refused" error
- Ensure MySQL server is running
- Check `.env` file has correct DB_HOST, DB_USER, DB_PASSWORD, DB_DATABASE

### "User already in team" error
- This can happen if you run the seed multiple times without clearing
- Run the seed script again - it automatically clears test data first

### Can't see the tournament
- Make sure you're logged in
- The tournament state might be "UPCOMING" - check the dates
- Tournament visibility starts at `start_visibility_at` date

## Database Notes

- Test data uses prefixes to avoid conflicts with real data
- All test users have visible profiles by default
- All test teams have 3 members each
- Foreign key constraints are temporarily disabled during seeding for better performance
