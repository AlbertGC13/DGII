# Project Agent Rules

- Current official DGII documentation overrides the recovered roadmap and all derived notes.
- Never invent fiscal, XML, signature, certificate, or transport rules.
- Use fixed-precision decimal arithmetic for monetary values; never use float or double arithmetic.
- Work test-first: demonstrate RED, implement GREEN, then refactor without weakening tests.
- Never emit empty XML tags. XML work remains blocked until official XSD resources are restored.
- Never store or expose secrets, tokens, certificate passwords, `.p12` contents, or internal diagnostics.
- Keep a modular monolith with explicit module boundaries and no cyclic dependencies.
- Keep authorization enforcement on the backend and return only safe catalog errors to callers.
- Use synthetic fiscal identities and transaction data in tests and documentation.
- Do not modify recovered artifacts unless the project owner explicitly changes this rule.
