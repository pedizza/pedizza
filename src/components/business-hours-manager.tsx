"use client";

import { useEffect, useState } from "react";
import { Clock3, Pencil } from "lucide-react";
import { ResponsiveModal } from "./ui/modal";

const dayNames = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
const dayOrder = [1, 2, 3, 4, 5, 6, 0];

type DaySchedule = {
  day_of_week: number;
  enabled: boolean;
  start_time: string;
  end_time: string;
};

const emptyWeek = (): DaySchedule[] =>
  dayNames.map((_, day) => ({
    day_of_week: day,
    enabled: false,
    start_time: "18:00",
    end_time: "23:00",
  }));

export function BusinessHoursManager({ canEdit }: { canEdit: boolean }) {
  const [week, setWeek] = useState<DaySchedule[]>(emptyWeek),
    [draft, setDraft] = useState<DaySchedule[]>(emptyWeek),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/data/horarios?page=1", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        const next = emptyWeek();
        for (const row of body.data || []) {
          const day = Number(row.day_of_week);
          if (day < 0 || day > 6 || next[day].enabled) continue;
          next[day] = {
            day_of_week: day,
            enabled: true,
            start_time: String(row.start_time).slice(0, 5),
            end_time: String(row.end_time).slice(0, 5),
          };
        }
        setWeek(next);
        setDraft(next.map((day) => ({ ...day })));
      })
      .catch((reason) => {
        if (reason instanceof Error && reason.name !== "AbortError")
          setError(reason.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  function update(day: number, patch: Partial<DaySchedule>) {
    setDraft((current) =>
      current.map((item) =>
        item.day_of_week === day ? { ...item, ...patch } : item,
      ),
    );
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const hours = draft
        .filter((day) => day.enabled)
        .map(({ day_of_week, start_time, end_time }) => ({
          day_of_week,
          start_time,
          end_time,
        }));
      const response = await fetch("/api/data/horarios", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      const saved = draft.map((day) => ({ ...day }));
      setWeek(saved);
      setOpen(false);
      setToast("Horários atualizados.");
      window.setTimeout(() => setToast(""), 4000);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível salvar os horários.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack">
      <div className="toolbar">
        <div>
          <h2 style={{ marginBottom: 5 }}>Horários</h2>
          <small>Marque os dias abertos e defina um horário para cada dia.</small>
        </div>
        {canEdit && (
          <button
            className="btn"
            onClick={() => {
              setDraft(week.map((day) => ({ ...day })));
              setError("");
              setOpen(true);
            }}
          >
            <Pencil size={16} /> Configurar semana
          </button>
        )}
      </div>
      {toast && (
        <p className="feedback success" role="status">
          {toast}
        </p>
      )}
      {error && !open && (
        <p className="feedback" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <div className="skeleton" />
      ) : (
        <div className="weekly-hours-card">
          {dayOrder.map((dayIndex) => {
            const day = week[dayIndex];
            return (
            <div className="weekly-hours-row" key={day.day_of_week}>
              <strong>{dayNames[day.day_of_week]}</strong>
              {day.enabled ? (
                <span className="weekly-hours-open">
                  <Clock3 size={15} /> {day.start_time} às {day.end_time}
                </span>
              ) : (
                <span className="badge">Fechado</span>
              )}
            </div>
            );
          })}
        </div>
      )}
      <ResponsiveModal
        open={open}
        title="Configurar horários"
        wide
        onClose={() => {
          if (!saving) setOpen(false);
        }}
      >
        <form className="stack" onSubmit={save}>
          <fieldset className="weekly-day-picker">
            <legend>Dias de funcionamento</legend>
            <small>Os dias não selecionados ficarão fechados.</small>
            <div className="weekly-day-options">
              {dayOrder.map((dayIndex) => {
                const day = draft[dayIndex];
                return (
                <label key={day.day_of_week}>
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(event) =>
                      update(day.day_of_week, { enabled: event.target.checked })
                    }
                  />
                  <span>{dayNames[day.day_of_week]}</span>
                </label>
                );
              })}
            </div>
          </fieldset>
          <div className="weekly-time-list">
            {draft.some((day) => day.enabled) ? (
              dayOrder
                .map((dayIndex) => draft[dayIndex])
                .filter((day) => day.enabled)
                .map((day) => (
                  <div className="weekly-time-row" key={day.day_of_week}>
                    <strong>{dayNames[day.day_of_week]}</strong>
                    <label>
                      Abre às
                      <input
                        type="time"
                        required
                        value={day.start_time}
                        onChange={(event) =>
                          update(day.day_of_week, {
                            start_time: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Fecha às
                      <input
                        type="time"
                        required
                        value={day.end_time}
                        onChange={(event) =>
                          update(day.day_of_week, {
                            end_time: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                ))
            ) : (
              <div className="notice">
                Selecione pelo menos um dia para informar os horários.
              </div>
            )}
          </div>
          {error && (
            <p className="feedback" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button
              type="button"
              className="btn secondary"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </button>
            <button className="btn" disabled={saving}>
              {saving ? "Salvando…" : "Salvar horários"}
            </button>
          </div>
        </form>
      </ResponsiveModal>
    </section>
  );
}
