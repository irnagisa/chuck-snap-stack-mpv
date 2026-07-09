import { useEffect } from "react";
import { useHomeStore } from "../../store/useHomeStore";
import { InboxSummaryCard } from "./InboxSummaryCard";
import { RecentlyAddedCard } from "./RecentlyAddedCard";
import { LibraryInfoCard } from "./LibraryInfoCard";

interface Props {
  onNavigate: (view: "library" | "inbox") => void;
}

export function HomeView({ onNavigate }: Props) {
  const fetchHomeData = useHomeStore((s) => s.fetchHomeData);

  useEffect(() => {
    fetchHomeData();
  }, [fetchHomeData]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <InboxSummaryCard onOrganize={() => onNavigate("inbox")} />
        <RecentlyAddedCard />
        <LibraryInfoCard />
      </div>
    </div>
  );
}
