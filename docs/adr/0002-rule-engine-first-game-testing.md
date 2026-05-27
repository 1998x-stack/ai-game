# Rule-Engine-First Game Testing

`game_runtime` uses a rule-engine-first strategy rather than pure AI-driven decision-making for automated game testing. Template game types (snake, breakout, tetris, 2048) have deterministic preset test scenarios that run with zero API calls. Unknown game types fall back through heuristic rules (auto-detection of input methods and state variables) before reaching AI decision as a last resort with call limits.

**Considered Options**:
- **Pure AI-driven**: Every test step calls a model to decide the next action. Flexible but costly (~15 API calls per test) and non-deterministic — same game produces different tests each run.
- **Pure static analysis**: Parse game code and generate tests from structure alone. Zero cost but cannot detect runtime behavior — memory leaks, rendering issues, game-over logic are invisible to static analysis.
- **Rule-engine-first (chosen)**: Three-tier degradation: preset scenarios for known types → heuristic rules for unknown types → AI fallback. Balances cost control with coverage.

**Consequences**:
- Template-type coverage requires maintaining preset scenarios for each scaffold template
- Innovation games (unmatched types) still benefit from heuristic detection before hitting AI fallback
- Test results are reproducible for template types — same game code always produces same test report
