# Implementation Plan: STEP and STL Export

**Branch**: `001-ergogen-currently-uses` | **Date**: 2025-09-08 | **Spec**: [./spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-ergogen-currently-uses/spec.md`

## Summary
This plan outlines the technical steps to add STEP export functionality for cases in Ergogen. The primary user requirement is to generate STEP files from Ergogen case designs for use in CAD software. The proposed technical approach is to integrate `opencascade.js` to handle the geometric modeling and STEP file generation.

## Technical Context
**Language/Version**: JavaScript (ES6+)
**Primary Dependencies**: `maker.js`, `opencascade.js` (new)
**Storage**: N/A
**Testing**: `tape`
**Target Platform**: Node.js
**Project Type**: Single project (CLI tool)
**Performance Goals**: N/A
**Constraints**: Must integrate with the existing `maker.js`-based geometry generation.
**Scale/Scope**: The initial implementation will focus on basic case geometry.

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: 1 (ergogen)
- Using framework directly? Yes
- Single data model? Yes
- Avoiding patterns? Yes

**Architecture**:
- EVERY feature as library? Yes
- Libraries listed: ergogen (keyboard layout generator)
- CLI per library: ergogen CLI
- Library docs: N/A

**Testing (NON-NEGOTIABLE)**:
- RED-GREEN-Refactor cycle enforced? Yes
- Git commits show tests before implementation? Yes
- Order: Contract→Integration→E2E→Unit strictly followed? Yes
- Real dependencies used? Yes
- Integration tests for: new libraries, contract changes, shared schemas? Yes
- FORBIDDEN: Implementation before test, skipping RED phase

**Observability**:
- Structured logging included? No
- Frontend logs → backend? N/A
- Error context sufficient? Yes

**Versioning**:
- Version number assigned? Yes
- BUILD increments on every change? No
- Breaking changes handled? N/A

## Project Structure

### Documentation (this feature)
```
specs/001-ergogen-currently-uses/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
# Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/
```

**Structure Decision**: Option 1: Single project

## Phase 0: Outline & Research
1.  **Research STEP file generation in JavaScript.**
    *   **Decision**: Use `opencascade.js`.
    *   **Rationale**: It is a JavaScript port of OpenCASCADE, the industry standard for CAD kernels. It has direct support for STEP file writing.
    *   **Alternatives considered**: None, as `opencascade.js` is the clear choice.
2.  **How to integrate `opencascade.js` with `maker.js`?**
    *   **Decision**: `maker.js` geometry will need to be translated into `opencascade.js` shapes. This will likely involve iterating over the `maker.js` model paths and creating corresponding `opencascade.js` edges and faces.
3.  **How to handle existing STEP files?**
    *   **Decision**: `opencascade.js` can read STEP files. This will be the mechanism for incorporating existing STEP files. The user will specify a path to the STEP file in the `cases` section of their config.

**Output**: A `research.md` file is not strictly necessary as the research is captured here.

## Phase 1: Design & Contracts
*Prerequisites: Research complete*

1.  **Data Model**: No new data models are needed. The existing Ergogen config structure will be used. The `cases` section will be extended to allow specifying an output format (`step`) and a path to an existing STEP file.
2.  **API Contracts**: This is a CLI tool, so there are no API contracts. The contract is the CLI interface. A new option `--format step` will be added to the export command.
3.  **Contract Tests**: Tests will be added to verify the new CLI option.
4.  **Test Scenarios**:
    *   A test will be created to export a simple case to STEP format and verify that the output is a valid STEP file.
    *   A test will be created to include an existing STEP file in a design and verify that it is present in the output.

**Output**: Failing tests for the new functionality.

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Create tasks from the Phase 1 design.
- Each new piece of functionality will have a corresponding task.

**Ordering Strategy**:
1.  Add `opencascade.js` as a dependency.
2.  Create a new module for STEP export, e.g., `src/step.js`.
3.  Implement the logic to convert `maker.js` models to `opencascade.js` shapes.
4.  Implement the logic to write the `opencascade.js` model to a STEP file.
5.  Add support for the `step` output format in `src/cli.js` and `src/io.js`.
6.  Implement the logic to read and incorporate existing STEP files.
7.  Add tests for all new functionality.

**Estimated Output**: Around 7-10 tasks in `tasks.md`.

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)
**Phase 4**: Implementation (execute tasks.md following constitutional principles)
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A       | N/A        | N/A                                 |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented
