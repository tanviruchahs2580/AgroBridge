import { Component, type ErrorInfo, type ReactNode } from "react";
import type { Lang } from "../lib/i18n.js";
import { t } from "../lib/i18n.js";
import { TriangleAlert } from "lucide-react";
import { Button, ErrorBanner } from "./ui.jsx";

interface Props {
  children: ReactNode;
  lang?: Lang;
}

interface State {
  error: Error | null;
}

/** App-level error boundary: shows an accessible fallback instead of a white screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for monitoring; replace with Sentry/Datadog in production.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const lang = this.props.lang ?? "bn";
      return (
        <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
          <TriangleAlert className="h-10 w-10 text-amber-500" aria-hidden />
          <h1 className="text-lg font-bold text-stone-800">{t("errorGeneric", lang)}</h1>
          {import.meta.env.DEV && <ErrorBanner message={this.state.error.message} />}
          <Button onClick={() => this.setState({ error: null })}>{t("retry", lang)}</Button>
        </main>
      );
    }
    return this.props.children;
  }
}
