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
 * Holds global state and notifies active key/all listeners on changes.
 */
class GlobalStore<State extends object> {
  private state: State;
  private readonly getInitialState: () => State;
  private readonly keyListeners = new Map<keyof State, Set<KeyListener>>();
  private readonly reactKeyListeners = new Map<keyof State, Set<KeyListener>>();
  private readonly allListeners = new Set<() => void>();

  constructor(initialState: State | (() => State)) {
    this.state = resolveInitialState(initialState);
    this.getInitialState = typeof initialState === 'function' ? initialState as () => State : () => cloneDeep(initialState);
  }

  getState(): State {
    return this.state;
  }

  private notifyKey<K extends keyof State>(key: K, newValue: State[K] | undefined, previousValue: State[K] | undefined): void {
    if (!Object.is(newValue, previousValue)) {
      this.keyListeners.get(key)?.forEach(listener => listener(newValue, previousValue));
    }
  }

  private notifyReactKey<K extends keyof State>(key: K, newValue: State[K] | undefined, previousValue: State[K] | undefined): void {
    if (!Object.is(newValue, previousValue)) {
      this.reactKeyListeners.get(key)?.forEach(listener => listener(newValue, previousValue));
    }
  }

  private notifyAll(): void {
    this.allListeners.forEach(listener => listener());
  }

  set<K extends keyof State>(key: K, value: SetStateAction<State[K]>): void {
    const previousValue = this.state[key];
    const newValue = isSetter(value) ? value(previousValue) : value;
    this.state = {...this.state, [key]: newValue} as State;
    this.notifyReactKey(key, newValue, previousValue);
    this.notifyKey(key, newValue, previousValue);
    this.notifyAll();
  }

  setAll(nextState: State): void {
    const previousState = this.state;
    if (!Object.is(nextState, previousState)) {
      this.state = nextState;
      for (const key of this.reactKeyListeners.keys()) {
        this.notifyReactKey(key, key in nextState ? nextState[key] : undefined, key in previousState ? previousState[key] : undefined);
      }
      this.notifyAll();
    }
    for (const key of this.keyListeners.keys()) {
      this.notifyKey(key, key in nextState ? nextState[key] : undefined, key in previousState ? previousState[key] : undefined);
    }
  }

  update(partialState: Partial<State>): void {
    const previousState = this.state;
    const keys = Object.keys(partialState) as (keyof State)[];
    if (!Object.is(partialState, previousState)) {
      this.state = {...this.state, ...partialState};
      for (const key of keys) {
        this.notifyReactKey(key, this.state[key], previousState[key]);
      }
      this.notifyAll();
    }
    for (const key of keys) {
      this.notifyKey(key, key in partialState ? partialState[key] : undefined, previousState[key]);
    }
  }

  delete<K extends keyof State>(key: K): void {
    if (!(key in this.state)) {
      return;
    }
    const previousValue = this.state[key];
    const nextState = {...this.state};
    delete nextState[key];
    this.state = nextState as State;
    this.notifyReactKey(key, undefined, previousValue);
    this.notifyKey(key, undefined, previousValue);
    this.notifyAll();
  }

  reset(): void {
    const previousState = this.state;
    this.state = this.getInitialState();
    for (const key of this.reactKeyListeners.keys()) {
      this.notifyReactKey(key, key in this.state ? this.state[key] : undefined, key in previousState ? previousState[key] : undefined);
    }
    for (const key of this.keyListeners.keys()) {
      this.notifyKey(key, key in this.state ? this.state[key] : undefined, key in previousState ? previousState[key] : undefined);
    }
    this.notifyAll();
  }

  get<K extends keyof State>(key: K): State[K] {
    return this.state[key];
  }

  getAll(): State {
    return this.state;
  }

  has<K extends keyof State>(key: K): boolean {
    return key in this.state;
  }

  on<K extends keyof State>(key: K, callback: (state: State[K] | undefined, previousState: State[K] | undefined) => void): () => void {
    if (!this.keyListeners.has(key)) {
      this.keyListeners.set(key, new Set());
    }
    const listener = callback as KeyListener;
    this.keyListeners.get(key)?.add(listener);
    return () => {
      this.keyListeners.get(key)?.delete(listener);
    };
  }

  subscribeToKey<K extends keyof State>(key: K, callback: (state: State[K] | undefined, previousState: State[K] | undefined) => void): () => void {
    if (!this.reactKeyListeners.has(key)) {
      this.reactKeyListeners.set(key, new Set());
    }
    const listener = callback as KeyListener;
    this.reactKeyListeners.get(key)?.add(listener);
    return () => {
      this.reactKeyListeners.get(key)?.delete(listener);
    };
  }

  off<K extends keyof State>(key: K, callback?: (state: State[K] | undefined, previousState: State[K] | undefined) => void): void {
    if (!callback) {
      this.keyListeners.delete(key);
      return;
    }
    this.keyListeners.get(key)?.delete(callback as KeyListener);
  }

  subscribeToAll(callback: () => void): () => void {
    this.allListeners.add(callback);
    return () => {
      this.allListeners.delete(callback);
    };
  }
}

/**
 * Creates a small global state container with React subscriptions for shared state across components.
 */
export function createGlobalStore<State extends object>(initialState: State | (() => State)) {
  const store = new GlobalStore<State>(initialState);

  function setter<K extends keyof State>(key: K, value: SetStateAction<State[K]>): void {
    store.set(key, value);
  }

  return {
    /** Deletes a key from state and notifies subscribers for that key. */
    delete<K extends keyof State>(key: K): void {
      store.delete(key);
    },

    /** Retrieves a single state key without subscribing to changes. */
    get<K extends keyof State>(key: K): State[K] {
      return store.get(key);
    },

    /** Retrieves the whole state object without subscribing to changes. */
    getAll(): State {
      return store.getAll();
    },

    /** Returns whether a key currently exists in the store. */
    has<K extends keyof State>(key: K): boolean {
      return store.has(key);
    },

    /** Registers a key listener and returns an unsubscribe function. */
    on<K extends keyof State>(key: K, callback: (state: State[K] | undefined, previousState: State[K] | undefined) => void): () => void {
      return store.on(key, callback);
    },

    /** Removes key listeners. If no callback is supplied all listeners for the key are removed. */
    off<K extends keyof State>(key: K, callback?: (state: State[K] | undefined, previousState: State[K] | undefined) => void): void {
      store.off(key, callback);
    },

    /** Resets the whole store to the original initial state. */
    reset(): void {
      store.reset();
    },

    /** Sets one state key and notifies listeners when the value changes. */
    set: setter,

    /** Replaces the whole store state and notifies listeners for changed keys. */
    setAll(nextState: State): void {
      store.setAll(nextState);
    },

    /** Updates a subset of the store and notifies listeners for changed keys. */
    update(nextState: Partial<State>): void {
      store.update(nextState);
    },

    /** Works like React.useState for one key in the global store. */
    use<K extends keyof State>(
      key: K,
      defaultValue?: State[K],
      equalityFn?: EqualityFn<State[K]>,
    ): [State[K], (value: SetStateAction<State[K]>) => void] {
      if (defaultValue !== undefined && !store.has(key)) {
        setter(key, defaultValue);
      }
      const getSnapshot = () => store.get(key);
      const defaultEqualityFn: EqualityFn<State[K]> = (left, right) => Object.is(left, right);
      const isEqual = equalityFn ?? defaultEqualityFn;
      const subscribe = (listener: () => void) => store.subscribeToKey(key, (newValue, previousValue) => {
        if (!isEqual(previousValue, newValue)) {
          listener();
        }
      });
      const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      const keySetter = useCallback((nextValue: SetStateAction<State[K]>) => setter(key, nextValue), [key]);
      return [value, keySetter];
    },

    /** Subscribes to the entire state object. */
    useAll(): State {
      const getSnapshot = () => store.getAll();
      const subscribe = (listener: () => void) => store.subscribeToAll(listener);
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
