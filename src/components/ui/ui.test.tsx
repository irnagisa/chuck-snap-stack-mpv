import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Button, ConfirmDialog, Dialog, Input, RadioGroup, RadioGroupItem, SegmentedControl, Select, Tabs, useDialogClose } from '.';

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

  it('stays open when clicking a floating layer (toast) above it, but closes on other outside clicks', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Harness onChange={onChange} />
        <div data-floating-layer>
          <span>トースト</span>
        </div>
        <span>外側</span>
      </>,
    );
    // Radix は setTimeout で外側クリックの監視を始める
    await new Promise((r) => setTimeout(r, 0));
    const toast = screen.getByText('トースト');
    fireEvent.pointerDown(toast, { button: 0, pointerType: 'mouse' });
    fireEvent.click(toast);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const outside = screen.getByText('外側');
    fireEvent.pointerDown(outside, { button: 0, pointerType: 'mouse' });
    fireEvent.click(outside);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('useDialogClose', () => {
  function Modal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
    const dialog = useDialogClose(onClose);
    return (
      <Dialog {...dialog.props} title="条件付きモーダル" closeLabel="閉じる">
        <Button onClick={() => dialog.close(onDone)}>完了</Button>
      </Dialog>
    );
  }

  it('calls onClose only after the exit animation when dismissed', async () => {
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(<Modal onClose={onClose} onDone={onDone} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('runs the callback passed to close() instead of onClose', async () => {
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(<Modal onClose={onClose} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: '完了' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
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

describe('Select', () => {
  const options = [
    { value: '', label: 'すべて' },
    { value: '1', label: 'あり' },
    { value: '0', label: 'なし' },
  ];

  it('shows the label of the current value, including the empty-string value', () => {
    render(<Select value="" onValueChange={() => {}} options={options} title="音声" />);
    const trigger = screen.getByRole('combobox', { name: '音声' });
    expect(trigger).toHaveTextContent('すべて');
    expect(trigger).toHaveAttribute('title', '音声');
  });

  it('opens from the keyboard and reports the chosen value', async () => {
    const onValueChange = vi.fn();
    render(<Select value="1" onValueChange={onValueChange} options={options} title="音声" />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'なし' }));
    expect(onValueChange).toHaveBeenCalledWith('0');
  });

  it('maps the internal placeholder back to an empty string', async () => {
    const onValueChange = vi.fn();
    render(<Select value="1" onValueChange={onValueChange} options={options} title="音声" />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('option', { name: 'すべて' }));
    expect(onValueChange).toHaveBeenCalledWith('');
  });
});

describe('Input', () => {
  it('forwards props to the input and shows a clear button only when there is a value', () => {
    const onClear = vi.fn();
    const { rerender } = render(<Input value="" onChange={() => {}} onClear={onClear} placeholder="検索" />);
    expect(screen.getByPlaceholderText('検索')).toHaveAttribute('type', 'text');
    expect(screen.queryByRole('button', { name: 'クリア' })).not.toBeInTheDocument();

    rerender(<Input value="cat" onChange={() => {}} onClear={onClear} placeholder="検索" />);
    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('marks the field as invalid', () => {
    render(<Input invalid aria-label="名前" />);
    expect(screen.getByRole('textbox', { name: '名前' })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('RadioGroup', () => {
  it('reports the chosen value', () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup value="a" onValueChange={onValueChange} aria-label="モード">
        <label><RadioGroupItem value="a" />A</label>
        <label><RadioGroupItem value="b" />B</label>
      </RadioGroup>,
    );
    expect(screen.getByRole('radio', { name: 'A' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
  });
});

describe('SegmentedControl', () => {
  it('changes value and ignores re-selecting the active item', () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        value="grid"
        onValueChange={onValueChange}
        aria-label="表示"
        options={[
          { value: 'grid', label: 'グリッド' },
          { value: 'list', label: 'リスト' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'グリッド' }));
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'リスト' }));
    expect(onValueChange).toHaveBeenCalledWith('list');
  });
});
