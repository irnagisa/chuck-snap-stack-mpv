import { createContext, useContext, useId, useState, type ComponentProps } from "react";
import { Tabs as RxTabs } from "radix-ui";
import { motion } from "motion/react";
import { cx } from "./cx";
import { transitions } from "./motion";
import styles from "./Tabs.module.css";

/*
 * Radix Tabs + Motion のスライドインジケーター付きタブ (セグメントコントロール風)。
 *
 * <Tabs.Root value={tab} onValueChange={setTab}>
 *   <Tabs.List aria-label="…">
 *     <Tabs.Trigger value="folder"><Folder />フォルダ</Tabs.Trigger>
 *     <Tabs.Trigger value="category">カテゴリ</Tabs.Trigger>
 *   </Tabs.List>
 *   <Tabs.Content value="folder">…</Tabs.Content>
 * </Tabs.Root>
 */

const TabsContext = createContext<{ value: string | undefined; layoutId: string }>({
  value: undefined,
  layoutId: "",
});

function Root({ value, defaultValue, onValueChange, ...props }: ComponentProps<typeof RxTabs.Root>) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const current = value ?? uncontrolled;
  const layoutId = useId();
  return (
    <TabsContext.Provider value={{ value: current, layoutId }}>
      <RxTabs.Root
        value={current}
        onValueChange={(v) => {
          setUncontrolled(v);
          onValueChange?.(v);
        }}
        {...props}
      />
    </TabsContext.Provider>
  );
}

function List({ className, ...props }: ComponentProps<typeof RxTabs.List>) {
  return <RxTabs.List className={cx(styles.list, className)} {...props} />;
}

function Trigger({ className, value, children, ...props }: ComponentProps<typeof RxTabs.Trigger>) {
  const ctx = useContext(TabsContext);
  return (
    <RxTabs.Trigger className={cx(styles.trigger, className)} value={value} {...props}>
      {ctx.value === value && (
        <motion.span layoutId={ctx.layoutId} className={styles.indicator} transition={transitions.spring} />
      )}
      <span className={styles.label}>{children}</span>
    </RxTabs.Trigger>
  );
}

function Content({ className, ...props }: ComponentProps<typeof RxTabs.Content>) {
  return <RxTabs.Content className={cx(styles.content, className)} {...props} />;
}

export const Tabs = { Root, List, Trigger, Content };
