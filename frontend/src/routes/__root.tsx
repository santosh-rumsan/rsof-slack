import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { AuthProvider, useAuth, LoginScreen } from "@/lib/auth";
import { LayoutDashboard, Users, BarChart2, LogOut, Activity, BookOpen } from "lucide-react";

function Layout() {
  const { authed, logout } = useAuth();
  if (!authed) return <LoginScreen />;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r bg-white">
        <div className="flex h-14 items-center px-4 font-bold text-brand text-lg border-b">
          rsof-slack
        </div>
        <nav className="flex flex-col gap-1 p-3 flex-1">
          <NavLink to="/" icon={<LayoutDashboard size={16} />} label="Dashboard" />
          <NavLink to="/users" icon={<Users size={16} />} label="Users" />
          <NavLink to="/reports" icon={<BarChart2 size={16} />} label="Reports" />
          <NavLink to="/activity" icon={<Activity size={16} />} label="Activity" />
          <NavLink to="/docs" icon={<BookOpen size={16} />} label="Docs" />
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
      <main className="flex flex-1 flex-col overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 [&.active]:bg-brand/10 [&.active]:text-brand [&.active]:font-medium"
    >
      {icon} {label}
    </Link>
  );
}

import React from "react";

export const Route = createRootRoute({
  component: () => (
    <AuthProvider>
      <Layout />
    </AuthProvider>
  ),
});
