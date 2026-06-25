import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/utils";
import { LanguageSwitcher } from "./LanguageSwitcher";

describe("LanguageSwitcher", () => {
  it("renders a labelled select listing every locale", () => {
    renderWithProviders(<LanguageSwitcher />);
    const select = screen.getByRole("combobox", { name: "Language" });
    expect(select).toBeInTheDocument();
    // Locale display names from LOCALE_NAMES.
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Français" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Deutsch" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Español" })).toBeInTheDocument();
  });

  it("defaults to English", () => {
    renderWithProviders(<LanguageSwitcher />);
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("en");
  });

  it("changing the locale updates the selected value and persists it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LanguageSwitcher />);
    const select = screen.getByRole("combobox", { name: "Language" });
    await user.selectOptions(select, "fr");
    expect(select).toHaveValue("fr");
    expect(window.localStorage.getItem("omni.locale")).toBe("fr");
  });
});
