import { describe, expect, it } from "vitest";
import { formatPositions, formatRoles, hasStaffRole, toggleList } from "./staffRoles";

describe("staffRoles helpers", () => {
  it("formats desk as Receptionist and keeps positions display-only", () => {
    expect(hasStaffRole({ role: "manager" }, "owner")).toBe(true);
    expect(hasStaffRole({ role: "desk" }, "owner")).toBe(false);
    expect(hasStaffRole({ role: "desk", roles: ["desk", "manager"] }, "owner")).toBe(true);
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
