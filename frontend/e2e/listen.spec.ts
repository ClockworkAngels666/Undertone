import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, watchErrors } from "./helpers";

/** A silent stand-in for the browser's voice: each utterance "ends" after a moment, and the page keeps what it said. */
async function fakeVoice(page: Page, ms = 400) {
  await page.addInitScript((delay) => {
    const said: string[] = [];
    let timers: number[] = [];
    Object.assign(window, { said });
    const synth = {
      paused: false,
      speaking: false,
      getVoices: () => [],
      speak(u: SpeechSynthesisUtterance) {
        said.push(u.text);
        timers.push(window.setTimeout(() => u.onend?.call(u, new Event("end") as SpeechSynthesisEvent), delay));
      },
      cancel() {
        timers.forEach((t) => window.clearTimeout(t));
        timers = [];
      },
      pause() {},
      resume() {},
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    if (typeof window.SpeechSynthesisUtterance !== "function") {
      Object.assign(window, {
        SpeechSynthesisUtterance: class {
          lang = "";
          rate = 1;
          voice = null;
          onend = null;
          onerror = null;
          text: string;
          constructor(text: string) {
            this.text = text;
          }
        },
      });
    }
  }, ms);
}

const said = (page: Page) => page.evaluate(() => (window as unknown as { said: string[] }).said);

test("listens to a UN speech at the rostrum, and jumps to a notable sentence", async ({ page }) => {
  const noErrors = watchErrors(page);
  await fakeVoice(page, 900);
  await page.goto("/un?v=read");
  const reading = page.locator("#close-reading");
  const bar = reading.getByRole("group", { name: "Listen to this speech" });
  await reading.scrollIntoViewIfNeeded();
  await bar.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByTestId("now-reading")).not.toBeEmpty();
  await expect(bar.locator(".listen-count")).not.toHaveText(/^1 \//);     // it moves on by itself

  await bar.getByRole("button", { name: "Pause" }).click();
  await expect(bar.getByRole("button", { name: "Resume" })).toBeVisible();

  await reading.locator("summary", { hasText: "Full speech" }).click();
  const jump = reading.locator(".listen-from").last();
  const item = await jump.locator("xpath=ancestor::li").innerText();
  const before = (await said(page)).length;
  await jump.click();
  await expect.poll(async () => (await said(page)).slice(before).some((s) => item.includes(s.slice(0, 40)))).toBe(true);
  // the full speech lights up the sentence being read and keeps it in view inside its box
  const box = page.getByTestId("full-speech");
  await expect(box.locator("span.now")).toHaveCount(1);
  await expect.poll(() => box.evaluate((el) => {
    const now = el.querySelector("span.now")?.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return Boolean(now && now.top >= b.top - 1 && now.bottom <= b.bottom + 1);
  })).toBe(true);

  // with the main controls scrolled away, a pinned player keeps Pause and Stop in reach
  await bar.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY + 400));
  const pinned = page.getByRole("group", { name: /^Reading .* aloud$/ });
  await expect(pinned).toBeVisible();
  await pinned.getByRole("button", { name: "Stop" }).click();
  await expect(pinned).toHaveCount(0);
  await expect(bar.getByRole("button", { name: "Listen", exact: true })).toBeVisible();
  await expect(page.getByTestId("now-reading")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  noErrors();
});

test("listens to an analyzed text, starting from a tapped sentence", async ({ page }) => {
  const noErrors = watchErrors(page);
  await fakeVoice(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Use sample text" }).click();
  await page.getByRole("button", { name: "Analyze" }).click();
  const text = page.getByTestId("highlighted-text");
  await expect(text.locator("p")).toHaveCount(3);                  // the sample's three paragraphs
  await page.getByRole("button", { name: "Listen", exact: true }).click();
  await expect(text.locator("span.now")).toHaveCount(1);

  const eighth = text.locator('span[data-i="8"]');
  await eighth.click();
  await expect(eighth).toHaveClass("now");
  const spoken = await eighth.innerText();
  await expect.poll(async () => (await said(page)).includes(spoken.trim())).toBe(true);
  // after the last sentence it stops by itself
  await expect(page.getByRole("button", { name: "Listen", exact: true })).toBeVisible({ timeout: 5000 });
  await expect(text.locator("span.now")).toHaveCount(0);
  noErrors();
});
