import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyTheme, cacheTheme, initTheme, readCachedTheme, resolveTheme } from './theme';

// Node 22+ の実験的 localStorage グローバルが jsdom の実装を覆い隠すため、メモリ実装に差し替える
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

function mockSystemDark(dark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? dark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

const root = document.documentElement;

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  root.classList.remove('dark', 'light', 'theme-switching');
});
afterEach(() => vi.unstubAllGlobals());

describe('resolveTheme', () => {
  it('returns explicit preferences as-is', () => {
    mockSystemDark(true);
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('follows the OS for "auto"', () => {
    mockSystemDark(true);
    expect(resolveTheme('auto')).toBe('dark');
    mockSystemDark(false);
    expect(resolveTheme('auto')).toBe('light');
  });
});

describe('theme cache', () => {
  it('defaults to "auto" and round-trips valid values', () => {
    expect(readCachedTheme()).toBe('auto');
    cacheTheme('dark');
    expect(readCachedTheme()).toBe('dark');
  });

  it('ignores invalid cached values', () => {
    localStorage.setItem('themePreference', 'sepia');
    expect(readCachedTheme()).toBe('auto');
  });

  it('falls back to "auto" when storage throws', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readCachedTheme()).toBe('auto');
    expect(() => cacheTheme('dark')).not.toThrow();
  });
});

describe('applyTheme', () => {
  it('sets exactly one of .light / .dark', () => {
    applyTheme('dark');
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('light')).toBe(false);
    applyTheme('light');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.classList.contains('light')).toBe(true);
  });

  it('cross-fades with the View Transitions API when animating', async () => {
    mockSystemDark(false);
    applyTheme('light');
    let finish!: () => void;
    const finished = new Promise<void>((r) => { finish = r; });
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { finished } as unknown as ViewTransition;
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition });

    applyTheme('dark', { animate: true });
    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('theme-switching')).toBe(true);

    finish();
    await finished;
    await Promise.resolve();
    expect(root.classList.contains('theme-switching')).toBe(false);
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });

  it('switches instantly when nothing is applied yet', () => {
    const startViewTransition = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: startViewTransition });
    applyTheme('dark', { animate: true });
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(root.classList.contains('dark')).toBe(true);
    delete (document as { startViewTransition?: unknown }).startViewTransition;
  });
});

describe('initTheme', () => {
  it('applies the cached preference before settings load', () => {
    mockSystemDark(false);
    cacheTheme('dark');
    initTheme();
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('follows the OS when nothing is cached', () => {
    mockSystemDark(true);
    initTheme();
    expect(root.classList.contains('dark')).toBe(true);
  });
});
