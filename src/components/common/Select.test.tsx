import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Select } from './Select';

describe('Select', () => {
  it('renders a <select> element', () => {
    const { container } = render(<Select />);
    expect(container.querySelector('select')).not.toBeNull();
  });

  it('renders a chevron SVG for the custom arrow', () => {
    const { container } = render(<Select />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  // ---- variant="md" (default) ----

  it('applies md size classes by default', () => {
    const { container } = render(<Select />);
    const sel = container.querySelector('select') as HTMLSelectElement;
    expect(sel.className).toContain('px-3');
    expect(sel.className).toContain('py-2');
    expect(sel.className).toContain('rounded-lg');
  });

  // ---- variant="sm" ----

  it('applies sm size classes when variant="sm"', () => {
    const { container } = render(<Select variant="sm" />);
    const sel = container.querySelector('select') as HTMLSelectElement;
    expect(sel.className).toContain('px-2');
    expect(sel.className).toContain('py-1');
    expect(sel.className).toContain('text-xs');
  });

  it('uses a smaller chevron for sm variant', () => {
    const { container } = render(<Select variant="sm" />);
    const chevron = container.querySelector('span') as HTMLSpanElement;
    expect(chevron.className).toContain('w-3 h-3');
  });

  // ---- fullWidth ----

  it('does not add w-full wrapper class by default', () => {
    const { container } = render(<Select />);
    const wrapper = container.querySelector('div') as HTMLDivElement;
    expect(wrapper.className).not.toContain('w-full');
  });

  it('adds w-full wrapper class when fullWidth=true', () => {
    const { container } = render(<Select fullWidth />);
    const wrapper = container.querySelector('div') as HTMLDivElement;
    expect(wrapper.className).toContain('w-full');
  });

  // ---- extra props ----

  it('forwards extra HTML attributes to the <select>', () => {
    const { container } = render(<Select aria-label="choose" />);
    expect(container.querySelector('[aria-label="choose"]')).not.toBeNull();
  });

  it('appends extra className to the <select>', () => {
    const { container } = render(<Select className="my-custom" />);
    expect(container.querySelector('select')?.className).toContain('my-custom');
  });

  it('fires onChange when value changes', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Select onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>
    );
    fireEvent.change(container.querySelector('select')!, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalled();
  });
});
