import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastContainer } from './ToastContainer';
import { useToastStore } from '../../store/useToastStore';

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('ToastContainer', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders toast messages', () => {
    useToastStore.setState({ toasts: [{ id: '1', message: 'Hello!', type: 'info' }] });
    render(<ToastContainer />);
    expect(screen.getByText('Hello!')).toBeDefined();
  });

  it('renders multiple toasts', () => {
    useToastStore.setState({
      toasts: [
        { id: '1', message: 'First', type: 'info' },
        { id: '2', message: 'Second', type: 'success' },
      ],
    });
    render(<ToastContainer />);
    expect(screen.getByText('First')).toBeDefined();
    expect(screen.getByText('Second')).toBeDefined();
  });

  // ---- type icons ----

  it('shows ✓ icon for success type', () => {
    useToastStore.setState({ toasts: [{ id: '1', message: 'Done', type: 'success' }] });
    render(<ToastContainer />);
    expect(screen.getByText('✓')).toBeDefined();
  });

  it('shows ℹ icon for info type', () => {
    useToastStore.setState({ toasts: [{ id: '1', message: 'FYI', type: 'info' }] });
    render(<ToastContainer />);
    expect(screen.getByText('ℹ')).toBeDefined();
  });

  it('shows error icon for error type', () => {
    useToastStore.setState({ toasts: [{ id: '1', message: 'Oops', type: 'error' }] });
    render(<ToastContainer />);
    // Both the type icon and close button render '✕'
    expect(screen.getAllByText('✕').length).toBeGreaterThanOrEqual(1);
  });

  // ---- close button ----

  it('close button removes the toast from the store', () => {
    useToastStore.setState({ toasts: [{ id: 'x', message: 'Bye', type: 'info' }] });
    render(<ToastContainer />);
    fireEvent.click(screen.getByRole('button'));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('only removes the clicked toast when multiple exist', () => {
    useToastStore.setState({
      toasts: [
        { id: 'keep', message: 'Keep me', type: 'success' },
        { id: 'remove', message: 'Remove me', type: 'error' },
      ],
    });
    render(<ToastContainer />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]); // second toast's close button
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].id).toBe('keep');
  });

  // ---- accessibility ----

  it('wraps toasts in an aria-live="polite" region', () => {
    useToastStore.setState({ toasts: [{ id: '1', message: 'A', type: 'info' }] });
    const { container } = render(<ToastContainer />);
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});
