import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Button, ConfirmDialog, Dialog, Tabs } from '.';

describe('Button', () => {
  it('defaults to type="button" with variant/size data attributes', () => {
    render(<Button>保存</Button>);
    const btn = screen.getByRole('button', { name: '保存' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveAttribute('data-variant', 'secondary');
    expect(btn).toHaveAttribute('data-size', 'sm');
  });

  it('renders the child element when asChild is set', () => {
    render(
      <Button asChild variant="primary">
        <a href="#x">リンク</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'リンク' });
    expect(link).toHaveAttribute('data-variant', 'primary');
    expect(link).not.toHaveAttribute('type');
  });
});

describe('Dialog', () => {
  function Harness({ onChange }: { onChange?: (open: boolean) => void }) {
    const [open, setOpen] = useState(true);
    return (
      <Dialog
        open={open}
        onOpenChange={(o) => { setOpen(o); onChange?.(o); }}
        title="タイトル"
        closeLabel="閉じる"
      >
        本文
      </Dialog>
    );
  }

  it('renders an accessible dialog with title and body', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'タイトル' })).toBeInTheDocument();
    expect(screen.getByText('本文')).toBeInTheDocument();
  });

  it('closes via the close button', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('ConfirmDialog', () => {
  it('calls onConfirm and closes when the action is clicked', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="削除しますか？"
        confirmLabel="削除"
        cancelLabel="キャンセル"
        onConfirm={onConfirm}
        danger
      />,
    );
    expect(screen.getByRole('alertdialog', { name: '削除しますか？' })).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: '削除' });
    expect(confirm).toHaveAttribute('data-variant', 'danger');
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not confirm on cancel', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="t"
        confirmLabel="OK"
        cancelLabel="キャンセル"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Tabs', () => {
  it('switches the visible panel (uncontrolled)', () => {
    render(
      <Tabs.Root defaultValue="a" activationMode="manual">
        <Tabs.List aria-label="tabs">
          <Tabs.Trigger value="a">A</Tabs.Trigger>
          <Tabs.Trigger value="b">B</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="a">panel A</Tabs.Content>
        <Tabs.Content value="b">panel B</Tabs.Content>
      </Tabs.Root>,
    );
    expect(screen.getByText('panel A')).toBeInTheDocument();
    const b = screen.getByRole('tab', { name: 'B' });
    fireEvent.mouseDown(b, { button: 0 });
    fireEvent.keyDown(b, { key: 'Enter' });
    expect(b).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('panel B')).toBeInTheDocument();
  });
});
