# Skills

A skill is a folder under `skills/` containing a `SKILL.md`: markdown instructions for an agent,
loaded from disk and validated on load. Authoring rules are in
[../skills/AGENTS.md](../skills/AGENTS.md).

## Reading the catalog

```bash
npm run cli -- skills
npm run cli -- skills --json
npm run cli -- mcp call list_skills '{}'
```

Invalid skills are **reported with a file and a line**, never silently skipped. A skill that fails
to load is a product bug the user needs to see.

## Shipped

| Skill                                                   | Use it when                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| [product-overview](../skills/product-overview/SKILL.md) | orienting yourself; need the map, not the detail               |
| [cite-evidence](../skills/cite-evidence/SKILL.md)       | attaching evidence to a claim and must not guess a byte offset |
| [run-an-audit](../skills/run-an-audit/SKILL.md)         | finding out which claims still hold                            |
| [attest-a-claim](../skills/attest-a-claim/SKILL.md)     | moving a claim, or withdrawing it                              |
| [diagnose](../skills/diagnose/SKILL.md)                 | something is broken and the subsystem is unknown               |

## Validation

| Rule                                               | Failure message                         |
| -------------------------------------------------- | --------------------------------------- |
| `name` is kebab-case and unique across the catalog | names the two folders that clash        |
| `description` is present                           | reported with the file                  |
| `metadata.version` is semver                       | reported with the file                  |
| YAML frontmatter parses                            | reported with the file **and the line** |

Frontmatter is parsed with a real YAML parser. Never a regex — a regex cannot tell you which line
was wrong.

## The version gate

```bash
npm run check:skill-version
```

If a `SKILL.md` body differs from `HEAD`, `metadata.version` must differ too. These files ship into
agent directories; a changed body with an unchanged version is an update that is never offered to
anyone, which is a silent failure with no symptom.

## Writing one

```markdown
---
name: example-skill
description: Use when the user asks to <specific thing>, because <reason>.
metadata:
  version: 1.0.0
---

# Example skill

## When to use this

<one line>

## Steps

1. `<command>` — <what it does>
2. `<command>` — <what it does>

## Verify

<how to confirm it worked>
```

The hard parts:

- **The description says when to use it, not what it is.** It is what an agent matches against.
- **The body is instructions, not prose about the project.** Second person, imperative, numbered.
- **Name the exact commands.** `npm run cli -- show <id>`, not "run the diagnostic".
- **Every command must be one you actually ran.** An aspirational command in a skill is a lie an
  agent will act on.
- **Bump `metadata.version` on every body change.**

## Provenance

Anything adapted from another project sets `metadata.upstream` and `metadata.upstreamUrl`, and gets
a row in [../skills/ATTRIBUTION.md](../skills/ATTRIBUTION.md) and in [../NOTICE](../NOTICE). The
loader rejects a skill that declares an upstream without attribution.
