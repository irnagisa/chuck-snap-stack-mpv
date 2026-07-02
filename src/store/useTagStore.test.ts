import { describe, it, expect } from 'vitest';
import {
  buildCategoryTree,
  flattenCategoryTree,
  getCategoryDescendantIds,
  getCategoryPath,
} from './useTagStore';
import type { Category } from '../types';

function makeCategory(id: number, name: string, parent_id: number | null = null): Category {
  return { id, name, parent_id, color: '#6366f1', icon: null, created_at: '2024-01-01' };
}

// ---------------------------------------------------------------------------
// buildCategoryTree
// ---------------------------------------------------------------------------

describe('buildCategoryTree', () => {
  it('returns empty array for no categories', () => {
    expect(buildCategoryTree([])).toEqual([]);
  });

  it('places categories with null parent_id as roots', () => {
    const cats = [makeCategory(1, 'A'), makeCategory(2, 'B')];
    const tree = buildCategoryTree(cats);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.id)).toEqual([1, 2]);
  });

  it('nests children under their parent', () => {
    const cats = [makeCategory(1, 'Root'), makeCategory(2, 'Child', 1)];
    const tree = buildCategoryTree(cats);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe(2);
  });

  it('supports multi-level nesting', () => {
    const cats = [
      makeCategory(1, 'L1'),
      makeCategory(2, 'L2', 1),
      makeCategory(3, 'L3', 2),
    ];
    const tree = buildCategoryTree(cats);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].children[0].id).toBe(3);
  });

  it('promotes orphan nodes (missing parent) to roots', () => {
    const cats = [makeCategory(2, 'Orphan', 99)];
    const tree = buildCategoryTree(cats);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(2);
  });

  it('initialises each node with an empty children array', () => {
    const cats = [makeCategory(1, 'A')];
    const [node] = buildCategoryTree(cats);
    expect(node.children).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// flattenCategoryTree
// ---------------------------------------------------------------------------

describe('flattenCategoryTree', () => {
  it('returns empty array for empty tree', () => {
    expect(flattenCategoryTree([])).toEqual([]);
  });

  it('returns depth 0 for root nodes', () => {
    const tree = buildCategoryTree([makeCategory(1, 'Root')]);
    const flat = flattenCategoryTree(tree);
    expect(flat[0].depth).toBe(0);
    expect(flat[0].category.id).toBe(1);
  });

  it('lists parent before children', () => {
    const cats = [makeCategory(1, 'Root'), makeCategory(2, 'Child', 1)];
    const flat = flattenCategoryTree(buildCategoryTree(cats));
    expect(flat[0].category.id).toBe(1);
    expect(flat[1].category.id).toBe(2);
  });

  it('increments depth for each nesting level', () => {
    const cats = [
      makeCategory(1, 'L1'),
      makeCategory(2, 'L2', 1),
      makeCategory(3, 'L3', 2),
    ];
    const flat = flattenCategoryTree(buildCategoryTree(cats));
    expect(flat.map((f) => f.depth)).toEqual([0, 1, 2]);
  });

  it('includes all nodes in a multi-branch tree', () => {
    const cats = [
      makeCategory(1, 'Root'),
      makeCategory(2, 'Child A', 1),
      makeCategory(3, 'Child B', 1),
    ];
    const flat = flattenCategoryTree(buildCategoryTree(cats));
    expect(flat).toHaveLength(3);
    expect(flat.filter((f) => f.depth === 1)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getCategoryDescendantIds
// ---------------------------------------------------------------------------

describe('getCategoryDescendantIds', () => {
  it('returns only the id itself when no children exist', () => {
    expect(getCategoryDescendantIds(1, [makeCategory(1, 'A')])).toEqual([1]);
  });

  it('includes direct children', () => {
    const cats = [makeCategory(1, 'Root'), makeCategory(2, 'Child', 1)];
    const ids = getCategoryDescendantIds(1, cats);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it('includes grandchildren (recursive)', () => {
    const cats = [
      makeCategory(1, 'Root'),
      makeCategory(2, 'Child', 1),
      makeCategory(3, 'Grandchild', 2),
    ];
    const ids = getCategoryDescendantIds(1, cats);
    expect(ids).toContain(3);
    expect(ids).toHaveLength(3);
  });

  it('does not include unrelated categories', () => {
    const cats = [makeCategory(1, 'A'), makeCategory(2, 'B')];
    const ids = getCategoryDescendantIds(1, cats);
    expect(ids).not.toContain(2);
  });
});

// ---------------------------------------------------------------------------
// getCategoryPath
// ---------------------------------------------------------------------------

describe('getCategoryPath', () => {
  it('returns null for null id', () => {
    expect(getCategoryPath(null, [])).toBeNull();
  });

  it('returns null for unknown id', () => {
    expect(getCategoryPath(99, [])).toBeNull();
  });

  it('returns the name for a root category', () => {
    const cats = [makeCategory(1, 'Root')];
    expect(getCategoryPath(1, cats)).toBe('Root');
  });

  it('builds slash-separated path for a child category', () => {
    const cats = [makeCategory(1, 'Root'), makeCategory(2, 'Child', 1)];
    expect(getCategoryPath(2, cats)).toBe('Root/Child');
  });

  it('builds a deep path for multi-level nesting', () => {
    const cats = [
      makeCategory(1, 'Root'),
      makeCategory(2, 'Child', 1),
      makeCategory(3, 'Grandchild', 2),
    ];
    expect(getCategoryPath(3, cats)).toBe('Root/Child/Grandchild');
  });

  it('returns just the child name when parent is unknown', () => {
    const cats = [makeCategory(2, 'Child', 99)]; // parent 99 missing
    expect(getCategoryPath(2, cats)).toBe('Child');
  });
});
