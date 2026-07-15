/**
 * サムネイルホバープレビューの同時再生を1件に制限するための調停役。
 * 動画・音声プレビュー共通で使用し、新規プレビュー開始時に既存のプレビューを停止させる。
 */
type StopFn = () => void;

let activeToken: symbol | null = null;
let activeStop: StopFn | null = null;

export function claimPreviewSlot(token: symbol, stop: StopFn) {
  if (activeToken !== token && activeStop) {
    activeStop();
  }
  activeToken = token;
  activeStop = stop;
}

export function releasePreviewSlot(token: symbol) {
  if (activeToken === token) {
    activeToken = null;
    activeStop = null;
  }
}
