/**
 * VITALIS: rule access
 *
 * There are no rules in this file any more, and that is the point.
 *
 * Compatibility knowledge lives in `rulepacks/*.json` as data, loaded by
 * `rulepack_loader.js`. Supporting a new framework — Spring Boot, Django,
 * WebSphere, .NET — is a JSON file, not a code change, and nothing in the
 * engine learns what kind of application it is looking at.
 *
 * When these rules were hardcoded here, the engine contained a table of Expo
 * SDK versions. It worked, and it made VITALIS an Expo tool by construction.
 * `ecosystems/ECOSYSTEM_CONTRACT.md` records why that matters.
 *
 * This module remains as the stable entry point callers use, so `loadRules()`
 * keeps working for existing code.
 */

const { loadRulePacks } = require('./rulepack_loader');

/**
 * Load and validate rules.
 *
 * @param rules   optional explicit array — used by tests to inject a rule set.
 *                Validated exactly as packs are, so an unsourced test rule is
 *                refused too.
 */
function loadRules(rules, options) {
  if (Array.isArray(rules)) {
    const { rules: validated } = loadRulePacks({
      dir: null,
      packs: [{ id: 'inline', displayName: 'inline rules', rules, origin: 'inline' }]
    });
    return validated;
  }
  return loadRulePacks(options).rules;
}

/** The fact declarations every loaded pack asks for. */
function loadFactDeclarations(options) {
  return loadRulePacks(options).facts;
}

/** Which packs are installed, for reporting. */
function loadedPacks(options) {
  return loadRulePacks(options).packs.map(p => ({
    id: p.id, displayName: p.displayName, origin: p.origin, ruleCount: p.rules.length
  }));
}

module.exports = { loadRules, loadFactDeclarations, loadedPacks, loadRulePacks };
