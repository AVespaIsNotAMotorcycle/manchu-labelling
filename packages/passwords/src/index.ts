export const MIN_PASSWORD_LENGTH = 12;

/** Lists what a new password is missing, in words a user can read. Empty means it is acceptable. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    problems.push(`at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!/\p{Lu}/u.test(password)) problems.push("an upper-case letter");
  if (!/\p{Ll}/u.test(password)) problems.push("a lower-case letter");
  if (!/\p{N}/u.test(password)) problems.push("a number");
  if (!/[^\p{L}\p{N}]/u.test(password)) problems.push("a symbol");
  return problems;
}
