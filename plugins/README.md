# Plugins

A plugin is a folder with a `plugin.json` manifest. The registry validates every manifest
against a schema in `packages/plugins/src/manifest.ts`, resolves capability conflicts by
priority, and reports **why** each plugin was accepted, shadowed, disabled, or rejected.
Nothing is dropped silently.

## What a plugin is for here

A plugin's job in this product is to declare a **fairness-dimension taxonomy**: the set of
dimensions a claim of a given kind must cover before it can be attested, and the rationale for
each. Shipping a taxonomy as a plugin is what lets a new regulated domain be onboarded without
touching the core registry — which is the whole point of the footprint ladder.

Two ship in the box:

- `clinical-triage` — triage and prioritisation models that rank patients by clinical need.
- `employment-screening` — automated resume screening and candidate ranking.

## The manifest

```json
{
  "name": "clinical-triage",
  "version": "1.0.0",
  "description": "One sentence a human can act on.",
  "enabled": true,
  "priority": 70,
  "capabilities": ["dimension_taxonomy.clinical-triage"],
  "dimensions": [{ "key": "calibration", "required": true, "rationale": "Why this blocks attestation." }],
  "engines": { "@biasledgerharness/core": "0.1.0" }
}
```

- `priority` (0–100) decides a capability conflict. Highest wins; the loser is reported.
- `capabilities` are the names this plugin claims. Two plugins claiming one is a conflict.
- `dimensions` are the taxonomy. `required: false` marks a dimension as tracked-but-advisory.
- `engines` are exact version matches. A mismatch rejects the plugin and names both versions.

`index.js` in a plugin folder is behaviour that a future consumer may import. The registry
does not execute it, so a plugin cannot obtain a capability by running code at load time — it
declares capabilities and they are resolved by the core.

## Inspect the resolved state

```bash
biasledger plugins --json
biasledger mcp call list_dimension_sets '{"domain":"clinical-triage"}'
```

Both report rejected plugins and the reason. The second works over MCP as well, so an agent
can read the taxonomy without a shell.
