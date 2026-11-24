import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination, ThreePaneLayout } from '.';
import '../../i18n';

// Node 22+ の実験的 localStorage グローバルが jsdom の実装を覆い隠すため、メモリ実装に差し替える
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

describe('ThreePaneLayout', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('renders sidebar, main and detail panes with a resizer', () => {
    render(
      <ThreePaneLayout sidebar={<div>side</div>} detail={<div>detail</div>} sidebarLabel="サイドバー幅">
        <div>main</div>
      </ThreePaneLayout>,
    );
    expect(screen.getByText('side')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('detail')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'サイドバー幅' })).toHaveAttribute('aria-valuenow', '176');
  });

  it('omits the sidebar and resizer when sidebar is null', () => {
    render(
      <ThreePaneLayout sidebar={null} detail={null}>
        <div>main</div>
      </ThreePaneLayout>,
    );
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('restores the saved width (clamped) and persists keyboard resizes', () => {
    localStorage.setItem('librarySidebarWidth', '9999');
    render(
      <ThreePaneLayout sidebar={<div />} detail={null}>
        <div />
      </ThreePaneLayout>,
    );
    const sep = screen.getByRole('separator');
    expect(sep).toHaveAttribute('aria-valuenow', '400');
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(sep).toHaveAttribute('aria-valuenow', '384');
    expect(localStorage.getItem('librarySidebarWidth')).toBe('384');
    fireEvent.keyDown(sep, { key: 'Home' });
    expect(sep).toHaveAttribute('aria-valuenow', '120');
  });
});

describe('Pagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} totalCount={3} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('disables prev on the first page and navigates forward', () => {
    const onPageChange = vi.fn();
    render(<Pagination currentPage={1} totalPages={3} totalCount={300} onPageChange={onPageChange} />);
    const [prev, next] = screen.getAllByRole('button');
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
  });
});
