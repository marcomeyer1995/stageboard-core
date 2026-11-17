---
description: Implement a StageBoard GitHub issue with the issue-first TDD loop.
---

Load the `stageboard-workflow` skill, then implement GitHub issue #$ARGUMENTS:

1. Read the issue with `gh issue view $ARGUMENTS` and restate its acceptance criteria.
2. Use Superpowers `brainstorming` to size the work; agree on the plan before writing code.
3. Work the plan with `test-driven-development`, running `npm run verify` after each task.
4. Use `requesting-code-review`, then open a draft PR that lists what was tested, on which device if any, and what is left. Merge only if the maintainer told you to for this PR and `build-test` is green; never deploy.
