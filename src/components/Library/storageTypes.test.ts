import { describe, expect, it } from "vitest";
import { freedBytes, type CleanupItem } from "./storageTypes";

function item(id: number, fileSize: number, extra: Partial<CleanupItem> = {}): CleanupItem {
  return {
    id,
    path: `/m/${id}`,
    title: null,
    thumbnail: null,
    fileSize,
    mediaType: "video",
    rating: 0,
    watchCount: 0,
    createdAt: "",
    lastSeenAt: null,
    duration: null,
    categoryId: null,
    ...extra,
  };
}

describe("freedBytes", () => {
  it("クローン情報がなければファイルサイズの合計", () => {
    const items = [item(1, 300), item(2, 500)];
    expect(freedBytes(items, () => true)).toBe(800);
    expect(freedBytes(items, (i) => i.id === 2)).toBe(500);
  });

  it("残すもののクローンを消しても空かない", () => {
    const items = [item(1, 1000, { privateBytes: 0, cloneGroup: 0 }), item(2, 1000, { privateBytes: 0, cloneGroup: 0 })];
    expect(freedBytes(items, (i) => i.id === 2)).toBe(0);
  });

  it("消すものどうしのクローンは共有分を 1 回だけ数える", () => {
    const items = [
      item(1, 1000, { privateBytes: 1000 }),
      item(2, 1000, { privateBytes: 0, cloneGroup: 0 }),
      item(3, 1000, { privateBytes: 0, cloneGroup: 0 }),
    ];
    expect(freedBytes(items, (i) => i.id !== 1)).toBe(1000);
  });

  it("共有していない容量が割り当て単位で切り上がってもファイルサイズを超えない", () => {
    expect(freedBytes([item(1, 1000, { privateBytes: 4096 })], () => true)).toBe(1000);
  });

  it("グループ外のファイルと共有している分は数えない", () => {
    expect(freedBytes([item(1, 1000, { privateBytes: 200 })], () => true)).toBe(200);
  });
});
