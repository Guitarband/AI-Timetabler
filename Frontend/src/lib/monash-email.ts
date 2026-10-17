const MONASH_EMAIL_DOMAINS = new Set(["monash.edu", "student.monash.edu"]);

export function isMonashEmail(email: string): boolean {
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");

  if (at < 1 || at !== trimmed.lastIndexOf("@")) {
    return false;
  }

  const localPart = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();

  return !/\s/.test(localPart) && MONASH_EMAIL_DOMAINS.has(domain);
}
