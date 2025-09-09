# Tasks: STEP and STL Export

**Input**: Design documents from `/specs/001-ergogen-currently-uses/`
**Prerequisites**: plan.md

## Phase 3.1: Setup
- [ ] T001: [P] Add `opencascade.js` as a dependency to `package.json`.
- [ ] T002: [P] Create a new empty file `src/step.js` for STEP export logic.
- [ ] T003: [P] Create a new test file `test/unit/step.js` for the new module.

## Phase 3.2: Tests First (TDD)
- [ ] T004: In `test/unit/step.js`, write a failing test for converting a simple `maker.js` rectangle into an `opencascade.js` shape.
- [ ] T005: In `test/cli/step_export.js` (new file), write a failing integration test that runs the Ergogen CLI to export a simple design with a case to the STEP format. This test should check if a non-empty `.stp` file is created.
- [ ] T006: In `test/cli/step_import.js` (new file), write a failing integration test to check if an existing STEP file can be included in the output.

## Phase 3.3: Core Implementation
- [ ] T007: In `src/step.js`, implement the logic to pass the test in T004. This will involve creating a function that takes a `maker.js` model and returns an `opencascade.js` shape.
- [ ] T008: In `src/step.js`, implement the function to write an `opencascade.js` shape to a STEP file string.
- [ ] T009: In `src/io.js`, add a new case for `step` format that calls the STEP export functionality from `src/step.js`.
- [ ] T010: In `src/cli.js`, add the `--format step` option to the export command. This should make the test in T005 pass.
- [ ] T011: In `src/cases.js`, add logic to handle the inclusion of external STEP files specified in the config. This will use `opencascade.js` to read the file.
- [ ] T012: In `src/step.js`, implement the logic to merge the imported STEP shape with the generated case model. This should make the test in T006 pass.

## Phase 3.4: Polish
- [ ] T013: [P] Add unit tests for the STEP file import functionality in `test/unit/step.js`.
- [ ] T014: [P] Refactor and clean up the code in `src/step.js`.
- [ ] T015: [P] Update documentation to reflect the new STEP export feature.

## Dependencies
- T001 must be done before any other task.
- T004 (failing test) must be done before T007 (implementation).
- T005 (failing test) must be done before T008, T009, and T010.
- T006 (failing test) must be done before T011 and T012.
