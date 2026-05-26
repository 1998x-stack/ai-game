---
name: skill-creator
description: Template and guide for creating effective agent skills that enhance game generation
triggers: create skill, new skill, write skill, skill template
---

# Skill Creator

Guide for creating effective agent skills that enhance game generation. Use this template when creating a new skill.

## Skill Structure

```markdown
# {Skill Name}

## When to Use
{Describe what game features or user requests trigger this skill}

## Core Patterns
{Reusable code patterns specific to this domain}

## Gotchas
{Common mistakes to avoid — wrong/correct code pairs}

## Integration with Utils
{How to use existing utils.js utilities for this domain}

## Examples
{Short, complete examples agents can reference}
```

## Rules for Writing Skills

1. **Be specific** — don't write "use good colors." Write "use HSL with saturation 60-80% for game objects, 20-40% for backgrounds."
2. **Show code** — every pattern should have a concrete code example
3. **Reference utils** — mention which utils.js classes/functions solve problems in this domain
4. **Include gotchas** — every skill should have at least 2 domain-specific gotchas
5. **Keep it concise** — skills are supplementary, not replacement docs

## Where Skills Are Stored

- Created skills go in `skills/examples/` directory
- Skills are copied to every new session workspace
- Agents can read any skill file to apply its patterns
- Agents can create new skills using the `write_file` tool

## Example: Creating a "Particle Effects" Skill

A particle effects skill would cover:
- When to use particles (explosions, trails, weather, magic)
- Core patterns (Particle class, emitter, update/render loop)
- Gotchas (performance with many particles, object pooling)
- Integration (use `ObjectPool` from utils.js, `randomInt` for variance)
- Examples (explosion effect, snow effect, trail effect)
