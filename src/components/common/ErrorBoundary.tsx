import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "../ui";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">
            予期しないエラーが発生しました
          </p>
          <pre className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded p-3 max-w-lg overflow-auto text-left whitespace-pre-wrap">
            {this.state.error?.message}
          </pre>
          <Button variant="primary" onClick={() => this.setState({ hasError: false, error: null })}>
            <RotateCcw aria-hidden />
            再試行
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
