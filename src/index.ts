import { type SetStateAction, useCallback, useSyncExternalStore } from 'react';

export type EqualityFn<T> = (left: T | null | undefined, right: T | null | undefined) => boolean;

type KeyListener = (newValue: unknown, previousValue: unknown) => void;

function isSetter<T>(value: SetStateAction<T>): value is (previousValue: T) => T {
  return typeof value === 'function';
}

function resolveInitialState<State extends object>(initialState: State | (() => State)): State {
  return typeof initialState === 'function' ? (initialState as () => State)() : cloneDeep(initialState);
}

/**
 * Creates a small global state container with React subscriptions for shared state across components.
 */
export function createGlobalStore<State extends object>(initialState: State | (() => State)) {
  let state = resolveInitialState(initialState);
  const getInitialState = typeof initialState === 'function' ? initialState as () => State : () => cloneDeep(initialState);
  const keyListeners = new Map<keyof State, Set<KeyListener>>();
  const reactKeyListeners = new Map<keyof State, Set<KeyListener>>();
  const allListeners = new Set<() => void>();

  function notifyKey<K extends keyof State>(key: K, newValue: State[K] | undefined, previousValue: State[K] | undefined): void {
    if (!Object.is(newValue, previousValue)) {
      keyListeners.get(key)?.forEach(listener => listener(newValue, previousValue));
    }
  }

  function notifyReactKey<K extends keyof State>(key: K, newValue: State[K] | undefined, previousValue: State[K] | undefined): void {
    if (!Object.is(newValue, previousValue)) {
      reactKeyListeners.get(key)?.forEach(listener => listener(newValue, previousValue));
    }
  }

  function notifyAll(): void {
    if (allListeners.size) {
      allListeners.forEach(listener => listener());
    }
  }

  function set<K extends keyof State>(key: K, value: SetStateAction<State[K]>): void {
    const previousValue = state[key];
    const newValue = isSetter(value) ? value(previousValue) : value;
    state = {...state, [key]: newValue} as State;
    notifyReactKey(key, newValue, previousValue);
    notifyKey(key, newValue, previousValue);
    notifyAll();
  }

  function subscribeToKey<K extends keyof State>(key: K, callback: (state: State[K] | undefined, previousState: State[K] | undefined) => void): () => void {
    if (!reactKeyListeners.has(key)) {
      reactKeyListeners.set(key, new Set());
    }
    const listener = callback as KeyListener;
    reactKeyListeners.get(key)?.add(listener);
    return () => {
      reactKeyListeners.get(key)?.delete(listener);
    };
  }

  function subscribeToAll(callback: () => void): () => void {
    allListeners.add(callback);
    return () => {
      allListeners.delete(callback);
    };
  }

  return {
    /** Deletes a key from state and notifies subscribers for that key. */
    delete<K extends keyof State>(key: K): void {
      if (!(key in state)) {
        return;
      }
      const previousValue = state[key];
      const nextState = {...state};
      delete nextState[key];
      state = nextState as State;
      notifyReactKey(key, undefined, previousValue);
      notifyKey(key, undefined, previousValue);
      notifyAll();
    },

    /** Retrieves a single state key without subscribing to changes. */
    get<K extends keyof State>(key: K): State[K] {
      return state[key];
    },

    /** Retrieves the whole state object without subscribing to changes. */
    getAll(): State {
      return state;
    },

    /** Returns whether a key currently exists in the store. */
    has<K extends keyof State>(key: K): boolean {
      return key in state;
    },

    /** Registers a key listener and returns an unsubscribe function. */
    on<K extends keyof State>(key: K, callback: (state: State[K] | undefined, previousState: State[K] | undefined) => void): () => void {
      if (!keyListeners.has(key)) {
        keyListeners.set(key, new Set());
      }
      const listener = callback as KeyListener;
      keyListeners.get(key)?.add(listener);
      return () => {
        keyListeners.get(key)?.delete(listener);
      };
    },

    /** Removes key listeners. If no callback is supplied all listeners for the key are removed. */
    off<K extends keyof State>(key: K, callback?: (state: State[K] | undefined, previousState: State[K] | undefined) => void): void {
      if (!callback) {
        keyListeners.delete(key);
        return;
      }
      keyListeners.get(key)?.delete(callback as KeyListener);
    },

    /** Resets the whole store to the original initial state. */
    reset(): void {
      const previousState = state;
      state = getInitialState();
      for (const key of reactKeyListeners.keys()) {
        notifyReactKey(key, key in state ? state[key] : undefined, key in previousState ? previousState[key] : undefined);
      }
      for (const key of keyListeners.keys()) {
        notifyKey(key, key in state ? state[key] : undefined, key in previousState ? previousState[key] : undefined);
      }
      notifyAll();
    },

    /** Sets one state key and notifies listeners when the value changes. */
    set,

    /** Replaces the whole store state and notifies listeners for changed keys. */
    setAll(nextState: State): void {
      const previousState = state;
      if (!Object.is(nextState, previousState)) {
        state = nextState;
        for (const key of reactKeyListeners.keys()) {
          notifyReactKey(key, key in nextState ? nextState[key] : undefined, key in previousState ? previousState[key] : undefined);
        }
        notifyAll();
      }
      for (const key of keyListeners.keys()) {
        notifyKey(key, key in nextState ? nextState[key] : undefined, key in previousState ? previousState[key] : undefined);
      }
    },

    /** Updates a subset of the store and notifies listeners for changed keys. */
    update(partialState: Partial<State>): void {
      const previousState = state;
      const keys = Object.keys(partialState) as (keyof State)[];
      if (!Object.is(partialState, previousState)) {
        state = {...state, ...partialState};
        for (const key of keys) {
          notifyReactKey(key, state[key], previousState[key]);
        }
        notifyAll();
      }
      for (const key of keys) {
        notifyKey(key, key in partialState ? partialState[key] : undefined, previousState[key]);
      }
    },

    /** Works like React.useState for one key in the global store. */
    use<K extends keyof State>(
      key: K,
      defaultValue?: State[K],
      equalityFn?: EqualityFn<State[K]>,
    ): [State[K], (value: SetStateAction<State[K]>) => void] {
      if (defaultValue !== undefined && !(key in state)) {
        set(key, defaultValue);
      }
      const getSnapshot = () => state[key];
      const defaultEqualityFn: EqualityFn<State[K]> = (left, right) => Object.is(left, right);
      const isEqual = equalityFn ?? defaultEqualityFn;
      const subscribe = (listener: () => void) => subscribeToKey(key, (newValue, previousValue) => {
        if (!isEqual(previousValue, newValue)) {
          listener();
        }
      });
      const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      const keySetter = useCallback((nextValue: SetStateAction<State[K]>) => set(key, nextValue), [key]);
      return [value, keySetter];
    },

    /** Subscribes to the entire state object. */
    useAll(): State {
      const getSnapshot = () => state;
      const subscribe = (listener: () => void) => subscribeToAll(listener);
      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    },
  };
}

function cloneDeep<T>(obj: T): T {
  return cloneDeepImpl(obj, new WeakMap<object, object>());
}

function cloneDeepImpl<T>(obj: T, cycleMap: WeakMap<any, any>): T {
  if (cycleMap.has(obj)) {
    return cycleMap.get(obj);
  }

  let result = obj;
  const type = {}.toString.call(obj).slice(8, -1);
  if (type === 'Set') {
    result = new Set([...(obj as unknown as Set<any>)].map(value => cloneDeepImpl(value, cycleMap))) as T;
  } else if (type === 'Map') {
    result = new Map([...(obj as unknown as Map<any, any>)].map(kv => [cloneDeepImpl(kv[0], cycleMap), cloneDeepImpl(kv[1], cycleMap)])) as T;
  } else if (type === 'Date') {
    result = new Date((obj as unknown as Date).getTime()) as T;
  } else if (type === 'RegExp') {
    result = RegExp((obj as unknown as RegExp).source, getRegExpFlags(obj as unknown as RegExp)) as T;
  } else if (type === 'Array' || type === 'Object') {
    const isArray = Array.isArray(obj);
    result = isArray ? [] as T : {} as T;
    cycleMap.set(obj as object, result as object);
    Object.defineProperties(result, Object.getOwnPropertyDescriptors(obj));
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(obj))) {
      Object.defineProperty(result, key, {...descriptor, value: cloneDeepImpl(descriptor.value, cycleMap)});
    }
    (result as any).__proto__ = (obj as any).__proto__;
  }

  return result;
}

function getRegExpFlags(regExp: RegExp): string {
  if ((typeof regExp as any).flags === 'string') {
    return (regExp as any).flags;
  }
  const flags = [];
  regExp.global && flags.push('g');
  regExp.ignoreCase && flags.push('i');
  regExp.multiline && flags.push('m');
  regExp.sticky && flags.push('y');
  regExp.unicode && flags.push('u');
  return flags.join('');
}
