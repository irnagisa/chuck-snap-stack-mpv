import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TagBadge } from './TagBadge';
import type { Tag } from '../../types';

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: 1,
    name: 'My Tag',
    color: '#ff0000',
    icon: null,
    tag_category_id: null,
    created_at: '2024-01-01',
    ...overrides,
  };
}

describe('TagBadge', () => {
  it('renders the tag name', () => {
    render(<TagBadge tag={makeTag({ name: 'Hello Tag' })} />);
    expect(screen.getByText('Hello Tag')).toBeDefined();
  });

  it('passes tag.color to the chip as the --tag-color variable', () => {
    const { container } = render(<TagBadge tag={makeTag({ color: '#123456' })} />);
    const span = container.querySelector('span') as HTMLSpanElement;
    expect(span.style.getPropertyValue('--tag-color')).toBe('#123456');
  });

  it('does not render a remove button when onRemove is omitted', () => {
    render(<TagBadge tag={makeTag()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a remove button when onRemove is provided', () => {
    render(<TagBadge tag={makeTag()} onRemove={() => {}} />);
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('calls onRemove when the remove button is clicked', () => {
    const onRemove = vi.fn();
    render(<TagBadge tag={makeTag()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('remove button click does not propagate to parent', () => {
    const parentClick = vi.fn();
    const onRemove = vi.fn();
    render(
      <div onClick={parentClick}>
        <TagBadge tag={makeTag()} onRemove={onRemove} />
      </div>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onRemove).toHaveBeenCalledOnce();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
