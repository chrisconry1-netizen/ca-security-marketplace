/** Same weights as app.match_score. */
export interface ScoreInput {
  categoryMatch: boolean;
  distanceMiles: number;
  radiusMiles: number;
  payMeetsMinimum: boolean;
  yearsExperience: number | null;
  minYears: number | null;
  urgency: string;
  vehicleRequired: boolean;
  hasTransportation: boolean | null;
}

export function deterministicScore(input: ScoreInput): number {
  let score = 0;
  if (input.categoryMatch) score += 30;
  const radius = Math.max(input.radiusMiles, 1);
  if (Number.isFinite(input.distanceMiles)) {
    score += Math.max(0, Math.round(25 * (1 - input.distanceMiles / radius)));
  }
  if (input.payMeetsMinimum) score += 15;
  if (input.yearsExperience != null && input.minYears != null) {
    score += Math.min(10, Math.max(0, input.yearsExperience - input.minYears));
  } else if (input.yearsExperience != null) {
    score += Math.min(10, input.yearsExperience);
  }
  if (input.urgency === "urgent") score += 10;
  else if (input.urgency === "priority") score += 5;
  if (input.vehicleRequired && input.hasTransportation) score += 10;
  return score;
}

export function compareDeterministic(
  a: { id: string; score: number; distanceMiles: number },
  b: { id: string; score: number; distanceMiles: number },
): number {
  return b.score - a.score || a.distanceMiles - b.distanceMiles || a.id.localeCompare(b.id);
}
