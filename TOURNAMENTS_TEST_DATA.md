# 🎮 Test Tournaments - Multiple States

## Overview

Le script de seed génère maintenant **4 tournois complets** à différents stades pour tester complètement le rendu des tournois:

1. **REGISTRATION** - Tournoi en phase d'inscription
2. **RUNNING** - Tournoi actif avec des matchs en cours
3. **RUNNING** - Tournoi venant de commencer (sans matchs)
4. **FINISHED** - Tournoi terminé avec résultats finaux

## 🚀 Quick Start

```bash
npm run seed          # Create all 4 tournaments with test data
npm run seed:view     # View the tournaments and bracket structures
npm run dev           # Start the development server
```

## 📋 Tournament Details

### Tournament 1: REGISTRATION Phase
- **Name**: Test - Registration Phase [timestamp]
- **State**: REGISTRATION
- **Format**: DOUBLE Elimination
- **Teams**: 5/8 registered (3 spots available)
- **Matches**: 0 (not generated for registration)
- **Description**: Tournament open for team signup
- **Testing Purpose**: Test the registration phase UI, show partial registration

**Key Features to Test**:
- Registration button visibility
- Remaining spots display
- Team listing with registration status
- "Register your team" CTA

---

### Tournament 2: RUNNING (Active)
- **Name**: Test - Active Tournament [timestamp]
- **State**: RUNNING
- **Format**: DOUBLE Elimination
- **Teams**: 8/8 registered
- **Matches**: 15 total (with partial results)
- **Description**: Tournament currently running with matches in progress

**Match Status Distribution**:
- ✅ **COMPLETED (2)**: 
  - Match 1: Dragon Squad vs Phoenix Force (2-1)
  - Match 2: Thunder Legion vs Frost Alliance (2-1)
- 🟡 **READY (1)**: Match 1 Round 2: Dragon Squad vs Thunder Legion
- ⏳ **PENDING (12)**: All other matches

**Upper Bracket Progress**:
```
Round 1:  4 matches (2 done, 2 in progress)
Round 2:  2 matches (1 ready, 1 pending)
Round 3:  1 match (pending)
```

**Testing Purpose**: Test active tournament with in-progress matches

**Key Features to Test**:
- Show completed match results with scores
- Display ready matches (teams determined, waiting to play)
- Show pending matches (waiting for dependencies)
- Bracket progression visualization
- Live/ongoing tournament appearance

---

### Tournament 3: RUNNING (Just Started)
- **Name**: Test - Just Started [timestamp]
- **State**: RUNNING
- **Format**: SINGLE Elimination
- **Teams**: 8/8 registered
- **Matches**: 15 total (all PENDING)
- **Description**: Tournament just started - matches haven't begun yet

**Match Status Distribution**:
- ⏳ **PENDING (15)**: All matches
- Seeded first round teams assigned

**Testing Purpose**: Test recently started tournament with all pending matches

**Key Features to Test**:
- Bracket seeding display
- All matches in PENDING state
- First round teams visible and seeded
- No completed matches or results
- SINGLE elimination format rendering

---

### Tournament 4: FINISHED
- **Name**: Test - Finished Tournament [timestamp]
- **State**: FINISHED
- **Format**: DOUBLE Elimination
- **Teams**: 8/8 registered (all with final_rank)
- **Matches**: 15 total (all COMPLETED)
- **Description**: Tournament has finished - final results available

**Upper Bracket Results**:
- Round 1: Dragon Squad 2-1 Phoenix Force, Thunder Legion 2-1 Frost Alliance, etc.
- Round 2: Dragon Squad 2-1 Thunder Legion, Eclipse Titans 2-1 Stellar Nexus
- Round 3: Dragon Squad 2-1 Eclipse Titans (Winner)

**Lower Bracket Results**:
- Losers progress through the bracket
- Phoenix Force 2-1 Frost Alliance
- Shadow Masters 2-1 Cosmic Void
- Etc.

**Grand Final**:
- Dragon Squad vs Phoenix Force (2-1)

**Testing Purpose**: Test completed tournament with full bracket history

**Key Features to Test**:
- Complete bracket with all scores
- Final rankings display
- Tournament completion indicator
- Historic bracket view
- All bracket levels visible (UPPER, LOWER, GRAND)

---

## 📊 Bracket Structure

All tournaments use the same bracket infrastructure:

### Teams (8 seeded)
1. Dragon Squad (Seed 1)
2. Phoenix Force (Seed 2)
3. Thunder Legion (Seed 3)
4. Frost Alliance (Seed 4)
5. Eclipse Titans (Seed 5)
6. Shadow Masters (Seed 6)
7. Stellar Nexus (Seed 7)
8. Cosmic Void (Seed 8)

### Matches per Tournament
- **15 total matches**:
  - **Upper Bracket**: 7 matches (4 + 2 + 1)
  - **Lower Bracket**: 7 matches (4 + 2 + 1)
  - **Grand Final**: 1 match

### Match Status Types
- 🔵 **PENDING**: Match waiting to start (teams TBD or dependencies not met)
- 🟡 **READY**: Match ready to play (teams determined)
- 🟢 **COMPLETED**: Match finished with score
- 🟠 **AWAITING_CONFIRMATION**: Teams reported different scores

---

## 🧪 Testing Scenarios

### Scenario 1: Registration Phase
1. Navigate to `/tournaments`
2. Look for "Registration Phase" tournament
3. Verify:
   - Registration phase indicator
   - Teams count (5/8)
   - "Register your team" button
   - Remaining spots message
   - No bracket/matches displayed

### Scenario 2: Active Tournament
1. Click on "Active Tournament"
2. View bracket with mixed match states:
   - Completed matches show: `Team A 2 - 1 Team B`
   - Ready matches show: `Team A vs Team B [READY]`
   - Pending matches show: `TBD vs TBD [PENDING]`
3. Verify:
   - Bracket progression from completed matches
   - Score display for finished matches
   - Status indicators for different match states
   - Upper and Lower bracket visible
   - Tournament appearance as "RUNNING"

### Scenario 3: Just Started Tournament
1. Click on "Just Started" tournament
2. Verify:
   - All 8 teams in first round
   - All matches showing PENDING status
   - Seeding order respected
   - First round matchups visible
   - No completed matches or scores
   - Single elimination format (different bracket structure)

### Scenario 4: Finished Tournament
1. Click on "Finished Tournament"
2. Verify:
   - All matches have scores
   - Final winner visible (Dragon Squad)
   - Complete bracket history
   - All three bracket levels (UPPER, LOWER, GRAND)
   - Tournament marked as FINISHED
   - Final rankings displayed

---

## 🔄 Re-generating Test Data

To recreate the test data at any time:

```bash
npm run seed
```

This will:
1. Clear all existing test data
2. Create 16 new test users
3. Create 8 new test teams
4. Create 4 new tournaments with different states

---

## 📝 Test Data Prefixes

All test data uses specific prefixes for easy filtering:
- **Users**: `Test_` (e.g., `Test_ShadowNinja`)
- **Teams**: `Test - ` (e.g., `Test - Dragon Squad`)
- **Tournaments**: `Test - ` (e.g., `Test - Active Tournament`)

---

## 🎯 What You Can Test

### Bracket Rendering
- ✅ Multiple tournament states in one view
- ✅ Completed, ready, and pending match states
- ✅ Score display for finished matches
- ✅ Team progression through brackets
- ✅ Seeding visualization
- ✅ Double and single elimination formats

### Tournament Lifecycle
- ✅ Registration phase (open for signup)
- ✅ Active tournament (matches in progress)
- ✅ Recently started (all pending)
- ✅ Completed tournament (with results)

### UI/UX
- ✅ Tournament list with mixed states
- ✅ Tournament detail view for each state
- ✅ Bracket layout and spacing
- ✅ Responsiveness across device sizes
- ✅ Color/status indicators
- ✅ Team information display

### Data Consistency
- ✅ Bracket progression logic
- ✅ Match dependencies
- ✅ Score calculations
- ✅ Rankings display
- ✅ Team registration validation

---

## 🐛 Troubleshooting

### Only see 1 tournament
- Ensure you ran `npm run seed` (not the old seed script)
- Check database was cleared: `npm run seed:view` should show 4 tournaments
- Verify database connection is working

### Tournaments missing matches
- Some tournaments intentionally have 0 matches (Registration phase)
- Others have all matches pre-populated
- Check tournament state - may affect match visibility

### Scores not displaying
- Only COMPLETED matches show scores
- PENDING and READY matches have no scores
- Check match status field in database

---

## 📂 Files Generated

- `lib/server/seed.ts` - Main seed script with tournament generation
- `lib/server/seed-view.ts` - Utility to view test data
- `TOURNAMENTS_TEST_DATA.md` - This file
- `TEST_DATA_SETUP.md` - General setup guide
- `SEED_TESTING.md` - Detailed seed documentation

---

## 🚀 Next Steps

1. Run the seed: `npm run seed`
2. Start the app: `npm run dev`
3. View tournaments at `/tournaments`
4. Click on each tournament to test different states
5. Test bracket rendering for each state
6. Verify UI matches all scenarios
7. Test responsiveness on different screen sizes

Enjoy comprehensive tournament testing! 🎉
