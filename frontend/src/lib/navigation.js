export const PUBLIC_NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/services", label: "Services" },
  { to: "/practitioners", label: "Practitioners" },
  { to: "/offers", label: "Offers" },
  { to: "/contact", label: "Contact" },
  { to: "/me", label: "My Nabitouch" },
];

export const BOTTOM_NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/services", label: "Services" },
  { to: "/book", label: "Book", primary: true },
  { to: "/offers", label: "Offers" },
  { to: "/me", label: "My Nabitouch", short: "Account" },
];

const ROLE_BUTTONS = ["Owner", "Client", "Practitioner", "Receptionist", "Reception"];

export function publicNavHasRoleButtons() {
  return [...PUBLIC_NAV, ...BOTTOM_NAV].some((item) => ROLE_BUTTONS.includes(item.label));
}

export function showsMarketingFooter(pathname) {
  return pathname === "/" || pathname === "/services" || pathname === "/practitioners" || pathname === "/offers" || pathname === "/contact" || pathname.startsWith("/services/");
}

/**
 * Focused client chrome: hide marketing header + bottom dock.
 * Used for booking and the health-history wizard so in-flow CTAs are not competing with FloatingNav.
 */
export function showsFocusedBookingChrome(pathname) {
  if (pathname === "/book" || pathname.startsWith("/book/")) return true;
  if (pathname === "/me/intake" || pathname.startsWith("/me/intake/")) return true;
  return false;
}
