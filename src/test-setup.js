// Provides a working IndexedDB in the test environment. happy-dom has
// no IDB; without this, every kvSet/kvRemove call swallows a silent
// error. With the polyfill, IDB behaves and production error paths
// stay live.
import 'fake-indexeddb/auto'
