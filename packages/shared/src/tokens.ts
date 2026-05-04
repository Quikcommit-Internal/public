/** Conservative token estimate: 2.5 chars/token for code/diffs */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.5);
}
