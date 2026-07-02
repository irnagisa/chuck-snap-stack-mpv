import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MediaIcon, IconPicker, MEDIA_ICONS, ICON_LABELS } from './mediaIcons';

// ---------------------------------------------------------------------------
// MediaIcon
// ---------------------------------------------------------------------------

describe('MediaIcon', () => {
  it('renders an <svg> for each known icon key', () => {
    for (const icon of MEDIA_ICONS) {
      const { container } = render(<MediaIcon icon={icon} />);
      expect(container.querySelector('svg')).not.toBeNull();
    }
  });

  it('renders a fallback <svg> for null', () => {
    const { container } = render(<MediaIcon icon={null} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a fallback <svg> for undefined', () => {
    const { container } = render(<MediaIcon icon={undefined} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a fallback <svg> for an unknown string', () => {
    const { container } = render(<MediaIcon icon="unknown-icon" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applies the default className', () => {
    const { container } = render(<MediaIcon icon="star" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('w-3.5');
  });

  it('applies a custom className', () => {
    const { container } = render(<MediaIcon icon="star" className="w-10 h-10" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('w-10 h-10');
  });
});

// ---------------------------------------------------------------------------
// IconPicker
// ---------------------------------------------------------------------------

describe('IconPicker', () => {
  it('renders a button for each MEDIA_ICONS entry', () => {
    render(<IconPicker value={null} onChange={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(MEDIA_ICONS.length);
  });

  it('sets the title attribute from ICON_LABELS', () => {
    render(<IconPicker value={null} onChange={() => {}} />);
    for (const key of MEDIA_ICONS) {
      expect(screen.getByTitle(ICON_LABELS[key])).toBeDefined();
    }
  });

  it('calls onChange with the clicked icon key', () => {
    const onChange = vi.fn();
    render(<IconPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onChange).toHaveBeenCalledWith(MEDIA_ICONS[0]);
  });

  it('calls onChange with the correct key for each button', () => {
    const onChange = vi.fn();
    render(<IconPicker value={null} onChange={onChange} />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn, i) => {
      fireEvent.click(btn);
      expect(onChange).toHaveBeenCalledWith(MEDIA_ICONS[i]);
    });
  });

  it('applies active highlight class to the selected icon', () => {
    const { getAllByRole } = render(<IconPicker value="star" onChange={() => {}} />);
    const starIndex = MEDIA_ICONS.indexOf('star');
    const buttons = getAllByRole('button');
    expect(buttons[starIndex].className).toContain('ring-1');
  });

  it('does not apply active class to unselected icons', () => {
    const { getAllByRole } = render(<IconPicker value="star" onChange={() => {}} />);
    const folderIndex = MEDIA_ICONS.indexOf('folder');
    expect(getAllByRole('button')[folderIndex].className).not.toContain('ring-1');
  });
});
