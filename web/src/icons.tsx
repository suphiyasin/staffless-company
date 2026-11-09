import { Briefcase, Code2, Palette, PenLine, ShieldCheck, UserSearch, type LucideIcon } from "lucide-react";
import { DEPARTMENTS, ROLES } from "../../server/company/org.ts";
import type { DepartmentId, FeedChannel, RoleId } from "../../server/types.ts";

export const DEPT_ICON: Record<DepartmentId, LucideIcon> = {
  management: Briefcase,
  design: Palette,
  content: PenLine,
  software: Code2,
  qa: ShieldCheck,
  "ai-resources": UserSearch,
};

export const deptColor = (id: DepartmentId) => DEPARTMENTS.find((d) => d.id === id)!.color;

export function channelLabel(ch: FeedChannel): string {
  if (ch === "boss") return "Management";
  if (ch === "ai-resources") return "AI Resources";
  return `${DEPARTMENTS.find((x) => x.id === ch)!.name.en} team`;
}

/** Quiet avatar: neutral circle with the department icon in its colour. */
export function RoleAvatar({ roleId, size = 28 }: { roleId?: RoleId; size?: number }) {
  const r = roleId ? ROLES.find((x) => x.id === roleId) : undefined;
  const Icon = r ? DEPT_ICON[r.department] : Briefcase;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, color: r ? deptColor(r.department) : undefined } as React.CSSProperties}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={1.9} />
    </span>
  );
}
