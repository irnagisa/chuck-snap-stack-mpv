import { describe, it, expect } from 'vitest';
import { formatFileSize, formatTime, parseSqliteDate } from './time';

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

describe('formatFileSize', () => {
  it('単位を切り替える', () => {
    expect(formatFileSize(512 * 1024)).toBe('512.0 KB');
    expect(formatFileSize(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatFileSize(3 * 1024 ** 3)).toBe('3.00 GB');
    expect(formatFileSize(2.5 * 1024 ** 4)).toBe('2.50 TB');
  });
});

describe('parseSqliteDate', () => {
  it('CURRENT_TIMESTAMP の形式を UTC として読む', () => {
    expect(parseSqliteDate('2026-01-02 03:04:05')?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });
  it('ISO 形式はそのまま読む', () => {
    expect(parseSqliteDate('2026-01-02T03:04:05.000Z')?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });
  it('空や不正な値は null', () => {
    expect(parseSqliteDate(null)).toBeNull();
    expect(parseSqliteDate('')).toBeNull();
    expect(parseSqliteDate('not a date')).toBeNull();
  });
});
