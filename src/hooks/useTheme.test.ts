import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../store/useSettingsStore', () => ({
  useSettingsStore: vi.fn(),
}));

import { renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';
import { useSettingsStore } from '../store/useSettingsStore';

const mockUseSettingsStore = vi.mocked(useSettingsStore) as unknown as ReturnType<typeof vi.fn>;

function setupStore(theme: string, isLoaded = true) {
  mockUseSettingsStore.mockImplementation((selector: (s: { theme: string; isLoaded: boolean }) => unknown) =>
    selector({ theme, isLoaded })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.classList.remove('dark');
});

describe('useTheme', () => {
  it('adds "dark" class when theme is "dark"', () => {
    setupStore('dark');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes "dark" class when theme is "light"', () => {
    document.documentElement.classList.add('dark');
    setupStore('light');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('does nothing when isLoaded is false', () => {
    setupStore('dark', false);
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('applies OS preference when theme is "auto" (dark OS)', () => {
    // matchMedia を dark にする
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    setupStore('auto');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies OS preference when theme is "auto" (light OS)', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => ({
        matches: false, // light mode
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    setupStore('auto');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('registers and removes the same matchMedia listener on cleanup', () => {
    let capturedListener: unknown;
    const addEventListenerMock = vi.fn((_event: string, fn: unknown) => {
      capturedListener = fn;
    });
    const removeEventListenerMock = vi.fn();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        addEventListener: addEventListenerMock,
        removeEventListener: removeEventListenerMock,
      })),
    });

    setupStore('auto');
    const { unmount } = renderHook(() => useTheme());
    expect(addEventListenerMock).toHaveBeenCalledWith('change', expect.any(Function));

    unmount();
    // addEventListener と removeEventListener に渡された関数が同一であることを確認
    expect(removeEventListenerMock).toHaveBeenCalledWith('change', capturedListener);
  });
});
