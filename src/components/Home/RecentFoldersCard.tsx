import { useHomeStore } from "../../store/useHomeStore";
import homeStyles from "./Home.module.css";

interface Props {
  onSelect: (dir: string) => void;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/$/, "").split("/").pop() ?? path;
}

export function RecentFoldersCard({ onSelect }: Props) {
  const recentFolders = useHomeStore((s) => s.recentFolders);

  if (recentFolders.length === 0) return null;

  return (
    <section className={homeStyles.section}>
      <h2 className={homeStyles.heading}>最近開いたフォルダ</h2>
      <ul className={homeStyles.folderList}>
        {recentFolders.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className={`${homeStyles.folder} ${homeStyles.truncate}`}
              title={f.path}
              onClick={() => onSelect(f.path)}
            >
              {basename(f.path)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
