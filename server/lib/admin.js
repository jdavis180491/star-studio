// The app's admin(s): grown-up accounts whose email is listed in the ADMIN_EMAILS secret
// (comma-separated). Admins see the Daily briefs tab and can set keywords for everyone.
export function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const isAdminEmail = (email) => Boolean(email) && adminEmails().includes(String(email).toLowerCase());
