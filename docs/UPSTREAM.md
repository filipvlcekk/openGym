# Upstream Tracking

This fork tracks `filipvlcekk/openGym` as the target repository.

The active upstream source is:

```text
https://gitea.com/DuarteSantos/openGym.git
```

As of 2026-08-25, the older GitHub upstream URL:

```text
https://github.com/DuarteSantos8/openGym.git
```

returns `Repository not found` through `git fetch`. Treat the Gitea repository as the source
for future upstream syncs unless the GitHub repository is restored and intentionally selected
again.

Recommended selective MCP sync command:

```bash
git fetch https://gitea.com/DuarteSantos/openGym.git main
git checkout FETCH_HEAD -- mcp
```

Do not merge the whole upstream tree unless the fork is ready to absorb unrelated frontend,
API, mobile, and documentation changes.
