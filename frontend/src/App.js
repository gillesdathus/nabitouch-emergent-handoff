import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/sonner";
import { DemoProvider, useDemo } from "@/store/DemoStore";
import { OfflineNotice } from "@/components/RoleBar";
import { Splash } from "@/components/Splash";
import { ClientShell, StaffShell } from "@/components/shells";
import { PractitionerErrorBoundary } from "@/components/PractitionerRouteGuard";
import { PageSkeleton } from "@/components/ui-kit";
import { AppErrorBoundary, installChunkRecovery } from "@/components/AppErrorBoundary";
import { PwaUpdateBanner } from "@/components/PwaUpdateBanner";
import { useVisualViewportInset } from "@/lib/viewport";

installChunkRecovery();

function VisualViewportSync() {
  useVisualViewportInset();
  return null;
}

const Login = lazy(() => import("@/pages/Login"));
const PaymentResult = lazy(() => import("@/pages/client/PaymentResult"));
const Join = lazy(() => import("@/pages/Join"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const AccountSecurity = lazy(() => import("@/pages/AccountSecurity"));
const Home = lazy(() => import("@/pages/client/Home"));
const Services = lazy(() => import("@/pages/client/Services"));
const Practitioners = lazy(() => import("@/pages/client/Practitioners"));
const PractitionerProfile = lazy(() => import("@/pages/client/PractitionerProfile"));
const StaffPractitionerProfile = lazy(() => import("@/pages/staff/PractitionerProfile"));
const OwnerPractitioners = lazy(() => import("@/pages/owner/Practitioners"));
const Contact = lazy(() => import("@/pages/client/Contact"));
const GuestTrack = lazy(() => import("@/pages/client/GuestTrack"));
const Welcome = lazy(() => import("@/pages/client/Welcome"));
const ServiceDetail = lazy(() => import("@/pages/client/ServiceDetail"));
const Booking = lazy(() => import("@/pages/client/Booking"));
const Me = lazy(() => import("@/pages/client/Me"));
const ProfileForm = lazy(() => import("@/pages/client/ProfileForm"));
const InsurancePage = lazy(() => import("@/pages/client/InsurancePage"));
const Intake = lazy(() => import("@/pages/client/Intake"));
const SessionPrep = lazy(() => import("@/pages/client/SessionPrep"));
const TrackVisit = lazy(() => import("@/pages/client/TrackVisit"));
const OwnerTurnaround = lazy(() => import("@/pages/owner/Turnaround"));
const ClientReviews = lazy(() => import("@/pages/client/Reviews"));
const OwnerFeedback = lazy(() => import("@/pages/owner/Feedback"));
const ProClientRatings = lazy(() => import("@/pages/practitioner/ClientRatings"));
const ClientBilling = lazy(() => import("@/pages/client/Billing"));
const ClientGiftCards = lazy(() => import("@/pages/client/GiftCards"));
const ClientPlans = lazy(() => import("@/pages/client/Plans"));
const OwnerPlans = lazy(() => import("@/pages/owner/Plans"));
const OwnerChannels = lazy(() => import("@/pages/owner/Channels"));
const OwnerWinback = lazy(() => import("@/pages/owner/Winback"));
const SafetyAlerts = lazy(() => import("@/pages/owner/Safety"));
const OwnerFleet = lazy(() => import("@/pages/owner/Fleet"));
const OwnerFleetNew = lazy(() => import("@/pages/owner/Fleet").then((m) => ({ default: m.FleetNew })));
const OwnerFleetDetail = lazy(() => import("@/pages/owner/Fleet").then((m) => ({ default: m.FleetDetail })));
const OwnerSecurityShield = lazy(() => import("@/pages/owner/SecurityShield"));
const OwnerShieldVisits = lazy(() => import("@/pages/owner/SecurityShield").then((m) => ({ default: m.ShieldVisitsPage })));
const OwnerShieldRenewals = lazy(() => import("@/pages/owner/SecurityShield").then((m) => ({ default: m.ShieldRenewalsPage })));
const OwnerDriverCredentials = lazy(() => import("@/pages/owner/DriverCredentials"));
const OwnerVisitTimeline = lazy(() => import("@/pages/owner/VisitTimeline"));
const ProMyVehicle = lazy(() => import("@/pages/practitioner/MyVehicle"));
const ProShieldDocs = lazy(() => import("@/pages/practitioner/ShieldDocs"));
const GiftCardsAdmin = lazy(() => import("@/pages/owner/GiftCards"));
const ClientWorkspace = lazy(() => import("@/pages/staff/ClientWorkspace"));
const OwnerReports = lazy(() => import("@/pages/owner/Reports"));
const ProEarnings = lazy(() => import("@/pages/practitioner/Earnings"));
const ProToday = lazy(() => import("@/pages/practitioner/Today"));
const ProVisit = lazy(() => import("@/pages/practitioner/Visit"));
const NativeNav = lazy(() => import("@/pages/practitioner/NativeNav"));
const ProSoap = lazy(() => import("@/pages/practitioner/Soap"));
const ProPlans = lazy(() => import("@/pages/practitioner/Plans"));
const ProAvailability = lazy(() => import("@/pages/practitioner/Availability"));
const ProRoute = lazy(() => import("@/pages/practitioner/DailyRoute"));
const ProMessages = lazy(() => import("@/pages/practitioner/Messages"));
const ProRecovery = lazy(() => import("@/pages/practitioner/Recovery"));
const OwnerCampaigns = lazy(() => import("@/pages/owner/Campaigns"));
const TrainingCenter = lazy(() => import("@/pages/owner/TrainingCenter"));
const TrainingWorkspace = lazy(() => import("@/pages/training/Workspace"));
const OwnerRewards = lazy(() => import("@/pages/owner/RewardsAdmin"));
const ClientOffers = lazy(() => import("@/pages/client/Offers"));
const ClientRewards = lazy(() => import("@/pages/client/Rewards"));
const OwnerDash = lazy(() => import("@/pages/owner/Dashboard"));
const OwnerSchedule = lazy(() => import("@/pages/owner/Schedule"));
const Dispatch = lazy(() => import("@/pages/ops/Dispatch"));
const Manage = lazy(() => import("@/pages/owner/Manage"));
const Promos = lazy(() => import("@/pages/owner/Promos"));
const OwnerMarketing = lazy(() => import("@/pages/owner/Marketing"));
const Zones = lazy(() => import("@/pages/owner/Zones"));
const Insights = lazy(() => import("@/pages/owner/Insights"));
const Permissions = lazy(() => import("@/pages/owner/Permissions"));
const Payments = lazy(() => import("@/pages/owner/Payments"));
const EClaims = lazy(() => import("@/pages/owner/EClaims"));
const Credentials = lazy(() => import("@/pages/owner/Credentials"));
const LegacyClients = lazy(() => import("@/pages/owner/LegacyClients"));
const ClientDuplicates = lazy(() => import("@/pages/owner/ClientDuplicates"));
const ClientMergePreview = lazy(() => import("@/pages/owner/ClientMergePreview"));
const Desk = lazy(() => import("@/pages/reception/Desk"));
const StaffClients = lazy(() => import("@/pages/staff/Clients"));
const Verify = lazy(() => import("@/pages/reception/Verify"));
const Messages = lazy(() => import("@/pages/reception/Messages"));
const Thread = lazy(() => import("@/pages/messages/Thread"));
const TeamHome = lazy(() => import("@/pages/team/TeamHome"));
const TeamMessages = lazy(() => import("@/pages/team/TeamMessages"));
const TeamThread = lazy(() => import("@/pages/team/TeamThread"));
const TeamHelp = lazy(() => import("@/pages/team/TeamHelp"));
const TeamRequests = lazy(() => import("@/pages/team/TeamRequests"));
const TeamRequestDetail = lazy(() => import("@/pages/team/TeamRequestDetail"));
const TeamSupplies = lazy(() => import("@/pages/team/TeamSupplies"));
const TeamClientComms = lazy(() => import("@/pages/team/TeamClientComms"));

function Gate({ children }) {
  const { state, error, user } = useDemo();
  if (!state || user === undefined) return <PageSkeleton error={error} />;
  return children;
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <DemoProvider>
        <BrowserRouter>
          <VisualViewportSync />
          <Splash />
          <OfflineNotice />
          <Gate>
            <AppErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route element={<ClientShell />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/join" element={<Join />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/account/security" element={<AccountSecurity />} />
                  <Route path="/services" element={<Services />} />
                  <Route path="/practitioners" element={<Practitioners />} />
                  <Route path="/practitioners/:slug" element={<PractitionerProfile />} />
                  <Route path="/contact" element={<Contact />} />
                  <Route path="/track" element={<GuestTrack />} />
                  <Route path="/welcome" element={<Welcome />} />
                  <Route path="/track/:token" element={<GuestTrack />} />
                  <Route path="/services/:slug" element={<ServiceDetail />} />
                  <Route path="/book" element={<Booking />} />
                  <Route path="/offers" element={<ClientOffers />} />
                  <Route path="/me" element={<Me />} />
                  <Route path="/me/rewards" element={<ClientRewards />} />
                  <Route path="/me/profile" element={<ProfileForm />} />
                  <Route path="/me/intake" element={<Intake />} />
                  <Route path="/me/visit/:id/prepare" element={<SessionPrep />} />
                  <Route path="/me/visit/:id/track" element={<TrackVisit />} />
                  <Route path="/me/reviews" element={<ClientReviews />} />
                  <Route path="/me/insurance" element={<InsurancePage />} />
                  <Route path="/me/billing" element={<ClientBilling />} />
                  <Route path="/me/billing/payment-result" element={<PaymentResult />} />
                  <Route path="/me/gifts" element={<ClientGiftCards />} />
                  <Route path="/me/plans" element={<ClientPlans />} />
                  <Route path="/me/messages/:id" element={<Thread viewerRole="client" backTo="/me" />} />
                </Route>
                <Route element={<StaffShell role="pro" />}>
                  <Route element={<PractitionerErrorBoundary />}>
                    <Route path="/pro" element={<ProToday />} />
                    <Route path="/pro/profile" element={<StaffPractitionerProfile self />} />
                    <Route path="/pro/visit/:id" element={<ProVisit />} />
                    <Route path="/pro/visit/:id/messages" element={<Thread viewerRole="practitioner" />} />
                    <Route path="/pro/visit/:id/native" element={<NativeNav />} />
                    <Route path="/pro/soap/:id" element={<ProSoap />} />
                    <Route path="/pro/plans" element={<ProPlans />} />
                    <Route path="/pro/earnings" element={<ProEarnings />} />
                    <Route path="/pro/ratings" element={<ProClientRatings />} />
                    <Route path="/pro/availability" element={<ProAvailability mode="pro" />} />
                    <Route path="/pro/schedule" element={<Navigate to="/pro/availability" replace />} />
                    <Route path="/pro/hours" element={<Navigate to="/pro/availability" replace />} />
                    <Route path="/pro/messages" element={<ProMessages />} />
                    <Route path="/pro/team" element={<TeamHome role="pro" />} />
                    <Route path="/pro/team/messages" element={<TeamMessages role="pro" />} />
                    <Route path="/pro/team/messages/:threadId" element={<TeamThread role="pro" />} />
                    <Route path="/pro/team/help" element={<TeamHelp role="pro" />} />
                    <Route path="/pro/team/requests" element={<TeamRequests role="pro" />} />
                    <Route path="/pro/team/requests/:requestId" element={<TeamRequestDetail role="pro" />} />
                    <Route path="/pro/team/supplies" element={<TeamSupplies role="pro" />} />
                    <Route path="/pro/route" element={<ProRoute mode="pro" />} />
                    <Route path="/pro/recovery" element={<ProRecovery />} />
                    <Route path="/pro/vehicle" element={<ProMyVehicle />} />
                    <Route path="/pro/shield" element={<ProShieldDocs />} />
                  </Route>
                </Route>
                <Route element={<StaffShell role="owner" />}>
                  <Route path="/owner" element={<OwnerDash />} />
                  <Route path="/owner/schedule" element={<OwnerSchedule />} />
                  <Route path="/owner/dispatch" element={<Dispatch role="owner" />} />
                  <Route path="/owner/turnaround" element={<OwnerTurnaround />} />
                  <Route path="/owner/feedback" element={<OwnerFeedback />} />
                  <Route path="/owner/messages" element={<Messages />} />
                  <Route path="/owner/manage" element={<Manage />} />
                  <Route path="/owner/promos" element={<Promos />} />
                  <Route path="/owner/marketing" element={<OwnerMarketing />} />
                  <Route path="/owner/giftcards" element={<GiftCardsAdmin />} />
                  <Route path="/owner/plans" element={<OwnerPlans />} />
                  <Route path="/owner/safety" element={<SafetyAlerts />} />
                  <Route path="/owner/fleet" element={<OwnerFleet />} />
                  <Route path="/owner/fleet/new" element={<OwnerFleetNew />} />
                  <Route path="/owner/fleet/:id" element={<OwnerFleetDetail />} />
                  <Route path="/owner/shield" element={<OwnerSecurityShield />} />
                  <Route path="/owner/shield/drivers" element={<OwnerDriverCredentials />} />
                  <Route path="/owner/shield/renewals" element={<OwnerShieldRenewals />} />
                  <Route path="/owner/shield/visits" element={<OwnerShieldVisits />} />
                  <Route path="/owner/shield/timeline/:id" element={<OwnerVisitTimeline />} />
                  <Route path="/owner/winback" element={<OwnerWinback />} />
                  <Route path="/owner/channels" element={<OwnerChannels />} />
                  <Route path="/owner/clients" element={<StaffClients role="owner" />} />
                  <Route path="/owner/clients/duplicates" element={<ClientDuplicates />} />
                  <Route path="/owner/clients/duplicates/:pairId/preview" element={<ClientMergePreview />} />
                  <Route path="/owner/practitioners" element={<OwnerPractitioners />} />
                  <Route path="/owner/practitioners/:id" element={<StaffPractitionerProfile />} />
                  <Route path="/owner/clients/:id" element={<ClientWorkspace />} />
                  <Route path="/owner/campaigns" element={<OwnerCampaigns />} />
                  <Route path="/owner/training" element={<TrainingCenter />} />
                  <Route path="/owner/rewards" element={<OwnerRewards />} />
                  <Route path="/owner/zones" element={<Zones />} />
                  <Route path="/owner/insights" element={<Insights />} />
                  <Route path="/owner/reports" element={<OwnerReports />} />
                  <Route path="/owner/permissions" element={<Permissions />} />
                  <Route path="/owner/payments" element={<Payments />} />
                  <Route path="/owner/eclaims" element={<EClaims role="owner" />} />
                  <Route path="/owner/credentials" element={<Credentials />} />
                  <Route path="/owner/patients/invitations" element={<LegacyClients />} />
                  <Route path="/owner/legacy" element={<LegacyClients />} />
                  <Route path="/owner/availability" element={<ProAvailability mode="owner" />} />
                  <Route path="/owner/routes" element={<ProRoute mode="owner" />} />
                  <Route path="/owner/recovery" element={<ProRecovery />} />
                  <Route path="/owner/team" element={<TeamHome role="owner" />} />
                  <Route path="/owner/team/messages" element={<TeamMessages role="owner" />} />
                  <Route path="/owner/team/messages/:threadId" element={<TeamThread role="owner" />} />
                  <Route path="/owner/team/help" element={<TeamHelp role="owner" />} />
                  <Route path="/owner/team/requests" element={<TeamRequests role="owner" />} />
                  <Route path="/owner/team/requests/:requestId" element={<TeamRequestDetail role="owner" />} />
                  <Route path="/owner/team/supplies" element={<TeamSupplies role="owner" />} />
                  <Route path="/owner/team/client-comms" element={<TeamClientComms role="owner" />} />
                </Route>
                <Route element={<StaffShell role="desk" />}>
                  <Route path="/desk" element={<Desk />} />
                  <Route path="/desk/dispatch" element={<Dispatch role="desk" />} />
                  <Route path="/desk/clients" element={<StaffClients role="desk" />} />
                  <Route path="/desk/clients/:id" element={<ClientWorkspace />} />
                  <Route path="/desk/giftcards" element={<GiftCardsAdmin />} />
                  <Route path="/desk/verify" element={<Verify />} />
                  <Route path="/desk/eclaims" element={<EClaims role="desk" />} />
                  <Route path="/desk/messages" element={<Messages />} />
                  <Route path="/desk/safety" element={<SafetyAlerts />} />
                  <Route path="/desk/team" element={<TeamHome role="desk" />} />
                  <Route path="/desk/team/messages" element={<TeamMessages role="desk" />} />
                  <Route path="/desk/team/messages/:threadId" element={<TeamThread role="desk" />} />
                  <Route path="/desk/team/help" element={<TeamHelp role="desk" />} />
                  <Route path="/desk/team/requests" element={<TeamRequests role="desk" />} />
                  <Route path="/desk/team/requests/:requestId" element={<TeamRequestDetail role="desk" />} />
                  <Route path="/desk/team/supplies" element={<TeamSupplies role="desk" />} />
                  <Route path="/desk/team/client-comms" element={<TeamClientComms role="desk" />} />
                </Route>
                <Route path="/train" element={<TrainingWorkspace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            </AppErrorBoundary>
          </Gate>
          <PwaUpdateBanner />
          <Toaster position="bottom-right" richColors closeButton offset={{ bottom: "var(--nb-toast-offset)", right: "1.5rem" }} mobileOffset={{ bottom: "var(--nb-toast-offset)" }} />
        </BrowserRouter>
      </DemoProvider>
    </MotionConfig>
  );
}
