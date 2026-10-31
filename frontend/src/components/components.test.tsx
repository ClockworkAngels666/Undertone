import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ApiError, api, withRetry } from "../api/client";
import { MetaContext } from "../lib/hooks";
import { META, mockFetch } from "../test/fixtures";
import { HighlightedText } from "./common";
import CountryPicker from "./CountryPicker";
import MetricCards from "./MetricCards";
import TrendChart from "./TrendChart";

describe("HighlightedText", () => {
  it("marks dictionary words without interpreting HTML", () => {
    const text = "<b>x</b> We condemn it and welcome dialogue.";
    const start = text.indexOf("condemn");
    const coop = text.indexOf("dialogue");
    const { container } = render(<HighlightedText text={text}
      spans={[[start, start + 7, "hostile"], [coop, coop + 8, "cooperative"]]} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe(text);
    expect(screen.getByText("condemn").tagName).toBe("MARK");
    expect(screen.getByText("condemn")).toHaveClass("hostile");
    expect(screen.getByText("dialogue")).toHaveClass("cooperative");
  });
});

describe("MetricCards", () => {
  it("shows values and their differences from the average, without judging them", () => {
    render(
      <MetaContext.Provider value={META}>
        <MetricCards metrics={{ tone_balance: 0.5, hostility: 9, cooperation: 5, vader_mean: 0.1, negative_share: 0.3 }}
          compareTo={{ tone_balance: 0.2, hostility: 7, cooperation: 11, vader_mean: 0.1, negative_share: 0.25 }}
          compareLabel="UN avg" />
      </MetaContext.Provider>,
    );
    const hostility = screen.getByTestId("metric-hostility");
    expect(within(hostility).getByText("9.0")).toBeInTheDocument();
    expect(hostility.querySelector(".delta")).toHaveTextContent("+2.0 vs UN avg");
    expect(hostility.querySelector(".delta")).not.toHaveClass("bad");     // red means hostile words only
    expect(screen.getByTestId("metric-tone_balance").querySelector(".delta")).toHaveTextContent("+0.30");
  });
});

describe("CountryPicker", () => {
  const options = [
    { code: "RUS", name: "Russia" },
    { code: "USA", name: "United States" },
    { code: "VNM", name: "Vietnam" },
  ];

  function Harness({ max = 2 }: { max?: number }) {
    const [value, setValue] = useState(["RUS"]);
    return <CountryPicker options={options} value={value} onChange={setValue} max={max} colors={{}} />;
  }

  it("adds by name or code and removes with the remove button", async () => {
    const user = userEvent.setup();
    render(<Harness max={3} />);
    const input = screen.getByRole("combobox");
    await user.type(input, "viet{Enter}");
    expect(screen.getByText("Vietnam")).toBeInTheDocument();
    await user.type(input, "usa{Enter}");
    expect(screen.getByText("United States")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Russia" }));
    expect(screen.queryByText("Russia")).not.toBeInTheDocument();
  });

  it("stops at the maximum", async () => {
    const user = userEvent.setup();
    render(<Harness max={2} />);
    await user.type(screen.getByRole("combobox"), "USA{Enter}");
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByText("(2/2)")).toBeInTheDocument();
  });
});

describe("TrendChart", () => {
  it("has a legend and a table view of every value", () => {
    render(
      <TrendChart
        series={[
          { key: "RUS", label: "Russia", color: "#2a78d6", points: [{ year: 2020, value: 0.1 }, { year: 2021, value: -0.2 }] },
          { key: "USA", label: "United States", color: "#eb6834", points: [{ year: 2020, value: 0.3 }, { year: 2021, value: null }] },
        ]}
        average={[{ year: 2020, value: 0.2 }, { year: 2021, value: 0.0 }]}
        format={(v) => v.toFixed(2)}
        tickFormat={(v) => String(v)}
        valueLabel="Tone balance"
      />,
    );
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getByText("Russia")).toBeInTheDocument();
    expect(within(legend).getByText("All-country average")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("-0.20")).toBeInTheDocument();
    expect(within(table).getByText("–")).toBeInTheDocument();     // missing value
  });

  it("says so when there is nothing to draw", () => {
    render(<TrendChart series={[]} format={String} tickFormat={String} valueLabel="x" />);
    expect(screen.getByText("No data for this selection.")).toBeInTheDocument();
  });

  it("picks out one line from the legend and shows all again", async () => {
    const user = userEvent.setup();
    render(<TrendChart format={String} tickFormat={String} valueLabel="x" series={[
      { key: "RUS", label: "Russia", color: "#2a78d6", points: [{ year: 2020, value: 0.1 }] },
      { key: "USA", label: "United States", color: "#eb6834", points: [{ year: 2020, value: 0.3 }] },
    ]} />);
    const russia = screen.getByRole("button", { name: "Russia" });
    expect(russia).toHaveAccessibleDescription(/on its own/);
    await user.click(russia);
    expect(russia).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "United States" }).closest("li")).toHaveClass("faded");
    await user.click(russia);
    expect(russia).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "United States" }).closest("li")).not.toHaveClass("faded");
  });

  it("forgets a picked line once its country leaves the chart", async () => {
    const user = userEvent.setup();
    const russia = { key: "RUS", label: "Russia", color: "#2a78d6", points: [{ year: 2020, value: 0.1 }] };
    const usa = { key: "USA", label: "United States", color: "#eb6834", points: [{ year: 2020, value: 0.3 }] };
    const props = { format: String, tickFormat: String, valueLabel: "x" };
    const { rerender } = render(<TrendChart {...props} series={[russia, usa]} />);
    await user.click(screen.getByRole("button", { name: "Russia" }));
    rerender(<TrendChart {...props} series={[usa]} />);
    rerender(<TrendChart {...props} series={[russia, usa]} />);
    expect(screen.getByRole("button", { name: "Russia" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "United States" }).closest("li")).not.toHaveClass("faded");
  });

  it("draws the data when it arrives after an empty first render", () => {
    // Pages render the chart before their data loads; a hook after the early return crashed the whole page
    const props = { format: String, tickFormat: String, valueLabel: "x" };
    const { rerender } = render(<TrendChart series={[]} {...props} />);
    rerender(<TrendChart {...props}
      series={[{ key: "VNM", label: "Vietnam", color: "#2a78d6", points: [{ year: 2022, value: 0.4 }] }]} />);
    expect(within(screen.getByRole("list", { name: "Legend" })).getByText("Vietnam")).toBeInTheDocument();
  });
});

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns the server's detail message into the error text", async () => {
    mockFetch({ "/api/analyze": () => ({ status: 422, body: { detail: "The text is empty." } }) });
    await expect(api.analyze(" ")).rejects.toMatchObject({ message: "The text is empty.", status: 422 });
  });

  it("explains when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(api.meta()).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/Can't reach the server/) });
  });

  it("gives a plain message for server errors without details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    await expect(api.meta()).rejects.toMatchObject({ message: expect.stringMatching(/server had a problem/) });
  });

  it("sends the edit token and JSON body", async () => {
    const calls = mockFetch({ "/api/datasets/abc/documents": () => ({ body: { added: 1, skipped: [], total_documents: 1 } }) });
    await api.datasets.addDocuments("abc", "secret", [{ country: "VNM", year: 2023, text: "Hello there everyone." }]);
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get("X-Edit-Token")).toBe("secret");
    expect(JSON.parse(String(calls[0].init?.body)).documents[0].country).toBe("VNM");
  });

  it("retries while the server is starting, but not on client errors", async () => {
    let attempts = 0;
    const flaky = () => {
      attempts += 1;
      return attempts < 3 ? Promise.reject(new ApiError("down", 502)) : Promise.resolve("ok");
    };
    await expect(withRetry(flaky, 4, 1)).resolves.toBe("ok");
    expect(attempts).toBe(3);
    let calls = 0;
    await expect(withRetry(() => {
      calls += 1;
      return Promise.reject(new ApiError("bad", 422));
    }, 4, 1)).rejects.toThrow("bad");
    expect(calls).toBe(1);
  });
});
