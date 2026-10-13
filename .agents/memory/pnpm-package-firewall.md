---
name: Replit package firewall
description: Dependency-install behavior encountered while setting up this imported pnpm workspace.
---

When a frozen pnpm install fails with an HTTP 403 for a transitive archive, inspect the lockfile for the direct dependency that selected it and update that dependency to a compatible current release. Re-run the root install after the update; do not bypass the Replit package firewall.

**Why:** The imported lockfile referenced a transitive package archive blocked by Replit's package firewall; updating its compatible parent dependency restored installation.

**How to apply:** Use this only for package-firewall 403 failures. Prefer an in-range parent update before considering any library replacement.
