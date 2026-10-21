import { bookedByWeek, publicBio } from "./domain";
import { BOTTOM_NAV, PUBLIC_NAV, publicNavHasRoleButtons, showsFocusedBookingChrome, showsMarketingFooter } from "./navigation";
import { canOpen, homeFor } from "./workspaces";

test("public navigation has no role-selection buttons", () => {
  expect(publicNavHasRoleButtons()).toBe(false);
  expect(PUBLIC_NAV.map((item) => item.to)).toEqual(["/", "/services", "/practitioners", "/offers", "/contact", "/me"]);
  expect(BOTTOM_NAV.map((item) => item.label)).toEqual(["Home", "Services", "Book", "Offers", "My Nabitouch"]);
});

test("marketing pages keep a public footer and workspaces stay closed", () => {
  expect(showsMarketingFooter("/")).toBe(true);
  expect(showsMarketingFooter("/practitioners")).toBe(true);
  expect(showsMarketingFooter("/contact")).toBe(true);
  expect(showsMarketingFooter("/services/swedish")).toBe(true);
  expect(showsMarketingFooter("/me")).toBe(false);
  expect(showsMarketingFooter("/owner")).toBe(false);
  expect(canOpen(null, "/contact")).toBe(true);
  expect(canOpen(null, "/practitioners")).toBe(true);
  expect(canOpen({ role: "client", workspaces: ["client"] }, "/owner/payments")).toBe(false);
  expect(homeFor({ role: "desk", workspaces: ["desk"] })).toBe("/desk");
});

test("booking and health-history routes use focused chrome without marketing dock", () => {
  expect(showsFocusedBookingChrome("/book")).toBe(true);
  expect(showsFocusedBookingChrome("/book/")).toBe(true);
  expect(showsFocusedBookingChrome("/me/intake")).toBe(true);
  expect(showsFocusedBookingChrome("/me/intake/")).toBe(true);
  expect(showsFocusedBookingChrome("/me")).toBe(false);
  expect(showsFocusedBookingChrome("/services")).toBe(false);
  expect(showsMarketingFooter("/book")).toBe(false);
});

test("weekly revenue uses stored bookings and public bios omit demo labels", () => {
  const weeks = bookedByWeek([
    { date: "2026-10-05", status: "confirmed", pricing: { total: 120 } },
    { date: "2026-10-06", status: "cancelled", pricing: { total: 999 } },
    { date: "2026-10-12", status: "completed", pricing: { total: 40.4 } },
  ]);
  expect(weeks).toEqual([{ week: "10-05", revenue: 120 }, { week: "10-12", revenue: 40 }]);
  expect(publicBio("Owner & practitioner (demo persona).")).toBe("Owner & practitioner.");
});
