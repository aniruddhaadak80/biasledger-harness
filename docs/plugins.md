# Plugins

A plugin declares a **fairness-dimension taxonomy**: the dimensions a claim of a given kind must
cover before it can be attested, and the rationale for each. That is the plugin surface's job in
this product.

## Why a taxonomy is a plugin

A fairness claim is only attestable if every _required_ dimension is backed by a citation that
resolves. That list is a policy decision, and policy differs by domain: a triage model is judged on
calibration, missingness and oversight; a resume screener is judged on adverse impact, feature
provenance and the appeal route.

Shipping those lists in `packages/core` would mean a core release for every new regulated domain.
Shipping them as plugins means onboarding a domain is a manifest and a PR.

This is step 4 on the footprint ladder, and the reason it exists.

## Reading the taxonomies

```bash
npm run cli -- mcp call list_dimension_sets '{}'
npm run cli -- mcp call list_dimension_sets '{"domain":"clinical-triage"}'
```

Both work over MCP too, so an agent can read a taxonomy without a shell.

## Shipped

| Plugin                 | Domain                                                               | Required dimensions |
| ---------------------- | -------------------------------------------------------------------- | ------------------- |
| `clinical-triage`      | triage and prioritisation models that rank patients by clinical need | 8                   |
| `employment-screening` | automated resume screening and candidate ranking                     | 7                   |

## Writing one

```
plugins/my-domain/
  plugin.json     the manifest — the contract
  index.js        optional behaviour, imported by a future consumer
```

```json
{
  "name": "credit-pricing",
  "version": "1.0.0",
  "description": "The fairness-dimension taxonomy for automated credit pricing models.",
  "enabled": true,
  "priority": 60,
  "capabilities": ["dimension_taxonomy.credit-pricing"],
  "dimensions": [
    {
      "key": "adverse-impact",
      "required": true,
      "rationale": "Why this dimension blocks attestation. Be specific: this text is read by whoever is deciding whether a gap matters."
    },
    {
      "key": "explainability",
      "required": false,
      "rationale": "Tracked, but does not block attestation on its own."
    }
  ],
  "engines": {
    "@biasledgerharness/core": "0.1.0"
  }
}
```

### Manifest fields

| Field                    | Rule                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| `name`                   | kebab-case, unique across `plugins/`                                             |
| `version`                | exact semver                                                                     |
| `description`            | at least 10 characters, actionable                                               |
| `dimensions[].key`       | kebab-case; becomes the `key` in a claim's `dimensions` array                    |
| `dimensions[].required`  | `true` blocks attestation, `false` is advisory                                   |
| `dimensions[].rationale` | at least 10 characters — this is read by a human deciding whether a gap matters  |
| `capabilities`           | names this plugin claims; a clash is resolved by `priority`                      |
| `engines`                | exact version matches; a mismatch **rejects** the plugin and names both versions |
| `enabled`                | `false` loads it but keeps it inactive                                           |

### Resolution

Plugins resolve by priority, highest first; ties break by name so the order is deterministic. A
plugin that loses a capability conflict is **reported as shadowed**, never dropped silently.

```bash
npm run cli -- plugins
npm run cli -- plugins --json
```

## What a plugin cannot do

`index.js` is behaviour for a future consumer. **The registry does not execute it.** A plugin
declares capabilities and they are resolved by the core; it cannot obtain a capability by running
code at load time, and it has no privileged registration path.

If a plugin needs real capability, it is a core tool or an engine operation — both of which are
reviewed changes to code that decides whether a claim is supported.

## Validation

Manifests are validated against a zod schema in `packages/plugins/src/manifest.ts`. A rejected
plugin reports the failing JSON pointer and why:

```
rejected plugins/broken/plugin.json: dimensions.0.key — must match /^[a-z0-9][a-z0-9-]*$/
```
