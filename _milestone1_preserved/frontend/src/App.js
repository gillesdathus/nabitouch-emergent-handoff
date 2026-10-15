import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import { PreviewProvider } from "@/store/PreviewStore";
import { PreviewBar, PublicShell, StaffShell } from "@/components/shells";
import { AppointmentHost } from "@/components/AppointmentSheet";
import { ProfileHost } from "@/components/Profiles";
import { NewBookingHost } from "@/components/NewBookingSheet";
import Home, { Contact } from "@/pages/public/Home";
import Services, { ServiceDetail } from "@/pages/public/Services";
import Practitioners, { PractitionerPublic } from "@/pages/public/Practitioners";
import Book from "@/pages/public/Book";
import Offers from "@/pages/public/Offers";
import Track from "@/pages/public/Track";
import Login, { Welcome } from "@/pages/public/Login";
import Me from "@/pages/client/Me";
import Intake from "@/pages/client/Intake";
import Gallery from "@/pages/pro/Gallery";
import NativeNav from "@/pages/pro/NativeNav";
import Dashboard from "@/pages/owner/Dashboard";
import Schedule from "@/pages/owner/Schedule";
import Manage from "@/pages/owner/Manage";
import Invoices from "@/pages/owner/Invoices";
import Fleet from "@/pages/owner/Fleet";
import Zones from "@/pages/owner/Zones";
import Campaigns from "@/pages/owner/Campaigns";
import Promotions from "@/pages/owner/Promotions";
import Credentials from "@/pages/owner/Credentials";
import Training from "@/pages/owner/Training";
import Permissions, { Insights } from "@/pages/owner/Permissions";
import Today from "@/pages/pro/Today";
import Visit from "@/pages/pro/Visit";
import Soap from "@/pages/pro/Soap";
import RoutePage from "@/pages/pro/Route";
import Hours from "@/pages/pro/Hours";
import ProMe, { Recovery } from "@/pages/pro/ProMe";
import Desk from "@/pages/desk/Desk";
import DeskClients, { DeskMore } from "@/pages/desk/DeskClients";
import Notifications, { Settings } from "@/pages/shared/Account";
import TrainWorkspace from "@/pages/train/TrainWorkspace";

const shared = (
  <>
    <Route path="notifications" element={<Notifications />} />
    <Route path="settings" element={<Settings />} />
  </>
);

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <PreviewProvider>
        <BrowserRouter>
          <PreviewBar />
          <Routes>
            <Route element={<PublicShell />}>
              <Route path="/" element={<Home />} />
              <Route path="/services" element={<Services />} />
              <Route path="/services/:slug" element={<ServiceDetail />} />
              <Route path="/practitioners" element={<Practitioners />} />
              <Route path="/practitioners/:slug" element={<PractitionerPublic />} />
              <Route path="/book" element={<Book />} />
              <Route path="/offers" element={<Offers />} />
              <Route path="/track" element={<Track />} />
              <Route path="/track/:token" element={<Track />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/me" element={<Me />} />
              <Route path="/me/settings" element={<Settings />} />
              <Route path="/me/intake" element={<Intake />} />
              <Route path="/me/notifications" element={<Notifications />} />
            </Route>
            <Route path="/login" element={<Login />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/owner" element={<StaffShell role="owner" />}>
              <Route index element={<Dashboard />} />
              <Route path="schedule" element={<Schedule />} />
              <Route path="manage" element={<Manage />} />
              <Route path="payments" element={<Invoices />} />
              <Route path="dispatch" element={<Fleet />} />
              <Route path="zones" element={<Zones />} />
              <Route path="campaigns" element={<Campaigns />} />
              <Route path="promos" element={<Promotions />} />
              <Route path="rewards" element={<Promotions />} />
              <Route path="credentials" element={<Credentials />} />
              <Route path="training" element={<Training />} />
              <Route path="permissions" element={<Permissions />} />
              <Route path="insights" element={<Insights />} />
              <Route path="availability" element={<Hours owner />} />
              <Route path="routes" element={<RoutePage />} />
              <Route path="recovery" element={<Recovery />} />
              {shared}
            </Route>
            <Route path="/pro" element={<StaffShell role="pro" />}>
              <Route index element={<Today />} />
              <Route path="visit/:id" element={<Visit />} />
              <Route path="visit/:id/native" element={<NativeNav />} />
              <Route path="gallery" element={<Gallery />} />
              <Route path="soap/:id" element={<Soap />} />
              <Route path="route" element={<RoutePage />} />
              <Route path="availability" element={<Hours />} />
              <Route path="me" element={<ProMe />} />
              <Route path="recovery" element={<Recovery />} />
              {shared}
            </Route>
            <Route path="/desk" element={<StaffShell role="desk" />}>
              <Route index element={<Desk />} />
              <Route path="dispatch" element={<Fleet />} />
              <Route path="clients" element={<DeskClients />} />
              <Route path="more" element={<DeskMore />} />
              {shared}
            </Route>
            <Route path="/train" element={<TrainWorkspace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <AppointmentHost />
          <ProfileHost />
          <NewBookingHost />
          <Toaster position="top-center" offset={44} toastOptions={{ className: "!rounded-2xl !font-sans" }} />
        </BrowserRouter>
      </PreviewProvider>
    </MotionConfig>
  );
}

export default App;
