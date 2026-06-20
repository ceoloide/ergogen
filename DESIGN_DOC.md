# Design Document: Recursive Inheritance and Fixes

## 1. Introduction
This document outlines the changes made to the inheritance logic in Ergogen to support recursive resolution and correct the inheritance order. These changes address Issues #97 and #100.

## 2. Problem Statement
- **Issue #100:** When an object used `$extends` with an array of targets, the inheritance order was incorrect (the first element in the array was overriding subsequent elements).
- **Issue #97:** Inheritance was only resolving one level deep and was limited to a fixed traversal order. This prevented chained inheritance (A extends B, B extends C) and nested inheritance (inheriting a structure that itself contains `$extends`).

## 3. Proposed Solution
The inheritance logic in `src/prepare.js` was redesigned to use a recursive resolution approach.

### 3.1 Recursive Resolution
The new `inherit` function uses an internal `resolve` function that:
1.  Checks if a value is an object or array.
2.  If it's an object with an `$extends` directive, it resolves the target(s) *before* performing the merge.
3.  Recursively resolves all properties of the resulting object or elements of an array.

### 3.2 Memoization
To ensure efficiency and handle complex dependency graphs, a `Map`-based cache is used. Once an object is resolved, its result is stored and reused.

### 3.3 Circular Dependency Detection
A stack-based approach is used during resolution to detect and error out on circular inheritance patterns (e.g., A extends B, B extends A).

### 3.4 Corrected Order
When resolving `$extends: [A, B]`, the logic now:
1.  Resolves A.
2.  Resolves B.
3.  Merges A into the child.
4.  Merges B into the child (overriding A where applicable).
5.  Merges the child's own properties (overriding both A and B).

## 4. Examples of New Behavior

### 4.1 Chained Inheritance
```yaml
templates:
  base:
    size: 18
  middle:
    $extends: templates.base
    color: red
  top:
    $extends: templates.middle
    label: X
```
Result for `top`: `{ size: 18, color: 'red', label: 'X' }`

### 4.2 Nested Inheritance
```yaml
templates:
  base_part:
    material: plastic
  parent:
    structure:
      part:
        $extends: templates.base_part
        count: 1
main:
  $extends: templates.parent
```
Result for `main`: `{ structure: { part: { material: 'plastic', count: 1 } } }`

## 5. Verification and Testing
- **Coverage:** Maintained 100% statement, branch, and function coverage for `src/prepare.js`.
- **New Unit Tests:** Added specific tests for:
    - Order of extends (Issue #100).
    - Chained recursive inheritance (Issue #97).
    - Nested recursive inheritance (Issue #97).
    - Complex multi-level inheritance.
    - Circular dependency detection.
    - Inheritance within arrays.
    - Multiple inheritance with overlapping properties.
- **Regression Testing:** All existing 103 tests pass.
- **Environment Fix:** Updated KiCad 8 PCB reference file to match current version (4.2.1), resolving a version mismatch failure.
