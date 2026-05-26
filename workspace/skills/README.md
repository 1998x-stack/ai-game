# Agent Skills

Skills are reusable instruction documents that enhance game generation. Each skill is a markdown file containing domain-specific knowledge, patterns, and gotchas that agents can reference.

## How Skills Work

1. Skills live in `skills/` — copied to every session workspace
2. Agents read relevant skills before generating games
3. Skills can be created by users or by agents themselves
4. Skills compound: each new skill makes future game generation better

## Creating a Skill

Use the `skill-creator.md` template as a guide. A good skill has:

- **Clear title** — what domain does this skill cover?
- **When to use** — what game features trigger this skill?
- **Patterns** — reusable code snippets
- **Gotchas** — common mistakes specific to this domain
- **Examples** — reference implementations

## Skill Files

| File | Purpose |
|------|---------|
| `README.md` | This file — skill system overview |
| `skill-creator.md` | Template and guide for creating new skills |
| `examples/` | Example skills for reference |
