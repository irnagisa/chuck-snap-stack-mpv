/**
 * 画面から始めた確認 (無音・pHash) が動いている間は、裏での確認を休ませる。
 * 同じファイルを両方で調べたり、読み込みを取り合ったりしないため
 */
let running = 0;

/** 確認を始めたときに呼び、終わったら戻り値を呼ぶ */
export function beginForegroundCheck(): () => void {
  running++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    running--;
  };
}

export function isForegroundCheckRunning(): boolean {
  return running > 0;
}
