import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { MetaContext } from "../lib/hooks";
import { storage } from "../lib/storage";
import { META, RESULT, mockFetch } from "../test/fixtures";
import AnalyzePage, { SAMPLE_TEXT } from "./AnalyzePage";
import DatasetsPage from "./DatasetsPage";
import DictionariesPage from "./DictionariesPage";

function wrap(children: ReactNode) {
  return render(
    <MetaContext.Provider value={META}>
      <MemoryRouter>{children}</MemoryRouter>
    </MetaContext.Provider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("AnalyzePage", () => {
  it("analyzes the sample text and shows scores, highlights and sentences", async () => {
    const calls = mockFetch({ "/api/analyze": () => ({ body: { ...RESULT, highlights: [] } }) });
    const user = userEvent.setup();
    wrap(<AnalyzePage />);
    await user.click(screen.getByRole("button", { name: "Use sample text" }));
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveValue(SAMPLE_TEXT);
    await user.click(screen.getByRole("button", { name: "Analyze" }));

    expect(await screen.findByTestId("baseline-sentence")).toHaveTextContent("hostile words is higher than 87% of them");
    expect(screen.getByTestId("metric-hostility")).toHaveTextContent("83.3");
    expect(screen.getByText("We welcome dialogue and cooperation.")).toBeInTheDocument();
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.text).toBe(SAMPLE_TEXT);
    expect(body.hostile_terms).toBeUndefined();              // default dictionaries are not sent
  });

  it("sends custom dictionaries and shows the server's warnings", async () => {
    storage.saveDictionaries({ hostile: ["foo"], cooperative: ["bar"] });
    const calls = mockFetch({
      "/api/analyze": () => ({ body: { ...RESULT, baseline: null, default_dictionaries: false,
        warnings: ["Custom dictionaries are in use."] } }),
    });
    const user = userEvent.setup();
    wrap(<AnalyzePage />);
    await user.type(screen.getByRole("textbox", { name: "Text" }), "Some text that is long enough.");
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText("Custom dictionaries are in use.")).toBeInTheDocument();
    expect(JSON.parse(String(calls[0].init?.body)).hostile_terms).toEqual(["foo"]);
    expect(screen.getByText(/your custom lists/)).toBeInTheDocument();
  });

  it("shows API errors to the user", async () => {
    mockFetch({ "/api/analyze": () => ({ status: 422, body: { detail: "The text is too short." } }) });
    const user = userEvent.setup();
    wrap(<AnalyzePage />);
    await user.type(screen.getByRole("textbox", { name: "Text" }), "Hi.");
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The text is too short.");
  });

  it("asks for text before calling the server", async () => {
    const calls = mockFetch({});
    const user = userEvent.setup();
    wrap(<AnalyzePage />);
    await user.click(screen.getByRole("button", { name: "Analyze" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Paste a text");
    expect(calls).toHaveLength(0);
  });
});

describe("DictionariesPage", () => {
  it("saves custom lists in the browser and resets to the defaults", async () => {
    const user = userEvent.setup();
    wrap(<DictionariesPage />);
    const hostile = screen.getByRole("textbox", { name: /Hostile words/ });
    expect(hostile).toHaveValue("sanction*, war");
    await user.clear(hostile);
    await user.type(hostile, "threat*, enemy");
    await user.click(screen.getByRole("button", { name: "Save dictionaries" }));
    expect(storage.dictionaries()).toEqual({ hostile: ["threat*", "enemy"], cooperative: ["dialogue", "cooperat*"] });
    await waitFor(() => expect(screen.getByText(/You are using custom dictionaries/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(storage.dictionaries()).toBeNull();
    expect(screen.getByRole("textbox", { name: /Hostile words/ })).toHaveValue("sanction*, war");
  });
});

describe("DatasetsPage", () => {
  it("validates a CSV in the browser, then creates the dataset and uploads in batches", async () => {
    const created = { id: "d1", name: "sample", created_at: "2026-10-01T00:00:00Z" };
    const calls = mockFetch({
      "/api/datasets/d1/documents": () => ({ body: { added: 1, skipped: [{ row: 1, reason: "Too short" }], total_documents: 1 } }),
      "/api/datasets": () => ({ status: 201, body: { dataset: created, edit_token: "tok" } }),
    });
    const user = userEvent.setup();
    wrap(<DatasetsPage />);
    const csv = "country,year,text\nVNM,2023,We welcome dialogue and cooperation today.\nCHN,2024,Short.\n";
    await user.upload(screen.getByLabelText("CSV file"), new File([csv], "sample.csv", { type: "text/csv" }));
    expect(await screen.findByText(/2 texts from 2 countries, 2023–2024/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Dataset name" })).toHaveValue("sample");

    await user.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(storage.token("d1")).toBe("tok"));
    const create = calls.find((c) => c.url === "/api/datasets");
    expect(JSON.parse(String(create?.init?.body))).toMatchObject({ name: "sample", keywords: ["sovereign*", "sanction*", "NATO"] });
    const upload = calls.find((c) => c.url.endsWith("/documents"));
    expect(JSON.parse(String(upload?.init?.body)).documents).toHaveLength(2);
  });

  it("rejects a CSV without the required columns", async () => {
    mockFetch({});
    const user = userEvent.setup();
    wrap(<DatasetsPage />);
    await user.upload(screen.getByLabelText("CSV file"), new File(["name,body\nx,y\n"], "bad.csv", { type: "text/csv" }));
    expect(await screen.findByText(/Missing columns: country, year, text/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create dataset" })).toBeDisabled();
  });
});
