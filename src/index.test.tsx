import { act, cleanup, render } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlobalStore, type EqualityFn } from './index.js';

type Profile = {
  readonly id: string;
  readonly name: string;
};

type TestState = {
  readonly count: number;
  readonly label?: string;
  readonly nan: number;
  readonly optional?: string;
  readonly profile: Profile;
  readonly promise: Promise<string>;
};

type RenderCounts = {
  all: number;
  count: number;
  label: number;
  nan: number;
  profile: number;
  profileById: number;
  promise: number;
};

const initialPromise = Promise.resolve('initial');
const secondPromise = Promise.resolve('second');
const thirdPromise = Promise.resolve('third');
const profileIdEquals: EqualityFn<Profile> = (left, right) => left?.id === right?.id;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('createGlobalStore', () => {
  it('notifies React subscribers using Object.is semantics', () => {
    const store = createGlobalStore(createInitialState());
    const harness = renderTrackedStore(store);

    expect(harness.counts).toEqual({
      all: 1,
      count: 1,
      label: 1,
      nan: 1,
      profile: 1,
      profileById: 1,
      promise: 1,
    });

    act(() => store.set('count', 0));
    expect(harness.counts).toEqual({...harness.counts, all: 2});

    act(() => store.set('count', -0));
    expect(harness.counts).toEqual({...harness.counts, all: 3, count: 2});

    act(() => store.set('nan', Number.NaN));
    expect(harness.counts).toEqual({...harness.counts, all: 4});

    act(() => store.update({ profile: { id: 'one', name: 'Beth' } }));
    expect(harness.counts).toEqual({...harness.counts, all: 5, profile: 2});

    act(() => store.update({ profile: { id: 'two', name: 'Cara' } }));
    expect(harness.counts).toEqual({...harness.counts, all: 6, profile: 3, profileById: 2});

    act(() => store.set('promise', store.get('promise')));
    expect(harness.counts).toEqual({...harness.counts, all: 7});

    act(() => store.set('promise', secondPromise));
    expect(harness.counts).toEqual({...harness.counts, all: 8, promise: 2});
  });

  it('notifies manual listeners using Object.is semantics', () => {
    const store = createGlobalStore(createInitialState());
    const events: { readonly key: keyof TestState; readonly previousValue: unknown; readonly value: unknown }[] = [];

    store.on('count', (value, previousValue) => events.push({ key: 'count', previousValue, value }));
    store.on('nan', (value, previousValue) => events.push({ key: 'nan', previousValue, value }));
    store.on('label', (value, previousValue) => events.push({ key: 'label', previousValue, value }));
    store.on('promise', (value, previousValue) => events.push({ key: 'promise', previousValue, value }));

    store.set('count', 0);
    store.set('count', -0);
    store.set('nan', Number.NaN);
    store.set('promise', store.get('promise'));
    store.set('promise', secondPromise);
    store.update({ promise: secondPromise });
    store.update({ promise: thirdPromise });
    store.setAll({ ...store.getAll(), label: 'b' });
    store.delete('label');
    store.reset();

    expect(events).toEqual([
      { key: 'count', previousValue: 0, value: -0 },
      { key: 'promise', previousValue: initialPromise, value: secondPromise },
      { key: 'promise', previousValue: secondPromise, value: thirdPromise },
      { key: 'label', previousValue: 'a', value: 'b' },
      { key: 'label', previousValue: 'b', value: undefined },
      { key: 'count', previousValue: -0, value: 0 },
      { key: 'label', previousValue: undefined, value: 'a' },
      { key: 'promise', previousValue: thirdPromise, value: initialPromise },
    ]);
  });

  it('supports unsubscribe, off, and direct reads', () => {
    const store = createGlobalStore(createInitialState());
    const removedCallback = vi.fn();
    const unsubscribedCallback = vi.fn();
    const clearedCallback = vi.fn();

    store.on('count', removedCallback);
    store.off('count', removedCallback);

    const unsubscribe = store.on('count', unsubscribedCallback);
    unsubscribe();

    store.on('label', clearedCallback);
    store.off('label');

    store.set('count', 1);
    store.set('label', 'b');

    expect(removedCallback).not.toHaveBeenCalled();
    expect(unsubscribedCallback).not.toHaveBeenCalled();
    expect(clearedCallback).not.toHaveBeenCalled();

    expect(store.get('count')).toBe(1);
    expect(store.getAll().label).toBe('b');
  });

  it('treats equalityFn as a re-render gate that always renders the latest value (Zustand semantics)', () => {
    const store = createGlobalStore(createInitialState());
    let renderCount = 0;
    let renderedName = '';
    let forceRerender: () => void = () => {};

    function ProfileName() {
      const [profile] = store.use('profile', undefined, profileIdEquals);
      const [, setUnrelated] = useState(0);
      forceRerender = () => setUnrelated(previous => previous + 1);
      renderCount += 1;
      renderedName = profile.name;
      return null;
    }

    render(<ProfileName />);
    expect(renderCount).toBe(1);
    expect(renderedName).toBe('Ann');

    // Same id → equalityFn says "equal" → the store update must NOT cause a re-render.
    act(() => store.set('profile', { id: 'one', name: 'Beth' }));
    expect(renderCount).toBe(1);
    expect(renderedName).toBe('Ann');

    // A re-render caused by some other hook must read the LATEST store value, not a stale value
    // memoized by equalityFn.
    act(() => forceRerender());
    expect(renderCount).toBe(2);
    expect(renderedName).toBe('Beth');

    // Different id → equalityFn says "not equal" → re-render with the latest value.
    act(() => store.set('profile', { id: 'two', name: 'Cara' }));
    expect(renderCount).toBe(3);
    expect(renderedName).toBe('Cara');

    // The gate keeps working after a pull-based read: same id again → no re-render.
    act(() => store.set('profile', { id: 'two', name: 'Dana' }));
    expect(renderCount).toBe(3);
    expect(renderedName).toBe('Cara');
  });

  it('renders one component once per store change when it subscribes to multiple keys', () => {
    const store = createGlobalStore({ a: 0, b: 0, c: 0, d: 0 });
    const renderCounts = {
      multiKey: 0,
      d: 0,
    };

    function MultiKeySubscriber() {
      const [a] = store.use('a');
      const [b] = store.use('b');
      const [c] = store.use('c');
      renderCounts.multiKey += 1;
      return <span data-testid="multi">{a + b + c}</span>;
    }

    function DSubscriber() {
      const [d] = store.use('d');
      renderCounts.d += 1;
      return <span data-testid="d">{d}</span>;
    }

    render(
      <>
        <MultiKeySubscriber />
        <DSubscriber />
      </>,
    );

    expect(renderCounts).toEqual({ multiKey: 1, d: 1 });

    act(() => store.set('d', 1));
    expect(renderCounts).toEqual({ multiKey: 1, d: 2 });

    act(() => store.set('a', 1));
    expect(renderCounts).toEqual({ multiKey: 2, d: 2 });

    act(() => store.set('b', 1));
    expect(renderCounts).toEqual({ multiKey: 3, d: 2 });

    act(() => store.update({ a: 2, b: 2, c: 2 }));
    expect(renderCounts).toEqual({ multiKey: 4, d: 2 });

    act(() => store.setAll({ a: 3, b: 3, c: 3, d: 3 }));
    expect(renderCounts).toEqual({ multiKey: 5, d: 3 });
  });
});

function createInitialState(): TestState {
  return {
    count: 0,
    label: 'a',
    nan: Number.NaN,
    profile: {
      id: 'one',
      name: 'Ann',
    },
    promise: initialPromise,
  };
}

function renderTrackedStore(store: ReturnType<typeof createGlobalStore<TestState>>): { readonly counts: RenderCounts } {
  const counts: RenderCounts = {
    all: 0,
    count: 0,
    label: 0,
    nan: 0,
    profile: 0,
    profileById: 0,
    promise: 0,
  };

  function CountSubscriber() {
    store.use('count');
    counts.count += 1;
    return null;
  }

  function LabelSubscriber() {
    store.use('label');
    counts.label += 1;
    return null;
  }

  function NanSubscriber() {
    store.use('nan');
    counts.nan += 1;
    return null;
  }

  function ProfileSubscriber() {
    store.use('profile');
    counts.profile += 1;
    return null;
  }

  function ProfileByIdSubscriber() {
    store.use('profile', undefined, profileIdEquals);
    counts.profileById += 1;
    return null;
  }

  function PromiseSubscriber() {
    store.use('promise');
    counts.promise += 1;
    return null;
  }

  function AllSubscriber() {
    store.useAll();
    counts.all += 1;
    return null;
  }

  render(
    <>
      <CountSubscriber />
      <LabelSubscriber />
      <NanSubscriber />
      <ProfileSubscriber />
      <ProfileByIdSubscriber />
      <PromiseSubscriber />
      <AllSubscriber />
    </>,
  );

  return { counts };
}
