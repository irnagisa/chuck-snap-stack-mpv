import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useToastStore, toast } from './useToastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('addToast', () => {
  it('adds a toast to the list', () => {
    useToastStore.getState().addToast('hello', 'info');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toBe('hello');
    expect(useToastStore.getState().toasts[0].type).toBe('info');
  });

  it('returns an id string', () => {
    const id = useToastStore.getState().addToast('hello');
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('auto-removes after duration elapses', () => {
    useToastStore.getState().addToast('bye', 'info', 1000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('does not auto-remove when duration is 0', () => {
    useToastStore.getState().addToast('sticky', 'info', 0);
    vi.advanceTimersByTime(99999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});

describe('updateToast', () => {
  it('updates message and type by id', () => {
    const id = useToastStore.getState().addToast('original', 'info', 0);
    useToastStore.getState().updateToast(id, 'updated', 'error');
    const t = useToastStore.getState().toasts.find((x) => x.id === id);
    expect(t?.message).toBe('updated');
    expect(t?.type).toBe('error');
  });

  it('updates message only when type is omitted', () => {
    const id = useToastStore.getState().addToast('original', 'success', 0);
    useToastStore.getState().updateToast(id, 'new message');
    const t = useToastStore.getState().toasts.find((x) => x.id === id);
    expect(t?.message).toBe('new message');
    expect(t?.type).toBe('success');
  });
});

describe('removeToast', () => {
  it('removes the toast with the given id', () => {
    const id = useToastStore.getState().addToast('remove me', 'info', 0);
    useToastStore.getState().addToast('keep me', 'info', 0);
    useToastStore.getState().removeToast(id);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('keep me');
  });
});

describe('toast helpers', () => {
  it('toast.success adds a success toast', () => {
    toast.success('all good');
    const t = useToastStore.getState().toasts[0];
    expect(t.type).toBe('success');
    expect(t.message).toBe('all good');
  });

  it('toast.error adds an error toast', () => {
    toast.error('oh no');
    const t = useToastStore.getState().toasts[0];
    expect(t.type).toBe('error');
    expect(t.message).toBe('oh no');
  });

  it('toast.info adds an info toast', () => {
    toast.info('fyi');
    const t = useToastStore.getState().toasts[0];
    expect(t.type).toBe('info');
    expect(t.message).toBe('fyi');
  });
});
