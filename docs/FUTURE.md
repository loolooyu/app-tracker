# Deliberately out of scope for v1

These need design work beyond "add a feature", usually because they change the trust boundary.

- **Cross-device sync / cloud hosting.** Needs authenticated, encrypted storage designed for resume data. Publishing the frontend or exposing this API is not a substitute.
- **Email integration** (detecting OA/interview invitations). Needs mailbox OAuth and careful scoping.
- **AI-assisted extraction or summaries.** If added, keep the raw JD intact, treat page text as untrusted input (prompt-injection resistant), and never send resumes to third-party services without explicit opt-in.
- **Automatic applications, resume tailoring, recruiter outreach.** Not planned.
- **Multi-user collaboration.**
- **Merge import** of backups (v1 supports only restore-into-empty and replace).
- **More adapters** once real signed-in markup is verified (NUworks, Handshake, the LinkedIn signed-in view), plus Lever and Ashby.
- **DOCX preview** in the dashboard (v1 downloads DOCX).
- **"Posting expired" flag** with an optional, user-triggered liveness check. v1 never labels a posting expired by itself; use a tag.
- **Firefox/Safari extensions.**
