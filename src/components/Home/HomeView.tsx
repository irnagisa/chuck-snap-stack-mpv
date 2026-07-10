import { useEffect } from "react";
import { useHomeStore } from "../../store/useHomeStore";
import { InboxSummaryCard } from "./InboxSummaryCard";
import { ResumeCard } from "./ResumeCard";
import { RecentlyAddedCard } from "./RecentlyAddedCard";
import { RecentFoldersCard } from "./RecentFoldersCard";
import { LibraryInfoCard } from "./LibraryInfoCard";
import type { Video } from "../../types";

interface Props {
  onNavigate: (view: "library" | "inbox") => void;
  onOpenVideo: (video: Video) => void;
  onOpenFolder: (dir: string) => void;
}

export function HomeView({ onNavigate, onOpenVideo, onOpenFolder }: Props) {
  const fetchHomeData = useHomeStore((s) => s.fetchHomeData);

  useEffect(() => {
    fetchHomeData();
  }, [fetchHomeData]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <InboxSummaryCard onOrganize={() => onNavigate("inbox")} />
        <ResumeCard onOpen={onOpenVideo} />
        <RecentlyAddedCard onOpen={onOpenVideo} />
        <RecentFoldersCard onSelect={onOpenFolder} />
        <LibraryInfoCard />
      </div>
    </div>
  );
}
