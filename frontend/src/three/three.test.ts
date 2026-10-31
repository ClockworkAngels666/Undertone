import { PerspectiveCamera, Scene, Sprite } from "three";
import { ISO_ALPHA2, ISO_NUMERIC } from "./isoCodes";
import { keepLabelsReadable, MIN_LABEL_PX } from "./labels";
import { magnitude, NO_DATA, scaleFor } from "./scales";
import { lonLatToVector3 } from "./stage";

describe("colour scales", () => {
  it("tone balance diverges from grey: red when confrontational, blue when conciliatory", () => {
    const scale = scaleFor("tone_balance", [-0.5, 0.2, 0.9]);
    expect(scale.kind).toBe("diverging");
    expect(scale.domain).toEqual([-1, 1]);
    const [r1, , b1] = rgb(scale.color(-0.9));
    const [r2, , b2] = rgb(scale.color(0.9));
    expect(r1).toBeGreaterThan(b1);
    expect(b2).toBeGreaterThan(r2);
    expect(scale.color(0)).toBe("#d5dbe1");          // neutral grey midpoint, never a hue
    expect(scale.color(null)).toBe(NO_DATA.light);
  });

  it("hostility is sequential red, cooperation sequential blue, capped at the 97th percentile", () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const hostile = scaleFor("hostility", values);
    expect(hostile.kind).toBe("sequential");
    expect(hostile.domain[1]).toBe(97);
    const [r, , b] = rgb(hostile.color(97));
    expect(r).toBeGreaterThan(b);
    const coop = rgb(scaleFor("cooperation", values).color(97));
    expect(coop[2]).toBeGreaterThan(coop[0]);
    expect(hostile.color(500)).toBe(hostile.color(97));        // outliers do not break the scale
  });

  it("magnitude is 0..1 on both kinds of scale", () => {
    expect(magnitude(scaleFor("tone_balance", []), -0.5)).toBeCloseTo(0.5);
    expect(magnitude(scaleFor("hostility", [0, 10]), 20)).toBe(1);
    expect(magnitude(scaleFor("hostility", [0, 10]), -1)).toBe(0);
  });

  it("works in dark mode too", () => {
    expect(scaleFor("tone_balance", [], "dark").color(undefined)).toBe(NO_DATA.dark);
  });
});

describe("globe geometry", () => {
  it("places longitude/latitude on the sphere (north pole up)", () => {
    for (const [lon, lat] of [[0, 0], [105.8, 21.0], [-74, 40.7], [151.2, -33.9]]) {
      expect(lonLatToVector3(lon, lat, 2).length()).toBeCloseTo(2);
    }
    expect(lonLatToVector3(0, 90, 1).y).toBeCloseTo(1);
  });

  it("maps the map's ISO numeric codes to the corpus' alpha-3 codes", () => {
    expect(ISO_NUMERIC["704"]).toBe("VNM");
    expect(ISO_NUMERIC["840"]).toBe("USA");
    expect(ISO_NUMERIC["643"]).toBe("RUS");
    expect(ISO_ALPHA2.VNM).toBe("vn");
  });
});

function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

describe("flags", () => {
  it("finds the flag file for corpus codes, and none for historical states", async () => {
    const { flagFile } = await import("./flags");
    expect(flagFile("VNM")).toMatch(/flag-icons\/flags\/4x3\/vn\.svg$/);
    expect(flagFile("EU")).toMatch(/\/eu\.svg$/);
    expect(flagFile("YUG")).toBeUndefined();         // drawn as a plain flag with its code instead
    expect(flagFile("NOPE")).toBeUndefined();
  });
});

describe("assembly hall", () => {
  it("seats every delegation once, left to right, in more rows for larger assemblies", async () => {
    const { hemicycle, rowsFor } = await import("./AssemblyHall");
    for (const count of [1, 2, 51, 120, 193]) {
      const seats = hemicycle(count);
      expect(seats).toHaveLength(count);
      expect(new Set(seats.map((s) => `${s.x.toFixed(4)},${s.z.toFixed(4)}`)).size).toBe(count);
      for (let i = 1; i < seats.length; i++) expect(seats[i].angle).toBeGreaterThanOrEqual(seats[i - 1].angle);
      expect(Math.max(...seats.map((s) => s.row)) + 1).toBe(rowsFor(count));
      for (const s of seats) expect(s.z).toBeLessThanOrEqual(0);          // all in front of the rostrum
    }
    expect(rowsFor(51)).toBeLessThan(rowsFor(193));
    expect(hemicycle(0)).toEqual([]);
  });

  it("back rows sit higher and hold more seats", async () => {
    const { hemicycle } = await import("./AssemblyHall");
    const seats = hemicycle(193);
    const perRow = (row: number) => seats.filter((s) => s.row === row).length;
    expect(perRow(7)).toBeGreaterThan(perRow(0));
    expect(seats.find((s) => s.row === 7)!.y).toBeGreaterThan(seats.find((s) => s.row === 0)!.y);
  });
});

describe("balance scale", () => {
  it("tips towards the heavier pan, by the tone balance", async () => {
    const { beamAngle } = await import("./BalanceScale");
    expect(beamAngle(0, 0)).toBe(0);
    expect(beamAngle(10, 10)).toBeCloseTo(0);
    expect(beamAngle(10, 30)).toBeLessThan(0);         // more cooperative words: the right pan goes down
    expect(beamAngle(30, 10)).toBeCloseTo(-beamAngle(10, 30));
    expect(Math.abs(beamAngle(0, 5))).toBeGreaterThan(Math.abs(beamAngle(10, 30)));
  });

  it("uses one block per word until a pan would overflow, the same unit on both sides", async () => {
    const { blockUnit } = await import("./BalanceScale");
    expect(blockUnit(10, 15, 36)).toBe(1);
    expect(blockUnit(90, 30, 36)).toBe(3);
    expect(blockUnit(0, 0, 36)).toBe(1);
  });

  it("names each block's words, most frequent first, then the rest", async () => {
    const { blockLabels } = await import("./BalanceScale");
    expect(blockLabels(4, [["sanctions", 2], ["hegemony", 1]], 1))
      .toEqual(["sanctions", "sanctions", "hegemony", "other dictionary words"]);
    expect(blockLabels(4, [["sanctions", 2], ["hegemony", 1]], 2)).toEqual(["sanctions", "hegemony, other dictionary words"]);
    expect(blockLabels(0, [], 1)).toEqual([]);
  });

  it("piles blocks without overlaps, filling layer by layer", async () => {
    const { pile } = await import("./BalanceScale");
    for (const n of [0, 1, 10, 36]) {
      const spots = pile(n);
      expect(spots).toHaveLength(n);
      expect(new Set(spots.map((s) => s.map((v) => v.toFixed(3)).join())).size).toBe(n);
    }
    const spots = pile(36);
    expect(spots[0][1]).toBe(0);
    expect(Math.max(...spots.map((s) => s[1]))).toBeGreaterThan(0);
  });
});

describe("labels", () => {
  it("grow when they would be drawn too small, and return to their size up close", () => {
    const scene = new Scene();
    const camera = new PerspectiveCamera(40, 1, 0.01, 100);
    const label = new Sprite();
    label.userData.label = { height: 0.05, aspect: 4, text: 0.75 };
    scene.add(label);
    const pixelsPerUnit = 400 / (2 * Math.tan((40 * Math.PI) / 360));
    camera.position.set(0, 0, 10);
    keepLabelsReadable(scene, camera, 400);
    expect((label.scale.y * 0.75 * pixelsPerUnit) / 10).toBeCloseTo(MIN_LABEL_PX);
    expect(label.scale.x / label.scale.y).toBeCloseTo(4);
    camera.position.set(0, 0, 0.5);
    keepLabelsReadable(scene, camera, 400);
    expect(label.scale.y).toBeCloseTo(0.05);
  });
});
