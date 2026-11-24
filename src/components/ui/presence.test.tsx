import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Collapse, DropdownMenu, Switch } from '.';

describe('Collapse', () => {
  it('mounts children only while shown', async () => {
    const { rerender } = render(<Collapse show={false}>content</Collapse>);
    expect(screen.queryByText('content')).not.toBeInTheDocument();

    rerender(<Collapse show>content</Collapse>);
    expect(screen.getByText('content')).toBeInTheDocument();

    rerender(<Collapse show={false}>content</Collapse>);
    await waitFor(() => expect(screen.queryByText('content')).not.toBeInTheDocument());
  });

  it('keeps rendering the last data while exiting', async () => {
    const { rerender } = render(
      <Collapse show data={3}>{(n: number) => <span>count {n}</span>}</Collapse>,
    );
    expect(screen.getByText('count 3')).toBeInTheDocument();

    // 非表示と同時にデータが空になっても、退場中は直前の値のまま
    rerender(<Collapse show={false} data={0}>{(n: number) => <span>count {n}</span>}</Collapse>);
    expect(screen.queryByText('count 0')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/count/)).not.toBeInTheDocument());
  });
});

describe('DropdownMenu', () => {
  it('opens from the keyboard and closes with an exit animation', async () => {
    render(
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>menu</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item>編集</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: 'menu' }), { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: '編集' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});

describe('Switch', () => {
  it('toggles checked state', () => {
    render(<Switch aria-label="auto play" />);
    const sw = screen.getByRole('switch', { name: 'auto play' });
    expect(sw).toHaveAttribute('data-state', 'unchecked');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('data-state', 'checked');
  });
});
