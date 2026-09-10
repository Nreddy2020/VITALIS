/**
 * VITALIS: version comparison for compatibility drift
 *
 * Deliberately NOT a general semver range engine.
 *
 * A general range evaluator has a large surface, and the failure mode that
 * matters here is silent: a range form the evaluator half-understands returns
 * "satisfied" and a real incompatibility is reported as healthy. That is the
 * exact class of failure the charter forbids — a green tick where the truth is
 * unknown.
 *
 * So this file implements a CLOSED VOCABULARY of comparison operators. Rules
 * may only use operators listed in OPERATORS. Anything else returns UNKNOWN
 * with a reason. It never guesses, and it never treats "I could not evaluate
 * this" as "this is fine".
 */

const OPERATORS = ['exact', 'majorEquals', 'minorMatch', 'gte', 'gt', 'lte', 'lt', 'boolEquals'];

/**
 * Parse an EXACT version. Returns null for anything carrying range syntax
 * (^, ~, ||, x, *, spaces) — a range is not a version, and conflating the two
 * is how a checker ends up asserting things it cannot know.
 */
function parseVersion(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  // An ARBITRARY number of numeric segments, not three.
  //
  // Semver's major.minor.patch is a JavaScript convention, not a universal one.
  // Java and IBM ship 11.5.4.0, .NET ships 4-part assembly versions, and a
  // three-segment parser silently refuses to compare any of them. That is not a
  // safe failure: it makes every Java rule permanently UNKNOWN, so the engine
  // looks like it is working while checking nothing. Caught by gate G3.
  const m = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw);
  if (!m) return null;
  const segments = m[1].split('.').map(Number);
  return {
    segments,
    major: segments[0],
    minor: segments.length > 1 ? segments[1] : 0,
    patch: segments.length > 2 ? segments[2] : 0,
    prerelease: m[2] || null,
    raw
  };
}

/**
 * Strip a leading range operator from a DECLARED dependency range so it can be
 * displayed and, where unavoidable, compared.
 *
 * The `exact` flag in the return value is the important part: it says whether
 * the caller is looking at a fact or at an intention. A declared "^0.86.0" does
 * NOT mean 0.86.0 is installed. Callers must carry that distinction into
 * provenance rather than dropping it.
 */
function coerceDeclaredRange(range) {
  if (typeof range !== 'string') return { version: null, exact: false, reason: 'not a string' };
  const raw = range.trim();
  if (parseVersion(raw)) return { version: parseVersion(raw), exact: true, reason: null };

  // Single-bound caret/tilde/comparator ranges: take the floor, flag inexact.
  const m = /^[\^~]?\s*v?(\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)$/.exec(raw)
    || /^>=\s*v?(\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?)$/.exec(raw);
  if (m) {
    const v = parseVersion(m[1]);
    if (v) return { version: v, exact: false, reason: 'floor of a declared range; actual installed version unknown' };
  }
  return { version: null, exact: false, reason: `unsupported range syntax: ${raw}` };
}

/** Standard precedence compare. Returns -1, 0 or 1. A release outranks its own prerelease. */
function compare(a, b) {
  // Segment-wise over however many segments either side has, missing segments
  // treated as 0 — so 11.5.4 and 11.5.4.0 compare equal, and 11.5.4.0 < 11.5.8.0.
  const len = Math.max(a.segments.length, b.segments.length);
  for (let i = 0; i < len; i++) {
    const x = a.segments[i] === undefined ? 0 : a.segments[i];
    const y = b.segments[i] === undefined ? 0 : b.segments[i];
    if (x !== y) return x < y ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/**
 * Evaluate one constraint against one observed value.
 *
 * Returns { result, reason } where result is SATISFIED | VIOLATED | UNKNOWN.
 * UNKNOWN is a real answer, not an error case, and callers must not fold it
 * into either of the other two.
 */
function evaluate(constraint, actual) {
  if (!constraint || typeof constraint !== 'object') {
    return { result: 'UNKNOWN', reason: 'no constraint supplied' };
  }
  const { op, value } = constraint;
  if (!OPERATORS.includes(op)) {
    // Fail closed. An operator we do not implement is not a passing operator.
    return { result: 'UNKNOWN', reason: `unsupported operator '${op}' — not in the closed vocabulary [${OPERATORS.join(', ')}]` };
  }

  if (op === 'boolEquals') {
    if (typeof actual !== 'boolean') {
      return { result: 'UNKNOWN', reason: `expected a boolean, observed ${actual === undefined ? 'nothing' : typeof actual}` };
    }
    return actual === value
      ? { result: 'SATISFIED', reason: `is ${value}` }
      : { result: 'VIOLATED', reason: `is ${actual}, expected ${value}` };
  }

  const a = parseVersion(actual);
  if (!a) {
    return { result: 'UNKNOWN', reason: `observed value ${JSON.stringify(actual)} is not an exact version` };
  }

  if (op === 'minorMatch') {
    const want = parseVersion(`${value}.0`) || parseVersion(value);
    if (!want) return { result: 'UNKNOWN', reason: `rule value ${JSON.stringify(value)} is not a version` };
    // Label from the parsed major.minor, so a rule value written as "0.21.0"
    // reports "the 0.21.x line" rather than the nonsensical "0.21.0.x".
    const line = `${want.major}.${want.minor}.x`;
    return (a.major === want.major && a.minor === want.minor)
      ? { result: 'SATISFIED', reason: `${a.raw} is in the ${line} line` }
      : { result: 'VIOLATED', reason: `${a.raw} is not in the ${line} line` };
  }

  if (op === 'majorEquals') {
    const want = Number(value);
    if (!Number.isInteger(want)) return { result: 'UNKNOWN', reason: `rule value ${JSON.stringify(value)} is not an integer major` };
    return a.major === want
      ? { result: 'SATISFIED', reason: `major is ${want}` }
      : { result: 'VIOLATED', reason: `major is ${a.major}, expected ${want}` };
  }

  const want = parseVersion(value);
  if (!want) return { result: 'UNKNOWN', reason: `rule value ${JSON.stringify(value)} is not an exact version` };
  const c = compare(a, want);
  const table = { exact: c === 0, gte: c >= 0, gt: c > 0, lte: c <= 0, lt: c < 0 };
  if (!(op in table)) {
    // Defensive: an operator listed in OPERATORS but not implemented here must
    // fail closed rather than fall through to a falsy lookup and read as a
    // violation. Getting this wrong once already produced a false VIOLATION.
    return { result: 'UNKNOWN', reason: `operator '${op}' is declared but not implemented` };
  }
  const ok = table[op];
  return ok
    ? { result: 'SATISFIED', reason: `${a.raw} ${op} ${want.raw}` }
    : { result: 'VIOLATED', reason: `${a.raw} is not ${op} ${want.raw}` };
}

module.exports = { OPERATORS, parseVersion, coerceDeclaredRange, compare, evaluate };
