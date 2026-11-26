import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "../ui";
import styles from "./ErrorBoundary.module.css";

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
        <div className={styles.root} role="alert">
          <p className={styles.title}>
            予期しないエラーが発生しました
          </p>
          <pre className={styles.message}>
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
