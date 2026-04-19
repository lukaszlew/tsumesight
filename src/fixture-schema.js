// Schema versions for test fixture files and the event stream inside them.
//
// Two independent versions:
//   SCHEMA_VERSION        = the outer fixture file shape
//   EVENT_SCHEMA_VERSION  = the shape of individual events inside
//
// Bumping either requires adding a migrator in `fixture-migrate.js` so
// existing fixtures stay readable.
//
// Fixture file shape (schemaVersion: 1, eventSchemaVersion: 2):
//   {
//     schemaVersion: 1,
//     sgf: { content, filename, path, contentHash },
//     config: { maxSubmits, maxQuestions },
//     recorded: { at, eventSchemaVersion, viewport:{w,h}, rotated },
//     events: [{kind, t, ...}, ...],
//     goldens: {
//       scoreEntry: {...} | null,
//       finalMarks: [{key, value, color}, ...] | null,
//       submitResults: [[{status, userVertex, userVal}, ...], ...] | null,
//       changedGroupsVertices: [[x,y], ...] | null,
//     }
//   }
//
// Stored replay shape in kv (`replay:<sgfId>:<finishDate>`, v:3):
//   { v:3, events, config, viewport, goldens }
// Converter reads this, combines with sgf content + metadata, wraps into
// a full fixture at `schemaVersion: 1`.

export const SCHEMA_VERSION = 1
export const EVENT_SCHEMA_VERSION = 2
