# 📚 Complete Seed Documentation

## 🎯 What Has Been Created

A comprehensive test data system for the Blue Genji tournament application that generates:

- **16 Fictional Players** with realistic usernames and tags
- **8 Fictional Teams** with 3 members each
- **4 Complete Tournaments** at different lifecycle stages

## 📋 Files in This System

| File | Purpose | Usage |
|------|---------|-------|
| `lib/server/seed.ts` | Main seed script that generates all test data | `npm run seed` |
| `lib/server/seed-view.ts` | View generated test data and bracket structures | `npm run seed:view` |
| `TOURNAMENTS_TEST_DATA.md` | Detailed explanation of the 4 tournaments | Reference |
| `TEST_DATA_SETUP.md` | Quick start guide | Getting started |
| `SEED_TESTING.md` | Original seed documentation | Reference |
| `SEED_DOCUMENTATION.md` | This file - Complete overview | Master guide |

## 🚀 Quick Commands

```bash
# Generate all test data
npm run seed

# View the test data
npm run seed:view

# Start development server
npm run dev

# Run tests
npm run test
```

## 📊 Data Generated

### Test Users (16)
All prefixed with `Test_`:
- Test_ShadowNinja
- Test_PhoenixRising
- Test_ThunderStrike
- Test_FrostByte
- Test_InfernoFlare
- Test_VoidWalker
- Test_EchoMaster
- Test_LunaGhost
- Test_SolarFlash
- Test_NeonViper
- Test_CrimsonBlade
- Test_SilverWing
- Test_IceQueen
- Test_InfernoKnight
- Test_StormChaser
- Test_ObsidianGhost

### Test Teams (8)
All prefixed with `Test - `:
| Team | Seed | Members |
|------|------|---------|
| Test - Dragon Squad | 1 | ShadowNinja, PhoenixRising, ThunderStrike |
| Test - Phoenix Force | 2 | FrostByte, InfernoFlare, VoidWalker |
| Test - Thunder Legion | 3 | EchoMaster, LunaGhost, SolarFlash |
| Test - Frost Alliance | 4 | NeonViper, CrimsonBlade, SilverWing |
| Test - Eclipse Titans | 5 | IceQueen, InfernoKnight, StormChaser |
| Test - Shadow Masters | 6 | ShadowNinja, VoidWalker, CrimsonBlade |
| Test - Stellar Nexus | 7 | ThunderStrike, LunaGhost, IceQueen |
| Test - Cosmic Void | 8 | PhoenixRising, SolarFlash, ObsidianGhost |

### Test Tournaments (4)

#### 1️⃣ REGISTRATION Phase
- **Status**: Open for team signup
- **Teams**: 5/8 registered
- **Matches**: 0 (registration phase, no bracket yet)
- **Format**: DOUBLE Elimination
- **Purpose**: Test registration UI

#### 2️⃣ RUNNING (Active)
- **Status**: Matches in progress
- **Teams**: 8/8 registered
- **Matches**: 15 (2 completed, 1 ready, 12 pending)
- **Format**: DOUBLE Elimination
- **Purpose**: Test active tournament with mixed match states

#### 3️⃣ RUNNING (Just Started)
- **Status**: Tournament started, no matches played
- **Teams**: 8/8 registered
- **Matches**: 15 (all pending)
- **Format**: SINGLE Elimination
- **Purpose**: Test recently started tournament

#### 4️⃣ FINISHED
- **Status**: Tournament completed
- **Teams**: 8/8 (with final rankings)
- **Matches**: 15 (all completed with scores)
- **Format**: DOUBLE Elimination
- **Purpose**: Test completed tournament view

## 🎮 Testing the Data

### Step 1: Generate Data
```bash
npm run seed
```
Output:
```
✅ Seed completed successfully!
Test data created:
  - 16 test users (Test_*)
  - 8 test teams (Test - *)
  - 4 test tournaments with different states
```

### Step 2: View the Data
```bash
npm run seed:view
```
Shows:
- All 16 test users
- All 8 test teams with member counts
- All 4 tournaments with their states
- Bracket structure for each tournament
- Match statuses and scores

### Step 3: Start the Application
```bash
npm run dev
```

### Step 4: Test in Browser
1. Navigate to http://localhost:3000
2. Authenticate (Discord/Google/etc.)
3. Go to `/tournaments`
4. View the 4 different tournaments
5. Test bracket rendering for each state

## 🔄 How the Seed Script Works

### Phase 1: Database Cleanup
- Clears all existing test data (prefixed with `Test_` or `Test -`)
- Maintains referential integrity
- Uses transaction-safe deletion

### Phase 2: Create Users
- Creates 16 users with realistic gaming usernames
- Includes Overwatch battletags and Marvel Rivals tags
- Sets visibility flags for profile data

### Phase 3: Create Teams
- Creates 8 teams with 3 members each
- First member is marked as OWNER
- Other members are MEMBERS
- Some teams share players (realistic scenario)

### Phase 4: Create Tournaments
Generates 4 separate tournaments:

1. **Registration Tournament**
   - REGISTRATION state
   - Only 5/8 teams registered
   - No matches generated
   - Tests registration UI

2. **Active Tournament**
   - RUNNING state
   - All 8 teams registered
   - Bracket with mixed match states
   - Tests live tournament view

3. **Just Started Tournament**
   - RUNNING state
   - All 8 teams registered
   - All matches in PENDING state
   - Tests initial bracket view

4. **Finished Tournament**
   - FINISHED state
   - All 8 teams with final rankings
   - All matches completed with scores
   - Tests historical tournament view

## 📁 Database Structure

### Tables Used
- `bg_users` - Player accounts
- `bg_teams` - Team information
- `bg_team_members` - Team roster entries
- `bg_tournaments` - Tournament metadata
- `bg_tournament_registrations` - Team registrations
- `bg_matches` - Individual matches with scores

### Key Relationships
```
Users → Teams (membership)
Teams → Tournaments (registration)
Tournaments → Matches (bracket)
Teams ← Matches (team1_id, team2_id, winner_team_id, loser_team_id)
```

## 🎯 What You Can Test

### Tournament Features
- ✅ Tournament list view with multiple states
- ✅ Tournament detail view
- ✅ Bracket visualization
- ✅ Match information display
- ✅ Team information
- ✅ Registration status and availability
- ✅ Live tournament updates
- ✅ Completed tournament history

### Bracket Features
- ✅ Upper bracket visualization
- ✅ Lower bracket visualization
- ✅ Grand final display
- ✅ Match seeding
- ✅ Score display
- ✅ Match status indicators
- ✅ Team progression visualization

### UI/UX Features
- ✅ Responsive layout
- ✅ Visual status indicators
- ✅ Team card displays
- ✅ Match card displays
- ✅ Navigation between tournaments
- ✅ Data consistency across pages

### Data States
- ✅ REGISTRATION phase
- ✅ RUNNING state
- ✅ FINISHED state
- ✅ PENDING matches
- ✅ READY matches
- ✅ COMPLETED matches
- ✅ Mixed match states

## 🧹 Cleaning Up

### Clear Just Test Data
```bash
npm run seed
```
(Automatically clears old test data)

### Clear from Database Directly
```sql
DELETE FROM bg_matches WHERE tournament_id IN 
  (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%');
DELETE FROM bg_tournament_registrations WHERE tournament_id IN 
  (SELECT id FROM bg_tournaments WHERE name LIKE 'Test -%');
DELETE FROM bg_tournaments WHERE name LIKE 'Test -%';
DELETE FROM bg_team_members WHERE team_id IN 
  (SELECT id FROM bg_teams WHERE name LIKE 'Test -%');
DELETE FROM bg_teams WHERE name LIKE 'Test -%';
DELETE FROM bg_users WHERE pseudo LIKE 'Test_%';
```

## 🔧 Customization

### Modify Tournament Settings
Edit `lib/server/seed.ts`:

```typescript
// Change tournament format
format: "SINGLE", // or "DOUBLE"

// Change date offsets
const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

// Adjust team count
const teamsToRegister = teamIds.slice(0, 4); // Register only 4 teams
```

### Add More Players
Add to `FICTIONAL_PLAYERS` array:
```typescript
const FICTIONAL_PLAYERS = [
  // ... existing
  { pseudo: "NewPlayer", battletag: "NewPlayer#1234", marvelTag: "NewPlayer#2023" },
];
```

### Add More Teams
Add to `FICTIONAL_TEAMS` array:
```typescript
const FICTIONAL_TEAMS = [
  // ... existing
  { name: "New Team", members: [0, 5, 10] },
];
```

Then run `npm run seed` to regenerate with your changes.

## ⚠️ Important Notes

- **Test data only**: All data is prefixed with `Test_` or `Test -` for easy identification
- **Safe to run**: Script automatically clears old test data before creating new
- **Performance**: Suitable for testing UI and bracket rendering
- **Database**: Requires MySQL connection as per `.env` configuration
- **Transactions**: Maintains referential integrity through cascade deletes

## 📞 Troubleshooting

### "Connection refused"
Check `.env` for database credentials:
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_DATABASE=blue_genji
```

### "FOREIGN_KEY_CHECKS" error
Ensure you're not manually deleting data while running seed

### Seed takes too long
This is normal - it's inserting a lot of data with matches

### Can't see tournaments in UI
1. Verify seed ran successfully: `npm run seed:view`
2. Ensure you're logged in
3. Check tournament visibility dates in `.env` or seed script
4. Check browser console for errors

## 📖 Additional Resources

- `TOURNAMENTS_TEST_DATA.md` - Detailed tournament specifications
- `TEST_DATA_SETUP.md` - Quick start guide
- `SEED_TESTING.md` - Original seed documentation
- Database schema: `lib/server/database.ts`
- Tournament API: `app/api/tournaments/`

## ✅ Verification Checklist

After running the seed, verify:
- [ ] 4 tournaments created: `npm run seed:view`
- [ ] Tournament 1: REGISTRATION state, 5/8 teams
- [ ] Tournament 2: RUNNING state, 8/8 teams, some matches completed
- [ ] Tournament 3: RUNNING state, 8/8 teams, all matches pending
- [ ] Tournament 4: FINISHED state, 8/8 teams, all matches completed
- [ ] 16 users created with Test_ prefix
- [ ] 8 teams created with Test - prefix
- [ ] 15 matches per tournament (60 total)
- [ ] Can view tournaments in browser: `npm run dev`

## 🎉 You're Ready!

Everything is set up for comprehensive tournament testing. The data covers:
- All tournament lifecycle states
- Mixed match completion states
- Different bracket formats
- Complete team and player data

Happy testing! 🚀
