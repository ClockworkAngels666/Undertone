import { ISO_ALPHA2, ISO_NUMERIC } from "./isoCodes";
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
