import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/constants/i18n";
import SettingsNav from "./settings-nav";

// `Link` needs a `<RouterProvider>` to render at all outside a full router
// tree (it reads `useRouter()` internally) — stubbed the same way
// `routes/home/features.test.tsx` already does for the exact same problem.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe("SettingsNav", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders nothing when the Defensoría flag is off (server-only build)", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "false");
    const { container } = render(<SettingsNav />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders all three links when the flag is on", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "true");
    render(<SettingsNav />);

    expect(screen.getByRole("link", { name: "Servidor" })).toHaveAttribute(
      "href",
      "/home/settings/server",
    );
    expect(screen.getByRole("link", { name: "Nomenclador" })).toHaveAttribute(
      "href",
      "/home/settings/taxonomy",
    );
    expect(screen.getByRole("link", { name: "Organigrama" })).toHaveAttribute(
      "href",
      "/home/settings/organigram",
    );
  });
});
