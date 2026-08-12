import { describe, expect, it } from "vitest";
import { uniqueCurrentExportRows } from "./content";

describe("content export selection", () => {
  it("keeps every selected logical file even when storage objects are shared", () => {
    expect(
      uniqueCurrentExportRows([
        { id: "slides", r2Key: "event/slides-v2.pdf" },
        { id: "corrupt-alias", r2Key: "event/slides-v2.pdf" },
        { id: "headshot", r2Key: "event/headshot-v4.png" },
      ]),
    ).toEqual([
      { id: "slides", r2Key: "event/slides-v2.pdf" },
      { id: "corrupt-alias", r2Key: "event/slides-v2.pdf" },
      { id: "headshot", r2Key: "event/headshot-v4.png" },
    ]);
  });
});
