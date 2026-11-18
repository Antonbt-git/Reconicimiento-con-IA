import { lazy, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Shell, { LoginPage, canAccess } from "./layout/Shell";
import { useCurrentUser } from "../shared/hooks/useDb";
import DashboardPage from "../modules/dashboard/pages/DashboardPage";

const AnalysisPage = lazy(() => import("../modules/analysis/pages/AnalysisPage"));
const LivePage = lazy(() => import("../modules/streaming/pages/LivePage"));
const ScenariosPage = lazy(() => import("../modules/scenarios/pages/ScenariosPage"));
const PersonsPage = lazy(() => import("../modules/persons/pages/PersonsPage"));
const AlertsPage = lazy(() => import("../modules/alerts/pages/AlertsPage"));
const HistoryPage = lazy(() => import("../modules/history/pages/HistoryPage"));
const NotificationsPage = lazy(() => import("../modules/settings/pages/NotificationsPage"));
const RulesZonesPage = lazy(() => import("../modules/settings/pages/RulesZonesPage"));
const Vision = {
  Detections: lazy(() => import("../modules/detections/pages/VisionPages").then((m) => ({ default: m.DetectionsPage }))),
  Segmentation: lazy(() => import("../modules/detections/pages/VisionPages").then((m) => ({ default: m.SegmentationPage }))),
  Patterns: lazy(() => import("../modules/detections/pages/VisionPages").then((m) => ({ default: m.PatternsPage }))),
};
const Admin = {
  Settings: lazy(() => import("../modules/settings/pages/AdminPages").then((m) => ({ default: m.SettingsPage }))),
  Classes: lazy(() => import("../modules/settings/pages/AdminPages").then((m) => ({ default: m.ClassesPage }))),
  Users: lazy(() => import("../modules/settings/pages/AdminPages").then((m) => ({ default: m.UsersPage }))),
  Audit: lazy(() => import("../modules/settings/pages/AdminPages").then((m) => ({ default: m.AuditPage }))),
  Exports: lazy(() => import("../modules/settings/pages/AdminPages").then((m) => ({ default: m.ExportsPage }))),
};

/** Protección de rutas por rol. */
function Guard({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const loc = useLocation();
  if (!user) return <LoginPage />;
  if (!canAccess(loc.pathname, user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<GuardShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="analysis" element={<AnalysisPage />} />
          <Route path="live" element={<LivePage />} />
          <Route path="scenarios" element={<ScenariosPage />} />
          <Route path="vision/detections" element={<Vision.Detections />} />
          <Route path="vision/segmentation" element={<Vision.Segmentation />} />
          <Route path="vision/patterns" element={<Vision.Patterns />} />
          <Route path="persons" element={<PersonsPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="exports" element={<Admin.Exports />} />
          <Route path="admin/notifications" element={<NotificationsPage />} />
          <Route path="admin/rules" element={<RulesZonesPage />} />
          <Route path="admin/classes" element={<Admin.Classes />} />
          <Route path="admin/users" element={<Admin.Users />} />
          <Route path="admin/settings" element={<Admin.Settings />} />
          <Route path="admin/audit" element={<Admin.Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

function GuardShell() {
  return (
    <Guard>
      <Shell />
    </Guard>
  );
}
