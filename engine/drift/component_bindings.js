/**
 * VITALIS: component bindings
 *
 * The join between a service observed in a request and a place its versions can
 * actually be read from.
 *
 * There is no way to infer this. A span says `service.name = "payments-api"`;
 * nothing in that string tells you which repository, image or manifest produced
 * it. Guessing the mapping — by fuzzy-matching a service name against a folder
 * name, say — would be the single most damaging thing this feature could do,
 * because it would attribute one component's compatibility findings to a
 * completely different component and present the result as evidence.
 *
 * So the binding is DECLARED, by a person, in a file. Anything not declared is
 * UNKNOWN, is counted as UNKNOWN in every report, and never quietly resolves to
 * "probably fine".
 *
 * File format (bindings.json):
 *
 *   {
 *     "bindings": [
 *       { "service": "payments-api",  "manifestPath": "E:\\repos\\payments",
 *         "declaredBy": "nagarjuna", "note": "monorepo backend" }
 *     ]
 *   }
 */

const fs = require('fs');

/**
 * Load and validate bindings. Throws on anything ambiguous.
 *
 * Duplicate service names are refused rather than last-one-wins: a registry
 * that silently picks one of two conflicting bindings produces findings that
 * cannot be reproduced or explained, which is worse than having no registry.
 */
function loadBindings(input) {
  const raw = typeof input === 'string'
    ? JSON.parse(fs.readFileSync(input, 'utf8'))
    : input;

  const list = (raw && raw.bindings) || [];
  if (!Array.isArray(list)) throw new Error('bindings rejected: "bindings" must be an array');

  const byService = new Map();
  for (const b of list) {
    if (!b || typeof b.service !== 'string' || !b.service.trim()) {
      throw new Error('binding rejected: every binding needs a non-empty "service"');
    }
    if (typeof b.manifestPath !== 'string' || !b.manifestPath.trim()) {
      throw new Error(`binding for '${b.service}' rejected: "manifestPath" is required`);
    }
    if (typeof b.declaredBy !== 'string' || !b.declaredBy.trim()) {
      // Attribution matters for the same reason rule sources do: a binding
      // nobody owns is a claim nobody can check.
      throw new Error(`binding for '${b.service}' rejected: "declaredBy" is required — an unattributable binding is not admissible`);
    }
    if (byService.has(b.service)) {
      throw new Error(
        `binding for '${b.service}' rejected: already bound to ${byService.get(b.service).manifestPath}. ` +
        `Two bindings for one service is ambiguous; resolve it rather than letting one silently win.`
      );
    }
    byService.set(b.service, {
      service: b.service,
      manifestPath: b.manifestPath,
      declaredBy: b.declaredBy,
      note: b.note || null
    });
  }
  return byService;
}

/** Look up a service. Returns null when unbound — callers must treat that as UNKNOWN. */
function bindingFor(byService, serviceName) {
  return byService.get(serviceName) || null;
}

module.exports = { loadBindings, bindingFor };
