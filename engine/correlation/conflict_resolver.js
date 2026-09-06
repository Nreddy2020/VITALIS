/**
 * VITALIS BETA-2.3: Multi-Source Evidence Conflict Resolver
 * Detects discrepancies between independent adapter observations (e.g., F5 vs IHS duration).
 * Preserves the conflict in evidence rather than silently overwriting facts.
 */

class ConflictResolver {
  static detectConflicts(envelopes = []) {
    const componentGroups = new Map();
    const conflicts = [];

    for (const env of envelopes) {
      const type = env.component.type;
      if (!componentGroups.has(type)) {
        componentGroups.set(type, []);
      }
      componentGroups.get(type).push(env);
    }

    for (const [type, group] of componentGroups.entries()) {
      if (group.length > 1) {
        // Compare reported durations
        const durations = group.map(e => e.measurements.observedDurationMs);
        const max = Math.max(...durations);
        const min = Math.min(...durations);

        if (max - min > 100 && max / Math.max(1, min) > 2.0) {
          conflicts.push({
            componentType: type,
            conflictType: "LATENCY_DISCREPANCY",
            sources: group.map(e => ({ source: e.provenance.sourceSystem, observedDurationMs: e.measurements.observedDurationMs })),
            varianceMs: max - min,
            explanation: `Cross-source variance detected: ${group[0].provenance.sourceSystem} reported ${group[0].measurements.observedDurationMs}ms while ${group[1].provenance.sourceSystem} reported ${group[1].measurements.observedDurationMs}ms`,
            resolutionStrategy: "PRESERVE_BOTH_SOURCES"
          });
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflictCount: conflicts.length,
      conflicts
    };
  }
}

module.exports = { ConflictResolver };
