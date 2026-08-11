import { BookOpen, LogOut } from "lucide-react";
import { useState } from "react";

type SidebarUserProps = {
  user: { name: string; email: string };
};

export function SidebarUser({ user }: SidebarUserProps) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Sign out failed.");
      window.location.assign("/login");
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <div className="sidebar-user">
      <span>{user.name}</span>
      <small>{user.email}</small>
      <a href="/guide">
        <BookOpen size={14} /> Product guide
      </a>
      <button type="button" onClick={signOut} disabled={signingOut}>
        <LogOut size={14} /> {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
