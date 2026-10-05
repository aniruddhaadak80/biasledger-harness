/**
 * The clinical-triage dimension taxonomy.
 *
 * The manifest is the contract; this file is the behaviour. Registration of tools happens
 * through the same core registry every other surface uses — a plugin gets no privileged path.
 *
 * The export below is what `biasledger list-dimension-sets` and the MCP tool of the same name
 * read, so the taxonomy is reachable from the CLI, the web app and any MCP client without this
 * file being able to do anything the core cannot.
 */

export const taxonomy = {
  id: 'clinical-triage',
  title: 'Clinical triage and prioritisation',
  /** Dimensions that must all be backed before a claim of this kind can be attested. */
  required: [
    'calibration',
    'evaluation-cohort',
    'missingness',
    'subgroup-coverage',
    'confidence-intervals',
    'human-oversight',
    'protected-attributes',
    'consent',
  ],
  /** Tracked, but not on its own a blocker. */
  advisory: ['retention'],
}

export function describe() {
  return { taxonomy, dimensions: taxonomy.required.length + taxonomy.advisory.length }
}
