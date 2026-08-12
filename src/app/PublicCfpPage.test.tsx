import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicCfpPage, validateCfpFieldValue } from "./PublicCfpPage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("public CFP section progression", () => {
  it("blocks the next section until current required values pass server-equivalent validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/auth/session")
          return Response.json({ user: null });
        return Response.json({
          form: {
            name: "ProgramLoom Summit proposals",
            description: "Share a useful, specific session idea.",
            eventName: "ProgramLoom Summit 2027",
            organizationName: "ProgramLoom Programs",
            timezone: "America/New_York",
            primaryColor: "#315d49",
            opensAt: null,
            closesAt: "2027-08-01T21:00:00.000Z",
            editClosesAt: "2027-08-01T21:00:00.000Z",
            allowDrafts: true,
            availability: "open",
          },
          fields: [
            {
              id: "field-1",
              section: "session",
              fieldType: "textarea",
              fieldKey: "abstract",
              label: "Session abstract",
              description: null,
              required: true,
              position: 1,
            },
          ],
          conditions: [],
        });
      }),
    );
    render(
      <MemoryRouter initialEntries={["/c/org/summit/main"]}>
        <Routes>
          <Route
            path="/c/:organizationSlug/:eventSlug/:formSlug"
            element={<PublicCfpPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "About you" }),
    ).toBeVisible();
    expect(
      document.querySelector(".cfp-section-progress > div > strong"),
    ).toHaveTextContent("Section 1 of 3");
    expect(
      document.querySelector(".cfp-section-progress > div > span"),
    ).toHaveTextContent("0 of 3 required items completed");
    fireEvent.click(
      screen.getByRole("button", { name: /continue to next section/i }),
    );
    expect(
      await screen.findByText(/complete this section before continuing/i),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "About you" })).toBeVisible();

    fireEvent.change(screen.getByLabelText(/full name/i), {
      target: { value: "Riley Morgan" },
    });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "riley@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /continue to next section/i }),
    );
    await screen.findByRole("heading", { name: "Co-presenters" });
    expect(
      document.querySelector(".cfp-section-progress > div > strong"),
    ).toHaveTextContent("Section 2 of 3");
    fireEvent.click(
      screen.getByRole("button", { name: /continue to next section/i }),
    );
    await screen.findByRole("heading", { name: "Your proposal" });
    expect(
      document.querySelector(".cfp-section-progress > div > strong"),
    ).toHaveTextContent("Section 3 of 3");
    expect(
      screen.getByRole("heading", { name: "Your proposal" }),
    ).toBeVisible();
    expect(
      screen.getByText(/give reviewers enough specific context/i),
    ).toBeVisible();
    expect(screen.getByText("America/New_York")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /what happens after you submit/i }),
    ).toBeVisible();
  });

  it("matches the server's email, URL, number, and option validation categories", () => {
    const field = {
      id: "field",
      section: "session",
      fieldKey: "answer",
      label: "Answer",
      description: null,
      required: false,
      position: 1,
    };
    expect(
      validateCfpFieldValue({ ...field, fieldType: "email" }, "invalid"),
    ).toBe("Enter a valid email address.");
    expect(
      validateCfpFieldValue({ ...field, fieldType: "url" }, "not-a-url"),
    ).toBe("Enter a complete URL.");
    expect(
      validateCfpFieldValue({ ...field, fieldType: "number" }, "none"),
    ).toBe("Enter a valid number.");
    expect(
      validateCfpFieldValue(
        { ...field, fieldType: "select", options: ["Talk"] },
        "Panel",
      ),
    ).toBe("Choose one of the available options.");
  });
});
