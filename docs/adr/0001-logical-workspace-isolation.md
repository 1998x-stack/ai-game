# ADR 0001: Logical Path Validation over OS-Level Workspace Isolation

**Status**: Accepted
**Date**: 2026-05-26

## Context

The design blueprint specifies workspace isolation at two levels:
1. **Physical**: OS-level permission control (container mount, chroot, filesystem permissions)
2. **Logical**: `agent.md` constraints + path validation preventing traversal outside workspace

For the initial milestone (v1), we must choose how much isolation to implement now versus deferring.

## Decision

We implement **logical isolation only** for v1: string-based path validation that rejects `..` sequences and checks that resolved paths stay within the workspace root. OS-level containerization is deferred to v2.

## Alternatives Considered

### A. Full containerization from day one
- **Pros**: Maximum security, matches blueprint specification exactly
- **Cons**: 10-20x implementation complexity (Docker/chroot setup, volume mounting, per-session container lifecycle), significantly slows initial delivery

### B. No isolation at all
- **Pros**: Simplest implementation
- **Cons**: Agent could read/write arbitrary files on the host, trivially exploitable

### C. Logical isolation only (CHOSEN)
- **Pros**: Reasonable security for single-tenant development use, minimal complexity, fast to implement
- **Cons**: A sophisticated prompt injection could potentially bypass string-based checks; no defense against symlink attacks

## Consequences

- The `validatePath()` function in `lib/agent/tools.ts` is the sole security boundary for file access
- `agent.md` constraints serve as a second layer but are advisory (the LLM can ignore them)
- Multi-tenant production deployment will require containerization before going live
- Path validation is adequate for a local development tool where the user trusts their own agent
