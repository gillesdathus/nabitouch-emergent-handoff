import { describe, expect, it } from "vitest";
import { formatPositions, formatRoles, toggleList } from "./staffRoles";

describe("staffRoles helpers", () => {
  it("formats desk as Receptionist and keeps positions display-only", () => {
    expect(formatRoles(["owner", "manager", "desk"])).toBe("Owner, Manager, Receptionist");
    expect(formatPositions({ positions: ["owner", "general_manager", "receptionist"] })).toBe(
      "Owner, General Manager, Receptionist",
    );
    expect(formatPositions({ positions: ["other"], customPositionTitle: "Franchise Lead", positionLabels: ["Franchise Lead"] })).toBe("Franchise Lead");
  });

  it("toggles multi-select lists without inventing roles from positions", () => {
    expect(toggleList(["desk"], "manager")).toEqual(["desk", "manager"]);
    expect(toggleList(["desk", "manager"], "manager")).toEqual(["desk"]);
  });
});
