import type { MatchMapInput } from "@/lib/shared/match-maps";

/**
 * Liste de maps qui **dérive** le score voulu (`docs/features/MAP_SCORES.md`),
 * dans l'orientation du plateau : `team1Wins` maps gagnées par l'équipe 1,
 * `team2Wins` par l'équipe 2, `draws` maps nulles. Les nulles d'abord, puis les
 * victoires en alternance, la dernière map revenant au camp qui mène : la
 * rencontre ne se décide qu'à la fin, comme dans une vraie série. Codes uniques
 * au motif permissif (`MAP001`…).
 */
export function mapsFor(team1Wins: number, team2Wins: number, draws = 0): MatchMapInput[] {
  const maps: MatchMapInput[] = [];
  const push = (team1Score: number, team2Score: number) =>
    maps.push({ replayCode: `MAP${String(maps.length + 1).padStart(3, "0")}`, team1Score, team2Score });
  for (let i = 0; i < draws; i += 1) push(1, 1);

  const leader: 1 | 2 = team1Wins >= team2Wins ? 1 : 2;
  let a = team1Wins - (leader === 1 && team1Wins > 0 ? 1 : 0);
  let b = team2Wins - (leader === 2 && team2Wins > 0 ? 1 : 0);
  while (a > 0 || b > 0) {
    if (a > 0) {
      push(2, 0);
      a -= 1;
    }
    if (b > 0) {
      push(0, 2);
      b -= 1;
    }
  }
  if (team1Wins + team2Wins > 0) {
    if (leader === 1) push(2, 0);
    else push(0, 2);
  }
  return maps;
}
