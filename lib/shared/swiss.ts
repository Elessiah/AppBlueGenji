export function computeRecommendedRounds(participantCount: number): number {
  if (participantCount <= 1) return 0;
  return Math.ceil(Math.log2(participantCount)) + 1;
}

export function formatPoints(points: number): string {
  return points % 1 === 0 ? String(points) : points.toFixed(1);
}
