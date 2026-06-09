import { motion } from "framer-motion";
import { Sun, Moon, Timer, UserCheck, UserX, UserCog } from "lucide-react";
import { useMemo } from "react";
import { useShift, useNow, formatRemaining } from "@/contexts/ShiftContext";

/**
 * Visual shift status card shown on the Director dashboard alongside the
 * other diagrams. Reads the same shared shift session that admin started.
 */
export function DirectorShiftPanel() {
  const { session } = useShift();
  const now = useNow();

  const remaining = useMemo(() => {
    if (!session) return 0;
    return new Date(session.endISO).getTime() - now.getTime();
  }, [session, now]);

  const elapsedPct = useMemo(() => {
    if (!session) return 0;
    const start = new Date(session.startISO).getTime();
    const end = new Date(session.endISO).getTime();
    const total = end - start;
    if (total <= 0) return 0;
    const elapsed = Math.min(total, Math.max(0, now.getTime() - start));
    return Math.round((elapsed / total) * 100);
  }, [session, now]);

  const isDay = session?.kind === "day";
  const ShiftIcon = isDay ? Sun : Moon;
  const isSubstitute = !!session?.coveringFor;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
    >
      <div
        className={`px-5 py-4 flex items-center justify-between border-b border-border ${
          session
            ? isDay
              ? "bg-gradient-to-r from-amber-50 to-amber-100/60"
              : "bg-gradient-to-r from-indigo-50 to-indigo-100/60"
            : "bg-muted/40"
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${
              session
                ? isDay
                  ? "bg-amber-200/70 text-amber-700"
                  : "bg-indigo-200/70 text-indigo-700"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {session ? <ShiftIcon className="h-5 w-5" /> : <UserX className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              Текущая смена
            </p>
            <h3 className="font-display text-lg font-black tracking-tight text-foreground">
              {session ? (isDay ? "Дневная смена" : "Ночная смена") : "Никого нет на смене"}
            </h3>
          </div>
        </div>
        {session && (
          <div className="text-right">
            <p className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">Окно</p>
            <p className="text-sm font-bold tabular-nums">
              {isDay ? "06:00 → 18:00" : "18:00 → 06:00"}
            </p>
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        {session ? (
          <>
            {isSubstitute && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <UserCog className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-amber-800">
                    Substitute — covering for{" "}
                    <span className="font-black">{session.coveringFor}</span>
                  </p>
                  {session.reason && (
                    <p className="mt-0.5 text-[11px] text-amber-700 italic break-words">
                      Reason: {session.reason}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label={isSubstitute ? "Substitute" : "На смене"}
                value={session.name}
                Icon={UserCheck}
                tone="hsl(142 71% 45%)"
              />
              <Stat
                label="Осталось"
                value={formatRemaining(remaining)}
                Icon={Timer}
                tone={isDay ? "hsl(38 92% 50%)" : "hsl(245 70% 55%)"}
                mono
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                  Прогресс смены
                </span>
                <span className="text-xs font-bold tabular-nums">{elapsedPct}%</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${elapsedPct}%` }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  className={`h-full rounded-full ${
                    isDay
                      ? "bg-gradient-to-r from-amber-400 to-orange-400"
                      : "bg-gradient-to-r from-indigo-400 to-violet-500"
                  }`}
                />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Администратор ещё не открыл смену. Когда администратор войдёт в систему и начнёт смену, имя сменщика и таймер появятся здесь автоматически.
          </p>
        )}
      </div>
    </motion.div>
  );
}

function Stat({
  label,
  value,
  Icon,
  tone,
  mono,
}: {
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center gap-2 mb-1">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: `color-mix(in oklab, ${tone} 18%, transparent)`, color: tone }}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
      </div>
      <p className={`text-base font-black text-foreground truncate ${mono ? "tabular-nums" : ""}`}>
        {value}
      </p>
    </div>
  );
}
