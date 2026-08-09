import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubmissionWorkspaceGrid } from "./SubmissionWorkspaceGrid";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const meta = {
  forms: [{ id: "form-1", name: "Main CFP" }],
  fields: [
    {
      id: "field-1",
      formId: "form-1",
      fieldKey: "audience",
      label: "Audience",
      fieldType: "text",
      formName: "Main CFP",
    },
  ],
  tracks: [],
  reviewers: [],
  rounds: [],
  tags: [],
  formats: ["Talk"],
  builtInColumns: [
    "title",
    "formName",
    "status",
    "tracks",
    "format",
    "submitterName",
    "submitterOrganization",
    "reviewProgress",
    "averageScore",
    "decisionState",
    "notificationState",
    "tags",
    "submittedAt",
    "updatedAt",
  ],
};
const row = {
  id: "submission-1",
  formId: "form-1",
  formName: "Main CFP",
  title: "Reliable systems",
  abstract: "A real proposal",
  format: "Talk",
  status: "pending",
  decisionState: "none",
  submittedAt: "2027-01-01T12:00:00.000Z",
  updatedAt: "2027-01-01T12:00:00.000Z",
  submitterName: "Ada",
  submitterEmail: "ada@example.test",
  submitterOrganization: "Example",
  reviewCount: 1,
  completedReviewCount: 0,
  averageScore: null,
  tracks: "",
  trackIds: [],
  tags: "",
  tagIds: [],
  notificationState: "not_prepared",
  answers: { audience: "Platform teams" },
};

describe("SubmissionWorkspaceGrid", () => {
  it("exposes custom fields as configurable columns and combined filters", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/meta")) return Response.json(meta);
      if (path.endsWith("/views")) return Response.json({ views: [] });
      return Response.json({
        submissions: [row],
        pagination: { page: 1, pageSize: 50, total: 1 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SubmissionWorkspaceGrid eventId="event-1" onOpen={vi.fn()} />);

    expect(await screen.findByText("Reliable systems")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    fireEvent.click(screen.getByLabelText("Audience"));
    expect(
      await screen.findByRole("columnheader", { name: "Audience" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Platform teams")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(screen.getByRole("button", { name: /add custom filter/i }));
    fireEvent.change(screen.getByLabelText("Custom field value"), {
      target: { value: "platform" },
    });
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5),
    );
  });

  it("creates an organization-shared saved view with persisted configuration", async () => {
    let savedView: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith("/meta")) return Response.json(meta);
        if (path.endsWith("/views") && init?.method === "POST") {
          savedView = {
            id: "view-1",
            name: "Review readiness",
            visibility: "organization",
            config: JSON.parse(String(init.body)).config,
            version: 1,
            isDefault: false,
            canEdit: true,
          };
          return Response.json({ view: savedView }, { status: 201 });
        }
        if (path.includes("/views/view-1") && init?.method === "PATCH")
          return Response.json({ ok: true });
        if (path.endsWith("/views"))
          return Response.json({ views: savedView ? [savedView] : [] });
        return Response.json({
          submissions: [row],
          pagination: { page: 1, pageSize: 50, total: 1 },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SubmissionWorkspaceGrid eventId="event-1" onOpen={vi.fn()} />);
    await screen.findByText("Reliable systems");
    fireEvent.change(screen.getByLabelText("New saved view name"), {
      target: { value: "Review readiness" },
    });
    fireEvent.click(screen.getByLabelText(/share/i));
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/views"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"visibility":"organization"'),
        }),
      ),
    );
    fireEvent.change(await screen.findByLabelText("Saved view name"), {
      target: { value: "Ready for assignment" },
    });
    fireEvent.click(screen.getByLabelText(/shared/i));
    fireEvent.click(screen.getByRole("button", { name: /update/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/views/view-1"),
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"name":"Ready for assignment"'),
        }),
      ),
    );
  });
});
