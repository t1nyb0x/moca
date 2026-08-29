/**
 * 会話一覧に出す日時の整形。
 *
 * 保存されているのは RFC3339 の文字列。一覧では秒まで要らないので、
 * 今日なら時刻だけ、それ以外は日付を添えて短く出す。
 */
export function formatTimestamp(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  const pad = (value: number): string => String(value).padStart(2, "0");
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;

  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return time;

  const sameYear = at.getFullYear() === now.getFullYear();
  const date = sameYear
    ? `${at.getMonth() + 1}/${at.getDate()}`
    : `${at.getFullYear()}/${at.getMonth() + 1}/${at.getDate()}`;
  return `${date} ${time}`;
}
