import { promoBannerCopy, promoEligibility, quote, welcomeOfferListed } from "./domain";

const swedish = { slug: "swedish", prices: { 60: 120 } };
const offer = {
  id: "promo-welcome", code: "WELCOME20", name: "First-booking welcome offer", type: "percent", value: 20,
  maxDiscount: 40, eligibility: "first_online", services: "all", stackable: false, enabled: true, approval: "approved",
  placements: ["home", "account", "booking", "services"],
};
const settings = { gst: 0.05, addons: [] };

test("the browser does not treat a new visitor as already qualified", () => {
  expect(welcomeOfferListed(offer)).toBe(true);
  expect(welcomeOfferListed(offer, "home")).toBe(true);
  expect(welcomeOfferListed({ ...offer, placements: ["account"] }, "home")).toBe(false);
  expect(welcomeOfferListed({ ...offer, enabled: false })).toBe(false);
  expect(welcomeOfferListed({ ...offer, approval: "pending" })).toBe(false);
  expect(promoEligibility(offer, null, "swedish")).toBe(false);
  expect(promoEligibility(offer, { onlineBookings: 0 }, "swedish")).toBe(false);
  const copy = promoBannerCopy(offer);
  expect(copy.headline).toContain("welcome");
  expect(copy.body).toContain("20%");
  expect(promoBannerCopy({ ...offer, bannerHeadline: "Custom", bannerBody: "Body text" })).toEqual({ headline: "Custom", body: "Body text" });
  const priced = quote({ service: swedish, duration: 60, zone: { fee: 0 }, promotions: [offer], settings, locationType: "home" });
  expect(priced.discount).toBe(0);
  expect(priced.total).toBe(126);
});

test("a listed welcome offer does not stack in the local estimate", () => {
  const extra = { ...offer, id: "promo-extra", eligibility: "birthday_month", type: "fixed", value: 15, stackable: true, approval: "approved", enabled: true };
  const priced = quote({
    service: swedish, duration: 60, zone: { fee: 0 }, client: null, promotions: [offer, extra], settings, locationType: "home",
  });
  expect(priced.discount).toBe(0);
});
