# 🎮 Test Data Setup - Blue Genji Tournament App

## Quick Start Guide

### One Command to Create Everything
```bash
npm run seed
```

This will instantly create:
- ✅ 16 fictional players (users)
- ✅ 8 fictional teams with members
- ✅ 1 complete tournament with double-elimination bracket

### View What Was Created
```bash
npm run seed:view
```

Output will show:
- All test users (prefixed with `Test_`)
- All test teams (prefixed with `Test -`)
- Tournament details
- Complete bracket structure

## 🚀 What's Next: Testing the Tournament

### 1. Start the Dev Server
```bash
npm run dev
```

### 2. Access the Application
Open http://localhost:3000 in your browser

### 3. Navigate to Tournaments
- Click "Tournois" (Tournaments) in the navigation menu
- Look for a tournament named "Test Tournament" with a timestamp

### 4. View Tournament Details
- Click on the test tournament
- You'll see:
  - **Tournament Info**: Name, format (DOUBLE elimination), teams (8)
  - **Registered Teams**: All 8 test teams listed
  - **Bracket Visualization**: 
    - Upper bracket with first round seeded matches
    - Lower bracket placeholder
    - Grand final

## 📊 Test Data Summary

### Players Created (16 total)
All with usernames starting with `Test_`:
```
Test_ShadowNinja        Test_ThunderStrike       Test_FrostByte          Test_VoidWalker
Test_PhoenixRising      Test_InfernoFlare        Test_EchoMaster         Test_LunaGhost
Test_SolarFlash         Test_NeonViper           Test_CrimsonBlade       Test_SilverWing
Test_IceQueen           Test_InfernoKnight       Test_StormChaser        Test_ObsidianGhost
```

### Teams Created (8 total)
All with names starting with `Test -`:
| Team Name | Seed | Members |
|-----------|------|---------|
| Test - Dragon Squad | 1 | ShadowNinja, PhoenixRising, ThunderStrike |
| Test - Phoenix Force | 2 | FrostByte, InfernoFlare, VoidWalker |
| Test - Thunder Legion | 3 | EchoMaster, LunaGhost, SolarFlash |
| Test - Frost Alliance | 4 | NeonViper, CrimsonBlade, SilverWing |
| Test - Eclipse Titans | 5 | IceQueen, InfernoKnight, StormChaser |
| Test - Shadow Masters | 6 | ShadowNinja, VoidWalker, CrimsonBlade |
| Test - Stellar Nexus | 7 | ThunderStrike, LunaGhost, IceQueen |
| Test - Cosmic Void | 8 | PhoenixRising, SolarFlash, ObsidianGhost |

### Tournament Structure
- **Format**: Double Elimination (DOUBLE)
- **Max Teams**: 8
- **Registered Teams**: All 8 teams
- **Total Matches**: 15
  - **Upper Bracket**: 7 matches (R1: 4, R2: 2, R3: 1)
  - **Lower Bracket**: 7 matches (R1: 4, R2: 2, R3: 1)
  - **Grand Final**: 1 match

## 🧪 What You Can Test

### 1. **Bracket Visualization**
- ✅ Seed order display
- ✅ Team matchups in first round
- ✅ Bracket progression structure
- ✅ Visual layout (responsive design)

### 2. **Team Information**
- ✅ Team names and logos
- ✅ Team member listings
- ✅ Member roles and join dates

### 3. **Tournament Navigation**
- ✅ Tournament listing
- ✅ Tournament detail view
- ✅ Team registration info
- ✅ Match information

### 4. **Rendering Quality**
- ✅ Bracket visual layout
- ✅ Team card displays
- ✅ Match card rendering
- ✅ Responsive layout on different screen sizes

## 🔧 Advanced: Customize Test Data

### Clear and Recreate
```bash
npm run seed
```
Running the seed again will:
1. Delete all previous test data
2. Create fresh test data

### View Current Test Data
```bash
npm run seed:view
```

### Manual Database Editing
For detailed customization, edit `lib/server/seed.ts`:

**Increase number of teams:**
```typescript
// Add more entries to FICTIONAL_TEAMS array
const FICTIONAL_TEAMS = [
  { name: "My Team 1", members: [0, 1, 2] },
  { name: "My Team 2", members: [3, 4, 5] },
  // Add more teams here...
];
```

**Change tournament format:**
```typescript
format: "SINGLE", // Change from "DOUBLE" to "SINGLE"
```

**Adjust tournament timing:**
```typescript
start_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // Change days offset
```

Then run `npm run seed` again to apply changes.

## 🆘 Troubleshooting

### "Connection refused" Error
**Problem**: Can't connect to database
**Solution**: 
- Ensure MySQL is running
- Check `.env` file has correct credentials:
  ```
  DB_HOST=localhost
  DB_USER=root
  DB_PASSWORD=yourpassword
  DB_DATABASE=blue_genji
  ```

### Seed Script Hangs
**Problem**: Script doesn't complete
**Solution**: 
- Press Ctrl+C to stop
- Check MySQL connection
- Verify database is accessible

### Can't See Tournament
**Problem**: Created tournament doesn't appear in UI
**Possible Causes**:
- Tournament state is "UPCOMING" (check start_visibility_at date)
- Not logged in
- Browser cache issue (try Ctrl+Shift+Delete)
- Tournament visibility settings

### Duplicate Data
**Problem**: Running seed twice creates multiple copies
**Why**: Seed automatically clears test data first, but if something interrupts...
**Solution**: Run seed again - it clears existing test data before creating new

## 📝 Files Created

- `lib/server/seed.ts` - Main seed script
- `lib/server/seed-view.ts` - Data viewing script
- `SEED_TESTING.md` - Detailed seeding documentation
- `TEST_DATA_SETUP.md` - This file

## 🎯 Next Steps

1. **Run the seed**: `npm run seed`
2. **Start the app**: `npm run dev`
3. **View the tournament**: Navigate to /tournaments in your browser
4. **Test the rendering**: Interact with the tournament details
5. **Report issues**: Note any visual glitches or missing features

Enjoy testing! 🚀
