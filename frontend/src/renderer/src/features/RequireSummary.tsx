import { Navigate, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useSummary } from "@/context/Summary";

interface Props {
  children: ReactNode;
}

export default function RequireSummary({ children }: Props) {
  const summary = useSummary();
  const { feature } = useParams({ from: "/$feature" });

  if (summary.status !== "completed" || !summary.document) {
    return <Navigate to="/$feature/process" params={{ feature }} />;
  }

  return children;
}
