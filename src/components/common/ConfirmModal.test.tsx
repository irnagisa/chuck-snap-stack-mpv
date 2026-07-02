import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';
import '../../i18n'; // initialize i18n (sets default language to 'ja')

describe('ConfirmModal', () => {
  // ---- rendering ----

  it('renders the message text', () => {
    render(<ConfirmModal message="本当に削除しますか？" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('本当に削除しますか？')).toBeDefined();
  });

  it('renders the default confirmLabel "OK"', () => {
    render(<ConfirmModal message="OK?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('OK')).toBeDefined();
  });

  it('renders a custom confirmLabel', () => {
    render(<ConfirmModal message="msg" onConfirm={() => {}} onCancel={() => {}} confirmLabel="削除" />);
    expect(screen.getByText('削除')).toBeDefined();
  });

  it('renders the i18n cancel label', () => {
    render(<ConfirmModal message="msg" onConfirm={() => {}} onCancel={() => {}} />);
    // ja locale: confirm.cancel = "キャンセル"
    expect(screen.getByText('キャンセル')).toBeDefined();
  });

  // ---- confirm button styling ----

  it('uses blue background for default (non-danger) confirm button', () => {
    render(<ConfirmModal message="msg" onConfirm={() => {}} onCancel={() => {}} confirmLabel="Confirm" />);
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('bg-blue-600');
  });

  it('uses red background when confirmDanger=true', () => {
    render(<ConfirmModal message="msg" onConfirm={() => {}} onCancel={() => {}} confirmLabel="Delete" confirmDanger />);
    const confirmBtn = screen.getByText('Delete');
    expect(confirmBtn.className).toContain('bg-red-600');
  });

  // ---- callbacks ----

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal message="msg" onConfirm={onConfirm} onCancel={() => {}} confirmLabel="Go" />);
    fireEvent.click(screen.getByText('Go'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal message="msg" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when the backdrop (outer div) is clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmModal message="msg" onConfirm={() => {}} onCancel={onCancel} />
    );
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not call onCancel when clicking inside the dialog', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal message="内側をクリック" onConfirm={() => {}} onCancel={onCancel} confirmLabel="OK" />);
    fireEvent.click(screen.getByText('内側をクリック'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
