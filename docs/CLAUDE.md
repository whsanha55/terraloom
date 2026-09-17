# terraLoom / World Observatory

절차적 세계 생성 + 시간 기반 시뮬레이션 관찰 서비스. 기획 문서: `concept.md`.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Design System

Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Tech stack (2026-09-17 확정)

- Next.js + TypeScript + Tailwind CSS + shadcn/ui (신규 UI 라이브러리 추가 금지)
- 아이콘: Lucide만. 폰트: Pretendard + Inter
- 전체 계획은 `docs/concept.md`(리뷰 완료), 디자인 토큰은 `docs/DESIGN.md`
