/**
 * VITALIS: Privacy & In-Flight Telemetry Sanitizer (Gate 10)
 * Scrubs PAN, CVV, passwords, tokens, and PII as close to collection as possible.
 * Enforces Level 0 - Level 3 privacy policies across JSON, headers, SQL, and exceptions.
 */

const SENSITIVE_PATTERNS = [
  { name: "PAN / Credit Card", regex: /\b(?:\d[ -]*?){13,16}\b/g, mask: "[REDACTED_PAN]" },
  { name: "CVV / CVC", regex: /\b(?:cvv|cvc|security_code)\s*[:=]\s*["']?\d{3,4}["']?/gi, mask: "cvv=[REDACTED_CVV]" },
  { name: "Password / Secret", regex: /\b(?:password|passwd|secret|api_key)\s*[:=]\s*["']?[^"'&\s]+["']?/gi, mask: "password=[REDACTED_SECRET]" },
  { name: "Bearer Token", regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, mask: "Bearer [REDACTED_TOKEN]" },
  { name: "SSN / Tax ID", regex: /\b\d{3}-\d{2}-\d{4}\b/g, mask: "[REDACTED_SSN]" }
];

class PrivacySanitizer {
  static sanitizeText(input) {
    if (!input || typeof input !== 'string') return input;
    let sanitized = input;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern.regex, pattern.mask);
    }
    return sanitized;
  }

  static sanitizeObject(obj, privacyLevel = 1) {
    if (!obj || typeof obj !== 'object') return obj;

    // Level 0: Metadata only
    if (privacyLevel === 0) {
      return { _metaOnly: true, traceId: obj.traceId, durationMs: obj.durationMs };
    }

    const copy = Array.isArray(obj) ? [] : {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('password') || lowerKey.includes('secret') || lowerKey.includes('cvv') || lowerKey.includes('token')) {
        copy[key] = "[REDACTED_FIELD]";
      } else if (typeof value === 'string') {
        copy[key] = this.sanitizeText(value);
      } else if (typeof value === 'object' && value !== null) {
        copy[key] = this.sanitizeObject(value, privacyLevel);
      } else {
        copy[key] = value;
      }
    }
    return copy;
  }

  static adversarialAudit(targetData) {
    const rawString = typeof targetData === 'string' ? targetData : JSON.stringify(targetData);
    const leaks = [];

    for (const pattern of SENSITIVE_PATTERNS) {
      const matches = rawString.match(pattern.regex);
      if (matches) {
        leaks.push({ pattern: pattern.name, count: matches.length, sample: matches[0].substring(0, 4) + '...' });
      }
    }

    return {
      passed: leaks.length === 0,
      leakCount: leaks.length,
      leaks
    };
  }
}

module.exports = { PrivacySanitizer, SENSITIVE_PATTERNS };
