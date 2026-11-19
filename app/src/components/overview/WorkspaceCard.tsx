import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function WorkspaceCard({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="workspace-card">
      <header className="workspace-card-header">
        <h2>
          <span className="workspace-card-icon">
            <Icon size={16} />
          </span>
          {title}
        </h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
