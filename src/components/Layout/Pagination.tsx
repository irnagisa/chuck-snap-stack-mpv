import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui";
import styles from "./Layout.module.css";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, totalCount, onPageChange }: PaginationProps) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  return (
    <nav className={styles.pagination}>
      <Button disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>
        <ChevronLeft />
        {t("pagination.prev")}
      </Button>
      <span className={styles.pageInfo}>
        {currentPage} / {totalPages}
        <span className={styles.pageCount}>
          {t("pagination.count", { count: totalCount.toLocaleString() })}
        </span>
      </span>
      <Button disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>
        {t("pagination.next")}
        <ChevronRight />
      </Button>
    </nav>
  );
}
