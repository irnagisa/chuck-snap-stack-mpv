import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// テスト中に console.error を抑制
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('テスト用エラー');
  return <div>正常表示</div>;
}

describe('ErrorBoundary', () => {
  it('子コンポーネントが正常なら中身を表示する', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('正常表示')).toBeInTheDocument();
  });

  it('子コンポーネントがエラーを投げたらフォールバック UI を表示する', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('予期しないエラーが発生しました')).toBeInTheDocument();
    expect(screen.getByText('テスト用エラー')).toBeInTheDocument();
  });

  it('カスタム fallback を渡した場合はそちらを表示する', () => {
    const customId = 'custom-fallback';
    render(
      <ErrorBoundary fallback={<div id={customId}>カスタムフォールバック</div>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('カスタムフォールバック')).toBeInTheDocument();
    expect(document.getElementById(customId)).toBeInTheDocument();
    // デフォルトの「予期しないエラーが発生しました」は表示されないことを確認
    expect(screen.queryByText('予期しないエラーが発生しました')).not.toBeInTheDocument();
  });

  it('再試行ボタンでエラー状態がリセットされる', () => {
    // shouldThrow を可変にして、retry クリック前に false に切り替える
    let throwNext = true;
    function DynamicBomb() {
      if (throwNext) throw new Error('テスト用エラー');
      return <div>正常表示</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <DynamicBomb />
      </ErrorBoundary>
    );
    expect(screen.getByText('予期しないエラーが発生しました')).toBeInTheDocument();

    // retry を押す前にエラー条件を解除する
    throwNext = false;
    fireEvent.click(screen.getByText('再試行'));

    // retry 後は子コンポーネントが正常に表示される
    rerender(
      <ErrorBoundary>
        <DynamicBomb />
      </ErrorBoundary>
    );
    expect(screen.getByText('正常表示')).toBeInTheDocument();
    expect(screen.queryByText('予期しないエラーが発生しました')).not.toBeInTheDocument();
  });
});
