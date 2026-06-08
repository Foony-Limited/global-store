# @foony/global-store

This is a small React global store utility used by [Foony](https://foony.com) apps. It provides a typed global state container with React hooks, imperative reads/writes, and key-level subscriptions. The API surface is minimal on purpose. We've found that it's easy to learn yet expressive enough for us to manage and share state across all our React and non-React code.

## Install

```bash
npm install @foony/global-store
```

The package ships compiled ESM output and TypeScript declarations.

## Quick Start

```tsx
import { createGlobalStore } from '@foony/global-store';

const counterStore = createGlobalStore({
  count: 0,
});

function Counter() {
  const [count, setCount] = counterStore.use('count');

  return (
    <button onClick={() => setCount(previous => previous + 1)}>
      Count: {count}
    </button>
  );
}
```

## API

### `createGlobalStore(initialState)`

Creates a store with:

- `use(key, defaultValue?, equalityFn?)`: React hook for a single state key.
- `useAll()`: React hook for the full state object.
- `get(key)`: Read one key without subscribing.
- `getAll()`: Read the full state object without subscribing.
- `set(key, valueOrUpdater)`: Set one key.
- `update(partialState)`: Merge a partial state object.
- `setAll(state)`: Replace the full state object.
- `delete(key)`: Delete one key.
- `reset()`: Reset to the initial state.
- `on(key, callback)`: Listen to key changes outside React.
- `off(key, callback?)`: Remove one key listener, or all listeners for a key if `callback` is undefined.
- `has(key)`: Check whether a key exists.

## Equality

Key-level subscriptions use `Object.is` by default. This means `NaN` is treated as unchanged when set to `NaN`, while `0` and `-0` are treated as distinct values.

Custom equality functions can be passed to `use`:

```tsx
const [profile] = userStore.use('profile', undefined, (left, right) => left?.id === right?.id);
```

## Common Patterns

### Listening On Multiple Keys

In React, the idiomatic way to listen on several keys in this library (but not the whole store) is to use one `.use()` call per key:

```tsx
const [foo] = foobarStore.use('foo');
const [bar] = foobarStore.use('bar');
```

This only causes one re-render for the React component even when multiple keys change during the same update.

### Colocating setters

For larger stores, exporting small action functions keeps components focused on UI:

```ts
const sessionStore = createGlobalStore({
  userId: null as string | null,
  isMenuOpen: false,
});

export function logOut() {
  sessionStore.update({
    userId: null,
    isMenuOpen: false,
  });
}
```

### Non-React listeners

Use `on` for effects outside React components, such as analytics, storage sync, games, or anything else:

```ts
const unsubscribe = settingsStore.on('theme', theme => {
  localStorage.setItem('theme', theme ?? 'system');
});

unsubscribe();
```

### Lazy defaults

If a key may be missing, pass a default value to `use`. The default is written once when the component first reads that missing key:

```tsx
const [sidebarWidth, setSidebarWidth] = layoutStore.use('sidebarWidth', 280);
```

### `useAll` sparingly

Prefer `use(key)` for component rendering. `useAll()` is useful for diagnostics and broad UI shells, but it re-renders whenever the store root changes. While rare, we find `useAll()` to be important for some edge cases that require the *whole* store, such as Foony's GameConfig.

## State Updates

Use `set` for one key, `update` for a partial merge, and `setAll` when replacing the full state:

```ts
store.set('count', count => count + 1);
store.update({ isSaving: true, error: null });
store.setAll(nextState);
```

Treat stored objects as immutable. If you mutate an object in place and write back the same reference, key subscribers may not be notified because equality is reference based.

If you need a programmatic way to force a re-render of a component, you can use an "empty object" pattern:
```ts
const [, rerender] = useState({});
rerender({});
```

## Development

```bash
npm install
npm test
npm run build
```
