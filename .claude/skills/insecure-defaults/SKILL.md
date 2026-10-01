---
name: insecure-defaults
description: Audit code or config for insecure defaults (fallback secrets, default credentials, fail-open auth switches, weak crypto, permissive access, debug leakage). Use before the Gallery goes public, when touching auth, sessions, cookies, env/config loading or deploy scripts, and when reviewing a security-sensitive diff.
---

# Insecure defaults audit

An insecure default is a value the code falls back to when configuration is missing, and that
fallback weakens security. The question for every finding: **what happens when this is not
configured?** If the unconfigured state is the insecure state, report it.

Market Jury hot spots: `server/auth.js` (login, lockout, session cookie), `server/config.js` and any
`process.env` read, the Gallery switch (public reads must fail closed), `/api` write routes (each
must check the Trade Master session), deploy scripts and the systemd unit.

## How to audit

1. Read each reference below; each says what to report, what to skip, and shows vulnerable and safe
   patterns:
   - `references/fallback-secrets.md`: a secret with a hard-coded fallback (`process.env.X || 'dev-secret'`)
   - `references/default-credentials.md`: shipped usernames/passwords, seeded admin accounts
   - `references/fail-open-security.md`: a missing flag that switches a control off
   - `references/weak-crypto.md`: weak hashes, short keys, predictable randomness
   - `references/permissive-access.md`: CORS `*`, open routes, world-readable files
   - `references/debug-features.md`: stack traces, debug endpoints or verbose errors left on
2. Sweep the target for each category (`rg` for `process.env`, `||`, `??`, `cors`, `debug`,
   `Math.random`, `md5`, `sha1`, cookie options, route tables).
3. For each candidate, trace it to the security decision it reaches. Drop it if the unconfigured
   path is the safe one, if the value never reaches an enforcement point, or if it is test-only.
4. Report what survives: file:line, the default, what an attacker gets, and the fix (usually: fail
   closed and refuse to start without the value).

Adapted from Trail of Bits' `insecure-defaults` plugin (https://github.com/trailofbits/skills,
plugins/insecure-defaults, CC BY-SA 4.0, see LICENSE). The reference files are copied unchanged;
this SKILL.md replaces the plugin's workflow command so the audit runs as a plain skill.
