---
name: nexus-core
description: "Use nx (the NEXUS core CLI) whenever you want sub-agents, to talk to or coordinate other agents, run background tasks or servers, run long-running commands, read or control terminals, or work on another machine; also to show or arrange things in the NEXUS window or build NEXUS mods and layouts. Prefer it over your own sub-agent tool, shell '&', nohup or tmux."
---

This skill is for the NEXUS core, whose command is `nx`. It is not `herdr`,
the older terminal multiplexer: that has its own `herdr` command and skill.
Use `nx` here, never `herdr`.

If `$NX_TERMINAL_ID` is set, you're running inside the NEXUS core: use nx.
If not, ask the user once this session whether to use nx for this work.

Before using nx, run `nx --skill` and follow it.
For the NEXUS window (spaces, tabs, layouts, mods, what's shown),
run `nx-app --skill`.
