// Password rules. Customers: 10+ characters. Administrators: 14+ characters, three character classes, not built from
// the e-mail, not a well-known password. The check never logs or returns the password.
const COMMON = ['password', 'passw0rd', '123456', 'qwerty', 'admin', 'letmein', 'welcome', 'iloveyou', 'forma', 'cmg', '12345678', '00000000', 'abc123'];
export function passwordProblems(pw: string, o: { admin?: boolean; email?: string } = {}): string[] {
  const p: string[] = [], min = o.admin ? 14 : 10;
  if (typeof pw !== 'string' || pw.length < min) p.push(`at least ${min} characters`);
  if (pw && pw.length > 200) p.push('at most 200 characters');
  if (o.admin) {
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw || '')).length;
    if (classes < 3) p.push('three of: lower case, upper case, digit, symbol');
  }
  const low = String(pw || '').toLowerCase();
  if (COMMON.some((c) => low === c || (low.includes(c) && low.replace(c, '').replace(/[\d\W_]/g, '').length < 4))) p.push('not a common password');
  const local = (o.email || '').split('@')[0].toLowerCase();
  if (local.length >= 3 && low.includes(local)) p.push('must not contain the e-mail name');
  return p;
}
