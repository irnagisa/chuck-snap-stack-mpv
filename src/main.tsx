// レイヤー順序 (@layer 宣言) を最初に確定させるため、CSS Modules を含むどのモジュールよりも先に読み込む
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "motion/react";
import App from "./App";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { TooltipProvider } from "./components/ui";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* OS の「視差効果を減らす」設定に Motion のアニメーションを追従させる */}
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={400}>
          <App />
        </TooltipProvider>
      </MotionConfig>
    </ErrorBoundary>
  </React.StrictMode>,
);
