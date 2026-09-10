/**
 * VITALIS STAGE 3: Change Correlator (honest temporal correlation)
 *
 * Replaces the previous engine/change_intelligence.js, which was a demo module:
 * it held two hardcoded change events, always returned `hasChangeCorrelation: true`,
 * and fell back to `this.changeEvents[0]` so it could never fail to "find" a cause.
 * Nothing in the codebase referenced it.
 *
 * This module correlates REAL change events (from a real git history, CI/CD
 * webhook, or change-management system) against the REAL observed time of a
 * request. Two rules govern everything here:
 *
 *   1. If no change falls inside the window, it says so. No fallback "closest"
 *      change, ever.
 *   2. A time correlation is labelled CORRELATED, never OBSERVED and never
 *      "root cause". A deploy happening before a slowdown is not proof it caused
 *      it, and VITALIS must not imply otherwise.
 */

const DEFAULT_WINDOW_MINUTES = 120;

class ChangeCorrelator {
  constructor({ windowMinutes = DEFAULT_WINDOW_MINUTES } = {}) {
    this.changeEvents = [];
    this.windowMinutes = windowMinutes;
  }

  /**
   * Record real change events. Each must carry a real timestamp (ms epoch or
   * ISO string); an event without one cannot be temporally correlated and is
   * rejected rather than silently given "now".
   */
  ingestChanges(events = []) {
    let accepted = 0;
    const rejected = [];
    for (const e of events) {
      const ts = this._toEpochMs(e.timestamp);
      if (ts === undefined) {
        rejected.push({ id: e.id || '(no id)', reason: 'missing or unparseable timestamp' });
        continue;
      }
      this.changeEvents.push({
        id: e.id || `CHG-${ts}`,
        timestamp: ts,
        type: e.type || 'UNKNOWN',
        service: e.service || null,
        version: e.version || null,
        commit: e.commit || null,
        author: e.author || null,
        description: e.description || '',
        filesChanged: Array.isArray(e.filesChanged) ? e.filesChanged : []
      });
      accepted++;
    }
    this.changeEvents.sort((a, b) => b.timestamp - a.timestamp);
    return { accepted, rejected };
  }

  /** Serialize for disk persistence — a restart must not silently empty the change history. */
  toJSON() {
    return { windowMinutes: this.windowMinutes, changeEvents: this.changeEvents };
  }

  /** Restore from disk. Events already carry epoch-ms timestamps, so no re-parsing is needed. */
  static fromJSON(state = {}) {
    const c = new ChangeCorrelator({ windowMinutes: state.windowMinutes || DEFAULT_WINDOW_MINUTES });
    if (Array.isArray(state.changeEvents)) {
      c.changeEvents = state.changeEvents.filter(e => e && typeof e.timestamp === 'number');
      c.changeEvents.sort((a, b) => b.timestamp - a.timestamp);
    }
    return c;
  }

  _toEpochMs(ts) {
    if (typeof ts === 'number' && isFinite(ts)) return ts;
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      if (!isNaN(parsed)) return parsed;
    }
    return undefined;
  }

  /**
   * Find changes that landed within the window BEFORE a request was observed.
   *
   * @param observedAtMs  when the request actually happened (real span time)
   * @param services      service names the request actually traversed
   * @returns correlations, most recent first — empty when nothing qualifies.
   */
  correlate(observedAtMs, services = []) {
    if (typeof observedAtMs !== 'number' || !isFinite(observedAtMs)) {
      return {
        hasChangeCorrelation: false,
        reason: 'Request has no observed timestamp — temporal correlation is not possible',
        correlations: []
      };
    }

    const windowMs = this.windowMinutes * 60000;
    const lowerServices = services.map(s => String(s).toLowerCase());

    const correlations = this.changeEvents
      // Only changes BEFORE the request; a deploy after the fact cannot be related to it.
      .filter(c => c.timestamp <= observedAtMs && (observedAtMs - c.timestamp) <= windowMs)
      .map(c => {
        const minutesBefore = Math.round((observedAtMs - c.timestamp) / 60000);
        // A change touching a service the request actually traversed is a stronger
        // signal than one that merely happened nearby in time. Both stay CORRELATED.
        const serviceMatch = !!(c.service && lowerServices.some(s =>
          s.includes(String(c.service).toLowerCase()) || String(c.service).toLowerCase().includes(s)));
        return {
          changeId: c.id,
          type: c.type,
          service: c.service,
          version: c.version,
          commit: c.commit,
          author: c.author,
          description: c.description,
          filesChanged: c.filesChanged,
          minutesBeforeRequest: minutesBefore,
          serviceMatch,
          provenance: 'CORRELATED',
          statement: `${c.type}${c.version ? ' ' + c.version : ''}${c.service ? ' on ' + c.service : ''} landed ` +
                     `${minutesBefore} minute(s) before this request` +
                     `${serviceMatch ? ', on a service this request actually traversed' : ''} — CORRELATED ` +
                     `(temporal proximity${serviceMatch ? ' and service overlap' : ''} only; not proof of causation)`
        };
      })
      // Service-matching changes first, then most recent.
      .sort((a, b) => (b.serviceMatch - a.serviceMatch) || (a.minutesBeforeRequest - b.minutesBeforeRequest));

    return {
      hasChangeCorrelation: correlations.length > 0,
      windowMinutes: this.windowMinutes,
      changesKnown: this.changeEvents.length,
      reason: correlations.length === 0
        ? (this.changeEvents.length === 0
            ? 'No change events have been ingested — nothing to correlate against'
            : `No change landed within ${this.windowMinutes} minutes before this request`)
        : undefined,
      correlations
    };
  }
}

module.exports = { ChangeCorrelator, DEFAULT_WINDOW_MINUTES };
