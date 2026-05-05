/** Runs before Vitest imports any test modules so picocolors enables formatting. */

delete process.env.NO_COLOR;

// Vitest workers are normally non‑TTY pipes; FORCE_COLOR ensures picocolors still emits escapes.
process.env.FORCE_COLOR = "1";
