/**
 * UI プリミティブ (Radix UI + Native CSS Modules + Lucide + Motion)
 *
 * - スタイルは各コンポーネント隣の *.module.css に `@layer ui { … }` で書く
 * - 色・余白・角丸などは src/styles/tokens.css のトークンを使う
 * - アイコンは lucide-react を直接 import する
 * - アニメーションのプリセットは ./motion.ts、表示/非表示の切替は ./presence.tsx
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./Button";
export { Checkbox } from "./Checkbox";
export { ConfirmDialog } from "./ConfirmDialog";
export { ContextMenu } from "./ContextMenu";
export { Dialog, useDialogClose, type DialogSize } from "./Dialog";
export { DropdownMenu } from "./DropdownMenu";
export { EmptyState } from "./EmptyState";
export { Input, type InputProps } from "./Input";
export { Collapse, useFrozenWhileExiting } from "./presence";
export { Popover } from "./Popover";
export { RadioGroup, RadioGroupItem } from "./RadioGroup";
export { ScrollArea } from "./ScrollArea";
export { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
export { Select, type SelectOption } from "./Select";
export { Slider } from "./Slider";
export { Switch } from "./Switch";
export { Tabs } from "./Tabs";
export { Tooltip, TooltipProvider } from "./Tooltip";
export { cx } from "./cx";
export * as motionPresets from "./motion";
