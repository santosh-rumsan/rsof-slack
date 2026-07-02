import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PresenceProvider } from "@/lib/presence-context";
import { PresenceToaster } from "@/components/presence-toast";
import { LayoutDashboard, Users, BarChart2, LogOut, Activity, BookOpen, Radio, Settings, Menu, X } from "lucide-react";
import React, { useState } from "react";
import { hasRole } from "@/lib/api";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;

function Layout() {
  const { authed, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (!authed) return null; // AuthProvider renders LoginScreen when not authed

  function closeDrawer() {
    setMobileOpen(false);
  }

  return (
    <PresenceProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Mobile top bar */}
        <header className="sm:hidden fixed top-0 left-0 right-0 z-30 flex h-14 items-center gap-3 border-b bg-white px-4">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-gray-600 hover:text-gray-900"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2 font-bold text-brand text-lg">
            <img src="/slack.svg" alt="Slack" className="h-6 w-6" />
            Rumsan Slack
          </div>
        </header>

        {/* Mobile overlay backdrop */}
        {mobileOpen && (
          <div
            className="sm:hidden fixed inset-0 z-40 bg-black/40"
            onClick={closeDrawer}
          />
        )}

        {/* Sidebar — always visible on sm+; drawer on mobile */}
        <aside
          className={`fixed sm:static inset-y-0 left-0 z-50 flex w-64 sm:w-56 flex-col border-r bg-white transition-transform duration-200 ease-in-out
            ${mobileOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0"}`}
        >
          <div className="flex h-14 items-center justify-between gap-2 px-4 font-bold text-brand text-lg border-b">
            <div className="flex items-center gap-2">
              <img src="/slack.svg" alt="Slack" className="h-6 w-6" />
              Rumsan Slack
            </div>
            <button
              onClick={closeDrawer}
              className="sm:hidden text-gray-400 hover:text-gray-600"
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          </div>
          <nav className="flex flex-col gap-1 p-3 flex-1">
            <NavLink to="/" icon={<LayoutDashboard size={16} />} label="Dashboard" onClick={closeDrawer} />
            <NavLink to="/presence" icon={<Radio size={16} />} label="Presence" onClick={closeDrawer} />
            <NavLink to="/users" icon={<Users size={16} />} label="Users" onClick={closeDrawer} />
            <NavLink to="/reports" icon={<BarChart2 size={16} />} label="Reports" onClick={closeDrawer} />
            <NavLink to="/activity" icon={<Activity size={16} />} label="Activity" onClick={closeDrawer} />
            <NavLink to="/docs" icon={<BookOpen size={16} />} label="Docs" onClick={closeDrawer} />
            {hasRole("app_admin") && (
              <NavLink to="/settings" icon={<Settings size={16} />} label="Settings" onClick={closeDrawer} />
            )}
          </nav>
          <div className="border-t p-3">
            <button
              onClick={logout}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100"
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="flex flex-1 flex-col overflow-auto pt-14 sm:pt-0">
          <Outlet />
        </main>
      </div>
      <PresenceToaster />
    </PresenceProvider>
  );
}

function NavLink({ to, icon, label, onClick }: { to: string; icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 [&.active]:bg-brand/10 [&.active]:text-brand [&.active]:font-medium"
    >
      {icon} {label}
    </Link>
  );
}

export const Route = createRootRoute({
  component: () => (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <Layout />
      </AuthProvider>
    </GoogleOAuthProvider>
  ),
});
