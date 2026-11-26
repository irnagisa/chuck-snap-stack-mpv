import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { commonNamePrefix } from './groups';

describe('commonNamePrefix', () => {
  it('uses the shared start of the names, without trailing numbers or separators', () => {
    expect(commonNamePrefix(['My Show - 01.mp4', 'My Show - 02.mp4', 'My Show - 10.mp4'])).toBe('My Show');
    expect(commonNamePrefix(['Trip [1080p].mp4', 'Trip [720p].mkv'])).toBe('Trip');
    expect(commonNamePrefix(['番組 第1話', '番組 第2話'])).toBe('番組');
  });

  it('falls back to the first name when nothing meaningful is shared', () => {
    expect(commonNamePrefix(['alpha.mp4', 'beta.mp4'])).toBe('alpha');
    expect(commonNamePrefix(['single.mov'])).toBe('single');
    expect(commonNamePrefix([])).toBe('');
  });
});
