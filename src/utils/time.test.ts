import { describe, it, expect } from 'vitest';
import { formatTime } from './time';

describe('formatTime', () => {
  it('formats 0 seconds as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats seconds under 60 as M:SS', () => {
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(59)).toBe('0:59');
  });

  it('formats exactly 1 minute', () => {
    expect(formatTime(60)).toBe('1:00');
  });

  it('formats minutes and seconds under an hour as M:SS', () => {
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(3599)).toBe('59:59');
  });

  it('formats exactly 1 hour as H:MM:SS', () => {
    expect(formatTime(3600)).toBe('1:00:00');
  });

  it('formats hours with zero-padded minutes and seconds', () => {
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTime(7322)).toBe('2:02:02');
  });

  it('zero-pads single-digit minutes and seconds', () => {
    expect(formatTime(3605)).toBe('1:00:05');
    expect(formatTime(3660)).toBe('1:01:00');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(1.9)).toBe('0:01');
    expect(formatTime(59.999)).toBe('0:59');
    expect(formatTime(3600.9)).toBe('1:00:00');
  });
});
