import type { CommitRules } from "./types.js";

const MAX_SCOPES = 100;
const MAX_TYPES = 50;
const MAX_STRING_LENGTH = 100;
const MIN_HEADER_LENGTH = 1;
const MAX_HEADER_LENGTH = 500;
const MIN_SUBJECT_LENGTH = 1;
const MAX_SUBJECT_LENGTH = 200;
const MIN_BODY_LINE_LENGTH = 1;
const MAX_BODY_LINE_LENGTH = 500;
const MAX_FULL_STOP_LENGTH = 10;
const VALID_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_\-/\\]+$/;

/**
 * Validate and sanitize CommitRules input.
 * Returns sanitized rules or undefined if invalid.
 */
export function sanitizeRules(rules: unknown): CommitRules | undefined {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    return undefined;
  }

  const r = rules as Record<string, unknown>;
  const sanitized: CommitRules = {};

  if (Array.isArray(r.scopes)) {
    sanitized.scopes = r.scopes
      .slice(0, MAX_SCOPES)
      .filter(
        (s): s is string =>
          typeof s === "string" &&
          s.length > 0 &&
          s.length <= MAX_STRING_LENGTH &&
          VALID_IDENTIFIER_PATTERN.test(s)
      );
  }

  if (Array.isArray(r.scopeDelimiters)) {
    sanitized.scopeDelimiters = r.scopeDelimiters
      .slice(0, 10)
      .filter(
        (s): s is string =>
          typeof s === "string" &&
          s.length > 0 &&
          s.length <= 5 &&
          !/[\n\r\x00]/.test(s)
      );
  }

  if (Array.isArray(r.types)) {
    sanitized.types = r.types
      .slice(0, MAX_TYPES)
      .filter(
        (t): t is string =>
          typeof t === "string" &&
          t.length > 0 &&
          t.length <= MAX_STRING_LENGTH &&
          VALID_IDENTIFIER_PATTERN.test(t)
      );
  }

  const isValidCaseValue = (s: string): boolean =>
    typeof s === "string" &&
    s.length > 0 &&
    s.length <= 50 &&
    !/[\n\r\x00]/.test(s);

  if (typeof r.typeCase === "string" && isValidCaseValue(r.typeCase)) {
    sanitized.typeCase = r.typeCase;
  } else if (Array.isArray(r.typeCase)) {
    const filtered = r.typeCase.filter((s): s is string => isValidCaseValue(s));
    if (filtered.length > 0) sanitized.typeCase = filtered;
  }

  if (typeof r.scopeCase === "string" && isValidCaseValue(r.scopeCase)) {
    sanitized.scopeCase = r.scopeCase;
  } else if (Array.isArray(r.scopeCase)) {
    const filtered = r.scopeCase.filter((s): s is string => isValidCaseValue(s));
    if (filtered.length > 0) sanitized.scopeCase = filtered;
  }

  if (typeof r.subjectCase === "string" && isValidCaseValue(r.subjectCase)) {
    sanitized.subjectCase = r.subjectCase;
  } else if (Array.isArray(r.subjectCase)) {
    const filtered = r.subjectCase.filter((s): s is string => isValidCaseValue(s));
    if (filtered.length > 0) sanitized.subjectCase = filtered;
  }

  if (
    typeof r.headerMaxLength === "number" &&
    !isNaN(r.headerMaxLength) &&
    isFinite(r.headerMaxLength)
  ) {
    sanitized.headerMaxLength = Math.max(
      MIN_HEADER_LENGTH,
      Math.min(MAX_HEADER_LENGTH, Math.floor(r.headerMaxLength))
    );
  }

  if (
    typeof r.subjectMaxLength === "number" &&
    !isNaN(r.subjectMaxLength) &&
    isFinite(r.subjectMaxLength)
  ) {
    sanitized.subjectMaxLength = Math.max(
      MIN_SUBJECT_LENGTH,
      Math.min(MAX_SUBJECT_LENGTH, Math.floor(r.subjectMaxLength))
    );
  }

  if (
    typeof r.bodyMaxLineLength === "number" &&
    !isNaN(r.bodyMaxLineLength) &&
    isFinite(r.bodyMaxLineLength)
  ) {
    sanitized.bodyMaxLineLength = Math.max(
      MIN_BODY_LINE_LENGTH,
      Math.min(MAX_BODY_LINE_LENGTH, Math.floor(r.bodyMaxLineLength))
    );
  }

  if (
    typeof r.subjectFullStop === "string" &&
    r.subjectFullStop.length <= MAX_FULL_STOP_LENGTH
  ) {
    const cleaned = r.subjectFullStop.replace(/[^\x20-\x7E]/g, "");
    if (cleaned.length > 0) sanitized.subjectFullStop = cleaned;
  }

  return sanitized;
}
