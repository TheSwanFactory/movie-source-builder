# Tasks: Movie Source Builder

**Project**: movie-source-builder  
**Generated**: 2026-07-31  
**Components**: npm package and CLI

## 1. Setup [completed]

- [x] 1.1 Initialize the publish-ready package in package.json and tsconfig.json
- [x] 1.2 Add formatting, linting, test, build, and CI configuration

## 2. Source Bundles (P1) [completed]

- [x] 2.1 Define public MSB/MSO schemas in src/schema.ts
- [x] 2.2 Implement safe ZIP reading and writing in src/archive.ts
- [x] 2.3 Implement validate, inspect, and pack commands in src/cli.ts

## 3. Plan and Render (P1) [completed]

- [x] 3.1 Implement deterministic planning and cost limits in src/render.ts
- [x] 3.2 Implement mocked generation and atomic resumable output in src/render.ts

## 4. Export (P1) [completed]

- [x] 4.1 Implement provider-free deterministic FFmpeg export in src/export.ts
- [x] 4.2 Implement make orchestration in src/cli.ts

## 5. Example and Quality [completed]

- [x] 5.1 Add the compound-interest source fixture under examples/compound-interest
- [x] 5.2 Add schema, archive, planning, resume, and end-to-end tests under test
- [x] 5.3 Document installation, formats, safety, cost, caching, and limitations in README.md
- [x] 5.4 Run the complete local and CI-equivalent verification suite

## Dependency Graph

```text
1.* -> 2.* -> 3.* -> 4.* -> 5.*
```

## Suggested Starting Point

Start with package setup, then implement schema and archive foundations.
