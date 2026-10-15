import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/sonner";
import { DemoProvider, useDemo } from "@/store/DemoStore";
import { OfflineNotice } from "@/components/RoleBar";
import { Splash } from "@/components/Splash";
import { ClientShell, StaffShell } from "@/components/shells";
import { PageSkeleton } from "@/components/ui-kit";

const Login = lazy(() => import("@/pages/Login"));
const Join = lazy(() => import("@/pages/Join"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Home = lazy(() => import("@/pages/client/Home"));
const Services = lazy(() => import("@/pages/client/Services"));
const Practitioners = lazy(() => import("@/pages/client/Practitioners"));
const PractitionerProfile = lazy(() => import("@/pages/client/PractitionerProfile"));
const ProProfile = lazy(() => import("@/pages/practitioner/Profile"));
const Contact = lazy(() => import("@/pages/client/Contact"));
const GuestTrack = lazy(() => import("@/pages/client/GuestTrack"));
const Welcome = lazy(() => import("@/pages/client/Welcome"));
const ServiceDetail = lazy(() => import("@/pages/client/ServiceDetail"));
const Booking = lazy(() => import("@/pages/client/Booking"));
const Me = lazy(() => import("@/pages/client/Me"));
const ProfileForm = lazy(() => import("@/pages/client/ProfileForm"));
const InsurancePage = lazy(() => import("@/pages/client/InsurancePage"));
const Intake = lazy(() => import("@/pages/client/Intake"));
const ClientBilling = lazy(() => import("@/pages/client/Billing"));
const ProToday = lazy(() => import("@/pages/practitioner/Today"));
const ProVisit = lazy(() => import("@/pages/practitioner/Visit"));
const NativeNav = lazy(() => import("@/pages/practitioner/NativeNav"));
const ProSoap = lazy(() => import("@/pages/practitioner/Soap"));
const ProPlans = lazy(() => import("@/pages/practitioner/Plans"));
const ProAvailability = lazy(() => import("@/pages/practitioner/Availability"));
const ProRoute = lazy(() => import("@/pages/practitioner/DailyRoute"));
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
const Zones = lazy(() => import("@/pages/owner/Zones"));
const Insights = lazy(() => import("@/pages/owner/Insights"));
const Permissions = lazy(() => import("@/pages/owner/Permissions"));
const Payments = lazy(() => import("@/pages/owner/Payments"));
const Credentials = lazy(() => import("@/pages/owner/Credentials"));
const LegacyClients = lazy(() => import("@/pages/owner/LegacyClients"));
const Desk = lazy(() => import("@/pages/reception/Desk"));
const DeskClients = lazy(() => import("@/pages/reception/Clients"));
const Verify = lazy(() => import("@/pages/reception/Verify"));
const Messages = lazy(() => import("@/pages/reception/Messages"));
const Thread = lazy(() => import("@/pages/messages/Thread"));

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
          <Splash />
          <OfflineNotice />
          <Gate>
            <Suspense fallback={<PageSkeleton />}>
              <Routes>
                <Route element={<ClientShell />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/join" element={<Join />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
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
                  <Route path="/me/insurance" element={<InsurancePage />} />
                  <Route path="/me/billing" element={<ClientBilling />} />
                  <Route path="/me/messages/:id" element={<Thread viewerRole="client" backTo="/me" />} />
                </Route>
                <Route element={<StaffShell role="pro" />}>
                  <Route path="/pro" element={<ProToday />} />
                  <Route path="/pro/profile" element={<ProProfile />} />
                  <Route path="/pro/visit/:id" element={<ProVisit />} />
                  <Route path="/pro/visit/:id/messages" element={<Thread viewerRole="practitioner" />} />
                  <Route path="/pro/visit/:id/native" element={<NativeNav />} />
                  <Route path="/pro/soap/:id" element={<ProSoap />} />
                  <Route path="/pro/plans" element={<ProPlans />} />
                  <Route path="/pro/availability" element={<ProAvailability mode="pro" />} />
                  <Route path="/pro/route" element={<ProRoute mode="pro" />} />
                  <Route path="/pro/recovery" element={<ProRecovery />} />
                </Route>
                <Route element={<StaffShell role="owner" />}>
                  <Route path="/owner" element={<OwnerDash />} />
                  <Route path="/owner/schedule" element={<OwnerSchedule />} />
                  <Route path="/owner/dispatch" element={<Dispatch role="owner" />} />
                  <Route path="/owner/messages" element={<Messages />} />
                  <Route path="/owner/manage" element={<Manage />} />
                  <Route path="/owner/promos" element={<Promos />} />
                  <Route path="/owner/campaigns" element={<OwnerCampaigns />} />
                  <Route path="/owner/training" element={<TrainingCenter />} />
                  <Route path="/owner/rewards" element={<OwnerRewards />} />
                  <Route path="/owner/zones" element={<Zones />} />
                  <Route path="/owner/insights" element={<Insights />} />
                  <Route path="/owner/permissions" element={<Permissions />} />
                  <Route path="/owner/payments" element={<Payments />} />
                  <Route path="/owner/credentials" element={<Credentials />} />
                  <Route path="/owner/legacy" element={<LegacyClients />} />
                  <Route path="/owner/availability" element={<ProAvailability mode="owner" />} />
                  <Route path="/owner/routes" element={<ProRoute mode="owner" />} />
                  <Route path="/owner/recovery" element={<ProRecovery />} />
                </Route>
                <Route element={<StaffShell role="desk" />}>
                  <Route path="/desk" element={<Desk />} />
                  <Route path="/desk/dispatch" element={<Dispatch role="desk" />} />
                  <Route path="/desk/clients" element={<DeskClients />} />
                  <Route path="/desk/verify" element={<Verify />} />
                  <Route path="/desk/messages" element={<Messages />} />
                </Route>
                <Route path="/train" element={<TrainingWorkspace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </Gate>
          <Toaster position="top-center" richColors closeButton />
        </BrowserRouter>
      </DemoProvider>
    </MotionConfig>
  );
}
