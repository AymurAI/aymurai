import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import api from "@/services/api";

interface Props {
  children: ReactNode;
}

export default function APIProtected({ children }: Props) {
  if (!api.defaults.baseURL) return <Navigate to="/" />;
  return children;
}
