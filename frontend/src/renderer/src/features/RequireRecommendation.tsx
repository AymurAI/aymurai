import { Navigate, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useRecommendation } from "@/context/Recommendation";

interface Props {
  children: ReactNode;
}

export default function RequireRecommendation({ children }: Props) {
  const recommendation = useRecommendation();
  const { feature } = useParams({ from: "/$feature" });

  if (!recommendation.prediction && !recommendation.validation) {
    return <Navigate to="/$feature/onboarding" params={{ feature }} />;
  }

  return children;
}
