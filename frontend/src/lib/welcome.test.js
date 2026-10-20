import { promoBannerCopy, promoEligibility, quote, trialCampaignListed, welcomeOfferListed } from "./domain";

const swedish = { slug: "swedish", prices: { 60: 120 } };
const offer = {
  id: "promo-welcome", code: "WELCOME20", name: "Your First Massage, 20% Off.", type: "percent", value: 20,
  maxDiscount: 40, eligibility: "first_online", services: "all", stackable: false, enabled: true, approval: "approved",
  placements: ["home", "account", "booking", "services", "offers"],
};
const settings = { gst: 0.05, addons: [] };

test("the browser does not treat a new visitor as already qualified", () => {
  expect(welcomeOfferListed(offer)).toBe(true);
  expect(welcomeOfferListed(offer, "home")).toBe(true);
  expect(welcomeOfferListed(offer, "offers")).toBe(true);
  expect(welcomeOfferListed({ ...offer, placements: ["account"] }, "home")).toBe(false);
  expect(welcomeOfferListed({ ...offer, placements: ["account"] }, "offers")).toBe(false);
  expect(welcomeOfferListed({ ...offer, enabled: false })).toBe(false);
  expect(welcomeOfferListed({ ...offer, approval: "pending" })).toBe(false);
  expect(promoEligibility(offer, null, "swedish")).toBe(false);
  expect(promoEligibility(offer, { onlineBookings: 0 }, "swedish")).toBe(false);
  const copy = promoBannerCopy(offer);
  expect(copy.headline).toContain("20%");
  expect(copy.body).toContain("20%");
  expect(copy.cta).toBe("Book my first massage");
  expect(promoBannerCopy({ ...offer, bannerHeadline: "Custom", bannerBody: "Body text", ctaLabel: "Go" })).toEqual({ headline: "Custom", body: "Body text", cta: "Go" });
  const priced = quote({ service: swedish, duration: 60, zone: { fee: 0 }, promotions: [offer], settings, locationType: "home" });
  expect(priced.discount).toBe(0);
  expect(priced.total).toBe(126);
});

test("trial campaign placement toggles are independent of sold-out and kind", () => {
  const trial = { id: "cmp-1", offerKind: "trial", showHome: true, showOffers: true, soldOut: false };
  expect(trialCampaignListed(trial, "home")).toBe(true);
  expect(trialCampaignListed(trial, "offers")).toBe(true);
  expect(trialCampaignListed({ ...trial, showHome: false }, "home")).toBe(false);
  expect(trialCampaignListed({ ...trial, showOffers: false }, "offers")).toBe(false);
  expect(trialCampaignListed({ ...trial, soldOut: true }, "home")).toBe(false);
  expect(trialCampaignListed({ ...trial, offerKind: "percent" }, "home")).toBe(false);
});

test("a listed welcome offer does not stack in the local estimate", () => {
  const extra = { ...offer, id: "promo-extra", eligibility: "birthday_month", type: "fixed", value: 15, stackable: true, approval: "approved", enabled: true };
  const priced = quote({
    service: swedish, duration: 60, zone: { fee: 0 }, client: null, promotions: [offer, extra], settings, locationType: "home",
  });
  expect(priced.discount).toBe(0);
});

test("trial local quotes stay at zero including travel for home visits", () => {
  const trial = { slug: "ten-minutes-on-us", kind: "trial", prices: { 10: 0 } };
  const priced = quote({
    service: trial, duration: 10, zone: { fee: 15, perKm: 1 }, km: 8, promotions: [offer], settings, locationType: "home",
  });
  expect(priced.base).toBe(0);
  expect(priced.travel).toBe(0);
  expect(priced.total).toBe(0);
});
