# Project Agent Rules

- Current official DGII documentation overrides the recovered roadmap and all derived notes.
- Never invent fiscal, XML, signature, certificate, or transport rules.
- Use fixed-precision decimal arithmetic for monetary values; never use float or double arithmetic.
- Work test-first: demonstrate RED, implement GREEN, then refactor without weakening tests.
- XML work may proceed only from current official DGII XSD/PDF evidence; validate emitted documents against the applicable official XSD; never invent mappings, signature, or transport rules; never emit empty XML tags.
- Never store or expose secrets, tokens, certificate passwords, `.p12` contents, or internal diagnostics.
- Keep a modular monolith with explicit module boundaries and no cyclic dependencies.
- Keep authorization enforcement on the backend and return only safe catalog errors to callers.
- Use synthetic fiscal identities and transaction data in tests and documentation.
- Do not modify recovered artifacts unless the project owner explicitly changes this rule.
