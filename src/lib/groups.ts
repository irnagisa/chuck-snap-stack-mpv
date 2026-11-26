/**
 * グループ (シリーズ・同じ内容の別パターン) の Tauri コマンド (src-tauri/src/commands/db_groups.rs)。
 * 変更したあとはライブラリを読み直して、一覧のまとめ表示とグループの印を合わせる。
 */
import { invoke } from '@tauri-apps/api/core';
import { useLibraryStore } from '../store/useLibraryStore';
import type {
  MediaGroupCandidate,
  MediaGroupDetail,
  MediaGroupKind,
  MediaGroupSuggestion,
  MediaGroupSummary,
} from '../types';

const refresh = () => useLibraryStore.getState().fetchVideos();

export async function createGroup(name: string, kind: MediaGroupKind, videoIds: number[]): Promise<number> {
  const id = await invoke<number>('db_group_create', { name, kind, videoIds });
  await refresh();
  return id;
}

export async function addToGroup(groupId: number, videoIds: number[]): Promise<void> {
  await invoke('db_group_add_videos', { groupId, videoIds });
  await refresh();
}

/** グループから外す。残りが 1 件以下になったグループは解かれる */
export async function removeFromGroup(videoIds: number[]): Promise<void> {
  await invoke('db_group_remove_videos', { videoIds });
  await refresh();
}

export async function updateGroup(groupId: number, updates: { name?: string; kind?: MediaGroupKind }): Promise<void> {
  await invoke('db_group_update', { groupId, name: updates.name ?? null, kind: updates.kind ?? null });
  await refresh();
}

export async function setGroupCover(groupId: number, videoId: number): Promise<void> {
  await invoke('db_group_set_cover', { groupId, videoId });
  await refresh();
}

export async function reorderGroup(groupId: number, videoIds: number[]): Promise<void> {
  await invoke('db_group_reorder', { groupId, videoIds });
  await refresh();
}

/** グループを解く (動画はライブラリに残る) */
export async function deleteGroup(groupId: number): Promise<void> {
  await invoke('db_group_delete', { groupId });
  await refresh();
}

export const getGroupForVideo = (videoId: number) =>
  invoke<MediaGroupDetail | null>('db_group_for_video', { videoId });

export const listGroups = () => invoke<MediaGroupSummary[]>('db_group_list');

export const getGroupSuggestions = () => invoke<MediaGroupSuggestion[]>('db_group_suggestions');

export const getGroupCandidates = (videoId: number) =>
  invoke<{ suggestedName: string; candidates: MediaGroupCandidate[] }>('db_group_candidates_for_video', { videoId });

/** グループの名前の案: 選んだ動画の名前に共通する先頭部分 (短すぎれば最初の動画の名前) */
export function commonNamePrefix(names: string[]): string {
  const cleaned = names.map((n) => n.replace(/\.[^./\\]+$/, ''));
  if (cleaned.length === 0) return '';
  let prefix = cleaned[0];
  for (const n of cleaned.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length && prefix[i] === n[i]) i++;
    prefix = prefix.slice(0, i);
  }
  // 区切りや括弧の途中で終わらないようにする
  prefix = prefix.replace(/[\s_\-.([{【第#0-9]+$/u, '').trim();
  return prefix.length >= 2 ? prefix : cleaned[0];
}
