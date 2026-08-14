# AGENTS.md

1. 不需要进行代码测试
2. 代码编写完，不要编写或者修改文档
3. 静态资源都需要打包进 public，避免从 cdn 下载而导致大陆用户体验差

## 工程原则（KISS / YAGNI / DRY / SOLID）

- KISS：优先最小可行改动，避免不必要的复杂性。
- YAGNI：只实现用户当前明确需要的内容，拒绝过度设计。
- DRY：抽取重复逻辑，但不为“未来复用”而提前抽象。
- SOLID：保持职责单一、接口小而清晰、依赖抽象而非具体实现。

---

## Before acting

- If the request is ambiguous, state assumptions or ask — don't silently
  pick one reading and build it.

## When editing existing code

- Change only what the request requires. Don't refactor or restyle working
  code you weren't asked to touch. Match the existing style.

## Design Rules (strict)

Before changing code, check the rules below. If a change would violate one,
stop and explain the smaller redesign first.

Do not fix a banned smell by changing its shape: bool → enum/options,
checks → wrappers, flag/switch → Strategy, pass-through layer → facade/adapter.

1. **Names must disambiguate.** Banned defaults: `data`, `info`, `result`,
   `handler`, `manager`, `process`, `utils`, `helper`, `do_*`, `*_impl`.
   Rename to describe the specific thing/action.

2. **Validate once at edges; trust invariants inside.** Do not scatter
   defensive checks across trusted internal boundaries. No repeated
   `if x is None: return` / `if (!ptr) return -1;`. If the same check
   appears 3+ times, redesign the boundary.

3. **Comments document contracts, invariants, rationale, constraints, and
   rejected alternatives.** Do not narrate code or compensate for bad
   names/boundaries.

4. **No mode/flag parameter for a special case.** No bool, enum, string mode,
   or options bag to switch behavior. If variation is real, use separate
   operations owned by the right abstraction.

5. **Right owner, complete operation.** Put complexity where the decision,
   invariant, or external dependency lives. Expose complete operations, not
   caller-managed steps. Add no API/layer unless it hides caller knowledge,
   enforces an invariant, or adapts an external dependency. Do not stuff
   unrelated behavior together just to keep the API small.

## Stop signals (redesign, don't push through)

- One change spreads across many files → wrong owner or duplicated
  knowledge, not more patches.
- Naming gets hard, or a comment is explaining around an awkward interface
  → suspect the abstraction boundary before adding more words.

---

1. Engineering Principles and Design Discipline
Use these as default design instincts unless the repository, user request, or established framework conventions point elsewhere.

KISS: Prefer the smallest clear solution that solves the current problem.

YAGNI: Do not add abstractions, options, or future-facing design without a real current need.

DRY: Remove meaningful duplication, but do not introduce abstractions that obscure intent.

SOLID: Keep responsibilities focused and public interfaces small, clear, and stable.

Prefer specific names over generic defaults such as data, info, result, manager, helper, utils, do_*, or*_impl. Follow existing project conventions when they are deliberate or framework-driven.

Validate at system boundaries and preserve clear internal invariants. Avoid scattering repeated defensive checks through trusted internal code unless the boundary is genuinely unclear.

Comments in production code should explain why: intent, constraints, trade-offs, rejected alternatives, or non-obvious external requirements. Avoid comments that merely paraphrase the code.

For learning material, diagrams, walkthroughs, and debugging explanations, explain both what happens and why it is designed that way. Make the distinction clear so beginners can understand the flow and remember the reason behind it.

Avoid boolean or flag parameters that create hidden modes. Prefer separate concepts, methods, or types when the distinction represents real behaviour.

Keep interfaces narrow and implementations allowed to be substantial. Do not add pass-through layers unless they hide complexity, enforce invariants, or adapt an external dependency.
