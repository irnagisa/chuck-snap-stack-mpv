import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { Clapperboard } from "lucide-react";
import { motionPresets } from "../ui";
import styles from "./Layout.module.css";

const { fade, popIn, presenceProps, transitions } = motionPresets;

/** ファイルをウィンドウにドラッグ中に表示するオーバーレイ */
export function DropOverlay({ visible }: { visible: boolean }) {
  const { t } = useTranslation();
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.dropOverlay}
          variants={fade}
          transition={transitions.fast}
          {...presenceProps}
        >
          <div className={styles.dropBackdrop} />
          <motion.div className={styles.dropCard} variants={popIn} transition={transitions.spring}>
            <Clapperboard strokeWidth={1.5} aria-hidden />
            <p className={styles.dropTitle}>{t("app.dropImport")}</p>
            <p className={styles.dropHint}>{t("app.dropFormats")}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
