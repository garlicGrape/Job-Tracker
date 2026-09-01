import type { JobStatus } from "./api";

export const STATUS_META: Record<
  JobStatus,
  { badge: string; dot: string; accent: string }
> = {
  Wishlist: {
    badge: "bg-slate-100 text-slate-700 ring-slate-200",
    dot: "bg-slate-400",
    accent: "text-slate-600",
  },
  Applied: {
    badge: "bg-blue-100 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
    accent: "text-blue-600",
  },
  Interviewing: {
    badge: "bg-amber-100 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
    accent: "text-amber-600",
  },
  Offer: {
    badge: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
    accent: "text-emerald-600",
  },
  Rejected: {
    badge: "bg-rose-100 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
    accent: "text-rose-600",
  },
};
